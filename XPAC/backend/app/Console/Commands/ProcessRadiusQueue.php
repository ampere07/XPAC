<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\RadiusQueueService;

class ProcessRadiusQueue extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'cron:process-radius-queue
                            {--batch=20 : Number of items to process per run}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Process pending RADIUS operations from the retry queue';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $batchSize = (int) $this->option('batch');

        $this->info('[RADIUS QUEUE CRON] Starting queue processing...');

        // Show current stats
        $stats = RadiusQueueService::getStats();
        $this->info("[RADIUS QUEUE CRON] Queue stats — Pending: {$stats['pending']}, Processing: {$stats['processing']}, Success: {$stats['success']}, Failed: {$stats['failed']}");

        if ($stats['pending'] === 0) {
            $this->info('[RADIUS QUEUE CRON] No pending items. Exiting.');
            return 0;
        }

        // Process the queue
        $service = new RadiusQueueService();
        $results = $service->processQueue($batchSize);

        $this->info("[RADIUS QUEUE CRON] Results — Processed: {$results['processed']}, Succeeded: {$results['succeeded']}, Failed: {$results['failed']}, Skipped: {$results['skipped']}");

        // Log to file
        \Illuminate\Support\Facades\Log::channel('radiusrelated')->info('[RADIUS QUEUE CRON] Run completed', $results);

        return 0;
    }
}
