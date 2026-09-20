<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What an approved job order paid its referring agent.
 *
 * Approving a job order now settles it: the commission is credited to the
 * agent's balance there and then, and the figures used are written onto the job
 * order itself.
 *
 *   incentive_value   what one referral was worth toward the quota incentive at
 *                     the moment of approval
 *   commission_value  what the referral paid in commission at that moment
 *
 * Both are snapshots on purpose. An administrator may raise or lower either
 * setting later, and a job order approved last month must keep the figure it
 * was actually settled at — otherwise a change to the current rate would
 * silently restate money already paid.
 *
 *   agent_paid_at / agent_paid_to  when the credit was applied, and to whom
 *
 * `agent_paid_at` is what stops a second approval paying twice: it is set
 * inside the same transaction as the credit, so a row that carries it has
 * already been paid.
 *
 * Guarded so it is safe to run twice.
 */
return new class extends Migration
{
    private const TABLE = 'job_orders';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $t) {
            if (!Schema::hasColumn(self::TABLE, 'incentive_value')) {
                // Null on job orders approved before this existed; the cron
                // falls back to the agent's current rate for those.
                $t->decimal('incentive_value', 10, 2)->nullable();
            }

            if (!Schema::hasColumn(self::TABLE, 'commission_value')) {
                $t->decimal('commission_value', 10, 2)->nullable();
            }

            if (!Schema::hasColumn(self::TABLE, 'agent_paid_at')) {
                $t->timestamp('agent_paid_at')->nullable();
            }

            if (!Schema::hasColumn(self::TABLE, 'agent_paid_to')) {
                $t->unsignedBigInteger('agent_paid_to')->nullable();
            }
        });

        // Reading "has this job order already paid its agent?" happens on every
        // approval and on every cron pass.
        try {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->index(['agent_paid_to', 'agent_paid_at'], 'job_orders_agent_paid_index');
            });
        } catch (\Throwable $e) {
            // The index is already there.
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        try {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->dropIndex('job_orders_agent_paid_index');
            });
        } catch (\Throwable $e) {
            // Never existed.
        }

        foreach (['incentive_value', 'commission_value', 'agent_paid_at', 'agent_paid_to'] as $column) {
            if (Schema::hasColumn(self::TABLE, $column)) {
                Schema::table(self::TABLE, function (Blueprint $t) use ($column) {
                    $t->dropColumn($column);
                });
            }
        }
    }
};
