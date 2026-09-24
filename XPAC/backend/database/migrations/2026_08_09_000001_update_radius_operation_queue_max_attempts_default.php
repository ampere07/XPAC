<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bumps the default for radius_operation_queue.max_attempts from 5 to 10, matching the
 * retry backoff schedule in RadiusQueueService (10 steps, 5 minutes up to 24 hours).
 *
 * RadiusQueueService::queue() always sets max_attempts explicitly on insert, so this is
 * schema-level consistency rather than something callers rely on — but it keeps a bare
 * INSERT (or any future caller that omits the column) on the same schedule as the rest of
 * the system. Raw SQL because doctrine/dbal (needed for Blueprint::change()) is not
 * installed in this app.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('radius_operation_queue') || !Schema::hasColumn('radius_operation_queue', 'max_attempts')) {
            return;
        }

        DB::statement('ALTER TABLE radius_operation_queue ALTER COLUMN max_attempts SET DEFAULT 10');
    }

    public function down(): void
    {
        if (!Schema::hasTable('radius_operation_queue') || !Schema::hasColumn('radius_operation_queue', 'max_attempts')) {
            return;
        }

        DB::statement('ALTER TABLE radius_operation_queue ALTER COLUMN max_attempts SET DEFAULT 5');
    }
};
