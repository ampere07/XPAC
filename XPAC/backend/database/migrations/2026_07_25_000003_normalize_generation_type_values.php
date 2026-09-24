<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Converge every generation_type spelling onto the canonical 'Prepaid' / 'Postpaid'.
     *
     * Matched on a lower-cased, whitespace-stripped basis rather than on exact strings, because
     * production held THREE spellings in practice — 'Pre Paid', 'PrePaid' and 'Prepaid'. An
     * exact `where('generation_type', 'Pre Paid')` silently skips 'PrePaid': the column collation
     * (utf8mb4_unicode_ci) makes the comparison case-insensitive but NOT whitespace-insensitive,
     * so the space is significant and the row would have been left un-normalised.
     *
     * A pure data migration; no schema change. Safe to run before or after the code deploy,
     * because every read path goes through BillingAccount::isPrepaidType() / PREPAID_ALIASES,
     * which already accept all of these — there is no window where a prepaid customer is
     * misclassified as postpaid.
     *
     * Both tables carry the column: job_orders is where it originates (the JO form) and
     * billing_accounts is where it is copied at approval.
     */
    public function up(): void
    {
        foreach (['billing_accounts', 'job_orders'] as $table) {
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'generation_type')) {
                continue;
            }

            // No "and not already canonical" guard: under a case-insensitive collation
            // 'PrePaid' != 'Prepaid' is FALSE, so such a guard would exclude precisely the rows
            // that need fixing. Rewriting an already-correct value is a no-op anyway.
            foreach (['prepaid' => 'Prepaid', 'postpaid' => 'Postpaid'] as $normalized => $canonical) {
                DB::table($table)
                    ->whereRaw("REPLACE(REPLACE(LOWER(generation_type), ' ', ''), '-', '') = ?", [$normalized])
                    ->update(['generation_type' => $canonical]);
            }
        }
    }

    public function down(): void
    {
        foreach (['billing_accounts', 'job_orders'] as $table) {
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'generation_type')) {
                continue;
            }

            DB::table($table)->where('generation_type', 'Prepaid')->update(['generation_type' => 'Pre Paid']);
            DB::table($table)->where('generation_type', 'Postpaid')->update(['generation_type' => 'Post Paid']);
        }
    }
};
