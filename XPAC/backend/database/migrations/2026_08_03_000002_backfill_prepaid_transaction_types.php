<?php

use App\Models\BillingAccount;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Relabel historical PREPAID payments as 'Top Up'.
     *
     * Before the split there was only one recurring type, so every prepaid payment was written as
     * 'Recurring Fee' (or left NULL by an older client). Those rows describe a top-up — they
     * bought service days, they never settled a monthly invoice, because prepaid accounts are
     * excluded from invoice generation. Leaving them mislabelled would make every
     * revenue-by-transaction-type report double-count prepaid income as postpaid recurring.
     *
     * Scope is deliberately narrow: 'Installation Fee' and 'Security Deposit' rows on prepaid
     * accounts are left exactly as they are. They mean the same thing on both account types.
     *
     * NULL is included per spec. A NULL on a prepaid account is a row written before the type was
     * mandatory, and the overwhelmingly common case is a service payment — the same thing the
     * 'Recurring Fee' rows are. The trade-off is accepted knowingly: a NULL that was really an
     * uncategorised installation fee becomes a top-up here, and down() cannot tell it back apart.
     *
     * Prepaid detection matches BillingAccount::PREPAID_ALIASES rather than a bare
     * `= 'Prepaid'` so accounts that never went through 2026_07_25_000003's normalisation — or
     * were written by an older client since — are still caught.
     */
    public function up(): void
    {
        if (!$this->tablesReady()) {
            return;
        }

        $updated = $this->prepaidTransactions()
            ->where(function ($query) {
                $query->where('transactions.transaction_type', self::LEGACY_TYPE)
                    ->orWhereNull('transactions.transaction_type');
            })
            ->update(['transactions.transaction_type' => self::PREPAID_TYPE]);

        // Logged rather than silent: this rewrites financial history, so the run needs a record of
        // how much it touched that can be checked against a pre-deploy count.
        Log::info("[MIGRATION] Backfilled {$updated} prepaid transaction(s) to '" . self::PREPAID_TYPE . "'");
    }

    /**
     * Put prepaid top-ups back to 'Recurring Fee'.
     *
     * Rows that were NULL before up() ran come back as 'Recurring Fee', not NULL — the original
     * distinction is not recoverable. That is a deliberate one-way loss: 'Recurring Fee' is the
     * value the rest of the system already treats a NULL as, so nothing reads differently.
     */
    public function down(): void
    {
        if (!$this->tablesReady()) {
            return;
        }

        $this->prepaidTransactions()
            ->where('transactions.transaction_type', self::PREPAID_TYPE)
            ->update(['transactions.transaction_type' => self::LEGACY_TYPE]);
    }

    private const LEGACY_TYPE = 'Recurring Fee';
    private const PREPAID_TYPE = 'Top Up';

    private function tablesReady(): bool
    {
        return Schema::hasTable('transactions')
            && Schema::hasTable('billing_accounts')
            && Schema::hasColumn('billing_accounts', 'generation_type');
    }

    /** Transactions whose account is prepaid, in any accepted spelling. */
    private function prepaidTransactions()
    {
        return DB::table('transactions')
            ->join('billing_accounts', 'transactions.account_no', '=', 'billing_accounts.account_no')
            ->whereIn('billing_accounts.generation_type', BillingAccount::PREPAID_ALIASES);
    }
};
