<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_charge_logs', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('account_no')->nullable();
            $table->unsignedBigInteger('service_order_id')->nullable();
            $table->decimal('service_charge', 10, 2)->nullable();
            $table->string('status', 100)->nullable();
            $table->dateTime('date_used')->nullable();
            $table->text('remarks')->nullable();
            $table->string('created_by')->nullable();
            $table->string('updated_by')->nullable();
            $table->bigInteger('invoice_id')->nullable();
            $table->string('service_charge_type')->nullable();
            $table->timestamps();
            $table->index('service_order_id', 'service_charge_logs_service_order_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_charge_logs');
    }
};
