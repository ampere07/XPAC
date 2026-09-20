<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mass_rebates', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->integer('rebate_days')->nullable();
            $table->integer('billing_day')->nullable();
            $table->string('status', 50)->default('Unused');
            $table->date('rebate_date')->nullable();
            $table->string('barangay_code', 50)->nullable();
            $table->text('description')->nullable();
            $table->text('remarks')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mass_rebates');
    }
};
