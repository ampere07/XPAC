<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_logs', function (Blueprint $table) {
            $table->string('id', 50);
            $table->bigInteger('organization_id')->nullable();
            $table->dateTime('date')->nullable();
            $table->string('item_name', 300)->nullable();
            $table->string('log_type')->nullable();
            $table->string('item_description', 192)->nullable();
            $table->string('account_no', 50)->nullable();
            $table->string('sn', 300)->nullable();
            $table->integer('item_quantity')->nullable();
            $table->string('requested_by', 150)->nullable();
            $table->string('requested_with', 150)->nullable();
            $table->string('requested_with_10', 150)->nullable();
            $table->string('status', 150)->nullable();
            $table->string('remarks', 300)->nullable();
            $table->string('modified_by', 150)->nullable();
            $table->dateTime('modified_date')->nullable();
            $table->string('user_email', 150)->nullable();
            $table->string('item_id', 50)->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_logs');
    }
};
