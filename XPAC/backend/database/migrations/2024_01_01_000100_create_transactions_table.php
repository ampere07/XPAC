<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('transactions', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('account_no')->nullable();
            $table->enum('transaction_type', ['installation fee', 'recurring fee', 'security deposit'])->nullable();
            $table->decimal('received_payment', 10, 2)->nullable();
            $table->decimal('account_balance_before', 10, 2)->nullable();
            $table->dateTime('payment_date')->nullable();
            $table->dateTime('date_processed')->nullable();
            $table->string('processed_by_user')->nullable();
            $table->string('payment_method')->nullable();
            $table->string('reference_no')->nullable();
            $table->string('or_no')->nullable();
            $table->text('remarks')->nullable();
            $table->string('status', 100)->nullable();
            $table->string('image_url')->nullable();
            $table->string('created_by_user')->nullable();
            $table->string('updated_by_user')->nullable();
            $table->string('approved_by')->nullable();
            $table->text('updated_column')->nullable();
            $table->timestamps();
            $table->index('account_no', 'transactions_account_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('transactions');
    }
};
