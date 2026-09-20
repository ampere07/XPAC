<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_portal_logs', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('reference_no');
            $table->unsignedBigInteger('account_id')->nullable();
            $table->decimal('total_amount', 10, 2)->nullable();
            $table->decimal('account_balance_before', 10, 2)->nullable();
            $table->dateTime('date_time')->nullable();
            $table->string('checkout_id')->nullable();
            $table->string('status', 100)->nullable();
            $table->string('transaction_status', 100)->nullable();
            $table->string('ewallet_type', 100)->nullable();
            $table->string('payment_channel', 100)->nullable();
            $table->string('type', 100)->nullable();
            $table->text('payment_url')->nullable();
            $table->longText('json_payload')->nullable();
            $table->longText('callback_payload')->nullable();
            $table->timestamps();
            $table->unique('reference_no', 'reference_no');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_portal_logs');
    }
};
