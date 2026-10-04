<?php

namespace App\Services;

use App\Models\BillingAccount;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Switches an account between prepaid and postpaid when the customer chose to at Pay Now.
 *
 * Only ever applied once the payment that carried the choice has settled (PaymentWorkerService);
 * an abandoned or failed checkout changes nothing. XenditPaymentController::createPayment checks
 * the request is valid for the account and that the amount covers what the switch requires.
 *
 *   To prepaid   The payment covered the postpaid balance plus one period of the plan. The
 *                balance is cleared, the leftover is that period, and the 34-day prepaid window
 *                starts on the payment date (the caller renews right after).
 *   To postpaid  The prepaid days already paid for are kept. billing_day becomes the day the
 *                prepaid period ends, and billing generation skips any cycle that would start
 *                before then (getActiveAccountsForBillingDay), so the first bill covers the first
 *                postpaid month and nothing already prepaid.
 */
class BillingTypeMigrationService
{
    public const TO_PREPAID = 'prepaid';
    public const TO_POSTPAID = 'postpaid';

    /**
     * Is $target a legal switch for an account whose generation_type is $currentGenerationType?
     * Only an actual change is accepted — "switching" to the type already in force is refused.
     */
    public static function isValidTarget(?string $target, ?string $currentGenerationType): bool
    {
        $isPrepaid = BillingAccount::isPrepaidType($currentGenerationType);

        return ($target === self::TO_PREPAID && !$isPrepaid)
            || ($target === self::TO_POSTPAID && $isPrepaid);
    }

    /**
     * Postpaid -> prepaid, called inside the settlement transaction after the payment was applied.
     *
     * The payment was distributed while the account was still postpaid, so the plan-period part of
     * it sits on the account as credit (a negative balance). Prepaid accounts never carry credit —
     * that money IS the prepaid period — so the balance floors to 0. prepaid_expires_at is cleared
     * so the renewal that follows starts a fresh period from the payment date rather than
     * extending a stale one from some earlier prepaid stint.
     */
    public function toPrepaid(string $accountNo, string $referenceNo): void
    {
        $account = BillingAccount::where('account_no', $accountNo)->lockForUpdate()->first();
        if (!$account || BillingAccount::isPrepaidType($account->generation_type)) {
            return;
        }

        $previous = $account->generation_type;
        $balance = (float) ($account->account_balance ?? 0);

        DB::table('billing_accounts')->where('id', $account->id)->update([
            'generation_type' => BillingAccount::GENERATION_PREPAID,
            'prepaid_expires_at' => null,
            'account_balance' => max(0.0, round($balance, 2)),
            'updated_by' => 'Customer Billing Type Switch',
            'updated_at' => Carbon::now(),
        ]);

        $this->audit($accountNo, $previous, BillingAccount::GENERATION_PREPAID, $referenceNo, [
            'balance_before_floor' => $balance,
        ]);
    }

    /**
     * Prepaid -> postpaid, called after the payment settled (and after any prepaid renewal it
     * bought, so the expiry used here already includes the days just paid for).
     *
     * billing_day = the expiry's day of month, or the payment day when no period ever started.
     * pending_plan_* is a prepaid-only queue ("switch plan when this period lapses"), so it is
     * cleared — nothing on the postpaid side would ever act on it.
     */
    public function toPostpaid(string $accountNo, string $referenceNo, ?Carbon $paymentDate = null): void
    {
        $account = BillingAccount::where('account_no', $accountNo)->first();
        if (!$account || !BillingAccount::isPrepaidType($account->generation_type)) {
            return;
        }

        $previous = $account->generation_type;
        $expiry = $account->prepaid_expires_at ? Carbon::parse($account->prepaid_expires_at) : null;
        $billingDay = ($expiry ?? $paymentDate ?? Carbon::now())->day;

        DB::table('billing_accounts')->where('id', $account->id)->update([
            'generation_type' => BillingAccount::GENERATION_POSTPAID,
            'billing_day' => $billingDay,
            'pending_plan_id' => null,
            'pending_plan_effective_at' => null,
            'updated_by' => 'Customer Billing Type Switch',
            'updated_at' => Carbon::now(),
        ]);

        $this->audit($accountNo, $previous, BillingAccount::GENERATION_POSTPAID, $referenceNo, [
            'billing_day' => $billingDay,
            'prepaid_days_kept_until' => $expiry?->toDateTimeString(),
        ]);
    }

    private function audit(string $accountNo, ?string $from, string $to, string $referenceNo, array $extra): void
    {
        Log::info('[BILLING TYPE SWITCH] Customer switched billing type at Pay Now', array_merge([
            'account_no' => $accountNo,
            'from' => $from,
            'to' => $to,
            'reference_no' => $referenceNo,
        ], $extra));

        try {
            \App\Models\ActivityLog::log(
                'Billing Type Switched',
                "Account {$accountNo} switched from " . ($from ?: 'unset') . " to {$to} by the customer (payment {$referenceNo})",
                'info',
                [
                    'resource_type' => 'BillingAccount',
                    'additional_data' => array_merge(['account_no' => $accountNo, 'reference_no' => $referenceNo], $extra),
                ]
            );
        } catch (\Throwable $e) {
            // The switch is already written; a failed audit row must not undo or fail it.
            Log::warning('[BILLING TYPE SWITCH] Activity log failed: ' . $e->getMessage());
        }
    }
}
