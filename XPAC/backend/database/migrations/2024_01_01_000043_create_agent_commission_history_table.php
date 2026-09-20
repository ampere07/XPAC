<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('agent_commission_history', function (Blueprint $table) {
            $table->id();
            $table->string('ref_number', 100);
            $table->decimal('total_amount', 10, 2);
            $table->string('created_by');
            $table->text('remarks')->nullable();
            $table->string('proof_of_payment')->nullable();
            $table->integer('agent_id');
            $table->bigInteger('organization_id')->nullable();
            $table->string('type', 50)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_commission_history');
    }
};
