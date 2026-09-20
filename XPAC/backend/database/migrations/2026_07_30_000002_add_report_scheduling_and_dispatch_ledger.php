<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ── Scheduling fields ────────────────────────────────────────────────
        //
        // `day` alone cannot express every schedule the UI offers. A weekly
        // report needs a weekday and a yearly report needs a month, so the old
        // form demanded a day-of-month for every schedule and the queueing
        // command had to guess the month from the record's creation date.
        Schema::table('reports', function (Blueprint $table) {
            if (!Schema::hasColumn('reports', 'report_weekday')) {
                $table->string('report_weekday', 20)->nullable()->after('day');
            }
            if (!Schema::hasColumn('reports', 'report_month')) {
                $table->unsignedTinyInteger('report_month')->nullable()->after('report_weekday');
            }
            if (!Schema::hasColumn('reports', 'is_active')) {
                $table->boolean('is_active')->default(true)->after('send_to');
            }
            if (!Schema::hasColumn('reports', 'last_dispatched_at')) {
                $table->dateTime('last_dispatched_at')->nullable()->after('is_active');
            }
        });

        // ── Dispatch ledger ─────────────────────────────────────────────────
        //
        // One row per (report, scheduled occurrence). The UNIQUE index is the
        // duplicate-email guarantee: reports:queue runs every minute and can
        // overlap or be retried, and without this a report fires again on every
        // tick that matches its send time.
        if (!Schema::hasTable('report_dispatches')) {
            Schema::create('report_dispatches', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('report_id');
                $table->string('occurrence_key', 64);
                $table->dateTime('scheduled_for')->nullable();
                $table->dateTime('dispatched_at')->nullable();
                $table->string('status', 20)->default('queued');
                $table->unsignedSmallInteger('recipient_count')->default(0);
                $table->text('recipients')->nullable();
                $table->string('attachment_path', 500)->nullable();
                $table->string('attachment_type', 20)->nullable();
                $table->unsignedBigInteger('attachment_bytes')->nullable();
                $table->text('email_queue_ids')->nullable();
                $table->text('error_message')->nullable();
                $table->text('validation_issues')->nullable();
                $table->timestamps();

                $table->unique(['report_id', 'occurrence_key'], 'report_dispatches_occurrence_unique');
                $table->index('report_id');
                $table->index('scheduled_for');
                $table->index('status');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('report_dispatches');

        Schema::table('reports', function (Blueprint $table) {
            foreach (['report_weekday', 'report_month', 'is_active', 'last_dispatched_at'] as $column) {
                if (Schema::hasColumn('reports', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
