<?php

namespace App\Console\Commands;

use App\Models\RadiusConfig;
use App\Models\SmartOlt;
use App\Models\SystemConfig;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class CheckServiceStatusCron extends Command
{
    protected $signature = 'cron:check-service-status';

    protected $description = 'Lightweight check of RADIUS and SmartOLT API connectivity, updates system_config statuses, and triggers live notifications';

    public function handle(): int
    {
        $logPath = storage_path('logs/servicecheck');
        if (!file_exists($logPath)) {
            mkdir($logPath, 0755, true);
        }

        $logger = Log::build([
            'driver' => 'single',
            'path' => $logPath . '/servicecheck.log',
        ]);

        $logger->info('Service Status Check Cron Job started', ['timestamp' => now()->toDateTimeString()]);

        // ==========================================
        // 1. Check RADIUS API Health Connection
        // ==========================================
        $radiusOnline = false;
        $radiusError = null;

        try {
            $radiusConfig = RadiusConfig::first();
            if (!$radiusConfig) {
                throw new \Exception('RADIUS configuration not found in radius_config table');
            }

            $url = sprintf(
                '%s://%s:%s/rest/user-manage/user',
                $radiusConfig->ssl_type,
                $radiusConfig->ip,
                $radiusConfig->port
            );

            // Fetch with a short limit to avoid loading large payloads, with a small timeout
            $response = Http::withBasicAuth($radiusConfig->username, $radiusConfig->password)
                ->withOptions([
                    'verify' => false,
                    'timeout' => 5,
                ])
                ->get($url . '?.limit=1');

            if ($response->successful()) {
                $radiusOnline = true;
            } else {
                $radiusError = 'RADIUS API returned status ' . $response->status() . ': ' . substr($response->body(), 0, 150);
            }
        } catch (\Exception $e) {
            $radiusError = $e->getMessage();
        }

        // Save RADIUS results to system_config
        try {
            SystemConfig::updateOrCreate(
                ['config_key' => 'radius_api_status'],
                ['config_value' => $radiusOnline ? 'online' : 'offline', 'updated_by' => 'system']
            );

            SystemConfig::updateOrCreate(
                ['config_key' => 'radius_api_last_error'],
                ['config_value' => $radiusOnline ? null : $radiusError, 'updated_by' => 'system']
            );

            if (!$radiusOnline) {
                \Log::channel('radiusrelated')->error('[HEALTH CHECK FAILED] RADIUS is offline: ' . $radiusError);
            }
        } catch (\Exception $dbEx) {
            $logger->error('Failed to update RADIUS database status config', ['error' => $dbEx->getMessage()]);
        }


        // ==========================================
        // 2. Check SmartOLT API Health Connection
        // ==========================================
        $smartOltOnline = false;
        $smartOltError = null;

        try {
            $smartOlt = SmartOlt::first();
            if (!$smartOlt) {
                throw new \Exception('SmartOLT configuration not found in smart_olt table');
            }

            $url = "https://{$smartOlt->sub_domain}.smartolt.com/api/onu/get_onus_details_by_sn/TEST00000000";

            $response = Http::withHeaders([
                'X-Token' => $smartOlt->token
            ])->withOptions([
                'connect_timeout' => 3,
                'timeout' => 5
            ])->get($url);

            // If we receive a response (even a 4xx error due to invalid SN), the connection is alive!
            if ($response->successful() || $response->status() < 500) {
                $smartOltOnline = true;
            } else {
                $smartOltError = 'SmartOLT API returned status ' . $response->status() . ': ' . substr($response->body(), 0, 150);
            }
        } catch (\Exception $e) {
            $smartOltError = $e->getMessage();
        }

        // Save SmartOLT results to system_config
        try {
            SystemConfig::updateOrCreate(
                ['config_key' => 'smart_olt_status'],
                ['config_value' => $smartOltOnline ? 'online' : 'offline', 'updated_by' => 'system']
            );

            SystemConfig::updateOrCreate(
                ['config_key' => 'smart_olt_last_error'],
                ['config_value' => $smartOltOnline ? null : $smartOltError, 'updated_by' => 'system']
            );
        } catch (\Exception $dbEx) {
            $logger->error('Failed to update SmartOLT database status config', ['error' => $dbEx->getMessage()]);
        }

        $logger->info('Service Status Check Cron Job completed', [
            'timestamp' => now()->toDateTimeString(),
            'radius' => $radiusOnline ? 'online' : 'offline',
            'smartolt' => $smartOltOnline ? 'online' : 'offline'
        ]);

        $this->info('Service health check completed successfully.');
        $this->info("RADIUS Status: " . ($radiusOnline ? 'ONLINE' : 'OFFLINE - ' . $radiusError));
        $this->info("SmartOLT Status: " . ($smartOltOnline ? 'ONLINE' : 'OFFLINE - ' . $smartOltError));

        return Command::SUCCESS;
    }
}


