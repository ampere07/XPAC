<?php
// Database diagnostic script
// Place this in your backend/public folder and access via browser
// Example: http://localhost:8000/check_database.php

header('Content-Type: application/json');

try {
    // Get database config from Laravel
    $configPath = '../config/database.php';
    if (file_exists($configPath)) {
        include $configPath;
    }
    
    // Try to connect to database
    $host = env('DB_HOST', '127.0.0.1');
    $port = env('DB_PORT', '3306');
    $database = env('DB_DATABASE', 'cbms');
    $username = env('DB_USERNAME', 'root');
    $password = env('DB_PASSWORD', '');
    
    // If env function doesn't exist, use defaults
    if (!function_exists('env')) {
        $host = '127.0.0.1';
        $port = '3306';
        $database = 'cbms';
        $username = 'root';
        $password = '';
    }
    
    $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";
    $pdo = new PDO($dsn, $username, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    
    $result = [
        'status' => 'success',
        'message' => 'Database connection successful',
        'database_info' => [
            'host' => $host,
            'port' => $port,
            'database' => $database,
            'username' => $username
        ]
    ];
    
    // Check if app_plans table exists
    $stmt = $pdo->prepare("SHOW TABLES LIKE 'app_plans'");
    $stmt->execute();
    $tableExists = $stmt->fetch();
    
    if ($tableExists) {
        $result['app_plans_table'] = 'EXISTS';
        
        // Get table structure
        $stmt = $pdo->prepare("DESCRIBE app_plans");
        $stmt->execute();
        $columns = $stmt->fetchAll();
        $result['table_columns'] = $columns;
        
        // Get record count
        $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM app_plans");
        $stmt->execute();
        $count = $stmt->fetch();
        $result['record_count'] = $count['count'];
        
        // Get sample records
        $stmt = $pdo->prepare("SELECT * FROM app_plans LIMIT 5");
        $stmt->execute();
        $records = $stmt->fetchAll();
        $result['sample_records'] = $records;
        
    } else {
        $result['app_plans_table'] = 'DOES NOT EXIST';
        $result['solution'] = 'Run the create_complete_app_plans_table.sql script';
    }
    
    // List all tables in database
    $stmt = $pdo->prepare("SHOW TABLES");
    $stmt->execute();
    $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $result['all_tables'] = $tables;
    
} catch (Exception $e) {
    $result = [
        'status' => 'error',
        'message' => 'Database connection failed: ' . $e->getMessage(),
        'error_code' => $e->getCode()
    ];
}

echo json_encode($result, JSON_PRETTY_PRINT);
?>