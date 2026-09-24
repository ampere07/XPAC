<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The plan a PREPAID customer is paying for, recorded on an over-the-counter transaction.
     *
     * Mirrors pending_payments.selected_plan_id on the portal side: staff pick the plan on the
     * transaction form, and at approval PrepaidPlanChangeService either queues the switch for
     * when the current prepaid period lapses or applies it immediately if it had expired.
     *
     * Always NULL for postpaid accounts — the transaction form only lets prepaid customers
     * change it.
     */
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            if (!Schema::hasColumn('transactions', 'selected_plan_id')) {
                $table->unsignedBigInteger('selected_plan_id')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            if (Schema::hasColumn('transactions', 'selected_plan_id')) {
                $table->dropColumn('selected_plan_id');
            }
        });
    }
};
