<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records milestone achievement bonus claims per agent (added directly to the DB
 * ahead of this migration). Backfilled from the live schema. The agent_id FK
 * references users(id) and cascades on delete. Guarded for existing deployments.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('agent_achievement_claims')) {
            return;
        }

        Schema::create('agent_achievement_claims', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('agent_id');
            $table->integer('milestone');
            $table->decimal('amount', 10, 2)->default(1500.00);
            $table->timestamps();

            $table->foreign('agent_id', 'agent_achievement_claims_agent_id_foreign')
                ->references('id')->on('users')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_achievement_claims');
    }
};
