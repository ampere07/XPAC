<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\PaymentWorkerService;
use App\Services\XenditReconciliationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Exception;
use App\Events\PaymentUpdated;

class XenditPaymentController extends Controller
{
    /** SuperAdmin sees every organization; everyone else is scoped to their own. */
    private const SUPERADMIN_ROLE_ID = 7;

    private $xenditApiKey;
    private $xenditCallbackToken;
    private $portalLink;

    public function __construct()
    {
        $this->xenditApiKey = (string) (config('services.xendit.api_key') ?: env('XENDIT_API_KEY', ''));
        $this->xenditCallbackToken = (string) (config('services.xendit.callback_token') ?: env('XENDIT_CALLBACK_TOKEN', ''));

        // Fallback for production environments where config cache might be returning null
        // and we cannot easily run `php artisan config:clear`
        if (empty($this->xenditApiKey) || empty($this->xenditCallbackToken)) {
            $envPath = base_path('.env');
            if (file_exists($envPath)) {
                $envContent = file_get_contents($envPath);

                if (empty($this->xenditApiKey) && preg_match('/^XENDIT_API_KEY=(.*)$/m', $envContent, $matches)) {
                    $this->xenditApiKey = trim($matches[1], "\"' \t\n\r\0\x0B");
                }

                if (empty($this->xenditCallbackToken) && preg_match('/^XENDIT_CALLBACK_TOKEN=(.*)$/m', $envContent, $matches)) {
                    $this->xenditCallbackToken = trim($matches[1], "\"' \t\n\r\0\x0B");
                }
            }
        }

        $this->portalLink = (string) (config('app.url') ?: env('APP_URL', 'https://sync.atssfiber.ph'));
    }

