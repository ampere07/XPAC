<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('daily_expenses', function (Blueprint $table) {
            $table->string('id', 50);
            $table->date('date')->nullable();
            $table->string('provider', 150)->nullable();
            $table->decimal('total_amount', 13, 2)->nullable();
            $table->string('processed_by', 150)->nullable();
            $table->string('modified_by', 150)->nullable();
            $table->dateTime('modified_date')->nullable();
            $table->string('user_email', 150)->nullable();
            $table->string('location', 150)->nullable();
            $table->string('barangay', 150)->nullable();
            $table->string('city', 300)->nullable();
            $table->bigInteger('organization_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('daily_expenses');
    }
};
