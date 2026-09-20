<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class TestLogging extends Command
{
    protected $signature = 'test:logging';
    protected $description = 'Test logging functionality for overdue and disconnection notice logs';

    public function handle()
    {
        $this->info("Testing logging functionality...");
        
        $timestamp = Carbon::now()->format('Y-m-d H:i:s');
        
        // Test Laravel Log facade
        Log::channel('overdue')->info("[$timestamp] TEST: Overdue log is working!");
        $this->info("Wrote to overdue.log via Log facade");
        
        Log::channel('disconnection')->info("[$timestamp] TEST: Disconnection notice log is working!");
        $this->info("Wrote to disconnectionnotice.log via Log facade");
        
        Log::info("[$timestamp] TEST: Default log is working!");
        $this->info("Wrote to default laravel.log");
        
        // Also write directly to files to test
        $overduePath = storage_path('logs/overdue.log');
        $dcNoticePath = storage_path('logs/disconnectionnotice.log');
        
        file_put_contents($overduePath, "[$timestamp] DIRECT WRITE TEST: This was written directly to the file\n", FILE_APPEND);
        $this->info("Direct write to: $overduePath");
        
        file_put_contents($dcNoticePath, "[$timestamp] DIRECT WRITE TEST: This was written directly to the file\n", FILE_APPEND);
        $this->info("Direct write to: $dcNoticePath");
        
        $this->info("Test complete! Check the log files:");
        $this->info("- backend/public_html/storage/logs/overdue.log");
        $this->info("- backend/public_html/storage/logs/disconnectionnotice.log");
        
        return 0;
    }
}

