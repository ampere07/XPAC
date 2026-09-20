<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The automatic (schedule-triggered) cron kept resending the exact date_range
 * a report was created with, forever. `last_period_end` is the checkpoint
 * that lets it advance instead: the end date of the last successfully sent
 * automatic period. Manual sends (sendNow / --force) never read or write
 * this column and keep using date_range as-is.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reports', function (Blueprint $table) {
            if (!Schema::hasColumn('reports', 'last_period_end')) {
                $table->date('last_period_end')->nullable()->after('last_dispatched_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('reports', function (Blueprint $table) {
            if (Schema::hasColumn('reports', 'last_period_end')) {
                $table->dropColumn('last_period_end');
            }
        });
    }
};
