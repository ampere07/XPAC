<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds audit / payout-detail columns to agent_commission_history.
 * Guarded per-column for idempotency.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agent_commission_history', function (Blueprint $table) {
            if (!Schema::hasColumn('agent_commission_history', 'updated_by')) {
                $table->string('updated_by', 255)->nullable();
            }
            if (!Schema::hasColumn('agent_commission_history', 'approve_by')) {
                $table->string('approve_by', 255)->nullable();
            }
            if (!Schema::hasColumn('agent_commission_history', 'commission_id_list')) {
                $table->text('commission_id_list')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('agent_commission_history', function (Blueprint $table) {
            foreach (['updated_by', 'approve_by', 'commission_id_list'] as $col) {
                if (Schema::hasColumn('agent_commission_history', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
