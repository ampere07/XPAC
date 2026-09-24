<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Exception;
use App\Services\RadiusQueueService;

class PaymentWorkerService
{
    private $lockName = 'payment_worker';
    private $lockTimeout = 300; // 5 minutes max execution time
    private $hasLock = false;
    private $radiusReconnectionService;
    private $manualRadiusService;

    public function __construct()
    {
        $this->radiusReconnectionService = new RadiusReconnectionService();
        $this->manualRadiusService = new ManualRadiusOperationsService();
    }

    /**
     * Main worker function - processes queued payments
     */
    public function processPayments()
    {
        $this->workerLog('===========================================');
        $this->workerLog('Payment Worker Started: ' . now()->format('Y-m-d H:i:s'));
        $this->workerLog('===========================================');

        if (!$this->acquireLock()) {
            $this->workerLog('Another worker is already running. Exiting.');
            $this->workerLog('===========================================');
            return false;
        }

        try {
            $this->workerLog('Checking for payments to process...');

            $payments = DB::table('pending_payments')
                ->where('status', 'QUEUED')
                ->orWhere(function ($query) {
                    $query->where('status', 'PENDING')
                        ->whereNotNull('callback_payload')
                        ->where(function ($q) {
                            $q->where('callback_payload', 'LIKE', '%PAID%')
                                ->orWhere('callback_payload', 'LIKE', '%PAYMENT_SUCCESS%');
                        });
                })
                // FAILED rows (e.g. customer-cancelled) are only reprocessed once a
                // payment callback arrives. FAILED rows with no payload are ignored.
                // Restricted to paid-looking payloads so genuinely-failed webhook
                // payloads (status FAILED/PAYMENT_FAILED) don't get reprocessed every run.
                ->orWhere(function ($query) {
                    $query->where('status', 'FAILED')
                        ->whereNotNull('callback_payload')
                        ->where('callback_payload', '!=', '')
                        ->where(function ($q) {
                            $q->where('callback_payload', 'LIKE', '%PAID%')
                                ->orWhere('callback_payload', 'LIKE', '%PAYMENT_SUCCESS%');
                        });
                })
                ->limit(20)
                ->get();

            if ($payments->isEmpty()) {
                $this->workerLog('No payments to process');
                $this->workerLog('===========================================');
                $this->workerLog('Payment Worker Completed: ' . now()->format('Y-m-d H:i:s'));
                $this->workerLog('===========================================');
                return true;
            }

            $this->workerLog("Found {$payments->count()} transactions to process");

            foreach ($payments as $payment) {
                $this->processPayment($payment);
            }

            $this->workerLog('===========================================');
            $this->workerLog('Payment Worker Completed: ' . now()->format('Y-m-d H:i:s'));
            $this->workerLog('===========================================');
            return true;

        } catch (Exception $e) {
            $this->workerLog('Worker Error: ' . $e->getMessage());
            Log::error('Payment Worker Exception', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            $this->workerLog('===========================================');
            return false;
        } finally {
            $this->releaseLock();
        }
    }

    /**
     * Process individual payment
     */
    private function processPayment($payment)
    {
        DB::beginTransaction();

        try {
            $id = $payment->id;
            $ref = $payment->reference_no;
            $accountNo = $payment->account_no;
            $rawPayload = $payment->callback_payload;

            // Validate payment status from callback
            if ($rawPayload) {
                $json = json_decode($rawPayload, true);
                $gwStatus = strtoupper($json['status'] ?? '');

                $isLegitPaid = in_array($gwStatus, ['PAID', 'COMPLETED', 'SETTLED', 'PAYMENT_SUCCESS']);

                if (!$isLegitPaid) {
                    $this->workerLog("AUDIT FAIL: Ref $ref has payload but status is $gwStatus. Marking FAILED.");

                    DB::table('pending_payments')
                        ->where('id', $id)
                        ->update(['status' => 'FAILED', 'updated_at' => now()]);

                    DB::commit();
                    return;
                }
            }

            // pending_payments.amount is the GROSS the gateway collected — the bill plus the
            // convenience fee added at checkout. The fee is the ISP's charge for taking the payment
            // online, not money owed on the invoices, so it comes back off before anything touches
            // billing: a ₱922.50 charge at 2.5% settles ₱900.00 of invoices.
            //
            // convenience_fee NULL (or column absent) means the row predates the fee change and its
            // amount is already net — subtract nothing, or the customer loses money.
            $grossAmount = floatval($payment->amount);
            $convenienceFee = isset($payment->convenience_fee) ? floatval($payment->convenience_fee) : 0.0;

            // A stored fee that is negative, or that would swallow the whole payment, is corrupt.
            // Apply the full amount rather than short-changing the customer's invoices.
            if ($convenienceFee < 0 || $convenienceFee >= $grossAmount) {
                if ($convenienceFee != 0.0) {
                    $this->workerLog("WARNING: Ref $ref has an unusable convenience fee of ₱"
                        . number_format($convenienceFee, 2) . " against ₱" . number_format($grossAmount, 2)
                        . " — applying the full amount to billing instead.");
                }
                $convenienceFee = 0.0;
            }

            // $amount is what settles the customer's invoices from here on.
            $amount = round($grossAmount - $convenienceFee, 2);

            if ($convenienceFee > 0) {
                $this->workerLog("Ref $ref: charged ₱" . number_format($grossAmount, 2)
                    . " less convenience fee ₱" . number_format($convenienceFee, 2)
                    . " = ₱" . number_format($amount, 2) . " to billing");
            }

            // Lock record for processing
            DB::table('pending_payments')
                ->where('id', $id)
                ->update([
                    'status' => 'PROCESSING',
                    'last_attempt_at' => now(),
                    'updated_at' => now()
                ]);

            // Get account information
            $account = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                    'billing_accounts.id as account_id',
                    'billing_accounts.account_no',
                    'billing_accounts.account_balance',
                    'billing_accounts.generation_type',
                    DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as full_name"),
                    'customers.contact_number_primary',
                    'customers.email_address',
                    'customers.desired_plan'
                )
                ->first();

            if (!$account) {
                $this->workerLog("ERROR: Account not found for payment $ref");
                DB::table('pending_payments')
                    ->where('id', $id)
                    ->update(['status' => 'FAILED', 'updated_at' => now()]);
                DB::commit();
                return;
            }

            // Prepaid onboarding: a customer who has not paid their first bill yet may still change
            // plan at checkout, which re-prices that unpaid bill. It MUST happen before the payment
            // is distributed below — otherwise the money lands against an invoice still priced for
            // the old plan, and the invoice either never closes or closes for the wrong amount.
            //
            // It also has to happen before the prepaid renewal further down: that sets
            // prepaid_expires_at, which is one of the conditions closing the re-price window.
            //
            // Every other account is untouched. An ordinary renewal or a mid-period switch is
            // handled after settlement by PrepaidPlanChangeService, which queues or applies the
            // plan without rewriting any bill.
            if (!empty($payment->selected_plan_id)) {
                $repricedBalance = $this->repriceOnboardingBill($accountNo, (int) $payment->selected_plan_id, $ref);

                if ($repricedBalance !== null) {
                    // updateBilling() subtracts the payment from the balance read above, so the
                    // stale pre-reprice figure has to be refreshed or the new balance is wrong.
                    $account->account_balance = $repricedBalance;
                }
            }

            // Update billing - distribute payment to invoices
            $result = $this->updateBilling($account, $amount, $ref);

            if ($result['success']) {
                // Mark payment as PAID
                DB::table('pending_payments')
                    ->where('id', $id)
                    ->update([
                        'status' => 'PAID',
                        'updated_at' => now()
                    ]);

                // Parse callback payload for payment details
                $json = json_decode($rawPayload, true);
                $checkoutID = $json['id'] ?? $payment->payment_id ?? 'N/A';
                $paymentChannel = $json['payment_channel'] ?? $json['bank_code'] ?? null;
                $ewalletType = $json['ewallet_type'] ?? null;
                $status = $json['status'] ?? 'PAID';
                $type = $json['type'] ?? null;

                // Insert into payment_portal_logs
                DB::table('payment_portal_logs')->insert([
                    'reference_no' => $ref,
                    'account_id' => $account->account_id,
                    // Net of the convenience fee, so this log reconciles against the invoices it
                    // settled. The gross charged stays on pending_payments.amount and in
                    // callback_payload below for audit.
                    'total_amount' => $amount,
                    'account_balance_before' => $account->account_balance,
                    'date_time' => now(),
                    'checkout_id' => $checkoutID,
                    'status' => $status,
                    'transaction_status' => 'PAID',
                    'ewallet_type' => $ewalletType,
                    'payment_channel' => $paymentChannel,
                    'type' => $type,
                    'payment_url' => $payment->payment_url ?? null,
                    'json_payload' => $payment->json_payload ?? null,
                    'callback_payload' => $rawPayload,
                    'updated_at' => now()
                ]);

                $this->workerLog("Success: Logged Ref $ref - Amount: ₱" . number_format($amount, 2)
                    . ($convenienceFee > 0 ? " (charged ₱" . number_format($grossAmount, 2) . ")" : '')
                    . " - {$result['distribution_summary']}");

                // Read settlement conditions before committing (still within transaction for consistency)
                $latestBillingAccount = DB::table('billing_accounts')
                    ->where('account_no', $accountNo)
                    ->select('account_balance', 'billing_status_id')
                    ->first();

                $currentBalance = floatval($latestBillingAccount->account_balance ?? 0);
                $currentStatusId = intval($latestBillingAccount->billing_status_id ?? 1);

                // Whenever the payment brings the balance to 0 (or credit) we run the full
                // post-payment settlement flow — REGARDLESS of the current billing status.
                // attemptReconnect() then: cancels any queued disconnect/restrict ops for
                // this account, reconnects the user if they were cut off, and fails any open
                // pullout / for-pullout service orders. Gating this on billing_status_id != 1
                // meant a customer who paid before the disconnect cron ran (still status 1)
                // never got their queued disconnect cancelled or pullout SOs failed.
                $balanceSettled = ($currentBalance <= 0);

                // Commit billing FIRST — payment is real regardless of what RADIUS does
                DB::commit();

                // Send Approval Notifications (after commit so they're never rolled back)
                $this->sendApprovalSms($account, $result['invoices_paid'] ?? [], $amount, $ref);
                $this->sendApprovalEmail($account, $result['invoices_paid'] ?? [], $amount, $ref);

                // Run reconnect/settlement flow AFTER commit — RADIUS failure must never roll back a real payment
                if ($balanceSettled) {
                    $this->workerLog("Balance settled for $ref — Status ID: {$currentStatusId}, Balance: ₱" . number_format($currentBalance, 2) . " — running reconnect/settlement flow");
                    $reconnectStatus = $this->attemptReconnect($account, $ref);

                    // Update reconnect_status outside the main transaction (standalone)
                    DB::table('pending_payments')
                        ->where('id', $id)
                        ->update(['reconnect_status' => $reconnectStatus]);

                    $this->workerLog("Reconnect attempt for $ref: $reconnectStatus");

                    // Prepaid: a settling payment extends (if still active) or restarts (if
                    // expired) the prepaid service period, and acts on any plan the customer
                    // picked at checkout — queued for when their current period lapses, or
                    // applied immediately if they ticked "Activate Now" (or the period had
                    // already expired). No-op for postpaid accounts.
                    //
                    // settlePayment() owns the ordering between the two: activate_now decides
                    // whether the period is RESET or EXTENDED, so the renewal cannot be decided
                    // independently of the plan change. Mirrors TransactionController.
                    $settled = app(\App\Services\PrepaidPlanChangeService::class)->settlePayment(
                        $accountNo,
                        $payment->selected_plan_id ?? null,
                        (bool) ($payment->activate_now ?? false)
                    );

                    $prepaidRenewal = $settled['renewal'];
                    $planChange = $settled['plan_change'];

                    if (!empty($prepaidRenewal['prepaid'])) {
                        $this->workerLog("Prepaid period {$prepaidRenewal['mode']} for $ref — new expiry: {$prepaidRenewal['new_expiry']}"
                            . (!empty($prepaidRenewal['forfeited_days']) ? " ({$prepaidRenewal['forfeited_days']} day(s) forfeited)" : ''));
                    }

                    if (($planChange['action'] ?? 'none') !== 'none') {
                        $this->workerLog("Prepaid plan {$planChange['action']} for $ref — plan: {$planChange['plan']}"
                            . (isset($planChange['effective_at']) ? " effective {$planChange['effective_at']}" : ''));
                    }
                }

            } else {
                // Billing update failed
                DB::table('pending_payments')
                    ->where('id', $id)
                    ->update(['status' => 'API_RETRY', 'updated_at' => now()]);

                $this->workerLog("Billing update failed for Ref $ref: " . $result['message']);
                DB::rollBack();
            }

        } catch (Exception $e) {
            DB::rollBack();
            $this->workerLog("Failed to process payment {$payment->reference_no}: {$e->getMessage()}");

            DB::table('pending_payments')
                ->where('id', $payment->id)
                ->update(['status' => 'API_RETRY', 'updated_at' => now()]);
        }
    }

