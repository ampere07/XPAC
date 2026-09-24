<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\BillingAccount;
use App\Models\ServiceOrder;
use App\Models\BillingConfig;
use App\Models\SMSTemplate;
use App\Models\EmailTemplate;
use App\Services\EmailQueueService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Carbon\Carbon;
use Throwable;
use Exception;

class AutoDisconnectService
{
    private $logName = 'Auto_DC';
    private $radiusService;
    private $smsService;
    private $emailQueueService;
    private $lockName = 'auto_disconnect_worker';
    private $lockTimeout = 300; // 5 minutes max execution time
    private $hasLock = false;

    /**
     * Cached RADIUS reachability for the lifetime of this run.
     *
     * Every customer targets the same RADIUS server set, so the connectivity probe is
     * performed once and reused — this avoids hammering the server (and re-querying the
     * config) once per customer. null = not yet checked.
     */
    private ?bool $radiusReachable = null;

    /** Emit extra-detailed [VERBOSE] lines to the log/CLI. */
    private $verbose = true;

    /** Mirror every log line to stdout when running from the CLI. */
    private $cliEcho = true;

    /** Whether the current process is running under the CLI SAPI (set in constructor). */
    private $isCli = false;

    /**
     * Fixed 30-day billing-cycle configuration.
     *
     * The billing cycle behaves as a fixed 30-day calendar:
     *   - Day 31 never exists in billing-cycle computation.
     *   - Billing-cycle day 30 always exists logically (even in February).
     *   - Computed billing-cycle days are normalized into valid real calendar dates.
     *   - Proration always divides by 30 (never 28, 29 or 31).
     */
    private const BILLING_CYCLE_DAYS = 30;

    /**
     * Remark stamped on the RADIUS restriction (and the disconnected_logs row) when a prepaid
     * account is auto-restricted because its rolling service period lapsed. This is NOT an
     * idempotency signal — idempotency comes from only selecting Active accounts whose
     * prepaid_expires_at has passed (see {@see processPrepaidRestrictions()}).
     */
    private const PREPAID_RESTRICTION_REMARKS = 'Prepaid Period Expired';

    /**
     * Grace days a prepaid customer keeps AFTER their expiry date before being restricted.
     *
     * 1 means the expiry date is treated as the last full day of service: an account expiring
     * 07/30 stays connected all through 07/30 and is restricted on 07/31.
     *
     * This is a whole-DAY offset applied to the expiry's calendar date, deliberately ignoring its
     * time-of-day. prepaid_expires_at is written as payment date + 30 days, so it inherits the
     * payment's clock time — 3,505 of the live rows sit at 00:00:00 but a handful carry times like
     * 17:24. Comparing the raw timestamp would have cut those customers off mid-afternoon on their
     * expiry day while the 00:00 ones lost the entire day, so the whole cohort is normalised to the
     * same "restricted from the start of the day after expiry" rule.
     *
     * PUBLIC because TransactionRevertController applies the identical rule when a revert restores
     * an already-lapsed expiry. Two copies of this number would let a customer be cut a day early
     * (or served a day free) depending on which path reached them first, so both read this one.
     */
    public const PREPAID_GRACE_DAYS = 1;

    /** Remark stamped on the service order raised by {@see processPrepaidAutoPullout()}. */
    private const PREPAID_PULLOUT_REMARKS = 'Prepaid Auto Pullout';

    /**
     * Concern values that count as an existing pullout request when de-duplicating.
     *
     * 'for pullout' is the spelling {@see createPulloutRequest()} has always written, so it has to
     * be matched too — under a case-sensitive collation the canonical spellings alone would miss
     * every row the postpaid flow created and we would raise a second pullout for the same account.
     */
    private const PULLOUT_CONCERNS = ['Pullout', 'For Pullout', 'for pullout'];

    /** A pullout service order in one of these states is finished and no longer blocks a new one. */
    private const PULLOUT_CLOSED_STATUSES = ['Completed', 'Cancelled', 'Failed'];

    private const DC_OFFSET_DAYS = 10;
    private const ADDITIONAL_INVOICE_OFFSET_DAYS = 7;
    private const PRORATE_DIVISOR_DAYS = 30;

    // Due-date offset applied to a generated additional invoice (mirrors the billing generator's DAYS_UNTIL_DUE).
    private const ADDITIONAL_INVOICE_DUE_OFFSET_DAYS = 7;

    // Marker used in service_charge_logs to identify (and dedupe) auto-generated additional invoices.
    private const ADDITIONAL_INVOICE_CHARGE_TYPE = 'Prorated Additional Invoice';

    public function __construct(
        ManualRadiusOperationsService $radiusService,
        ?ItexmoSmsService $smsService = null,
        ?EmailQueueService $emailQueueService = null
    ) {
        $this->radiusService = $radiusService;
        $this->smsService = $smsService;
        $this->emailQueueService = $emailQueueService;
    }

