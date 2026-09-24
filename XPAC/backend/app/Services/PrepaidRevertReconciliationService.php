<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\BillingAccount;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Reconciles a subscriber's billing_status/RADIUS state against prepaid_expires_at after a
 * transaction revert.
 *
 * Extracted from TransactionRevertController::restrictExpiredPrepaidAfterRevert() (the
 * admin-approval revert flow, which already implemented this correctly) so the same logic can
 * also run from TransactionController::revert() (the quick direct-revert endpoint), which
 * previously reverted the payment/balance/invoices but never touched billing_status or RADIUS at
 * all — leaving an account that a reverted payment had reconnected still marked Active/connected.
 *
 * Rule: not expired -> leave alone (whatever the caller already restored stays as-is); expired or
 * no expiry on file -> billing_status_id = Inactive (never Restricted) in the DB, and RADIUS gets
 * the Restricted profile applied via ManualRadiusOperationsService::restrictedUser(), queued for
 * retry through RadiusQueueService on failure.
 */
class PrepaidRevertReconciliationService
{
    /**
     * Remark stamped on the RADIUS restriction this service raises.
     *
     * Deliberately different from AutoDisconnectService's 'Prepaid Period Expired' so support can
     * tell a routine nightly lapse apart from a payment that was taken back out from under the
     * customer — the two need very different conversations.
     */
    public const PREPAID_REVERT_RESTRICTION_REMARKS = 'Transaction Revert — Prepaid Period Expired';

