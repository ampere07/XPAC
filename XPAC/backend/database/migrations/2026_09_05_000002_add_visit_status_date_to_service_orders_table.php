<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The day a technician last moved a service order's visit status.
 *
 * Sits beside `visit_status` on the ticket, not on `roles`: it describes one
 * service order, so a column on the role table would hold a single date shared
 * by every technician of that role and overwritten by whichever of them touched
 * any ticket last.
 *
 * DATE rather than DATETIME because the question it answers is "which day did
 * the technician move this?" — a report groups by it, and a time component
 * would only make that grouping depend on the server's timezone.
 *
 * Nullable, and null on every existing row: the column records an act, and no
 * such act has been recorded for tickets that predate it. It is written only by
 * App\Http\Controllers\Api\ServiceOrderApiController::update, only when the
 * status actually changes, and only for a technician — never from the request
 * body, which is why it is absent from that method's allowed-field list.
 *
 * Guarded so it is safe to run twice, and on a deployment where the column was
 * added by hand.
 */
return new class extends Migration
{
    private const TABLE = 'service_orders';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE) || Schema::hasColumn(self::TABLE, 'visit_status_date')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->date('visit_status_date')->nullable()->after('visit_status');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE) || !Schema::hasColumn(self::TABLE, 'visit_status_date')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->dropColumn('visit_status_date');
        });
    }
};
