<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Stop a double-clicked Send button raising two blasts.
     *
     * Queueing is now instant, which removes the several-second wait that used to make an operator
     * stop and think before clicking again — so the window for an accidental second submit is wider
     * than it was, not narrower. The queue's own dedupe_key cannot help here: it is derived from the
     * blast id, and a second submit creates a second blast with a second id, so every one of its
     * rows hashes differently and every subscriber is texted twice.
     *
     * The client sends one `idempotency_key` per compose session and reuses it on retry. Under this
     * UNIQUE index the second insert loses at the database, and the controller answers with the
     * blast that already exists rather than queueing another batch. NULL is allowed and not
     * deduplicated, so an older client that sends no key still works exactly as before.
     */
    public function up(): void
    {
        if (!Schema::hasTable('sms_blast_logs')) {
            return;
        }

        Schema::table('sms_blast_logs', function (Blueprint $table) {
            if (!Schema::hasColumn('sms_blast_logs', 'idempotency_key')) {
                $table->string('idempotency_key', 64)->nullable()->after('message');
            }
        });

        if (!$this->hasIndex('uniq_sms_blast_logs_idempotency_key')) {
            Schema::table('sms_blast_logs', function (Blueprint $table) {
                $table->unique('idempotency_key', 'uniq_sms_blast_logs_idempotency_key');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('sms_blast_logs')) {
            return;
        }

        if ($this->hasIndex('uniq_sms_blast_logs_idempotency_key')) {
            Schema::table('sms_blast_logs', function (Blueprint $table) {
                $table->dropUnique('uniq_sms_blast_logs_idempotency_key');
            });
        }

        Schema::table('sms_blast_logs', function (Blueprint $table) {
            if (Schema::hasColumn('sms_blast_logs', 'idempotency_key')) {
                $table->dropColumn('idempotency_key');
            }
        });
    }

    private function hasIndex(string $name): bool
    {
        try {
            return count(DB::select("SHOW INDEX FROM `sms_blast_logs` WHERE Key_name = ?", [$name])) > 0;
        } catch (\Throwable $e) {
            return false;
        }
    }
};