    /**
     * Re-price an unpaid prepaid onboarding bill for the plan chosen at checkout.
     *
     * @return float|null the account's balance after re-pricing, or null when nothing was
     *                    re-priced — either the account is outside the never-paid onboarding
     *                    window (the common case) or the attempt failed.
     *
     * Never throws. A re-price problem must not fail a payment that has already been collected:
     * the fallback is the bill staying at its original amount, which the payment then settles
     * exactly as it did before this existed.
     */
    private function repriceOnboardingBill(string $accountNo, int $planId, string $ref): ?float
    {
        try {
            $account = \App\Models\BillingAccount::where('account_no', $accountNo)->first();
            $plan = \App\Models\AppPlan::find($planId);

            if (!$account || !$plan) {
                return null;
            }

            $result = app(\App\Services\EnhancedBillingGenerationServiceWithNotifications::class)
                ->repricePrepaidInitialBillForPlan($account, $plan, 0, true);

            if (empty($result['revised'])) {
                return null;
            }

            $this->workerLog("Ref $ref: onboarding bill re-priced for {$plan->plan_name} — ₱"
                . number_format($result['previous_total'], 2) . " -> ₱"
                . number_format($result['new_total'], 2));

            return (float) $result['new_balance'];

        } catch (\Throwable $e) {
            $this->workerLog("WARNING: Ref $ref onboarding re-price failed, settling the original"
                . " bill instead: {$e->getMessage()}");

            Log::error('Onboarding bill re-price failed', [
                'account_no' => $accountNo,
                'plan_id' => $planId,
                'reference_no' => $ref,
                'error' => $e->getMessage()
            ]);

            return null;
        }
    }

