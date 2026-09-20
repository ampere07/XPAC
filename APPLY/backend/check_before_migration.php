<?php

require_once __DIR__ . '/vendor/autoload.php';

// Load Laravel application
$app = require_once __DIR__ . '/bootstrap/app.php';

// Boot the application
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;

try {
    echo "Checking current Application_ID column structure...\n\n";
    
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
    }
    
    // Check if there are any existing records
    $count = DB::table('application')->count();
    echo "Current number of records in application table: " . $count . "\n\n";
    
    if ($count > 0) {
        echo "WARNING: There are {$count} existing records in the table.\n";
        echo "These records might prevent the column type change.\n";
        echo "Do you want to clear the table? (This will delete all existing applications)\n";
        echo "If yes, run: php artisan migrate:reset\n";
        echo "Then run: php artisan migrate\n\n";
    } else {
        echo "✓ Table is empty, safe to modify column type.\n";
        echo "You can now run the migration:\n";
        echo "php artisan migrate --path=database/migrations/2025_09_28_000002_change_application_id_to_random.php\n\n";
    }
    
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
