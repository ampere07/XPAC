<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ledger of Job Orders already counted toward an agent quota incentive award
 * (written by the AgentIncentiveService cron). The UNIQUE key on job_order_id
 * makes duplicate processing impossible. Guarded for existing deployments.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('agent_incentive_history')) {
            return;
        }

        Schema::create('agent_incentive_history', function (Blueprint $table) {
            $table->id();
            $table->integer('agent_id');
            $table->unsignedBigInteger('job_order_id');
            $table->integer('quota_reached')->default(0);
            $table->integer('batch_number')->default(0); // per-agent incrementing quota cycle number
            $table->decimal('incentive_value', 15, 2)->default(0);
            $table->bigInteger('organization_id')->nullable();
            $table->timestamp('processed_at')->nullable()->useCurrent();
            $table->timestamps();

            $table->unique('job_order_id', 'uq_aih_job_order_id');
            $table->index('agent_id', 'idx_aih_agent_id');
            $table->index(['agent_id', 'job_order_id'], 'idx_aih_agent_job');
            $table->index(['agent_id', 'batch_number'], 'idx_aih_agent_batch');
            $table->index('organization_id', 'idx_aih_organization_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_incentive_history');
    }
};
