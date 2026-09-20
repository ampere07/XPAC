<?php
session_start();

/**
 * Database Schema Synchronization UI
 */

// Default connection settings (used to prefill the form on first load)
$defaultConfig = [
    'db1_host' => '127.0.0.1',
    'db1_user' => 'root',
    'db1_pass' => '',
    'db1_name' => '',
    'db2_host' => '127.0.0.1',
    'db2_user' => 'root',
    'db2_pass' => '',
    'db2_name' => '',
];

// Save connection settings submitted from the UI into the session
if (isset($_POST['action']) && $_POST['action'] === 'save_config') {
    $_SESSION['db_config'] = [
        'db1_host' => trim($_POST['db1_host'] ?? ''),
        'db1_user' => trim($_POST['db1_user'] ?? ''),
        'db1_pass' => (string)($_POST['db1_pass'] ?? ''),
        'db1_name' => trim($_POST['db1_name'] ?? ''),
        'db2_host' => trim($_POST['db2_host'] ?? ''),
        'db2_user' => trim($_POST['db2_user'] ?? ''),
        'db2_pass' => (string)($_POST['db2_pass'] ?? ''),
        'db2_name' => trim($_POST['db2_name'] ?? ''),
    ];
    header('Location: ' . $_SERVER['PHP_SELF']);
    exit;
}

// Clear saved connection settings
if (isset($_POST['action']) && $_POST['action'] === 'clear_config') {
    unset($_SESSION['db_config']);
    header('Location: ' . $_SERVER['PHP_SELF']);
    exit;
}

// Active configuration: session values if present, otherwise the defaults
$config = ($_SESSION['db_config'] ?? []) + $defaultConfig;

// Considered "configured" once both database names are provided
$isConfigured = !empty($config['db1_name']) && !empty($config['db2_name']);

// Helper: open a PDO connection for one side ('db1' or 'db2') from $config
function makePdo(array $config, string $prefix): PDO {
    $pdo = new PDO(
        "mysql:host={$config[$prefix.'_host']};dbname={$config[$prefix.'_name']};charset=utf8mb4",
        $config[$prefix.'_user'],
        $config[$prefix.'_pass']
    );
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    return $pdo;
}

// Build the SQL column definition (without the column name) from a SHOW COLUMNS row.
// Used both to compare a column across databases and to emit ADD/MODIFY statements,
// so "what we compare" always matches "what we would apply".
function buildColumnDef(array $col): string {
    $def = $col['Type'];
    $def .= ($col['Null'] === 'NO') ? ' NOT NULL' : ' NULL';

    $extra = trim((string)($col['Extra'] ?? ''));
    // MySQL 8 marks expression defaults (e.g. CURRENT_TIMESTAMP) with DEFAULT_GENERATED
    $isExprDefault = stripos($extra, 'DEFAULT_GENERATED') !== false;

    if ($col['Default'] !== null) {
        $default = $col['Default'];
        if ($isExprDefault || preg_match('/^(CURRENT_TIMESTAMP|NOW\(\))/i', $default)) {
            $def .= " DEFAULT $default";                       // expression: do not quote
        } else {
            $def .= " DEFAULT '" . str_replace("'", "''", $default) . "'";
        }
    } elseif ($col['Null'] === 'YES') {
        $def .= ' DEFAULT NULL';
    }

    // Keep valid Extra flags (auto_increment, on update CURRENT_TIMESTAMP, ...) but
    // drop the DEFAULT_GENERATED marker, which is not valid ALTER syntax.
    if ($extra !== '') {
        $extra = trim(str_ireplace('DEFAULT_GENERATED', '', $extra));
        if ($extra !== '') {
            $def .= ' ' . $extra;
        }
    }
    return $def;
}

