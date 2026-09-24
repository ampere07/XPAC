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
        // Ordered explicitly: SmsConfigController allows two rows (one per gateway) and an
        // unordered first() left it to the storage engine which credentials the cron would use.
        $this->config = SmsConfig::orderBy('id')->first();
    }

    /**
     * One line naming the gateway credentials in use, for run logs.
     *
     * Worth logging because the two-row config plus a single first() is exactly how a run ends up
     * posting one gateway's API key and sender name to the other gateway — which the provider
     * rejects, with nothing in the old logs to show why. The key is masked: these logs are shared.
     */
    public function describeActiveConfig(): string
    {
        if (!$this->config) {
            return 'no SMS configuration row found';
        }

        $code = (string) ($this->config->code ?? '');
        $masked = $code === ''
            ? '(empty)'
            : str_repeat('*', max(0, strlen($code) - 4)) . substr($code, -4);

        return sprintf(
            'config #%s provider=%s sender=%s apikey=%s',
            $this->config->id,
            $this->config->provider ?? 'itexmo',
            $this->config->sender !== null && $this->config->sender !== '' ? $this->config->sender : '(empty)',
            $masked
        );
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

        $provider = $this->config->provider ?? 'itexmo';

        if ($provider === 'semaphore') {
            return $this->sendSemaphore($contactNo, $message, $data);
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

            $this->logSms($contactNo, $message, 'itexmo', $result, $data);

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

    /**
     * Send one message through Semaphore.
     *
     * Semaphore reports a rejected send as a FIELD-KEYED object — {"sendername":["..."]},
     * {"apikey":["..."]} — not the {"error": "..."} shape this method used to look for. Every
     * such rejection therefore fell through to a bare "returned HTTP <code>" and the provider's
     * own explanation was discarded. describeHttpFailure() now flattens whatever came back and
     * the raw body is logged, so the reason reaches both the log and sms_queue.error_message.
     */
    protected function sendSemaphore(string $contactNo, string $message, array $data = []): array
    {
        $payload = [
            'apikey' => $this->config->code,
            'number' => $contactNo,
            'message' => $message,
            'sendername' => $this->config->sender
        ];

        $apiUrl = 'https://api.semaphore.co/api/v4/messages';
        $attempt = 0;
        $lastError = 'Semaphore API was never called';

        try {
            do {
                $attempt++;

                $ch = curl_init();
                curl_setopt($ch, CURLOPT_URL, $apiUrl);
                curl_setopt($ch, CURLOPT_POST, 1);
                curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($payload));
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeoutSeconds);

                $response = curl_exec($ch);
                $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
                // Never read before, so a TLS/DNS/timeout failure used to surface as
                // "returned HTTP unknown" with no indication that curl itself had failed.
                $curlError = (string) curl_error($ch);
                curl_close($ch);

                // A 2xx is NOT proof of acceptance. Semaphore answers a rejected send with
                // HTTP 200 and a validation body — {"number":["The number format is invalid."]} —
                // and treating any 2xx as success marked 212 queue rows 'sent' for messages that
                // reached nobody. Delivery is only claimed when the body carries a message_id.
                if ($httpCode >= 200 && $httpCode < 300
                    && !$this->semaphoreAccepted(is_string($response) ? $response : null)) {
                    $lastError = $this->describeHttpFailure(
                        $httpCode,
                        is_string($response) ? $response : null,
                        ''
                    );

                    Log::warning('Semaphore accepted the request but rejected the message', [
                        'contact_no' => $contactNo,
                        'attempt' => $attempt,
                        'http_code' => $httpCode,
                        'response_body' => is_string($response) ? mb_substr($response, 0, 1000) : null,
                    ]);

                    // The payload itself was refused; an identical retry earns an identical refusal.
                    break;
                }

                if ($httpCode >= 200 && $httpCode < 300) {
                    Log::info('Semaphore SMS sent successfully', [
                        'contact_no' => $contactNo,
                        'message_length' => strlen($message)
                    ]);

                    $this->logSms($contactNo, $message, 'semaphore', $response, $data);

                    return [
                        'success' => true,
                        'message' => 'SMS sent successfully via Semaphore',
                        'response' => $response
                    ];
                }

                $lastError = $this->describeHttpFailure(
                    $httpCode,
                    is_string($response) ? $response : null,
                    $curlError
                );

                Log::warning('Semaphore SMS attempt failed', [
                    'contact_no' => $contactNo,
                    'attempt' => $attempt,
                    'http_code' => $httpCode,
                    'curl_error' => $curlError,
                    'sender_name' => $this->config->sender,
                    'response_body' => is_string($response) ? mb_substr($response, 0, 1000) : null,
                ]);

                // A 4xx is the request itself being refused — wrong API key, unregistered sender
                // name, malformed number. Retrying resends an identical payload for an identical
                // answer, so stop rather than spend two more sleeps and timeouts of the cron's run.
                // An exhausted balance arrives as a 500 but is just as final, and just as pointless
                // to retry: no amount of waiting puts credits back on the account mid-run.
                if (($httpCode >= 400 && $httpCode < 500) || $this->isAccountLevelFailure($lastError)) {
                    break;
                }

                if ($attempt < $this->maxRetries) {
                    sleep(2);
                }
            } while ($attempt < $this->maxRetries);

            throw new Exception($lastError);

        } catch (Exception $e) {
            Log::error('Semaphore SMS sending failed', [
                'contact_no' => $contactNo,
                'sender_name' => $this->config->sender,
                'attempts' => $attempt,
                'error' => $e->getMessage()
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage(),
                // Signals "stop the run", not "this message failed" — see SmsQueueService.
                'account_blocked' => $this->isAccountLevelFailure($e->getMessage()),
            ];
        }
    }

    /**
     * Is this failure a property of the ACCOUNT rather than of the message?
     *
     * An empty balance or a disabled account refuses every message identically, so there is
     * nothing to be gained by trying the next one — and a great deal to lose: each queue row that
     * is attempted burns one of its three attempts and is then marked failed for good, so a single
     * cron run against a zero-balance gateway can bury an entire day of notifications.
     */
    private function isAccountLevelFailure(string $error): bool
    {
        $error = strtolower($error);

        foreach (['balance', 'insufficient', 'credits', 'not enough'] as $needle) {
            if (str_contains($error, $needle)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Did Semaphore actually accept the message, as opposed to merely answering the request?
     *
     * A successful post returns a list of message objects, each carrying a message_id. A refusal
     * returns a field-keyed validation object under the same 200 status, which is why HTTP code
     * alone cannot be trusted here.
     */
    private function semaphoreAccepted(?string $body): bool
    {
        if ($body === null || trim($body) === '') {
            return false;
        }

        $decoded = json_decode($body, true);

        if (!is_array($decoded)) {
            return false;
        }

        foreach ($decoded as $entry) {
            if (is_array($entry) && isset($entry['message_id'])) {
                return true;
            }
        }

        return isset($decoded['message_id']);
    }

    /**
     * Turn a failed Semaphore response into something a human can act on.
     *
     * The field name in a validation reply is usually the whole diagnosis — "sendername" means an
     * unregistered sender, "apikey" means the wrong credentials — so keys are kept alongside their
     * messages. A genuine 5xx tends to carry an HTML error page instead, which is stripped to a
     * short excerpt rather than dropped, because an empty body and a server fault are different
     * problems and the old message could not tell them apart.
     */
    private function describeHttpFailure(int $httpCode, ?string $body, string $curlError): string
    {
        $status = $httpCode > 0 ? 'HTTP ' . $httpCode : 'no HTTP response';

        if ($curlError !== '') {
            return 'Semaphore API request failed (' . $status . '): ' . $curlError;
        }

        $body = $body === null ? '' : trim($body);

        if ($body === '') {
            return 'Semaphore API returned ' . $status . ' with an empty body';
        }

        $decoded = json_decode($body, true);

        if (is_array($decoded)) {
            $parts = [];
            $flatten = function ($value, string $label) use (&$flatten, &$parts): void {
                if (is_array($value)) {
                    foreach ($value as $key => $item) {
                        $flatten($item, is_string($key) ? $key : $label);
                    }
                    return;
                }

                if (is_scalar($value) && trim((string) $value) !== '') {
                    $parts[] = $label !== '' ? $label . ': ' . $value : (string) $value;
                }
            };
            $flatten($decoded, '');

            if ($parts !== []) {
                return 'Semaphore API returned ' . $status . ' - ' . implode('; ', array_unique($parts));
            }
        }

        $excerpt = trim(preg_replace('/\s+/', ' ', strip_tags($body)));

        return 'Semaphore API returned ' . $status . ' - ' . mb_substr($excerpt, 0, 300);
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
                
                $response = curl_exec($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);

                if ($httpCode >= 200 && $httpCode < 300) {
                    return $response ?: 'Success: SMS Sent';
                }

                if ($attempt < $this->maxRetries) {
                    sleep(2);
                }

            } catch (Exception $e) {
                if ($attempt >= $this->maxRetries) {
                    throw $e;
                }
                sleep(2);
            }

        } while ($attempt < $this->maxRetries);

        throw new Exception('SMS sending failed after ' . $this->maxRetries . ' attempts');
    }

    protected function normalizePhoneNumber(string $contactNo): string
    {
        $contactNo = trim($contactNo);
        
        if (strlen($contactNo) === 10 && substr($contactNo, 0, 1) === '9') {
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

    protected function logSms(string $contactNo, string $message, string $provider, $response = null, array $data = []): void
    {
        try {
            DB::table('sms_logs')->insert([
                'organization_id'    => $this->config->organization_id ?? null,
                'account_no'         => $data['account_no'] ?? null,
                'contact_no'         => $contactNo,
                'message'            => $message,
                'message_length'     => strlen($message),
                'provider'           => $provider,
                'sender_id'          => $this->config->sender ?? null,
                'status'             => 'sent',
                'attempts'           => 1,
                'error_message'      => null,
                'provider_response'  => is_string($response) ? $response : json_encode($response),
                'source'             => $data['source'] ?? null,
                'reference_id'       => $data['reference_id'] ?? null,
                'sent_at'            => now(),
                'created_by_user_id' => auth()->id() ?? null,
                'created_at'         => now(),
                'updated_at'         => now(),
            ]);
        } catch (Exception $e) {
            Log::error('Failed to log SMS', [
                'contact_no' => $contactNo,
                'error'      => $e->getMessage()
            ]);
        }
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
