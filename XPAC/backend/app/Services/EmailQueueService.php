<?php

namespace App\Services;

use App\Models\EmailQueue;
use App\Models\EmailTemplate;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;

class EmailQueueService
{
    protected ResendEmailService $resendService;

    public function __construct(ResendEmailService $resendService)
    {
        $this->resendService = $resendService;
    }

    /**
     * Queue one email, at most once.
     *
     * Scheduled notices come from scans that are expected to re-run — the daily billing cron, a
     * manual re-run, a scan whose "already notified" marker failed to persist. Queueing is
     * therefore idempotent for anything carrying a `time_sent`: the
     * (account, recipient, subject, time_sent) tuple is hashed into `email_queue.dedupe_key`, which
     * is UNIQUE, so a second insert loses at the database and the row already queued is returned
     * instead. Two overlapping runs cannot email a customer twice.
     *
     * Emails queued WITHOUT a time_sent are deliberately NOT deduplicated — resending the same
     * message by hand is a legitimate operator action. Mirrors
     * {@see \App\Services\SmsQueueService::queueSms()}.
     */
    public function queueEmail(array $data): EmailQueue
    {
        $dedupeKey = $this->dedupeKeyFor(
            $data['account_no'] ?? null,
            $data['recipient_email'],
            $data['subject'],
            $data['time_sent'] ?? null
        );

        if ($dedupeKey !== null) {
            $existing = EmailQueue::where('dedupe_key', $dedupeKey)->first();

            if ($existing) {
                Log::info('Email already queued for this notification, not queueing again', [
                    'id' => $existing->id,
                    'recipient' => $data['recipient_email'],
                    'subject' => $data['subject'],
                    'status' => $existing->status,
                ]);

                return $existing;
            }
        }

        try {
            $emailQueue = EmailQueue::create([
                'account_no' => $data['account_no'] ?? null,
                'recipient_email' => $data['recipient_email'],
                'cc' => $data['cc'] ?? null,
                'bcc' => $data['bcc'] ?? null,
                'subject' => $data['subject'],
                'dedupe_key' => $dedupeKey,
                'body_html' => $data['body_html'],
                'attachment_path' => $data['attachment_path'] ?? null,
                'status' => 'pending',
                'time_sent' => $data['time_sent'] ?? null,
                'email_sender' => $data['email_sender'] ?? null,
                'reply_to' => $data['reply_to'] ?? null,
                'sender_name' => $data['sender_name'] ?? null
            ]);
        } catch (QueryException $e) {
            // Lost the race against a concurrent run holding the same key — that run has already
            // queued the message, so this is success. Anything else is a real fault and re-thrown.
            if ($dedupeKey !== null && $this->isDuplicateKeyViolation($e)) {
                $existing = EmailQueue::where('dedupe_key', $dedupeKey)->first();

                if ($existing) {
                    Log::info('Email queued concurrently by another run, reusing that row', [
                        'id' => $existing->id,
                        'recipient' => $data['recipient_email'],
                    ]);

                    return $existing;
                }
            }

            throw $e;
        }

        Log::info('Email queued', [
            'id' => $emailQueue->id,
            'recipient' => $data['recipient_email'],
            'subject' => $data['subject']
        ]);

        return $emailQueue;
    }

    /**
     * The idempotency key for a scheduled notification, or null when the message is not one.
     *
     * MUST stay in step with the UNIQUE index added in
     * 2026_08_06_000003_add_dedupe_key_to_email_queue.
     */
    public function dedupeKeyFor(?string $accountNo, string $recipientEmail, string $subject, ?string $timeSent): ?string
    {
        if (empty($timeSent)) {
            return null;
        }

        return hash('sha256', implode("\0", [
            (string) $accountNo,
            $recipientEmail,
            $subject,
            $timeSent,
        ]));
    }

