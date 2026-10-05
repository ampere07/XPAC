<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The discount priced into a prepaid portal checkout (see CheckoutDiscountService).
     *
     * Recorded on the row because the payment settles later, when the Xendit webhook lands:
     *   discount_amount  what came off the plan price — PaymentWorkerService credits it to the
     *                    balance alongside the cash, so the purchase still counts as the full price.
     *   discount_ids     exactly which discounts were spent, so settlement consumes those and no
     *                    others.
     *
     * Nullable: NULL means no discount, which is how every existing row reads.
     */
    public function up(): void
    {
        if (!Schema::hasTable('pending_payments')) {
            return;
        }

        Schema::table('pending_payments', function (Blueprint $table) {
            if (!Schema::hasColumn('pending_payments', 'discount_amount')) {
                $table->decimal('discount_amount', 10, 2)->nullable();
            }
            if (!Schema::hasColumn('pending_payments', 'discount_ids')) {
                $table->json('discount_ids')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('pending_payments')) {
            return;
        }

        Schema::table('pending_payments', function (Blueprint $table) {
            foreach (['discount_amount', 'discount_ids'] as $column) {
                if (Schema::hasColumn('pending_payments', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
