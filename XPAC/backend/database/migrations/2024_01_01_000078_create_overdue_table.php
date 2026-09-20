<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('overdue', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('account_no')->nullable();
            $table->unsignedBigInteger('invoice_id')->nullable();
            $table->dateTime('overdue_date')->nullable();
            $table->string('print_link')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->index('invoice_id', 'overdue_invoice_id_foreign');
            $table->index('created_by_user_id', 'overdue_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('overdue');
    }
};
