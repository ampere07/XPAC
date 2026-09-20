<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rebates', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->integer('number_of_dates');
            $table->string('rebate_type');
            $table->string('selected_rebate');
            $table->string('status', 50);
            $table->string('created_by')->nullable();
            $table->string('modified_by')->nullable();
            $table->dateTime('modified_date')->nullable();
            $table->string('month', 50)->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rebates');
    }
};
