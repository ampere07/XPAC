<?php

namespace App\Console\Commands;

use App\Models\BillingAccount;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Console\ConfirmableTrait;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Repairs invoices that were raised on top of an advance payment the customer had already made.
 *
 * The damage this cleans up
 * ========================
 * A customer paid through the portal before their invoice for the period existed. With no unpaid
 * invoice to settle against, PaymentWorkerService banked the money as a credit — a NEGATIVE
 * billing_accounts.account_balance. Billing generation then ran and ASSIGNED the new invoice total
 * over that balance instead of adding to it, so the credit vanished. The customer was left with an
 * 'Unpaid' invoice they had already paid, and once the due date passed AutoDisconnectService cut
 * them off and stapled a disconnection fee (invoices.service_charge) onto the same invoice.
 *
 * The overwrite itself is fixed in the billing generation services (the balance now accumulates
 * rather than being assigned). This command exists for the rows already damaged in production.
 *
 * What it does per matched payment
 * ================================
 *   - invoices.received_payment  = the portal payment amount
 *   - invoices.status            = 'Paid'
 *   - invoices.service_charge    = 0.00  (the disconnection fee is waived — the cut-off was our
 *                                         fault, the customer had paid)
 *   - invoices.total_amount      -= the waived service charge, so the fee is genuinely reversed
 *                                   and not merely hidden from the service_charge column
 *   - invoices.invoice_balance   = 0.00
 *   - invoices.payment_portal_log_ref = the portal reference_no (audit trail AND the idempotency
 *                                       marker that stops a second run re-applying the same money)
 *
 * Then billing_accounts.account_balance is recalculated from the invoice ledger as
 * SUM(total_amount - received_payment) across every invoice on the account. That sum is NOT
 * clamped at zero: where the customer paid more than they owed the result is negative, which is
 * exactly the overpayment credit this command is meant to restore.
 *
 * Prepaid accounts are the one exception — they never bank credit (a settling payment renews the
 * period instead, see PrepaidRenewalService), so their recalculated balance is floored at 0 to
 * match what PaymentWorkerService does live. Without that floor the next payment run would just
 * re-floor it anyway.
 *
 * Safety
 * ======
 * This rewrites financial records, so it previews by default and writes only with --commit.
 * In production --force is also required (ConfirmableTrait).
 */
class ReconcileAdvancePayments extends Command
{
    use ConfirmableTrait;

    protected $signature = 'billing:reconcile-advance-payments
        {--account= : Restrict to a single billing_accounts.account_no}
        {--since= : Only consider portal payments made on or after this date (Y-m-d)}
        {--until= : Only consider portal payments made on or before this date (Y-m-d)}
        {--commit : Actually write the changes. Without this the command only reports.}
        {--force : Skip the production confirmation prompt}';

    protected $description = 'Settle invoices that were generated on top of an already-paid advance portal payment, waive the resulting disconnection fees, and restore overpayment credits';

    /**
     * Money comparisons ride on DECIMAL(10,2) columns read back as floats, so anything under half
     * a centavo is rounding noise rather than a real balance.
     */
    private const EPSILON = 0.005;

