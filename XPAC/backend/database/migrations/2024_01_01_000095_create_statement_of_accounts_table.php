<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('statement_of_accounts', function (Blueprint $table) {
            $table->id();
            $table->string('account_no');
            $table->dateTime('statement_date')->nullable();
            $table->decimal('balance_from_previous_bill', 10, 2)->nullable();
            $table->decimal('payment_received_previous', 10, 2)->nullable();
            $table->decimal('remaining_balance_previous', 10, 2)->nullable();
            $table->decimal('monthly_service_fee', 10, 2)->nullable();
            $table->decimal('others_and_basic_charges', 10, 2)->nullable();
            $table->decimal('vat', 10, 2)->nullable();
            $table->dateTime('due_date')->nullable();
            $table->decimal('amount_due', 10, 2)->nullable();
            $table->decimal('total_amount_due', 10, 2)->nullable();
            $table->string('print_link')->nullable();
            $table->string('created_by')->nullable();
            $table->string('updated_by')->nullable();
            $table->decimal('service_charge', 10, 2)->nullable();
            $table->decimal('rebate', 10, 2)->nullable();
            $table->decimal('discounts', 10, 2)->nullable();
            $table->decimal('staggered', 10, 2)->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
            $table->index('account_no', 'soa_account_no_fk');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('statement_of_accounts');
    }
};
