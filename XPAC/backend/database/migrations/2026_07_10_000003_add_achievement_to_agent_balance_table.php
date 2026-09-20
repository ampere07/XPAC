<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the `achievement` running total to agent_balance (added directly to the
 * DB ahead of this migration). Guarded so it is idempotent and safe on
 * deployments where the column already exists.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('agent_balance')) {
            return;
        }

        if (!Schema::hasColumn('agent_balance', 'achievement')) {
            Schema::table('agent_balance', function (Blueprint $table) {
                $table->decimal('achievement', 10, 2)->nullable()->after('bonus');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('agent_balance', 'achievement')) {
            Schema::table('agent_balance', function (Blueprint $table) {
                $table->dropColumn('achievement');
            });
        }
    }
};