    /**
     * Process automatic disconnections based on overdue invoices
     */
    public function processAutoDisconnect(): array
    {
        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         STARTING AUTO DISCONNECTION PROCESS                    ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $startTime = Carbon::now();
        $this->writeLog("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $this->writeLog("");

        if (!$this->acquireLock()) {
            $this->writeLog("[LOCK] Process is locked by another worker. Exiting.");
            return [
                'success' => false,
                'error' => 'Process is locked by another worker'
            ];
        }

        try {
            $config = BillingConfig::first();
            
            if (!$config) {
                $this->writeLog("[ERROR] Billing configuration not found");
                throw new Exception("Billing configuration not found");
            }

            $dcActualOffset = $config->disconnection_day ?? 4;
            $dcFee = $config->disconnection_fee ?? 0.00;
            $targetDate = Carbon::today()->subDays($dcActualOffset)->format('Y-m-d');
            
            $this->writeLog("[CONFIG] Disconnection Day Offset: {$dcActualOffset} days");
            $this->writeLog("[CONFIG] Disconnection Fee: ₱" . number_format($dcFee, 2));
            $this->writeLog("[CONFIG] Target Due Date: {$targetDate}");
            $this->writeLog("");

            // Fetch ONLY the latest invoice for each account and check if IT is overdue
            $this->writeLog("[QUERY] Searching for latest overdue invoices...");
            
            // 1. Get the IDs of the absolute latest invoice for every account
            $latestInvoiceIds = DB::table('invoices')
                ->select(DB::raw('MAX(id) as id'))
                ->groupBy('account_no')
                ->pluck('id');

            // 2. Fetch those specific latest invoices and filter by EXACT disconnection day
            // Logic: Due Date + Offset == Today (calculated as Due Date == Today - Offset)
            $invoices = Invoice::with(['billingAccount.customer', 'billingAccount.technicalDetails'])
                ->whereIn('id', $latestInvoiceIds)
                ->whereIn('status', ['Unpaid', 'Partial'])
                ->whereDate('due_date', $targetDate) 
                ->get();

            $totalCount = $invoices->count();
            $this->writeLog("[RESULT] Found {$totalCount} account(s) where (Due Date: {$targetDate} + Offset: {$dcActualOffset}) matches Today");
            $this->writeLog("");

            if ($totalCount === 0) {
                $this->writeLog("[INFO] No invoices to process for disconnection today.");
                $this->writeLog("[INFO] Criteria: Status IN ('Unpaid', 'Partial') AND Due Date = {$targetDate}");
                $endTime = Carbon::now();
                $duration = $endTime->diffInSeconds($startTime);
                $this->writeLog("");
                $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
                $this->writeLog("║         AUTO DISCONNECTION COMPLETE (No Actions)               ║");
                $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
                $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
                $this->writeLog("Duration: {$duration} second(s)");
                $this->writeLog("");
                $this->writeLog("");
                
                $this->releaseLock();
                return [
                    'success' => true,
                    'processed' => 0,
                    'skipped' => 0,
                    'queued' => 0,
                    'errors' => [],
                    'duration' => $duration
                ];
            }

            $this->writeLog("[PROCESS] Starting disconnection process...");
            $this->writeLog("─────────────────────────────────────────────────────────────────");

            $processedCount = 0;
            $skippedCount = 0;
            $queuedCount = 0;
            $errors = [];
            $counter = 0;

            foreach ($invoices as $invoice) {
                $counter++;
                $this->writeLog("");
                $this->writeLog("[{$counter}/{$totalCount}] ══════════════════════════════════════════════");

                // Isolate each customer: a single unexpected failure must never abort the run.
                try {
                    $result = $this->processDisconnection($invoice, $dcActualOffset);
                } catch (Throwable $e) {
                    $skippedCount++;
                    $errors[] = "Account {$invoice->account_no}: " . $e->getMessage();
                    $this->writeLog("[{$counter}/{$totalCount}] ✗ ERROR (isolated, continuing): " . $e->getMessage());
                    \Log::channel('radiusrelated')->error('[AUTO DC LOOP EXCEPTION] Account: ' . $invoice->account_no . ' - ' . $e->getMessage());
                    continue;
                }

                if ($result['success']) {
                    $processedCount++;
                    $this->writeLog("[{$counter}/{$totalCount}] ✓ SUCCESS - Transaction Committed");
                } elseif (!empty($result['queued'])) {
                    $queuedCount++;
                    $this->writeLog("[{$counter}/{$totalCount}] ⧗ QUEUED for retry: " . ($result['reason'] ?? 'RADIUS unavailable'));
                } else {
                    $skippedCount++;
                    $this->writeLog("[{$counter}/{$totalCount}] ⊘ SKIPPED: {$result['reason']}");
                    if (isset($result['reason'])) {
                        $errors[] = "Account {$invoice->account_no}: {$result['reason']}";
                    }
                }
            }

            $endTime = Carbon::now();
            $duration = $endTime->diffInSeconds($startTime);
            
            $this->writeLog("");
            $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
            $this->writeLog("║         AUTO DISCONNECTION COMPLETE                            ║");
            $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
            $this->writeLog("Summary:");
            $this->writeLog("  • Total Found: {$totalCount}");
            $this->writeLog("  • Successfully Processed: {$processedCount}");
            $this->writeLog("  • Queued for Retry: {$queuedCount}");
            $this->writeLog("  • Skipped: {$skippedCount}");
            $this->writeLog("  • Errors: " . count($errors));
            $this->writeLog("  • Duration: {$duration} second(s)");
            $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
            $this->writeLog("");

            if (!empty($errors)) {
                $this->writeLog("[ERROR DETAILS]");
                foreach ($errors as $error) {
                    $this->writeLog("  × {$error}");
                }
                $this->writeLog("");
            }

            $this->releaseLock();
            return [
                'success' => true,
                'processed' => $processedCount,
                'skipped' => $skippedCount,
                'queued' => $queuedCount,
                'errors' => $errors,
                'duration' => $duration
            ];

        } catch (Throwable $e) {
            $endTime = Carbon::now();
            $duration = $endTime->diffInSeconds($startTime);
            
            $this->writeLog("");
            $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
            $this->writeLog("║         CRITICAL ERROR                                         ║");
            $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
            $this->writeLog("[CRITICAL] " . $e->getMessage());
            $this->writeLog("[TRACE] " . $e->getTraceAsString());
            $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
            $this->writeLog("Duration: {$duration} second(s)");
            $this->writeLog("");
            
            $this->releaseLock();
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    /**
     * Process a single disconnection
     */
    private function processDisconnection(Invoice $invoice, int $dcActualOffset): array
    {
        $accountNo = $invoice->account_no;
        $this->writeLog("[ACCOUNT] {$accountNo}");

        $billingAccount = $invoice->billingAccount;

        if (!$billingAccount) {
            $this->writeLog("  [SKIP] Billing account not found");
            return ['success' => false, 'reason' => 'Billing account not found'];
        }

        // Prepaid accounts are governed by their rolling prepaid period, not by overdue
        // invoices — they are restricted exclusively by processPrepaidRestrictions(). Never
        // subject them to the postpaid overdue-based auto-disconnect.
        if (\App\Models\BillingAccount::isPrepaidType($billingAccount->generation_type ?? null)) {
            $this->writeLog("  [SKIP] Prepaid account — handled by prepaid restriction flow, not postpaid auto-disconnect");
            return ['success' => false, 'reason' => 'Prepaid account (handled separately)'];
        }

        // Check if already disconnected today
        $alreadyDisconnected = DB::table('disconnected_logs')
            ->where('account_id', $billingAccount->id)
            ->whereDate('created_at', Carbon::today())
            ->exists();

        if ($alreadyDisconnected) {
            $this->writeLog("  [SKIP] Already disconnected today");
            return ['success' => false, 'reason' => 'Already disconnected today'];
        }

        // Validate account balance
        $currentBalance = floatval($billingAccount->account_balance);
        $this->writeLog("  [INFO] Current Balance: ₱" . number_format($currentBalance, 2));

        if ($currentBalance <= 0.00) {
            $this->writeLog("  [SKIP] Balance is zero or negative (already paid)");
            return ['success' => false, 'reason' => 'Balance already paid'];
        }

        // Check if already inactive or pullout
        $billingStatus = $billingAccount->billingStatus ? $billingAccount->billingStatus->status_name : '';
        $this->writeLog("  [INFO] Current Status: {$billingStatus}");

        /*
         * A VIP is never disconnected for non-payment. It is comped — not paying is the
         * arrangement, not a default — and only vip:check-expiration ends it, on the
         * vip_expiration date.
         *
         * The guard is needed because this sweep selects on unpaid invoices, not on billing
         * status: an account comped after invoices already existed still has those invoices
         * open, and they age into a due date like anyone else's. Without this, comping a
         * customer bought them a disconnection a few days later, from a bill raised before
         * the comping and never expected to be paid.
         */
        if (strcasecmp(trim($billingStatus), 'VIP') === 0) {
            $this->writeLog("  [SKIP] VIP account — comped, never disconnected for non-payment (ends at vip_expiration)");
            return ['success' => false, 'reason' => 'VIP account (comped)'];
        }

        if (in_array($billingStatus, ['Inactive', 'Pullout', 'Disconnected', 'Offline', 'Restricted', 'Pullout Restricted'])) {
            $this->writeLog("  [SKIP] Status is already {$billingStatus}");
            return ['success' => false, 'reason' => "Already {$billingStatus}"];
        }

        // Get technical details for username
        $technicalDetail = $billingAccount->technicalDetails->first();
        if (!$technicalDetail || empty($technicalDetail->username)) {
            $this->writeLog("  [SKIP] PPPoE username not found");
            return ['success' => false, 'reason' => 'PPPoE username not found'];
        }

        $username = $technicalDetail->username;
        $this->writeLog("  [INFO] Username: {$username}");

        // Pre-flight: make sure the RADIUS server is reachable BEFORE we mutate anything.
        // If it is not (connection timeout, network error, or auth failure), queue the
        // restrict operation for the ProcessRadiusQueue cron to retry later and move on —
        // one unreachable server must never abort the whole run.
        if (!$this->isRadiusReachable()) {
            $this->writeLog("  [RADIUS] Server unreachable — queueing restrict for retry instead of disconnecting now");
            $this->queueRadiusOperation(
                $billingAccount,
                $username,
                $accountNo,
                'restricted_user',
                'Auto DC',
                'RADIUS server unreachable during auto-disconnect'
            );
            return ['success' => false, 'queued' => true, 'reason' => 'RADIUS unreachable — queued restrict for retry'];
        }

        // Create transaction to ensure atomicity
        DB::beginTransaction();
        try {
            // 1. Restrict via RADIUS first
            $this->writeLog("  [RADIUS] Initiating restriction...");
            $restrictResult = $this->radiusService->restrictedUser([
                'username' => $username,
                'accountNumber' => $accountNo,
                'remarks' => 'Auto DC',
                'updatedBy' => 'System'
            ]);

            if ($restrictResult['status'] !== 'success') {
                $reason = $restrictResult['message'] ?? 'Unknown RADIUS error';
                $this->writeLog("  [RADIUS] Restriction failed: {$reason}. Rolling back and queueing for retry.");
                \Log::channel('radiusrelated')->error('[AUTO DC RADIUS FAILURE] Account: ' . $accountNo . ' - Reason: ' . $reason);
                DB::rollBack();
                // Do NOT throw — queue the operation and let the run continue with the next customer.
                $this->queueRadiusOperation(
                    $billingAccount,
                    $username,
                    $accountNo,
                    'restricted_user',
                    'Auto DC',
                    'RADIUS restrict failed: ' . $reason
                );
                return ['success' => false, 'queued' => true, 'reason' => 'RADIUS restrict failed — queued for retry: ' . $reason];
            }
            $this->writeLog("  [RADIUS] ✓ Successfully restricted");

            // 2. Apply disconnection fee if configured
            $config = BillingConfig::first();
            $dcFee = floatval($config->disconnection_fee ?? 0);

            if ($dcFee > 0) {
                $this->writeLog("  [FEE] Applying disconnection fee: ₱" . number_format($dcFee, 2));

                // Update invoice
                // Use DB::table to ensure it's part of the raw transaction and avoid model events
                $currentServiceCharge = floatval($invoice->service_charge ?? 0);
                $currentTotalAmount = floatval($invoice->total_amount ?? 0);
                $currentInvoiceBalance = floatval($invoice->invoice_balance ?? 0);
                $newServiceCharge = $currentServiceCharge + $dcFee;
                $newTotalAmount = $currentTotalAmount + $dcFee;
                $newInvoiceBalance = $currentInvoiceBalance + $dcFee;

                DB::table('invoices')
                    ->where('id', $invoice->id)
                    ->update([
                        'service_charge' => $newServiceCharge,
                        'total_amount' => $newTotalAmount,
                        'invoice_balance' => $newInvoiceBalance,
                        'updated_by' => 'System',
                        'updated_at' => Carbon::now()
                    ]);

                // Update account balance
                $newBalance = $currentBalance + $dcFee;
                
                // Direct update to billing_accounts to ensure it persists
                DB::table('billing_accounts')
                    ->where('id', $billingAccount->id)
                    ->update([
                        'account_balance' => $newBalance,
                        'updated_by' => 'System',
                        'updated_at' => Carbon::now()
                    ]);
                
                // Update the local instance for logging & SMS
                $billingAccount->account_balance = $newBalance;

                $this->writeLog("  [FEE] New Balance: ₱" . number_format($newBalance, 2));

                // Log service charge
                DB::table('service_charge_logs')->insert([
                    'account_no' => $accountNo,
                    'invoice_id' => $invoice->id,
                    'service_charge_type' => 'Disconnection Fee',
                    'service_charge' => $dcFee,
                    'date_used' => Carbon::now(),
                    'created_at' => Carbon::now(),
                    'updated_at' => Carbon::now(),
                    'created_by' => 'System',
                    'updated_by' => 'System'
                ]);

            } else {
                $this->writeLog("  [FEE] No disconnection fee (set to 0)");
            }

            // 3. Override billing account status to Inactive (RADIUS service sets Restricted; we want Inactive here)
            $inactiveStatusId = DB::table('billing_status')->where('status_name', 'Inactive')->value('id') ?? 4;
            DB::table('billing_accounts')
                ->where('id', $billingAccount->id)
                ->update([
                    'billing_status_id' => $inactiveStatusId,
                    'updated_by' => 'System',
                    'updated_at' => Carbon::now()
                ]);

            $this->writeLog("  [LOG] Status overridden to Inactive (ID: {$inactiveStatusId}) after RADIUS restriction");

            $this->writeLog("  [DB] STARTING DB COMMIT for Account {$accountNo}...");
            DB::commit();
            $this->writeLog("  [DB] ✓ COMMIT SUCCESSFUL");
            
            // Send SMS notification - AFTER commit to prevent duplicates on rollback
            if ($this->smsService && $billingAccount->customer && $billingAccount->customer->contact_number_primary) {
                $this->writeLog("  [SMS] Attempting to trigger triggerSMS function...");
                $this->triggerSMS($billingAccount, 'Disconnected');
                $this->writeLog("  [SMS] triggerSMS function finished.");
            } else {
                $this->writeLog("  [SMS] Skipping SMS (Service null or no primary contact)");
            }

            // Send Email notification - AFTER commit
            if ($this->emailQueueService && $billingAccount->customer && $billingAccount->customer->email_address) {
                $this->writeLog("  [EMAIL] Attempting to trigger triggerEmail function...");
                $this->triggerEmail($billingAccount);
                $this->writeLog("  [EMAIL] triggerEmail function finished.");
            } else {
                $this->writeLog("  [EMAIL] Skipping Email (Service null or no email address)");
            }

            $this->writeLog("  [COMPLETE] Account {$accountNo} successfully restricted and set to Inactive");

            return ['success' => true];

        } catch (Throwable $e) {
            DB::rollBack();
            $this->writeLog("  [ERROR] Transaction rolled back for Account {$accountNo}: " . $e->getMessage());
            $this->writeLog("  [TRACE] " . $e->getTraceAsString());

            // A connection-related failure that surfaced as an exception is queued for retry.
            // Either way we return a failure result rather than throwing, so the remaining
            // customers are still processed instead of aborting the whole run.
            if (str_contains($e->getMessage(), 'RADIUS')) {
                \Log::channel('radiusrelated')->error('[AUTO DC EXCEPTION] Account: ' . $accountNo . ' - Error: ' . $e->getMessage());
                $this->queueRadiusOperation(
                    $billingAccount,
                    $username,
                    $accountNo,
                    'restricted_user',
                    'Auto DC',
                    'RADIUS exception during auto-disconnect: ' . $e->getMessage()
                );
                return ['success' => false, 'queued' => true, 'reason' => 'RADIUS exception — queued for retry: ' . $e->getMessage()];
            }

            return ['success' => false, 'reason' => $e->getMessage()];
        }
    }

    /**
     * Restrict prepaid customers whose rolling service period has EXPIRED.
     *
     * A prepaid customer keeps service through the WHOLE of their expiry date and is restricted at
     * the start of the following day — an account whose prepaid_expires_at is 07/30 is restricted on
     * 07/31 (see {@see PREPAID_GRACE_DAYS}). The expiry itself is set/extended by
     * {@see PrepaidRenewalService} when they pay. Once the grace day is over, this restricts them
     * via the EXISTING RADIUS restriction workflow
     * ({@see ManualRadiusOperationsService::restrictedUser()}) and flips the billing status to
     * Inactive, mirroring the postpaid auto-disconnect. The restriction is removed automatically
     * on their next successful payment (the existing payment reconnect flow), so the whole
     * restrict → pay → renew → restrict cycle can repeat indefinitely.
     *
     * Idempotent & fault-isolated:
     *   - Only currently-Active accounts past their expiry date AND its grace day are selected. Once
     *     restricted they become Inactive and drop out of the query; after a renewal payment they
     *     are Active again with a future expiry — so an account is never restricted twice for the
     *     same period, yet is correctly re-restricted each time a new period lapses.
     *   - RADIUS-unreachable / restrict-failure paths queue (deduped) for retry instead of
     *     aborting the run.
     *
     * Sends the SMS 'Disconnected' notice (same template/mechanism as postpaid's
     * {@see processDisconnection()}) the moment an account completes this disconnect — RADIUS
     * restrict succeeded AND billing_status was just flipped to Inactive. It is deliberately not
     * sent for an account whose technical_details.username_status is merely 'Restricted' without
     * that transition having just completed here, so a customer already Restricted for an unrelated
     * reason is never mistakenly texted "disconnected" by this sweep.
     *
     * @return array{success:bool, restricted:int, skipped:int, queued:int, errors:array, duration:int}
     */
    public function processPrepaidRestrictions(): array
    {
        $this->writeLog("");
        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         STARTING PREPAID PERIOD-EXPIRY RESTRICTION PROCESS     ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $startTime = Carbon::now();
        $this->writeLog("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $this->writeLog("");

        $restricted = 0;
        $skipped = 0;
        $queued = 0;
        $errors = [];

        try {
            $now = Carbon::now();
            $activeStatusId = DB::table('billing_status')->where('status_name', 'Active')->value('id') ?? 1;
            $inactiveStatusId = DB::table('billing_status')->where('status_name', 'Inactive')->value('id') ?? 4;

            /*
             * Cutoff for "the grace day is over".
             *
             * An account is restricted only once its expiry date is strictly in the past, so the
             * expiry date itself is served in full:
             *
             *   expiry 2026-07-30 (any time)  →  cutoff on 07/30 is 07/30 00:00  →  not yet due
             *                                 →  cutoff on 07/31 is 07/31 00:00  →  RESTRICTED
             *
             * Compared against the bare column rather than DATE(prepaid_expires_at) so the
             * comparison stays index-friendly on a table with thousands of prepaid accounts.
             */
            $restrictFrom = $now->copy()->startOfDay()->subDays(self::PREPAID_GRACE_DAYS - 1);

            $this->writeLog("[RULE] Prepaid grace: " . self::PREPAID_GRACE_DAYS . " day(s) after expiry.");
            $this->writeLog("[RULE] Restricting accounts that expired before {$restrictFrom->format('Y-m-d H:i:s')}.");

            // Active prepaid accounts whose service period lapsed on an earlier calendar day.
            // customer is eager-loaded alongside the RADIUS/status relations so the disconnect SMS
            // below never triggers a lazy per-account query.
            $accounts = BillingAccount::with(['technicalDetails', 'billingStatus', 'customer'])
                ->whereIn('generation_type', \App\Models\BillingAccount::PREPAID_ALIASES)
                ->where('billing_status_id', $activeStatusId)
                ->whereNotNull('prepaid_expires_at')
                ->where('prepaid_expires_at', '<', $restrictFrom)
                ->get();

            $totalCount = $accounts->count();
            $this->writeLog("[QUERY] Found {$totalCount} active prepaid account(s) past their expiry date and grace day.");
            $this->writeLog("");

            if ($totalCount === 0) {
                $duration = Carbon::now()->diffInSeconds($startTime);
                $this->writeLog("[INFO] No prepaid accounts to process.");
                $this->writeLog("[PREPAID] Summary: Restricted 0, Queued 0, Skipped 0, Errors 0, Duration {$duration}s");
                return ['success' => true, 'restricted' => 0, 'skipped' => 0, 'queued' => 0, 'errors' => [], 'duration' => $duration];
            }

            $counter = 0;
            foreach ($accounts as $account) {
                $counter++;
                $accountNo = $account->account_no;
                $this->writeLog("");
                $this->writeLog("[{$counter}/{$totalCount}] ══════════════════════════════════════════════");
                $this->writeLog("[ACCOUNT] {$accountNo}");

                // Isolate each customer: a single unexpected failure must never abort the run.
                try {
                    $expiry = Carbon::parse($account->prepaid_expires_at);
                    // The expiry date is served in full, so restriction is due the next day.
                    $dueDate = $expiry->copy()->startOfDay()->addDays(self::PREPAID_GRACE_DAYS);
                    $this->writeLog(
                        "  [INFO] Prepaid expiry: {$expiry->format('Y-m-d H:i')}"
                        . " | restriction due: {$dueDate->format('Y-m-d')}"
                        . " | days past due: {$dueDate->diffInDays($now->copy()->startOfDay())}"
                    );

                    // Need a PPPoE username to act on.
                    $technicalDetail = $account->technicalDetails->first();
                    if (!$technicalDetail || empty($technicalDetail->username)) {
                        $this->writeLog("  [SKIP] PPPoE username not found");
                        $skipped++;
                        continue;
                    }
                    $username = $technicalDetail->username;
                    $this->writeLog("  [INFO] Username: {$username}");

                    // Skip if a restrict is already queued for retry, so we never issue a direct
                    // restrict while the RADIUS queue still holds a pending one.
                    $pendingQueued = DB::table('radius_operation_queue')
                        ->where('account_no', $accountNo)
                        ->where('operation', 'restricted_user')
                        ->whereIn('status', ['pending', 'processing'])
                        ->exists();
                    if ($pendingQueued) {
                        $this->writeLog("  [SKIP] A restrict operation is already queued for retry");
                        $skipped++;
                        continue;
                    }

                    // Pre-flight RADIUS reachability — queue for retry instead of aborting.
                    if (!$this->isRadiusReachable()) {
                        $this->writeLog("  [RADIUS] Server unreachable — queueing restrict for retry");
                        $this->queueRadiusOperation(
                            $account,
                            $username,
                            $accountNo,
                            'restricted_user',
                            self::PREPAID_RESTRICTION_REMARKS,
                            'RADIUS server unreachable during prepaid restriction'
                        );
                        $queued++;
                        $this->writeLog("[{$counter}/{$totalCount}] ⧗ QUEUED for retry (RADIUS unreachable)");
                        continue;
                    }

                    // Restrict via the existing RADIUS restriction workflow, then flip the billing
                    // status to Inactive (mirrors the postpaid auto-disconnect flow).
                    $this->writeLog("  [RADIUS] Initiating restriction (prepaid period expired)...");
                    $restrictResult = $this->radiusService->restrictedUser([
                        'username' => $username,
                        'accountNumber' => $accountNo,
                        'remarks' => self::PREPAID_RESTRICTION_REMARKS,
                        'updatedBy' => 'System',
                    ]);

                    if (($restrictResult['status'] ?? '') === 'success') {
                        DB::table('billing_accounts')
                            ->where('id', $account->id)
                            ->update([
                                'billing_status_id' => $inactiveStatusId,
                                'updated_by' => 'System',
                                'updated_at' => Carbon::now(),
                            ]);
                        $restricted++;
                        $this->writeLog("  [RADIUS] ✓ Successfully restricted");
                        $this->writeLog("  [DB] Status overridden to Inactive (ID: {$inactiveStatusId})");
                        $this->writeLog("[{$counter}/{$totalCount}] ✓ SUCCESS - Restricted (status: Inactive)");

                        // Disconnect SMS — only for a subscriber that has actually completed the
                        // disconnect this run (RADIUS restrict succeeded AND billing_status just
                        // flipped to Inactive, both just above). Never fires for an account that is
                        // merely sitting in a Restricted username_status without having completed
                        // that transition — e.g. one already Restricted for an unrelated reason
                        // (job-order provisioning) that this sweep did not touch.
                        $isMerelyRestricted = strcasecmp((string) ($technicalDetail->username_status ?? ''), 'Restricted') === 0;

                        if ($isMerelyRestricted) {
                            $this->writeLog("  [SMS] Skipped — username_status is merely Restricted, not a completed disconnect");
                        } elseif ($this->smsService && $account->customer && $account->customer->contact_number_primary) {
                            $this->writeLog("  [SMS] Sending prepaid disconnect notification...");
                            $this->triggerSMS($account, 'Disconnected');
                            $this->writeLog("  [SMS] ✓ SMS sent");
                        } else {
                            $this->writeLog("  [SMS] Skipping (no SMS service or no contact number)");
                        }
                    } else {
                        $reason = $restrictResult['message'] ?? 'Unknown RADIUS error';
                        $this->writeLog("  [RADIUS] Restrict failed: {$reason}. Queueing for retry.");
                        \Log::channel('radiusrelated')->error('[PREPAID RESTRICT FAILURE] Account: ' . $accountNo . ' - Reason: ' . $reason);
                        $this->queueRadiusOperation(
                            $account,
                            $username,
                            $accountNo,
                            'restricted_user',
                            self::PREPAID_RESTRICTION_REMARKS,
                            'RADIUS restrict failed during prepaid restriction: ' . $reason
                        );
                        $queued++;
                        $this->writeLog("[{$counter}/{$totalCount}] ⧗ QUEUED for retry");
                    }
                } catch (Throwable $e) {
                    $skipped++;
                    $errors[] = "Account {$accountNo}: " . $e->getMessage();
                    $this->writeLog("[{$counter}/{$totalCount}] ✗ ERROR (isolated, continuing): " . $e->getMessage());
                    \Log::channel('radiusrelated')->error('[PREPAID RESTRICT EXCEPTION] Account: ' . $accountNo . ' - ' . $e->getMessage());
                }
            }

            $duration = Carbon::now()->diffInSeconds($startTime);
            $this->writeLog("");
            $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
            $this->writeLog("║         PREPAID RESTRICTION COMPLETE                          ║");
            $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
            $this->writeLog("Summary:");
            $this->writeLog("  • Total Prepaid: {$totalCount}");
            $this->writeLog("  • Restricted: {$restricted}");
            $this->writeLog("  • Queued for Retry: {$queued}");
            $this->writeLog("  • Skipped: {$skipped}");
            $this->writeLog("  • Errors: " . count($errors));
            $this->writeLog("  • Duration: {$duration} second(s)");
            $this->writeLog("");

            return ['success' => true, 'restricted' => $restricted, 'skipped' => $skipped, 'queued' => $queued, 'errors' => $errors, 'duration' => $duration];

        } catch (Throwable $e) {
            $duration = Carbon::now()->diffInSeconds($startTime);
            $this->writeLog("[CRITICAL] Prepaid restriction process failed: " . $e->getMessage());
            $this->writeLog("[TRACE] " . $e->getTraceAsString());
            return ['success' => false, 'restricted' => $restricted, 'skipped' => $skipped, 'queued' => $queued, 'errors' => $errors, 'error' => $e->getMessage(), 'duration' => $duration];
        }
    }

    /**
     * Process automatic pullout requests
     */
    public function processAutoPullout(): array
    {
        $this->writeLog("");
        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         STARTING AUTO PULLOUT PROCESS                          ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $startTime = Carbon::now();
        $this->writeLog("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $this->writeLog("");

        try {
            $config = BillingConfig::first();
            
            if (!$config) {
                $this->writeLog("[ERROR] Billing configuration not found");
                throw new Exception("Billing configuration not found");
            }

            $pulloutOffset = $config->pullout_day ?? $config->pullout_offset ?? 30;
            
            if ($pulloutOffset <= 0) {
                $this->writeLog("[INFO] Auto Pullout is disabled (pullout_day = 0)");
                return [
                    'success' => true,
                    'created' => 0,
                    'skipped' => 0,
                    'errors' => [],
                    'duration' => 0
                ];
            }

            $targetDate = Carbon::today()->subDays($pulloutOffset)->format('Y-m-d');
            
            $this->writeLog("[CONFIG] Pullout Day Offset: {$pulloutOffset} days");
            $this->writeLog("[CONFIG] Target Due Date: {$targetDate}");
            $this->writeLog("");

            // Fetch overdue invoices for pullout
            $this->writeLog("[QUERY] Searching for pullout candidates...");
            $invoices = Invoice::with(['billingAccount.customer', 'billingAccount.technicalDetails'])
                ->whereIn('status', ['Unpaid', 'Partial'])
                ->whereDate('due_date', $targetDate)
                ->get();

            $totalCount = $invoices->count();
            $this->writeLog("[RESULT] Found {$totalCount} invoice(s) with due date = {$targetDate}");
            $this->writeLog("");

            if ($totalCount === 0) {
                $this->writeLog("[INFO] No invoices to process for pullout today.");
                $this->writeLog("[INFO] Criteria: Status IN ('Unpaid', 'Partial') AND Due Date = {$targetDate}");
                $endTime = Carbon::now();
                $duration = $endTime->diffInSeconds($startTime);
                $this->writeLog("");
                $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
                $this->writeLog("║         AUTO PULLOUT COMPLETE (No Actions)                     ║");
                $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
                $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
                $this->writeLog("Duration: {$duration} second(s)");
                $this->writeLog("");
                
                return [
                    'success' => true,
                    'created' => 0,
                    'skipped' => 0,
                    'errors' => [],
                    'duration' => $duration
                ];
            }

            $this->writeLog("[PROCESS] Starting pullout request creation...");
            $this->writeLog("─────────────────────────────────────────────────────────────────");

            $createdCount = 0;
            $skippedCount = 0;
            $errors = [];
            $counter = 0;

            foreach ($invoices as $invoice) {
                $counter++;
                $accountNo = $invoice->account_no;
                
                $this->writeLog("");
                $this->writeLog("[{$counter}/{$totalCount}] ══════════════════════════════════════════════");
                $this->writeLog("[ACCOUNT] {$accountNo}");
                
                try {
                    // Check if pullout request already exists for this month
                    $existingPullout = ServiceOrder::where('account_no', $accountNo)
                        ->whereIn('concern', ['Pullout', 'For Pullout', 'for pullout'])
                        ->whereNotIn('support_status', ['Closed', 'Cancelled'])
                        ->whereMonth('created_at', Carbon::now()->month)
                        ->whereYear('created_at', Carbon::now()->year)
                        ->exists();

                    if ($existingPullout) {
                        $this->writeLog("  [SKIP] Pullout request already exists for this month");
                        $this->writeLog("[{$counter}/{$totalCount}] ⊘ SKIPPED");
                        $skippedCount++;
                        continue;
                    }

                    $billingAccount = $invoice->billingAccount;
                    if (!$billingAccount) {
                        $this->writeLog("  [SKIP] Billing account not found");
                        $this->writeLog("[{$counter}/{$totalCount}] ⊘ SKIPPED");
                        $skippedCount++;
                        continue;
                    }

                    // Prepaid accounts are never pulled out by the postpaid overdue flow.
                    if (\App\Models\BillingAccount::isPrepaidType($billingAccount->generation_type ?? null)) {
                        $this->writeLog("  [SKIP] Prepaid account — not subject to postpaid pullout");
                        $this->writeLog("[{$counter}/{$totalCount}] ⊘ SKIPPED");
                        $skippedCount++;
                        continue;
                    }

                    $statusName = $billingAccount->billingStatus ? $billingAccount->billingStatus->status_name : null;

                    // Comped accounts are out of the overdue flow entirely — same reasoning as the
                    // VIP guard in processDisconnection(). Pulling out a VIP over an invoice it was
                    // never going to pay would send a technician to collect a live customer's ONU.
                    if (strcasecmp(trim((string) $statusName), 'VIP') === 0) {
                        $this->writeLog("  [SKIP] VIP account — comped, never pulled out for non-payment");
                        $this->writeLog("[{$counter}/{$totalCount}] ⊘ SKIPPED");
                        $skippedCount++;
                        continue;
                    }

                    // Check if account is already Pullout or Disconnected - skip entirely
                    if (in_array($statusName, ['Pullout', 'Disconnected', 'Pullout Restricted'])) {
                        $this->writeLog("  [SKIP] Account status is already {$statusName} - no action needed");
                        $this->writeLog("[{$counter}/{$totalCount}] ⊘ SKIPPED");
                        $skippedCount++;
                        continue;
                    }

                    // Get technical details for RADIUS username
                    $technicalDetail = $billingAccount->technicalDetails->first();
                    if (!$technicalDetail || empty($technicalDetail->username)) {
                        $this->writeLog("  [SKIP] PPPoE username not found");
                        $this->writeLog("[{$counter}/{$totalCount}] ⊘ SKIPPED");
                        $skippedCount++;
                        continue;
                    }

                    $username = $technicalDetail->username;
                    $this->writeLog("  [INFO] Username: {$username}");

                    // 1. Create pullout service order
                    $this->writeLog("  [CREATE] Creating pullout service order...");
                    $this->createPulloutRequest($billingAccount, $pulloutOffset);
                    $this->writeLog("  [CREATE] ✓ Pullout service order created");

                    // 2. Restrict user via RADIUS (also creates disconnected_logs entry)
                    $this->writeLog("  [RADIUS] Restricting user via RADIUS...");
                    $restrictResult = $this->radiusService->restrictedUser([
                        'username' => $username,
                        'accountNumber' => $accountNo,
                        'remarks' => 'Pullout',
                        'updatedBy' => 'System'
                    ]);

                    if ($restrictResult['status'] === 'success') {
                        $this->writeLog("  [RADIUS] ✓ Successfully restricted");
                    } else {
                        $reason = $restrictResult['message'] ?? 'Unknown';
                        $this->writeLog("  [RADIUS] ✗ Restrict failed: " . $reason);
                        \Log::channel('radiusrelated')->error('[AUTO PULLOUT RADIUS FAILURE] Account: ' . $accountNo . ' - Reason: ' . $reason);
                        // Queue the restriction so the RADIUS side is retried once the server recovers.
                        $this->queueRadiusOperation(
                            $billingAccount,
                            $username,
                            $accountNo,
                            'restricted_user',
                            'Pullout',
                            'RADIUS restrict failed during auto-pullout: ' . $reason
                        );
                    }

                    // 3. Update billing status to Inactive
                    $inactiveStatusId = DB::table('billing_status')->where('status_name', 'Inactive')->value('id') ?? 4;
                    DB::table('billing_accounts')
                        ->where('id', $billingAccount->id)
                        ->update([
                            'billing_status_id' => $inactiveStatusId,
                            'updated_by' => 'System',
                            'updated_at' => Carbon::now()
                        ]);
                    $this->writeLog("  [DB] ✓ Billing status updated to Inactive (ID: {$inactiveStatusId})");

                    // 4. Send SMS notification
                    if ($this->smsService && $billingAccount->customer && $billingAccount->customer->contact_number_primary) {
                        $this->writeLog("  [SMS] Sending pullout notification...");
                        $this->triggerSMS($billingAccount, 'Disconnected');
                        $this->writeLog("  [SMS] ✓ SMS sent");
                    } else {
                        $this->writeLog("  [SMS] Skipping (no SMS service or no contact number)");
                    }

                    // 5. Send Email notification
                    if ($this->emailQueueService && $billingAccount->customer && $billingAccount->customer->email_address) {
                        $this->writeLog("  [EMAIL] Sending pullout notification...");
                        $this->triggerEmail($billingAccount);
                        $this->writeLog("  [EMAIL] ✓ Email queued");
                    } else {
                        $this->writeLog("  [EMAIL] Skipping (no email service or no email address)");
                    }

                    $createdCount++;
                    $this->writeLog("  [COMPLETE] Pullout fully processed for {$accountNo}");
                    $this->writeLog("[{$counter}/{$totalCount}] ✓ SUCCESS");

                } catch (Exception $e) {
                    $this->writeLog("  [ERROR] " . $e->getMessage());
                    $this->writeLog("  [TRACE] " . $e->getTraceAsString());
                    $this->writeLog("[{$counter}/{$totalCount}] ✗ ERROR");
                    $errors[] = "Account {$accountNo}: " . $e->getMessage();
                    $skippedCount++;
                }
            }

            $endTime = Carbon::now();
            $duration = $endTime->diffInSeconds($startTime);
            
            $this->writeLog("");
            $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
            $this->writeLog("║         AUTO PULLOUT COMPLETE                                  ║");
            $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
            $this->writeLog("Summary:");
            $this->writeLog("  • Total Found: {$totalCount}");
            $this->writeLog("  • Service Orders Created: {$createdCount}");
            $this->writeLog("  • Skipped: {$skippedCount}");
            $this->writeLog("  • Errors: " . count($errors));
            $this->writeLog("  • Duration: {$duration} second(s)");
            $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
            $this->writeLog("");

            if (!empty($errors)) {
                $this->writeLog("[ERROR DETAILS]");
                foreach ($errors as $error) {
                    $this->writeLog("  × {$error}");
                }
                $this->writeLog("");
            }

            return [
                'success' => true,
                'created' => $createdCount,
                'skipped' => $skippedCount,
                'errors' => $errors,
                'duration' => $duration
            ];

        } catch (Exception $e) {
            $endTime = Carbon::now();
            $duration = $endTime->diffInSeconds($startTime);
            
            $this->writeLog("");
            $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
            $this->writeLog("║         CRITICAL ERROR                                         ║");
            $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
            $this->writeLog("[CRITICAL] " . $e->getMessage());
            $this->writeLog("[TRACE] " . $e->getTraceAsString());
            $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
            $this->writeLog("Duration: {$duration} second(s)");
            $this->writeLog("");
            
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    /**
     * Raise pullout service orders for prepaid customers who never came back.
     *
     * A prepaid account is restricted (and flipped to Inactive) by {@see processPrepaidRestrictions()}
     * as soon as its rolling service period lapses. If it is still sitting Inactive `pullout_day`
     * days after that expiry, the customer has not renewed and the equipment is scheduled for
     * retrieval — this raises the pullout service order the field team works from.
     *
     * Unlike the postpaid {@see processAutoPullout()}, this does NOT touch RADIUS or the billing
     * status: the account is already restricted and Inactive, so the only outstanding action is the
     * service order. That also makes the pass safe to run repeatedly.
     *
     * Idempotent & fault-isolated:
     *   - An account with a live pullout service order (any concern spelling, in any state other
     *     than Completed/Cancelled/Failed) is skipped, so re-running never stacks duplicates.
     *   - Each account is processed in its own try/catch; one bad row never aborts the run.
     *
     * Steps are written to storage/logs/autodisconnect/auto_dc_YYYY-MM-DD.log.
     *
     * @return array{success:bool, created:int, skipped:int, errors:array, duration:int}
     */
    public function processPrepaidAutoPullout(): array
    {
        $logFile = 'auto_dc_' . Carbon::now()->format('Y-m-d') . '.log';
        $log = fn (string $message) => $this->writeLog($message, $logFile);

        $log("");
        $log("╔════════════════════════════════════════════════════════════════╗");
        $log("║         STARTING PREPAID AUTO PULLOUT PROCESS                  ║");
        $log("╚════════════════════════════════════════════════════════════════╝");
        $startTime = Carbon::now();
        $log("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $log("");

        $createdCount = 0;
        $skippedCount = 0;
        $errors = [];

        try {
            $config = BillingConfig::first();

            if (!$config) {
                $log("[ERROR] Billing configuration not found");
                throw new Exception("Billing configuration not found");
            }

            // Same fallback chain as the postpaid pullout so both flows honour one configured offset.
            $pulloutDay = (int) ($config->pullout_day ?? $config->pullout_offset ?? 30);

            if ($pulloutDay <= 0) {
                $log("[INFO] Prepaid Auto Pullout is disabled (pullout_day = 0)");
                $duration = Carbon::now()->diffInSeconds($startTime);
                return [
                    'success' => true,
                    'created' => 0,
                    'skipped' => 0,
                    'errors' => [],
                    'duration' => $duration,
                ];
            }

            $inactiveStatusId = DB::table('billing_status')->where('status_name', 'Inactive')->value('id') ?? 4;

            $log("[CONFIG] Pullout Day Offset: {$pulloutDay} day(s) after prepaid expiry");
            $log("[CONFIG] Target Billing Status: Inactive (ID: {$inactiveStatusId})");
            $log("");

            // Prepaid accounts left Inactive for pullout_day days past their expiry date.
            $log("[QUERY] Searching for prepaid pullout candidates...");
            $accounts = BillingAccount::with(['customer'])
                ->whereIn('generation_type', BillingAccount::PREPAID_ALIASES)
                ->where('billing_status_id', $inactiveStatusId)
                ->whereNotNull('prepaid_expires_at')
                ->whereRaw('DATE_ADD(prepaid_expires_at, INTERVAL ? DAY) <= NOW()', [$pulloutDay])
                ->get();

            $totalCount = $accounts->count();
            $log("[RESULT] Found {$totalCount} inactive prepaid account(s) past expiry + {$pulloutDay} day(s)");
            $log("");

            if ($totalCount === 0) {
                $log("[INFO] No prepaid accounts to process for pullout today.");
                $log("[INFO] Criteria: Prepaid AND Inactive AND (prepaid_expires_at + {$pulloutDay}d) <= now");
                $endTime = Carbon::now();
                $duration = $endTime->diffInSeconds($startTime);
                $log("");
                $log("╔════════════════════════════════════════════════════════════════╗");
                $log("║         PREPAID AUTO PULLOUT COMPLETE (No Actions)             ║");
                $log("╚════════════════════════════════════════════════════════════════╝");
                $log("End Time: " . $endTime->format('Y-m-d H:i:s'));
                $log("Duration: {$duration} second(s)");
                $log("");

                return [
                    'success' => true,
                    'created' => 0,
                    'skipped' => 0,
                    'errors' => [],
                    'duration' => $duration,
                ];
            }

            $log("[PROCESS] Starting prepaid pullout request creation...");
            $log("─────────────────────────────────────────────────────────────────");

            $counter = 0;

            foreach ($accounts as $account) {
                $counter++;
                $accountNo = $account->account_no;

                $log("");
                $log("[{$counter}/{$totalCount}] ══════════════════════════════════════════════");
                $log("[ACCOUNT] {$accountNo}");

                // Isolate each customer: a single unexpected failure must never abort the run.
                try {
                    $expiry = Carbon::parse($account->prepaid_expires_at);
                    $dueDate = $expiry->copy()->addDays($pulloutDay);
                    $log(
                        "  [INFO] Prepaid expiry: {$expiry->format('Y-m-d H:i')}"
                        . " | pullout due: {$dueDate->format('Y-m-d')}"
                        . " | days past due: {$dueDate->diffInDays(Carbon::now())}"
                    );

                    // Dedup guard: a pullout that is still open (or has no status yet) blocks a new
                    // one. NULL statuses are matched explicitly — `status NOT IN (...)` evaluates to
                    // NULL for them in SQL, which would silently let duplicates through.
                    $existingPullout = ServiceOrder::where('account_no', $accountNo)
                        ->whereIn('concern', self::PULLOUT_CONCERNS)
                        ->where(function ($query) {
                            $query->whereNull('status')
                                ->orWhereNotIn('status', self::PULLOUT_CLOSED_STATUSES);
                        })
                        ->exists();

                    if ($existingPullout) {
                        $log("  [SKIP] An open pullout service order already exists");
                        $log("[{$counter}/{$totalCount}] ⊘ SKIPPED");
                        $skippedCount++;
                        continue;
                    }

                    $log("  [CREATE] Creating prepaid pullout service order...");
                    $serviceOrderId = $this->createPrepaidPulloutRequest($account);
                    $createdCount++;
                    $log("  [CREATE] ✓ Service order #{$serviceOrderId} created (concern: Pullout, status: Pending)");
                    $log("  [COMPLETE] Prepaid pullout raised for {$accountNo}");
                    $log("[{$counter}/{$totalCount}] ✓ SUCCESS");

                } catch (Throwable $e) {
                    $log("  [ERROR] " . $e->getMessage());
                    $log("  [TRACE] " . $e->getTraceAsString());
                    $log("[{$counter}/{$totalCount}] ✗ ERROR");
                    $errors[] = "Account {$accountNo}: " . $e->getMessage();
                    $skippedCount++;
                }
            }

            $endTime = Carbon::now();
            $duration = $endTime->diffInSeconds($startTime);

            $log("");
            $log("╔════════════════════════════════════════════════════════════════╗");
            $log("║         PREPAID AUTO PULLOUT COMPLETE                          ║");
            $log("╚════════════════════════════════════════════════════════════════╝");
            $log("Summary:");
            $log("  • Total Found: {$totalCount}");
            $log("  • Service Orders Created: {$createdCount}");
            $log("  • Skipped: {$skippedCount}");
            $log("  • Errors: " . count($errors));
            $log("  • Duration: {$duration} second(s)");
            $log("End Time: " . $endTime->format('Y-m-d H:i:s'));
            $log("");

            if (!empty($errors)) {
                $log("[ERROR DETAILS]");
                foreach ($errors as $error) {
                    $log("  × {$error}");
                }
                $log("");
            }

            return [
                'success' => true,
                'created' => $createdCount,
                'skipped' => $skippedCount,
                'errors' => $errors,
                'duration' => $duration,
            ];

        } catch (Throwable $e) {
            $endTime = Carbon::now();
            $duration = $endTime->diffInSeconds($startTime);

            $log("");
            $log("╔════════════════════════════════════════════════════════════════╗");
            $log("║         CRITICAL ERROR                                         ║");
            $log("╚════════════════════════════════════════════════════════════════╝");
            $log("[CRITICAL] " . $e->getMessage());
            $log("[TRACE] " . $e->getTraceAsString());
            $log("End Time: " . $endTime->format('Y-m-d H:i:s'));
            $log("Duration: {$duration} second(s)");
            $log("");

            return [
                'success' => false,
                'created' => $createdCount,
                'skipped' => $skippedCount,
                'errors' => $errors,
                'error' => $e->getMessage(),
                'duration' => $duration,
            ];
        }
    }

    /**
     * Create the pullout service order for a lapsed prepaid account.
     *
     * Attributes are assigned individually rather than mass-assigned: ServiceOrder's $fillable
     * carries the legacy capitalised column names, so ServiceOrder::create() would silently drop
     * account_no and concern.
     *
     * customer_id / remarks are only written when the deployed schema actually has them — the
     * columns are absent from the current service_orders migration, and concern_remarks is where
     * this codebase records the reason a service order exists.
     *
     * @return int The new service order id.
     */
    private function createPrepaidPulloutRequest(BillingAccount $billingAccount): int
    {
        $serviceOrder = new ServiceOrder();
        $serviceOrder->Timestamp = Carbon::now();
        $serviceOrder->account_no = $billingAccount->account_no;
        $serviceOrder->concern = 'Pullout';
        $serviceOrder->concern_remarks = self::PREPAID_PULLOUT_REMARKS;
        $serviceOrder->status = 'Pending';
        $serviceOrder->support_status = 'For Visit';
        $serviceOrder->requested_by = 'System';
        $serviceOrder->created_by_user = 'System';
        $serviceOrder->updated_by_user = 'System';

        if (Schema::hasColumn('service_orders', 'customer_id')) {
            $serviceOrder->customer_id = $billingAccount->customer_id;
        }
        if (Schema::hasColumn('service_orders', 'remarks')) {
            $serviceOrder->remarks = self::PREPAID_PULLOUT_REMARKS;
        }

        $serviceOrder->save();

        return (int) $serviceOrder->id;
    }

    /**
     * Create a pullout service order
     */
    private function createPulloutRequest(BillingAccount $billingAccount, int $pulloutOffset): void
    {
        $serviceOrder = new ServiceOrder();
        $serviceOrder->Timestamp = Carbon::now();
        $serviceOrder->account_no = $billingAccount->account_no;
        $serviceOrder->support_status = 'For Visit';
        $serviceOrder->concern = 'for pullout';
        $serviceOrder->concern_remarks = "System Auto Generated (Overdue {$pulloutOffset} Days)";
        $serviceOrder->requested_by = 'System';
        $serviceOrder->created_by_user = 'System';
        $serviceOrder->updated_by_user = 'System';
        $serviceOrder->save();
    }

    /**
     * Trigger SMS notification
     */
    private function triggerSMS(BillingAccount $billingAccount, string $type): void
    {
        $this->writeLog("    [DEBUG] triggerSMS: Starting for Account {$billingAccount->account_no}");
        try {
            if (!$this->smsService) {
                $this->writeLog("    [DEBUG] triggerSMS: smsService is null");
                return;
            }

            $customer = $billingAccount->customer;
            if (!$customer || empty($customer->contact_number_primary)) {
                $this->writeLog("    [DEBUG] triggerSMS: Customer or primary contact missing");
                return;
            }
            $this->writeLog("    [DEBUG] triggerSMS: Target number: {$customer->contact_number_primary}");

            $planNameRaw = $billingAccount->plan->name ?? $customer->desired_plan ?? 'N/A';
            $message = $this->buildSmsMessage(
                $type, 
                $customer->full_name, 
                $billingAccount->account_no, 
                [
                    'balance' => number_format($billingAccount->account_balance, 2),
                    'plan_name' => $planNameRaw
                ]
            );
            $this->writeLog("    [DEBUG] triggerSMS: Message built: " . (empty($message) ? 'EMPTY' : 'OK'));

            if (!empty($message)) {
                $this->writeLog("    [DEBUG] triggerSMS: Calling send...");
                $result = $this->smsService->send([
                    'contact_no' => $customer->contact_number_primary,
                    'message' => $message
                ]);
                
                $success = $result['success'] ?? false;
                $this->writeLog("    [DEBUG] triggerSMS: send call completed. Success: " . ($success ? 'YES' : 'NO'));
                if (!$success) {
                    $this->writeLog("    [DEBUG] triggerSMS Error Details: " . ($result['error'] ?? 'Unknown error'));
                }
            }

        } catch (Throwable $e) {
            $this->writeLog("    [DEBUG] triggerSMS Error: " . $e->getMessage());
            $this->writeLog("    [DEBUG] triggerSMS Error Trace: " . $e->getTraceAsString());
            // Don't throw - SMS failure shouldn't stop the process
        }
    }

    /**
     * Trigger Email notification
     */
    private function triggerEmail(BillingAccount $billingAccount): void
    {
        $this->writeLog("    [DEBUG] triggerEmail: Starting for Account {$billingAccount->account_no}");
        try {
            if (!$this->emailQueueService) {
                $this->writeLog("    [DEBUG] triggerEmail: emailQueueService is null");
                return;
            }

            $customer = $billingAccount->customer;
            if (!$customer || empty($customer->email_address)) {
                $this->writeLog("    [DEBUG] triggerEmail: Customer or email address missing");
                return;
            }
            $this->writeLog("    [DEBUG] triggerEmail: Target email: {$customer->email_address}");

            // Find template
            $template = EmailTemplate::where('Template_Code', 'DISCONNECTED')->first();
            
            if (!$template) {
                 $this->writeLog("    [DEBUG] triggerEmail: DISCONNECTED template not found");
                 return;
            }
            
            // Use email_body as requested
            $body = $template->email_body;
            if (empty($body)) {
                 $this->writeLog("    [DEBUG] triggerEmail: email_body is empty in template");
                 return;
            }

            $this->writeLog("    [DEBUG] triggerEmail: Queueing email via template...");
            
            $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name ?? ''));
            $planNameRaw = $billingAccount->plan->name ?? $customer->desired_plan ?? 'N/A';
            $planNameFormatted = str_replace('₱', 'P', $planNameRaw);

            $emailData = [
                'customer_name' => $customerName,
                'account_no' => $billingAccount->account_no,
                'amount_due' => number_format($billingAccount->account_balance, 2),
                'balance' => number_format($billingAccount->account_balance, 2),
                'plan_name' => $planNameFormatted,
                'recipient_email' => $customer->email_address,
            ];

            $emailQueued = $this->emailQueueService->queueFromTemplate('DISCONNECTED', $emailData);
            
            if ($emailQueued) {
                $this->writeLog("    [DEBUG] triggerEmail: Email queued successfully via template.");
            } else {
                $this->writeLog("    [DEBUG] triggerEmail: Email failed to queue via template");
            }

        } catch (Throwable $e) {
            $this->writeLog("    [DEBUG] triggerEmail Error: " . $e->getMessage());
            $this->writeLog("    [DEBUG] triggerEmail Error Trace: " . $e->getTraceAsString());
        }
    }

    /**
     * Build SMS message based on type from database templates
     */
    private function buildSmsMessage(string $type, string $name, string $accountNo, array $data): string
    {
        try {
            // Find active template for this type
            $template = SMSTemplate::where('template_type', $type)
                ->where('is_active', true)
                ->first();

            if ($template) {
                $message = $template->message_content;
                
                // Common variable replacements
                $customerName = preg_replace('/\s+/', ' ', trim($name));
                $planNameFormatted = str_replace('₱', 'P', $data['plan_name'] ?? '');

                $message = str_replace('{{customer_name}}', $customerName, $message);
                $message = str_replace('{{account_no}}', $accountNo, $message);
                $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
                
                // Add balance if present in data
                if (isset($data['balance'])) {
                    $message = str_replace('{{amount_due}}', $data['balance'], $message);
                    $message = str_replace('{{balance}}', $data['balance'], $message);
                }

                return $this->replaceGlobalVariables($message);
            }

            $this->writeLog("    [DEBUG] buildSmsMessage: Template type '{$type}' not found or inactive. Falling back to default.");

            // Fallback hardcoded messages if template not found
            switch ($type) {
                case 'Disconnected':
                case 'dcTxt':
                    $balance = $data['balance'] ?? '0.00';
                    return $this->replaceGlobalVariables("DISCONNECTION NOTICE: Dear {{customer_name}}, your account ({{account_no}}) has been disconnected due to non-payment. Outstanding balance: PHP {{balance}}. Please settle immediately to restore service. Thank you!", $name, $accountNo, $balance);
                    
                default:
                    return '';
            }
        } catch (Throwable $e) {
            $this->writeLog("    [DEBUG] buildSmsMessage Error: " . $e->getMessage());
            return '';
        }
    }

    private function replaceGlobalVariables(string $message, string $name = '', string $accountNo = '', string $balance = ''): string
    {
        $portalUrl = 'sync.gowiser.ph';
        $brandName = \DB::table('form_ui')->value('brand_name') ?? 'Your ISP';

        $message = str_replace('{{portal_url}}', $portalUrl, $message);
        $message = str_replace('{{company_name}}', $brandName, $message);
        
        // Handle fallbacks if needed
        $name = preg_replace('/\s+/', ' ', trim($name));
        if ($name) $message = str_replace('{{customer_name}}', $name, $message);
        if ($accountNo) $message = str_replace('{{account_no}}', $accountNo, $message);
        if ($balance) $message = str_replace('{{balance}}', $balance, $message);

        return $message;
    }

    /**
     * Whether the RADIUS server is reachable right now (probe result cached for the run).
     *
     * A probe that throws is treated as "unreachable" so callers fall back to queueing
     * the operation rather than aborting.
     */
    private function isRadiusReachable(): bool
    {
        if ($this->radiusReachable !== null) {
            return $this->radiusReachable;
        }

        try {
            $this->radiusReachable = $this->radiusService->isRadiusReachable();
        } catch (Throwable $e) {
            $this->writeLog("  [RADIUS] Connectivity probe threw: " . $e->getMessage() . " — treating RADIUS as unreachable");
            $this->radiusReachable = false;
        }

        return $this->radiusReachable;
    }

    /**
     * Queue a RADIUS restrict/disconnect operation for the ProcessRadiusQueue cron to retry
     * when the RADIUS server can't be reached or the operation fails for a connection-related
     * reason.
     *
     * De-duplicates by (account_no, operation): a customer that already has a pending or
     * in-flight operation of the same type is never queued twice, so the whole job stays
     * safe to run repeatedly. The queued payload carries everything the retry needs
     * (customer, operation, username/remarks payload) plus the failure reason and timestamps.
     *
     * @return bool True when a row was queued (or an equivalent one already exists); false on failure.
     */
    private function queueRadiusOperation(
        BillingAccount $billingAccount,
        string $username,
        string $accountNo,
        string $operation,
        string $remarks,
        string $reason
    ): bool {
        try {
            // Dedup guard: skip if an identical operation is already waiting to run.
            $duplicate = DB::table('radius_operation_queue')
                ->where('account_no', $accountNo)
                ->where('operation', $operation)
                ->whereIn('status', ['pending', 'processing'])
                ->exists();

            if ($duplicate) {
                $this->writeLog("  [QUEUE] Skipped — a pending '{$operation}' operation already exists for {$accountNo}");
                return true;
            }

            $queued = RadiusQueueService::queue([
                'organization_id' => $billingAccount->organization_id ?? null,
                'source_type'     => 'auto_disconnect',
                'source_id'       => $billingAccount->id,
                'account_no'      => $accountNo,
                'operation'       => $operation,
                'params'          => [
                    'username'      => $username,
                    'accountNumber' => $accountNo,
                    'remarks'       => $remarks,
                    'updatedBy'     => 'System',
                ],
                'last_error'      => $reason,
                'created_by'      => 'System',
            ]);

            if ($queued) {
                $this->writeLog("  [QUEUE] ✓ Queued '{$operation}' for {$accountNo} (will retry later). Reason: {$reason}");
                \Log::channel('radiusrelated')->warning("[AUTO DC QUEUED] Account: {$accountNo} - '{$operation}' queued for retry. Reason: {$reason}");
                return true;
            }

            $this->writeLog("  [QUEUE] ✗ Failed to queue '{$operation}' for {$accountNo}");
            \Log::channel('radiusrelated')->error("[AUTO DC QUEUE FAILURE] Account: {$accountNo} - Could not queue '{$operation}'. Reason: {$reason}");
            return false;
        } catch (Throwable $e) {
            $this->writeLog("  [QUEUE] ✗ Exception while queueing '{$operation}' for {$accountNo}: " . $e->getMessage());
            \Log::channel('radiusrelated')->error("[AUTO DC QUEUE EXCEPTION] Account: {$accountNo} - " . $e->getMessage());
            return false;
        }
    }

    /**
     * Write to log file
     *
     * @param string      $fileName Log file to append to, relative to storage/logs/autodisconnect.
     *                              Defaults to the shared run log every other step writes to.
     */
    private function writeLog(string $message, string $fileName = 'auto_disconnect_pullout.log'): void
    {
        $timestamp = Carbon::now()->format('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] [{$this->logName}] {$message}";

        // Define directory and file path
        $logDir = storage_path('logs/autodisconnect');
        $logFile = $logDir . '/' . $fileName;

        // Check/Create Directory
        if (!file_exists($logDir)) {
            mkdir($logDir, 0755, true);
        }
        
        // Write to custom log file
        file_put_contents($logFile, $logMessage . PHP_EOL, FILE_APPEND);
        
        // Also log to Laravel default log
        Log::channel('single')->info("[{$this->logName}] {$message}");
    }

    /**
     * Toggle verbose file logging and CLI echo at runtime.
     *
     * @param bool $verbose Emit [VERBOSE] detail lines.
     * @param bool $cliEcho Mirror log lines to stdout when running in the CLI.
     */
    public function setVerbose(bool $verbose = true, bool $cliEcho = true): self
    {
        $this->verbose = $verbose;
        $this->cliEcho = $cliEcho;
        return $this;
    }

    /**
     * Normalize a fixed billing-cycle day into a valid real calendar date.
     *
     * normalizedDate = first day of target cycle month + (cycleDay - 1) days
     *
     * This lets billing-cycle day 30 exist even in months with fewer than 30 real
     * calendar days (e.g. February) by rolling the surplus into the next real month:
     *   - normalizeBillingCycleDate(2026, 2, 30) => 2026-03-02 (Feb has 28 real days)
     *   - normalizeBillingCycleDate(2028, 2, 30) => 2028-03-01 (Feb has 29 real days)
     */
    private function normalizeBillingCycleDate(int $year, int $month, int $cycleDay): Carbon
    {
        return Carbon::create($year, $month, 1, 0, 0, 0)->addDays($cycleDay - 1);
    }

    /**
     * Add a fixed number of billing-cycle days to a billing-cycle coordinate.
     *
     * Uses fixed 30-day billing-cycle arithmetic (day 31 never exists, day 30 always
     * exists) and then normalizes the result into a real calendar date. Month overflow
     * (including December → January of the next year) is handled correctly.
     *
     * @return array{date: Carbon, year: int, month: int, day: int}
     */
    private function addFixedBillingCycleDays(int $cycleYear, int $cycleMonth, int $cycleDay, int $offset): array
    {
        $totalDay = $cycleDay + $offset;
        $targetYear = $cycleYear;
        $targetMonth = $cycleMonth;

        while ($totalDay > self::BILLING_CYCLE_DAYS) {
            $totalDay -= self::BILLING_CYCLE_DAYS;
            $targetMonth++;
            if ($targetMonth > 12) {
                $targetMonth = 1;
                $targetYear++;
            }
        }

        $normalizedDate = $this->normalizeBillingCycleDate($targetYear, $targetMonth, $totalDay);

        return [
            'date' => $normalizedDate,
            'year' => $targetYear,
            'month' => $targetMonth,
            'day' => $totalDay,
        ];
    }

    /**
     * Resolve which billing-cycle days have their (billing day + $offset) fixed-cycle
     * date landing on $today.
     *
     * A given offset (<= 30) wraps at most one billing-cycle month, so a target that
     * lands in $today's month can only originate from this month's or the previous
     * month's billing cycle. Each qualifying billing-cycle day maps to exactly one
     * originating cycle.
     *
     * @return array<int, array{cycle_year:int, cycle_month:int, target: array}>
     *         Keyed by billing-cycle day.
     */
    private function resolveCycleDaysForTarget(Carbon $today, int $offset): array
    {
        $result = [];

        // A target lands at most floor(offset / 30) + 1 billing-cycle months after its
        // originating billing cycle, so we look back that many months (plus the current
        // one) to find every billing-cycle day whose target equals today. This keeps the
        // resolver correct even when config-driven offsets exceed 30 cycle days.
        $monthsBack = intdiv(max(0, $offset), self::BILLING_CYCLE_DAYS) + 1;

        for ($back = 0; $back <= $monthsBack; $back++) {
            $ref = $today->copy()->startOfMonth()->subMonths($back);
            $cycleYear = (int) $ref->year;
            $cycleMonth = (int) $ref->month;

            for ($day = 1; $day <= self::BILLING_CYCLE_DAYS; $day++) {
                $computed = $this->addFixedBillingCycleDays($cycleYear, $cycleMonth, $day, $offset);
                if ($computed['date']->isSameDay($today)) {
                    $result[$day] = [
                        'cycle_year' => $cycleYear,
                        'cycle_month' => $cycleMonth,
                        'target' => $computed,
                    ];
                }
            }
        }

        return $result;
    }

    /**
     * Resolve the fixed billing-cycle schedule offsets from BillingConfig.
     *
     * All offsets are expressed in fixed billing-cycle days measured from the billing day:
     *   due date         = billing day + due_date_day
     *   DC / restriction = due date    + disconnection_day
     *                    = billing day + (due_date_day + disconnection_day)
     *   coverage (proration window) = disconnection_day   (days from due date to DC)
     *   grace / additional invoice  = DC + ADDITIONAL_INVOICE_OFFSET_DAYS
     *
     * Falls back to the documented constants when a value is missing. A disconnection_day
     * of 0 disables auto-DC (and therefore the grace charge), matching the config UI where
     * "0 = disabled".
     *
     * NOTE: the grace/additional-invoice offset (days after DC) has no dedicated field in
     * billing_config, so it stays the ADDITIONAL_INVOICE_OFFSET_DAYS constant.
     *
     * The DC-notice date is informational only (the service has no notice channel) and is
     * measured as due date + disconnection_notice cycle days.
     *
     * @return array{due_offset:int, dc_after_due:int, dc_offset:int, notice_after_due:int, notice_offset:int, coverage:int, grace_after_dc:int, grace_offset:int, dc_enabled:bool}
     */
    private function getScheduleOffsets(?BillingConfig $config): array
    {
        $dueOffset      = (int) ($config->due_date_day ?? 0);
        $dcAfterDue     = (int) ($config->disconnection_day ?? self::DC_OFFSET_DAYS);
        $noticeAfterDue = (int) ($config->disconnection_notice ?? 0);
        $graceAfterDc   = self::ADDITIONAL_INVOICE_OFFSET_DAYS;
        $pulloutAfterDc = (int) ($config->pullout_day ?? $config->pullout_offset ?? 30);

        return [
            'due_offset'       => $dueOffset,
            'dc_after_due'     => $dcAfterDue,
            'dc_offset'        => $dueOffset + $dcAfterDue,
            'notice_after_due' => $noticeAfterDue,
            'notice_offset'    => $dueOffset + $noticeAfterDue,
            'coverage'         => $dcAfterDue,
            'grace_after_dc'   => $graceAfterDc,
            'grace_offset'     => $dueOffset + $dcAfterDue + $graceAfterDc,
            'pullout_after_dc' => $pulloutAfterDc,
            'pullout_offset'   => $dueOffset + $dcAfterDue + $pulloutAfterDc,
            'dc_enabled'       => $dcAfterDue > 0,
        ];
    }

    /**
     * Grace-period charge: generate prorated additional invoices for accounts whose
     * additional-invoice generation date is today (7 fixed billing-cycle days after the
     * DC/restriction date). Invoked by the console command right after processAutoDisconnect().
     *
     * additionalInvoiceDate = billing day + DC_OFFSET_DAYS + ADDITIONAL_INVOICE_OFFSET_DAYS
     *                         (all fixed billing-cycle days), normalized to a real date.
     *
     * Coverage is the fixed DC_OFFSET_DAYS (10 billing-cycle days) and proration always
     * divides the monthly fee by PRORATE_DIVISOR_DAYS (30), never by the real number of
     * calendar days in the month.
     *
     * @return array{success:bool, charged:int, skipped:int, errors:array, duration:int}
     */
    public function processGracePeriodCharge(): array
    {
        $this->writeLog("");
        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         STARTING GRACE PERIOD CHARGE (ADDITIONAL INVOICE)      ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $startTime = Carbon::now();
        $this->writeLog("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $this->writeVerbose("Runtime: PHP " . PHP_VERSION . " | SAPI: " . PHP_SAPI . " | Memory: " . $this->formatBytes(memory_get_usage(true)));

        $today = Carbon::today();
        $config = BillingConfig::first();
        $off = $this->getScheduleOffsets($config);

        $charged = 0;
        $skipped = 0;
        $errors = [];

        if (!$off['dc_enabled']) {
            $this->writeLog("[GRACE] Auto-DC is disabled (billing_config.disconnection_day = 0). No grace charges will be generated.");
            $duration = Carbon::now()->diffInSeconds($startTime);
            return ['success' => true, 'charged' => 0, 'skipped' => 0, 'errors' => [], 'duration' => $duration];
        }

        $totalOffset = $off['grace_offset'];
        $cycleMap = $this->resolveCycleDaysForTarget($today, $totalOffset);
        $billingDays = array_keys($cycleMap);

        if (empty($billingDays)) {
            $this->writeLog("[GRACE] No billing-cycle day resolves to an additional-invoice date of today. Nothing to generate.");
            $duration = Carbon::now()->diffInSeconds($startTime);
            return ['success' => true, 'charged' => 0, 'skipped' => 0, 'errors' => [], 'duration' => $duration];
        }

        $this->writeLog("[GRACE] Billing day(s) whose additional-invoice date is today (billing day + {$totalOffset} cycle days): " . implode(', ', $billingDays));

        // Only restricted/disconnected/pulled-out accounts qualify (any status except Active and Pending).
        $disconnectedStatusIds = DB::table('billing_status')
            ->whereNotIn('status_name', ['Active', 'Pending'])
            ->pluck('id')
            ->toArray();

        $latestInvoiceIds = DB::table('invoices')
            ->select(DB::raw('MAX(id) as id'))
            ->groupBy('account_no')
            ->pluck('id');

        $invoices = Invoice::with(['billingAccount.customer', 'billingAccount.plan', 'billingAccount.billingStatus'])
            ->whereIn('id', $latestInvoiceIds)
            ->whereIn('status', ['Unpaid', 'Partial'])
            ->whereHas('billingAccount', function ($query) use ($billingDays, $disconnectedStatusIds) {
                $query->whereIn('billing_day', $billingDays);
                if (!empty($disconnectedStatusIds)) {
                    $query->whereIn('billing_status_id', $disconnectedStatusIds);
                }
            })
            ->get();

        $totalCount = $invoices->count();
        $this->writeLog("[GRACE] Found {$totalCount} restricted/disconnected account(s) due for an additional invoice today.");
        $this->writeVerbose("Grace status filter status_ids=(" . implode(', ', $disconnectedStatusIds) . ")");

        if ($totalCount === 0) {
            $duration = Carbon::now()->diffInSeconds($startTime);
            return ['success' => true, 'charged' => 0, 'skipped' => 0, 'errors' => [], 'duration' => $duration];
        }

        $counter = 0;
        foreach ($invoices as $invoice) {
            $counter++;
            $accountNo = $invoice->account_no;
            $billingAccount = $invoice->billingAccount;

            $this->writeLog("");
            $this->writeLog("[GRACE][{$counter}/{$totalCount}] Account: {$accountNo}");
            $this->writeVerbose("Grace candidate: invoice#{$invoice->id} account={$accountNo} status={$invoice->status} balance=" . number_format(floatval($billingAccount->account_balance ?? 0), 2));

            if (!$billingAccount) {
                $this->writeLog("  [SKIP] Billing account not found");
                $skipped++;
                continue;
            }

            // Prepaid accounts don't accrue postpaid grace/proration charges.
            if (\App\Models\BillingAccount::isPrepaidType($billingAccount->generation_type ?? null)) {
                $this->writeLog("  [SKIP] Prepaid account — not subject to postpaid grace charge");
                $skipped++;
                continue;
            }

            $billingDay = (int) ($billingAccount->billing_day ?? 0);
            if (!isset($cycleMap[$billingDay])) {
                $this->writeLog("  [SKIP] Billing day {$billingDay} does not resolve to today");
                $skipped++;
                continue;
            }

            $cycle = $cycleMap[$billingDay];
            $cycleYear = $cycle['cycle_year'];
            $cycleMonth = $cycle['cycle_month'];

            // Fixed billing-cycle coordinates: billing -> due -> DC -> additional invoice.
            $normalizedBilling = $this->normalizeBillingCycleDate($cycleYear, $cycleMonth, $billingDay);
            $due = $this->addFixedBillingCycleDays($cycleYear, $cycleMonth, $billingDay, $off['due_offset']);
            $dc = $this->addFixedBillingCycleDays($cycleYear, $cycleMonth, $billingDay, $off['dc_offset']);
            $additional = $this->addFixedBillingCycleDays($dc['year'], $dc['month'], $dc['day'], $off['grace_after_dc']);

            // Dedup guard: generate at most once per account per generation date.
            $alreadyGenerated = DB::table('service_charge_logs')
                ->where('account_no', $accountNo)
                ->where('service_charge_type', self::ADDITIONAL_INVOICE_CHARGE_TYPE)
                ->whereDate('date_used', $today)
                ->exists();

            if ($alreadyGenerated) {
                $this->writeLog("  [SKIP] Additional invoice already generated today for this account");
                $skipped++;
                continue;
            }

            // Monthly fee comes from the account's plan price.
            $monthlyFee = floatval($billingAccount->plan->price ?? 0);
            if ($monthlyFee <= 0 && !empty($billingAccount->customer?->desired_plan)) {
                $desiredPlan = (string) $billingAccount->customer->desired_plan;
                $extractedName = $this->extractPlanName($desiredPlan);
                $fallbackPlan = DB::table('plan_list')->where('plan_name', $extractedName)->first();
                if ($fallbackPlan && floatval($fallbackPlan->price) > 0) {
                    $monthlyFee = floatval($fallbackPlan->price);
                }
            }

            if ($monthlyFee <= 0) {
                $this->writeLog("  [SKIP] Monthly fee (plan price) unavailable or zero");
                $skipped++;
                continue;
            }

            // Fixed 30-day proration over the due-date -> DC coverage window (disconnection_day).
            $coverageDays = $off['coverage'];
            $dailyRate = $monthlyFee / self::PRORATE_DIVISOR_DAYS;
            $proratedAmount = round($dailyRate * $coverageDays, 2);

            // Required logging of all computed values.
            $this->writeLog("  [CALC] Billing Day: {$billingDay}");
            $this->writeLog("  [CALC] Billing Cycle Year: {$cycleYear}");
            $this->writeLog("  [CALC] Billing Cycle Month: {$cycleMonth}");
            $this->writeLog("  [CALC] Normalized Billing Date: " . $normalizedBilling->format('Y-m-d'));
            $this->writeLog("  [CALC] Due Offset Days: {$off['due_offset']}");
            $this->writeLog("  [CALC] Normalized Due Date: " . $due['date']->format('Y-m-d'));
            $this->writeLog("  [CALC] DC Offset Days (from billing day): {$off['dc_offset']}");
            $this->writeLog("  [CALC] DC Cycle Day: {$dc['day']}");
            $this->writeLog("  [CALC] DC Cycle Month: {$dc['month']}");
            $this->writeLog("  [CALC] Normalized DC Date: " . $dc['date']->format('Y-m-d'));
            $this->writeLog("  [CALC] Additional Invoice Offset Days: {$off['grace_after_dc']}");
            $this->writeLog("  [CALC] Additional Invoice Cycle Day: {$additional['day']}");
            $this->writeLog("  [CALC] Additional Invoice Cycle Month: {$additional['month']}");
            $this->writeLog("  [CALC] Normalized Additional Invoice Date: " . $additional['date']->format('Y-m-d'));
            $this->writeLog("  [CALC] Monthly Fee: ₱" . number_format($monthlyFee, 2));
            $this->writeLog("  [CALC] Fixed Daily Rate (fee / " . self::PRORATE_DIVISOR_DAYS . "): ₱" . number_format($dailyRate, 2));
            $this->writeLog("  [CALC] Coverage Days (due→DC): {$coverageDays}");
            $this->writeLog("  [CALC] Prorated Amount: ₱" . number_format($proratedAmount, 2));

            DB::beginTransaction();
            try {
                $invoiceDate = $additional['date']->copy();
                $dueDate = $invoiceDate->copy()->addDays(self::ADDITIONAL_INVOICE_DUE_OFFSET_DAYS);

                $newInvoiceId = DB::table('invoices')->insertGetId([
                    'account_no' => $accountNo,
                    'invoice_date' => $invoiceDate,
                    'invoice_balance' => $proratedAmount,
                    'others_and_basic_charges' => 0.00,
                    'pro_rate' => $proratedAmount,
                    'pro_rate_start' => $normalizedBilling->toDateString(),
                    'service_charge' => 0.00,
                    'rebate' => 0.00,
                    'discounts' => 0.00,
                    'staggered' => 0.00,
                    'total_amount' => $proratedAmount,
                    'received_payment' => 0.00,
                    'due_date' => $dueDate,
                    'status' => 'Unpaid',
                    'payment_portal_log_ref' => null,
                    'transaction_id' => null,
                    'created_by' => 'System',
                    'updated_by' => 'System',
                    'created_at' => Carbon::now(),
                    'updated_at' => Carbon::now(),
                ]);

                // Marker for dedup + audit trail (mirrors the DC fee logging pattern).
                DB::table('service_charge_logs')->insert([
                    'account_no' => $accountNo,
                    'invoice_id' => $newInvoiceId,
                    'service_charge_type' => self::ADDITIONAL_INVOICE_CHARGE_TYPE,
                    'service_charge' => $proratedAmount,
                    'date_used' => Carbon::now(),
                    'created_at' => Carbon::now(),
                    'updated_at' => Carbon::now(),
                    'created_by' => 'System',
                    'updated_by' => 'System',
                ]);

                $currentBalance = floatval($billingAccount->account_balance);
                $newBalance = $currentBalance + $proratedAmount;
                DB::table('billing_accounts')
                    ->where('id', $billingAccount->id)
                    ->update([
                        'account_balance' => $newBalance,
                        'updated_by' => 'System',
                        'updated_at' => Carbon::now(),
                    ]);

                DB::commit();

                $this->writeLog("  [DB] ✓ Additional invoice #{$newInvoiceId} created (₱" . number_format($proratedAmount, 2) . "). New Balance: ₱" . number_format($newBalance, 2));
                $charged++;

            } catch (Throwable $e) {
                DB::rollBack();
                $this->writeLog("  [ERROR] Failed to generate additional invoice: " . $e->getMessage());
                $this->writeLog("  [TRACE] " . $e->getTraceAsString());
                $errors[] = "Account {$accountNo} (additional invoice): " . $e->getMessage();
                $skipped++;
            }
        }

        $duration = Carbon::now()->diffInSeconds($startTime);
        $this->writeLog("");
        $this->writeLog("[GRACE] Summary: Charged {$charged}, Skipped {$skipped}, Errors " . count($errors) . ", Duration {$duration}s");
        $this->writeVerbose("Peak memory: " . $this->formatBytes(memory_get_peak_usage(true)));

        return ['success' => true, 'charged' => $charged, 'skipped' => $skipped, 'errors' => $errors, 'duration' => $duration];
    }

    /**
     * Write an extra-detailed line that is only emitted when verbose mode is on.
     * Verbose lines are tagged [VERBOSE] and follow the same file + CLI echo path.
     */
    private function writeVerbose(string $message): void
    {
        if (!$this->verbose) {
            return;
        }
        $this->writeLog("[VERBOSE] {$message}");
    }

    /**
     * Echo a single line to stdout (CLI) and flush so output streams live.
     */
    private function echoCli(string $line): void
    {
        if (defined('STDOUT')) {
            @fwrite(STDOUT, $line . PHP_EOL);
        } else {
            echo $line . PHP_EOL;
        }
        @flush();
    }

    /**
     * Human-readable byte formatting for verbose memory logging.
     */
    private function formatBytes($bytes): string
    {
        $bytes = (float) $bytes;
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 2) . ' ' . $units[$i];
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
                if (Carbon::now()->lessThan($expiresAt)) {
                    $this->writeLog("[LOCK] Lock is held by another process. Expires at: " . $expiresAt->format('Y-m-d H:i:s'));
                    return false;
                }

                // Lock expired, clean it up
                $this->writeLog("[LOCK] Found expired lock. Cleaning up and acquiring new lock.");
                DB::table('worker_locks')
                    ->where('lock_name', $this->lockName)
                    ->delete();
            }

            // Try to acquire lock
            DB::table('worker_locks')->insert([
                'lock_name' => $this->lockName,
                'locked_at' => Carbon::now(),
                'locked_by' => gethostname() . ':' . getmypid(),
                'created_at' => Carbon::now()
            ]);

            $this->hasLock = true;
            $this->writeLog("[LOCK] Lock acquired successfully");
            return true;

        } catch (Exception $e) {
            // Unique constraint violation means another process got the lock first
            $this->writeLog("[LOCK] Failed to acquire lock: " . $e->getMessage());
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
                
                $this->writeLog("[LOCK] Lock released successfully");
                $this->hasLock = false;
            } catch (Exception $e) {
                $this->writeLog("[LOCK] Failed to release lock: " . $e->getMessage());
            }
        }
    }

    /**
     * Extract clean plan name from customers.desired_plan string
     */
    protected function extractPlanName(string $desiredPlan): string
    {
        // First handle " - " separator (e.g., "50Mbps - P800.00" -> "50Mbps")
        if (strpos($desiredPlan, ' - ') !== false) {
            $parts = explode(' - ', $desiredPlan);
            $desiredPlan = trim($parts[0]);
        }

        // Then handle space separator (e.g., "SWIFT 1000" -> "SWIFT")
        if (strpos($desiredPlan, ' ') !== false) {
            $parts = explode(' ', $desiredPlan);
            return trim($parts[0]);
        }

        return trim($desiredPlan);
    }
}

