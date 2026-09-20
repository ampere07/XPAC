<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('agent_balance', function (Blueprint $table) {
            $table->id();
            $table->integer('agent_id');
            $table->decimal('balance', 10, 2)->default(0.00);
            $table->decimal('commission', 10, 2)->default(0.00);
            $table->decimal('incentives', 10, 2)->default(0.00);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('agent_balance');
    }
};
