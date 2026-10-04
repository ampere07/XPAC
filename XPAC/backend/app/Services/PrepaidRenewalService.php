<?php

namespace App\Services;

use App\Models\BillingAccount;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

/**
 * Manages the prepaid service-period window (billing_accounts.prepaid_expires_at).
 *
 * Invoked from BOTH payment pipelines at the moment a payment settles the balance (the same
 * point the existing auto-reconnect fires):
 *   - Portal  : PaymentWorkerService::processPayment (after commit, in the balance-settled block)
 *   - Manual  : TransactionController::attemptReconnectionAfterApproval (after the balance check)
 *
 * This class ONLY manages prepaid_expires_at. RADIUS reconnection and re-activation
 * (billing_status -> Active) are intentionally left to the existing reconnect flow so there is a
 * single source of truth for reconnection and we never double-kick a live PPPoE session.
 */
class PrepaidRenewalService
{
    /**
     * Length of one prepaid service period, in days: 30 days of service plus a built-in 4-day
     * grace, so there is no separate grace after expiry (AutoDisconnectService::PREPAID_GRACE_DAYS
     * is 0 and restricts as soon as the days left reach 0).
     */
    public const PREPAID_PERIOD_DAYS = 34;

    /**
     * A FRESH period counts the payment day itself as day 1, so its expiry is payment date + 33.
     *
     * Service runs through the whole expiry date (restriction starts the day after — see
     * AutoDisconnectService::prepaidRestrictionDue()), and the Customer page counts "days left"
     * the same way. With +34 a top-up on 09/30 expired 11/03: 09/30..11/03 is 35 days of service,
     * shown as "35 days left". With +33 it is 09/30..11/02 — exactly 34 days, shown as 34.
     *
     * An EXTENSION (topping up while still active) keeps +PREPAID_PERIOD_DAYS: the current
     * expiry day is already counted in the remaining days, so adding 34 adds exactly 34.
     */
    private function freshPeriodExpiry(Carbon $paymentDate, int $periods = 1): Carbon
    {
        return $paymentDate->copy()->addDays(self::PREPAID_PERIOD_DAYS * $periods - 1);
    }

    /**
     * Extend or (re)start a prepaid customer's service period after a settling payment.
     *
     * No-op for non-prepaid accounts, so it is safe to call unconditionally on every payment.
     *
     * Rules (see spec):
     *   - Still active (prepaid_expires_at is in the future relative to the payment): EXTEND from
     *     the current expiry (+34 days) so an early payer never loses their remaining days.
     *   - Expired or never set (null / in the past): start a FRESH 34-day period from the
     *     payment date.
     *   - $activateNow: start a fresh period from the payment date REGARDLESS, forfeiting any
     *     remaining days. See the parameter note below.
     *
     * @param bool $activateNow Customer ticked "Activate Now" on a plan change and accepted losing
     *   the balance of the current period. Callers must only pass true when a genuine plan switch
     *   is happening — {@see PrepaidPlanChangeService::settlePayment()} is what decides that.
     *   Forfeiting days for a same-plan top-up would be pure loss to the customer.
     * @param int $periods Advance payment: how many periods this payment buys (1, 2, 3 or 5
     *   months from the customer dashboard). Each is PREPAID_PERIOD_DAYS, so 3 periods extend an
     *   active account by 102 days, or start a fresh 102-day window. Anything below 1 is treated as 1.
     *
     * @return array{prepaid:bool, mode?:string, previous_expiry?:?string, new_expiry?:string, forfeited_days?:int, error?:string}
     */
    public function renewByAccountNo(string $accountNo, ?Carbon $paymentDate = null, bool $activateNow = false, int $periods = 1): array
    {
        try {
            $account = BillingAccount::where('account_no', $accountNo)->first();
            if (!$account) {
                return ['prepaid' => false];
            }
            return $this->renew($account, $paymentDate, $activateNow, $periods);
        } catch (\Throwable $e) {
            Log::error('[PREPAID RENEWAL] Failed for account ' . $accountNo . ': ' . $e->getMessage());
            return ['prepaid' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * @see renewByAccountNo()
     */
    public function renew(BillingAccount $account, ?Carbon $paymentDate = null, bool $activateNow = false, int $periods = 1): array
    {
        $periods = max(1, $periods);

        // Only prepaid accounts have a service period; postpaid is entirely unaffected.
        if (!BillingAccount::isPrepaidType($account->generation_type)) {
            return ['prepaid' => false];
        }

        $paymentDate = $paymentDate ? $paymentDate->copy() : Carbon::now();
        $current = $account->prepaid_expires_at ? Carbon::parse($account->prepaid_expires_at) : null;
        $forfeitedDays = 0;

        if ($activateNow && $current && $current->greaterThan($paymentDate)) {
            // The customer asked for the new plan to start immediately and was warned that the
            // rest of the current period goes with it. A fresh window from the payment date is
            // exactly that forfeit — the days between now and the old expiry are not carried over.
            //
            // Counted (not just discarded) because the figure is what the receipt and the audit
            // trail need in order to show what the customer gave up.
            $forfeitedDays = (int) ceil($paymentDate->floatDiffInDays($current));
            $newExpiry = $this->freshPeriodExpiry($paymentDate, $periods);
            $mode = 'activated';
        } elseif ($current && $current->greaterThan($paymentDate)) {
            // Early payment while still active — extend from the EXISTING expiry, preserving
            // every remaining prepaid day (e.g. expiry Jul 31 + pay Jul 20 => Aug 30).
            $newExpiry = $current->copy()->addDays(self::PREPAID_PERIOD_DAYS * $periods);
            $mode = 'extended';
        } else {
            // Expired or never set — start a fresh period from the payment date. Note this is also
            // where an "Activate Now" on an already-lapsed account lands: there is nothing left to
            // forfeit, so the two are the same operation and 'renewed' is the honest label.
            $newExpiry = $this->freshPeriodExpiry($paymentDate, $periods);
            $mode = 'renewed';
        }

        DB::table('billing_accounts')
            ->where('id', $account->id)
            ->update([
                'prepaid_expires_at' => $newExpiry,
                'updated_by' => 'Prepaid Renewal',
                'updated_at' => Carbon::now(),
            ]);

        Log::info('[PREPAID RENEWAL] Prepaid period ' . $mode, [
            'account_no' => $account->account_no,
            'previous_expiry' => $current?->toDateTimeString(),
            'new_expiry' => $newExpiry->toDateTimeString(),
            'payment_date' => $paymentDate->toDateTimeString(),
            'forfeited_days' => $forfeitedDays,
            'periods' => $periods,
        ]);

        return [
            'prepaid' => true,
            'mode' => $mode,
            'previous_expiry' => $current?->toDateTimeString(),
            'new_expiry' => $newExpiry->toDateTimeString(),
            // Only ever non-zero under 'activated'. Surfaced so the caller can put the cost of the
            // choice on the receipt instead of the customer discovering it later.
            'forfeited_days' => $forfeitedDays,
            'periods' => $periods,
        ];
    }
}
