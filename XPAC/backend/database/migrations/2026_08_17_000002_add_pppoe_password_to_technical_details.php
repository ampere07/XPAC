<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The PPPoE password, on the record that owns the PPPoE session.
 *
 * Until now this value only ever existed on the job order that provisioned the
 * line. That is where it is first captured, but it is not where anyone looks
 * for it: a technician troubleshooting an existing subscriber opens the
 * customer, not the install paperwork from two years ago. Support has been
 * reading it out of job orders by hand.
 *
 * Adding it to technical_details puts it beside the username it pairs with.
 * Existing subscribers have nothing to put here yet, so the column is nullable
 * and CustomerDetailController falls back to the originating job order when it
 * is blank — no backfill, and no lost passwords in the meantime.
 *
 * Guarded so it is safe to run twice.
 */
return new class extends Migration
{
    private const TABLE = 'technical_details';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        if (Schema::hasColumn(self::TABLE, 'pppoe_password')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $t) {
            $t->string('pppoe_password')->nullable();
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE) || !Schema::hasColumn(self::TABLE, 'pppoe_password')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $t) {
            $t->dropColumn('pppoe_password');
        });
    }
};
