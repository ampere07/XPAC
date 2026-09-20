<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds a per-agent, incrementing `batch_number` to agent_incentive_history.
 *
 * Every full quota cycle awarded by AgentIncentiveService is one "batch".
 * When an agent has (e.g.) 20 completed Job Orders and a quota of 10, the run
 * awards 2 cycles — batch N and batch N+1 — with 10 Job Orders tagged to each,
 * instead of lumping all 20 into a single undistinguishable group.
 * Guarded so it is safe on deployments that already have the column.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('agent_incentive_history')) {
            return;
        }

        if (!Schema::hasColumn('agent_incentive_history', 'batch_number')) {
            Schema::table('agent_incentive_history', function (Blueprint $table) {
                // 0 = legacy rows recorded before batches were tracked.
                $table->integer('batch_number')->default(0)->after('quota_reached');
                $table->index(['agent_id', 'batch_number'], 'idx_aih_agent_batch');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('agent_incentive_history')) {
            return;
        }

        if (Schema::hasColumn('agent_incentive_history', 'batch_number')) {
            Schema::table('agent_incentive_history', function (Blueprint $table) {
                $table->dropIndex('idx_aih_agent_batch');
                $table->dropColumn('batch_number');
            });
        }
    }
};