    public function createPayment(Request $request)
    {
        try {
            // Get account_no from request body (sent by frontend)
            $accountNo = $request->input('account_no');
            $amount = $request->input('amount');
            $frontendRedirectUrl = $request->input('redirect_url');

            if (!$accountNo) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Account number is required'
                ], 422);
            }

            if (!$amount || $amount < 1) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Amount must be at least ₱1.00'
                ], 422);
            }

            $amount = floatval($amount);

            // Get account details from billing_accounts table using username (account_no)
            $account = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                    'billing_accounts.id',
                    'billing_accounts.account_no',
                    'billing_accounts.account_balance',
                    DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as full_name"),
                    'customers.email_address',
                    'customers.contact_number_primary',
                    'customers.desired_plan'
                )
                ->first();

            if (!$account) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Account not found'
                ], 404);
            }

            // Note: Duplicate check now handled by frontend via check-pending endpoint
            // This allows better UX with resume option

            // Generate unique reference number
            $randomSuffix = bin2hex(random_bytes(10));
            $referenceNo = $accountNo . '-' . $randomSuffix;



            // Resolve payer email. Xendit rejects the whole invoice if this is not a
            // well-formed address, so '??' is not enough here: it only catches NULL and
            // lets through empty strings, placeholders like 'N/A', and values with
            // stray whitespace/newlines that look fine in the database.
            $rawEmail = (string) ($account->email_address ?? '');
            // Strip non-breaking spaces and zero-width characters that survive trim()
            $rawEmail = preg_replace('/[\x{00A0}\x{200B}-\x{200D}\x{FEFF}]/u', '', $rawEmail);
            $rawEmail = trim($rawEmail);
            $payerEmail = filter_var($rawEmail, FILTER_VALIDATE_EMAIL) ? $rawEmail : null;

            if (!$payerEmail) {
                Log::warning('Payment: unusable customer email, falling back', [
                    'account_no' => $accountNo,
                    'raw_email' => $account->email_address,
                    'reason' => $rawEmail === '' ? 'empty' : 'malformed'
                ]);
                $payerEmail = 'noreply@atssfiber.ph';
            }

            // Parse customer name. The SQL CONCAT leaves a double space when the
            // middle initial is blank, which yields empty name parts.
            $fullName = trim(preg_replace('/\s+/', ' ', (string) ($account->full_name ?? '')));
            if ($fullName === '') {
                $fullName = 'Customer';
            }
            $fullNameParts = explode(' ', $fullName);
            $surname = (count($fullNameParts) > 1) ? array_pop($fullNameParts) : $fullNameParts[0];
            $givenName = implode(' ', $fullNameParts);
            if (empty($givenName)) {
                $givenName = $surname;
            }

            // Format mobile number
            $mobile = preg_replace('/[^0-9]/', '', $account->contact_number_primary ?? '');
            if (strlen($mobile) === 10) {
                $mobile = '63' . $mobile;
            } elseif (strlen($mobile) === 11 && substr($mobile, 0, 1) === '0') {
                $mobile = '63' . substr($mobile, 1);
            }

            // Only send a mobile number when it is plausible E.164. Sending a bare '+'
            // for a customer with no contact number fails Xendit validation too.
            $customer = [
                'given_names' => $givenName,
                'surname' => $surname,
                'email' => $payerEmail
            ];
            if (strlen($mobile) >= 10 && strlen($mobile) <= 15) {
                $customer['mobile_number'] = '+' . $mobile;
            } else {
                Log::warning('Payment: unusable customer mobile, omitting', [
                    'account_no' => $accountNo,
                    'raw_mobile' => $account->contact_number_primary
                ]);
            }

            // Prepare Xendit payload
            $payload = [
                'external_id' => $referenceNo,
                'amount' => $amount,
                'payer_email' => $payerEmail,
                'description' => "Bill Payment - Account $accountNo",
                'invoice_duration' => 86400,
                'currency' => 'PHP',
                'customer' => $customer,
                'items' => [
                    [
                        'name' => "Account $accountNo - " . ($account->desired_plan ?? 'Internet Service'),
                        'quantity' => 1,
                        'price' => $amount,
                        'category' => 'Internet Service'
                    ]
                ]
            ];

            // Call Xendit API
            $response = Http::withBasicAuth($this->xenditApiKey, '')
                ->timeout(30)
                ->post('https://api.xendit.co/v2/invoices', $payload);

            if (!$response->successful()) {
                $error = $response->json();
                $errorCode = $error['error_code'] ?? '';

                Log::error('Xendit API Error', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                    'account_no' => $accountNo,
                    // Log what we actually sent so validation failures are diagnosable
                    'sent_payer_email' => $payerEmail,
                    'sent_customer' => $customer
                ]);

                // A 400 here is our payload's fault, not an outage. Say so rather than
                // blaming the gateway and telling the customer to retry a call that
                // will fail identically every time.
                if ($response->status() === 400 || $errorCode === 'API_VALIDATION_ERROR') {
                    return response()->json([
                        'status' => 'error',
                        'message' => 'We could not create your payment because your account details are incomplete or invalid. Please contact support to update your contact information.'
                    ], 422);
                }

                return response()->json([
                    'status' => 'error',
                    'message' => 'Payment gateway unavailable. Please try again later.'
                ], 500);
            }

            $xenditResponse = $response->json();
            $paymentId = $xenditResponse['id'] ?? null;
            $paymentUrl = $xenditResponse['invoice_url'] ?? null;

            if (!$paymentId || !$paymentUrl) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Invalid response from payment gateway'
                ], 500);
            }

            // Store payment in pending_payments table
            $paymentRow = [
                'account_no' => $accountNo,
                'reference_no' => $referenceNo,
                'amount' => $amount,
                'status' => 'PENDING',
                'payment_date' => now(),
                'provider' => 'XENDIT',
                'plan' => $account->desired_plan ?? '',
                'payment_id' => $paymentId,
                'payment_method_id' => null,
                'json_payload' => json_encode($payload),
                'payment_url' => $paymentUrl,
                'callback_payload' => null,
                'reconnect_status' => null,
                'last_attempt_at' => null,
                'updated_at' => now()
            ];

            // Seed the reconciliation ladder when the columns exist. If the webhook
            // arrives first it moves this row off PENDING and the audit never flags it;
            // if it does not, the row carries the currency and attempt counter the
            // Xendit Reconciliation tool needs to verify it against the gateway.
            if (Schema::hasColumn('pending_payments', 'currency')) {
                $paymentRow['currency'] = $payload['currency'] ?? 'PHP';
                $paymentRow['reconciliation_attempts'] = 0;
                $paymentRow['next_reconciliation_at'] = now()->addMinutes(2);
            }

            DB::table('pending_payments')->insert($paymentRow);

            Log::info('Payment created successfully', [
                'reference_no' => $referenceNo,
                'account_no' => $accountNo,
                'amount' => $amount,
                'payment_id' => $paymentId
            ]);

            event(new PaymentUpdated(['action' => 'created', 'reference_no' => $referenceNo, 'account_no' => $accountNo, 'amount' => $amount]));

            return response()->json([
                'status' => 'success',
                'reference_no' => $referenceNo,
                'payment_url' => $paymentUrl,
                'payment_id' => $paymentId,
                'amount' => $amount,
                'account_balance' => floatval($account->account_balance)
            ]);

        } catch (Exception $e) {
            Log::error('Payment creation failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'An error occurred while creating payment'
            ], 500);
        }
    }

    public function handleWebhook(Request $request)
    {
        // Get callback token from request
        $incomingToken = '';

        // Try multiple methods to get the token
        $incomingToken = $request->header('X-Callback-Token');

        if (empty($incomingToken) && isset($_SERVER['HTTP_X_CALLBACK_TOKEN'])) {
            $incomingToken = $_SERVER['HTTP_X_CALLBACK_TOKEN'];
        }

        if (empty($incomingToken)) {
            $headers = array_change_key_case($request->headers->all(), CASE_LOWER);
            $incomingToken = $headers['x-callback-token'][0] ?? '';
        }

        // Enhanced logging for debugging
        Log::info('Xendit Webhook Received', [
            'incoming_token' => $incomingToken,
            'incoming_token_length' => strlen($incomingToken),
            'configured_token' => $this->xenditCallbackToken,
            'configured_token_length' => strlen($this->xenditCallbackToken ?? ''),
            'tokens_match' => $incomingToken === $this->xenditCallbackToken,
            'ip_address' => $request->ip(),
            'request_method' => $request->method(),
            'request_uri' => $request->getRequestUri()
        ]);

        // Validate callback token
        if ($this->xenditCallbackToken && $incomingToken !== $this->xenditCallbackToken) {
            Log::warning('Xendit Webhook: Invalid Token', [
                'incoming_token' => substr($incomingToken, 0, 10) . '...',
                'expected_token' => substr($this->xenditCallbackToken, 0, 10) . '...',
                'ip' => $request->ip()
            ]);
            return response('Forbidden', 403);
        }

        // Process webhook asynchronously if possible
        if (function_exists('fastcgi_finish_request')) {
            response()->json(['message' => 'OK'], 200)->send();
            fastcgi_finish_request();
        }

        try {
            $payload = $request->all();
            $rawPayload = json_encode($payload);

            $ref = $payload['external_id'] ?? $payload['requestReferenceNumber'] ?? '';
            $status = strtoupper($payload['status'] ?? '');

            if (!$ref) {
                Log::info('Xendit Webhook: No reference number in payload');
                return response()->json(['message' => 'OK'], 200);
            }

            Log::info('Xendit Webhook: Processing Payment', [
                'reference_no' => $ref,
                'status' => $status,
                'payload' => $payload
            ]);

            // Determine new status
            $newStatus = 'PENDING';
            $isPaid = false;

            if (in_array($status, ['PAID', 'COMPLETED', 'SETTLED'])) {
                $isPaid = true;
            }
            if ($status === 'PAYMENT_SUCCESS') {
                $isPaid = true;
            }

            if ($isPaid) {
                $newStatus = 'QUEUED';
            } elseif ($status === 'EXPIRED') {
                $newStatus = 'EXPIRED';
            } elseif (in_array($status, ['FAILED', 'PAYMENT_FAILED'])) {
                $newStatus = 'FAILED';
            }

            // Update payment status
            if ($newStatus !== 'PENDING') {
                $rowsUpdated = DB::table('pending_payments')
                    ->where('reference_no', $ref)
                    ->where('status', '!=', 'PAID')
                    ->update([
                        'status' => $newStatus,
                        'callback_payload' => $rawPayload,
                        'updated_at' => now()
                    ]);

                if ($rowsUpdated > 0) {
                    Log::info('Xendit Webhook: Payment Updated', [
                        'reference_no' => $ref,
                        'new_status' => $newStatus
                    ]);

                    event(new PaymentUpdated(['action' => 'webhook_update', 'reference_no' => $ref, 'status' => $newStatus]));
                } else {
                    Log::info('Xendit Webhook: No Update Needed', [
                        'reference_no' => $ref,
                        'reason' => 'Already processed or not found'
                    ]);
                }
            }

            return response()->json(['message' => 'OK'], 200);

        } catch (Exception $e) {
            Log::error('Xendit Webhook: Processing Error', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json(['message' => 'OK'], 200);
        }
    }

    public function checkPendingPayment(Request $request)
    {
        try {
            $accountNo = $request->input('account_no');

            if (!$accountNo) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Account number is required'
                ], 400);
            }

            // Cleanup old pending payments (older than 24 hours) to 'EXPIRED'
            DB::table('pending_payments')
                ->where('status', 'PENDING')
                ->where('payment_date', '<', now()->subHours(24))
                ->update(['status' => 'EXPIRED', 'updated_at' => now()]);

            // Check for pending payments within the last 24 hours (matching Xendit invoice duration)
            $pendingPayment = DB::table('pending_payments')
                ->where('account_no', $accountNo)
                ->where('status', 'PENDING')
                ->where('payment_date', '>', now()->subHours(24))
                ->orderBy('payment_date', 'desc')
                ->first();

            if ($pendingPayment) {
                Log::info('Pending payment found', [
                    'account_no' => $accountNo,
                    'reference_no' => $pendingPayment->reference_no,
                    'amount' => $pendingPayment->amount
                ]);

                return response()->json([
                    'status' => 'success',
                    'pending_payment' => [
                        'reference_no' => $pendingPayment->reference_no,
                        'amount' => floatval($pendingPayment->amount),
                        'status' => $pendingPayment->status,
                        'payment_date' => $pendingPayment->payment_date,
                        'payment_url' => $pendingPayment->payment_url
                    ]
                ]);
            }

            return response()->json([
                'status' => 'success',
                'pending_payment' => null
            ]);

        } catch (Exception $e) {
            Log::error('Check pending payment failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Failed to check pending payment'
            ], 500);
        }
    }

    public function checkPaymentStatus(Request $request)
    {
        try {
            $referenceNo = $request->input('reference_no');

            if (!$referenceNo) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Reference number is required'
                ], 400);
            }

            $payment = DB::table('pending_payments')
                ->where('reference_no', $referenceNo)
                ->first();

            if (!$payment) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Payment not found'
                ], 404);
            }

            return response()->json([
                'status' => 'success',
                'payment' => [
                    'reference_no' => $payment->reference_no,
                    'amount' => $payment->amount,
                    'status' => $payment->status,
                    'payment_date' => $payment->payment_date
                ]
            ]);

        } catch (Exception $e) {
            Log::error('Payment status check failed', [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Failed to check payment status'
            ], 500);
        }
    }

    public function getAccountBalance(Request $request)
    {
        try {
            $accountNo = $request->input('account_no');

            if (!$accountNo) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Account number is required'
                ], 400);
            }

            // Get account balance from billing_accounts table
            $account = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->select('account_balance')
                ->first();

            if (!$account) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Account not found'
                ], 404);
            }

            return response()->json([
                'status' => 'success',
                'account_balance' => floatval($account->account_balance)
            ]);

        } catch (Exception $e) {
            Log::error('Get account balance failed', [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Failed to get account balance'
            ], 500);
        }
    }

    public function cancelPayment(Request $request)
    {
        try {
            $referenceNo = $request->input('reference_no');

            if (!$referenceNo) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Reference number is required'
                ], 400);
            }

            $updated = DB::table('pending_payments')
                ->where('reference_no', $referenceNo)
                ->where('status', 'PENDING')
                ->update([
                    'status' => 'FAILED',
                    'updated_at' => now()
                ]);

            if ($updated) {
                Log::info('Pending payment cancelled (status set to FAILED)', [
                    'reference_no' => $referenceNo
                ]);
                return response()->json([
                    'status' => 'success',
                    'message' => 'Payment cancelled successfully'
                ]);
            }

            return response()->json([
                'status' => 'error',
                'message' => 'Pending payment not found or already processed'
            ], 404);

        } catch (Exception $e) {
            Log::error('Cancel payment failed', [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Failed to cancel payment'
            ], 500);
        }
    }

    // =====================================================================
    // Reconciliation tool — Sanctum-guarded operator surface
    //
    // The public payment endpoints above are what a subscriber's checkout
    // hits. Everything below is the staff-facing reconciliation screen and
    // sits behind auth:sanctum in routes/api.php. All of it validates and
    // delegates; the rules live in XenditReconciliationService.
    // =====================================================================

    /**
     * GET /api/xendit-reconciliation/audit
     */
    public function reconciliationAudit(Request $request, XenditReconciliationService $service)
    {
        $validated = $request->validate([
            'filter'   => ['nullable', 'string', 'in:' . implode(',', array_keys(XenditReconciliationService::FILTER_STATUSES))],
            'search'   => ['nullable', 'string', 'max:191'],
            'days'     => ['nullable', 'integer', 'min:1', 'max:365'],
            'page'     => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:10', 'max:200'],
        ]);

        return response()->json([
            'success' => true,
            'data'    => $service->getAuditList($validated, $this->reconciliationOrganizationId($request)),
        ]);
    }

    /**
     * POST /api/xendit-reconciliation/verify
     *
     * Live lookup against Xendit. Confirmed payments are moved to QUEUED for the
     * payment worker — this endpoint never posts one itself.
     */
    public function reconciliationVerify(Request $request, XenditReconciliationService $service)
    {
        $validated = $request->validate([
            'id' => ['required', 'integer', 'min:1'],
        ]);

        $result = $service->verifyPayment($validated['id'], $this->reconciliationOrganizationId($request));

        return response()->json($result, $result['success'] ? 200 : 422);
    }

    /**
     * POST /api/xendit-reconciliation/force-post
     *
     * Posts a gateway-confirmed but unposted payment through the payment worker's
     * own claim-and-post path, so balance, invoice settlement and receipt all run
     * exactly once.
     */
    public function reconciliationForcePost(
        Request $request,
        XenditReconciliationService $service,
        PaymentWorkerService $worker
    ) {
        $validated = $request->validate([
            'id' => ['required', 'integer', 'min:1'],
        ]);

        $result = $service->forcePost($validated['id'], $worker, $this->reconciliationOrganizationId($request));

        return response()->json($result, $result['success'] ? 200 : 422);
    }

    /**
     * POST /api/xendit-reconciliation/mark-expired
     */
    public function reconciliationMarkExpired(Request $request, XenditReconciliationService $service)
    {
        $validated = $request->validate([
            'id'     => ['required', 'integer', 'min:1'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);

        $result = $service->markExpired(
            $validated['id'],
            $validated['reason'] ?? null,
            $this->reconciliationOrganizationId($request)
        );

        return response()->json($result, $result['success'] ? 200 : 422);
    }

    /**
     * The organization a reconciliation request is confined to, or null for
     * SuperAdmin. Mirrors the scoping the other two tool controllers apply.
     */
    private function reconciliationOrganizationId(Request $request): ?int
    {
        $user = $request->user();

        if ($user === null || (int) ($user->role_id ?? 0) === self::SUPERADMIN_ROLE_ID) {
            return null;
        }

        return $user->organization_id !== null ? (int) $user->organization_id : null;
    }
}
