<?php

namespace App\Services;

use App\Models\AppPlan;
use App\Models\BillingAccount;
use App\Models\PlanChangeLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

/**
 * Applies plan changes that a PREPAID customer buys from the customer app.
 *
 * A prepaid customer pays for a fixed service period up front, so a plan they select at
 * checkout must not take effect mid-period — they already paid for the plan they are on.
 * The rule this class implements:
 *
 *   - Period still running when the payment settles  ->  QUEUE the new plan, effective at the
 *                                                        moment the CURRENT period lapses.
 *   - Period already expired (or never started)      ->  APPLY the new plan immediately.
 *
 * It reads that distinction straight off {@see PrepaidRenewalService::renew()}'s return value,
 * which is the single source of truth for the prepaid window: mode 'extended' means the payment
 * landed inside a live period, and `previous_expiry` is exactly when that period ends. Relying
 * on the returned value (rather than re-reading prepaid_expires_at) matters because the renewal
 * has already moved that column forward by the time we run.
 *
 * Queued switches are applied by the `prepaid:apply-pending-plans` command.
 */
class PrepaidPlanChangeService
{
    /**
     * Status written to plan_change_logs for a prepaid plan switch.
     *
     * Deliberately NOT 'Unused': the billing generator consumes 'Unused' rows to PRORATE a
     * mid-cycle plan change (see EnhancedBillingGenerationServiceWithNotifications::
     * calculateProrateAmount). A prepaid switch happens exactly on a period boundary and the
     * customer has already paid the full new-plan price, so prorating it would bill the wrong
     * amount. This status keeps the audit trail without feeding the proration path.
     */
    protected const LOG_STATUS = 'Applied';

    /** Tag prefixed to every line in the dedicated log file. */
    private $logName = 'Prepaid_Plan';

    /** Mirror log lines to stdout when running under the CLI (so the cron output is readable). */
    private $cliEcho = true;

