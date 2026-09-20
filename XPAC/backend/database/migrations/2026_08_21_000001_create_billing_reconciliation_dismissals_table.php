<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Accounts an operator has decided not to bill for a given cycle.
 *
 * The Billing Reconcile tool lists every account whose billing day has passed with no
 * invoice raised. Some of those are genuinely correct to leave alone — a line being
 * cut over, a dispute, an account about to be terminated — and without somewhere to
 * record that decision the same rows reappear on the worklist every morning and the
 * real problems get lost among them.
 *
 * Scoped to one billing period on purpose: a dismissal is a decision about THIS
 * month's bill, not a permanent exemption, so next cycle the account is reconsidered.
 *
 * The unique index is what makes the dismiss action idempotent — the service writes
 * with updateOrInsert, so a double-click or a repeated batch updates the row it
 * already wrote rather than adding a second one.
 *
 * Guarded, and guarded against the CONTRACT rather than against this file's own shape.
 * These deployments were built from SQL dumps, so the same table can differ
 * structurally between them; the exists-branch therefore asks INFORMATION_SCHEMA
 * whether `(billing_account_id, billing_period)` is unique under ANY index name rather
 * than looking for Laravel's generated one, and adds the constraint if it is missing.
 * It never assumes a surrogate `id` column is present.
 */
return new class extends Migration
{
    private const TABLE = 'billing_reconciliation_dismissals';
    private const UNIQUE_COLUMNS = ['billing_account_id', 'billing_period'];
    private const UNIQUE_NAME = 'billing_recon_dismissal_unique';

    public function up(): void
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->ensureUniqueConstraint();

            return;
        }

        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('billing_account_id');
            // Denormalised for the audit trail: the account number as it read when the
            // decision was made, so a later renumbering does not rewrite history.
            $table->string('account_no')->nullable();
            /** The cycle this decision covers, as `YYYY-MM` in Asia/Manila. */
            $table->string('billing_period', 7);
            $table->string('reason')->nullable();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();

            $table->unique(self::UNIQUE_COLUMNS, self::UNIQUE_NAME);
            $table->index('billing_period', 'billing_recon_dismissal_period_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists(self::TABLE);
    }

    /**
     * Is (billing_account_id, billing_period) already unique, under any index name?
     *
     * Asked of INFORMATION_SCHEMA rather than of a name, because a table created by
     * hand carries whatever name whoever created it chose. The index must cover
     * exactly these two columns: a wider composite unique index would satisfy a naive
     * name check while leaving the pair itself un-constrained, which is the difference
     * between updateOrInsert being idempotent and it inserting duplicates.
     */
    private function ensureUniqueConstraint(): void
    {
        foreach (self::UNIQUE_COLUMNS as $column) {
            if (!Schema::hasColumn(self::TABLE, $column)) {
                // The table exists but is not this table. Adding an index to it would
                // be a guess; leave it alone and let the operator look.
                return;
            }
        }

        $existing = DB::selectOne(
            'SELECT s.INDEX_NAME
               FROM INFORMATION_SCHEMA.STATISTICS s
               JOIN (
                    SELECT INDEX_NAME, COUNT(*) AS column_count
                      FROM INFORMATION_SCHEMA.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                     GROUP BY INDEX_NAME
               ) c ON c.INDEX_NAME = s.INDEX_NAME
              WHERE s.TABLE_SCHEMA = DATABASE()
                AND s.TABLE_NAME = ?
                AND s.NON_UNIQUE = 0
                AND c.column_count = 2
                AND s.COLUMN_NAME IN (?, ?)
              GROUP BY s.INDEX_NAME
             HAVING COUNT(DISTINCT s.COLUMN_NAME) = 2
              LIMIT 1',
            [self::TABLE, self::TABLE, self::UNIQUE_COLUMNS[0], self::UNIQUE_COLUMNS[1]]
        );

        if ($existing !== null) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->unique(self::UNIQUE_COLUMNS, self::UNIQUE_NAME);
        });
    }
};