    /**
     * A UNIQUE constraint violation, as opposed to any other query failure.
     */
    private function isDuplicateKeyViolation(QueryException $e): bool
    {
        return ($e->errorInfo[0] ?? null) === '23000'
            && in_array((int) ($e->errorInfo[1] ?? 0), [1062, 1586], true);
    }

    public function queueFromTemplate(string $templateCode, array $data): ?EmailQueue
    {
        // Fetched without the Is_Active filter so the two cases can be told apart. Filtering
        // in the query collapsed them, and a template that had simply been switched off was
        // reported as missing — at ERROR level, which put a routine configuration choice in
        // the log next to real faults and sent people looking for a row that was there all
        // along.
        $template = EmailTemplate::where('Template_Code', $templateCode)->first();

        if (!$template) {
            Log::error('Email template not found', ['template_code' => $templateCode]);
            return null;
        }

        if (!$template->Is_Active) {
            Log::info('Email template is disabled; skipping send', ['template_code' => $templateCode]);
            return null;
        }

        $subject = $this->replacePlaceholders($template->Subject_Line ?? 'Notification', $data);
        
        // Try email_body first, then fallback to Body_HTML
        $content = trim($template->email_body ?? '');
        if (empty($content)) {
            $content = trim($template->Body_HTML ?? '');
        }

        // Final fallback if both are empty to avoid DB null constraint error
        if (empty($content)) {
            Log::warning('Email template content is empty', ['template_code' => $templateCode]);
            $content = "Notification for Account: {{Account_No}}";
        }
        
        $bodyHtml = $this->replacePlaceholders($content, $data);

        try {
            return $this->queueEmail([
                'account_no' => $data['account_no'] ?? null,
                'recipient_email' => $data['recipient_email'],
                'cc' => $data['cc'] ?? $template->cc,
                'bcc' => $data['bcc'] ?? $template->bcc,
                'subject' => $subject,
                'body_html' => $bodyHtml,
                'attachment_path' => $data['attachment_path'] ?? null,
                'time_sent' => $data['time_sent'] ?? null,
                'email_sender' => $template->email_sender,
                'reply_to' => $template->reply_to,
                'sender_name' => $template->sender_name
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to create email queue record', [
                'error' => $e->getMessage(),
                'template_code' => $templateCode,
                'recipient' => $data['recipient_email']
            ]);
            return null;
        }
    }

    public function processPendingEmails(int $batchSize = 50): array
    {
        $jobs = EmailQueue::pending()
            ->orderBy('created_at', 'asc')
            ->limit($batchSize)
            ->get();

        if ($jobs->isEmpty()) {
            return [
                'processed' => 0,
                'sent' => 0,
                'failed' => 0
            ];
        }

        Log::info('Processing email queue', ['count' => $jobs->count()]);

        $stats = [
            'processed' => $jobs->count(),
            'sent' => 0,
            'failed' => 0
        ];

        foreach ($jobs as $job) {
            $result = $this->resendService->send([
                'to' => $job->recipient_email,
                'cc' => $job->cc,
                'bcc' => $job->bcc,
                'subject' => $job->subject,
                'html' => $job->body_html,
                'attachment_path' => $job->attachment_path,
                'email_sender' => $job->email_sender,
                'reply_to' => $job->reply_to,
                'sender_name' => $job->sender_name
            ]);

            if ($result['success']) {
                $job->markAsSent();
                $stats['sent']++;
                Log::info('Email sent', ['id' => $job->id]);
                
                // Delete temp attachment file after successful send
                if ($job->attachment_path && file_exists($job->attachment_path)) {
                    unlink($job->attachment_path);
                    Log::info('Temp attachment deleted', ['path' => $job->attachment_path]);
                }
            } else {
                $job->markAsFailed($result['error']);
                $stats['failed']++;
                Log::error('Email failed', ['id' => $job->id, 'error' => $result['error']]);
            }

            // Sleep for 600ms to stay under Resend's 2 req/sec rate limit
            usleep(600000);
        }

        return $stats;
    }

