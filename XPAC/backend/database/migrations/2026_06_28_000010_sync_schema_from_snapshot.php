<?php

use Illuminate\Database\Migrations\Migration;
use App\Services\SchemaSyncService;

/**
 * Incremental, non-destructive schema synchronization.
 *
 * This migration runs LAST (date-ordered after all create-table migrations).
 * It reconciles the current database against the committed db_schema.json
 * snapshot, adding only what is missing:
 *   • tables that don't exist yet
 *   • columns missing from existing tables
 *   • indexes / foreign keys that haven't been created
 *
 * It is fully idempotent and never drops or recreates anything, so it is safe
 * to run on existing production deployments without any data loss. On a fresh
 * clone the regular migrations build the tables first; this then fills any gap
 * between those migrations and the real production schema.
 *
 * Requires db_schema.json (generate/refresh it with `php artisan schema:dump`).
 */
return new class extends Migration
{
    public function up(): void
    {
        $service = new SchemaSyncService();

        // Nothing to sync from if the snapshot hasn't been generated yet.
        if (!file_exists($service->snapshotPath())) {
            return;
        }

        $service->sync(false);
    }

    /**
     * Intentionally a no-op. This migration only ADDS missing objects; reversing
     * it must never drop tables/columns or destroy production data.
     */
    public function down(): void
    {
        // No-op by design (non-destructive).
    }
};
