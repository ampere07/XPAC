<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Email ownership check for the public application form.
 *
 * The applicant asks for a code, receives it by email, and types it back. Only
 * then does the backend issue a verification token, and ApplicationController
 * refuses a submission without a valid token for that exact address — so the
 * check cannot be skipped by editing the page.
 *
 * State lives in the server-side cache, keyed by a hash of the address:
 *   - the code is stored as an HMAC, never in plain text, and is never returned
 *     by any endpoint or written to the log;
 *   - requesting a new code overwrites the old entry, which invalidates it;
 *   - every entry carries its own TTL, so expiry needs no cleanup job.
 */
class EmailVerificationService
{
    /** How long a sent code stays valid. */
    public const CODE_TTL_MINUTES = 10;

    /** Minimum wait between two sends to the same address. */
    public const RESEND_COOLDOWN_SECONDS = 60;

    /** Wrong guesses allowed per code before a new one must be requested. */
    public const MAX_ATTEMPTS = 5;

    /** How long a successful verification is honoured by the submit endpoint. */
    public const TOKEN_TTL_MINUTES = 60;

    private const CODE_LENGTH = 6;

    /**
     * Letters and digits, minus the look-alikes (0/O, 1/I/L) that make a code
     * hard to copy from an email by eye. 31 symbols ^ 6 ≈ 887 million codes.
     */
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    public function __construct(private ResendEmailService $mailer)
    {
    }

    /**
     * Send a fresh code to $email.
     *
     * @return array{ok: bool, status: int, message: string, retry_after?: int}
     */
    public function sendCode(string $email): array
    {
        $email = $this->normalize($email);
        $key = $this->key($email);

        $cooldownUntil = Cache::get("{$key}:cooldown");
        if ($cooldownUntil && $cooldownUntil > time()) {
            $wait = $cooldownUntil - time();
            return [
                'ok' => false,
                'status' => 429,
                'message' => "Please wait {$wait} seconds before requesting another code.",
                'retry_after' => $wait,
            ];
        }

        $code = $this->generateCode();

        $sent = $this->mailer->send([
            'to' => $email,
            'subject' => 'Your email verification code',
            'html' => $this->emailHtml($code),
        ]);

        if (!($sent['success'] ?? false)) {
            // Nothing stored, so the applicant can retry at once and no unsent code is live.
            Log::warning('Email verification code could not be sent', ['email_hash' => $key]);
            return [
                'ok' => false,
                'status' => 502,
                'message' => 'We could not send the verification email. Please check the address and try again.',
            ];
        }

        // Overwrites any earlier code for this address, which is what invalidates it.
        // A previous verification is dropped too: a new code means the applicant is
        // starting over.
        $expiresAt = time() + self::CODE_TTL_MINUTES * 60;
        Cache::put("{$key}:code", [
            'hash' => $this->hash($email, $code),
            'attempts' => 0,
            'expires_at' => $expiresAt,
        ], self::CODE_TTL_MINUTES * 60);
        Cache::forget("{$key}:token");
        Cache::put("{$key}:cooldown", time() + self::RESEND_COOLDOWN_SECONDS, self::RESEND_COOLDOWN_SECONDS);

        return [
            'ok' => true,
            'status' => 200,
            'message' => 'A verification code was sent to ' . $email . '. It expires in ' . self::CODE_TTL_MINUTES . ' minutes.',
            'retry_after' => self::RESEND_COOLDOWN_SECONDS,
        ];
    }

    /**
     * Check a code. On success the code is consumed and a token is returned for
     * the submit request to present.
     *
     * @return array{ok: bool, status: int, message: string, token?: string}
     */
    public function verifyCode(string $email, string $code): array
    {
        $email = $this->normalize($email);
        $key = $this->key($email);
        $entry = Cache::get("{$key}:code");

        if (!$entry || $entry['expires_at'] <= time()) {
            Cache::forget("{$key}:code");
            return [
                'ok' => false,
                'status' => 422,
                'message' => 'This code has expired or was never sent. Please request a new code.',
            ];
        }

        if ($entry['attempts'] >= self::MAX_ATTEMPTS) {
            Cache::forget("{$key}:code");
            return [
                'ok' => false,
                'status' => 429,
                'message' => 'Too many incorrect attempts. Please request a new code.',
            ];
        }

        $code = strtoupper(preg_replace('/\s+/', '', $code));

        if (!hash_equals($entry['hash'], $this->hash($email, $code))) {
            $entry['attempts']++;
            $remaining = self::MAX_ATTEMPTS - $entry['attempts'];

            if ($remaining <= 0) {
                Cache::forget("{$key}:code");
                return [
                    'ok' => false,
                    'status' => 429,
                    'message' => 'Too many incorrect attempts. Please request a new code.',
                ];
            }

            // Keep the code's original expiry rather than extending it on every guess.
            Cache::put("{$key}:code", $entry, max(1, $entry['expires_at'] - time()));

            return [
                'ok' => false,
                'status' => 422,
                'message' => "Incorrect code. You have {$remaining} " . ($remaining === 1 ? 'attempt' : 'attempts') . ' left.',
            ];
        }

        Cache::forget("{$key}:code");

        $token = Str::random(64);
        Cache::put("{$key}:token", hash('sha256', $token), now()->addMinutes(self::TOKEN_TTL_MINUTES));

        return [
            'ok' => true,
            'status' => 200,
            'message' => 'Email address verified.',
            'token' => $token,
        ];
    }

    /** Whether $token proves $email was verified (and has not been used or expired). */
    public function isVerified(string $email, ?string $token): bool
    {
        if (!$token) {
            return false;
        }

        $stored = Cache::get($this->key($this->normalize($email)) . ':token');

        return is_string($stored) && hash_equals($stored, hash('sha256', $token));
    }

    /** One verification, one application: called once the application is saved. */
    public function consume(string $email): void
    {
        Cache::forget($this->key($this->normalize($email)) . ':token');
    }

    private function normalize(string $email): string
    {
        return strtolower(trim($email));
    }

    /** The address itself never appears in a cache key or filename. */
    private function key(string $email): string
    {
        return 'email_verification:' . hash('sha256', $email);
    }

    /** Keyed with APP_KEY, so a leaked cache file does not reveal the code. */
    private function hash(string $email, string $code): string
    {
        return hash_hmac('sha256', $email . '|' . $code, (string) config('app.key'));
    }

    private function generateCode(): string
    {
        $code = '';
        $max = strlen(self::ALPHABET) - 1;
        for ($i = 0; $i < self::CODE_LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, $max)];
        }
        return $code;
    }

    private function emailHtml(string $code): string
    {
        $company = e(config('mail.from.name', 'XPAC'));
        $minutes = self::CODE_TTL_MINUTES;
        $spaced = e(implode(' ', str_split($code)));

        return <<<HTML
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #111827;">
  <h2 style="margin: 0 0 16px;">Verify your email address</h2>
  <p style="margin: 0 0 16px;">Use the code below to verify your email address on the {$company} application form.</p>
  <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 16px; background: #f3f4f6; border-radius: 8px; margin: 0 0 16px;">{$spaced}</div>
  <p style="margin: 0 0 8px;">This code expires in {$minutes} minutes.</p>
  <p style="margin: 0; color: #6b7280; font-size: 13px;">If you did not request this code, you can ignore this email. Never share this code with anyone.</p>
</div>
HTML;
    }
}
