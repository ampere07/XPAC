<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('installments', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->date('start_date')->nullable();
            $table->decimal('total_balance', 10, 2)->nullable();
            $table->integer('months_to_pay')->nullable();
            $table->decimal('monthly_payment', 10, 2)->nullable();
            $table->enum('status', ['active', 'completed', 'cancelled'])->nullable();
            $table->text('remarks')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
            $table->index('created_by', 'installments_created_by_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('installments');
    }
};
