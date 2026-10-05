<?php

namespace App\Services;

use App\Models\Discount;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Discounts applied to a prepaid plan purchase made from the customer portal.
 *
 * Postpaid customers already get their discounts through billing: createEnhancedInvoice() takes
 * them off the invoice total and marks them used, so the balance they pay is already net. A
 * prepaid top-up raises no invoice, so without this its discounts would sit unused forever and
 * the customer would pay the full plan price.
 *
 * Eligibility and consumption mirror EnhancedBillingGenerationServiceWithNotifications::
 * calculateDiscounts() / markDiscountsAsUsed(), so a discount behaves the same whichever path
 * spends it:
 *   Unused     one-off   — spent once, then 'Used'
 *   Monthly    N uses    — one use per purchase while remaining > 0
 *   Permanent  forever   — applies to every purchase, never consumed
 */
class CheckoutDiscountService
{
    private const ELIGIBLE_STATUSES = ['Unused', 'Permanent', 'Monthly'];

    /**
     * The discounts this account can spend right now.
     *
     * @return array{amount: float, ids: list<int>}
     */
    public function available(string $accountNo): array
    {
        $discounts = Discount::where('account_no', $accountNo)
            ->whereIn('status', self::ELIGIBLE_STATUSES)
            ->get()
            ->filter(fn (Discount $d) => $this->isSpendable($d));

        return [
            'amount' => round((float) $discounts->sum(fn (Discount $d) => (float) $d->discount_amount), 2),
            'ids' => $discounts->pluck('id')->map(fn ($id) => (int) $id)->values()->all(),
        ];
    }

    /**
     * How much of $available may come off a $price purchase.
     *
     * Capped so at least ₱1.00 is still charged: the gateway cannot take a zero invoice, and a
     * discount larger than the plan is not a free month the rest of the pipeline understands.
     */
    public function applicableAmount(float $available, float $price): float
    {
        if ($available <= 0 || $price <= 1) {
            return 0.0;
        }

        return round(min($available, $price - 1), 2);
    }

    /**
     * Spend the discounts that were priced into a settled payment, up to $amount.
     *
     * Only the ids recorded at checkout are touched, and each is re-checked under a row lock: a
     * discount spent elsewhere in the meantime (another checkout, a billing run) is skipped rather
     * than spent twice. The return value is what was ACTUALLY spent, and that — not the amount
     * quoted at checkout — is what the caller credits. Two open checkouts quoting the same one-off
     * ₱100 therefore credit ₱100 once, and the second payment leaves its ₱100 owing.
     *
     * $amount can be less than the discounts' total (applicableAmount() keeps ₱1 payable). A
     * one-off discount only partly needed keeps the rest: its discount_amount drops by what was
     * used and it stays 'Unused'. Monthly and Permanent discounts are per-use, as in billing, so
     * a use is a use whatever part of it the cap let through.
     *
     * Runs inside the caller's DB transaction.
     *
     * @param list<int> $ids
     * @return float the discount actually applied to this payment
     */
    public function consume(array $ids, string $referenceNo, float $amount): float
    {
        $left = round(max(0.0, $amount), 2);
        if (empty($ids) || $left <= 0) {
            return 0.0;
        }

        $discounts = Discount::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
        $spent = 0.0;

        foreach ($discounts as $discount) {
            if ($left <= 0) {
                break;
            }

            if (!in_array($discount->status, self::ELIGIBLE_STATUSES, true) || !$this->isSpendable($discount)) {
                Log::warning('Checkout discount no longer available at settlement', [
                    'discount_id' => $discount->id,
                    'status' => $discount->status,
                    'reference_no' => $referenceNo,
                ]);
                continue;
            }

            $value = round((float) $discount->discount_amount, 2);
            $used = min($value, $left);
            $note = trim(($discount->remarks ?? '') . " [Applied ₱" . number_format($used, 2) . " to portal payment: {$referenceNo}]");

            if ($discount->status === 'Unused') {
                if ($used < $value) {
                    // Partly needed: keep the remainder for next time instead of losing it.
                    $discount->update(['discount_amount' => round($value - $used, 2), 'used_date' => now(), 'remarks' => $note]);
                } else {
                    $discount->update(['status' => 'Used', 'used_date' => now(), 'remarks' => $note]);
                }
            } elseif ($discount->status === 'Monthly') {
                $discount->update(['remaining' => $discount->remaining - 1, 'used_date' => now(), 'remarks' => $note]);
            } else {
                // Permanent: nothing to consume. used_date still records the latest use.
                DB::table('discounts')->where('id', $discount->id)->update(['used_date' => now()]);
            }

            $spent = round($spent + $used, 2);
            $left = round($left - $used, 2);
        }

        return $spent;
    }

    private function isSpendable(Discount $discount): bool
    {
        if ((float) $discount->discount_amount <= 0) {
            return false;
        }

        return $discount->status !== 'Monthly' || (int) $discount->remaining > 0;
    }
}