// Build a CREATE TABLE containing only the selected columns, carrying over every part
// of the source definition whose columns are fully covered by the selection: the column
// definitions verbatim (so auto_increment is kept), the primary key, secondary/unique
// indexes, and foreign keys. Engine/charset options are preserved from the source.
//
// A key or foreign key is included only when all of its columns are selected; otherwise
// it is dropped. auto_increment is stripped from a selected column only when no included
// key covers it (MySQL requires an auto_increment column to be part of a key).
function buildCreateTableSubset(PDO $pdo1, string $table, array $selected): string {
    $create = $pdo1->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_ASSOC)['Create Table'] ?? '';
    $selectedSet = array_flip($selected);

    // Fallback: no CREATE text available — emit bare column definitions.
    if ($create === '') {
        $lines = [];
        foreach ($pdo1->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_ASSOC) as $c) {
            if (!isset($selectedSet[$c['Field']])) continue;
            $def = buildColumnDef($c);
            $def = trim(preg_replace('/\s*auto_increment/i', '', $def));
            $lines[] = "  `{$c['Field']}` {$def}";
        }
        return "CREATE TABLE `$table` (\n" . implode(",\n", $lines) . "\n)";
    }

    // Separate the column/key body from the trailing table options (ENGINE=..., etc.).
    $openPos = strpos($create, '(');
    if (preg_match('/\)\s*(ENGINE=.*)$/is', $create, $m, PREG_OFFSET_CAPTURE)) {
        $closePos = $m[0][1];
        $tail = ' ' . rtrim($m[1][0], ';');
        $body = substr($create, $openPos + 1, $closePos - $openPos - 1);
    } else {
        $closePos = strrpos($create, ')');
        $body = substr($create, $openPos + 1, $closePos - $openPos - 1);
        $t = trim(substr($create, $closePos + 1));
        $tail = $t !== '' ? ' ' . rtrim($t, ';') : '';
    }

    // Pull backticked identifiers out of a string.
    $extractCols = function (string $s): array {
        preg_match_all('/`([^`]+)`/', $s, $mm);
        return $mm[1];
    };
    $allSelected = function (array $cols) use ($selectedSet): bool {
        if (empty($cols)) return false;
        foreach ($cols as $c) {
            if (!isset($selectedSet[$c])) return false;
        }
        return true;
    };

    $colLines = [];            // colName => verbatim definition line
    $keyLines = [];            // preserved key / FK lines
    $coveredByKey = [];        // columns that appear in an included key (auto_increment guard)

    foreach (preg_split('/\r?\n/', $body) as $line) {
        $trim = rtrim(trim($line), ',');
        if ($trim === '') continue;

        // Column definition line — starts with `name`
        if (preg_match('/^`([^`]+)`\s/', $trim, $cm)) {
            if (isset($selectedSet[$cm[1]])) {
                $colLines[$cm[1]] = $trim;
            }
            continue;
        }

        $upper = strtoupper($trim);

        // Foreign key — only the local columns (before REFERENCES) must be selected.
        if (strpos($upper, 'FOREIGN KEY') !== false) {
            if (preg_match('/FOREIGN KEY\s*\(([^)]*)\)/i', $trim, $fm) && $allSelected($extractCols($fm[1]))) {
                $keyLines[] = $trim;
            }
            continue;
        }

        // Primary / unique / plain / fulltext / spatial index, or a CHECK constraint —
        // include only when every column it references is selected.
        if (strpos($upper, 'PRIMARY KEY') !== false || strpos($upper, 'UNIQUE KEY') !== false
            || preg_match('/^KEY\s/', $upper) || strpos($upper, 'FULLTEXT KEY') !== false
            || strpos($upper, 'SPATIAL KEY') !== false || strpos($upper, 'CONSTRAINT') !== false) {
            $cols = preg_match('/\(([^)]*)\)/', $trim, $pm) ? $extractCols($pm[1]) : [];
            if ($allSelected($cols)) {
                $keyLines[] = $trim;
                foreach ($cols as $c) { $coveredByKey[$c] = true; }
            }
            continue;
        }
        // Unknown line type — skip it to stay safe.
    }

    // Drop auto_increment from any selected column not covered by an included key.
    foreach ($colLines as $name => $def) {
        if (stripos($def, 'auto_increment') !== false && empty($coveredByKey[$name])) {
            $colLines[$name] = trim(preg_replace('/\s*AUTO_INCREMENT\b/i', '', $def));
        }
    }

    $lines = array_map(function ($l) { return '  ' . $l; },
        array_merge(array_values($colLines), $keyLines));

    return "CREATE TABLE `$table` (\n" . implode(",\n", $lines) . "\n)" . $tail;
}

