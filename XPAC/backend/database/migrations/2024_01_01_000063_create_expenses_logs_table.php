<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expenses_logs', function (Blueprint $table) {
            $table->string('id', 50);
            $table->bigInteger('organization_id')->nullable();
            $table->date('date')->nullable();
            $table->string('provider', 150)->nullable();
            $table->text('description')->nullable();
            $table->decimal('amount', 13, 2)->nullable();
            $table->string('photo', 300)->nullable();
            $table->string('processed_by', 150)->nullable();
            $table->string('modified_by', 150)->nullable();
            $table->dateTime('modified_date')->nullable();
            $table->string('user_email', 150)->nullable();
            $table->string('location', 150)->nullable();
            $table->string('payee', 300)->nullable();
            $table->string('category', 150)->nullable();
            $table->string('invoice_no', 300)->nullable();
            $table->string('reference_no', 300)->nullable();
            $table->date('received_date')->nullable();
            $table->string('supplier', 150)->nullable();
            $table->string('barangay', 150)->nullable();
            $table->string('city', 300)->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('expenses_logs');
    }
};
