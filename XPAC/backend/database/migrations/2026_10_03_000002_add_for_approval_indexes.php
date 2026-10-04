<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Status index for For Approval (ForApprovalQueueService).
 *
 * The queue's transaction list and the sidebar badge that counts it are both "transactions with
 * status Pending", and transactions.status was not indexed, so every page load and every badge
 * poll scanned the whole table for the handful of rows still pending. Unlike the Finance date
 * indexes, here status IS the selective column: nearly every row is Done, and the queue only
 * wants the few that are not. The queue compares it with plain equality (the column's collation
 * is case-insensitive), which this index can serve.
 *
 * Job orders need nothing new: the queue's selective condition there is account_id IS NULL (not
 * yet approved), which the existing job_orders account_id index already serves.
 *
 * Guarded the same way as 2026_10_03_000001_add_finance_date_indexes: these deployments were
 * built from SQL dumps, so INFORMATION_SCHEMA is asked whether any index already leads with the
 * column, under any name, before adding one.
 */
return new class extends Migration
{
    private const INDEXES = [
        ['table' => 'transactions', 'columns' => ['status'], 'name' => 'transactions_status_index'],
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
