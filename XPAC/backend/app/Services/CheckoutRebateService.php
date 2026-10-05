<?php

namespace App\Services;

use App\Models\BillingAccount;
use App\Models\MassRebate;
use App\Models\RebateUsage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Rebates applied to a prepaid plan purchase made from the customer portal — the rebate
 * counterpart of CheckoutDiscountService, and spent through the same checkout / settlement path.
 *
 * Postpaid customers get their rebates through billing: createEnhancedInvoice() takes
 * calculateRebates() off the invoice and markRebatesAsUsed() spends them. A prepaid top-up raises
 * no invoice, so without this a prepaid customer's rebate would never be used.
 *
 * A rebate is one rebates_usage row per affected account. It is spendable while the row is
 * 'Unused' and its rebate (the mass rebate it belongs to) is 'Unused' — i.e. approved and not yet
 * closed. Unlike billing, the rebate's month is not matched against the current month: a prepaid
 * customer renews whenever their period lapses, and the rebate stays on file until they do, the
 * same way a discount does.
 *
 * Value: number_of_dates days of the account's current plan, at plan price ÷ PREPAID_PERIOD_DAYS
 * per day — one rebate day is one day of a prepaid period.
 */
class CheckoutRebateService
{
    /**
     * The rebates this account can spend right now, valued against its current plan.
     *
     * @return array{amount: float, usages: array<int, float>} usages: rebates_usage id => peso value
     */
    public function available(string $accountNo, ?float $planPrice = null): array
    {
        $dailyRate = $this->dailyRate($accountNo, $planPrice);
        if ($dailyRate <= 0) {
            return ['amount' => 0.0, 'usages' => []];
        }

        $usages = [];
        foreach ($this->spendableRows($accountNo) as $row) {
            $value = round($dailyRate * (int) $row->number_of_dates, 2);
            if ($value > 0) {
                $usages[(int) $row->usage_id] = $value;
            }
        }

        return ['amount' => round(array_sum($usages), 2), 'usages' => $usages];
    }

    /**
     * Spend the rebates that were priced into a settled payment, up to $amount.
     *
     * Only the usages recorded at checkout are touched, each re-checked under a row lock, so a
     * rebate spent elsewhere in the meantime (another checkout, a billing run) is skipped rather
     * than spent twice. Returns what was ACTUALLY spent — the caller credits that, not the quote.
     *
     * A rebate is a single use: the ₱1 floor can cap how much of it reaches this payment, but the
     * usage is spent either way, as a Monthly discount's use is.
     *
     * Runs inside the caller's DB transaction.
     *
     * @param array<int|string, float|int|string> $usages rebates_usage id => value quoted at checkout
     * @return float the rebate actually applied to this payment
     */
    public function consume(array $usages, string $referenceNo, float $amount): float
    {
        $left = round(max(0.0, $amount), 2);
        if (empty($usages) || $left <= 0) {
            return 0.0;
        }

        $rows = RebateUsage::whereIn('id', array_map('intval', array_keys($usages)))
            ->orderBy('id')
            ->lockForUpdate()
            ->get();
        $spent = 0.0;

        foreach ($rows as $usage) {
            if ($left <= 0) {
                break;
            }

            $rebate = MassRebate::find($usage->rebates_id);
            if ($usage->status !== RebateUsage::STATUS_UNUSED || !$rebate || $rebate->status !== MassRebate::STATUS_UNUSED) {
                Log::warning('Checkout rebate no longer available at settlement', [
                    'rebates_usage_id' => $usage->id,
                    'usage_status' => $usage->status,
                    'rebate_status' => $rebate->status ?? null,
                    'reference_no' => $referenceNo,
                ]);
                continue;
            }

            $used = min(round((float) $usages[$usage->id], 2), $left);
            $usage->update(['status' => RebateUsage::STATUS_USED]);
            $this->closeRebateIfSpent($rebate, $referenceNo);

            $spent = round($spent + $used, 2);
            $left = round($left - $used, 2);
        }

        return $spent;
    }

    /** Unused usages of this account whose rebate is open, with the rebate's day count. */
    private function spendableRows(string $accountNo)
    {
        return DB::table('rebates_usage as u')
            ->join('rebates as r', 'r.id', '=', 'u.rebates_id')
            ->where('u.account_no', $accountNo)
            ->where('u.status', RebateUsage::STATUS_UNUSED)
            ->where('r.status', MassRebate::STATUS_UNUSED)
            ->where('r.number_of_dates', '>', 0)
            ->orderBy('u.id')
            ->get(['u.id as usage_id', 'r.number_of_dates']);
    }

    /** Plan price per prepaid day: the account's current plan, else the price given. */
    private function dailyRate(string $accountNo, ?float $planPrice): float
    {
        $account = BillingAccount::with('customer')->where('account_no', $accountNo)->first();
        $plan = $account ? app(PrepaidPlanChangeService::class)->currentPlanFor($account) : null;
        $price = (float) ($plan->price ?? 0) > 0 ? (float) $plan->price : (float) ($planPrice ?? 0);

        return $price > 0 ? $price / PrepaidRenewalService::PREPAID_PERIOD_DAYS : 0.0;
    }

    /** Close the mass rebate once every account has used it (as billing's checkAndUpdateRebateStatus). */
    private function closeRebateIfSpent(MassRebate $rebate, string $referenceNo): void
    {
        $unused = RebateUsage::where('rebates_id', $rebate->id)
            ->where('status', RebateUsage::STATUS_UNUSED)
            ->count();

        if ($unused === 0) {
            $rebate->update(['status' => MassRebate::STATUS_USED, 'modified_by' => 'portal payment ' . $referenceNo]);
        }
    }
}
