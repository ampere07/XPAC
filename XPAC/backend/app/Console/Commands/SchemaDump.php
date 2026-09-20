<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\SchemaSyncService;

/**
 * Introspect the live database (via the .env connection) and write the
 * authoritative schema snapshot to db_schema.json.
 *
 * Run this on the canonical/production server whenever the schema changes,
 * then commit db_schema.json. `schema:sync` consumes this file.
 *
 *     php artisan schema:dump
 */
class SchemaDump extends Command
{
    protected $signature = 'schema:dump';

    protected $description = 'Introspect the live database and write the schema snapshot to db_schema.json';

    public function handle(SchemaSyncService $service): int
    {
        $this->info('[SCHEMA DUMP] Introspecting live database...');

        try {
            $result = $service->dump();
        } catch (\Throwable $e) {
            $this->error('[SCHEMA DUMP] Failed: ' . $e->getMessage());
            return self::FAILURE;
        }

        $this->info("[SCHEMA DUMP] Wrote {$result['tables']} table(s) to {$result['path']}");

        return self::SUCCESS;
    }
}