// Handle AJAX Request for syncing
if (isset($_POST['action']) && $_POST['action'] === 'sync') {
    header('Content-Type: application/json');
    $response = ['success' => true, 'messages' => []];
    try {
        if (!$isConfigured) {
            throw new Exception('Database connection is not configured. Please enter the connection details first.');
        }
        $pdo1 = makePdo($config, 'db1');
        $pdo2 = makePdo($config, 'db2');

        $newTableColumns = (array)($_POST['tablecols'] ?? []); // ['table' => ['col', ...]]
        $viewsToCreate   = (array)($_POST['views'] ?? []);
        $columnsToAdd    = (array)($_POST['columns'] ?? []); // ['table' => ['col', ...]]
        $columnsToModify = (array)($_POST['modify'] ?? []);  // ['table' => ['col', ...]]

        $hadError = false;

        // Load column definitions for one table from the source, keyed by name.
        $sourceColumns = function (string $table) use ($pdo1): array {
            $byName = [];
            foreach ($pdo1->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_ASSOC) as $c) {
                $byName[$c['Field']] = $c;
            }
            return $byName;
        };

        // Relax FK checks so tables that reference each other can be created in any order.
        $pdo2->exec('SET FOREIGN_KEY_CHECKS = 0');

        // 1. Create Base Tables (all columns, or only the selected subset)
        foreach ($newTableColumns as $table => $wantCols) {
            $table = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
            if ($table === '' || !is_array($wantCols)) continue;

            $wantCols = array_values(array_filter(array_map(function ($c) {
                return preg_replace('/[^a-zA-Z0-9_]/', '', $c);
            }, $wantCols)));
            if (empty($wantCols)) continue;

            try {
                // Source columns in their real order
                $allCols = array_map(function ($c) { return $c['Field']; },
                    $pdo1->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_ASSOC));
                $wantCols = array_values(array_intersect($allCols, $wantCols)); // valid + ordered

                if (empty($wantCols)) {
                    $hadError = true;
                    $response['messages'][] = "✗ Table `$table`: none of the selected columns exist in source.";
                    continue;
                }

                if (count($wantCols) === count($allCols)) {
                    // Whole table selected — use the exact source definition (keeps indexes, FKs).
                    $row = $pdo1->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_ASSOC);
                    $sql = $row['Create Table'] ?? null;
                    if (!$sql) {
                        $hadError = true;
                        $response['messages'][] = "✗ Table `$table`: could not read CREATE statement (is it a view?).";
                        continue;
                    }
                    $pdo2->exec($sql);
                    $response['messages'][] = "✓ Table `$table` created.";
                } else {
                    // Subset selected — build a minimal CREATE (selected columns + primary key).
                    $sql = buildCreateTableSubset($pdo1, $table, $wantCols);
                    $pdo2->exec($sql);
                    $response['messages'][] = "✓ Table `$table` created with " . count($wantCols) . " selected column(s).";
                }
            } catch (Exception $e) {
                $hadError = true;
                $response['messages'][] = "✗ Table `$table`: " . $e->getMessage();
            }
        }

        // 2. Create Views (DEFINER stripped so they are portable across servers/users)
        foreach ($viewsToCreate as $view) {
            $view = preg_replace('/[^a-zA-Z0-9_]/', '', $view);
            if ($view === '') continue;
            try {
                $row = $pdo1->query("SHOW CREATE VIEW `$view`")->fetch(PDO::FETCH_ASSOC);
                $sql = $row['Create View'] ?? null;
                if ($sql) {
                    $sql = preg_replace('/DEFINER\s*=\s*`[^`]*`@`[^`]*`\s*/i', '', $sql);
                    $sql = preg_replace('/SQL SECURITY DEFINER\s*/i', '', $sql);
                    $sql = preg_replace('/^CREATE\s+/i', 'CREATE OR REPLACE ', $sql, 1);
                    $pdo2->exec($sql);
                    $response['messages'][] = "✓ View `$view` created.";
                } else {
                    $hadError = true;
                    $response['messages'][] = "✗ View `$view`: could not read CREATE statement.";
                }
            } catch (Exception $e) {
                $hadError = true;
                $response['messages'][] = "✗ View `$view`: " . $e->getMessage();
            }
        }

        // 3. Add Missing Columns
        foreach ($columnsToAdd as $table => $columns) {
            $table = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
            if ($table === '' || !is_array($columns)) continue;
            try {
                $byName = $sourceColumns($table);
                foreach ($columns as $colName) {
                    $colName = preg_replace('/[^a-zA-Z0-9_]/', '', $colName);
                    if (!isset($byName[$colName])) {
                        $hadError = true;
                        $response['messages'][] = "✗ Column `$colName`: not found in source `$table`.";
                        continue;
                    }
                    try {
                        $def = buildColumnDef($byName[$colName]);
                        $pdo2->exec("ALTER TABLE `$table` ADD COLUMN `$colName` $def");
                        $response['messages'][] = "✓ Column `$colName` added to `$table`.";
                    } catch (Exception $e) {
                        $hadError = true;
                        $response['messages'][] = "✗ Column `$colName` on `$table`: " . $e->getMessage();
                    }
                }
            } catch (Exception $e) {
                $hadError = true;
                $response['messages'][] = "✗ Table `$table`: " . $e->getMessage();
            }
        }

        // 4. Modify Changed Columns to match the source definition
        foreach ($columnsToModify as $table => $columns) {
            $table = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
            if ($table === '' || !is_array($columns)) continue;
            try {
                $byName = $sourceColumns($table);
                foreach ($columns as $colName) {
                    $colName = preg_replace('/[^a-zA-Z0-9_]/', '', $colName);
                    if (!isset($byName[$colName])) {
                        $hadError = true;
                        $response['messages'][] = "✗ Column `$colName`: not found in source `$table`.";
                        continue;
                    }
                    try {
                        $def = buildColumnDef($byName[$colName]);
                        $pdo2->exec("ALTER TABLE `$table` MODIFY COLUMN `$colName` $def");
                        $response['messages'][] = "✓ Column `$colName` on `$table` updated to match source.";
                    } catch (Exception $e) {
                        $hadError = true;
                        $response['messages'][] = "✗ Column `$colName` on `$table`: " . $e->getMessage();
                    }
                }
            } catch (Exception $e) {
                $hadError = true;
                $response['messages'][] = "✗ Table `$table`: " . $e->getMessage();
            }
        }

        $pdo2->exec('SET FOREIGN_KEY_CHECKS = 1');

        if (empty($response['messages'])) {
            $response['messages'][] = "No items were selected for synchronization.";
        }

        $response['success'] = !$hadError;

    } catch (Exception $e) {
        $response['success'] = false;
        $response['messages'][] = "Error: " . $e->getMessage();
    }
    echo json_encode($response);
    exit;
}

