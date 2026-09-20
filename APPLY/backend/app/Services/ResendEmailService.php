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

    public function __construct()
    {
        $this->apiKey = (string) config('services.resend.api_key', '');
        $this->fromEmail = (string) config('mail.from.address', '');
        $this->fromName = (string) config('mail.from.name', '');
    }

    public function send(array $data): array
    {
        $fromEmail = $data['email_sender'] ?? $this->fromEmail;
        $fromName = $data['sender_name'] ?? $this->fromName;

        $payload = [
            'from' => "{$fromName} <{$fromEmail}>",
            'to' => is_array($data['to']) ? $data['to'] : [$data['to']],
            'subject' => $data['subject'],
            'html' => $data['html']
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

        try {
            $ch = curl_init($this->apiUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Authorization: Bearer ' . $this->apiKey,
                'Content-Type: application/json'
            ]);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200) {
                return [
                    'success' => true,
                    'response' => json_decode($result, true)
                ];
            }

            $errorResponse = json_decode($result, true);
            throw new Exception("Resend API Error ({$httpCode}): " . ($errorResponse['message'] ?? $result));

        } catch (Exception $e) {
            Log::error('Resend Email Failed', [
                'error' => $e->getMessage(),
                'to' => $data['to'],
                'subject' => $data['subject']
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
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
        $bytes = array_values(unpack('C*', $fileContent));

        return [
            'filename' => basename($filePath),
            'content' => $bytes
        ];
    }
}


