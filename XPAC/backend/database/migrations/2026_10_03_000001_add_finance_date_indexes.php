<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Date indexes for Billing → Finance (FinanceSummaryService).
 *
 * Every Finance query is "collected payments between these dates": transactions by
 * date_processed, payment_portal_logs by date_time. Neither column was indexed — transactions
 * only on account_no, payment_portal_logs only on reference_no and (account_id, status) — so
 * each request scanned both tables in full, and a month's summary cost the same as a decade's.
 * With these, a period reads only the rows inside it.
 *
 * Status is deliberately not part of the key: nearly every row in a period is collected, so it
 * filters almost nothing, and it is compared case-insensitively, which a leading status column
 * could not serve anyway.
 *
 * Guarded the same way as 2026_08_23_000001_add_pay_path_indexes: these deployments were built
 * from SQL dumps, so the check asks INFORMATION_SCHEMA whether any index already leads with the
 * column, under any name, before adding one.
 */
return new class extends Migration
{
    private const INDEXES = [
        ['table' => 'transactions', 'columns' => ['date_processed'], 'name' => 'transactions_date_processed_index'],
        ['table' => 'payment_portal_logs', 'columns' => ['date_time'], 'name' => 'payment_portal_logs_date_time_index'],
    ];

    /** Does any index on this table already lead with this column? */
    private function hasLeadingIndex(string $table, string $column): bool
    {
        $row = DB::selectOne(
            'SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND COLUMN_NAME = ?
               AND SEQ_IN_INDEX = 1
             LIMIT 1',
            [$table, $column]
        );

        return $row !== null;
    }

    public function up(): void
    {
        foreach (self::INDEXES as $index) {
            if (!Schema::hasTable($index['table'])) {
                continue;
            }

            foreach ($index['columns'] as $column) {
                if (!Schema::hasColumn($index['table'], $column)) {
                    continue 2;
                }
            }

            if ($this->hasLeadingIndex($index['table'], $index['columns'][0])) {
                continue;
            }

            Schema::table($index['table'], function ($table) use ($index) {
                $table->index($index['columns'], $index['name']);
            });
        }
    }

    public function down(): void
    {
        foreach (self::INDEXES as $index) {
            if (!Schema::hasTable($index['table'])) {
                continue;
            }

            // Dropped by the name this migration created, so an index that was already present
            // under another name — the reason up() skipped it — is left alone.
            $exists = DB::selectOne(
                'SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
                 LIMIT 1',
                [$index['table'], $index['name']]
            );

            if ($exists === null) {
                continue;
            }

            Schema::table($index['table'], function ($table) use ($index) {
                $table->dropIndex($index['name']);
            });
        }
    }
};