    public function retryFailedEmails(int $maxAttempts = 3, int $batchSize = 20): array
    {
        $jobs = EmailQueue::retryable($maxAttempts)
            ->orderBy('created_at', 'asc')
            ->limit($batchSize)
            ->get();

        if ($jobs->isEmpty()) {
            return [
                'processed' => 0,
                'sent' => 0,
                'failed' => 0
            ];
        }

        Log::info('Retrying failed emails', ['count' => $jobs->count()]);

        $stats = [
            'processed' => $jobs->count(),
            'sent' => 0,
            'failed' => 0
        ];

        foreach ($jobs as $job) {
            $result = $this->resendService->send([
                'to' => $job->recipient_email,
                'cc' => $job->cc,
                'bcc' => $job->bcc,
                'subject' => $job->subject,
                'html' => $job->body_html,
                'attachment_path' => $job->attachment_path,
                'email_sender' => $job->email_sender,
                'reply_to' => $job->reply_to,
                'sender_name' => $job->sender_name
            ]);

            if ($result['success']) {
                $job->markAsSent();
                $stats['sent']++;
                Log::info('Email retry successful', ['id' => $job->id, 'attempts' => $job->attempts + 1]);
                
                // Delete temp attachment file after successful send
                if ($job->attachment_path && file_exists($job->attachment_path)) {
                    unlink($job->attachment_path);
                    Log::info('Temp attachment deleted', ['path' => $job->attachment_path]);
                }
            } else {
                $job->markAsFailed($result['error']);
                $stats['failed']++;
                Log::error('Email retry failed', ['id' => $job->id, 'attempts' => $job->attempts]);
            }

            // Sleep for 600ms to stay under Resend's 2 req/sec rate limit
            usleep(600000);
        }

        return $stats;
    }

    protected function replacePlaceholders(string $text, array $data): string
    {
        foreach ($data as $key => $value) {
            $text = str_replace('{{' . $key . '}}', $value, $text);
        }

        return $text;
    }

    /**
     * Send credentials to a user.
     * 
     * @param \App\Models\User $user
     * @return EmailQueue|null
     */
    public function sendUserCredentials(\App\Models\User $user): ?EmailQueue
    {
        // For customers, the password is typically their contact number.
        $password = $user->contact_number ?: 'N/A';
        
        return $this->queueEmail([
            'account_no' => $user->username,
            'recipient_email' => $user->email_address,
            'subject' => 'Account Credentials - GOWISER',
            'body_html' => "
                <div style='font-family: Arial, sans-serif; color: #333; line-height: 1.6;'>
                    <h2 style='color: #7c3aed;'>Welcome to GOWISER</h2>
                    <p>Hello <strong>{$user->full_name}</strong>,</p>
                    <p>Your account has been activated. Below are your login credentials for our customer portal:</p>
                    <div style='background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7c3aed;'>
                        <p style='margin: 5px 0;'><strong>Account Number:</strong> <code style='background: #eee; padding: 2px 4px; border-radius: 4px;'>{$user->username}</code></p>
                        <p style='margin: 5px 0;'><strong>Password:</strong> <code style='background: #eee; padding: 2px 4px; border-radius: 4px;'>{$password}</code></p>
                    </div>
                    <p>Please keep these credentials secure. You can use them to log in to our portal to view your billing statements and manage your account.</p>
                    <br>
                    <p>Best regards,<br><strong>GOWISER Team</strong></p>
                    <hr style='border: 0; border-top: 1px solid #eee; margin: 20px 0;'>
                    <p style='font-size: 11px; color: #666;'>This is an automated message, please do not reply directly to this email.</p>
                </div>
            ",
            'email_sender' => 'billing@gowiser.ph',
            'reply_to' => 'billing@gowiser.ph',
            'sender_name' => 'GOWISER'
        ]);
    }
}