// Fetch Differences for UI (only once a connection has been configured)
$error = null;
$missingTables  = [];   // ['table' => ['col', ...]] base tables in DB1 absent from DB2 (with their columns)
$missingViews   = [];   // views in DB1 absent from DB2
$missingColumns = [];   // ['table' => ['col', ...]] present in DB1, absent in DB2
$changedColumns = [];   // ['table' => [['name','source','target'], ...]] differing definitions
$scanWarnings   = [];   // tables skipped mid-scan (e.g. broken view) — surfaced, not fatal

if ($isConfigured) {
try {
    $pdo1 = makePdo($config, 'db1');
    $pdo2 = makePdo($config, 'db2');

    // Split DB1 objects into base tables vs views (SHOW FULL TABLES adds Table_type)
    $baseTables1 = [];
    $views1 = [];
    foreach ($pdo1->query("SHOW FULL TABLES")->fetchAll(PDO::FETCH_NUM) as $r) {
        if (($r[1] ?? '') === 'VIEW') { $views1[] = $r[0]; }
        else { $baseTables1[] = $r[0]; }
    }

    // All object names present in DB2 (tables + views) for existence checks
    $names2 = array_map(function ($r) { return $r[0]; },
        $pdo2->query("SHOW FULL TABLES")->fetchAll(PDO::FETCH_NUM));

    // Base tables: missing entirely, or present-but-with column differences
    foreach ($baseTables1 as $table) {
        if (!in_array($table, $names2, true)) {
            // Capture the table's columns so the UI can offer per-column selection.
            try {
                $missingTables[$table] = array_map(function ($c) { return $c['Field']; },
                    $pdo1->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_ASSOC));
            } catch (Exception $e) {
                $missingTables[$table] = [];
                $scanWarnings[] = "Could not read columns for `$table`: " . $e->getMessage();
            }
            continue;
        }
        // Present in both — compare columns. Guard so one bad table doesn't abort the scan.
        try {
            $columns1 = $pdo1->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_ASSOC);
            $db2ByName = [];
            foreach ($pdo2->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_ASSOC) as $c) {
                $db2ByName[$c['Field']] = $c;
            }

            foreach ($columns1 as $col1) {
                $name = $col1['Field'];
                if (!isset($db2ByName[$name])) {
                    $missingColumns[$table][] = $name;
                    continue;
                }
                $def1 = buildColumnDef($col1);
                $def2 = buildColumnDef($db2ByName[$name]);
                if (strcasecmp($def1, $def2) !== 0) {
                    $changedColumns[$table][] = [
                        'name'   => $name,
                        'source' => $def1,
                        'target' => $def2,
                    ];
                }
            }
        } catch (Exception $inner) {
            $scanWarnings[] = "Skipped column check for `$table`: " . $inner->getMessage();
        }
    }

    // Views: report those missing from DB2
    foreach ($views1 as $view) {
        if (!in_array($view, $names2, true)) {
            $missingViews[] = $view;
        }
    }
} catch (Exception $e) {
    $error = "Connection Failed: " . $e->getMessage();
}
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Database Sync Manager</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #f1f5f9;
            --panel-bg: #ffffff;
            --subtle-bg: #f8fafc;
            --border-color: #e2e8f0;
            --border-strong: #cbd5e1;
            --text-primary: #0f172a;
            --text-secondary: #64748b;
            --accent: #2563eb;
            --accent-hover: #1d4ed8;
            --success: #16a34a;
            --danger: #dc2626;
            --radius: 4px;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Inter', sans-serif;
        }

        body {
            background-color: var(--bg-color);
            color: var(--text-primary);
            min-height: 100vh;
            padding: 2rem;
            -webkit-font-smoothing: antialiased;
        }

        .container {
            margin: 0 auto;
            width: 100%;
            max-width: 900px;
        }

        .header {
            margin-bottom: 1.75rem;
        }

        .header h1 {
            font-size: 1.75rem;
            font-weight: 700;
            letter-spacing: -0.02em;
            color: var(--text-primary);
            margin-bottom: 0.25rem;
        }

        .header p {
            color: var(--text-secondary);
            font-size: 0.95rem;
        }

        .glass-panel {
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.5rem;
            margin-bottom: 1.25rem;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        }

        .section-title {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 1.25rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 0.75rem;
            color: var(--text-primary);
        }

        .section-title svg { color: var(--accent); }

        .empty-state {
            color: var(--text-secondary);
            text-align: center;
            padding: 1.5rem;
            font-size: 0.9rem;
        }

        .item-list {
            display: flex;
            flex-direction: column;
            gap: 0.375rem;
        }

        .item-row {
            display: flex;
            align-items: center;
            padding: 0.625rem 0.875rem;
            background: var(--subtle-bg);
            border-radius: var(--radius);
            border: 1px solid var(--border-color);
            transition: all 0.15s;
        }

        .item-row:hover {
            background: #f1f5f9;
            border-color: var(--border-strong);
        }

        .table-group {
            margin-bottom: 0.75rem;
            background: var(--subtle-bg);
            border-radius: var(--radius);
            overflow: hidden;
            border: 1px solid var(--border-color);
        }

        .table-header {
            padding: 0.75rem 0.875rem;
            background: #f1f5f9;
            font-weight: 600;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 0.625rem;
            border-bottom: 1px solid var(--border-color);
        }

        .column-list {
            padding: 0.625rem 0.875rem 0.875rem 2.25rem;
            display: flex;
            flex-direction: column;
            gap: 0.375rem;
        }

        .checkbox-wrapper {
            display: flex;
            align-items: center;
            gap: 0.625rem;
            cursor: pointer;
            width: 100%;
        }

        input[type="checkbox"] {
            appearance: none;
            width: 1.1rem;
            height: 1.1rem;
            border: 1.5px solid var(--border-strong);
            border-radius: 3px;
            background: #fff;
            cursor: pointer;
            position: relative;
            transition: all 0.15s;
            flex-shrink: 0;
        }

        input[type="checkbox"]:checked {
            background: var(--accent);
            border-color: var(--accent);
        }

        input[type="checkbox"]:checked::after {
            content: '';
            position: absolute;
            left: 5px;
            top: 2px;
            width: 4px;
            height: 9px;
            border: solid white;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }

        input[type="checkbox"]:indeterminate {
            background: var(--accent);
            border-color: var(--accent);
        }

        input[type="checkbox"]:indeterminate::after {
            content: '';
            position: absolute;
            left: 3px;
            top: 7px;
            width: 8px;
            height: 0;
            border-top: 2px solid #fff;
        }

        .btn {
            background: var(--accent);
            color: white;
            border: none;
            padding: 0.7rem 1.5rem;
            border-radius: var(--radius);
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            width: 100%;
            margin-top: 0.5rem;
        }

        .btn:hover { background: var(--accent-hover); }

        .btn:disabled {
            background: var(--border-strong);
            cursor: not-allowed;
        }

        .alert {
            padding: 0.875rem 1rem;
            border-radius: var(--radius);
            margin-bottom: 1.25rem;
            font-weight: 500;
            font-size: 0.9rem;
        }

        .alert-error {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #b91c1c;
        }

        .loader {
            display: none;
            width: 18px;
            height: 18px;
            border: 2px solid rgba(255,255,255,0.4);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .modal {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.4);
            z-index: 50;
            align-items: center;
            justify-content: center;
        }

        .modal-content {
            background: #fff;
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.5rem;
            width: 90%;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 10px 40px rgba(15, 23, 42, 0.15);
        }

        .modal-title {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: var(--success);
        }

        .log-list {
            list-style: none;
            font-family: 'SFMono-Regular', Consolas, monospace;
            font-size: 0.85rem;
            color: var(--text-secondary);
            display: flex;
            flex-direction: column;
            gap: 0.375rem;
        }

        .log-list li {
            padding-bottom: 0.375rem;
            border-bottom: 1px solid var(--border-color);
        }

        .modal-close {
            margin-top: 1.25rem;
            background: #f1f5f9;
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            padding: 0.5rem 1.25rem;
            border-radius: var(--radius);
            cursor: pointer;
            font-weight: 500;
            transition: all 0.15s;
        }

        .modal-close:hover {
            background: #e2e8f0;
        }

        .config-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.25rem;
        }

        @media (max-width: 640px) {
            .config-grid { grid-template-columns: 1fr; }
            body { padding: 1rem; }
        }

        .config-col {
            background: var(--subtle-bg);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.1rem;
        }

        .config-heading {
            font-size: 0.9rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: var(--text-primary);
        }

        .config-heading span {
            color: var(--text-secondary);
            font-weight: 400;
            font-size: 0.8rem;
        }

        .field { margin-bottom: 0.75rem; }
        .field:last-child { margin-bottom: 0; }

        .field label {
            display: block;
            font-size: 0.78rem;
            font-weight: 500;
            color: var(--text-secondary);
            margin-bottom: 0.3rem;
        }

        .field input {
            width: 100%;
            padding: 0.55rem 0.7rem;
            background: #fff;
            border: 1px solid var(--border-strong);
            border-radius: var(--radius);
            color: var(--text-primary);
            font-size: 0.88rem;
            transition: all 0.15s;
        }

        .field input:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }

        .config-actions { margin-top: 1.25rem; }

        .btn-inline {
            width: auto;
            margin-top: 0;
            padding: 0.6rem 1.25rem;
        }

        .reset-form { margin-top: 0.75rem; }

        .btn-reset {
            background: #fff;
            color: var(--text-secondary);
            border: 1px solid var(--border-strong);
            padding: 0.45rem 1.1rem;
            border-radius: var(--radius);
            cursor: pointer;
            font-size: 0.83rem;
            font-weight: 500;
            transition: all 0.15s;
        }

        .btn-reset:hover {
            color: var(--danger);
            border-color: var(--danger);
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            font-size: 0.78rem;
            font-weight: 500;
            color: var(--success);
            margin-left: auto;
        }

        .status-badge::before {
            content: '';
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--success);
        }

        .alert-warning {
            background: #fffbeb;
            border: 1px solid #fde68a;
            color: #92400e;
        }

        .alert-warning ul {
            margin: 0.5rem 0 0 1.25rem;
            font-size: 0.85rem;
        }

        .col-diff {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
            margin-left: 0.5rem;
            font-family: 'SFMono-Regular', Consolas, monospace;
            font-size: 0.75rem;
            line-height: 1.35;
        }

        .col-diff .from { color: var(--danger); }
        .col-diff .to { color: var(--success); }
        .col-diff .lbl { color: var(--text-secondary); font-family: 'Inter', sans-serif; }

        .item-row.col-row {
            align-items: flex-start;
            flex-wrap: wrap;
        }

        .section-hint {
            color: var(--text-secondary);
            font-size: 0.82rem;
            margin: -0.5rem 0 1rem;
        }

    </style>
