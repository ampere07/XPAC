<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('defective_logs', function (Blueprint $table) {
            $table->string('id', 50);
            $table->date('date')->nullable();
            $table->string('item_name', 150)->nullable();
            $table->text('item_description')->nullable();
            $table->integer('item_quantity')->nullable();
            $table->string('requested_by', 150)->nullable();
            $table->string('status', 300)->nullable();
            $table->string('modified_by', 150)->nullable();
            $table->dateTime('modified_date')->nullable();
            $table->string('user_email', 150)->nullable();
            $table->bigInteger('organization_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('defective_logs');
    }
};
