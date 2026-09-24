<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * "Activate Now" — the prepaid customer's choice of WHEN a plan change takes effect.
     *
     * Default (false/NULL): the switch is queued for the moment the current period lapses, which
     * is the behaviour PrepaidPlanChangeService has always had. The customer keeps the days they
     * already paid for.
     *
     * Checked (true): the new plan starts immediately and the remaining days on the current plan
     * are FORFEITED — prepaid_expires_at is reset to payment date + 30, not extended from the old
     * expiry. Destructive and irreversible, hence an explicit opt-in rather than a default.
     *
     * Recorded on the payment row rather than acted on at request time because neither pipeline
     * acts at request time: a counter transaction is approved later, and a portal payment settles
     * when the Xendit webhook lands. The flag has to survive that gap alongside selected_plan_id,
     * which is why it is stored in the same two places:
     *
     *   - transactions.activate_now      over-the-counter (TransactionController)
     *   - pending_payments.activate_now  customer portal, web and mobile (XenditPaymentController)
     *
     * Nullable rather than default-false so an existing row is distinguishable from a deliberate
     * "no" — every read path treats NULL as false, so no backfill is needed.
     */
    public function up(): void
    {
        foreach (self::TABLES as $table => $after) {
            if (!Schema::hasTable($table) || Schema::hasColumn($table, 'activate_now')) {
                continue;
            }

            Schema::table($table, function (Blueprint $blueprint) use ($table, $after) {
                $column = $blueprint->boolean('activate_now')->nullable();

                // Positioned next to selected_plan_id, the column it is only ever meaningful
                // alongside — but only when that column is actually present, since it was added by
                // a separate migration that a partially-migrated database may not have run yet.
                if (Schema::hasColumn($table, $after)) {
                    $column->after($after);
                }
            });
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::TABLES) as $table) {
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'activate_now')) {
                continue;
            }

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropColumn('activate_now');
            });
        }
    }

    /** table => the column to position activate_now after. */
    private const TABLES = [
        'transactions' => 'selected_plan_id',
        'pending_payments' => 'selected_plan_id',
    ];
};
