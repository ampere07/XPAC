<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('security_deposits', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('status', 100)->nullable();
            $table->dateTime('payment_date')->nullable();
            $table->string('reference_no')->nullable();
            $table->text('remarks')->nullable();
            $table->string('created_by')->nullable();
            $table->timestamps();
            $table->index('account_id', 'idx_account_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('security_deposits');
    }
};
