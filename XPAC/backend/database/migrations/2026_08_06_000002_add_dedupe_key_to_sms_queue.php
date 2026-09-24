<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Stop a re-run of a notification scan queueing the same SMS twice.
     *
     * Every scheduled notice (billing, overdue, DC, prepaid lapse, prepaid pre-expiry) is queued
     * with a `time_sent`, so the message a given account is due to receive at a given moment is
     * fully determined by (account_no, contact_no, message, time_sent). Storing the hash of that
     * tuple under a UNIQUE index makes the insert itself idempotent: a second attempt loses the
     * race at the database rather than in application code, so overlapping cron runs — or a scan
     * that re-runs because its "already notified" marker failed to persist — cannot text a
     * customer twice.
     *
     * Nullable on purpose, and NULL for anything queued WITHOUT a time_sent. MySQL permits any
     * number of NULLs in a unique index, so ad-hoc/manual sends stay repeatable: sending the same
     * message to the same customer twice by hand is a legitimate operator action, and only the
     * automated, replayable paths are deduplicated.
     *
     * Existing rows keep NULL. Backfilling them would be wrong — they have already been sent, and
     * claiming their key would suppress a genuine future notice carrying the same wording.
     *
     * @see \App\Services\SmsQueueService::dedupeKeyFor() — the hash must stay in step with this.
     */
    public function up(): void
    {
        if (!Schema::hasTable('sms_queue')) {
            return;
        }

        Schema::table('sms_queue', function (Blueprint $table) {
            if (!Schema::hasColumn('sms_queue', 'dedupe_key')) {
                // 64 hex characters — sha256.
                $table->string('dedupe_key', 64)->nullable()->after('message');
            }
        });

        if (!$this->hasIndex('uniq_sms_queue_dedupe_key')) {
            Schema::table('sms_queue', function (Blueprint $table) {
                $table->unique('dedupe_key', 'uniq_sms_queue_dedupe_key');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('sms_queue')) {
            return;
        }

        if ($this->hasIndex('uniq_sms_queue_dedupe_key')) {
            Schema::table('sms_queue', function (Blueprint $table) {
                $table->dropUnique('uniq_sms_queue_dedupe_key');
            });
        }

        Schema::table('sms_queue', function (Blueprint $table) {
            if (Schema::hasColumn('sms_queue', 'dedupe_key')) {
                $table->dropColumn('dedupe_key');
            }
        });
    }

    /**
     * Checked by name rather than with a doctrine/dbal schema listing, which this install does not
     * require. Re-running the migration on a database that already carries the index must not fail.
     */
    private function hasIndex(string $name): bool
    {
        try {
            return count(DB::select("SHOW INDEX FROM `sms_queue` WHERE Key_name = ?", [$name])) > 0;
        } catch (\Throwable $e) {
            return false;
        }
    }
};
