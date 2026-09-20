<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dc_notice', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->unsignedBigInteger('invoice_id')->nullable();
            $table->dateTime('dc_notice_date')->nullable();
            $table->string('print_link')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
            $table->index('account_id', 'dc_notice_account_id_foreign');
            $table->index('invoice_id', 'dc_notice_invoice_id_foreign');
            $table->index('created_by_user_id', 'dc_notice_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dc_notice');
    }
};
