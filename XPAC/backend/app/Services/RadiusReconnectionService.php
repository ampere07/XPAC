<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
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

            $radiusConfigs = DB::table('radius_config')
                ->orderBy('id')
                ->get();

            if ($radiusConfigs->isEmpty()) {
                $this->writeLog("[ERROR] No RADIUS configurations found");
                return 'no_radius_config';
            }

            // Build RADIUS endpoint URLs
            $radiusEndpoints = [];
            foreach ($radiusConfigs as $config) {
                $url = "{$config->ssl_type}://{$config->ip}:{$config->port}";
                $radiusEndpoints[] = [
                    'url' => $url,
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

        $radiusId = null;
        $currentRadiusGroup = null;
        $activeEndpoint = null;

        // Find user in RADIUS servers
        $userPath = "/rest/user-manage/user/" . urlencode($username);

        foreach ($radiusEndpoints as $endpoint) {
            $fullUrl = $endpoint['url'] . $userPath;
            $result = $this->callApiWithRetry(
                $fullUrl,
                'GET',
                null,
                $endpoint['username'],
                $endpoint['password']
            );

            if ($result && isset($result['.id'])) {
                $radiusId = $result['.id'];
                $currentRadiusGroup = $result['group'] ?? '';
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
            $payload = ['group' => $targetGroup];

            // Try to patch on all endpoints
            foreach ($radiusEndpoints as $endpoint) {
                $targetUrl = $endpoint['url'] . "/rest/user-manage/user/" . $radiusId;
                $result = $this->callApiWithRetry(
                    $targetUrl,
                    'PATCH',
                    $payload,
                    $endpoint['username'],
                    $endpoint['password']
                );

                if ($result !== false) {
                    $this->writeLog("[PATCH] Success at {$endpoint['url']}");
                    $patchHappened = true;
                }
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
            $this->killUserSession($radiusEndpoints, $username);
        }

        return ['success' => true, 'message' => 'Reconnection successful'];
    }

    /**
     * Kill active user sessions
     */
    private function killUserSession($radiusEndpoints, $username)
    {
        $sessPath = "/rest/user-manage/session?user=" . urlencode($username);
        $sessions = null;

        // Find active sessions
        foreach ($radiusEndpoints as $endpoint) {
            $fullUrl = $endpoint['url'] . $sessPath;
            $result = $this->callApiWithRetry(
                $fullUrl,
                'GET',
                null,
                $endpoint['username'],
                $endpoint['password']
            );

            if ($result && is_array($result)) {
                $sessions = $result;
                $this->writeLog("[SESSION] Found " . count($sessions) . " active session(s)");
                break;
            }
        }

        if (!$sessions || empty($sessions)) {
            $this->writeLog("[SESSION] No active session found.");
            return;
        }

        // Kill all sessions
        foreach ($sessions as $session) {
            if (isset($session['.id'])) {
                $sessionId = $session['.id'];
                
                foreach ($radiusEndpoints as $endpoint) {
                    $delUrl = $endpoint['url'] . "/rest/user-manage/session/" . $sessionId;
                    $this->callApiWithRetry(
                        $delUrl,
                        'DELETE',
                        null,
                        $endpoint['username'],
                        $endpoint['password']
                    );
                    $this->writeLog("[KILL] Terminated session ID $sessionId at {$endpoint['url']}");
                }
            }
        }
    }

    /**
     * Call API with retry logic
     */
    private function callApiWithRetry($url, $method, $payload, $username, $password, $retries = 3)
    {
        for ($attempt = 1; $attempt <= $retries; $attempt++) {
            try {
                $this->writeLog("[API] Attempt $attempt/$retries: $method $url");

                $response = Http::withBasicAuth($username, $password)
                    ->timeout(10)
                    ->withOptions(['verify' => false]); // Disable SSL verification for self-signed certs

                switch (strtoupper($method)) {
                    case 'GET':
                        $response = $response->get($url);
                        break;
                    case 'POST':
                        $response = $response->post($url, $payload);
                        break;
                    case 'PATCH':
                        $response = $response->patch($url, $payload);
                        break;
                    case 'DELETE':
                        $response = $response->delete($url);
                        break;
                    default:
                        return false;
                }

                if ($response->successful()) {
                    $data = $response->json();
                    $this->writeLog("[API] Success: " . json_encode($data));
                    return $data;
                } else {
                    $this->writeLog("[API] HTTP Error {$response->status()}: {$response->body()}");
                }

            } catch (Exception $e) {
                $this->writeLog("[API] Exception on attempt $attempt: " . $e->getMessage());
                
                if ($attempt < $retries) {
                    sleep(1); // Wait 1 second before retry
                }
            }
        }

        $this->writeLog("[API] Failed after $retries attempts");
        return false;
    }

    /**
     * Write to log file
     */
    private function writeLog($message)
    {
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
        Log::channel('single')->info("[{$this->logName}] {$message}");
    }
}



