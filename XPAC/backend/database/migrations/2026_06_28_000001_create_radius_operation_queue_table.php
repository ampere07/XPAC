<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * RADIUS operation retry queue.
 *
 * Stores RADIUS operations (reconnect/restrict/disconnect/update_credentials)
 * that could not be applied immediately so the ProcessRadiusQueue cron can
 * retry them. Guarded so it is safe alongside an already-existing production table.
 *
 * NOTE: the production table was created manually without a primary key /
 * auto-increment id. This migration creates the correct, working structure
 * (auto-increment id + retry indexes) for fresh builds; on existing deployments
 * the guard skips it and the schema:sync tool leaves the live table untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('radius_operation_queue')) {
            return;
        }

        Schema::create('radius_operation_queue', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('organization_id')->nullable();
            $table->string('source_type', 50);
            $table->unsignedInteger('source_id');
            $table->string('account_no', 50)->nullable();
            $table->string('operation', 50);
            $table->longText('params');
            $table->string('status', 20)->default('pending');
            $table->unsignedInteger('attempts')->default(0);
            $table->unsignedInteger('max_attempts')->default(5);
            $table->text('last_error')->nullable();
            $table->dateTime('next_retry_at')->nullable();
            $table->string('created_by', 255)->nullable();
            $table->dateTime('completed_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'next_retry_at'], 'idx_roq_status_retry');
            $table->index('account_no', 'idx_roq_account_no');
            $table->index(['source_type', 'source_id'], 'idx_roq_source');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('radius_operation_queue');
    }
};
