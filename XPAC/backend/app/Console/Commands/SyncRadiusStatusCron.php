<?php

namespace App\Console\Commands;

use App\Services\RadiusStatusSyncService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class SyncRadiusStatusCron extends Command
{
    protected $signature = 'cron:sync-radius-status';

    protected $description = 'Sync RADIUS user status and session data to online_status table';

    protected RadiusStatusSyncService $syncService;

    public function __construct(RadiusStatusSyncService $syncService)
    {
        parent::__construct();
        $this->syncService = $syncService;
    }

    public function handle(): int
    {
        $logPath = storage_path('logs/radiussync');
        if (!file_exists($logPath)) {
            mkdir($logPath, 0755, true);
        }

        Log::build([
            'driver' => 'single',
            'path' => $logPath . '/radiussync.log',
        ])->info('RADIUS status sync cron job started', ['timestamp' => now()->toDateTimeString()]);

        try {
            $stats = $this->syncService->syncRadiusStatus();

            Log::build([
                'driver' => 'single',
                'path' => $logPath . '/radiussync.log',
            ])->info('RADIUS status sync cron job completed', [
                'timestamp' => now()->toDateTimeString(),
                'synced' => $stats['synced'],
                'inserted' => $stats['inserted'],
                'updated' => $stats['updated'],
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


