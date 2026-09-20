<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pending_payments', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('account_no', 50);
            $table->string('reference_no');
            $table->decimal('amount', 10, 2);
            $table->string('status', 50)->default('PENDING');
            $table->dateTime('payment_date')->nullable();
            $table->string('provider', 50)->nullable()->default('XENDIT');
            $table->string('plan', 100)->nullable();
            $table->string('payment_id')->nullable();
            $table->string('payment_method_id')->nullable();
            $table->text('payment_url')->nullable();
            $table->text('json_payload')->nullable();
            $table->longText('callback_payload')->nullable();
            $table->dateTime('last_attempt_at')->nullable();
            $table->string('reconnect_status', 50)->nullable();
            $table->timestamps();
            $table->unique('reference_no', 'reference_no');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pending_payments');
    }
};
