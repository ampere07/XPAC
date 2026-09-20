<?php

namespace App\Services;

use App\Models\SmsConfig;
use Exception;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;

class ItexmoSmsService
{
    protected ?SmsConfig $config;
    protected string $apiUrl = 'https://api.itexmo.com/api/broadcast';
    protected int $maxRetries = 3;
    protected int $timeoutSeconds = 30;

    public function __construct()
    {
        $this->config = SmsConfig::first();
    }

    public function send(array $data): array
    {
        if (!$this->config) {
            return [
                'success' => false,
                'error' => 'SMS configuration not found. Please configure SMS settings.'
            ];
        }

        $contactNo = $this->normalizePhoneNumber($data['contact_no'] ?? $data['contactNumber'] ?? '');
        $message = $data['message'] ?? '';

        if (empty($contactNo) || empty($message)) {
            return [
                'success' => false,
                'error' => 'Contact number and message are required'
            ];
        }

        $payload = [
            'Email' => $this->config->email,
            'Password' => $this->config->password,
            'ApiCode' => $this->config->code,
            'Recipients' => [$contactNo],
            'Message' => $message,
            'SenderId' => $this->config->sender
        ];

        try {
            $result = $this->sendWithRetry($payload);

            Log::info('SMS sent successfully', [
                'contact_no' => $contactNo,
                'message_length' => strlen($message)
            ]);

            return [
                'success' => true,
                'message' => 'SMS sent successfully',
                'response' => $result
            ];

        } catch (Exception $e) {
            Log::error('SMS sending failed', [
                'contact_no' => $contactNo,
                'error' => $e->getMessage()
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    public function sendBlast(array $data): array
    {
        if (!$this->config) {
            return [
                'success' => false,
                'error' => 'SMS configuration not found'
            ];
        }

        $filterType = $data['filterType'] ?? '';
        $filterValue = $data['filterValue'] ?? '';
        $message = $data['message'] ?? '';

        if (empty($filterType) || empty($filterValue) || empty($message)) {
            return [
                'success' => false,
                'error' => 'Filter type, filter value, and message are required'
            ];
        }

        try {
            $recipients = $this->getRecipientsByFilter($filterType, $filterValue);

            if ($recipients->isEmpty()) {
                return [
                    'success' => false,
                    'error' => 'No recipients found for the specified filter'
                ];
            }

            $sentCount = 0;
            $failedCount = 0;

            foreach ($recipients as $recipient) {
                $personalizedMessage = str_replace('{{Account_No}}', $recipient->account_no, $message);
                
                $result = $this->send([
                    'contact_no' => $recipient->contact_no,
                    'message' => $personalizedMessage
                ]);

                if ($result['success']) {
                    $sentCount++;
                } else {
                    $failedCount++;
                }
            }

            $this->logBlast($filterType, $filterValue, $message, $sentCount);

            return [
                'success' => true,
                'message' => "SMS blast completed. Sent: {$sentCount}, Failed: {$failedCount}",
                'sent_count' => $sentCount,
                'failed_count' => $failedCount,
                'total_recipients' => $recipients->count()
            ];

        } catch (Exception $e) {
            Log::error('SMS blast failed', [
                'filter_type' => $filterType,
                'filter_value' => $filterValue,
                'error' => $e->getMessage()
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    protected function sendWithRetry(array $payload): string
    {
        $attempt = 0;
        $lastError = '';

        do {
            $attempt++;
            
            try {
                $ch = curl_init();
                curl_setopt($ch, CURLOPT_URL, $this->apiUrl);
                curl_setopt($ch, CURLOPT_POST, 1);
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
                curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeoutSeconds);
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
                curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
                
                $response = curl_exec($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $curlError = curl_error($ch);
                curl_close($ch);

                if ($httpCode >= 200 && $httpCode < 300) {
                    // Itexmo sometimes returns a number (0 for success, others for error)
                    if ($response === '0' || $response === 'Success: SMS Sent') {
                        return $response ?: 'Success';
                    }
                    
                    // If it's a numeric error code from Itexmo
                    if (is_numeric($response) && (int)$response > 0) {
                        $itexmoErrors = [
                            '1' => 'Invalid ApiCode/Credentials',
                            '2' => 'No SMS Balance',
                            '3' => 'Invalid Recipient',
                            '4' => 'Sender Id not Yet Registered',
                            '5' => 'Message contains Filtered Words',
                            '6' => 'SMS API is Under Maintenance',
                            '7' => 'Account Blocked',
                            '8' => 'Invalid Target Gateway'
                        ];
                        $errMsg = $itexmoErrors[$response] ?? "Itexmo Error Code: {$response}";
                        throw new Exception($errMsg);
                    }

                    return $response ?: 'Success';
                }

                $lastError = $curlError ?: "HTTP Code: {$httpCode}, Response: {$response}";

                if ($attempt < $this->maxRetries) {
                    sleep(2);
                }

            } catch (Exception $e) {
                $lastError = $e->getMessage();
                if ($attempt >= $this->maxRetries) {
                    throw $e;
                }
                sleep(2);
            }

        } while ($attempt < $this->maxRetries);

        throw new Exception("SMS sending failed after {$this->maxRetries} attempts. Last error: {$lastError}");
    }

    protected function normalizePhoneNumber(string $contactNo): string
    {
        // Remove all non-numeric characters
        $contactNo = preg_replace('/[^0-9]/', '', $contactNo);
        
        // Handle +63 and 63 prefix
        if (str_starts_with($contactNo, '63') && strlen($contactNo) === 12) {
            $contactNo = '0' . substr($contactNo, 2);
        }
        
        // Handle 10-digit format (9xxxxxxxxx)
        if (strlen($contactNo) === 10 && str_starts_with($contactNo, '9')) {
            $contactNo = '0' . $contactNo;
        }
        
        return $contactNo;
    }

    protected function getRecipientsByFilter(string $filterType, string $filterValue)
    {
        $query = DB::table('billing_accounts')
            ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
            ->where('billing_accounts.billing_status_id', 2)
            ->select('billing_accounts.account_no', 'customers.contact_number_primary as contact_no');

        switch ($filterType) {
            case 'Barangay':
                $query->where('customers.barangay_id', $filterValue);
                break;
            case 'LCP':
                $query->join('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                    ->where('technical_details.lcp', $filterValue);
                break;
            case 'LCPNAP':
                $query->join('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                    ->where('technical_details.lcpnap', $filterValue);
                break;
            case 'Location':
                $query->where('customers.location', $filterValue);
                break;
            default:
                throw new Exception('Invalid filter type');
        }

        return $query->get();
    }

    protected function logBlast(string $filterType, string $filterValue, string $message, int $messageCount): void
    {
        try {
            DB::table('sms_blast_logs')->insert([
                'message' => $message,
                'location_id' => $filterType === 'Location' ? $filterValue : null,
                'billing_day' => null,
                'lcpnap_id' => $filterType === 'LCPNAP' ? $filterValue : null,
                'lcp_id' => $filterType === 'LCP' ? $filterValue : null,
                'message_count' => $messageCount,
                'timestamp' => now(),
                'credit_used' => $messageCount,
                'created_at' => now(),
                'created_by_user_id' => auth()->id() ?? 1,
                'updated_at' => now(),
                'updated_by_user_id' => auth()->id() ?? 1
            ]);
        } catch (Exception $e) {
            Log::error('Failed to log SMS blast', [
                'error' => $e->getMessage()
            ]);
        }
    }
}

