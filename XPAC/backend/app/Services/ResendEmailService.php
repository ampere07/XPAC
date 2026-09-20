<?php

namespace App\Services;

use Exception;
use Illuminate\Support\Facades\Log;

class ResendEmailService
{
    protected string $apiKey;
    protected string $apiUrl = 'https://api.resend.com/emails';
    protected string $fromEmail;
    protected string $fromName;

    // Seconds to wait when establishing the TCP connection.
    protected int $connectTimeout = 10;

    // Maximum total seconds for the whole cURL transfer (including upload of
    // any attachment).  PDFs can be several MB; 60 s gives enough headroom
    // while still failing fast enough to avoid server-side 524s.
    protected int $transferTimeout = 60;

    // How many times to retry on a timeout or 5xx before giving up.
    protected int $maxRetries = 3;

    public function __construct()
    {
        $this->apiKey    = config('services.resend.api_key') ?? '';
        $this->fromEmail = config('mail.from.address') ?? '';
        $this->fromName  = config('mail.from.name') ?? '';
    }

    public function send(array $data): array
    {
        $fromEmail = $data['email_sender'] ?? $this->fromEmail;
        $fromName  = $data['sender_name']  ?? $this->fromName;

        $payload = [
            'from'    => "{$fromName} <{$fromEmail}>",
            'to'      => is_array($data['to']) ? $data['to'] : [$data['to']],
            'subject' => $data['subject'],
            'html'    => $data['html'],
        ];

        if (!empty($data['reply_to'])) {
            $payload['reply_to'] = $data['reply_to'];
        }

        if (!empty($data['cc'])) {
            $payload['cc'] = $this->parseEmails($data['cc']);
        }

        if (!empty($data['bcc'])) {
            $payload['bcc'] = $this->parseEmails($data['bcc']);
        }

        if (!empty($data['attachment_path']) && file_exists($data['attachment_path'])) {
            $payload['attachments'] = [$this->prepareAttachment($data['attachment_path'])];
        }

        $jsonPayload = json_encode($payload);
        $lastError   = null;

        for ($attempt = 1; $attempt <= $this->maxRetries; $attempt++) {
            try {
                $ch = curl_init($this->apiUrl);
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($ch, CURLOPT_POST, true);
                curl_setopt($ch, CURLOPT_HTTPHEADER, [
                    'Authorization: Bearer ' . $this->apiKey,
                    'Content-Type: application/json',
                ]);
                curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonPayload);

                // ── Timeouts ────────────────────────────────────────────────
                // Without these the request can hang indefinitely, which causes
                // Cloudflare to kill the upstream connection with a 524.
                curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $this->connectTimeout);
                curl_setopt($ch, CURLOPT_TIMEOUT, $this->transferTimeout);

                $result   = curl_exec($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $curlErr  = curl_error($ch);
                curl_close($ch);

                // cURL-level failure (DNS error, connection refused, timeout…)
                if ($result === false || $httpCode === 0) {
                    throw new Exception("cURL error on attempt {$attempt}: {$curlErr}");
                }

                if ($httpCode === 200 || $httpCode === 201) {
                    if ($attempt > 1) {
                        Log::info('Resend Email succeeded after retry', [
                            'attempt' => $attempt,
                            'to'      => $data['to'],
                        ]);
                    }
                    return [
                        'success'  => true,
                        'response' => json_decode($result, true),
                    ];
                }

                $errorResponse = json_decode($result, true);
                $errorMessage  = "Resend API Error ({$httpCode}): "
                    . ($errorResponse['message'] ?? $result);

                // Retry on 5xx / gateway errors (524, 503, 502 …).
                // Do NOT retry on 4xx client errors (bad key, invalid payload…).
                if ($httpCode >= 500 || $httpCode === 524) {
                    throw new Exception($errorMessage);
                }

                // Non-retryable 4xx — fail immediately.
                Log::error('Resend Email Failed (non-retryable)', [
                    'error'   => $errorMessage,
                    'to'      => $data['to'],
                    'subject' => $data['subject'],
                ]);
                return ['success' => false, 'error' => $errorMessage];

            } catch (Exception $e) {
                $lastError = $e->getMessage();

                Log::warning('Resend Email attempt failed', [
                    'attempt' => $attempt,
                    'error'   => $lastError,
                    'to'      => $data['to'],
                    'subject' => $data['subject'],
                ]);

                if ($attempt < $this->maxRetries) {
                    // Exponential back-off: 2 s → 4 s → 8 s
                    $sleepSeconds = (int) pow(2, $attempt);
                    Log::info("Retrying email send in {$sleepSeconds}s (attempt {$attempt}/{$this->maxRetries})", [
                        'to'      => $data['to'],
                        'subject' => $data['subject'],
                    ]);
                    sleep($sleepSeconds);
                }
            }
        }

        // All retries exhausted.
        Log::error('Resend Email Failed after all retries', [
            'error'   => $lastError,
            'to'      => $data['to'],
            'subject' => $data['subject'],
        ]);

        return ['success' => false, 'error' => $lastError];
    }

    protected function parseEmails($emails): array
    {
        if (is_array($emails)) {
            return array_filter($emails);
        }

        return array_filter(
            array_map('trim', explode(',', $emails))
        );
    }

    protected function prepareAttachment(string $filePath): array
    {
        $fileContent = file_get_contents($filePath);
        $bytes       = array_values(unpack('C*', $fileContent));

        return [
            'filename' => basename($filePath),
            'content'  => $bytes,
        ];
    }
}
