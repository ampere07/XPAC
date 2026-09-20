<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('work_order', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->text('instructions');
            $table->string('report_to');
            $table->string('assign_to')->nullable();
            $table->text('remarks')->nullable();
            $table->string('work_status', 100);
            $table->string('work_category')->nullable();
            $table->string('image_1', 500)->nullable();
            $table->string('image_2', 500)->nullable();
            $table->string('image_3', 500)->nullable();
            $table->string('signature', 500)->nullable();
            $table->string('requested_by');
            $table->dateTime('requested_date')->nullable();
            $table->string('updated_by')->nullable();
            $table->dateTime('updated_date')->nullable();
            $table->dateTime('start_time')->nullable();
            $table->dateTime('end_time')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('work_order');
    }
};
