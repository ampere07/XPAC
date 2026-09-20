<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where commission earned from approved job orders is held.
 *
 * `agent_balance` already has a `commission` column, but that is the RATE one
 * referral pays — the figure the payout screens read to work out what a job
 * order is worth. It is a setting, not a running total, so earnings cannot be
 * added to it.
 *
 * `commission_value` is the running total: every job order approved credits it
 * with the rate that job order was settled at.
 *
 *   commission        what one referral pays        (a setting)
 *   commission_value  what the agent has earned     (a balance)
 *
 * Guarded so it is safe to run twice.
 */
return new class extends Migration
{
    private const TABLE = 'agent_balance';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE) || Schema::hasColumn(self::TABLE, 'commission_value')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $t) {
            $t->decimal('commission_value', 12, 2)->default(0.00);
        });
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && Schema::hasColumn(self::TABLE, 'commission_value')) {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->dropColumn('commission_value');
            });
        }
    }
};
