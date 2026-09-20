<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Agent bonus payout ledger (added directly to the DB ahead of this migration).
 * Backfilled from the live schema so a fresh `migrate` reproduces the table.
 * Guarded so it is safe on deployments that already have it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('agent_bonus_history')) {
            return;
        }

        Schema::create('agent_bonus_history', function (Blueprint $table) {
            $table->id();
            $table->integer('agent_id');
            $table->string('ref_number', 100);
            $table->decimal('total_amount', 15, 2)->default(0.00);
            $table->string('type', 50)->nullable();
            $table->string('proof_of_payment')->nullable();
            $table->text('remarks')->nullable();
            $table->string('created_by')->nullable();
            $table->string('updated_by')->nullable();
            $table->string('approve_by')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamp('created_at')->nullable()->useCurrent();
            $table->timestamp('updated_at')->nullable();

            $table->index('agent_id', 'idx_abh_agent_id');
            $table->index('organization_id', 'idx_abh_organization_id');
            $table->index('type', 'idx_abh_type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_bonus_history');
    }
};
