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
            'email_sender' => $data['email_sender'] ?? null,
            'sender_name' => $data['sender_name'] ?? null,
            'reply_to' => $data['reply_to'] ?? null,
            'status' => 'pending'
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

        $subject = $this->replacePlaceholders($template->Subject_Line, $data);
        
        // Use email_body exclusively for email content (Body_HTML is for PDF generation)
        $content = trim($template->email_body ?? '');
        
        $bodyHtml = $this->replacePlaceholders($content, $data);

        return $this->queueEmail([
            'account_no' => $data['account_no'] ?? null,
            'recipient_email' => $data['recipient_email'],
            'cc' => $data['cc'] ?? $template->cc,
            'bcc' => $data['bcc'] ?? $template->bcc,
            'subject' => $subject,
            'body_html' => $bodyHtml,
            'attachment_path' => $data['attachment_path'] ?? null,
            'email_sender' => $template->email_sender,
            'reply_to' => $template->reply_to,
            'sender_name' => $template->sender_name
        ]);
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
                'sender_name' => $job->sender_name,
                'reply_to' => $job->reply_to
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

            usleep(100000);
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
                'sender_name' => $job->sender_name,
                'reply_to' => $job->reply_to
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

            usleep(150000);
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
}