    private function replaceGlobalVariables(string $message): string
    {
        $portalUrl = 'sync.xpacsconnect.ph';
        $brandName = DB::table('form_ui')->value('brand_name') ?? 'Your ISP';

        $message = str_replace('{{portal_url}}', $portalUrl, $message);
        $message = str_replace('{{company_name}}', $brandName, $message);

        return $message;
    }

    /**
     * Update billing - distribute payment to unpaid invoices
     */
    private function updateBilling($account, $paymentAmount, $referenceNo)
    {
        try {
            $accountNo = $account->account_no;
            $remainingAmount = $paymentAmount;
            $distributionLog = [];
            $paidInvoices = [];

            // Get unpaid invoices ordered by invoice_date (oldest first)
            $unpaidInvoices = DB::table('invoices')
                ->where('account_no', $accountNo)
                ->where('status', '!=', 'Paid')
                ->orderBy('invoice_date', 'asc')
                ->orderBy('id', 'asc')
                ->get();

            // Prepaid accounts never carry a credit (negative) balance: a settling payment
            // renews the prepaid period (see PrepaidRenewalService) instead of banking credit,
            // so any overpayment is floored to 0. Postpaid / blank generation_type keep the real
            // (possibly negative) balance, which is the existing advance-payment behaviour.
            $isPrepaid = \App\Models\BillingAccount::isPrepaidType($account->generation_type ?? null);

            if ($unpaidInvoices->isEmpty()) {
                // No unpaid invoices - apply as credit/advance payment
                $newBalance = floatval($account->account_balance) - $paymentAmount;
                if ($isPrepaid && $newBalance < 0) {
                    $newBalance = 0;
                }

                DB::table('billing_accounts')
                    ->where('account_no', $accountNo)
                    ->update([
                        'account_balance' => $newBalance,
                        'updated_at' => now()
                    ]);

                return [
                    'success' => true,
                    'distribution_summary' => "Applied as credit (No unpaid invoices)",
                    'distributed_amount' => $paymentAmount,
                    'remaining_amount' => 0,
                    'invoices_paid' => []
                ];
            }

            // Distribute payment to invoices
            foreach ($unpaidInvoices as $invoice) {
                if ($remainingAmount <= 0) {
                    break;
                }

                $invoiceId = $invoice->id;
                $invoiceBalance = floatval($invoice->total_amount) - floatval($invoice->received_payment);

                if ($invoiceBalance <= 0) {
                    continue; // Skip already paid invoices
                }

                $amountToApply = min($remainingAmount, $invoiceBalance);
                $newReceivedPayment = floatval($invoice->received_payment) + $amountToApply;
                $newInvoiceBalance = floatval($invoice->total_amount) - $newReceivedPayment;

                // Determine new status
                $newStatus = 'Unpaid';
                if ($newInvoiceBalance <= 0.01) { // Fully paid (accounting for floating point)
                    $newStatus = 'Paid';
                    $paidInvoices[] = [
                        'invoice_id' => $invoiceId,
                        'amount_paid' => $amountToApply
                    ];
                } elseif ($newReceivedPayment > 0) { // Partially paid
                    $newStatus = 'Partial';
                }

                // Update invoice
                DB::table('invoices')
                    ->where('id', $invoiceId)
                    ->update([
                        'received_payment' => $newReceivedPayment,
                        'status' => $newStatus,
                        'transaction_id' => $referenceNo,
                        'updated_at' => now(),
                        'updated_by' => 'Payment Worker'
                    ]);

                $distributionLog[] = "Invoice #{$invoiceId}: ₱" . number_format($amountToApply, 2) . " ({$newStatus})";
                $remainingAmount -= $amountToApply;

                $this->workerLog("Distributed ₱" . number_format($amountToApply, 2) . " to Invoice #{$invoiceId} - Status: {$newStatus}");
            }

            // Update account balance (prepaid floored to 0 — see $isPrepaid note above)
            $newAccountBalance = floatval($account->account_balance) - $paymentAmount;
            if ($isPrepaid && $newAccountBalance < 0) {
                $newAccountBalance = 0;
            }

            DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->update([
                    'account_balance' => $newAccountBalance,
                    'updated_at' => now()
                ]);

            $distributionSummary = implode(', ', $distributionLog);

            if ($remainingAmount > 0.01) {
                $distributionSummary .= " | Credit: ₱" . number_format($remainingAmount, 2);
            }

            return [
                'success' => true,
                'distribution_summary' => $distributionSummary,
                'distributed_amount' => $paymentAmount - $remainingAmount,
                'remaining_amount' => $remainingAmount,
                'invoices_paid' => $paidInvoices
            ];

        } catch (Exception $e) {
            Log::error('Billing update failed', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage()
            ]);

            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }

