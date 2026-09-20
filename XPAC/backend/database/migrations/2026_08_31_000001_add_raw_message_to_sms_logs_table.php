<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The message as it was composed, beside the message as it was sent.
 *
 * sms_logs.message has always held the final text — variables already replaced
 * with the recipient's own account number, balance and so on. That is the right
 * thing to keep: it is what the subscriber received. But it loses the template
 * behind it, so there is no way to tell from the log whether two messages that
 * read differently were in fact the same composed message sent to two accounts.
 *
 * raw_message keeps the composed form, placeholders intact, when the caller
 * sends one. Nullable and never backfilled: every message logged before this,
 * and every send that had no variables in it, simply has nothing to put here.
 *
 * Guarded so it is safe to run twice, and ItexmoSmsService only writes the
 * column when it exists, so the log keeps working on a database where this
 * migration has not been run yet.
 */
return new class extends Migration
{
    private const TABLE = 'sms_logs';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE) || Schema::hasColumn(self::TABLE, 'raw_message')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $t) {
            $t->text('raw_message')->nullable()->after('message');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE) || !Schema::hasColumn(self::TABLE, 'raw_message')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $t) {
            $t->dropColumn('raw_message');
        });
    }
};
