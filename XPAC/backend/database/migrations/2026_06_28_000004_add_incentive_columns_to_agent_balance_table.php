<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the quota-incentive configuration columns to agent_balance.
 * Each column is guarded so the migration is idempotent and safe on
 * deployments where the columns were already added manually.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agent_balance', function (Blueprint $table) {
            if (!Schema::hasColumn('agent_balance', 'organization_id')) {
                $table->bigInteger('organization_id')->nullable();
            }
            if (!Schema::hasColumn('agent_balance', 'quota')) {
                $table->decimal('quota', 10, 2)->nullable();
            }
            if (!Schema::hasColumn('agent_balance', 'incentives_value')) {
                $table->decimal('incentives_value', 10, 2)->nullable();
            }
            if (!Schema::hasColumn('agent_balance', 'remarks')) {
                $table->text('remarks')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('agent_balance', function (Blueprint $table) {
            foreach (['organization_id', 'quota', 'incentives_value', 'remarks'] as $col) {
                if (Schema::hasColumn('agent_balance', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