    /**
     * Write to the dedicated prepaid plan-change log, mirroring AutoDisconnectService::writeLog().
     *
     * A feature-specific file (storage/logs/prepaidplan/prepaid_plan_change.log) rather than the
     * shared laravel.log, so a run's account list can be read on its own. Also mirrored to the
     * default channel, and echoed to stdout under the CLI so `php artisan prepaid:apply-pending-plans`
     * shows the same detail.
     */
    private function writeLog(string $message): void
    {
        $timestamp = Carbon::now()->format('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] [{$this->logName}] {$message}";

        $logDir = storage_path('logs/prepaidplan');
        $logFile = $logDir . '/prepaid_plan_change.log';

        if (!file_exists($logDir)) {
            mkdir($logDir, 0755, true);
        }

        file_put_contents($logFile, $logMessage . PHP_EOL, FILE_APPEND);

        Log::channel('single')->info("[{$this->logName}] {$message}");

        if ($this->cliEcho && PHP_SAPI === 'cli') {
            echo $logMessage . PHP_EOL;
        }
    }

    /** Toggle stdout mirroring (the command turns it off to avoid double-printing). */
    public function setCliEcho(bool $cliEcho = true): self
    {
        $this->cliEcho = $cliEcho;
        return $this;
    }

    /**
     * Settle the prepaid side of a payment: renew the period, then act on any plan bought with it.
     *
     * The single entry point for BOTH payment pipelines (TransactionController on approval,
     * PaymentWorkerService on webhook settlement). They previously each called
     * PrepaidRenewalService and then handleSettledPayment() in sequence, which was fine while the
     * two steps were independent. "Activate Now" couples them — whether the period is RESET or
     * EXTENDED now depends on whether a genuine plan switch is happening — so the ordering and the
     * decision live here once rather than being duplicated and drifting apart.
     *
     * Safe to call unconditionally on every settled payment; postpaid accounts fall straight
     * through both steps untouched.
     *
     * @param bool $activateNow Customer opted to start the new plan immediately, forfeiting the
     *   days left on the current one. HONOURED ONLY when the selected plan actually differs from
     *   the one in force — see isGenuineSwitch(). A same-plan top-up with the box ticked would
     *   otherwise destroy the customer's remaining days and buy them nothing.
     *
     * @return array{renewal:array, plan_change:array}
     */
    public function settlePayment(
        string $accountNo,
        $selectedPlanId,
        bool $activateNow = false,
        ?Carbon $paymentDate = null
    ): array {
        $effectiveActivateNow = $activateNow && $this->isGenuineSwitch($accountNo, $selectedPlanId);

        if ($activateNow && !$effectiveActivateNow) {
            Log::info('[PREPAID PLAN] "Activate Now" ignored — no plan switch to activate', [
                'account_no' => $accountNo,
                'selected_plan_id' => $selectedPlanId,
            ]);
        }

        $renewal = app(PrepaidRenewalService::class)
            ->renewByAccountNo($accountNo, $paymentDate, $effectiveActivateNow);

        return [
            'renewal' => $renewal,
            'plan_change' => $this->handleSettledPayment($accountNo, $selectedPlanId, $renewal, $effectiveActivateNow),
        ];
    }

    /**
     * Is $selectedPlanId a real move off the plan currently in force?
     *
     * Deliberately conservative: anything it cannot positively confirm as a switch (missing
     * account, unknown plan, no selection) comes back false, so an unclear case extends the period
     * rather than forfeiting days the customer paid for.
     */
    protected function isGenuineSwitch(string $accountNo, $selectedPlanId): bool
    {
        if (empty($selectedPlanId)) {
            return false;
        }

        try {
            $account = BillingAccount::with('customer')->where('account_no', $accountNo)->first();

            if (!$account || !BillingAccount::isPrepaidType($account->generation_type)) {
                return false;
            }

            if (!AppPlan::find($selectedPlanId)) {
                return false;
            }

            $currentPlan = $this->resolveCurrentPlan($account);

            return !$currentPlan || (int) $currentPlan->id !== (int) $selectedPlanId;
        } catch (\Throwable $e) {
            Log::error('[PREPAID PLAN] Could not determine whether ' . $accountNo
                . ' is switching plan, treating as no switch: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Decide what to do with a plan the customer selected, at the point their payment settles.
     *
     * Safe to call unconditionally on every settled payment: it no-ops when no plan was
     * selected, when the account is not prepaid, or when the selected plan is the one they are
     * already on (a plain renewal).
     *
     * Prefer {@see settlePayment()}, which sequences this correctly against the period renewal.
     * This stays public for callers that have already renewed the period themselves.
     *
     * @param array $prepaidRenewal The array returned by PrepaidRenewalService::renew().
     * @param bool $activateNow Apply the switch immediately instead of queueing it. The caller is
     *   responsible for having passed the same flag to the renewal, so that the reset expiry and
     *   the immediate switch agree with each other.
     * @return array{action:string, reason?:string, plan?:string, effective_at?:string}
     */
    public function handleSettledPayment(string $accountNo, $selectedPlanId, array $prepaidRenewal, bool $activateNow = false): array
    {
        try {
            if (empty($selectedPlanId)) {
                return ['action' => 'none', 'reason' => 'no plan selected'];
            }

            // Only prepaid accounts have a period to queue against. PrepaidRenewalService
            // already made this determination; trust it rather than re-deriving it.
            if (empty($prepaidRenewal['prepaid'])) {
                return ['action' => 'none', 'reason' => 'not a prepaid account'];
            }

            $account = BillingAccount::with('customer')->where('account_no', $accountNo)->first();
            if (!$account || !$account->customer) {
                return ['action' => 'none', 'reason' => 'account or customer not found'];
            }

            $newPlan = AppPlan::find($selectedPlanId);
            if (!$newPlan) {
                Log::warning('[PREPAID PLAN] Selected plan no longer exists, leaving plan unchanged', [
                    'account_no' => $accountNo,
                    'selected_plan_id' => $selectedPlanId,
                ]);
                return ['action' => 'none', 'reason' => 'selected plan not found'];
            }

            $currentPlan = $this->resolveCurrentPlan($account);
            $pendingPlanId = $account->pending_plan_id ? (int) $account->pending_plan_id : null;
            $isSwitch = !$currentPlan || (int) $currentPlan->id !== (int) $newPlan->id;

            // "Activate Now": the customer asked for the new plan to start immediately and accepted
            // losing the rest of the period they had paid for. This OVERRIDES every queueing rule
            // below, including an existing reservation for this same plan — asking for it now is
            // precisely a request to stop waiting for it. applyPlan() clears the queue as part of
            // its transaction, so the reservation cannot outlive the switch it described.
            //
            // The renewal has already reset prepaid_expires_at to payment date + 30 (mode
            // 'activated'); this is the other half of that same decision. The $isSwitch guard is
            // belt-and-braces for direct callers — settlePayment() has already applied it via
            // isGenuineSwitch() — because forfeiting days to "switch" to the current plan is pure
            // loss to the customer.
            if ($activateNow && $isSwitch) {
                $applied = $this->applyPlan(
                    $account,
                    $newPlan,
                    'Prepaid plan change activated immediately at customer request',
                    $currentPlan?->id
                );

                $forfeited = (int) ($prepaidRenewal['forfeited_days'] ?? 0);

                Log::info('[PREPAID PLAN] Plan change activated immediately', [
                    'account_no' => $accountNo,
                    'from_plan' => $currentPlan->plan_name ?? null,
                    'to_plan' => $newPlan->plan_name,
                    'cancelled_queued_plan_id' => $pendingPlanId,
                    'forfeited_days' => $forfeited,
                    'new_expiry' => $prepaidRenewal['new_expiry'] ?? null,
                ]);
                $this->writeLog("[ACTIVATED NOW] {$accountNo} | " . ($currentPlan->plan_name ?? '(unknown)')
                    . " -> {$newPlan->plan_name} | {$forfeited} day(s) forfeited"
                    . ($pendingPlanId !== null ? " | queued plan id {$pendingPlanId} dropped" : '')
                    . " | RADIUS: {$applied['radius']}");

                return [
                    'action' => 'activated',
                    'plan' => $newPlan->plan_name,
                    'forfeited_days' => $forfeited,
                ];
            }

            // Already queued this exact plan: this payment is a top-up of a switch they have
            // already bought. Leave the reservation's effective date ALONE — re-queueing it at
            // the freshly extended expiry would push the switch further out every time they pay.
            if ($pendingPlanId !== null && $pendingPlanId === (int) $newPlan->id) {
                Log::info('[PREPAID PLAN] Payment tops up an already-queued plan; reservation left untouched', [
                    'account_no' => $accountNo,
                    'plan' => $newPlan->plan_name,
                    'effective_at' => (string) $account->pending_plan_effective_at,
                ]);

                return [
                    'action' => 'none',
                    'reason' => 'plan already queued — reservation kept',
                    'plan' => $newPlan->plan_name,
                    'effective_at' => (string) $account->pending_plan_effective_at,
                ];
            }

            if ($currentPlan && (int) $currentPlan->id === (int) $newPlan->id) {
                // Picking the plan that is actually in force while a different one is queued is
                // how a customer backs out of a switch they have not started yet.
                if ($pendingPlanId !== null) {
                    $this->clearPending($account->id);

                    Log::info('[PREPAID PLAN] Queued plan change cancelled — customer paid for the plan already in force', [
                        'account_no' => $accountNo,
                        'cancelled_plan_id' => $pendingPlanId,
                        'plan' => $newPlan->plan_name,
                    ]);
                    $this->writeLog("[CANCELLED] {$accountNo} | queued plan id {$pendingPlanId} dropped"
                        . " | customer paid for {$newPlan->plan_name}, which is already in force");

                    return ['action' => 'cancelled', 'plan' => $newPlan->plan_name];
                }

                return ['action' => 'none', 'reason' => 'same plan — plain renewal'];
            }

            $stillActive = ($prepaidRenewal['mode'] ?? null) === 'extended'
                && !empty($prepaidRenewal['previous_expiry']);

            if ($stillActive) {
                // The customer is mid-period on the plan they already paid for. Hold the switch
                // until that period lapses; desired_plan (and therefore their speed and their
                // next bill) stays untouched until then.
                $effectiveAt = Carbon::parse($prepaidRenewal['previous_expiry']);

                DB::table('billing_accounts')
                    ->where('id', $account->id)
                    ->update([
                        'pending_plan_id' => $newPlan->id,
                        'pending_plan_effective_at' => $effectiveAt,
                        'updated_by' => 'Prepaid Plan Change',
                        'updated_at' => Carbon::now(),
                    ]);

                Log::info('[PREPAID PLAN] Plan change queued until current period lapses', [
                    'account_no' => $accountNo,
                    'from_plan' => $currentPlan->plan_name ?? null,
                    'to_plan' => $newPlan->plan_name,
                    'effective_at' => $effectiveAt->toDateTimeString(),
                ]);
                $this->writeLog("[QUEUED] {$accountNo} | " . ($currentPlan->plan_name ?? '(unknown)')
                    . " -> {$newPlan->plan_name} | takes effect {$effectiveAt->toDateTimeString()}");

                return [
                    'action' => 'queued',
                    'plan' => $newPlan->plan_name,
                    'effective_at' => $effectiveAt->toDateTimeString(),
                ];
            }

            // Period had already lapsed (or never started) — the new plan starts now.
            $applied = $this->applyPlan($account, $newPlan, 'Prepaid plan change paid after period expiry', $currentPlan?->id);

            $this->writeLog("[APPLIED NOW] {$accountNo} | " . ($currentPlan->plan_name ?? '(unknown)')
                . " -> {$newPlan->plan_name} | period had lapsed | RADIUS: {$applied['radius']}");

            return ['action' => 'applied', 'plan' => $newPlan->plan_name];
        } catch (\Throwable $e) {
            // A plan-change failure must never break the payment pipeline — the payment is real
            // either way, and the queued switch can be repaired by hand.
            Log::error('[PREPAID PLAN] handleSettledPayment failed for ' . $accountNo . ': ' . $e->getMessage());
            return ['action' => 'none', 'reason' => 'error: ' . $e->getMessage()];
        }
    }

    /**
     * Apply every queued plan change whose effective date has arrived.
     *
     * Driven by the `prepaid:apply-pending-plans` command. Each account is isolated so one
     * failure never aborts the batch.
     *
     * @return array{due:int, applied:int, failed:int, errors:array, accounts:array}
     */
    public function applyDuePendingPlans(?Carbon $now = null): array
    {
        $now = $now ? $now->copy() : Carbon::now();
        $results = ['due' => 0, 'applied' => 0, 'failed' => 0, 'errors' => [], 'accounts' => []];

        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         STARTING PREPAID PLAN CHANGE PROCESS                   ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $startTime = Carbon::now();
        $this->writeLog("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $this->writeLog("Cut-off   : " . $now->format('Y-m-d H:i:s') . " (applying switches effective on or before this)");
        $this->writeLog("");

        $accounts = BillingAccount::with('customer')
            ->whereNotNull('pending_plan_id')
            ->whereNotNull('pending_plan_effective_at')
            ->where('pending_plan_effective_at', '<=', $now)
            ->get();

        $results['due'] = $accounts->count();

        if ($accounts->isEmpty()) {
            $endTime = Carbon::now();
            $this->writeLog("[INFO] No prepaid plan changes are due. Nothing to process.");
            $this->writeLog("");
            $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
            $this->writeLog("║         PREPAID PLAN CHANGE COMPLETE (No Actions)              ║");
            $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
            $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
            $this->writeLog("Duration: " . $endTime->diffInSeconds($startTime) . " second(s)");
            $this->writeLog("");
            $this->writeLog("");

            return $results;
        }

        $totalCount = $accounts->count();
        $this->writeLog("[QUERY] Found {$totalCount} account(s) with a plan change due");
        $this->writeLog("─────────────────────────────────────────────────────────────────");
        $this->writeLog("");

        $counter = 0;
        foreach ($accounts as $account) {
            $counter++;
            $effectiveAt = $account->pending_plan_effective_at
                ? Carbon::parse($account->pending_plan_effective_at)->format('Y-m-d H:i:s')
                : 'unknown';

            $this->writeLog("[{$counter}/{$totalCount}] ══════════════════════════════════════════════");
            $this->writeLog("  [ACCOUNT] {$account->account_no} | Customer: " . ($account->customer->full_name ?? 'N/A'));
            $this->writeLog("  [ACCOUNT] Switch was scheduled for: {$effectiveAt}");

            try {
                $newPlan = AppPlan::find($account->pending_plan_id);
                if (!$newPlan) {
                    // The plan was deleted while queued. Clear the queue rather than retrying
                    // this account every single hour forever.
                    $this->clearPending($account->id);
                    $results['failed']++;
                    $error = 'queued plan ' . $account->pending_plan_id . ' no longer exists — queue cleared';
                    $results['errors'][] = ['account_no' => $account->account_no, 'error' => $error];

                    $this->writeLog("  [RESULT] ✗ FAILED - {$error}");
                    $this->writeLog("");
                    continue;
                }

                $currentPlan = $this->resolveCurrentPlan($account);
                $fromName = $currentPlan->plan_name ?? '(unknown)';
                $this->writeLog("  [PLAN] {$fromName} -> {$newPlan->plan_name}");

                $applied = $this->applyPlan(
                    $account,
                    $newPlan,
                    'Prepaid plan change took effect at period expiry',
                    $currentPlan?->id
                );

                $results['applied']++;
                $results['accounts'][] = [
                    'account_no' => $account->account_no,
                    'customer' => $account->customer->full_name ?? null,
                    'from_plan' => $fromName,
                    'to_plan' => $newPlan->plan_name,
                    'effective_at' => $effectiveAt,
                    'radius' => $applied['radius'],
                ];

                $this->writeLog("  [DB] desired_plan and plan_id updated, queue cleared, change logged");
                $this->writeLog("  [RADIUS] " . match ($applied['radius']) {
                    'success' => '✓ group updated',
                    'queued_for_retry' => '⚠ push failed — queued in radius_operation_queue for retry',
                    'no_username' => '⚠ skipped, no RADIUS username on the account',
                    default => $applied['radius'],
                });
                $this->writeLog("  [RESULT] ✓ SUCCESS");
                $this->writeLog("");
            } catch (\Throwable $e) {
                $results['failed']++;
                $results['errors'][] = ['account_no' => $account->account_no, 'error' => $e->getMessage()];

                $this->writeLog("  [RESULT] ✗ EXCEPTION - " . $e->getMessage());
                $this->writeLog("  [TRACE] " . $e->getTraceAsString());
                $this->writeLog("");
            }
        }

        $endTime = Carbon::now();
        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         PREPAID PLAN CHANGE COMPLETE                           ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $this->writeLog("Summary:");
        $this->writeLog("  • Total Due: {$results['due']}");
        $this->writeLog("  • Successfully Applied: {$results['applied']}");
        $this->writeLog("  • Failed: {$results['failed']}");

        // The explicit roster of what changed — the point of this log.
        if (!empty($results['accounts'])) {
            $this->writeLog("");
            $this->writeLog("Accounts updated:");
            foreach ($results['accounts'] as $row) {
                $radiusNote = $row['radius'] === 'success' ? '' : "  [RADIUS: {$row['radius']}]";
                $this->writeLog("  ✓ {$row['account_no']} | {$row['from_plan']} -> {$row['to_plan']}"
                    . " | scheduled {$row['effective_at']}"
                    . ($row['customer'] ? " | {$row['customer']}" : '')
                    . $radiusNote);
            }
        }

        if (!empty($results['errors'])) {
            $this->writeLog("");
            $this->writeLog("Accounts that failed:");
            foreach ($results['errors'] as $row) {
                $this->writeLog("  ✗ {$row['account_no']} | {$row['error']}");
            }
        }

        $this->writeLog("");
        $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
        $this->writeLog("Duration: " . $endTime->diffInSeconds($startTime) . " second(s)");
        $this->writeLog("");
        $this->writeLog("");

        return $results;
    }

    /**
     * Switch the account onto $newPlan: update the customer's plan, clear any queue, record the
     * change, then push the new group to RADIUS.
     *
     * The database change is committed BEFORE the RADIUS call, matching how the payment
     * pipelines treat RADIUS — a RADIUS outage must not roll back a plan the customer paid for.
     * A failed push is queued for retry rather than dropped.
     *
     * @return array{plan:string, radius:string} radius is 'success' | 'queued_for_retry' | 'no_username'
     */
    public function applyPlan(BillingAccount $account, AppPlan $newPlan, string $reason, ?int $oldPlanId = null): array
    {
        // The billing generator finds the plan by feeding customers.desired_plan through
        // extractPlanName() and matching plan_list.plan_name, so the bare plan_name is the only
        // value guaranteed to resolve back to this plan.
        $desiredPlan = (string) $newPlan->plan_name;

        if ($this->extractPlanName($desiredPlan) !== $desiredPlan) {
            // A plan name containing a space cannot survive extractPlanName()'s first-token
            // rule, which would make the next bill fail to find the plan. Loud, not silent.
            Log::warning('[PREPAID PLAN] Plan name will not round-trip through extractPlanName(); billing may not resolve it', [
                'account_no' => $account->account_no,
                'plan_name' => $desiredPlan,
                'extracted' => $this->extractPlanName($desiredPlan),
            ]);
        }

        DB::transaction(function () use ($account, $newPlan, $oldPlanId, $desiredPlan, $reason) {
            DB::table('customers')
                ->where('id', $account->customer_id)
                ->update([
                    'desired_plan' => $desiredPlan,
                    'updated_by' => 'Prepaid Plan Change',
                    'updated_at' => Carbon::now(),
                ]);

            DB::table('billing_accounts')
                ->where('id', $account->id)
                ->update([
                    'plan_id' => $newPlan->id,
                    'pending_plan_id' => null,
                    'pending_plan_effective_at' => null,
                    'updated_by' => 'Prepaid Plan Change',
                    'updated_at' => Carbon::now(),
                ]);

            // organization_id is intentionally absent: it is not in PlanChangeLog::$fillable, so
            // passing it would be silently dropped by mass-assignment protection.
            PlanChangeLog::create([
                'account_id' => $account->id,
                'old_plan_id' => $oldPlanId,
                'new_plan_id' => $newPlan->id,
                'status' => self::LOG_STATUS,
                'date_changed' => Carbon::now(),
                'date_used' => Carbon::now(),
                'remarks' => $reason,
                'created_by_user' => 'Prepaid Plan Change',
                'updated_by_user' => 'Prepaid Plan Change',
            ]);
        });

        Log::info('[PREPAID PLAN] Plan applied', [
            'account_no' => $account->account_no,
            'new_plan' => $desiredPlan,
            'old_plan_id' => $oldPlanId,
            'reason' => $reason,
        ]);

        return [
            'plan' => $desiredPlan,
            'radius' => $this->pushPlanToRadius($account, $desiredPlan),
        ];
    }

    /**
     * Push the new plan to RADIUS, and hand it to the retry queue if that fails.
     *
     * Never throws into the caller: the database switch is already committed and the customer
     * has paid, so a RADIUS problem must not unwind it. But it must not be dropped either —
     * without the queue, a RADIUS outage at the moment a switch lands would leave the database
     * on the new plan while RADIUS kept serving the old one, permanently and silently. Queuing
     * an `update_group` lets the existing cron:process-radius-queue heal it.
     *
     * Safe against the payment flow's queue cleanup: cancelPendingDisconnectionsInQueue() only
     * cancels 'disconnect_user' / 'restricted_user' operations, so a queued group change is
     * never wiped by a later payment.
     */
    protected function pushPlanToRadius(BillingAccount $account, string $planName): string
    {
        $username = null;

        try {
            $username = $account->technicalDetails()->value('username');
            if (empty($username)) {
                Log::warning('[PREPAID PLAN] No RADIUS username on account, skipping group update', [
                    'account_no' => $account->account_no,
                ]);
                return 'no_username';
            }

            $result = app(\App\Services\ManualRadiusOperationsService::class)->updateGroup([
                'accountNumber' => $account->account_no,
                'username' => $username,
                'plan' => $planName,
                'updatedBy' => 'Prepaid Plan Change',
            ]);

            if (($result['status'] ?? null) === 'success') {
                return 'success';
            }

            $this->queueRadiusGroupUpdate($account, $username, $planName, $result['message'] ?? 'updateGroup returned failure status');
            return 'queued_for_retry';
        } catch (\Throwable $e) {
            Log::warning('[PREPAID PLAN] RADIUS group update failed for ' . $account->account_no . ': ' . $e->getMessage());

            if (!empty($username)) {
                $this->queueRadiusGroupUpdate($account, $username, $planName, $e->getMessage());
                return 'queued_for_retry';
            }

            return 'no_username';
        }
    }

    /** Hand a failed group change to the RADIUS retry queue. Best-effort; never throws. */
    protected function queueRadiusGroupUpdate(BillingAccount $account, string $username, string $planName, string $error): void
    {
        try {
            \App\Services\RadiusQueueService::queue([
                'organization_id' => $account->organization_id ?? null,
                'source_type' => 'prepaid_plan_change',
                'source_id' => $account->id,
                'account_no' => $account->account_no,
                'operation' => 'update_group',
                'params' => [
                    'accountNumber' => $account->account_no,
                    'username' => $username,
                    'plan' => $planName,
                    'updatedBy' => 'Prepaid Plan Change',
                ],
                'last_error' => $error,
                'created_by' => 'Prepaid Plan Change',
            ]);

            Log::warning('[PREPAID PLAN] RADIUS group update failed — queued for retry', [
                'account_no' => $account->account_no,
                'plan' => $planName,
                'error' => $error,
            ]);
        } catch (\Throwable $e) {
            Log::error('[PREPAID PLAN] Could not queue RADIUS group update for ' . $account->account_no . ': ' . $e->getMessage());
        }
    }

    /** Clear a queued switch without applying it. */
    protected function clearPending(int $accountId): void
    {
        DB::table('billing_accounts')
            ->where('id', $accountId)
            ->update([
                'pending_plan_id' => null,
                'pending_plan_effective_at' => null,
                'updated_at' => Carbon::now(),
            ]);
    }

    /** The plan the account is on right now, resolved the same way billing resolves it. */
    protected function resolveCurrentPlan(BillingAccount $account): ?AppPlan
    {
        $desired = $account->customer?->desired_plan;
        if (empty($desired)) {
            return $account->plan_id ? AppPlan::find($account->plan_id) : null;
        }

        return AppPlan::where('plan_name', $this->extractPlanName($desired))->first()
            ?? ($account->plan_id ? AppPlan::find($account->plan_id) : null);
    }

    /**
     * Mirrors EnhancedBillingGenerationServiceWithNotifications::extractPlanName() so the plan
     * this class resolves is the same one the biller will resolve.
     */
    protected function extractPlanName(string $desiredPlan): string
    {
        if (strpos($desiredPlan, ' - ') !== false) {
            $desiredPlan = trim(explode(' - ', $desiredPlan)[0]);
        }

        if (strpos($desiredPlan, ' ') !== false) {
            return trim(explode(' ', $desiredPlan)[0]);
        }

        return trim($desiredPlan);
    }
}
