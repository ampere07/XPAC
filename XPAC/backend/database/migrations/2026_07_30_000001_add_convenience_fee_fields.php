<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Online payments may carry a convenience fee charged on top of the bill.
     *
     *  - billing_config.convenience_fee_percentage   the rate staff configure, as a percentage
     *                                                (2.50 means 2.5%). 0 means no fee.
     *  - pending_payments.convenience_fee            what the fee came to for that one payment,
     *    pending_payments.convenience_fee_percentage  and the rate it was computed at. Frozen at
     *                                                checkout so a later config change never
     *                                                re-writes history.
     *
     * pending_payments.amount holds the GROSS charged (bill + fee); PaymentWorkerService
     * subtracts convenience_fee to get the amount that settles invoices. The fee columns are
     * nullable on purpose: NULL means the row predates this change and its amount is already
     * net, so the worker must not subtract anything from it.
     */
    public function up(): void
    {
        Schema::table('billing_config', function (Blueprint $table) {
            if (!Schema::hasColumn('billing_config', 'convenience_fee_percentage')) {
                $table->decimal('convenience_fee_percentage', 5, 2)->default(0.00);
            }
        });

        Schema::table('pending_payments', function (Blueprint $table) {
            if (!Schema::hasColumn('pending_payments', 'convenience_fee')) {
                $table->decimal('convenience_fee', 10, 2)->nullable()->after('amount');
            }
            if (!Schema::hasColumn('pending_payments', 'convenience_fee_percentage')) {
                $table->decimal('convenience_fee_percentage', 5, 2)->nullable()->after('convenience_fee');
            }
        });
    }

    public function down(): void
    {
        Schema::table('billing_config', function (Blueprint $table) {
            if (Schema::hasColumn('billing_config', 'convenience_fee_percentage')) {
                $table->dropColumn('convenience_fee_percentage');
            }
        });

        Schema::table('pending_payments', function (Blueprint $table) {
            foreach (['convenience_fee', 'convenience_fee_percentage'] as $column) {
                if (Schema::hasColumn('pending_payments', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
