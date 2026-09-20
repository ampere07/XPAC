<?php

namespace App\Services;

use App\Models\EmailQueue;
use App\Models\EmailTemplate;
use Illuminate\Support\Facades\Log;

class EmailQueueService
{
    protected ResendEmailService $resendService;

    public function __construct(ResendEmailService $resendService)
    {
        $this->resendService = $resendService;
    }

    public function queueEmail(array $data): EmailQueue
    {
        $emailQueue = EmailQueue::create([
            'account_no' => $data['account_no'] ?? null,
            'recipient_email' => $data['recipient_email'],
            'cc' => $data['cc'] ?? null,
            'bcc' => $data['bcc'] ?? null,
            'subject' => $data['subject'],
            'body_html' => $data['body_html'],
            'attachment_path' => $data['attachment_path'] ?? null,
            'status' => 'pending',
            'time_sent' => $data['time_sent'] ?? null,
            'email_sender' => $data['email_sender'] ?? null,
            'reply_to' => $data['reply_to'] ?? null,
            'sender_name' => $data['sender_name'] ?? null
        ]);

        Log::info('Email queued', [
            'id' => $emailQueue->id,
            'recipient' => $data['recipient_email'],
            'subject' => $data['subject']
        ]);

        return $emailQueue;
    }

    public function queueFromTemplate(string $templateCode, array $data): ?EmailQueue
    {
        $template = EmailTemplate::where('Template_Code', $templateCode)
            ->where('Is_Active', true)
            ->first();

        if (!$template) {
            Log::error('Email template not found', ['template_code' => $templateCode]);
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
            'subject' => 'Account Credentials - ATSS Fiber',
            'body_html' => "
                <div style='font-family: Arial, sans-serif; color: #333; line-height: 1.6;'>
                    <h2 style='color: #7c3aed;'>Welcome to ATSS Fiber</h2>
                    <p>Hello <strong>{$user->full_name}</strong>,</p>
                    <p>Your account has been activated. Below are your login credentials for our customer portal:</p>
                    <div style='background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7c3aed;'>
                        <p style='margin: 5px 0;'><strong>Account Number:</strong> <code style='background: #eee; padding: 2px 4px; border-radius: 4px;'>{$user->username}</code></p>
                        <p style='margin: 5px 0;'><strong>Password:</strong> <code style='background: #eee; padding: 2px 4px; border-radius: 4px;'>{$password}</code></p>
                    </div>
                    <p>Please keep these credentials secure. You can use them to log in to our portal to view your billing statements and manage your account.</p>
                    <br>
                    <p>Best regards,<br><strong>ATSS Fiber Team</strong></p>
                    <hr style='border: 0; border-top: 1px solid #eee; margin: 20px 0;'>
                    <p style='font-size: 11px; color: #666;'>This is an automated message, please do not reply directly to this email.</p>
                </div>
            ",
            'email_sender' => 'billing@atssfiber.ph',
            'reply_to' => 'billing@atssfiber.ph',
            'sender_name' => 'ATSS Fiber'
        ]);
    }
}


