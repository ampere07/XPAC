<?php

namespace App\Services;

use App\Models\RadiusConfig;
use App\Support\CronLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Exception;

class RadiusReconnectionService
{
    private $logName = 'RADIUS_Reconnection';

    /**
     * Attempt automatic reconnection after payment
     */
    public function attemptReconnect($accountNo, ?int $organizationId = null)
    {
        try {
            $this->writeLog("=== RECONNECTION ATTEMPT START ===");
            $this->writeLog("Account: $accountNo");

            // Get account details
            $account = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                    'billing_accounts.id as account_id',
                    'billing_accounts.account_no',
                    'billing_accounts.pppoe_username',
                    'billing_accounts.account_balance',
                    'customers.desired_plan',
                    'customers.full_name'
                )
                ->first();

            if (!$account) {
                $this->writeLog("[ERROR] Account not found: $accountNo");
                return 'account_not_found';
            }

            // Check if account qualifies for reconnection
            if ($account->account_balance > 0) {
                $this->writeLog("[SKIP] Account still has balance: ₱{$account->account_balance}");
                return 'balance_remaining';
            }

            $username = $account->pppoe_username;
            if (!$username) {
                $this->writeLog("[ERROR] No PPPoE username found for account: $accountNo");
                return 'no_username';
            }

            $radiusConfigs = RadiusConfig::orderBy('id')->get();

            if ($radiusConfigs->isEmpty()) {
                $this->writeLog("[ERROR] No RADIUS configurations found");
                return 'no_radius_config';
            }

            // Build RADIUS endpoints. Each entry carries the RadiusConfig record the native
            // RouterOS API client operates on; `url` is now a human label for the device.
            $radiusEndpoints = [];
            foreach ($radiusConfigs as $config) {
                $radiusEndpoints[] = [
                    'config' => $config,
                    'url' => "{$config->ip} (Config #{$config->id})",
                    'username' => $config->username,
                    'password' => $config->password
                ];
            }

            // Clean plan name (strip price suffix like "SWIFT 1000", "STARTER - P799.00", etc.)
            $rawPlan  = $account->desired_plan ?? '';
            $cleanPlan = preg_replace('/\s*-\s*(?:P|₱)?\d+.*/i', '', $rawPlan);
            $cleanPlan = preg_replace('/\s+(?:P|₱)?\d+.*/i', '', $cleanPlan);
            $cleanPlan = trim($cleanPlan);
            $this->writeLog("Raw Plan: '$rawPlan' -> Clean Plan: '$cleanPlan'");

            $manualRadiusService = new ManualRadiusOperationsService();
            $params = [
                'accountNumber' => $accountNo,
                'username' => $username,
                'plan' => $rawPlan,
                'updatedBy' => 'System Auto-Reconnect',
                'remarks' => 'Auto-reconnect via RadiusReconnectionService'
            ];

            $result = $manualRadiusService->reconnectUser($params);

            if ($result['status'] === 'success') {
                // Update billing account status
                DB::table('billing_accounts')
                    ->where('account_no', $accountNo)
                    ->update([
                        'billing_status_id' => 1, // Active
                        'updated_at' => now(),
                        'updated_by_user' => 'System'
                    ]);

                $this->writeLog("[SUCCESS] Reconnection completed for $username");
                $this->writeLog("=== RECONNECTION ATTEMPT END ===");
                return 'success';
            } else {
                $this->writeLog("[FAILED] Reconnection failed: {$result['message']}");
                $this->writeLog("=== RECONNECTION ATTEMPT END ===");
                return 'failed';
            }

        } catch (Exception $e) {
            $this->writeLog("[EXCEPTION] " . $e->getMessage());
            $this->writeLog("Trace: " . $e->getTraceAsString());
            $this->writeLog("=== RECONNECTION ATTEMPT END ===");
            return 'error';
        }
    }

    /**
     * RADIUS operations - reconnect user
     */
    private function radiusOps($radiusEndpoints, $username, $targetGroup, $dbStatus, $isDisconnectAction)
    {
        $this->writeLog("[RADIUS] Begin radiusOps for '$username' | Target: $targetGroup | isDC: " . ($isDisconnectAction ? 'Yes' : 'No'));

        $api = app(RouterosApiService::class);

        $radiusId = null;
        $currentRadiusGroup = null;
        $activeEndpoint = null;

        // Find user in RADIUS servers
        foreach ($radiusEndpoints as $endpoint) {
            $config = $this->configFor($endpoint);

            if (!$config) {
                continue;
            }

            try {
                $result = $api->findUser($config, $username);
            } catch (\Throwable $e) {
                $this->writeLog("[API] Error querying {$endpoint['url']}: " . $e->getMessage());
                continue;
            }

            if ($result !== null) {
                $radiusId = $result['.id'];
                $currentRadiusGroup = $result['group'];
                $activeEndpoint = $endpoint;
                $this->writeLog("[FOUND] Radius ID: $radiusId | Current Group: '$currentRadiusGroup' at {$endpoint['url']}");
                break;
            }
        }

        if (!$radiusId) {
            $this->writeLog("[WARNING] User '$username' not found in any RADIUS server");
            return ['success' => false, 'message' => 'User not found in RADIUS'];
        }

        $patchHappened = false;

        // Check if group needs updating
        if ($currentRadiusGroup === $targetGroup) {
            $this->writeLog("[CHECK] User is already on group '$targetGroup'. No patch needed.");
        } else {
            $this->writeLog("[PATCH] Mismatch ($currentRadiusGroup != $targetGroup). Updating group...");

            // Patch ONLY the server the account was found on: the RADIUS id is
            // server-specific, so replaying it against the others is incorrect.
            $activeConfig = $this->configFor($activeEndpoint);

            if ($activeConfig && $api->setUserGroup($activeConfig, $radiusId, $targetGroup)) {
                $this->writeLog("[PATCH] Success at {$activeEndpoint['url']}");
                $patchHappened = true;
            } else {
                $this->writeLog("[PATCH] Failed at {$activeEndpoint['url']} - " . $api->getLastError());
            }
        }

        // Determine if session should be killed
        $shouldKill = false;

        if ($isDisconnectAction) {
            $shouldKill = true;
            $this->writeLog("[DECISION] Action is Disconnect -> Force Kill.");
        } elseif ($patchHappened) {
            $shouldKill = true;
            $this->writeLog("[DECISION] Reconnect + Plan Change -> Kill Session.");
        } else {
            $this->writeLog("[DECISION] Reconnect + No Change -> Keep Session.");
        }

        // Kill session if needed
        if ($shouldKill) {
            $this->killUserSession($activeEndpoint !== null ? [$activeEndpoint] : $radiusEndpoints, $username);
        }

        return ['success' => true, 'message' => 'Reconnection successful'];
    }

    /**
     * Kill active user sessions
     */
    private function killUserSession($radiusEndpoints, $username)
    {
        $api = app(RouterosApiService::class);
        $killedAnywhere = 0;

        foreach ($radiusEndpoints as $endpoint) {
            $config = $this->configFor($endpoint);

            if (!$config) {
                continue;
            }

            try {
                $killed = $api->killSessionsForUser($config, $username);
            } catch (\Throwable $e) {
                $this->writeLog("[SESSION] Error cutting sessions at {$endpoint['url']}: " . $e->getMessage());
                continue;
            }

            if ($killed > 0) {
                $killedAnywhere += $killed;
                $this->writeLog("[KILL] Terminated {$killed} session(s) for '$username' at {$endpoint['url']}");
            }
        }

        if ($killedAnywhere === 0) {
            $this->writeLog("[SESSION] No active session found.");
        }
    }

    /**
     * The RadiusConfig record behind an endpoint entry, resolved by IP when the entry
     * was built without one.
     */
    private function configFor($endpoint): ?RadiusConfig
    {
        if (!is_array($endpoint)) {
            return null;
        }

        if (isset($endpoint['config']) && $endpoint['config'] instanceof RadiusConfig) {
            return $endpoint['config'];
        }

        $host = $endpoint['ip'] ?? null;

        if ($host === null && isset($endpoint['url'])) {
            $host = parse_url((string) $endpoint['url'], PHP_URL_HOST)
                ?: trim(explode(' ', (string) $endpoint['url'])[0]);
        }

        if (empty($host)) {
            return null;
        }

        return RadiusConfig::where('ip', $host)->orderBy('id')->first();
    }

    /**
     * Write to log file
     */
    private function writeLog($message)
    {
        // Errors and run summaries only - see App\Support\CronLog. This is a raw
        // file write, so LOG_LEVEL never reached it and the narration accumulated
        // no matter how the channels were configured.
        if (!CronLog::shouldWrite($message)) {
            return;
        }

        $timestamp = now()->format('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] [{$this->logName}] {$message}";
        
        // Write to custom radius reconnection log
        $logPath = storage_path('logs/radiusreconnection.log');
        file_put_contents($logPath, $logMessage . PHP_EOL, FILE_APPEND);
        
        // Mirror errors to the radiusrelated channel for visibility in the Log Viewer
        if (str_contains(strtoupper($message), 'ERROR') || 
            str_contains(strtoupper($message), 'EXCEPTION') || 
            str_contains(strtoupper($message), 'FAILED')) {
            \Log::channel('radiusrelated')->error("[{$this->logName}] {$message}");
        }
        
        // Also log to Laravel default log
        // Only faults are mirrored, and as ->error(). Every line used to be
        // duplicated into laravel.log at info level, which doubled the volume
        // and misreported the severity of all of it.
        if (CronLog::isError($message)) {
            Log::channel('single')->error("[{$this->logName}] {$message}");
        }
    }
}



