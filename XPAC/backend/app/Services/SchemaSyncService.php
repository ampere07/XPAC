<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

/**
 * SchemaSyncService
 * ---------------------------------------------------------------------------
 * Incremental, NON-DESTRUCTIVE database schema synchronization.
 *
 * Two responsibilities:
 *
 *   1. dump()  — introspect the LIVE database (using the connection configured
 *                in .env) and write an authoritative snapshot to db_schema.json.
 *                Captures columns, types, nullability, defaults, auto-increment,
 *                indexes, primary keys and foreign keys.
 *
 *   2. sync()  — read that snapshot (the desired state) and bring the current
 *                database in line with it by ADDING ONLY what is missing:
 *                  • missing tables   -> CREATE TABLE (from the captured DDL)
 *                  • missing columns  -> ALTER TABLE ... ADD COLUMN
 *                  • missing indexes  -> ALTER TABLE ... ADD INDEX/UNIQUE
 *                  • missing FKs      -> ALTER TABLE ... ADD CONSTRAINT
 *
 * It NEVER drops a table, column, index or constraint, never truncates and
 * never resets auto-increment. Every action is existence-checked first, so the
 * sync is fully idempotent — safe to run repeatedly. Every decision is logged.
 *
 * Typical workflow:
 *   - On the canonical/production server:  php artisan schema:dump   (refresh snapshot, commit it)
 *   - On any environment:                  php artisan schema:sync   (apply missing objects)
 *   - Or simply `php artisan migrate` — the sync migration calls sync() for you.
 */
class SchemaSyncService
{
    private string $logName = 'Schema_Sync';

    /** @var string[] Collected human-readable log lines for the current run. */
    private array $lines = [];

    /**
     * Absolute path to the schema snapshot file.
     */
    public function snapshotPath(): string
    {
        return base_path('db_schema.json');
    }

    /**
     * Log lines collected during the most recent operation (for command output).
     *
     * @return string[]
     */
    public function getLines(): array
    {
        return $this->lines;
    }

    // =====================================================================
    // INTROSPECTION / DUMP
    // =====================================================================

    /**
     * Introspect the live database and return its full structure.
     *
     * @return array<string, array{columns: array, indexes: array, fks: array, create_statement: string}>
     */
    public function introspect(): array
    {
        $database = DB::getDatabaseName();

        $tables = DB::select(
            'SELECT TABLE_NAME AS name
               FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = "BASE TABLE"
              ORDER BY TABLE_NAME',
            [$database]
        );

        $schema = [];

        foreach ($tables as $row) {
            $table = $row->name;

            $columns = array_map(fn ($c) => (array) $c, DB::select("SHOW FULL COLUMNS FROM `{$table}`"));
            $indexes = array_map(fn ($c) => (array) $c, DB::select("SHOW INDEX FROM `{$table}`"));

            $fks = array_map(fn ($c) => (array) $c, DB::select(
                'SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
                        k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
                        r.UPDATE_RULE, r.DELETE_RULE
                   FROM information_schema.KEY_COLUMN_USAGE k
                   JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                     ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
                    AND r.CONSTRAINT_NAME   = k.CONSTRAINT_NAME
                    AND r.TABLE_NAME        = k.TABLE_NAME
                  WHERE k.TABLE_SCHEMA = ?
                    AND k.TABLE_NAME   = ?
                    AND k.REFERENCED_TABLE_NAME IS NOT NULL
                  ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
                [$database, $table]
            ));

            $created = DB::select("SHOW CREATE TABLE `{$table}`");
            $createStatement = '';
            if (!empty($created)) {
                $arr = (array) $created[0];
                $createStatement = $arr['Create Table'] ?? ($arr['Create View'] ?? '');
            }

            $schema[$table] = [
                'columns'          => $columns,
                'indexes'          => $indexes,
                'fks'              => $fks,
                'create_statement' => $createStatement,
            ];
        }

        return $schema;
    }

