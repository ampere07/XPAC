<?php

require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use Illuminate\Support\Facades\DB;

$statuses = DB::table('billing_status')->get();
foreach ($statuses as $status) {
    echo "ID: {$status->id}, Name: {$status->status_name}\n";
}
