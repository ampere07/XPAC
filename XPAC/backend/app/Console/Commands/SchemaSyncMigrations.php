<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\SchemaSyncService;

/**
 * Drift-safe, migrations-folder-based database synchronization.
 *
 * Brings the database in line with the migrations folder WITHOUT failing when
 * tables already exist but aren't recorded in the `migrations` ledger:
 *   • migrations whose tables/columns already exist  -> recorded (baselined), not re-run
 *   • migrations introducing new tables/columns       -> run, then recorded
 *
 * Safe and idempotent — run it as often as you like.
 *
 *     php artisan schema:sync-migrations            # apply + baseline
 *     php artisan schema:sync-migrations --dry-run  # show the plan, change nothing
 */
class SchemaSyncMigrations extends Command
{
    protected $signature = 'schema:sync-migrations {--dry-run : Show what would happen without changing anything}';

    protected $description = 'Sync the database to the migrations folder (baseline already-applied migrations, run only the missing ones)';

    public function handle(SchemaSyncService $service): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $this->info('[SYNC MIGRATIONS] ' . ($dryRun ? 'Dry run — no changes will be applied.' : 'Synchronizing from migrations folder...'));

        try {
            $summary = $service->syncFromMigrations($dryRun);
        } catch (\Throwable $e) {
            $this->error('[SYNC MIGRATIONS] Failed: ' . $e->getMessage());
            return self::FAILURE;
        }

        foreach ($service->getLines() as $line) {
            $this->line($line);
        }

        $this->newLine();
        $this->info(sprintf(
            '[SYNC MIGRATIONS] Done — applied %d, baselined %d, already recorded %d, errors %d (pending this run: %d)',
            $summary['applied'],
            $summary['baselined'],
            $summary['already_recorded'],
            $summary['errors'],
            $summary['pending']
        ));

        return self::SUCCESS;
    }
}
