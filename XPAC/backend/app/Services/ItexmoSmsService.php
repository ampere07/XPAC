<?php

namespace App\Services;

use App\Models\SmsConfig;
use Exception;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ItexmoSmsService
{
    protected ?SmsConfig $config;
    protected string $apiUrl = 'https://api.itexmo.com/api/broadcast';
    protected int $maxRetries = 3;
    protected int $timeoutSeconds = 30;

    /**
     * What iTexMo's numeric status codes actually mean.
     *
     * The gateway answers a refusal with a bare number and HTTP 200, which the transport reads as
     * a success. That is why a wrong ApiCode or an empty balance used to surface as "SMS sending
     * failed after 3 attempts" — a message that describes the retry loop, says nothing about the
     * problem, and sends whoever is on call looking at the network instead of the iTexMo account.
     * Translating the code here is what puts the real reason in laravel.log, in
     * sms_logs.error_message, and in the failure the operator is shown.
     */
    protected const ITEXMO_ERRORS = [
        '1' => 'Invalid ApiCode/Credentials',
        '2' => 'No SMS Balance',
        '3' => 'Invalid Recipient',
        '4' => 'Sender Id not Yet Registered',
        '5' => 'Message contains Filtered Words',
        '6' => 'SMS API is Under Maintenance',
        '7' => 'Account Blocked',
        '8' => 'Invalid Target Gateway',
    ];

    /**
     * The only refusal worth trying again.
     *
     * Maintenance ends on its own. Everything else in the table is a standing fact about the
     * account, the sender id, or the message — an empty balance is still empty two seconds later —
     * so retrying costs three provider round trips per recipient and buries the reason under a
     * retry count. Now that a blast runs through the queue, that waste is multiplied by every
     * subscriber in the batch.
     */
    protected const ITEXMO_RETRYABLE_ERRORS = ['6'];

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

        // Normalised before comparing: the column is free text, and a config saved as 'Semaphore'
        // fell through to the iTexMo branch and was sent with credentials the other gateway does
        // not recognise.
        $provider = strtolower(trim((string) ($this->config->provider ?? 'itexmo')));

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

        } catch (\Throwable $e) {
            // \Throwable, not Exception: a TypeError raised while building the request would
            // otherwise escape past the queue worker and abandon the rest of the batch, unsent and
            // unrecorded, because of one malformed row.
            Log::error('SMS sending failed', [
                'contact_no'   => $contactNo,
                'account_no'   => $data['account_no'] ?? null,
                'source'       => $data['source'] ?? null,
                'reference_id' => $data['reference_id'] ?? null,
                'provider'     => 'itexmo',
                'sender_id'    => $this->config->sender ?? null,
                'error'        => $e->getMessage(),
            ]);

            $this->logSms($contactNo, $message, 'itexmo', null, $data, 'failed', $e->getMessage());

            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    protected function sendSemaphore(string $contactNo, string $message, array $data = []): array
    {
        $payload = [
            'apikey' => $this->config->code,
            'number' => $contactNo,
            'message' => $message,
            'sendername' => $this->config->sender
        ];

        try {
            $apiUrl = 'https://api.semaphore.co/api/v4/messages';
            $attempt = 0;
            $response = null;
            $httpCode = 0;

            do {
                $attempt++;
                try {
                    $ch = curl_init();
                    curl_setopt($ch, CURLOPT_URL, $apiUrl);
                    curl_setopt($ch, CURLOPT_POST, 1);
                    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($payload));
                    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                    curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeoutSeconds);
                    
                    $response = curl_exec($ch);
                    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                    curl_close($ch);

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

                    // Check for specific error message in response
                    if ($response) {
                        $responseData = json_decode($response, true);
                        if (is_array($responseData) && isset($responseData['error'])) {
                            throw new Exception($responseData['error']);
                        }
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

            // The body, not just the status: Semaphore explains itself there, and a bare
            // "HTTP 422" is no more actionable than the retry count iTexMo used to report.
            throw new Exception(
                'Semaphore API returned HTTP ' . ($httpCode ?: 'unknown')
                . (is_string($response) && trim($response) !== '' ? ': ' . trim($response) : '')
            );

        } catch (\Throwable $e) {
            Log::error('Semaphore SMS sending failed', [
                'contact_no'   => $contactNo,
                'account_no'   => $data['account_no'] ?? null,
                'source'       => $data['source'] ?? null,
                'reference_id' => $data['reference_id'] ?? null,
                'provider'     => 'semaphore',
                'sender_id'    => $this->config->sender ?? null,
                'error'        => $e->getMessage(),
            ]);

            $this->logSms($contactNo, $message, 'semaphore', null, $data, 'failed', $e->getMessage());

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

    /**
     * POST one message, retrying only what a retry can fix.
     *
     * Three outcomes have to be told apart, and the old loop collapsed all of them into
     * "failed after 3 attempts":
     *
     *   - nothing came back (DNS, TLS, timeout) — transient, try again;
     *   - a non-2xx — the gateway is unwell, try again;
     *   - a 2xx carrying an iTexMo error code — the gateway answered perfectly well and REFUSED.
     *     Retrying that is pure waste: the balance is still empty, the ApiCode is still wrong. It
     *     is reported by name and given up on immediately.
     *
     * There is no inner try/catch any more. The curl_* functions signal failure by return value and
     * never by throwing, so the old handler could only ever swallow a programming error — and then
     * retry it twice more.
     *
     * @throws Exception carrying the gateway's reason in plain words
     */
    protected function sendWithRetry(array $payload): string
    {
        $attempt = 0;
        $lastError = 'No response from the SMS gateway';

        do {
            $attempt++;

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $this->apiUrl);
            curl_setopt($ch, CURLOPT_POST, 1);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeoutSeconds);

            $response  = curl_exec($ch);
            $httpCode  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError = (string) curl_error($ch);
            curl_close($ch);

            if ($response === false) {
                $lastError = $curlError !== ''
                    ? "SMS gateway unreachable: {$curlError}"
                    : 'SMS gateway unreachable';

                Log::warning('iTexMo request did not complete', [
                    'attempt'    => $attempt,
                    'curl_error' => $curlError,
                ]);
            } else {
                $body = trim((string) $response);
                $code = $this->itexmoStatusCode($body);

                if ($httpCode >= 200 && $httpCode < 300 && ($code === null || $code === '0')) {
                    return $body !== '' ? $body : 'Success: SMS Sent';
                }

                if ($code !== null && $code !== '0') {
                    $lastError = self::ITEXMO_ERRORS[$code] ?? "Unrecognised iTexMo error code {$code}";

                    if (!in_array($code, self::ITEXMO_RETRYABLE_ERRORS, true)) {
                        Log::error('iTexMo refused the message', [
                            'itexmo_code' => $code,
                            'reason'      => $lastError,
                            'http_code'   => $httpCode,
                            'attempt'     => $attempt,
                            'sender_id'   => $this->config->sender ?? null,
                        ]);

                        // Thrown verbatim, so this is the text that reaches laravel.log and
                        // sms_logs.error_message — not a retry count.
                        throw new Exception($lastError);
                    }

                    Log::warning('iTexMo returned a retryable error', [
                        'itexmo_code' => $code,
                        'reason'      => $lastError,
                        'attempt'     => $attempt,
                    ]);
                } else {
                    $lastError = "SMS gateway returned HTTP {$httpCode}"
                        . ($body !== '' ? ": {$body}" : '');

                    Log::warning('iTexMo returned a non-success HTTP status', [
                        'http_code' => $httpCode,
                        'body'      => $body,
                        'attempt'   => $attempt,
                    ]);
                }
            }

            if ($attempt < $this->maxRetries) {
                sleep(2);
            }

        } while ($attempt < $this->maxRetries);

        throw new Exception(
            "SMS sending failed after {$this->maxRetries} attempts. Last error: {$lastError}"
        );
    }

    /**
     * The iTexMo status code in a response body, or null when there is not one.
     *
     * The classic endpoint answers a bare number; the broadcast endpoint answers JSON. Only a bare
     * numeric body and an explicit `Error` member are read as status codes — a successful broadcast
     * response carries other numeric members (recipient counts, an echoed HTTP status), and reading
     * one of those as a status would fail a message that was in fact accepted.
     */
    private function itexmoStatusCode(string $body): ?string
    {
        if ($body === '') {
            return null;
        }

        if (is_numeric($body)) {
            return (string) (int) $body;
        }

        $decoded = json_decode($body, true);

        if (is_array($decoded)) {
            foreach (['Error', 'error'] as $key) {
                if (isset($decoded[$key]) && is_numeric($decoded[$key])) {
                    return (string) (int) $decoded[$key];
                }
            }
        }

        return null;
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

    /**
     * One row per send attempt, successful or not. A failed attempt is worth as
     * much as a sent one to whoever is asked why a subscriber never got their
     * notice, and sms_logs.status has always had a 'failed' value for it.
     *
     * $data may carry 'raw_message' — the message as it was composed, before
     * variables were replaced. Only written when the column exists, so this
     * keeps working on a database that has not run the migration that adds it.
     */
    protected function logSms(
        string $contactNo,
        string $message,
        string $provider,
        $response = null,
        array $data = [],
        string $status = 'sent',
        ?string $error = null
    ): void {
        try {
            $row = [
                'organization_id'    => $this->config->organization_id ?? null,
                'account_no'         => $data['account_no'] ?? null,
                'contact_no'         => $contactNo,
                'message'            => $message,
                'message_length'     => strlen($message),
                'provider'           => $provider,
                'sender_id'          => $this->config->sender ?? null,
                'status'             => $status,
                'attempts'           => 1,
                'error_message'      => $error,
                // A failed attempt has no provider response; encoding it would
                // store the string "null" instead of leaving the column empty.
                'provider_response'  => is_string($response)
                    ? $response
                    : ($response === null ? null : json_encode($response)),
                'source'             => $data['source'] ?? null,
                'reference_id'       => $data['reference_id'] ?? null,
                'sent_at'            => $status === 'sent' ? now() : null,
                'created_by_user_id' => auth()->id() ?? null,
                'created_at'         => now(),
                'updated_at'         => now(),
            ];

            $composed = $data['raw_message'] ?? null;
            if (!empty($composed) && $composed !== $message && Schema::hasColumn('sms_logs', 'raw_message')) {
                $row['raw_message'] = $composed;
            }

            DB::table('sms_logs')->insert($row);
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
