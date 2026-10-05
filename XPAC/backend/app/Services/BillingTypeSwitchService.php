<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\BillingAccount;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * What switching an account between Prepaid and Postpaid does to its connection.
 *
 * Saving a new Billing Type from Customer Details puts the account straight into the state its
 * new type says it should be in, instead of leaving it to the next cron run:
 *
 *   reconnect   nothing owed (a balance of 0.00, or a credit) and, for Prepaid, days left on the
 *               paid period
 *   disconnect  a balance owed, or, for Prepaid, 0 days left (no expiry yet, or it has passed)
 *
 * Postpaid has no paid period, so for it the balance alone decides.
 *
 * "Days left" is counted exactly as the prepaid restriction cron counts it
 * ({@see AutoDisconnectService::prepaidRestrictFrom()}): the expiry date itself is the last day of
 * service. The edit modal runs the same rule to tell the operator what saving will do
 * (frontend/src/modals/CustomerDetailsEditModal.tsx, billingTypeSwitchPlan) — change both together.
 *
 * Only the statuses the automatic flows set are acted on. A reconnect lifts Inactive, Restricted or
 * Disconnected; a disconnect cuts Active. VIP, Terminated, Suspended and Pending are decisions made
 * elsewhere, and changing the billing type must never undo one.
 *
 * Runs after the billing update has committed and NEVER THROWS: the new billing type is the
 * operator's record and must survive a RADIUS server that is down. A failed RADIUS call is queued
 * for cron:process-radius-queue, like every other RADIUS caller in the app.
 *
 * Every other save from the Customer Details edit modal runs a narrower prepaid-only rule through
 * the same reconnect/disconnect path — see {@see decideAfterSave()} and {@see enforceAfterSave()}.
 */
class BillingTypeSwitchService
{
    public const ACTION_RECONNECT  = 'reconnect';
    public const ACTION_DISCONNECT = 'disconnect';

    /** Statuses a reconnect may lift: the ones the auto-disconnect flows park an account in. */
    private const DISCONNECTED_STATUSES = ['inactive', 'restricted', 'disconnected'];

    private const ACTIVE_STATUS = 'active';

    /**
     * What the account's new billing type calls for, judged on the saved values.
     *
     * @return array{action: string, reason: string}
     */
    public function decide(BillingAccount $account, ?Carbon $now = null): array
    {
        $balance = round((float) ($account->account_balance ?? 0), 2);

        if ($balance > 0) {
            return [
                'action' => self::ACTION_DISCONNECT,
                'reason' => 'it has a balance of ₱' . number_format($balance, 2),
            ];
        }

        if (!BillingAccount::isPrepaidType($account->generation_type)) {
            return ['action' => self::ACTION_RECONNECT, 'reason' => 'no balance is owed'];
        }

        $daysLeft = $this->daysLeft($account->prepaid_expires_at, $now ?? Carbon::now());

        if ($daysLeft <= 0) {
            return [
                'action' => self::ACTION_DISCONNECT,
                'reason' => $account->prepaid_expires_at ? 'it has 0 days left' : 'it has no prepaid days yet',
            ];
        }

        return [
            'action' => self::ACTION_RECONNECT,
            'reason' => "no balance is owed and it has {$daysLeft} " . ($daysLeft === 1 ? 'day' : 'days') . ' left',
        ];
    }