    /**
     * Restrict a prepaid customer whose revert restored an already-lapsed expiry.
     *
     * Closes a gap the caller's own snapshot/session-group restore cannot cover on its own. When
     * a prepaid period had already lapsed but the nightly `cron:auto-disconnect-pullout` run had
     * not yet reached the customer, a restored pre-approval session_group can still hold their
     * PLAN name rather than 'restricted', or the direct-revert path may have no session_group
     * concept at all — either way, without this the customer keeps service on a period their
     * now-reverted payment no longer pays for.
     *
     * Applies exactly the rule {@see AutoDisconnectService::processPrepaidRestrictions()} applies:
     * the same grace day (both read {@see AutoDisconnectService::PREPAID_GRACE_DAYS}), the same
     * restrictedUser() workflow, the same flip to Inactive, the same queue-on-failure. A customer
     * therefore reaches the same end state whichever path reaches them first. The flip to Inactive
     * doubles as the dedupe signal — the cron only selects Active accounts, so it will not
     * restrict this customer again tonight.
     *
     * Must be called AFTER the caller's DB::commit(), because a RADIUS restriction is an external
     * side effect that cannot be rolled back.
     *
     * Self-gating, so the caller can invoke it after every revert: a VIP account, a postpaid
     * account, an expiry still in the future, or a customer the caller already knows was pushed
     * offline each return 'skipped' without touching anything. NEVER THROWS — the revert has
     * already committed and must still be reported as successful, so every failure is logged and
     * returned instead.
     *
     * @param  string       $accountNo             the billing account to reconcile
     * @param  string|null  $restoredSessionGroup  normalised pre-approval session_group, if the
     *                                              caller already restored one; null when the
     *                                              caller has no such concept (e.g. direct revert)
     * @param  string       $updatedBy             actor for RADIUS + audit logs
     * @param  int|null     $userId                actor for billing_accounts.updated_by
     * @return array{action: string, reason?: string, expires_at?: string, username?: string}
     */
    public function reconcileAfterRevert(
        string $accountNo,
        ?string $restoredSessionGroup,
        string $updatedBy,
        $userId
    ): array {
        try {
            // Already handled: the session_group restore put this customer back on the Restricted
            // or Disconnected profile, which is where the lapsed expiry would have put them anyway.
            if (in_array($restoredSessionGroup, ['restricted', 'disconnected'], true)) {
                return ['action' => 'skipped', 'reason' => 'session_group restore already took the customer offline'];
            }

            $account = BillingAccount::with(['technicalDetails', 'billingStatus'])
                ->where('account_no', $accountNo)
                ->first();

            if (!$account) {
                return ['action' => 'skipped', 'reason' => 'billing account not found'];
            }

            // VIP accounts are exempt from prepaid expiration entirely — comped, never restricted
            // for a lapsed period, regardless of what prepaid_expires_at says. Mirrors the same
            // guard AutoDisconnectService applies before any other disconnect/restrict decision.
            $billingStatusName = optional($account->billingStatus)->status_name ?? '';
            if (strcasecmp(trim($billingStatusName), 'VIP') === 0) {
                return ['action' => 'skipped', 'reason' => 'VIP account (comped, exempt from prepaid expiration)'];
            }

            if (!BillingAccount::isPrepaidType($account->generation_type)) {
                return ['action' => 'skipped', 'reason' => 'not a prepaid account'];
            }

            if (empty($account->prepaid_expires_at)) {
                return ['action' => 'skipped', 'reason' => 'no prepaid_expires_at to judge'];
            }

            /*
             * Identical cutoff to processPrepaidRestrictions(): the expiry DATE is served in full
             * and restriction falls due at the start of the following day, so an account expiring
             * 07/30 is restricted on 07/31. Normalising to the calendar date is what stops the
             * expiry's inherited time-of-day from cutting some customers off mid-afternoon.
             */
            $restrictFrom = Carbon::now()
                ->startOfDay()
                ->subDays(AutoDisconnectService::PREPAID_GRACE_DAYS - 1);
            $expiry = Carbon::parse($account->prepaid_expires_at);

            if ($expiry->greaterThanOrEqualTo($restrictFrom)) {
                return [
                    'action'     => 'skipped',
                    'reason'     => 'restored prepaid period has not lapsed yet',
                    'expires_at' => $expiry->toDateTimeString(),
                ];
            }

            // Mirror the cron's dedupe: never issue a direct restrict while an earlier one is still
            // queued for retry, or the customer is restricted twice over.
            $alreadyQueued = DB::table('radius_operation_queue')
                ->where('account_no', $accountNo)
                ->where('operation', 'restricted_user')
                ->whereIn('status', ['pending', 'processing'])
                ->exists();

            if ($alreadyQueued) {
                return ['action' => 'skipped', 'reason' => 'a restrict operation is already queued for retry'];
            }

            $username = optional($account->technicalDetails->first())->username;

            if (empty($username)) {
                Log::channel('radiusrelated')->warning('Revert: prepaid period lapsed but no PPPoE username to restrict', [
                    'account_no' => $accountNo,
                    'expires_at' => $expiry->toDateTimeString(),
                ]);

                return ['action' => 'skipped', 'reason' => 'no PPPoE username in technical_details'];
            }

            $params = [
                'accountNumber' => $accountNo,
                'username'      => $username,
                'remarks'       => self::PREPAID_REVERT_RESTRICTION_REMARKS,
                'updatedBy'     => $updatedBy,
            ];

            $result = app(ManualRadiusOperationsService::class)->restrictedUser($params);

            if (($result['status'] ?? '') !== 'success') {
                $reason = $result['message'] ?? 'Unknown RADIUS error';

                // Queue rather than fail: the revert itself is already committed and correct, and
                // cron:process-radius-queue will land the restriction within minutes.
                RadiusQueueService::queue([
                    'organization_id' => $account->organization_id ?? null,
                    'source_type'     => 'transaction_revert',
                    'source_id'       => $account->id,
                    'account_no'      => $accountNo,
                    'operation'       => 'restricted_user',
                    'params'          => $params,
                    'last_error'      => 'RADIUS restrict failed during transaction revert: ' . $reason,
                    'created_by'      => $updatedBy,
                ]);

                Log::channel('radiusrelated')->warning('Revert: prepaid restrict failed, queued for retry', [
                    'account_no' => $accountNo,
                    'username'   => $username,
                    'expires_at' => $expiry->toDateTimeString(),
                    'reason'     => $reason,
                ]);

                return [
                    'action'     => 'queued',
                    'reason'     => $reason,
                    'expires_at' => $expiry->toDateTimeString(),
                    'username'   => $username,
                ];
            }

            /*
             * Billing status flips only once RADIUS has accepted the restriction — same ordering as
             * the cron, so an Inactive row always means a restriction that really landed.
             *
             * This deliberately overrides whatever billing_status_id the caller's own snapshot/
             * session-group restore just put back. That is the point: the pre-approval status was
             * Active only because the nightly run had not reached this customer yet, and the
             * restored expiry says the restriction is now due. Leaving it Active would re-open the
             * gap this closes.
             */
            $inactiveStatusId = DB::table('billing_status')->where('status_name', 'Inactive')->value('id') ?? 4;

            $account->billing_status_id = $inactiveStatusId;
            $account->updated_by        = $userId;
            $account->save();

            Log::channel('radiusrelated')->info('Revert: prepaid period already lapsed — customer restricted', [
                'account_no'        => $accountNo,
                'username'          => $username,
                'restored_expiry'   => $expiry->toDateTimeString(),
                'billing_status_id' => $inactiveStatusId,
            ]);

            ActivityLog::log(
                'Prepaid Restricted After Transaction Revert',
                "Account {$accountNo} restricted — reverted payment left the prepaid period expired on {$expiry->toDateString()}",
                'warning',
                [
                    'resource_type'   => 'BillingAccount',
                    'resource_id'     => $account->id,
                    'additional_data' => [
                        'account_no'        => $accountNo,
                        'username'          => $username,
                        'restored_expiry'   => $expiry->toDateTimeString(),
                        'billing_status_id' => $inactiveStatusId,
                    ],
                ]
            );

            return [
                'action'     => 'restricted',
                'expires_at' => $expiry->toDateTimeString(),
                'username'   => $username,
            ];
        } catch (\Throwable $e) {
            // The revert is committed and correct; only the enforcement failed. Report it and let
            // the nightly processPrepaidRestrictions() run pick this customer up instead.
            Log::channel('radiusrelated')->error('Revert: prepaid expiry enforcement failed', [
                'account_no' => $accountNo,
                'error'      => $e->getMessage(),
            ]);

            return ['action' => 'error', 'reason' => $e->getMessage()];
        }
    }
}
