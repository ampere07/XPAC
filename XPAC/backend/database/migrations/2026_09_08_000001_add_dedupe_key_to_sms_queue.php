<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Make queueing an SMS idempotent, and make a queued row say where it came from.
     *
     * `dedupe_key` — stop a replayed producer queueing the same message twice. Every automated
     * producer is expected to re-run: a daily notification scan, an overlapping cron tick, an
     * operator double-clicking Send on an SMS blast. Storing the hash of what makes the message
     * unique under a UNIQUE index moves that judgement into the database, where the second insert
     * loses the race outright, rather than leaving it to application code that two concurrent
     * requests can both pass.
     *
     * Nullable on purpose, and NULL for anything queued without a natural key. MySQL permits any
     * number of NULLs in a unique index, so ad-hoc sends stay repeatable: texting the same customer
     * the same thing twice by hand is a legitimate operator action, and only the automated,
     * replayable paths are deduplicated.
     *
     * Existing rows keep NULL. Backfilling them would be wrong — they have already been sent, and
     * claiming their key would suppress a genuine future notice carrying the same wording.
     *
     * `source` / `reference_id` — carried through to sms_logs when the worker sends the row. Without
     * them every message the queue sends logs as an anonymous send, and "which blast texted this
     * subscriber?" has no answer in the data.
     *
     * @see \App\Services\SmsQueueService::dedupeKeyFor()      — must stay in step with this index.
     * @see \App\Services\SmsQueueService::blastDedupeKeyFor()
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

            if (!Schema::hasColumn('sms_queue', 'source')) {
                $table->string('source', 50)->nullable()->after('dedupe_key');
            }

            if (!Schema::hasColumn('sms_queue', 'reference_id')) {
                $table->string('reference_id', 100)->nullable()->after('source');
            }
        });

        if (!$this->hasIndex('uniq_sms_queue_dedupe_key')) {
            Schema::table('sms_queue', function (Blueprint $table) {
                $table->unique('dedupe_key', 'uniq_sms_queue_dedupe_key');
            });
        }

        // The worker reads pending rows oldest-first and skips those out of attempts; this is the
        // index that keeps that read cheap once a blast has put tens of thousands of rows in the
        // table. Without it every tick scans the lot.
        if (!$this->hasIndex('idx_sms_queue_status_attempts')) {
            Schema::table('sms_queue', function (Blueprint $table) {
                $table->index(['status', 'attempts', 'created_at'], 'idx_sms_queue_status_attempts');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('sms_queue')) {
            return;
        }

        if ($this->hasIndex('idx_sms_queue_status_attempts')) {
            Schema::table('sms_queue', function (Blueprint $table) {
                $table->dropIndex('idx_sms_queue_status_attempts');
            });
        }

        if ($this->hasIndex('uniq_sms_queue_dedupe_key')) {
            Schema::table('sms_queue', function (Blueprint $table) {
                $table->dropUnique('uniq_sms_queue_dedupe_key');
            });
        }

        Schema::table('sms_queue', function (Blueprint $table) {
            foreach (['dedupe_key', 'source', 'reference_id'] as $column) {
                if (Schema::hasColumn('sms_queue', $column)) {
                    $table->dropColumn($column);
                }
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
