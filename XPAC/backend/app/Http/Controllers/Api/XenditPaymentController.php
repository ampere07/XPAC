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
use App\Models\AppPlan;
use App\Models\BillingAccount;
use App\Services\EnhancedBillingGenerationServiceWithNotifications;

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

    /**
     * Convenience fee percentage from the billing configuration.
     *
     * Returns 0 when the fee is unset, null, zero or negative, so no charge is added.
     * The column is checked for existence first: a deployment that has not yet had the
     * column added must keep taking payments rather than failing at the payload step.
     */
    private function getConvenienceFeePercentage(): float
    {
        try {
            if (!Schema::hasTable('billing_config')
                || !Schema::hasColumn('billing_config', 'convenience_fee_percentage')) {
                return 0.0;
            }

            $percentage = DB::table('billing_config')->value('convenience_fee_percentage');
            if ($percentage === null) {
                return 0.0;
            }

            $percentage = floatval($percentage);
            if ($percentage <= 0) {
                return 0.0;
            }

            // Guard against a bad stored value producing an absurd charge.
            return min($percentage, 100.0);
        } catch (Exception $e) {
            Log::warning('Could not read convenience fee percentage; charging without it', [
                'error' => $e->getMessage()
            ]);
            return 0.0;
        }
    }

    /**
     * Read-only: the convenience fee rate, for disclosing it on a payment screen.
     *
     * Exposes only this one figure rather than the whole billing config — a customer-facing
     * screen has no business reading disconnection fees or cut-off days.
     */
    public function getConvenienceFee()
    {
        return response()->json([
            'status' => 'success',
            'convenience_fee_percentage' => $this->getConvenienceFeePercentage(),
        ]);
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

            // Convenience fee is charged on top of the bill. $amount stays the amount that
            // settles the customer's invoices; $chargeAmount is what Xendit collects.
            $convenienceFeePercentage = $this->getConvenienceFeePercentage();
            $convenienceFee = round($amount * ($convenienceFeePercentage / 100), 2);
            $chargeAmount = round($amount + $convenienceFee, 2);

            // Get account details from billing_accounts table using username (account_no)
            $account = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                    'billing_accounts.id',
                    'billing_accounts.account_no',
                    'billing_accounts.account_balance',
                    'billing_accounts.generation_type',
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

            /*
             * Prepaid checkout options, carried on the pending_payments row until the Xendit
             * webhook settles it — which can be minutes or hours later, long after this request
             * has gone. PaymentWorkerService reads both back at that point and hands them to
             * PrepaidPlanChangeService::settlePayment().
             *
             *   selected_plan_id  the plan this payment buys.
             *   activate_now      start it immediately, forfeiting the days left on the current
             *                     plan, instead of queueing the switch for the period boundary.
             *
             * Both are ignored for postpaid: a postpaid payment settles invoices and never
             * changes plan, so honouring them would be acting on a request the rest of the
             * pipeline has no path for.
             */
            $isPrepaid = BillingAccount::isPrepaidType($account->generation_type ?? null);
            $selectedPlanId = null;
            $activateNow = false;

            if ($isPrepaid) {
                $requestedPlanId = $request->input('plan_id');

                // Validated against plan_list rather than trusted: this value later drives a
                // RADIUS bandwidth profile, and an unknown id would leave the switch half-done.
                if (filled($requestedPlanId) && is_numeric($requestedPlanId) && AppPlan::find((int) $requestedPlanId)) {
                    $selectedPlanId = (int) $requestedPlanId;
                } elseif (filled($requestedPlanId)) {
                    Log::warning('Payment: unknown plan_id at checkout, ignoring plan change', [
                        'account_no' => $accountNo,
                        'plan_id' => $requestedPlanId,
                    ]);
                }

                // Only meaningful alongside a plan. settlePayment() independently refuses to
                // forfeit days when the "switch" is to the plan already in force, so this is the
                // outer of two guards, not the only one.
                $activateNow = $selectedPlanId !== null && $request->boolean('activate_now');
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

            // Prepare Xendit payload. The gateway collects the bill plus the convenience fee.
            $items = [
                [
                    'name' => "Account $accountNo - " . ($account->desired_plan ?? 'Internet Service'),
                    'quantity' => 1,
                    'price' => $amount,
                    'category' => 'Internet Service'
                ]
            ];

            // Itemise the fee so the customer sees why the total is above their bill, and so
            // the item prices still add up to the invoice amount.
            if ($convenienceFee > 0) {
                $items[] = [
                    'name' => 'Convenience Fee (' . rtrim(rtrim(number_format($convenienceFeePercentage, 2), '0'), '.') . '%)',
                    'quantity' => 1,
                    'price' => $convenienceFee,
                    'category' => 'Service Fee'
                ];
            }

            $payload = [
                'external_id' => $referenceNo,
                'amount' => $chargeAmount,
                'payer_email' => $payerEmail,
                'description' => "Bill Payment - Account $accountNo",
                'invoice_duration' => 86400,
                'currency' => 'PHP',
                'customer' => $customer,
                'items' => $items
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

            // Store payment in pending_payments table.
            //
            // `amount` is the GROSS the gateway collects (bill + fee) so the row reflects what the
            // customer actually pays. PaymentWorkerService subtracts `convenience_fee` again to get
            // back to the amount that settles invoices. The rate is frozen here rather than re-read
            // at settlement, so changing the config later never re-writes an old payment.
            $paymentRow = [
                'account_no' => $accountNo,
                'reference_no' => $referenceNo,
                'amount' => $chargeAmount,
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

            // Same reasoning as getConvenienceFeePercentage(): a deployment that has not run the
            // migration yet must still be able to take payments. Without the columns the row keeps
            // the historical net-amount meaning, which is exactly how the worker reads a NULL fee.
            if (Schema::hasColumn('pending_payments', 'convenience_fee')) {
                $paymentRow['convenience_fee'] = $convenienceFee;
                $paymentRow['convenience_fee_percentage'] = $convenienceFeePercentage;
            } else {
                $paymentRow['amount'] = $amount;
            }

            // Column-guarded for the same reason: on a deployment that has not run
            // 2026_07_25_000001 / 2026_08_03_000003 the payment still goes through, it just
            // settles without the plan change — which is the pre-feature behaviour, not a failure.
            if (Schema::hasColumn('pending_payments', 'selected_plan_id')) {
                $paymentRow['selected_plan_id'] = $selectedPlanId;
            }

            if (Schema::hasColumn('pending_payments', 'activate_now')) {
                $paymentRow['activate_now'] = $activateNow;
            }

            DB::table('pending_payments')->insert($paymentRow);

            Log::info('Payment created successfully', [
                'reference_no' => $referenceNo,
                'account_no' => $accountNo,
                'amount' => $amount,
                'convenience_fee_percentage' => $convenienceFeePercentage,
                'convenience_fee' => $convenienceFee,
                'charged_amount' => $chargeAmount,
                'payment_id' => $paymentId,
                // The prepaid intent recorded on the row, so a plan change that fails to
                // materialise at settlement can be traced back to what was actually asked for.
                'selected_plan_id' => $selectedPlanId,
                'activate_now' => $activateNow,
            ]);

            event(new PaymentUpdated(['action' => 'created', 'reference_no' => $referenceNo, 'account_no' => $accountNo, 'amount' => $amount]));

            return response()->json([
                'status' => 'success',
                'reference_no' => $referenceNo,
                'payment_url' => $paymentUrl,
                'payment_id' => $paymentId,
                // Unchanged: the amount that will be applied to the customer's invoices.
                'amount' => $amount,
                // Additive breakdown so a caller can show what is actually being charged.
                'convenience_fee_percentage' => $convenienceFeePercentage,
                'convenience_fee' => $convenienceFee,
                'total_charged' => $chargeAmount,
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
                        // Gross: what the gateway will collect, convenience fee included. This is
                        // the figure to show on a "resume this payment" prompt.
                        'amount' => floatval($pendingPayment->amount),
                        'convenience_fee' => isset($pendingPayment->convenience_fee)
                            ? floatval($pendingPayment->convenience_fee)
                            : 0.0,
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

    /**
     * Read-only: what the unpaid prepaid ONBOARDING bill would come to under a different plan.
     *
     * A customer who has not paid their first bill yet may still change their mind about the plan,
     * which re-prices that same bill. Quoting it here lets the payment screen show the real figure
     * before they commit, while the VAT/withholding maths stays in the billing service — the
     * client must never reimplement it.
     *
     * Nothing is written: this calls the same re-price routine the settlement path would, with
     * persist disabled. Any account outside that never-paid window comes back eligible:false on a
     * 200, and the caller keeps whatever amount it already had.
     */
    public function quotePlanChange(Request $request)
    {
        try {
            $accountNo = $request->input('account_no');
            $planId = $request->input('plan_id');

            if (!$accountNo) {
                return response()->json([
                    'status' => 'error',
                    'eligible' => false,
                    'message' => 'Account number is required'
                ], 422);
            }

            if (!$planId || !is_numeric($planId)) {
                return response()->json([
                    'status' => 'error',
                    'eligible' => false,
                    'message' => 'A plan is required'
                ], 422);
            }

            $account = BillingAccount::where('account_no', $accountNo)->first();

            if (!$account) {
                return response()->json([
                    'status' => 'error',
                    'eligible' => false,
                    'message' => 'Account not found'
                ], 404);
            }

            $plan = AppPlan::find((int) $planId);

            if (!$plan) {
                return response()->json([
                    'status' => 'error',
                    'eligible' => false,
                    'message' => 'Plan not found'
                ], 404);
            }

            // persist: false — this is a quote, so no invoice or balance is touched. The user id
            // only fills the audit columns on the write path, hence 0 here.
            $quote = app(EnhancedBillingGenerationServiceWithNotifications::class)
                ->repricePrepaidInitialBillForPlan($account, $plan, 0, false);

            if (empty($quote['revised'])) {
                return response()->json([
                    'status' => 'success',
                    'eligible' => false,
                    'reason' => $quote['reason'] ?? null
                ]);
            }

            return response()->json([
                'status' => 'success',
                'eligible' => true,
                'reason' => null,
                'plan' => $quote['plan'] ?? $plan->plan_name,
                'plan_amount' => $quote['plan_amount'],
                'vat' => $quote['vat'],
                'withholding' => $quote['withholding'],
                // The balance the account would carry once re-priced — i.e. what settles it in
                // full. Taken from the balance rather than the invoice total so anything already
                // sitting on the account unrelated to this bill is still covered by the quote.
                'amount' => $quote['new_balance'],
                'previous_amount' => $quote['previous_balance']
            ]);

        } catch (Exception $e) {
            Log::error('Plan change quote failed', [
                'account_no' => $request->input('account_no'),
                'plan_id' => $request->input('plan_id'),
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'eligible' => false,
                'message' => 'Failed to quote plan change'
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
