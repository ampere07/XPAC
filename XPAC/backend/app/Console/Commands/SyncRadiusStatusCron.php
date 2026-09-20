<?php

namespace App\Console\Commands;

use App\Services\RadiusStatusSyncService;
use App\Support\RadiusStatusSyncPolicy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class SyncRadiusStatusCron extends Command
{
    protected $signature = 'cron:sync-radius-status
                            {--batch= : Accounts processed per batch (defaults to the configured batch size)}
                            {--refresh-users : Re-fetch the RADIUS user list even if a cached copy is still fresh}
                            {--no-lock : Run even if another sync holds the lock (diagnostics only)}';

    protected $description = 'Sync RADIUS user status and session data to online_status table';

    /** Seconds a single run may hold the lock before it is assumed to have died. */
    private const LOCK_TTL = 600;

    protected RadiusStatusSyncService $syncService;

    public function __construct(RadiusStatusSyncService $syncService)
    {
        parent::__construct();
        $this->syncService = $syncService;
    }

    /**
     * Self-contained overlap protection.
     *
     * Kernel.php declares ->withoutOverlapping(), but that only applies when the
     * scheduler invokes the command. This deployment also calls
     * `php artisan cron:sync-radius-status` straight from crontab (see
     * radius-sync-worker.php), where that guard does not exist — so the lock
     * lives in the command and covers both styles.
     *
     * Overlap is safe from a correctness standpoint: the sync is idempotent and
     * writes each account by its unique account_id. The lock exists so a run that
     * outlives its two-minute slot is not joined by a second one re-reading the
     * same accounts and re-querying the same RADIUS servers.
     */
    public function handle(): int
    {
        if ($this->option('no-lock')) {
            try {
                return $this->runSync();
            } finally {
                // This run still stamps the heartbeat as it works, so clearing it
                // on the way out stops a diagnostic run from making the next
                // scheduled one stand down for a window after it has finished.
                RadiusStatusSyncService::clearHeartbeat();
            }
        }

        $lock = Cache::lock('radius:status-sync', self::LOCK_TTL);

        if (!$lock->get()) {
            $this->info('Another RADIUS status sync is still in progress; exiting.');
            Log::channel('radiusrelated')->info('[STATUS SYNC] Skipped run: a previous sync is still in progress.');

            // SUCCESS, not FAILURE: being already-running is normal on a slow
            // run and must not spam cron mail or trip monitoring.
            return Command::SUCCESS;
        }

        // Holding the lock is not the same as the previous run having finished.
        //
        // The lock expires after LOCK_TTL, so a run that takes longer than that
        // loses its claim while still working, and this invocation is handed a
        // lock the first one thinks it owns. Left there, the second sync would
        // start alongside the first — the exact overlap the lock exists to
        // prevent, arriving precisely on the slow runs where it matters most.
        //
        // The heartbeat is the live evidence: a run that is still working keeps
        // stamping it, and one that died stops. So a fresh stamp here means the
        // lock lapsed under a healthy run, and this invocation stands down and
        // hands the claim back rather than joining it.
        if (RadiusStatusSyncService::isRunAlive()) {
            $lock->release();

            $this->info('A RADIUS status sync is still working past its lock; exiting.');
            Log::channel('radiusrelated')->info(
                '[STATUS SYNC] Skipped run: the previous sync has outlived its lock but is still working.'
            );

            return Command::SUCCESS;
        }

        try {
            return $this->runSync();
        } finally {
            // Cleared by the run that finishes, so the next scheduled one is not
            // made to wait out the staleness window for no reason.
            RadiusStatusSyncService::clearHeartbeat();
            $lock->release();
        }
    }

    private function runSync(): int
    {
        $logPath = storage_path('logs/radiussync');
        if (!file_exists($logPath)) {
            mkdir($logPath, 0755, true);
        }

        // A per-run override; null leaves the configured size in charge.
        $batchSize = $this->option('batch') !== null ? (int) $this->option('batch') : null;

        Log::build([
            'driver' => 'single',
            'path' => $logPath . '/radiussync.log',
        ])->info('RADIUS status sync cron job started', [
            'timestamp'  => now()->toDateTimeString(),
            'batch_size' => RadiusStatusSyncPolicy::batchSize($batchSize),
        ]);

        try {
            $stats = $this->syncService->syncRadiusStatus($batchSize, (bool) $this->option('refresh-users'));

            Log::build([
                'driver' => 'single',
                'path' => $logPath . '/radiussync.log',
            ])->info('RADIUS status sync cron job completed', [
                'timestamp' => now()->toDateTimeString(),
                'synced' => $stats['synced'],
                'inserted' => $stats['inserted'],
                'updated' => $stats['updated'],
                'unchanged' => $stats['unchanged'],
                'batches' => $stats['batches'],
                'batch_size' => $stats['batch_size'],
                'users_from_cache' => $stats['users_from_cache'],
                'online' => $stats['online'],
                'offline' => $stats['offline'],
                'restricted' => $stats['restricted'],
                'disconnected' => $stats['disconnected'],
                'not_found' => $stats['not_found'],
                'errors' => $stats['errors']
            ]);

            // Set system config status to online
            try {
                \App\Models\SystemConfig::updateOrCreate(
                    ['config_key' => 'radius_api_status'],
                    ['config_value' => 'online', 'updated_by' => 'system']
                );
            } catch (\Exception $configEx) {
                Log::error('Failed to update radius_api_status to online', ['error' => $configEx->getMessage()]);
            }

            if ($stats['errors'] > 0) {
                Log::build([
                    'driver' => 'single',
                    'path' => $logPath . '/radiussync.log',
                ])->warning('RADIUS status sync had errors', [
                    'timestamp' => now()->toDateTimeString(),
                    'error_count' => $stats['errors']
                ]);
            }

            $this->info('RADIUS Status Sync Completed');
            $this->info("Synced: {$stats['synced']} | Online: {$stats['online']} | Offline: {$stats['offline']} | Restricted: {$stats['restricted']} | Disconnected: {$stats['disconnected']} | Not Found: {$stats['not_found']} | Errors: {$stats['errors']}");
            $this->info("Batches: {$stats['batches']} of {$stats['batch_size']} | Unchanged (no write needed): {$stats['unchanged']}");

            return Command::SUCCESS;
        } catch (\Exception $e) {
            Log::build([
                'driver' => 'single',
                'path' => $logPath . '/radiussync.log',
            ])->error('RADIUS status sync cron job failed', [
                'timestamp' => now()->toDateTimeString(),
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            // Save status offline and error details
            try {
                \App\Models\SystemConfig::updateOrCreate(
                    ['config_key' => 'radius_api_status'],
                    ['config_value' => 'offline', 'updated_by' => 'system']
                );
                \App\Models\SystemConfig::updateOrCreate(
                    ['config_key' => 'radius_api_last_error'],
                    ['config_value' => $e->getMessage(), 'updated_by' => 'system']
                );
            } catch (\Exception $configEx) {
                Log::error('Failed to update radius_api_status to offline', ['error' => $configEx->getMessage()]);
            }

            $this->error('RADIUS Status Sync Failed: ' . $e->getMessage());

            return Command::FAILURE;
        }
    }
}


