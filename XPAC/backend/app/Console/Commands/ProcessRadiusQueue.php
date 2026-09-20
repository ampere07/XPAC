<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\RadiusQueueService;
use App\Support\RadiusRetryPolicy;
use Illuminate\Support\Facades\Cache;

class ProcessRadiusQueue extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'cron:process-radius-queue
                            {--batch= : Number of items to process per run (defaults to the configured batch size)}
                            {--no-lock : Run even if another pass holds the lock (diagnostics only)}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Process pending RADIUS operations from the retry queue';

    /** Seconds a single run may hold the lock before it is assumed to have died. */
    private const LOCK_TTL = 900;

    /**
     * Self-contained overlap protection.
     *
     * Kernel.php declares ->withoutOverlapping(), but that only applies when the
     * scheduler invokes the command; a crontab entry calling artisan directly
     * bypasses it. Overlap matters more here than almost anywhere else in the
     * app. A run works through a whole batch, each item may try every RADIUS
     * server over both protocols, and every one of those attempts waits out a
     * connect timeout when the server is unwell — so a single pass can easily
     * outlast its own interval. Two or three of them alive at once is how a
     * struggling RouterOS ends up unable to accept any connection at all.
     */
    public function handle()
    {
        if ($this->option('no-lock')) {
            return $this->runQueue();
        }

        $lock = Cache::lock('radius:process-queue', self::LOCK_TTL);

        if (!$lock->get()) {
            $this->info('[RADIUS QUEUE CRON] Another pass is still in progress; exiting.');
            \Illuminate\Support\Facades\Log::channel('radiusrelated')
                ->info('[RADIUS QUEUE CRON] Skipped run: a previous pass is still in progress.');

            // SUCCESS, not FAILURE: already-running is normal on a slow pass and
            // must not spam cron mail or trip monitoring.
            return 0;
        }

        try {
            return $this->runQueue();
        } finally {
            $lock->release();
        }
    }

    /**
     * One pass over the queue.
     */
    private function runQueue()
    {
        $batchSize = $this->option('batch') !== null
            ? (int) $this->option('batch')
            : RadiusRetryPolicy::batchSize();

        $this->info('[RADIUS QUEUE CRON] Starting queue processing...');
        $this->info('[RADIUS QUEUE CRON] Retry policy — max ' . RadiusRetryPolicy::maxAttempts()
            . ' attempts, delays: ' . RadiusRetryPolicy::describeSchedule());

        // Show current stats
        $stats = RadiusQueueService::getStats();
        $this->info("[RADIUS QUEUE CRON] Queue stats — Pending: {$stats['pending']}, Processing: {$stats['processing']}, Success: {$stats['success']}, Failed: {$stats['failed']}");

        // 'processing' rows may belong to a worker that was stopped mid-item, and
        // only processQueue() can return them to the queue — so a run still has
        // work to do when nothing is pending but something is stuck processing.
        if ($stats['pending'] === 0 && $stats['processing'] === 0) {
            $this->info('[RADIUS QUEUE CRON] No pending items. Exiting.');
            return 0;
        }

        // Process the queue
        $service = new RadiusQueueService();
        $results = $service->processQueue($batchSize);

        $this->info("[RADIUS QUEUE CRON] Results — Processed: {$results['processed']}, Succeeded: {$results['succeeded']}, Failed: {$results['failed']}, Skipped: {$results['skipped']}, Reclaimed: {$results['reclaimed']}");

        // Log to file
        \Illuminate\Support\Facades\Log::channel('radiusrelated')->info('[RADIUS QUEUE CRON] Run completed', $results);

        return 0;
    }
}
