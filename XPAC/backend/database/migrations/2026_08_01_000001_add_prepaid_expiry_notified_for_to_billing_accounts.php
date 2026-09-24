<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Idempotency marker for the prepaid expiry notice.
     *
     * Prepaid renewals no longer raise an SOA or an invoice — the customer is told their period
     * lapsed and renews by paying for whichever plan they pick. That removed the record the old
     * renewal scan used to tell "already handled" from "needs handling": it skipped an account
     * that already carried an invoice dated on/after the expiry.
     *
     * This column takes over that job. It stores the exact `prepaid_expires_at` the notice was
     * last sent for, so the daily scan notifies once per lapsed period rather than every morning
     * for as long as the customer stays expired. It self-resets without any cleanup: paying moves
     * prepaid_expires_at forward, the stored value no longer matches, and the next lapse notifies
     * again.
     *
     * No `after()` anchor: prepaid_expires_at was added to billing_accounts outside of migrations,
     * so it is not guaranteed to exist on a freshly migrated database and cannot be positioned
     * against.
     */
    public function up(): void
    {
        Schema::table('billing_accounts', function (Blueprint $table) {
            if (!Schema::hasColumn('billing_accounts', 'prepaid_expiry_notified_for')) {
                $table->dateTime('prepaid_expiry_notified_for')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('billing_accounts', function (Blueprint $table) {
            if (Schema::hasColumn('billing_accounts', 'prepaid_expiry_notified_for')) {
                $table->dropColumn('prepaid_expiry_notified_for');
            }
        });
    }
};