    public function handle(): int
    {
        $isCommit = (bool) $this->option('commit');

        if ($isCommit && !$this->confirmToProceed('Reconciling advance payments rewrites invoices and account balances.')) {
            return self::FAILURE;
        }

        $payments = $this->candidatePayments();

        if ($payments->isEmpty()) {
            $this->info('No PAID portal payments matched the given filters. Nothing to reconcile.');
            return self::SUCCESS;
        }

        $this->line("Scanning {$payments->count()} PAID portal payment(s)...");
        $this->newLine();

        $applied = [];
        $skipped = [];
        $failed = [];
        $touchedAccounts = [];

        foreach ($payments as $payment) {
            try {
                $invoice = $this->findInvoiceRaisedAfter($payment);

                if (!$invoice) {
                    $skipped[] = [
                        'reference_no' => $payment->reference_no,
                        'account_no' => $payment->account_no,
                        'reason' => 'No later Unpaid / service-charged invoice to settle',
                    ];
                    continue;
                }

                $change = $this->buildChange($payment, $invoice);

                if ($isCommit) {
                    $this->applyChange($change);
                }

                $applied[] = $change;
                $touchedAccounts[$payment->account_no] = $payment->account_id;
            } catch (Throwable $e) {
                $failed[] = [
                    'reference_no' => $payment->reference_no,
                    'account_no' => $payment->account_no,
                    'error' => $e->getMessage(),
                ];

                Log::error('[RECONCILE ADVANCE] Failed to reconcile payment', [
                    'reference_no' => $payment->reference_no,
                    'account_no' => $payment->account_no,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Balances are recalculated once per account after every invoice on it has been settled,
        // so an account with two reconciled payments is summed once from its final invoice state
        // rather than being rewritten mid-way through.
        $balances = [];
        foreach ($touchedAccounts as $accountNo => $accountId) {
            try {
                $balances[] = $this->recalculateBalance((string) $accountNo, $isCommit);
            } catch (Throwable $e) {
                $failed[] = [
                    'reference_no' => '—',
                    'account_no' => $accountNo,
                    'error' => 'Balance recalculation failed: ' . $e->getMessage(),
                ];
            }
        }

        $this->report($applied, $balances, $skipped, $failed, $isCommit);

        Log::info('[RECONCILE ADVANCE] Run complete', [
            'mode' => $isCommit ? 'commit' : 'dry-run',
            'scanned' => $payments->count(),
            'reconciled' => count($applied),
            'accounts_rebalanced' => count($balances),
            'skipped' => count($skipped),
            'failed' => count($failed),
        ]);

        return empty($failed) ? self::SUCCESS : self::FAILURE;
    }

    /**
     * PAID portal payments that have not already been stapled to an invoice.
     *
     * Both status columns are checked: PaymentWorkerService writes the gateway's own value into
     * `status` (defaulting to 'PAID') and a fixed 'PAID' into `transaction_status`, so a gateway
     * that reports e.g. 'SUCCEEDED' would otherwise be missed.
     */
    private function candidatePayments()
    {
        $query = DB::table('payment_portal_logs as ppl')
            ->join('billing_accounts as ba', 'ba.id', '=', 'ppl.account_id')
            ->whereNotNull('ppl.account_id')
            ->where('ppl.total_amount', '>', 0)
            ->where(function ($q) {
                $q->whereRaw("UPPER(TRIM(COALESCE(ppl.status, ''))) = 'PAID'")
                    ->orWhereRaw("UPPER(TRIM(COALESCE(ppl.transaction_status, ''))) = 'PAID'");
            })
            // Idempotency: a reference already recorded on an invoice has been applied, either by
            // the live payment path or by an earlier run of this command.
            ->whereNotExists(function ($q) {
                $q->select(DB::raw(1))
                    ->from('invoices')
                    ->whereColumn('invoices.account_no', 'ba.account_no')
                    ->where(function ($inner) {
                        $inner->whereColumn('invoices.payment_portal_log_ref', 'ppl.reference_no')
                            ->orWhereColumn('invoices.transaction_id', 'ppl.reference_no');
                    });
            })
            ->select(
                'ppl.id as log_id',
                'ppl.reference_no',
                'ppl.total_amount as payment_amount',
                'ppl.account_id',
                'ba.account_no',
                'ba.account_balance',
                'ba.generation_type',
                // date_time is what the worker stamps the settlement with; created_at is the
                // fallback for rows imported without it.
                DB::raw('COALESCE(ppl.date_time, ppl.created_at) as paid_at')
            )
            ->orderBy('ba.account_no')
            ->orderBy(DB::raw('COALESCE(ppl.date_time, ppl.created_at)'));

        if ($accountNo = $this->option('account')) {
            $query->where('ba.account_no', $accountNo);
        }

        if ($since = $this->option('since')) {
            $query->whereRaw('COALESCE(ppl.date_time, ppl.created_at) >= ?', [
                Carbon::parse($since)->startOfDay(),
            ]);
        }

        if ($until = $this->option('until')) {
            $query->whereRaw('COALESCE(ppl.date_time, ppl.created_at) <= ?', [
                Carbon::parse($until)->endOfDay(),
            ]);
        }

        return $query->get();
    }

    /**
     * The invoice this advance payment should have settled: the earliest one raised AFTER the
     * money arrived that is still unsettled or carries a disconnection fee.
     *
     * "Raised after the payment" is the whole point — an invoice generated before the payment was
     * made is ordinary billing that the live payment path already handled correctly.
     */
    private function findInvoiceRaisedAfter(object $payment): ?object
    {
        return DB::table('invoices')
            ->where('account_no', $payment->account_no)
            ->where('invoice_date', '>', $payment->paid_at)
            ->where(function ($q) {
                $q->whereRaw("COALESCE(status, '') <> 'Paid'")
                    ->orWhere('service_charge', '>', 0);
            })
            ->orderBy('invoice_date')
            ->orderBy('id')
            ->first();
    }

    /**
     * Works out the new invoice row without touching the database, so a dry run reports exactly
     * what a commit would write.
     */
    private function buildChange(object $payment, object $invoice): array
    {
        $paymentAmount = round((float) $payment->payment_amount, 2);
        $waivedServiceCharge = round((float) ($invoice->service_charge ?? 0), 2);
        $currentTotal = round((float) ($invoice->total_amount ?? 0), 2);

        // Waiving the fee has to come off the invoice total too. AutoDisconnectService added it to
        // service_charge, total_amount AND invoice_balance together; zeroing only service_charge
        // would leave the fee silently outstanding in the total and the recalculated balance.
        $newTotal = round($currentTotal - $waivedServiceCharge, 2);

        return [
            'invoice_id' => $invoice->id,
            'account_no' => $payment->account_no,
            'reference_no' => $payment->reference_no,
            'paid_at' => (string) $payment->paid_at,
            'invoice_date' => (string) $invoice->invoice_date,
            'old_status' => $invoice->status,
            'old_total' => $currentTotal,
            'new_total' => $newTotal,
            'old_received' => round((float) ($invoice->received_payment ?? 0), 2),
            'new_received' => $paymentAmount,
            'waived_service_charge' => $waivedServiceCharge,
        ];
    }

    private function applyChange(array $change): void
    {
        DB::transaction(function () use ($change) {
            DB::table('invoices')
                ->where('id', $change['invoice_id'])
                ->update([
                    'received_payment' => $change['new_received'],
                    'status' => 'Paid',
                    'service_charge' => 0.00,
                    'total_amount' => $change['new_total'],
                    'invoice_balance' => 0.00,
                    // Doubles as the idempotency marker read by candidatePayments().
                    'payment_portal_log_ref' => $change['reference_no'],
                    'updated_by' => 'Advance Payment Reconciliation',
                    'updated_at' => now(),
                ]);
        });

        Log::info('[RECONCILE ADVANCE] Invoice settled from advance payment', $change);
    }

    /**
     * Rebuilds account_balance from the invoice ledger.
     *
     * SUM(total_amount - received_payment) over every invoice on the account. Deliberately not
     * clamped at zero for postpaid accounts: a negative result IS the overpayment credit, and
     * clamping it is the very bug this command cleans up after.
     */
    private function recalculateBalance(string $accountNo, bool $isCommit): array
    {
        $account = DB::table('billing_accounts')->where('account_no', $accountNo)->first();

        if (!$account) {
            throw new \RuntimeException("Billing account {$accountNo} not found");
        }

        $outstanding = (float) DB::table('invoices')
            ->where('account_no', $accountNo)
            ->sum(DB::raw('COALESCE(total_amount, 0) - COALESCE(received_payment, 0)'));

        $newBalance = round($outstanding, 2);
        $isPrepaid = BillingAccount::isPrepaidType($account->generation_type ?? null);

        // Prepaid accounts never carry a credit — see the class docblock.
        if ($isPrepaid && $newBalance < 0) {
            $newBalance = 0.00;
        }

        // Guard against float noise writing a -0.00 or 0.004 style value.
        if (abs($newBalance) < self::EPSILON) {
            $newBalance = 0.00;
        }

        $oldBalance = round((float) $account->account_balance, 2);

        if ($isCommit && abs($newBalance - $oldBalance) >= self::EPSILON) {
            DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->update([
                    'account_balance' => $newBalance,
                    'balance_update_date' => Carbon::now('Asia/Manila')->format('Y-m-d'),
                    'updated_by' => 'Advance Payment Reconciliation',
                    'updated_at' => now(),
                ]);
        }

        $result = [
            'account_no' => $accountNo,
            'old_balance' => $oldBalance,
            'new_balance' => $newBalance,
            'credit_restored' => $newBalance < 0,
            'prepaid_floored' => $isPrepaid && $outstanding < 0,
        ];

        Log::info('[RECONCILE ADVANCE] Account balance recalculated', $result);

        return $result;
    }

    private function report(array $applied, array $balances, array $skipped, array $failed, bool $isCommit): void
    {
        if (!empty($applied)) {
            $this->info($isCommit ? 'Invoices settled:' : 'Invoices that WOULD be settled:');
            $this->table(
                ['Invoice', 'Account', 'Reference', 'Paid At', 'Invoice Date', 'Status', 'Received', 'Total', 'Fee Waived'],
                array_map(fn($row) => [
                    $row['invoice_id'],
                    $row['account_no'],
                    $row['reference_no'],
                    $row['paid_at'],
                    $row['invoice_date'],
                    $row['old_status'] . ' -> Paid',
                    number_format($row['old_received'], 2) . ' -> ' . number_format($row['new_received'], 2),
                    number_format($row['old_total'], 2) . ' -> ' . number_format($row['new_total'], 2),
                    number_format($row['waived_service_charge'], 2),
                ], $applied)
            );
            $this->newLine();
        }

        if (!empty($balances)) {
            $this->info($isCommit ? 'Account balances recalculated:' : 'Account balances that WOULD be recalculated:');
            $this->table(
                ['Account', 'Old Balance', 'New Balance', 'Note'],
                array_map(fn($row) => [
                    $row['account_no'],
                    number_format($row['old_balance'], 2),
                    number_format($row['new_balance'], 2),
                    $row['credit_restored']
                        ? 'Overpayment credit preserved'
                        : ($row['prepaid_floored'] ? 'Prepaid — credit floored to 0' : ''),
                ], $balances)
            );
            $this->newLine();
        }

        if (!empty($skipped)) {
            $this->comment('Skipped (' . count($skipped) . '):');
            foreach ($skipped as $row) {
                $this->line("  {$row['account_no']} / {$row['reference_no']}: {$row['reason']}");
            }
            $this->newLine();
        }

        if (!empty($failed)) {
            $this->error('Failed (' . count($failed) . '):');
            foreach ($failed as $row) {
                $this->error("  {$row['account_no']} / {$row['reference_no']}: {$row['error']}");
            }
            $this->newLine();
        }

        $waived = array_sum(array_column($applied, 'waived_service_charge'));
        $this->info(sprintf(
            'Reconciled: %d invoice(s) across %d account(s). Disconnection fees waived: %s. Skipped: %d. Failed: %d.',
            count($applied),
            count($balances),
            number_format($waived, 2),
            count($skipped),
            count($failed)
        ));

        if (!$isCommit) {
            $this->newLine();
            $this->warn('DRY RUN — nothing was written. Re-run with --commit to apply.');
        }
    }
}
