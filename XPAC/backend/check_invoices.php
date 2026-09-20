<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Invoice;

echo "Total Invoices: " . Invoice::count() . "\n";
$first = Invoice::first();
if ($first) {
    echo "First Invoice ID: " . $first->id . "\n";
    echo "First Invoice Account No: " . $first->account_no . "\n";
} else {
    echo "No invoices found.\n";
}
