<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whether a service order's charge has reached the customer's balance.
 *
 * A ticket finishes twice over: a technician marks the visit Done, and support
 * marks the ticket Resolved. Both mean "this job is finished, bill it", so both
 * were posting the service charge — the same charge landing on the account
 * twice for one job.
 *
 * The guard against that used to be arithmetic: read back what
 * `service_charge_logs` says has already been posted for this order and apply
 * only the difference. That is correct when the two saves arrive one after the
 * other, and wrong when they overlap — both requests read the same empty
 * ledger, both compute the full charge as owing, and both post it.
 *
 * This column is the claim that closes it. Posting the charge means winning a
 * conditional UPDATE from 'pending' to 'added' first; the row lock MySQL takes
 * for that serialises the two saves, and the one that finds the row already
 * 'added' posts nothing. `service_charge_logs` stays the ledger of amounts —
 * this only records whether the posting happened.
 *
 * Values: 'pending' (nothing on the balance yet) and 'added'. Existing rows
 * backfill to 'added' where the order already carries a charge and reads as
 * finished, since those charges are on the balance already and must not be
 * posted again by the next save of an old ticket.
 *
 * Written only by App\Http\Controllers\Api\ServiceOrderApiController::update,
 * never from the request body — which is why it is absent from that method's
 * allowed-field list. A client that could set it could clear it, and clearing
 * it is exactly how you charge a customer twice.
 *
 * Guarded so it is safe to run twice, and on a deployment where the column was
 * added by hand.
 */
return new class extends Migration
{
    private const TABLE  = 'service_orders';
    private const COLUMN = 'service_charge_status';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        if (!Schema::hasColumn(self::TABLE, self::COLUMN)) {
            Schema::table(self::TABLE, function (Blueprint $table) {
                $table->string(self::COLUMN, 20)
                    ->default('pending')
                    ->after('service_charge');
            });
        }

        // Backfill. A ticket that is finished and carries a charge has had that
        // charge posted by the old code path, so it is 'added' — marking it
        // 'pending' would invite the next save to post it a second time.
        //
        // Anything else is 'pending': an unfinished ticket, or a finished one
        // with no charge on it, has nothing on the balance to protect.
        \Illuminate\Support\Facades\DB::table(self::TABLE)
            ->whereNull(self::COLUMN)
            ->update([self::COLUMN => 'pending']);

        \Illuminate\Support\Facades\DB::table(self::TABLE)
            ->where(self::COLUMN, 'pending')
            ->where('service_charge', '>', 0)
            ->where(function ($query) {
                $query->whereRaw("LOWER(TRIM(COALESCE(support_status, ''))) = 'resolved'")
                    ->orWhereRaw("LOWER(TRIM(COALESCE(visit_status, ''))) IN ('done', 'completed')");
            })
            ->update([self::COLUMN => 'added']);
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE) || !Schema::hasColumn(self::TABLE, self::COLUMN)) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->dropColumn(self::COLUMN);
        });
    }
};
