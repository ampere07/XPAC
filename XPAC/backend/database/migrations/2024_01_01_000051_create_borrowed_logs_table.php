<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('borrowed_logs', function (Blueprint $table) {
            $table->string('id', 50);
            $table->dateTime('date')->nullable();
            $table->string('item_name', 150)->nullable();
            $table->text('item_description')->nullable();
            $table->string('account_no', 50)->nullable();
            $table->string('sn', 300)->nullable();
            $table->integer('item_quantity')->nullable();
            $table->string('requested_by', 150)->nullable();
            $table->string('requested_with', 150)->nullable();
            $table->string('requested_with_10', 150)->nullable();
            $table->string('status', 150)->nullable();
            $table->string('remarks', 1024)->nullable();
            $table->string('modified_by', 150)->nullable();
            $table->dateTime('modified_date')->nullable();
            $table->string('user_email', 150)->nullable();
            $table->string('item_id', 50)->nullable();
            $table->bigInteger('organization_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('borrowed_logs');
    }
};
