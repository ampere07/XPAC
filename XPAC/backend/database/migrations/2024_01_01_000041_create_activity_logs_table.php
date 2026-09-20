<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('activity_logs', function (Blueprint $table) {
            $table->unsignedBigInteger('log_id');
            $table->string('level', 50);
            $table->string('action', 100);
            $table->text('message');
            $table->unsignedBigInteger('user_id')->nullable();
            $table->unsignedBigInteger('target_user_id')->nullable();
            $table->string('resource_type', 100)->nullable();
            $table->unsignedBigInteger('resource_id')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('additional_data')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
            $table->index('level', 'activity_logs_level_index');
            $table->index('action', 'activity_logs_action_index');
            $table->index('user_id', 'activity_logs_user_id_index');
            $table->index('target_user_id', 'activity_logs_target_user_id_index');
            $table->index('resource_type', 'activity_logs_resource_type_index');
            $table->index('created_at', 'activity_logs_created_at_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_logs');
    }
};
