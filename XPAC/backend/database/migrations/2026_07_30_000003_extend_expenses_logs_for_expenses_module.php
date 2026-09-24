<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Turns the read-only `expenses_logs` archive into the writable table behind the
     * Expenses module. Extended in place rather than replaced, so the rows the legacy
     * ExpensesLog page already reads keep working untouched.
     *
     *  - category_id    links to expenses_category.id. Nullable because every existing
     *                   row predates categories and only has the free-text `category`
     *                   string, which we keep populated in parallel so the legacy
     *                   ExpensesLogController@index response shape never changes.
     *  - expense_type   'daily' or 'monthly'. A bucket tag only: it decides which
     *                   summary card an expense lands in on the Expenses page. It does
     *                   not accrue, recur, or generate rows. Defaults to 'daily' so
     *                   pre-existing rows land somewhere sensible instead of NULL.
     *  - created_at     the table has `modified_date` but no insert timestamp, leaving
     *                   same-day rows with no stable tiebreak. Nullable: NULL means the
     *                   row predates this change.
     *  - deleted_at     soft delete, so removing an expense stays recoverable.
     *
     * Left alone on purpose: `id` stays varchar(50). The module generates UUIDs for it
     * the same way InventoryLog does, matching the other varchar-PK tables here.
     */
    private const INDEXES = [
        'expenses_logs_org_date_index',
        'expenses_logs_expense_type_index',
        'expenses_logs_category_id_index',
        'expenses_logs_deleted_at_index',
    ];

    /**
     * Schema::getIndexes() is Laravel 11+; this runs on 9.x, and doctrine/dbal is not a
     * dependency here. information_schema is the portable-enough read for MySQL/MariaDB.
     */
    private function hasIndex(string $name): bool
    {
        return DB::selectOne(
            'SELECT 1 FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = ?
                AND INDEX_NAME = ?
              LIMIT 1',
            ['expenses_logs', $name]
        ) !== null;
    }

    public function up(): void
    {
        Schema::table('expenses_logs', function (Blueprint $table) {
            if (!Schema::hasColumn('expenses_logs', 'category_id')) {
                $table->unsignedBigInteger('category_id')->nullable()->after('category');
            }
            if (!Schema::hasColumn('expenses_logs', 'expense_type')) {
                // varchar over enum: widening an enum later needs a table rewrite.
                $table->string('expense_type', 20)->default('daily')->after('category');
            }
            if (!Schema::hasColumn('expenses_logs', 'created_at')) {
                $table->timestamp('created_at')->nullable();
            }
            if (!Schema::hasColumn('expenses_logs', 'deleted_at')) {
                $table->timestamp('deleted_at')->nullable();
            }
        });

        // Indexes added in a second pass so a partially-applied run can be re-run safely.
        Schema::table('expenses_logs', function (Blueprint $table) {
            if (!$this->hasIndex('expenses_logs_org_date_index')) {
                $table->index(['organization_id', 'date'], 'expenses_logs_org_date_index');
            }
            if (!$this->hasIndex('expenses_logs_expense_type_index')) {
                $table->index('expense_type', 'expenses_logs_expense_type_index');
            }
            if (!$this->hasIndex('expenses_logs_category_id_index')) {
                $table->index('category_id', 'expenses_logs_category_id_index');
            }
            if (!$this->hasIndex('expenses_logs_deleted_at_index')) {
                $table->index('deleted_at', 'expenses_logs_deleted_at_index');
            }
        });
    }

    public function down(): void
    {
        Schema::table('expenses_logs', function (Blueprint $table) {
            foreach (self::INDEXES as $index) {
                if ($this->hasIndex($index)) {
                    $table->dropIndex($index);
                }
            }
        });

        Schema::table('expenses_logs', function (Blueprint $table) {
            foreach (['category_id', 'expense_type', 'created_at', 'deleted_at'] as $column) {
                if (Schema::hasColumn('expenses_logs', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