    /**
     * Reconnect or disconnect the account to match its new billing type.
     *
     * @return array{action: string, message: string, queued: bool}
     */
    public function enforce(BillingAccount $account, string $updatedBy): array
    {
        $typeLabel = BillingAccount::isPrepaidType($account->generation_type)
            ? BillingAccount::GENERATION_PREPAID
            : BillingAccount::GENERATION_POSTPAID;
        $changed = "Billing Type changed to {$typeLabel}";
        $trigger = [
            'label' => $changed,
            'remarks' => $changed,
            'event' => 'Billing Type Change',
            'source' => 'billing_type_switch',
        ];

        try {
            $decision = $this->decide($account);
            $wantsReconnect = $decision['action'] === self::ACTION_RECONNECT;

            $statusName = trim((string) DB::table('billing_status')
                ->where('id', $account->billing_status_id)
                ->value('status_name'));
            $status = strtolower($statusName);

            if ($status !== self::ACTIVE_STATUS && !in_array($status, self::DISCONNECTED_STATUSES, true)) {
                $statusLabel = $statusName !== '' ? $statusName : 'not Active or Inactive';

                return $this->skipped("{$changed}. The account is {$statusLabel}, so its connection was left as is.");
            }

            $username = DB::table('technical_details')->where('account_id', $account->id)->value('username');

            if (empty($username)) {
                return $this->skipped("{$changed}. No PPPoE username on file, so RADIUS was not changed.");
            }

            /*
             * Decided from the router as well as the status, as the Prepaid Override does: the two
             * drift apart (a status set by hand while RADIUS kept the old group). null = RADIUS
             * could not be read, and then the status alone decides.
             */
            $routerRestricted = $this->isRestrictedGroup(
                app(ManualRadiusOperationsService::class)->findUserGroup($username)
            );

            if ($wantsReconnect) {
                $alreadyOnline = $status === self::ACTIVE_STATUS && $routerRestricted !== true;

                return $alreadyOnline
                    ? $this->skipped("{$changed}. The account is already connected ({$decision['reason']}).")
                    : $this->reconnect($account, $username, $updatedBy, $trigger, $decision['reason']);
            }

            $alreadyOffline = $status !== self::ACTIVE_STATUS && $routerRestricted !== false;

            return $alreadyOffline
                ? $this->skipped("{$changed}. The account stays disconnected ({$decision['reason']}).")
                : $this->disconnect($account, $username, $updatedBy, $trigger, $decision['reason']);
        } catch (\Throwable $e) {
            Log::error('[BILLING TYPE SWITCH] Enforcement failed after the billing type change', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage(),
            ]);

            return [
                'action' => 'error',
                'message' => "{$changed}, but the connection could not be updated: {$e->getMessage()}",
                'queued' => false,
            ];
        }
    }

    /**
     * The rule a save from the Customer Details edit modal applies to a prepaid account, judged on
     * the saved values:
     *
     *   reconnect   a balance of 0.00 or less (nothing owed) and more than 1 day left
     *   disconnect  a balance over 1.00 and 0 days left
     *
     * null — leave the connection alone — for everything else: a postpaid account, a balance that
     * is missing or not a number, a prepaid account with no expiry yet (the prepaid restriction
     * cron leaves those alone too), and the states in between, such as 1 day left or a balance
     * between 0.01 and 1.00.
     *
     * @return array{action: string, reason: string}|null
     */
    public function decideAfterSave(BillingAccount $account, ?Carbon $now = null): ?array
    {
        if (!BillingAccount::isPrepaidType($account->generation_type)) {
            return null;
        }

        $rawBalance = $account->account_balance;
        if ($rawBalance === null || trim((string) $rawBalance) === '' || !is_numeric($rawBalance)) {
            return null;
        }

        if (empty($account->prepaid_expires_at)) {
            return null;
        }

        $balance = round((float) $rawBalance, 2);
        $daysLeft = $this->daysLeft($account->prepaid_expires_at, $now ?? Carbon::now());

        if ($balance <= 0 && $daysLeft > 1) {
            return [
                'action' => self::ACTION_RECONNECT,
                'reason' => "no balance is owed and it has {$daysLeft} days left",
            ];
        }

        if ($balance > 1 && $daysLeft <= 0) {
            return [
                'action' => self::ACTION_DISCONNECT,
                'reason' => 'it has a balance of ₱' . number_format($balance, 2) . ' and 0 days left',
            ];
        }

        return null;
    }

    /**
     * Reconnect or disconnect the account per {@see decideAfterSave()}, after a save from the
     * Customer Details edit modal has committed.
     *
     * Acts on the billing status alone: a reconnect lifts Inactive, Restricted or Disconnected, a
     * disconnect cuts Active, the same statuses enforce() acts on. An account already in the
     * right state, or in a status decided elsewhere (VIP, Terminated, ...), is left alone. Unlike
     * enforce() the router is not read first: this runs on every save from the modal, and a
     * RADIUS lookup on each one would slow every save down, most of all while RADIUS is down.
     *
     * Sends the customer no SMS or email, by design — unlike the payment and service-order
     * reconnect/disconnect flows. The operator sees the outcome in the modal instead.
     *
     * Never throws.
     *
     * @return array{action: string, message: string, queued: bool}|null null when nothing was done
     */
    public function enforceAfterSave(BillingAccount $account, string $updatedBy): ?array
    {
        $trigger = [
            'label' => '',
            'remarks' => 'Customer Details Saved',
            'event' => 'Customer Details Save',
            'source' => 'customer_details_save',
        ];

        try {
            $decision = $this->decideAfterSave($account);
            if ($decision === null) {
                return null;
            }

            $wantsReconnect = $decision['action'] === self::ACTION_RECONNECT;

            $status = strtolower(trim((string) DB::table('billing_status')
                ->where('id', $account->billing_status_id)
                ->value('status_name')));

            $applies = $wantsReconnect
                ? in_array($status, self::DISCONNECTED_STATUSES, true)
                : $status === self::ACTIVE_STATUS;

            if (!$applies) {
                return null;
            }

            $username = DB::table('technical_details')->where('account_id', $account->id)->value('username');

            if (empty($username)) {
                $want = $wantsReconnect ? 'reconnected' : 'disconnected';

                return $this->skipped("The account should be {$want} ({$decision['reason']}), but it has no PPPoE username on file, so RADIUS was not changed.");
            }

            return $wantsReconnect
                ? $this->reconnect($account, $username, $updatedBy, $trigger, $decision['reason'])
                : $this->disconnect($account, $username, $updatedBy, $trigger, $decision['reason']);
        } catch (\Throwable $e) {
            Log::error('[CUSTOMER DETAILS SAVE] Auto reconnect/disconnect failed after the save', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage(),
            ]);

            return [
                'action' => 'error',
                'message' => "The account's connection could not be checked: {$e->getMessage()}",
                'queued' => false,
            ];
        }
    }

    /**
     * Days of service left, counted in calendar days with the expiry date as the last one.
     * 0 or less means the period is over (or never started).
     */
    public function daysLeft($prepaidExpiresAt, Carbon $now): int
    {
        if (empty($prepaidExpiresAt)) {
            return 0;
        }

        $expiryDay = Carbon::parse($prepaidExpiresAt)->startOfDay();
        $firstRestrictedDay = AutoDisconnectService::prepaidRestrictFrom($now);

        return (int) round($firstRestrictedDay->diffInDays($expiryDay, false)) + 1;
    }

    /*
     * $trigger, below, is why the connection is being changed:
     *   label    opens every message to the operator ('' for none)
     *   remarks  starts the reconnection/disconnection log remarks
     *   event    ends the activity log title, "Reconnected After {event}"
     *   source   the queued retry's source_type, and the tag on log lines
     */

    /**
     * @param  array{label: string, remarks: string, event: string, source: string}  $trigger
     * @return array{action: string, message: string, queued: bool}
     */
    private function reconnect(BillingAccount $account, string $username, string $updatedBy, array $trigger, string $reason): array
    {
        // plan_list is the plan the account is actually on; customers.desired_plan is the fallback,
        // as in CustomerDetailUpdateController::reconnectAccountForVip().
        $plan = DB::table('billing_accounts')
            ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
            ->leftJoin('plan_list', 'billing_accounts.plan_id', '=', 'plan_list.id')
            ->where('billing_accounts.id', $account->id)
            ->selectRaw('COALESCE(NULLIF(plan_list.plan_name, \'\'), customers.desired_plan) as plan')
            ->value('plan');

        if (empty($plan)) {
            return $this->skipped($this->say($trigger, 'No plan on file, so the account could not be reconnected.'));
        }

        // reconnectUser() writes Active once the RADIUS side is done.
        $params = [
            'accountNumber' => $account->account_no,
            'username' => $username,
            'plan' => $plan,
            'updatedBy' => $updatedBy,
            'remarks' => "{$trigger['remarks']} - Auto Reconnect",
        ];

        return $this->run($account, 'reconnect_user', $params, $updatedBy, $trigger, $reason);
    }

    /**
     * @param  array{label: string, remarks: string, event: string, source: string}  $trigger
     * @return array{action: string, message: string, queued: bool}
     */
    private function disconnect(BillingAccount $account, string $username, string $updatedBy, array $trigger, string $reason): array
    {
        $params = [
            'accountNumber' => $account->account_no,
            'username' => $username,
            'updatedBy' => $updatedBy,
            'remarks' => "{$trigger['remarks']} - Auto Disconnect",
        ];

        // A prepaid account is parked in Inactive, exactly as a lapsed prepaid period is; a postpaid
        // one takes restrictedUser()'s own status, as the overdue auto-disconnect does.
        if (BillingAccount::isPrepaidType($account->generation_type)) {
            $params['dbStatus'] = 'Inactive';
        }

        return $this->run($account, 'restricted_user', $params, $updatedBy, $trigger, $reason);
    }

    /**
     * Issue the RADIUS operation, or queue it for retry when RADIUS cannot take it now.
     *
     * @param  array{label: string, remarks: string, event: string, source: string}  $trigger
     * @return array{action: string, message: string, queued: bool}
     */
    private function run(BillingAccount $account, string $operation, array $params, string $updatedBy, array $trigger, string $reason): array
    {
        $isReconnect = $operation === 'reconnect_user';
        $verb = $isReconnect ? 'reconnected' : 'disconnected';
        $radius = app(ManualRadiusOperationsService::class);
        // 'billing_type_switch' -> '[BILLING TYPE SWITCH]'
        $tag = '[' . strtoupper(str_replace('_', ' ', $trigger['source'])) . ']';

        $result = $isReconnect ? $radius->reconnectUser($params) : $radius->restrictedUser($params);

        if (($result['status'] ?? '') === 'success') {
            Log::info("{$tag} Account {$verb}", [
                'account_no' => $account->account_no,
                'username' => $params['username'],
                'reason' => $reason,
            ]);

            ActivityLog::log(
                ($isReconnect ? 'Reconnected After ' : 'Disconnected After ') . $trigger['event'],
                "Account {$account->account_no} {$verb}: {$trigger['remarks']}, and {$reason}",
                $isReconnect ? 'info' : 'warning',
                [
                    'resource_type' => 'BillingAccount',
                    'resource_id' => $account->id,
                    'additional_data' => [
                        'account_no' => $account->account_no,
                        'username' => $params['username'],
                        'generation_type' => $account->generation_type,
                        'reason' => $reason,
                    ],
                ]
            );

            return [
                'action' => $verb,
                'message' => $this->say($trigger, "The account was {$verb} because {$reason}."),
                'queued' => false,
            ];
        }

        $error = $result['message'] ?? 'Unknown RADIUS error';

        // The billing status is already written: with the username and plan checked above,
        // reconnectUser()/restrictedUser() set it before reporting a RADIUS failure, so the queued
        // retry only has the router to bring into line.
        $queuedId = RadiusQueueService::queue([
            'organization_id' => $account->organization_id ?? null,
            'source_type' => $trigger['source'],
            'source_id' => $account->id,
            'account_no' => $account->account_no,
            'operation' => $operation,
            'params' => $params,
            'last_error' => "RADIUS {$operation} failed after " . strtolower($trigger['event']) . ": {$error}",
            'created_by' => $updatedBy,
        ]);

        Log::warning("{$tag} {$operation} failed, " . ($queuedId ? 'queued for retry' : 'could not be queued'), [
            'account_no' => $account->account_no,
            'username' => $params['username'],
            'error' => $error,
        ]);

        $want = $isReconnect ? 'reconnect' : 'disconnect';

        return $queuedId
            ? [
                'action' => 'queued',
                'message' => $this->say($trigger, "The account needs to be {$verb} ({$reason}); RADIUS could not take the {$want} now, so it has been queued and will be retried automatically."),
                'queued' => true,
            ]
            : [
                'action' => 'error',
                'message' => $this->say($trigger, "The account needs to be {$verb} ({$reason}), but the {$want} failed and could not be queued. Please {$want} it manually."),
                'queued' => false,
            ];
    }

    /**
     * An operator-facing message, opened by the trigger's label when it has one.
     *
     * @param  array{label: string, remarks: string, event: string, source: string}  $trigger
     */
    private function say(array $trigger, string $text): string
    {
        return $trigger['label'] === '' ? $text : "{$trigger['label']}. {$text}";
    }

    /**
     * true = a restricted group, false = a live (plan) group, null = not found / RADIUS unreachable.
     * Same reading as PrepaidOverrideService.
     */
    private function isRestrictedGroup(?string $group): ?bool
    {
        if ($group === null || trim($group) === '') {
            return null;
        }

        return in_array(strtolower(trim($group)), ['restricted', 'disconnected'], true);
    }

    /**
     * @return array{action: string, message: string, queued: bool}
     */
    private function skipped(string $message): array
    {
        return ['action' => 'skipped', 'message' => $message, 'queued' => false];
    }
}
