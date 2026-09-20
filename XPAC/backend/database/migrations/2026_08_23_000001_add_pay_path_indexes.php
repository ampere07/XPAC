<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Indexes for the two lookups on the customer Pay Now path.
 *
 * Everything the balance card needs is a single-row read except these two, and neither
 * table had an index that could serve it:
 *
 *  - `pending_payments` is indexed only on `reference_no`. Every "does this customer
 *    already have a payment in progress?" check therefore scanned the whole table, and
 *    that check runs on every dashboard load and again on every Pay Now click.
 *  - `payment_portal_logs` is indexed only on `reference_no` too, so the `SUM` over
 *    `account_id` that CustomerDetailController computes for `totalPaid` scanned the
 *    whole table as well — on the one request the customer's amount due waits for.
 *
 * Both tables grow with every payment the business takes, so these scans get slower
 * for as long as the system is used, and they are slowest for exactly the customers
 * who have paid the most.
 *
 * Guarded against the CONTRACT rather than against this file's own shape, per the
 * other migrations here: these deployments were built from SQL dumps, so the same
 * table can differ between them. The check asks INFORMATION_SCHEMA whether ANY index
 * already leads with the column, under any name, rather than looking for the name
 * Laravel would have generated. An index that leads with the right column is what the
 * planner needs, so finding one means there is nothing to add.
 */
return new class extends Migration
{
    /**
     * Composite, leading column first. Each pairs the selective column the query
     * filters on with the low-cardinality status beside it, so the status filter is
     * satisfied from the index instead of by fetching rows.
     */
    private const INDEXES = [
        ['table' => 'pending_payments', 'columns' => ['account_no', 'status'], 'name' => 'pending_payments_account_no_status_index'],
        ['table' => 'payment_portal_logs', 'columns' => ['account_id', 'status'], 'name' => 'payment_portal_logs_account_id_status_index'],
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

            // Every column has to be present. A dump-built deployment missing one would
            // otherwise fail the whole migration over an index that is only an
            // optimisation.
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

            // Dropped by the name this migration created, so an index that was already
            // present under a different name — the reason up() skipped it — is left
            // alone rather than removed by a rollback that did not add it.
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
