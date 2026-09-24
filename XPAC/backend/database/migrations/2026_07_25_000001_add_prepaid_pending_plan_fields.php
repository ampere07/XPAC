<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Prepaid plan changes bought from the customer app are QUEUED, not applied on the spot.
     *
     * A prepaid customer who is still inside a period they already paid for keeps that plan
     * until it lapses; the plan they just bought takes over at that exact moment. This adds
     * the state needed to hold that switch:
     *
     *  - pending_payments.selected_plan_id     the plan chosen at checkout, held until the
     *                                          payment actually settles (the Xendit webhook
     *                                          can arrive minutes or hours later).
     *  - billing_accounts.pending_plan_id      the queued switch and the moment it takes
     *    billing_accounts.pending_plan_effective_at
     *                                          effect. Applied by the scheduled command
     *                                          `prepaid:apply-pending-plans`, then cleared.
     *
     * No `after()` anchors: generation_type / prepaid_expires_at were added to
     * billing_accounts outside of migrations, so they are not guaranteed to exist on a
     * freshly migrated database and cannot be positioned against.
     */
    public function up(): void
    {
        Schema::table('billing_accounts', function (Blueprint $table) {
            if (!Schema::hasColumn('billing_accounts', 'pending_plan_id')) {
                $table->unsignedBigInteger('pending_plan_id')->nullable();
            }
            if (!Schema::hasColumn('billing_accounts', 'pending_plan_effective_at')) {
                $table->dateTime('pending_plan_effective_at')->nullable();
            }
        });

        // Indexed separately: the daily command scans for rows that are due, and this keeps
        // that scan off a full table read.
        if (Schema::hasColumn('billing_accounts', 'pending_plan_effective_at')
            && !$this->indexExists('billing_accounts', 'billing_accounts_pending_plan_effective_at_index')) {
            Schema::table('billing_accounts', function (Blueprint $table) {
                $table->index('pending_plan_effective_at', 'billing_accounts_pending_plan_effective_at_index');
            });
        }

        Schema::table('pending_payments', function (Blueprint $table) {
            if (!Schema::hasColumn('pending_payments', 'selected_plan_id')) {
                $table->unsignedBigInteger('selected_plan_id')->nullable()->after('plan');
            }
        });
    }

    public function down(): void
    {
        Schema::table('billing_accounts', function (Blueprint $table) {
            if ($this->indexExists('billing_accounts', 'billing_accounts_pending_plan_effective_at_index')) {
                $table->dropIndex('billing_accounts_pending_plan_effective_at_index');
            }
        });

        Schema::table('billing_accounts', function (Blueprint $table) {
            foreach (['pending_plan_id', 'pending_plan_effective_at'] as $column) {
                if (Schema::hasColumn('billing_accounts', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        Schema::table('pending_payments', function (Blueprint $table) {
            if (Schema::hasColumn('pending_payments', 'selected_plan_id')) {
                $table->dropColumn('selected_plan_id');
            }
        });
    }

    /** Index presence check that works on MySQL without doctrine/dbal. */
    private function indexExists(string $table, string $index): bool
    {
        try {
            $database = Schema::getConnection()->getDatabaseName();
            return !empty(Schema::getConnection()->select(
                'SELECT 1 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ? LIMIT 1',
                [$database, $table, $index]
            ));
        } catch (\Throwable $e) {
            return false;
        }
    }
};
