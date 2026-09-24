<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Append-only payment audit log for `monthly_payables`.
     *
     * Every peso credited against a payable lands here as its own row. The payable's
     * `amount_paid` is only ever a recomputed sum of these rows, which is what makes a
     * mis-keyed payment correctable by deleting one ledger entry instead of hand-editing
     * a running total.
     *
     *  - receipt_path  per-payment, because a payable settled in three instalments has
     *                  three separate receipts. The most recent one is mirrored onto the
     *                  parent payable so the list view's "View Receipt" action has
     *                  something to open without joining.
     *  - cascadeOnDelete  a payable is soft-deleted in normal use, so this only fires on a
     *                  hard delete (forceDelete / manual cleanup), where orphaned ledger
     *                  rows would be pure garbage.
     */
    public function up(): void
    {
        Schema::create('payable_payments', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('monthly_payable_id');
            $table->decimal('amount', 12, 2);
            $table->date('payment_date');
            $table->string('payment_method', 100)->nullable();
            $table->string('reference_no', 150)->nullable();
            $table->string('receipt_path', 500)->nullable();
            $table->text('notes')->nullable();
            $table->string('recorded_by', 150)->nullable();
            $table->timestamps();

            $table->index(['monthly_payable_id', 'payment_date'], 'payable_payments_payable_date_index');

            $table->foreign('monthly_payable_id', 'payable_payments_monthly_payable_id_foreign')
                ->references('id')->on('monthly_payables')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payable_payments');
    }
};
