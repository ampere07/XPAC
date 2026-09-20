<?php

require_once __DIR__ . '/vendor/autoload.php';

// Load Laravel application
$app = require_once __DIR__ . '/bootstrap/app.php';

// Boot the application
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;

try {
    // Check the current structure of the Application_ID field
    $result = DB::select("SHOW COLUMNS FROM application WHERE Field = 'Application_ID'");
    
    if (!empty($result)) {
        $column = $result[0];
        echo "Current Application_ID column structure:\n";
        echo "Field: " . $column->Field . "\n";
        echo "Type: " . $column->Type . "\n";
        echo "Null: " . $column->Null . "\n";
        echo "Key: " . $column->Key . "\n";
        echo "Default: " . $column->Default . "\n";
        echo "Extra: " . $column->Extra . "\n\n";
        
        if (strpos($column->Extra, 'auto_increment') !== false) {
            echo "✓ Application_ID is already configured with AUTO_INCREMENT\n";
            echo "The migration may not be needed.\n";
        } else {
            echo "✗ Application_ID is NOT configured with AUTO_INCREMENT\n";
            echo "The migration should be run.\n";
        }
    } else {
        echo "Application_ID column not found!\n";
    }
    
    // Also check if there are any existing records
    $count = DB::table('application')->count();
    echo "\nCurrent number of records in application table: " . $count . "\n";
    
    if ($count > 0) {
        $maxId = DB::table('application')->max('Application_ID');
        echo "Highest Application_ID: " . $maxId . "\n";
    }
    
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
