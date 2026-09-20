<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reports', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('report_name');
            $table->string('report_type', 100);
            $table->string('report_schedule', 100)->nullable();
            $table->string('day', 20)->nullable();
            $table->string('date_range', 100)->nullable();
            $table->time('report_time')->nullable();
            $table->string('send_to')->nullable();
            $table->string('created_by')->nullable();
            $table->string('file_url')->nullable();
            $table->string('csv_file_url', 500)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reports');
    }
};