    /**
     * Introspect the live database and overwrite the snapshot file.
     *
     * @return array{path: string, tables: int}
     */
    public function dump(): array
    {
        $schema = $this->introspect();
        $path = $this->snapshotPath();

        file_put_contents(
            $path,
            json_encode($schema, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        );

        $this->writeLog('[DUMP] Wrote ' . count($schema) . " table(s) to {$path}");

        return ['path' => $path, 'tables' => count($schema)];
    }

    /**
     * Load the schema snapshot.
     *
     * @return array<string, array>
     */
    public function loadSnapshot(): array
    {
        $path = $this->snapshotPath();

        if (!file_exists($path)) {
            throw new \RuntimeException("Schema snapshot not found at {$path}. Run `php artisan schema:dump` first.");
        }

        $data = json_decode(file_get_contents($path), true);
        if (!is_array($data)) {
            throw new \RuntimeException("Schema snapshot at {$path} is not valid JSON.");
        }

        return $data;
    }

    // =====================================================================
    // SYNC
    // =====================================================================

    /**
     * Apply the snapshot to the current database, additively and idempotently.
     *
     * @param  bool  $dryRun  When true, nothing is executed — only logged.
     * @return array Summary counters.
     */
    public function sync(bool $dryRun = false): array
    {
        $schema = $this->loadSnapshot();

        $summary = [
            'tables_created'   => 0,
            'tables_existing'  => 0,
            'columns_added'    => 0,
            'columns_existing' => 0,
            'indexes_added'    => 0,
            'indexes_existing' => 0,
            'fks_added'        => 0,
            'fks_existing'     => 0,
            'errors'           => 0,
        ];

        $this->writeLog('═══════════════════════════════════════════════════════════');
        $this->writeLog('  SCHEMA SYNC ' . ($dryRun ? '(DRY RUN — no changes applied)' : 'START'));
        $this->writeLog('  Target snapshot: ' . count($schema) . ' table(s)');
        $this->writeLog('═══════════════════════════════════════════════════════════');

        foreach ($schema as $table => $definition) {
            try {
                if (!Schema::hasTable($table)) {
                    $this->writeLog("[TABLE] Table created: `{$table}`");
                    if (!$dryRun) {
                        $createStatement = $definition['create_statement'] ?? null;
                        if (!$createStatement) {
                            $this->writeLog("  [WARN] No create_statement for `{$table}` — skipped");
                            continue;
                        }
                        DB::statement($createStatement);
                    }
                    $summary['tables_created']++;
                    // A freshly created table already has all of its columns,
                    // indexes and FKs from the DDL, so nothing else to diff.
                    continue;
                }

                $this->writeLog("[TABLE] Table already exists: `{$table}`");
                $summary['tables_existing']++;

                $this->syncColumns($table, $definition['columns'] ?? [], $dryRun, $summary);
                $this->syncIndexes($table, $definition['indexes'] ?? [], $dryRun, $summary);
                $this->syncForeignKeys($table, $definition['fks'] ?? [], $dryRun, $summary);
            } catch (\Throwable $e) {
                // One table's failure must never abort the whole sync.
                $summary['errors']++;
                $this->writeLog("  [ERROR] `{$table}`: " . $e->getMessage());
            }
        }

        $this->writeLog('───────────────────────────────────────────────────────────');
        $this->writeLog('  SCHEMA SYNC COMPLETE ' . ($dryRun ? '(DRY RUN)' : ''));
        $this->writeLog("  Tables:  created {$summary['tables_created']}, existing {$summary['tables_existing']}");
        $this->writeLog("  Columns: added {$summary['columns_added']}, existing {$summary['columns_existing']}");
        $this->writeLog("  Indexes: added {$summary['indexes_added']}, existing {$summary['indexes_existing']}");
        $this->writeLog("  FKs:     added {$summary['fks_added']}, existing {$summary['fks_existing']}");
        $this->writeLog("  Errors:  {$summary['errors']}");
        $this->writeLog('───────────────────────────────────────────────────────────');

        return $summary;
    }

    /**
     * Add any columns present in the snapshot but missing from the live table.
     * Preserves column order via AFTER, and never alters existing columns.
     */
    private function syncColumns(string $table, array $columns, bool $dryRun, array &$summary): void
    {
        $previous = null;

        foreach ($columns as $col) {
            $field = $col['Field'] ?? null;
            if ($field === null) {
                continue;
            }

            if (Schema::hasColumn($table, $field)) {
                $summary['columns_existing']++;
                $previous = $field;
                continue;
            }

            $ddl = "ALTER TABLE `{$table}` ADD COLUMN " . $this->columnDefinition($col);
            $ddl .= $previous ? " AFTER `{$previous}`" : ' FIRST';

            $this->writeLog("  [COLUMN] Column added: `{$table}`.`{$field}`");
            if (!$dryRun) {
                DB::statement($ddl);
            }
            $summary['columns_added']++;
            $previous = $field;
        }
    }

    /**
     * Build a column definition fragment from a SHOW FULL COLUMNS row.
     */
    private function columnDefinition(array $col): string
    {
        $def = "`{$col['Field']}` {$col['Type']}";

        if (!empty($col['Collation'])) {
            $def .= " COLLATE {$col['Collation']}";
        }

        $def .= (($col['Null'] ?? 'YES') === 'NO') ? ' NOT NULL' : ' NULL';

        $extra   = strtolower($col['Extra'] ?? '');
        $default = $col['Default'] ?? null;

        if ($default !== null) {
            $def .= ' DEFAULT ' . ($this->isExpressionDefault($default) ? $default : $this->quote($default));
        }

        if (strpos($extra, 'auto_increment') !== false) {
            $def .= ' AUTO_INCREMENT';
        }
        if (strpos($extra, 'on update current_timestamp') !== false) {
            $def .= ' ON UPDATE CURRENT_TIMESTAMP';
        }

        if (!empty($col['Comment'])) {
            $def .= ' COMMENT ' . $this->quote($col['Comment']);
        }

        return $def;
    }

    /**
     * Whether a default value is a raw SQL expression (not a quoted literal).
     */
    private function isExpressionDefault($default): bool
    {
        if (is_numeric($default)) {
            return true;
        }
        $d = strtolower(trim((string) $default));

        return $d === 'current_timestamp'
            || strpos($d, 'current_timestamp(') !== false
            || $d === 'now()'
            || (substr($d, -1) === ')' && strpos($d, '(') !== false); // function-style default
    }

    /**
     * Add any indexes present in the snapshot but missing from the live table.
     * PRIMARY KEY is left to the table's own DDL and never altered here.
     */
    private function syncIndexes(string $table, array $indexRows, bool $dryRun, array &$summary): void
    {
        // Group SHOW INDEX rows by index name (composite indexes span multiple rows).
        $byName = [];
        foreach ($indexRows as $row) {
            $name = $row['Key_name'] ?? null;
            if ($name === null) {
                continue;
            }
            $byName[$name][] = $row;
        }

        foreach ($byName as $name => $rows) {
            if ($name === 'PRIMARY') {
                // Primary keys are created with the table; do not add/alter post-hoc.
                continue;
            }

            if ($this->indexExists($table, $name)) {
                $summary['indexes_existing']++;
                continue;
            }

            usort($rows, fn ($a, $b) => ($a['Seq_in_index'] ?? 0) <=> ($b['Seq_in_index'] ?? 0));

            $cols = implode(', ', array_map(function ($r) {
                $col = "`{$r['Column_name']}`";
                if (!empty($r['Sub_part'])) {
                    $col .= "({$r['Sub_part']})";
                }
                return $col;
            }, $rows));

            $first = $rows[0];
            if (($first['Index_type'] ?? '') === 'FULLTEXT') {
                $type = 'FULLTEXT INDEX';
            } elseif ((int) ($first['Non_unique'] ?? 1) === 0) {
                $type = 'UNIQUE INDEX';
            } else {
                $type = 'INDEX';
            }

            $ddl = "ALTER TABLE `{$table}` ADD {$type} `{$name}` ({$cols})";

            $this->writeLog("  [INDEX] Index added: `{$table}`.`{$name}`");
            if (!$dryRun) {
                DB::statement($ddl);
            }
            $summary['indexes_added']++;
        }
    }

    /**
     * Add any foreign keys present in the snapshot but missing from the live table.
     */
    private function syncForeignKeys(string $table, array $fkRows, bool $dryRun, array &$summary): void
    {
        // Group by constraint name (a constraint may cover multiple columns).
        $byName = [];
        foreach ($fkRows as $row) {
            $name = $row['CONSTRAINT_NAME'] ?? null;
            if ($name === null) {
                continue;
            }
            $byName[$name][] = $row;
        }

        foreach ($byName as $name => $rows) {
            if ($this->foreignKeyExists($table, $name)) {
                $summary['fks_existing']++;
                continue;
            }

            usort($rows, fn ($a, $b) => ($a['ORDINAL_POSITION'] ?? 0) <=> ($b['ORDINAL_POSITION'] ?? 0));

            $localCols = implode(', ', array_map(fn ($r) => "`{$r['COLUMN_NAME']}`", $rows));
            $refCols   = implode(', ', array_map(fn ($r) => "`{$r['REFERENCED_COLUMN_NAME']}`", $rows));
            $refTable  = $rows[0]['REFERENCED_TABLE_NAME'];
            $onDelete  = $rows[0]['DELETE_RULE'] ?? 'RESTRICT';
            $onUpdate  = $rows[0]['UPDATE_RULE'] ?? 'RESTRICT';

            $ddl = "ALTER TABLE `{$table}` ADD CONSTRAINT `{$name}` "
                 . "FOREIGN KEY ({$localCols}) REFERENCES `{$refTable}` ({$refCols}) "
                 . "ON DELETE {$onDelete} ON UPDATE {$onUpdate}";

            $this->writeLog("  [FK] Foreign key added: `{$table}`.`{$name}`");
            if (!$dryRun) {
                DB::statement($ddl);
            }
            $summary['fks_added']++;
        }
    }

    // =====================================================================
    // SYNC FROM MIGRATIONS FOLDER (ledger-aware, drift-safe)
    // =====================================================================

    /**
     * Synchronize the database using the migrations folder as the source of truth.
     *
     * Unlike `php artisan migrate`, this is safe when the database already exists
     * but the `migrations` ledger doesn't reflect it (a very common situation when
     * a DB was built from a SQL dump). For each migration not yet recorded:
     *
     *   • If everything it would create already exists  -> record it WITHOUT running
     *     it (a "baseline"), so it is never re-created.
     *   • If it introduces a genuinely missing table/column -> run its up() and record it.
     *
     * Result: the ledger ends up correct and only real, missing changes are applied —
     * no "table already exists" / "duplicate column" errors, and it is idempotent
     * (a second run sees everything recorded and does nothing).
     *
     * @param  bool  $dryRun  When true, only logs the decision per migration.
     * @return array Summary counters.
     */
    public function syncFromMigrations(bool $dryRun = false): array
    {
        $summary = ['applied' => 0, 'baselined' => 0, 'errors' => 0, 'pending' => 0, 'already_recorded' => 0];

        $this->ensureMigrationsTable($dryRun);

        $recorded = $this->recordedMigrations();
        $files = glob(database_path('migrations') . '/*.php');
        sort($files); // chronological by filename, so create-table runs before its alters
        $batch = $this->nextBatch();

        $this->writeLog('═══════════════════════════════════════════════════════════');
        $this->writeLog('  SYNC FROM MIGRATIONS ' . ($dryRun ? '(DRY RUN — no changes applied)' : 'START'));
        $this->writeLog('  Recorded: ' . count($recorded) . ' | Files: ' . count($files) . ' | New batch: ' . $batch);
        $this->writeLog('═══════════════════════════════════════════════════════════');

        foreach ($files as $path) {
            $name = basename($path, '.php');

            if (isset($recorded[$name])) {
                $summary['already_recorded']++;
                continue;
            }

            $summary['pending']++;

            try {
                $parsed = $this->parseMigration(file_get_contents($path));

                if ($this->migrationNeedsRun($parsed)) {
                    $this->writeLog("[MIGRATE] Applying (new objects detected): {$name}");
                    if (!$dryRun) {
                        $migration = require $path;
                        if (is_object($migration) && method_exists($migration, 'up')) {
                            $migration->up();
                        }
                        $this->recordMigration($name, $batch);
                    }
                    $summary['applied']++;
                } else {
                    $this->writeLog("[BASELINE] Already applied — recording without running: {$name}");
                    if (!$dryRun) {
                        $this->recordMigration($name, $batch);
                    }
                    $summary['baselined']++;
                }
            } catch (\Throwable $e) {
                $summary['errors']++;
                $this->writeLog("  [ERROR] {$name}: " . $e->getMessage());
            }
        }

        $this->writeLog('───────────────────────────────────────────────────────────');
        $this->writeLog('  SYNC FROM MIGRATIONS COMPLETE ' . ($dryRun ? '(DRY RUN)' : ''));
        $this->writeLog("  Already recorded: {$summary['already_recorded']}");
        $this->writeLog("  Applied (ran):    {$summary['applied']}");
        $this->writeLog("  Baselined:        {$summary['baselined']}");
        $this->writeLog("  Errors:           {$summary['errors']}");
        $this->writeLog('───────────────────────────────────────────────────────────');

        return $summary;
    }

    /**
     * Ensure the Laravel migrations ledger table exists.
     */
    private function ensureMigrationsTable(bool $dryRun): void
    {
        if (Schema::hasTable('migrations')) {
            return;
        }

        $this->writeLog('[INFO] Creating migrations ledger table');
        if (!$dryRun) {
            Schema::create('migrations', function ($table) {
                $table->increments('id');
                $table->string('migration');
                $table->integer('batch');
            });
        }
    }

    /**
     * @return array<string, int> migration name => 1
     */
    private function recordedMigrations(): array
    {
        if (!Schema::hasTable('migrations')) {
            return [];
        }

        return array_flip(DB::table('migrations')->pluck('migration')->all());
    }

    private function nextBatch(): int
    {
        if (!Schema::hasTable('migrations')) {
            return 1;
        }

        return (int) DB::table('migrations')->max('batch') + 1;
    }

    private function recordMigration(string $name, int $batch): void
    {
        DB::table('migrations')->insert(['migration' => $name, 'batch' => $batch]);
    }

    /**
     * Extract the tables a migration creates and the columns it adds, by parsing
     * its Schema::create() / Schema::table() blocks.
     *
     * @return array{creates: array<string,bool>, alters: array<string,string[]>}
     */
    private function parseMigration(string $src): array
    {
        $creates = [];
        $alters = [];

        $parts = preg_split(
            '/Schema::(create|table)\(\s*[\'"]([a-zA-Z0-9_]+)[\'"]/',
            $src,
            -1,
            PREG_SPLIT_DELIM_CAPTURE
        );

        for ($i = 1; $i < count($parts); $i += 3) {
            $kind  = $parts[$i];
            $table = $parts[$i + 1];
            $body  = $parts[$i + 2] ?? '';

            // Structural/relationship methods reference EXISTING columns — they do not
            // add columns, so they must not be treated as "missing column => run".
            // (This keeps FK/index-only migrations as baseline rather than imposing
            // foreign keys/indexes on a live database that intentionally lacks them.)
            $structural = [
                'foreign', 'index', 'unique', 'primary', 'spatialIndex', 'fullText', 'fulltext',
                'dropColumn', 'dropColumns', 'dropForeign', 'dropIndex', 'dropUnique', 'dropPrimary',
                'renameColumn', 'rename', 'dropTimestamps', 'dropSoftDeletes',
            ];

            $cols = [];
            if (preg_match_all('/\$table->(\w+)\(\s*[\'"]([a-zA-Z0-9_]+)[\'"]/', $body, $m, PREG_SET_ORDER)) {
                foreach ($m as $match) {
                    if (in_array($match[1], $structural, true)) {
                        continue;
                    }
                    $cols[] = $match[2];
                }
            }
            if (strpos($body, '$table->timestamps(') !== false) {
                $cols[] = 'created_at';
                $cols[] = 'updated_at';
            }
            if (preg_match('/\$table->id\(\s*\)/', $body)) {
                $cols[] = 'id';
            }

            if ($kind === 'create') {
                $creates[$table] = true;
            } else {
                $alters[$table] = array_merge($alters[$table] ?? [], $cols);
            }
        }

        return ['creates' => $creates, 'alters' => $alters];
    }

    /**
     * Decide whether a parsed migration introduces anything not already in the DB.
     */
    private function migrationNeedsRun(array $parsed): bool
    {
        foreach (array_keys($parsed['creates']) as $table) {
            if (!Schema::hasTable($table)) {
                return true; // a table it creates is missing
            }
        }

        foreach ($parsed['alters'] as $table => $cols) {
            if (!Schema::hasTable($table)) {
                return true; // alter target table missing — let it run (created earlier in the batch)
            }
            foreach ($cols as $col) {
                if (!Schema::hasColumn($table, $col)) {
                    return true; // a column it adds is missing
                }
            }
        }

        return false;
    }

    // =====================================================================
    // EXISTENCE CHECKS (idempotency guards)
    // =====================================================================

    private function indexExists(string $table, string $indexName): bool
    {
        $rows = DB::select(
            'SELECT 1 FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
              LIMIT 1',
            [$table, $indexName]
        );

        return !empty($rows);
    }

    private function foreignKeyExists(string $table, string $constraintName): bool
    {
        $rows = DB::select(
            'SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?
                AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = "FOREIGN KEY"
              LIMIT 1',
            [$table, $constraintName]
        );

        return !empty($rows);
    }

    // =====================================================================
    // HELPERS
    // =====================================================================

    /**
     * Quote a string literal for use in DDL.
     */
    private function quote($value): string
    {
        return DB::getPdo()->quote((string) $value);
    }

    /**
     * Append a line to the in-memory log, the dedicated log file and Laravel's log.
     */
    private function writeLog(string $message): void
    {
        $this->lines[] = $message;

        $timestamp = Carbon::now()->format('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] [{$this->logName}] {$message}";

        $logDir = storage_path('logs/schemasync');
        $logFile = $logDir . '/schema_sync.log';
        if (!file_exists($logDir)) {
            mkdir($logDir, 0755, true);
        }
        file_put_contents($logFile, $logMessage . PHP_EOL, FILE_APPEND);

        Log::channel('single')->info("[{$this->logName}] {$message}");
    }
}
