<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->string('account_no');
            $table->dateTime('invoice_date')->nullable();
            $table->decimal('invoice_balance', 10, 2)->nullable();
            $table->decimal('others_and_basic_charges', 10, 2)->nullable();
            $table->decimal('total_amount', 10, 2)->nullable();
            $table->decimal('received_payment', 10, 2)->nullable();
            $table->dateTime('due_date')->nullable();
            $table->string('status', 100)->nullable();
            $table->string('payment_portal_log_ref')->nullable();
            $table->string('transaction_id')->nullable();
            $table->string('created_by')->nullable();
            $table->string('updated_by')->nullable();
            $table->decimal('service_charge', 10, 2)->nullable();
            $table->decimal('rebate', 10, 2)->nullable();
            $table->decimal('discounts', 10, 2)->nullable();
            $table->decimal('staggered', 10, 2)->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
            $table->index('transaction_id', 'invoices_transaction_id_foreign');
            $table->index('account_no', 'invoices_account_no_fk');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoices');
    }
};
