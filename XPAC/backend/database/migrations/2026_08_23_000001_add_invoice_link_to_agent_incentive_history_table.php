<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Links a completed quota incentive to the invoice that paid it.
 *
 * The incentive cron already records every Job Order it consumed on
 * `agent_incentive_history`, grouped into per-agent `batch_number` cycles — so
 * which customers belong to which completed quota is already stored, and is NOT
 * duplicated here. What was missing is the other half: whether that quota has
 * been billed yet, and on which invoice.
 *
 * `agent_invoice_id` is that record. NULL means the quota has been earned but
 * not yet invoiced; once set it is never cleared, which is what stops the same
 * incentive being paid on a second invoice. The weekly run claims rows with
 * `... WHERE agent_invoice_id IS NULL` and rolls its whole invoice back if it
 * did not win every row it intended to, so two runs racing cannot both bill the
 * same completed quota.
 *
 * `invoiced_at` is when that claim happened, kept separate from `processed_at`
 * (when the cron awarded the quota) because the two answer different questions:
 * which week the incentive belongs to, versus when it was paid out.
 *
 * No foreign key to agent_invoices. Nothing deletes an agent invoice today —
 * there is no such route — but if one is ever added, the right response is to
 * clear this column and return those quotas to the unbilled pool, NOT to
 * cascade-delete the ledger rows that are the proof a quota was reached in the
 * first place. A cascading FK would make the wrong one automatic.
 *
 * Every step is guarded so the migration is safe to run twice, and safe on a
 * deployment where the columns were already added by hand from the SQL script
 * in database/sql/.
 */
return new class extends Migration
{
    private const TABLE = 'agent_incentive_history';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            if (!Schema::hasColumn(self::TABLE, 'agent_invoice_id')) {
                // NULL = earned, not yet billed.
                $table->unsignedBigInteger('agent_invoice_id')->nullable()->after('organization_id');
            }

            if (!Schema::hasColumn(self::TABLE, 'invoiced_at')) {
                $table->timestamp('invoiced_at')->nullable()->after('agent_invoice_id');
            }
        });

        // Added separately, and tolerantly: a deployment that already had the
        // columns skips the block above but may still be missing the indexes,
        // and one that has both must not fail here.
        $this->tryIndex(['agent_invoice_id'], 'idx_aih_invoice');
        // The exact shape of the weekly claim query: this agent, unbilled,
        // awarded inside this billing week.
        $this->tryIndex(['agent_id', 'agent_invoice_id', 'processed_at'], 'idx_aih_agent_invoice_processed');
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        $this->tryDropIndex('idx_aih_agent_invoice_processed');
        $this->tryDropIndex('idx_aih_invoice');

        Schema::table(self::TABLE, function (Blueprint $table) {
            foreach (['invoiced_at', 'agent_invoice_id'] as $column) {
                if (Schema::hasColumn(self::TABLE, $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }

    /**
     * Create an index, treating "it is already there" as success.
     *
     * There is no portable way to ask whether a named index exists without
     * doctrine/dbal, which this project does not install. Attempting it and
     * swallowing the duplicate-name error is the same outcome and needs no
     * extra dependency.
     */
    private function tryIndex(array $columns, string $name): void
    {
        foreach ($columns as $column) {
            if (!Schema::hasColumn(self::TABLE, $column)) {
                return;
            }
        }

        try {
            Schema::table(self::TABLE, function (Blueprint $table) use ($columns, $name) {
                $table->index($columns, $name);
            });
        } catch (\Throwable $e) {
            // Already present. Nothing to do.
        }
    }

    private function tryDropIndex(string $name): void
    {
        try {
            Schema::table(self::TABLE, function (Blueprint $table) use ($name) {
                $table->dropIndex($name);
            });
        } catch (\Throwable $e) {
            // Never created, or already dropped.
        }
    }
};