</head>
<body>

<div class="container">
    <div class="header">
        <h1>Database Sync Manager</h1>
        <p>Transfer tables, views, and columns from Database 1 to Database 2</p>
    </div>

    <!-- Database Connection Settings -->
    <div class="glass-panel">
        <div class="section-title">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>
            Database Connections
            <?php if ($isConfigured && !$error): ?>
                <span class="status-badge">Connected</span>
            <?php endif; ?>
        </div>
        <form method="POST">
            <input type="hidden" name="action" value="save_config">
            <div class="config-grid">
                <div class="config-col">
                    <h3 class="config-heading">Database 1 <span>(Source)</span></h3>
                    <div class="field">
                        <label>Host</label>
                        <input type="text" name="db1_host" value="<?php echo htmlspecialchars($config['db1_host']); ?>" placeholder="127.0.0.1">
                    </div>
                    <div class="field">
                        <label>Database Name</label>
                        <input type="text" name="db1_name" value="<?php echo htmlspecialchars($config['db1_name']); ?>" placeholder="source_database">
                    </div>
                    <div class="field">
                        <label>Username</label>
                        <input type="text" name="db1_user" value="<?php echo htmlspecialchars($config['db1_user']); ?>" placeholder="root">
                    </div>
                    <div class="field">
                        <label>Password</label>
                        <input type="password" name="db1_pass" value="<?php echo htmlspecialchars($config['db1_pass']); ?>" placeholder="Leave blank if none">
                    </div>
                </div>
                <div class="config-col">
                    <h3 class="config-heading">Database 2 <span>(Destination)</span></h3>
                    <div class="field">
                        <label>Host</label>
                        <input type="text" name="db2_host" value="<?php echo htmlspecialchars($config['db2_host']); ?>" placeholder="127.0.0.1">
                    </div>
                    <div class="field">
                        <label>Database Name</label>
                        <input type="text" name="db2_name" value="<?php echo htmlspecialchars($config['db2_name']); ?>" placeholder="destination_database">
                    </div>
                    <div class="field">
                        <label>Username</label>
                        <input type="text" name="db2_user" value="<?php echo htmlspecialchars($config['db2_user']); ?>" placeholder="root">
                    </div>
                    <div class="field">
                        <label>Password</label>
                        <input type="password" name="db2_pass" value="<?php echo htmlspecialchars($config['db2_pass']); ?>" placeholder="Leave blank if none">
                    </div>
                </div>
            </div>
            <div class="config-actions">
                <button type="submit" class="btn btn-inline">Connect &amp; Load Differences</button>
            </div>
        </form>
        <?php if ($isConfigured): ?>
            <form method="POST" class="reset-form">
                <input type="hidden" name="action" value="clear_config">
                <button type="submit" class="btn-reset">Reset Connection</button>
            </form>
        <?php endif; ?>
    </div>

    <?php if (!$isConfigured): ?>
        <div class="glass-panel">
            <div class="empty-state">Enter your Database 1 (source) and Database 2 (destination) connection details above, then click &ldquo;Connect &amp; Load Differences&rdquo; to see what needs syncing.</div>
        </div>
    <?php else: ?>

    <?php if ($error): ?>
        <div class="alert alert-error">
            <strong>Database Error:</strong> <?php echo htmlspecialchars($error); ?>
        </div>
    <?php endif; ?>

    <?php if (!$error && !empty($scanWarnings)): ?>
        <div class="alert alert-warning">
            <strong>Some objects were skipped during the scan:</strong>
            <ul>
                <?php foreach ($scanWarnings as $warn): ?>
                    <li><?php echo htmlspecialchars($warn); ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php endif; ?>

    <?php if (!$error): ?>
        <form id="syncForm">
            <!-- Missing Tables Section -->
            <div class="glass-panel">
                <div class="section-title">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M3 12h18"/><path d="M3 3h18v18H3z"/></svg>
                    Missing Tables (Present in DB 1, missing in DB 2)
                </div>

                <?php if (empty($missingTables)): ?>
                    <div class="empty-state">No missing tables found. Database 2 has all tables from Database 1.</div>
                <?php else: ?>
                    <p class="section-hint">Tick a table to create it with all its columns (indexes, foreign keys, and auto-increment included). Or expand it and pick specific columns &mdash; the primary key, indexes, foreign keys, and auto-increment are kept for any whose columns are all selected.</p>
                    <?php foreach ($missingTables as $table => $tableCols): ?>
                        <div class="table-group">
                            <label class="table-header checkbox-wrapper">
                                <input type="checkbox" class="ctable-checkbox" data-ctable="<?php echo htmlspecialchars($table); ?>">
                                <span><?php echo htmlspecialchars($table); ?></span>
                            </label>

                            <div class="column-list">
                                <?php if (empty($tableCols)): ?>
                                    <div class="empty-state">Could not read this table's columns.</div>
                                <?php else: ?>
                                    <?php foreach ($tableCols as $column): ?>
                                        <label class="item-row checkbox-wrapper">
                                            <input type="checkbox" class="ccolumn-checkbox" name="tablecols[<?php echo htmlspecialchars($table); ?>][]" value="<?php echo htmlspecialchars($column); ?>" data-ctable="<?php echo htmlspecialchars($table); ?>">
                                            <span><?php echo htmlspecialchars($column); ?></span>
                                        </label>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </div>
                        </div>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>

            <!-- Missing Views Section -->
            <div class="glass-panel">
                <div class="section-title">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                    Missing Views (Present in DB 1, missing in DB 2)
                </div>

                <?php if (empty($missingViews)): ?>
                    <div class="empty-state">No missing views found.</div>
                <?php else: ?>
                    <div class="item-list">
                        <?php foreach ($missingViews as $view): ?>
                            <label class="item-row checkbox-wrapper">
                                <input type="checkbox" name="views[]" value="<?php echo htmlspecialchars($view); ?>">
                                <span><?php echo htmlspecialchars($view); ?></span>
                            </label>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
            </div>

            <!-- Missing Columns Section -->
            <div class="glass-panel">
                <div class="section-title">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M9 3v18"/></svg>
                    Missing Columns in Existing Tables
                </div>

                <?php if (empty($missingColumns)): ?>
                    <div class="empty-state">No missing columns found. All common tables are up to date.</div>
                <?php else: ?>
                    <?php foreach ($missingColumns as $table => $columns): ?>
                        <div class="table-group">
                            <label class="table-header checkbox-wrapper">
                                <input type="checkbox" class="table-checkbox" data-table="<?php echo htmlspecialchars($table); ?>">
                                <span><?php echo htmlspecialchars($table); ?></span>
                            </label>
                            
                            <div class="column-list">
                                <?php foreach ($columns as $column): ?>
                                    <label class="item-row checkbox-wrapper">
                                        <input type="checkbox" class="column-checkbox" name="columns[<?php echo htmlspecialchars($table); ?>][]" value="<?php echo htmlspecialchars($column); ?>" data-table="<?php echo htmlspecialchars($table); ?>">
                                        <span><?php echo htmlspecialchars($column); ?></span>
                                    </label>
                                <?php endforeach; ?>
                            </div>
                        </div>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>

            <!-- Changed Columns Section -->
            <div class="glass-panel">
                <div class="section-title">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7L9 18l-5-5"/><path d="M4 7l5 5"/></svg>
                    Changed Columns (Different definition in DB 2)
                </div>

                <?php if (empty($changedColumns)): ?>
                    <div class="empty-state">No column differences found. Shared columns match the source.</div>
                <?php else: ?>
                    <?php foreach ($changedColumns as $table => $cols): ?>
                        <div class="table-group">
                            <label class="table-header checkbox-wrapper">
                                <input type="checkbox" class="mtable-checkbox" data-mtable="<?php echo htmlspecialchars($table); ?>">
                                <span><?php echo htmlspecialchars($table); ?></span>
                            </label>

                            <div class="column-list">
                                <?php foreach ($cols as $col): ?>
                                    <label class="item-row col-row checkbox-wrapper">
                                        <input type="checkbox" class="mcolumn-checkbox" name="modify[<?php echo htmlspecialchars($table); ?>][]" value="<?php echo htmlspecialchars($col['name']); ?>" data-mtable="<?php echo htmlspecialchars($table); ?>">
                                        <span>
                                            <strong><?php echo htmlspecialchars($col['name']); ?></strong>
                                            <span class="col-diff">
                                                <span><span class="lbl">DB2:</span> <span class="from"><?php echo htmlspecialchars($col['target']); ?></span></span>
                                                <span><span class="lbl">DB1:</span> <span class="to"><?php echo htmlspecialchars($col['source']); ?></span></span>
                                            </span>
                                        </span>
                                    </label>
                                <?php endforeach; ?>
                            </div>
                        </div>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>

            <?php if (!empty($missingTables) || !empty($missingViews) || !empty($missingColumns) || !empty($changedColumns)): ?>
                <button type="submit" class="btn" id="submitBtn">
                    <span class="btn-text">Synchronize Selected Items</span>
                    <div class="loader" id="loader"></div>
                </button>
            <?php endif; ?>
        </form>
    <?php endif; ?>

    <?php endif; // end $isConfigured ?>
