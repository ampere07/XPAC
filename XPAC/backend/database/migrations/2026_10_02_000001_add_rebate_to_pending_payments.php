<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The rebate priced into a prepaid portal checkout (see CheckoutRebateService), recorded the
     * same way as the discount (2026_10_01_000001):
     *   rebate_amount     what came off the plan price — PaymentWorkerService credits it to the
     *                     balance alongside the cash and the discount.
     *   rebate_usage_ids  {rebates_usage id: value quoted}, so settlement spends exactly those.
     *
     * Nullable: NULL means no rebate, which is how every existing row reads.
     */
    public function up(): void
    {
        if (!Schema::hasTable('pending_payments')) {
            return;
        }

        Schema::table('pending_payments', function (Blueprint $table) {
            if (!Schema::hasColumn('pending_payments', 'rebate_amount')) {
                $table->decimal('rebate_amount', 10, 2)->nullable();
            }
            if (!Schema::hasColumn('pending_payments', 'rebate_usage_ids')) {
                $table->json('rebate_usage_ids')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('pending_payments')) {
            return;
        }

        Schema::table('pending_payments', function (Blueprint $table) {
            foreach (['rebate_amount', 'rebate_usage_ids'] as $column) {
                if (Schema::hasColumn('pending_payments', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
