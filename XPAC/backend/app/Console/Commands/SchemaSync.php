<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\SchemaSyncService;

/**
 * Incrementally synchronize the current database to match db_schema.json.
 *
 * Adds only missing tables, columns, indexes and foreign keys. Never drops,
 * truncates or recreates anything. Safe to run repeatedly (idempotent).
 *
 *     php artisan schema:sync            # apply missing objects
 *     php artisan schema:sync --dry-run  # show what WOULD change, change nothing
 */
class SchemaSync extends Command
{
    protected $signature = 'schema:sync {--dry-run : Report changes without applying them}';

    protected $description = 'Incrementally add missing tables/columns/indexes/foreign keys from db_schema.json (non-destructive, idempotent)';

    public function handle(SchemaSyncService $service): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $this->info('[SCHEMA SYNC] ' . ($dryRun ? 'Dry run — no changes will be applied.' : 'Applying missing schema objects...'));

        try {
            $summary = $service->sync($dryRun);
        } catch (\Throwable $e) {
            $this->error('[SCHEMA SYNC] Failed: ' . $e->getMessage());
            return self::FAILURE;
        }

        // Echo the per-action log to the console for auditing.
        foreach ($service->getLines() as $line) {
            $this->line($line);
        }

        $this->newLine();
        $this->info(sprintf(
            '[SCHEMA SYNC] Done — tables +%d (%d existing), columns +%d (%d existing), indexes +%d (%d existing), FKs +%d (%d existing), errors %d',
            $summary['tables_created'],
            $summary['tables_existing'],
            $summary['columns_added'],
            $summary['columns_existing'],
            $summary['indexes_added'],
            $summary['indexes_existing'],
            $summary['fks_added'],
            $summary['fks_existing'],
            $summary['errors']
        ));

        return self::SUCCESS;
    }
}