</div>

<!-- Results Modal -->
<div class="modal" id="resultModal">
    <div class="modal-content">
        <div class="modal-title" id="modalTitle">Sync Complete</div>
        <ul class="log-list" id="logList"></ul>
        <button class="modal-close" onclick="closeModal()">Close & Refresh</button>
    </div>
</div>

<script>
    // Handle table group checkboxes
    document.querySelectorAll('.table-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const table = this.dataset.table;
            const columnCheckboxes = document.querySelectorAll(`.column-checkbox[data-table="${table}"]`);
            columnCheckboxes.forEach(cb => {
                cb.checked = this.checked;
            });
        });
    });

    // Handle individual column checkboxes (to uncheck parent if unchecked)
    document.querySelectorAll('.column-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const table = this.dataset.table;
            const parentCheckbox = document.querySelector(`.table-checkbox[data-table="${table}"]`);
            const siblings = document.querySelectorAll(`.column-checkbox[data-table="${table}"]`);

            const allChecked = Array.from(siblings).every(cb => cb.checked);
            const someChecked = Array.from(siblings).some(cb => cb.checked);

            parentCheckbox.checked = allChecked;
            parentCheckbox.indeterminate = someChecked && !allChecked;
        });
    });

    // Handle missing-table group checkboxes (parent toggles all of the table's columns)
    document.querySelectorAll('.ctable-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const table = this.dataset.ctable;
            document.querySelectorAll(`.ccolumn-checkbox[data-ctable="${table}"]`).forEach(cb => {
                cb.checked = this.checked;
            });
        });
    });

    // Handle individual missing-table column checkboxes (sync parent state)
    document.querySelectorAll('.ccolumn-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const table = this.dataset.ctable;
            const parentCheckbox = document.querySelector(`.ctable-checkbox[data-ctable="${table}"]`);
            const siblings = document.querySelectorAll(`.ccolumn-checkbox[data-ctable="${table}"]`);

            const allChecked = Array.from(siblings).every(cb => cb.checked);
            const someChecked = Array.from(siblings).some(cb => cb.checked);

            parentCheckbox.checked = allChecked;
            parentCheckbox.indeterminate = someChecked && !allChecked;
        });
    });

    // Handle changed-column group checkboxes (parent toggles all in the table)
    document.querySelectorAll('.mtable-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const table = this.dataset.mtable;
            document.querySelectorAll(`.mcolumn-checkbox[data-mtable="${table}"]`).forEach(cb => {
                cb.checked = this.checked;
            });
        });
    });

    // Handle individual changed-column checkboxes (sync parent state)
    document.querySelectorAll('.mcolumn-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const table = this.dataset.mtable;
            const parentCheckbox = document.querySelector(`.mtable-checkbox[data-mtable="${table}"]`);
            const siblings = document.querySelectorAll(`.mcolumn-checkbox[data-mtable="${table}"]`);

            const allChecked = Array.from(siblings).every(cb => cb.checked);
            const someChecked = Array.from(siblings).some(cb => cb.checked);

            parentCheckbox.checked = allChecked;
            parentCheckbox.indeterminate = someChecked && !allChecked;
        });
    });

    // Handle form submission via AJAX
    const form = document.getElementById('syncForm');
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const checkedBoxes = form.querySelectorAll('input[type="checkbox"]:checked');
            if (checkedBoxes.length === 0) {
                alert("Please select at least one table or column to synchronize.");
                return;
            }

            const btn = document.getElementById('submitBtn');
            const loader = document.getElementById('loader');
            const btnText = btn.querySelector('.btn-text');

            btn.disabled = true;
            btnText.style.display = 'none';
            loader.style.display = 'block';

            const formData = new FormData(form);
            formData.append('action', 'sync');

            try {
                const response = await fetch('', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                
                const modal = document.getElementById('resultModal');
                const logList = document.getElementById('logList');
                const modalTitle = document.getElementById('modalTitle');
                
                logList.innerHTML = '';
                
                if (data.success) {
                    modalTitle.style.color = 'var(--success)';
                    modalTitle.textContent = 'Sync Successful';
                } else {
                    modalTitle.style.color = 'var(--danger)';
                    modalTitle.textContent = 'Sync Failed';
                }

                data.messages.forEach(msg => {
                    const li = document.createElement('li');
                    li.textContent = msg;
                    logList.appendChild(li);
                });

                modal.style.display = 'flex';

            } catch (error) {
                alert("An error occurred while processing the request.");
                console.error(error);
            } finally {
                btn.disabled = false;
                btnText.style.display = 'block';
                loader.style.display = 'none';
            }
        });
    }

    function closeModal() {
        document.getElementById('resultModal').style.display = 'none';
        window.location.reload();
    }
</script>

</body>
</html>
