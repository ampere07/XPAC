<?php

require __DIR__ . '/vendor/autoload.php';

use Illuminate\Support\Facades\DB;

$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make('Illuminate\Contracts\Console\Kernel')->bootstrap();

echo "Testing ticket_id insertion...\n\n";

// Test 1: Check column definition
echo "1. Checking ticket_id column definition:\n";
$columns = DB::select("SHOW COLUMNS FROM service_orders WHERE Field = 'ticket_id'");
print_r($columns);
echo "\n";

// Test 2: Generate ticket ID
$currentYear = date('Y');
$lastTicket = DB::selectOne(
    "SELECT ticket_id FROM service_orders WHERE ticket_id LIKE ? ORDER BY ticket_id DESC LIMIT 1",
    [$currentYear . '%']
);

echo "2. Last ticket for year $currentYear:\n";
print_r($lastTicket);
echo "\n";

$newNumber = 1;
if ($lastTicket && $lastTicket->ticket_id) {
    $lastNumber = (int) substr($lastTicket->ticket_id, 4);
    $newNumber = $lastNumber + 1;
}

$ticketId = $currentYear . str_pad($newNumber, 6, '0', STR_PAD_LEFT);
echo "3. Generated ticket ID: $ticketId\n\n";

// Test 3: Try direct insert
echo "4. Attempting direct insert with ticket_id:\n";
try {
    $result = DB::insert(
        "INSERT INTO service_orders (ticket_id, account_no, timestamp, support_status, visit_status, status, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            $ticketId,
            'TEST001',
            now(),
            'Pending',
            'Pending',
            'unused',
            now(),
            now()
        ]
    );
    
    $insertedId = DB::getPdo()->lastInsertId();
    echo "Insert successful! ID: $insertedId\n";
    
    // Check what was actually inserted
    $inserted = DB::selectOne("SELECT * FROM service_orders WHERE id = ?", [$insertedId]);
    echo "Inserted record:\n";
    print_r($inserted);
    
    // Clean up test data
    DB::delete("DELETE FROM service_orders WHERE id = ?", [$insertedId]);
    echo "\nTest record deleted.\n";
    
} catch (\Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
    echo "Stack trace:\n" . $e->getTraceAsString() . "\n";
}

echo "\nTest completed.\n";
