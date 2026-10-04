<?php

namespace App\Services;

use App\Models\BillingAccount;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * A postpaid account that was Inactive (cut off for non-payment) restarts its billing cycle on the
 * day it pays its way back: billing_day moves to the payment's day of the month.
 *
 * Only for that case. An account that is still Active when it pays — online, or merely offline —
 * keeps its billing day; paying on time must not shift anyone's cycle. Prepaid accounts have no
 * billing day (they bill on a rolling period) and are never touched.
 *
 * Called from the two places a settled payment reconnects an account, at the point they flip the
 * account back to Active: TransactionController::attemptReconnectionAfterApproval() (cashier) and
 * PaymentWorkerService::attemptReconnect() (portal).
 */
class PostpaidBillingDayService
{
    /** Billing day value that means "last day of the month" (EnhancedBillingGenerationService). */
    private const END_OF_MONTH = 0;

    /** Is this billing status id the Inactive status? Resolved by name, as AutoDisconnectService does. */
    public static function isInactiveStatus($billingStatusId): bool
    {
        $inactiveId = DB::table('billing_status')->where('status_name', 'Inactive')->value('id') ?? 4;

        return (int) $billingStatusId === (int) $inactiveId;
    }

    /**
     * Move a postpaid account's billing day to the day it paid.
     *
     * The billing-day field runs 1-30 with a separate "last day of the month" option (0), so a
     * payment on the 31st becomes end-of-month rather than a day some months do not have.
     *
     * Never throws: the payment and the reconnection already happened, and a billing-day problem
     * must not undo or fail either.
     *
     * @return int|null the new billing day, or null when nothing changed
     */
    public function resetToPaymentDay(string $accountNo, Carbon $paidAt, string $source): ?int
    {
        try {
            $account = BillingAccount::where('account_no', $accountNo)->first();
            if (!$account || BillingAccount::isPrepaidType($account->generation_type)) {
                return null;
            }

            $newDay = $paidAt->day > 30 ? self::END_OF_MONTH : $paidAt->day;
            $oldDay = $account->billing_day;

            if ($oldDay !== null && (int) $oldDay === $newDay) {
                return null;
            }

            DB::table('billing_accounts')->where('id', $account->id)->update([
                'billing_day' => $newDay,
                'updated_at' => Carbon::now(),
            ]);

            Log::info('[BILLING DAY] Reset to payment day after reconnecting an Inactive postpaid account', [
                'account_no' => $accountNo,
                'old_billing_day' => $oldDay,
                'new_billing_day' => $newDay,
                'paid_at' => $paidAt->toDateTimeString(),
                'source' => $source,
            ]);

            try {
                \App\Models\ActivityLog::log(
                    'Billing Day Reset',
                    "Account {$accountNo} billing day changed from " . ($oldDay ?? 'none') . " to "
                        . ($newDay === self::END_OF_MONTH ? 'end of month' : $newDay)
                        . " (paid while Inactive, {$source})",
                    'info',
                    ['resource_type' => 'BillingAccount', 'resource_id' => $account->id, 'additional_data' => [
                        'account_no' => $accountNo, 'old_billing_day' => $oldDay, 'new_billing_day' => $newDay, 'source' => $source,
                    ]]
                );
            } catch (\Throwable $e) {
                // The billing day is already saved; a failed audit row must not undo it.
            }

            return $newDay;
        } catch (\Throwable $e) {
            Log::error('[BILLING DAY] Could not reset billing day for ' . $accountNo . ': ' . $e->getMessage());
            return null;
        }
    }
}