    /**
     * Attempt to reconnect user account
     * Enhanced version: Checks session_status from online_status table
     */
    /**
     * Attempt to reconnect user account
     * Matches logic in TransactionController::approve
     *
     * @param  object       $account
     * @param  string|null  $paymentReference
     */
    private function attemptReconnect($account, ?string $paymentReference = null)
    {
        try {
            // Reload billing account to get latest balance and status
            $billingAccount = DB::table('billing_accounts')->where('id', $account->account_id)->first();
            $accountNo = $billingAccount->account_no;

            $this->workerLog("[RECONNECT CHECK] Starting for account: {$accountNo}");

            // Step 1: Check if balance qualifies (0 or negative)
            //
            // INVARIANT: this whole reconnect/status-sync path READS the balance and never writes
            // it. A negative balance is a real advance-payment credit the customer is owed — do
            // not "settle" or normalise it to 0 on reconnect. Zeroing it here would silently spend
            // the credit and the customer would be billed twice for the same period. Balance is
            // written in exactly two places: updateBilling() above (payment applied) and billing
            // generation (charges accrued).
            $balance = floatval($billingAccount->account_balance ?? 0);
            if ($balance > 0) {
                $this->workerLog("[RECONNECT SKIP] Balance is positive: ₱{$balance}");
                return 'balance_positive';
            }

            // The balance is settled, so the account's pullouts are void — closed
            // here, before any of the RADIUS checks below can return early.
            app(PulloutServiceOrderCloser::class)
                ->closeIfSettled($accountNo, $balance, 'payment worker', $paymentReference);

            // Step 2: Check current billing status.
            $isAlreadyActive = ($billingAccount->billing_status_id == 1);

            // Step 2b: If the account is already active in billing AND the customer is
            // genuinely Online in RADIUS, there is nothing to fix — the payment's balance
            // deduction and invoice update are already committed. Do nothing else: no queue
            // cancel, no RADIUS reconnect, no pullout handling. Just record and return.
            //
            // Only when the customer is NOT Online (Offline / Disconnected / Restricted /
            // missing) — or the account is not active — do we run the settlement flow below
            // (cancel queued disconnects, RADIUS reconnect, fail pullout SOs).
            if ($isAlreadyActive) {
                $sessionStatus = DB::table('online_status')
                    ->where('account_no', $accountNo)
                    ->value('session_status');

                if (strcasecmp(trim((string) $sessionStatus), 'Online') === 0) {
                    $this->workerLog("[RECONNECT SKIP] Account {$accountNo} already active and session_status=Online — balance deducted & invoice updated only, no further action.");
                    return 'already_online';
                }

                $this->workerLog("[RECONNECT PROCEED] Account {$accountNo} active in billing but session_status='" . ($sessionStatus ?? 'null') . "' (not Online) — proceeding with RADIUS reconnect.");
            }

            // Balance is now settled (0 or negative) and a reconnect is warranted. Cancel any
            // pending disconnection / restriction still queued for this account so the RADIUS
            // queue cron won't restrict a customer who has already paid.
            $this->cancelPendingDisconnectionsInQueue($accountNo);

            // Step 3: Get account details with PPPoE username and plan
            $accountDetails = DB::table('billing_accounts')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('billing_accounts.id', $billingAccount->id)
                ->where('billing_accounts.id', $billingAccount->id)
                ->select('technical_details.username as pppoe_username', 'customers.desired_plan', 'customers.email_address')
                ->first();

            $username = $accountDetails->pppoe_username ?? null;
            $plan = $accountDetails->desired_plan ?? null;
            $emailAddress = $accountDetails->email_address ?? null;

            if (empty($username)) {
                $this->workerLog("[RECONNECT SKIP] No PPPoE username found in technical_details for account: {$accountNo}");
                return 'no_username';
            }

            if (empty($plan)) {
                $this->workerLog("[RECONNECT SKIP] No plan found for account: {$accountNo}");
                return 'no_plan';
            }

            $this->workerLog("[RECONNECT PROCEED] Conditions met - Proceeding with reconnection. Current Status Active: " . ($isAlreadyActive ? 'Yes' : 'No') . ", Balance: ₱{$balance}");

            // Step 5: Prepare parameters for ManualRadiusOperationsService
            $params = [
                'accountNumber' => $accountNo,
                'username' => $username,
                'plan' => $plan,
                'updatedBy' => 'Payment Worker Auto-Reconnect',
                'remarks' => 'Payment Worker Auto-Reconnect'
            ];

            // Step 6: Call ManualRadiusOperationsService reconnectUser
            $this->workerLog("[RECONNECT EXECUTE] Calling ManualRadiusOperationsService for {$username}");

            $radiusSuccess = false;
            $lastRadiusError = '';
            $result = [];

            for ($attempt = 1; $attempt <= 3; $attempt++) {
                try {
                    $result = $this->manualRadiusService->reconnectUser($params);
                    if (($result['status'] ?? '') === 'success') {
                        $radiusSuccess = true;
                        $this->workerLog("[RECONNECT EXECUTE] Success on attempt {$attempt}");
                        break;
                    }
                    $lastRadiusError = $result['message'] ?? 'Operation returned failure';
                    $this->workerLog("[RECONNECT EXECUTE] Attempt {$attempt}/3 failed: {$lastRadiusError}");
                } catch (Exception $radEx) {
                    $lastRadiusError = $radEx->getMessage();
                    $this->workerLog("[RECONNECT EXECUTE] Attempt {$attempt}/3 exception: {$lastRadiusError}");
                }
                if ($attempt < 3)
                    sleep(2);
            }

            if (!$radiusSuccess) {
                $this->workerLog("[RECONNECT EXECUTE] All 3 attempts failed. Queuing for retry.");
                RadiusQueueService::queue([
                    'source_type' => 'payment_worker',
                    'source_id' => $billingAccount->id,
                    'account_no' => $accountNo,
                    'operation' => 'reconnect_user',
                    'params' => $params,
                    'last_error' => $lastRadiusError,
                    'created_by' => 'Payment Worker',
                ]);
            }

            if (true) {
                $this->workerLog("[RECONNECT SUCCESS] Reconnection queued or completed successfully");

                // Step 7: Update billing_status_id to 1 (Active) if not already 1
                if (!$isAlreadyActive) {
                    DB::table('billing_accounts')
                        ->where('id', $billingAccount->id)
                        ->update([
                            'billing_status_id' => 1,
                            'updated_at' => now(),
                            'updated_by' => 'Payment Worker'
                        ]);
                    $this->workerLog("[RECONNECT DB] Updated billing_status_id to 1 for Account: {$accountNo}");
                } else {
                    $this->workerLog("[RECONNECT DB SKIP] Account already 1, skipping status update");
                }

                // Send SMS Notification
                try {
                    // Fetch SMS template
                    $smsTemplate = DB::table('sms_templates')
                        ->where('template_type', 'Reconnect')
                        ->where('is_active', 1)
                        ->first();

                    if ($smsTemplate) {
                        // Get Customer Name and Contact Number
                        $customerInfo = DB::table('billing_accounts')
                            ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                            ->where('billing_accounts.account_no', $accountNo)
                            ->select(
                                'customers.contact_number_primary',
                                DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as full_name")
                            )
                            ->first();

                        if ($customerInfo && !empty($customerInfo->contact_number_primary)) {
                            // Replace variables
                            $message = $smsTemplate->message_content;
                            $customerName = preg_replace('/\s+/', ' ', trim($customerInfo->full_name));
                            $planNameFormatted = str_replace('₱', 'P', $plan ?? '');

                            $message = str_replace('{{customer_name}}', $customerName, $message);
                            $message = str_replace('{{account_no}}', $accountNo, $message);
                            $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                            $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);

                            // Send SMS
                            $smsService = new \App\Services\ItexmoSmsService();
                            $smsResult = $smsService->send([
                                'contact_no' => $customerInfo->contact_number_primary,
                                'message' => $message
                            ]);

                            if ($smsResult['success']) {
                                $this->workerLog("[RECONNECT SMS] SMS sent to " . $customerInfo->contact_number_primary);
                            } else {
                                $this->workerLog("[RECONNECT SMS FAILED] " . ($smsResult['error'] ?? 'Unknown error'));
                            }
                        } else {
                            $this->workerLog("[RECONNECT SMS SKIP] No contact number found for account " . $accountNo);
                        }
                    } else {
                        $this->workerLog("[RECONNECT SMS SKIP] No active Reconnect SMS template found");
                    }
                } catch (Exception $e) {
                    $this->workerLog("[RECONNECT SMS EXCEPTION] " . $e->getMessage());
                }

                // Send Email Notification
                try {
                    $emailTemplate = \App\Models\EmailTemplate::where('Template_Code', 'RECONNECT')->first();

                    if ($emailTemplate && $emailAddress && !empty($emailAddress)) {
                        $emailService = app(\App\Services\EmailQueueService::class);

                        $customerInfo = DB::table('billing_accounts')
                            ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                            ->where('billing_accounts.account_no', $accountNo)
                            ->select(
                                'customers.email_address',
                                'customers.desired_plan as plan_name',
                                DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as full_name")
                            )
                            ->first();

                        if ($customerInfo) {
                            $customerName = preg_replace('/\s+/', ' ', trim($customerInfo->full_name));
                            $planNameFormatted = str_replace('₱', 'P', $customerInfo->plan_name ?? '');

                            $emailData = [
                                'customer_name' => $customerName,
                                'account_no' => $accountNo,
                                'plan_name' => $planNameFormatted,
                                'recipient_email' => $customerInfo->email_address,
                            ];
                            $emailService->queueFromTemplate('RECONNECT', $emailData);
                            $this->workerLog("[RECONNECT EMAIL] Email queued for: " . $customerInfo->email_address);
                        }
                    }
                } catch (Exception $e) {
                    $this->workerLog("[RECONNECT EMAIL EXCEPTION] " . $e->getMessage());
                }

                return $radiusSuccess ? 'success' : 'queued';
            }

        } catch (Exception $e) {
            $this->workerLog("[RECONNECT EXCEPTION] Failed for {$account->account_no}: {$e->getMessage()}");
            $this->workerLog("[RECONNECT EXCEPTION] Trace: {$e->getTraceAsString()}");
            \Log::channel('radiusrelated')->error('[PAYMENT WORKER RECONNECT EXCEPTION] Account: ' . ($account->account_no ?? 'Unknown') . ' - Error: ' . $e->getMessage());
            return 'exception';
        }
    }

    /**
     * Cancel any still-pending disconnection / restriction operations queued in
     * radius_operation_queue for this account.
     *
     * Fired from attemptReconnect once the account balance has settled to 0 (or
     * negative). Without this, a disconnect/restrict operation queued before the
     * payment could still be picked up by the ProcessRadiusQueue cron and restrict
     * a customer who has already paid.
     *
     * Only rows still in the 'pending' state are touched (an operation already
     * 'processing'/'success'/'failed' is left alone). Matching rows are marked
     * 'cancelled' so the cron will skip them.
     */
    private function cancelPendingDisconnectionsInQueue(string $accountNo): void
    {
        try {
            if (!\Illuminate\Support\Facades\Schema::hasTable('radius_operation_queue')) {
                return;
            }

            // Balance guard: only cancel queued disconnections once the account
            // balance has actually reached 0 (fully paid). A small epsilon absorbs
            // rounding residuals. If the balance is still positive, do nothing.
            $balance = floatval(DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->value('account_balance') ?? 0);

            if ($balance > 0.01) {
                $this->workerLog("[RECONNECT QUEUE SKIP] Account balance still positive (₱" . number_format($balance, 2) . ") - not cancelling queued disconnections for account: {$accountNo}");
                return;
            }

            $disconnectOperations = ['disconnect_user', 'restricted_user'];

            $cancelled = DB::table('radius_operation_queue')
                ->where('account_no', $accountNo)
                ->where('status', 'pending')
                ->whereIn('operation', $disconnectOperations)
                ->update([
                    'status' => 'cancelled',
                    'last_error' => 'Cancelled - payment received (Payment Worker), account balance settled to 0',
                    'completed_at' => now(),
                    'updated_at' => now(),
                ]);

            if ($cancelled > 0) {
                $this->workerLog("[RECONNECT QUEUE] Cancelled {$cancelled} pending disconnection/restriction operation(s) for account: {$accountNo}");
                \Log::channel('radiusrelated')->info('[Radius_Queue] [CANCELLED] ' . $cancelled . ' pending disconnect/restrict op(s) for account ' . $accountNo . ' - payment received (Payment Worker), balance settled.');
            } else {
                $this->workerLog("[RECONNECT QUEUE] No pending disconnection/restriction operations to cancel for account: {$accountNo}");
            }
        } catch (Exception $e) {
            $this->workerLog("[RECONNECT QUEUE EXCEPTION] Failed to cancel pending disconnections for account {$accountNo}: {$e->getMessage()}");
        }
    }



    /**
     * Send Transaction Approval SMS notification
     */
    private function sendApprovalSms($account, $invoicesPaid, $totalPaidAmount, $referenceNo = null)
    {
        try {
            if ($account && !empty($account->contact_number_primary)) {
                $paymentLogDate = date('Y-m-d');
                $finalAmount = $totalPaidAmount;

                if ($referenceNo) {
                    $logEntry = DB::table('payment_portal_logs')->where('reference_no', $referenceNo)->first();
                    if ($logEntry) {
                        $finalAmount = $logEntry->total_amount;
                        $paymentLogDate = date('Y-m-d', strtotime($logEntry->date_time));
                    }
                }

                $paidTemplate = DB::table('sms_templates')
                    ->where('template_type', 'Paid')
                    ->where('is_active', 1)
                    ->first();

                if ($paidTemplate) {
                    $smsService = new \App\Services\ItexmoSmsService();

                    // Consolidate invoice IDs or use N/A if none
                    $invoiceIds = !empty($invoicesPaid)
                        ? collect($invoicesPaid)->pluck('invoice_id')->unique()->implode(', ')
                        : 'N/A';

                    $message = $paidTemplate->message_content;

                    // Replace variables
                    $customerName = preg_replace('/\s+/', ' ', trim($account->full_name));
                    $planNameFormatted = str_replace('₱', 'P', $account->desired_plan ?? 'N/A');

                    $message = str_replace('{{customer_name}}', $customerName, $message);
                    $message = str_replace('{{account_no}}', $account->account_no, $message);
                    $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                    $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
                    $message = str_replace('{{invoice_id}}', $invoiceIds, $message);

                    // Support multiple variations of placeholders
                    $formattedAmount = number_format($finalAmount, 2);

                    $message = str_replace('{{amount_paid}}', $formattedAmount, $message);
                    $message = str_replace('{{amount}}', $formattedAmount, $message);
                    $message = str_replace('{{date}}', $paymentLogDate, $message);
                    $message = str_replace('{{payment_date}}', $paymentLogDate, $message);

                    $message = $this->replaceGlobalVariables($message);

                    $result = $smsService->send([
                        'contact_no' => $account->contact_number_primary,
                        'message' => $message
                    ]);

                    if ($result['success']) {
                        $this->workerLog("Approval SMS sent to {$account->contact_number_primary}");
                    } else {
                        $this->workerLog("Approval SMS Failed: " . ($result['error'] ?? 'Unknown error'));
                    }
                }
            }
        } catch (Exception $e) {
            $this->workerLog("Approval SMS Exception: " . $e->getMessage());
        }
    }

    /**
     * Send Transaction Approval Email notification
     */
    private function sendApprovalEmail($account, $invoicesPaid, $totalPaidAmount, $referenceNo = null)
    {
        try {
            if ($account && !empty($account->email_address)) {
                $emailService = app(\App\Services\EmailQueueService::class);

                $paymentLogDate = date('Y-m-d');
                $finalAmount = $totalPaidAmount;

                if ($referenceNo) {
                    $logEntry = DB::table('payment_portal_logs')->where('reference_no', $referenceNo)->first();
                    if ($logEntry) {
                        $finalAmount = $logEntry->total_amount;
                        $paymentLogDate = date('Y-m-d', strtotime($logEntry->date_time));
                    }
                }

                // Consolidate invoice IDs or use N/A
                $invoiceIds = !empty($invoicesPaid)
                    ? collect($invoicesPaid)->pluck('invoice_id')->unique()->implode(', ')
                    : 'N/A';

                $brandName = DB::table('form_ui')->value('brand_name') ?? 'Your ISP';

                $customerName = preg_replace('/\s+/', ' ', trim($account->full_name));
                $planNameFormatted = str_replace('₱', 'P', $account->desired_plan ?? 'N/A');

                $formattedAmount = number_format($finalAmount, 2);

                $emailData = [
                    'Amount' => $formattedAmount,
                    'amount' => $formattedAmount,
                    'amount_paid' => $formattedAmount,
                    'Company_Name' => $brandName,
                    'Account_No' => $account->account_no,
                    'account_no' => $account->account_no,
                    'Date' => $paymentLogDate,
                    'date' => $paymentLogDate,
                    'payment_date' => $paymentLogDate,
                    'Full_Name' => $customerName,
                    'Plan' => $planNameFormatted,
                    'invoice_ids' => $invoiceIds,
                    'recipient_email' => $account->email_address,
                ];

                $emailService->queueFromTemplate('PAID', $emailData);

                $this->workerLog("Approval Email queued via template PAID to {$account->email_address}");
            }
        } catch (Exception $e) {
            $this->workerLog("Approval Email Exception: " . $e->getMessage());
        }
    }

    /**
     * Acquire lock to prevent concurrent execution using database
     */
    private function acquireLock()
    {
        try {
            // Check if lock exists and is not expired
            $existingLock = DB::table('worker_locks')
                ->where('lock_name', $this->lockName)
                ->first();

            if ($existingLock) {
                $lockedAt = \Carbon\Carbon::parse($existingLock->locked_at);
                $expiresAt = $lockedAt->addSeconds($this->lockTimeout);

                // If lock is still valid (not expired)
                if (now()->lessThan($expiresAt)) {
                    $this->workerLog('Lock is held by another process. Expires at: ' . $expiresAt->format('Y-m-d H:i:s'));
                    return false;
                }

                // Lock expired, clean it up
                $this->workerLog('Found expired lock. Cleaning up and acquiring new lock.');
                DB::table('worker_locks')
                    ->where('lock_name', $this->lockName)
                    ->delete();
            }

            // Try to acquire lock
            DB::table('worker_locks')->insert([
                'lock_name' => $this->lockName,
                'locked_at' => now(),
                'locked_by' => gethostname() . ':' . getmypid(),
                'created_at' => now()
            ]);

            $this->hasLock = true;
            $this->workerLog('Lock acquired successfully');
            return true;

        } catch (Exception $e) {
            // Unique constraint violation means another process got the lock first
            $this->workerLog('Failed to acquire lock: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Release lock
     */
    private function releaseLock()
    {
        if ($this->hasLock) {
            try {
                DB::table('worker_locks')
                    ->where('lock_name', $this->lockName)
                    ->delete();

                $this->workerLog('Lock released successfully');
                $this->hasLock = false;
            } catch (Exception $e) {
                $this->workerLog('Failed to release lock: ' . $e->getMessage());
            }
        }
    }

    /**
     * Write log message
     */
    private function workerLog($message)
    {
        $timestamp = now()->format('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] [Payment Worker] {$message}";

        // Log to custom paymentworker.log file
        $logPath = storage_path('logs/paymentworker.log');
        file_put_contents($logPath, $logMessage . PHP_EOL, FILE_APPEND);

        // Also log to Laravel default log
        Log::channel('single')->info('[Payment Worker] ' . $message);
    }

    /**
     * Get worker statistics
     */
    public function getStatistics()
    {
        return [
            'pending' => DB::table('pending_payments')
                ->where('status', 'PENDING')
                ->count(),
            'queued' => DB::table('pending_payments')
                ->where('status', 'QUEUED')
                ->count(),
            'processing' => DB::table('pending_payments')
                ->where('status', 'PROCESSING')
                ->count(),
            'paid' => DB::table('pending_payments')
                ->where('status', 'PAID')
                ->whereDate('updated_at', today())
                ->count(),
            'failed' => DB::table('pending_payments')
                ->where('status', 'FAILED')
                ->whereDate('updated_at', today())
                ->count(),
            'api_retry' => DB::table('pending_payments')
                ->where('status', 'API_RETRY')
                ->count(),
        ];
    }

    /**
     * Retry failed payments
     */
    public function retryFailedPayments()
    {
        $retryPayments = DB::table('pending_payments')
            ->where('status', 'API_RETRY')
            ->limit(10)
            ->get();

        foreach ($retryPayments as $payment) {
            DB::table('pending_payments')
                ->where('id', $payment->id)
                ->update(['status' => 'QUEUED', 'updated_at' => now()]);
        }

        return $retryPayments->count();
    }

}
