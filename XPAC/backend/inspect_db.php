<?php

$env = file_get_contents(__DIR__ . '/.env');
preg_match('/DB_HOST=(.*)/', $env, $host);
preg_match('/DB_PORT=(.*)/', $env, $port);
preg_match('/DB_DATABASE=(.*)/', $env, $db);
preg_match('/DB_USERNAME=(.*)/', $env, $user);
preg_match('/DB_PASSWORD=(.*)/', $env, $pass);

$host = trim($host[1] ?? '15.235.167.58');
$port = trim($port[1] ?? '3306');
$db = trim($db[1] ?? '');
$user = trim($user[1] ?? '');
$pass = trim($pass[1] ?? '');

// Strip quotes if any
$host = trim($host, '"\'');
$port = trim($port, '"\'');
$db = trim($db, '"\'');
$user = trim($user, '"\'');
$pass = trim($pass, '"\'');

echo "Connecting to $db on $host:$port as $user...\n";

try {
    $pdo = new PDO("mysql:host=$host;port=$port;dbname=$db;charset=utf8mb4", $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (Exception $e) {
    echo "Connection failed: " . $e->getMessage() . "\n";
    exit(1);
}

$tablesQuery = $pdo->query("SHOW TABLES");
$tables = $tablesQuery->fetchAll(PDO::FETCH_COLUMN);

echo "Found " . count($tables) . " tables.\n";

$schema = [];
foreach ($tables as $table) {
    echo "Inspecting table: $table...\n";
    
    // Get columns
    $colsQuery = $pdo->query("SHOW FULL COLUMNS FROM `$table`");
    $columns = $colsQuery->fetchAll();
    
    // Get indexes
    $idxQuery = $pdo->query("SHOW INDEX FROM `$table`");
    $indexes = $idxQuery->fetchAll();
    
    // Get foreign keys
    $fkQuery = $pdo->query("
        SELECT 
            COLUMN_NAME, 
            REFERENCED_TABLE_NAME, 
            REFERENCED_COLUMN_NAME
        FROM 
            INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE 
            TABLE_SCHEMA = '$db' 
            AND TABLE_NAME = '$table' 
            AND REFERENCED_TABLE_NAME IS NOT NULL
    ");
    $fks = $fkQuery->fetchAll();
    
    // Get create table statement
    $createStmtQuery = $pdo->query("SHOW CREATE TABLE `$table`");
    $createStatement = $createStmtQuery->fetchColumn(1);
    
    $schema[$table] = [
        'columns' => $columns,
        'indexes' => $indexes,
        'fks' => $fks,
        'create_statement' => $createStatement
    ];
}

file_put_contents(__DIR__ . '/db_schema.json', json_encode($schema, JSON_PRETTY_PRINT));
echo "Inspection complete. Schema written to db_schema.json\n";
