<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('billing_config', function (Blueprint $table) {
            $table->id();
            $table->integer('advance_generation_day')->nullable();
            $table->integer('due_date_day')->nullable();
            $table->integer('disconnection_day')->nullable();
            $table->integer('overdue_day')->nullable();
            $table->integer('disconnection_notice')->nullable();
            $table->string('updated_by')->nullable();
            $table->decimal('disconnection_fee', 10, 2)->default(0.00);
            $table->integer('pullout_day')->nullable();
            $table->decimal('agent_commission', 10, 2)->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_config');
    }
};
