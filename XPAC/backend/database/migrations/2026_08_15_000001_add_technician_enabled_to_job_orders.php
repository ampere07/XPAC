<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whether a technician may open and start this job order out of turn.
 *
 * A technician works their queue oldest first: only the oldest job order that
 * has not yet moved forward is actionable, and everything newer is locked. An
 * administrator can release a specific job order early by setting this flag,
 * which is what makes it clickable for the technician ahead of the queue.
 *
 * Defaults to 0 — locked — so existing rows keep the queue order and only an
 * explicit administrator action opens one up. The flag is only ever consulted
 * for technicians; every other role is unaffected by it.
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

        if (!Schema::hasColumn(self::TABLE, 'technician_enabled')) {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->boolean('technician_enabled')->default(0)->after('assigned_email');
            });
        }

        // Resolving "which job order is this technician's next one?" reads the
        // whole assigned queue on every technician write, and the flag decides
        // whether a newer row is allowed through.
        try {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->index(['assigned_email', 'technician_enabled'], 'job_orders_technician_enabled_index');
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
                $t->dropIndex('job_orders_technician_enabled_index');
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
