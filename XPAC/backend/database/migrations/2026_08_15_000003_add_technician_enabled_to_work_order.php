<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whether a technician may open and start this work order out of turn.
 *
 * The Work Order twin of job_orders.technician_enabled and
 * service_orders.technician_enabled. A technician works their queue In Progress
 * first and oldest first within that: only the record at the top is actionable,
 * and the rest of the active work is locked. An administrator can release a
 * specific work order early by setting this flag.
 *
 * Note the table is `work_order`, singular — that is the existing name, not a
 * typo (see App\Models\WorkOrder::$table).
 *
 * Defaults to 0 — locked — so existing rows keep the queue order and only an
 * explicit administrator action opens one up. The flag is only ever consulted
 * for technicians; every other role is unaffected by it.
 *
 * Guarded so it is safe to run twice.
 */
return new class extends Migration
{
    private const TABLE = 'work_order';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        if (!Schema::hasColumn(self::TABLE, 'technician_enabled')) {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->boolean('technician_enabled')->default(0)->after('assign_to');
            });
        }

        // Resolving "which work order is this technician's next one?" reads the
        // whole assigned queue on every technician write, and the flag decides
        // whether a record further down is allowed through.
        try {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->index(['assign_to', 'technician_enabled'], 'work_order_technician_enabled_index');
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
                $t->dropIndex('work_order_technician_enabled_index');
            });
        } catch (\Throwable $e) {
            // Never existed.
        }

        if (Schema::hasColumn(self::TABLE, 'technician_enabled')) {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->dropColumn('technician_enabled');
            });
        }
    }
};
