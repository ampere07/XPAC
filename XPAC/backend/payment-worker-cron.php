#!/usr/bin/env php
<?php

/*
 * Standalone Payment Worker Cron Script
 * Path: /home/atsscbms/web/backend.atssfiber.ph/public_html/payment-worker-cron.php
 * Cron: */2 * * * * /usr/bin/php /home/atsscbms/web/backend.atssfiber.ph/public_html/payment-worker-cron.php
 */

// Bootstrap Laravel
require __DIR__.'/vendor/autoload.php';

$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

// Get the PaymentWorkerService
$paymentWorker = app(\App\Services\PaymentWorkerService::class);

// Log start
echo "===========================================\n";
echo "Payment Worker Started: " . now()->format('Y-m-d H:i:s') . "\n";
echo "===========================================\n";

// Get statistics before processing
$statsBefore = $paymentWorker->getStatistics();

echo "Status before processing:\n";
echo "  PENDING:    {$statsBefore['pending']}\n";
echo "  QUEUED:     {$statsBefore['queued']}\n";
echo "  PROCESSING: {$statsBefore['processing']}\n";
echo "  API_RETRY:  {$statsBefore['api_retry']}\n";
echo "\n";

// Process payments
$success = $paymentWorker->processPayments();

if (!$success) {
    echo "ERROR: Worker failed or another instance is running\n";
    exit(1);
}

// Get statistics after processing
$statsAfter = $paymentWorker->getStatistics();

echo "\n";
echo "Status after processing:\n";
echo "  PAID (today):    {$statsAfter['paid']}\n";
echo "  FAILED (today):  {$statsAfter['failed']}\n";
echo "  PENDING:         {$statsAfter['pending']}\n";
echo "  QUEUED:          {$statsAfter['queued']}\n";
echo "  API_RETRY:       {$statsAfter['api_retry']}\n";

echo "\n";
echo "===========================================\n";
echo "Payment Worker Completed: " . now()->format('Y-m-d H:i:s') . "\n";
echo "===========================================\n";

exit(0);
