<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_preferences', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('user_id');
            $table->string('preference_key', 100);
            $table->text('preference_value')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'preference_key'], 'unique_user_preference');
            $table->index('user_id', 'idx_user_id');
            $table->index('preference_key', 'idx_preference_key');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_preferences');
    }
};
