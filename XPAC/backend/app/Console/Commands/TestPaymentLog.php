<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class TestPaymentLog extends Command
{
    protected $signature = 'payment:test-log';
    protected $description = 'Test payment worker logging';

    public function handle()
    {
        $this->info('Testing payment worker log...');
        
        $timestamp = now()->format('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] [Payment Worker Test] This is a test log entry";
        
        $logPath = storage_path('logs/paymentworker.log');
        
        $this->info("Log path: {$logPath}");
        $this->info("Writing test message...");
        
        $result = file_put_contents($logPath, $logMessage . PHP_EOL, FILE_APPEND);
        
        if ($result !== false) {
            $this->info("✓ Successfully wrote {$result} bytes to log file");
            $this->info("Log contents:");
            $this->line(file_get_contents($logPath));
        } else {
            $this->error("✗ Failed to write to log file");
            $this->error("Check permissions on storage/logs directory");
        }
        
        return 0;
    }
}
