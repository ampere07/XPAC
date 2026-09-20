<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('discounts', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('account_no')->nullable();
            $table->unsignedBigInteger('invoice_used_id')->nullable();
            $table->decimal('discount_amount', 10, 2)->nullable();
            $table->integer('remaining')->nullable();
            $table->string('status', 100)->nullable();
            $table->dateTime('used_date')->nullable();
            $table->dateTime('processed_date')->nullable();
            $table->unsignedBigInteger('processed_by_user_id')->nullable();
            $table->unsignedBigInteger('approved_by_user_id')->nullable();
            $table->text('remarks')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->index('invoice_used_id', 'discounts_invoice_used_id_foreign');
            $table->index('processed_by_user_id', 'discounts_processed_by_user_id_foreign');
            $table->index('approved_by_user_id', 'discounts_approved_by_user_id_foreign');
            $table->index('created_by_user_id', 'discounts_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('discounts');
    }
};
