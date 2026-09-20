<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('router_models', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('model');
            $table->string('brand')->nullable();
            $table->text('description')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->unique('model', 'router_models_model_unique');
            $table->index('created_by_user_id', 'router_models_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('router_models');
    }
};
