<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Record of every SMS sent (single + blast, all providers). Mirrors the
 * production sms_logs table (previously created via database/sql/create_sms_logs_table.sql).
 * Guarded so it is safe alongside an already-existing table.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('sms_logs')) {
            return;
        }

        Schema::create('sms_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('organization_id')->nullable();
            $table->string('account_no', 50)->nullable();
            $table->string('contact_no', 50);
            $table->text('message');
            $table->integer('message_length')->nullable();
            $table->string('provider', 50)->nullable()->default('itexmo');
            $table->string('sender_id', 50)->nullable();
            $table->enum('status', ['sent', 'failed'])->default('sent');
            $table->integer('attempts')->default(1);
            $table->text('error_message')->nullable();
            $table->text('provider_response')->nullable();
            $table->string('source', 50)->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->timestamps();

            $table->index('contact_no', 'idx_sms_logs_contact_no');
            $table->index('account_no', 'idx_sms_logs_account_no');
            $table->index('status', 'idx_sms_logs_status');
            $table->index('provider', 'idx_sms_logs_provider');
            $table->index('sent_at', 'idx_sms_logs_sent_at');
            $table->index('organization_id', 'idx_sms_logs_organization_id');
            $table->index('created_by_user_id', 'idx_sms_logs_created_by_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sms_logs');
    }
};
