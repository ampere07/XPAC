<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Records whether a service order's charge has already been posted to the balance.
 *
 * Two separate transitions each mean "the customer owes for this work" —
 * support_status reaching Resolved, and visit_status reaching Done — and a service
 * order normally passes through both on separate saves. Each fired its own balance
 * update, so a ₱500 charge was added twice: once when the technician closed the
 * visit, again when support resolved the order.
 *
 * `status` was carrying this meaning informally (written as 'used' after posting)
 * but it is listed in the update endpoint's allowed fields, so the edit modal posts
 * it back on every save and a stale form could reset it to 'unused' and re-arm the
 * charge. This column is deliberately NOT client-writable and not on the model's
 * $fillable: only the code that actually moves the money sets it.
 *
 * Nullable with no default, so 'added' is the only value that ever means "posted"
 * and a row written before this migration reads as null rather than as a lie.
 */
return new class extends Migration
{
    private const TABLE = 'service_orders';
    private const COLUMN = 'service_charge_status';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        if (!Schema::hasColumn(self::TABLE, self::COLUMN)) {
            Schema::table(self::TABLE, function (Blueprint $table): void {
                $table->string(self::COLUMN, 20)->nullable()->after('service_charge');
            });
        }

        // Backfill, or every order charged before today would be charged a second
        // time on its next qualifying save — the exact bug this column exists to stop.
        //
        // Three signals that money already moved, OR'd together because the most
        // direct one is unreliable: 'used' is what the old code wrote after posting,
        // but a stale client could have reset it, so a Done visit or a Resolved
        // order carrying a charge is treated as already posted too. store() never
        // touches the balance, so the only way such a row exists is an update() that
        // ran the posting block.
        //
        // Deliberately biased towards over-marking. Marking one row 'added' that was
        // never posted means a charge someone can notice and add by hand; missing one
        // means billing a customer twice, which is what we are here to prevent.
        $backfilled = DB::table(self::TABLE)
            ->whereNull(self::COLUMN)
            ->whereRaw('COALESCE(service_charge, 0) > 0')
            ->where(function ($query): void {
                $query->whereRaw("LOWER(TRIM(COALESCE(status, ''))) = 'used'")
                    ->orWhereRaw("LOWER(TRIM(COALESCE(visit_status, ''))) = 'done'")
                    ->orWhereRaw("LOWER(TRIM(COALESCE(support_status, ''))) = 'resolved'");
            })
            ->update([self::COLUMN => 'added']);

        Log::info('Backfilled service_charge_status on existing service orders', ['rows' => $backfilled]);
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        if (Schema::hasColumn(self::TABLE, self::COLUMN)) {
            Schema::table(self::TABLE, function (Blueprint $table): void {
                $table->dropColumn(self::COLUMN);
            });
        }
    }
};
