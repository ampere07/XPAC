<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The email-queue counterpart of 2026_08_06_000002_add_dedupe_key_to_sms_queue.
     *
     * Same reasoning: a scheduled notice is fully determined by
     * (account_no, recipient_email, subject, time_sent), so hashing that tuple under a UNIQUE index
     * makes a re-run of any notification scan unable to email a customer twice. Attachments are
     * deliberately NOT part of the key — the same notice regenerated later may carry a freshly
     * downloaded temp PDF path, and that must not be mistaken for a different message.
     *
     * NULL for anything queued without a time_sent, which keeps ad-hoc and operator-triggered
     * sends repeatable. Existing rows keep NULL and are not backfilled.
     *
     * @see \App\Services\EmailQueueService::dedupeKeyFor() — the hash must stay in step with this.
     */
    public function up(): void
    {
        if (!Schema::hasTable('email_queue')) {
            return;
        }

        Schema::table('email_queue', function (Blueprint $table) {
            if (!Schema::hasColumn('email_queue', 'dedupe_key')) {
                $table->string('dedupe_key', 64)->nullable()->after('subject');
            }
        });

        if (!$this->hasIndex('uniq_email_queue_dedupe_key')) {
            Schema::table('email_queue', function (Blueprint $table) {
                $table->unique('dedupe_key', 'uniq_email_queue_dedupe_key');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('email_queue')) {
            return;
        }

        if ($this->hasIndex('uniq_email_queue_dedupe_key')) {
            Schema::table('email_queue', function (Blueprint $table) {
                $table->dropUnique('uniq_email_queue_dedupe_key');
            });
        }

        Schema::table('email_queue', function (Blueprint $table) {
            if (Schema::hasColumn('email_queue', 'dedupe_key')) {
                $table->dropColumn('dedupe_key');
            }
        });
    }

    private function hasIndex(string $name): bool
    {
        try {
            return count(DB::select("SHOW INDEX FROM `email_queue` WHERE Key_name = ?", [$name])) > 0;
        } catch (\Throwable $e) {
            return false;
        }
    }
};
