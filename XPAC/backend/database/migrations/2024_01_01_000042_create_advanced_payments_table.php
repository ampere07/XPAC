<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('advanced_payments', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('account_no')->nullable();
            $table->decimal('payment_amount', 10, 2)->nullable();
            $table->string('payment_month', 50)->nullable();
            $table->date('payment_date')->nullable();
            $table->string('status', 50)->default('Unused');
            $table->unsignedBigInteger('invoice_used_id')->nullable();
            $table->text('remarks')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('advanced_payments');
    }
};
