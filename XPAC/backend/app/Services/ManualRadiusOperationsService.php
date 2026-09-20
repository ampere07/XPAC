<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use App\Support\CronLog;
use Illuminate\Support\Facades\Log;
use Throwable;
use Exception;
use App\Models\RadiusConfig;
use App\Models\DisconnectedLog;
use App\Models\ReconnectionLog;

class ManualRadiusOperationsService
{
    private $logName = 'Manual_DCRC';


    /**
     * Disconnect user from RADIUS and update database
     */
    public function disconnectUser(array $params): array
    {
        try {
            $accountNo = $params['accountNumber'] ?? '';
            $username = $params['username'] ?? '';
            $remarks = $params['remarks'] ?? '';
            $updatedBy = $params['updatedBy'] ?? 'System';

            $this->writeLog("=== DISCONNECT USER START ===");
            $this->writeLog("Account: $accountNo | Username: $username | Remarks: $remarks");

            if (empty($username)) {
                throw new Exception("Username is required for disconnect operation");
            }

            // Determine status based on remarks
            $status = ($remarks === "Pullout") ? "Pullout" : "Disconnected";
            $this->writeLog("Status Set: $status");

            // Get RADIUS configurations
            $radiusEndpoints = $this->getRadiusEndpoints();

            // Try to get active session ID before it's gone
            $sessionId = null;
            if (!empty($username)) {
                $sessionApi = app(RouterosApiService::class);
                foreach ($radiusEndpoints as $endpoint) {
                    $sessionConfig = $this->configFor($endpoint);
                    if (!$sessionConfig) {
                        continue;
                    }

                    try {
                        $sessResult = $sessionApi->getActiveSessions($sessionConfig, $username);
                    } catch (Throwable $sessEx) {
                        $this->writeLog("[SESSION] Error reading sessions on {$endpoint['url']}: " . $sessEx->getMessage());
                        continue;
                    }

                    if (!empty($sessResult) && !empty($sessResult[0]['.id'])) {
                        $sessionId = $sessResult[0]['.id'];
                        $this->writeLog("[SESSION] Found session ID for logging: $sessionId");
                        break;
                    }
                }
            }

            // Perform RADIUS operations
            $radiusApplied = $this->radiusOps(
                $radiusEndpoints,
                $username,
                'Disconnected',
                $status,
                true, // isDisconnectAction
                $accountNo,
                $updatedBy
            );

            if (!$radiusApplied) {
                throw new Exception("Failed to connect to RADIUS server or apply disconnect for user '{$username}'");
            }

            // LOG DISCONNECTION TO DATABASE
            try {
                $billingAccount = null;
                if (!empty($accountNo)) {
                    $billingAccount = DB::table('billing_accounts')->where('account_no', $accountNo)->first();
                }

                if (!$billingAccount && !empty($username)) {
                    $techDetail = DB::table('technical_details')->where('username', $username)->first();
                    if ($techDetail) {
                        $billingAccount = DB::table('billing_accounts')->where('id', $techDetail->account_id)->first();
                    }
                }

                if ($billingAccount) {
                    // Find user ID for created_by/updated_by columns
                    $userId = null;
                    if (!empty($updatedBy) && $updatedBy !== 'System') {
                        $userId = DB::table('users')
                            ->where('username', $updatedBy)
                            ->orWhere('email_address', $updatedBy)
                            ->orWhere('contact_number', $updatedBy)
                            ->value('id');
                    }

                    DisconnectedLog::create([
                        'account_id' => $billingAccount->id,
                        'session_id' => $sessionId ?? null,
                        'username' => $username,
                        'remarks' => $remarks ?: "Manual Disconnect",
                        'created_by_user' => $updatedBy,
                        'updated_by_user' => $updatedBy,
                    ]);
                    $this->writeLog("[DB] Disconnection log entry created for Account: " . ($billingAccount->account_no ?? 'Unknown'));
                }
            } catch (Throwable $dbEx) {
                $this->writeLog("[DB ERROR] Failed to create disconnection log: " . $dbEx->getMessage());
            }

            $this->writeLog("[SUCCESS] User disconnected successfully");
            $this->writeLog("=== DISCONNECT USER END ===");

            return [
                'status' => 'success',
                'message' => 'User disconnected successfully',
                'output' => 'Success: User Disconnected'
            ];

        } catch (Throwable $e) {
            $this->writeLog("[EXCEPTION] " . $e->getMessage());
            $this->writeLog("[TRACE] " . $e->getTraceAsString());
            $this->writeLog("=== DISCONNECT USER END ===");
            
            return [
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ];
        }
    }

    /**
     * Restrict user from RADIUS and update database
     */
    public function restrictedUser(array $params): array
    {
        try {
            $accountNo = $params['accountNumber'] ?? '';
            $username = $params['username'] ?? '';
            $remarks = $params['remarks'] ?? '';
            $updatedBy = $params['updatedBy'] ?? 'System';

            $this->writeLog("=== RESTRICTED USER START ===");
            $this->writeLog("Account: $accountNo | Username: $username | Remarks: $remarks");

            if (empty($username)) {
                throw new Exception("Username is required for restrict operation");
            }

            // Determine status 
            $status = "Restricted";
            $this->writeLog("Status Set: $status");

            // Get RADIUS configurations
            $radiusEndpoints = $this->getRadiusEndpoints();

            // Try to get active session ID before it's gone
            $sessionId = null;
            if (!empty($username)) {
                $sessionApi = app(RouterosApiService::class);
                foreach ($radiusEndpoints as $endpoint) {
                    $sessionConfig = $this->configFor($endpoint);
                    if (!$sessionConfig) {
                        continue;
                    }

                    try {
                        $sessResult = $sessionApi->getActiveSessions($sessionConfig, $username);
                    } catch (Throwable $sessEx) {
                        $this->writeLog("[SESSION] Error reading sessions on {$endpoint['url']}: " . $sessEx->getMessage());
                        continue;
                    }

                    if (!empty($sessResult) && !empty($sessResult[0]['.id'])) {
                        $sessionId = $sessResult[0]['.id'];
                        $this->writeLog("[SESSION] Found session ID for logging: $sessionId");
                        break;
                    }
                }
            }

            // Perform RADIUS operations
            $radiusApplied = $this->radiusOps(
                $radiusEndpoints,
                $username,
                'Restricted', // RADIUS profile group
                $status,      // Database status name
                true,         // isDisconnectAction (kicking session to apply profile)
                $accountNo,
                $updatedBy
            );

            if (!$radiusApplied) {
                throw new Exception("Failed to connect to RADIUS server or apply restrict for user '{$username}'");
            }

            // LOG RESTRICTION TO DATABASE
            try {
                $billingAccount = null;
                if (!empty($accountNo)) {
                    $billingAccount = DB::table('billing_accounts')->where('account_no', $accountNo)->first();
                }

                if (!$billingAccount && !empty($username)) {
                    $techDetail = DB::table('technical_details')->where('username', $username)->first();
                    if ($techDetail) {
                        $billingAccount = DB::table('billing_accounts')->where('id', $techDetail->account_id)->first();
                    }
                }

                if ($billingAccount) {
                    DisconnectedLog::create([
                        'account_id' => $billingAccount->id,
                        'session_id' => $sessionId ?? null,
                        'username' => $username,
                        'remarks' => $remarks ?: "Manual Restricted",
                        'created_by_user' => $updatedBy,
                        'updated_by_user' => $updatedBy,
                    ]);
                    $this->writeLog("[DB] Restriction log entry created for Account: " . ($billingAccount->account_no ?? 'Unknown'));
                }
            } catch (Throwable $dbEx) {
                $this->writeLog("[DB ERROR] Failed to create restriction log: " . $dbEx->getMessage());
            }

            $this->writeLog("[SUCCESS] User restricted successfully");
            $this->writeLog("=== RESTRICTED USER END ===");

            return [
                'status' => 'success',
                'message' => 'User restricted successfully',
                'output' => 'Success: User Restricted'
            ];

        } catch (Throwable $e) {
            $this->writeLog("[EXCEPTION] " . $e->getMessage());
            $this->writeLog("[TRACE] " . $e->getTraceAsString());
            $this->writeLog("=== RESTRICTED USER END ===");
            
            return [
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ];
        }
    }


    /**
     * Reconnect user to RADIUS and update database
     */
    public function reconnectUser(array $params): array
    {
        try {
            $accountNo = $params['accountNumber'] ?? '';
            $username = $params['username'] ?? '';
            $rawPlan = $params['plan'] ?? '';
            $updatedBy = $params['updatedBy'] ?? 'System';

            $this->writeLog("=== RECONNECT USER START ===");
            $this->writeLog("Account: $accountNo | Username: $username | Raw Plan: $rawPlan");

            if (empty($username)) {
                throw new Exception("Username is required for reconnect operation");
            }

            if (empty($rawPlan)) {
                throw new Exception("Plan is required for reconnect operation");
            }

            // Clean plan name (strip price suffix like "SWIFT 1000", "STARTER - P799.00", etc.)
            $cleanPlan = preg_replace('/\s*-\s*(?:P|₱)?\d+.*/i', '', $rawPlan);
            $cleanPlan = preg_replace('/\s+(?:P|₱)?\d+.*/i', '', $cleanPlan);
            $cleanPlan = trim($cleanPlan);
            $this->writeLog("Clean Plan: $cleanPlan");

            // Get RADIUS configurations
            $radiusEndpoints = $this->getRadiusEndpoints();

            // Perform RADIUS operations
            try {
                // MOVE LOGGING HERE to ensure it captures the attempt
                // Global Reconnection Logging
                try {
                    $billingAccount = null;
                    if (!empty($accountNo)) {
                        $billingAccount = DB::table('billing_accounts')->where('account_no', $accountNo)->first();
                    }

                    if (!$billingAccount && !empty($username)) {
                        $techDetail = DB::table('technical_details')->where('username', $username)->first();
                        if ($techDetail) {
                            $billingAccount = DB::table('billing_accounts')->where('id', $techDetail->account_id)->first();
                        }
                    }

                    if ($billingAccount) {
                        // User requested: plan value will be from account_no -> billing_accounts (customer_id) -> customers (desired_plan)
                        $customer = DB::table('customers')->where('id', $billingAccount->customer_id)->first();
                        $desiredPlan = $customer ? $customer->desired_plan : ($rawPlan ?: 'N/A');
                        
                        $planId = null;
                        if ($desiredPlan && $desiredPlan != 'N/A') {
                            $cleanPlanForId = $desiredPlan;
                            if (strpos($desiredPlan, ' - ') !== false) {
                                $cleanPlanForId = explode(' - ', $desiredPlan)[0];
                            }
                            // FIXED: Changed table name from 'plans' to 'plan_list'
                            $planId = DB::table('plan_list')->where('plan_name', $cleanPlanForId)->value('id');
                            if (!$planId) {
                                // Try searching in description if not found in name
                                $planId = DB::table('plan_list')->where('description', 'like', "%{$cleanPlanForId}%")->value('id');
                            }
                        }

                        $reconnectionFee = $params['reconnectionFee'] ?? 0;
                        $remarks = $params['remarks'] ?? 'Auto-Reconnect via RADIUS Service';
                        
                        // Extra check: if it's a Service Order, try to get fee
                        if ($reconnectionFee == 0 && isset($params['serviceOrderId'])) {
                            $reconnectionFee = DB::table('service_orders')->where('id', $params['serviceOrderId'])->value('service_charge') ?? 0;
                        }

                        // Insert into reconnection_logs
                        // Find user ID for created_by/updated_by columns
                        $userId = null;
                        if (!empty($updatedBy) && $updatedBy !== 'System') {
                            $userId = DB::table('users')
                                ->where('username', $updatedBy)
                                ->orWhere('email_address', $updatedBy)
                                ->orWhere('contact_number', $updatedBy)
                                ->value('id');
                        }

                        ReconnectionLog::create([
                            'account_id' => $billingAccount->id,
                            'username' => $username,
                            'plan_id' => $planId,
                            'reconnection_fee' => $reconnectionFee,
                            'remarks' => $remarks,
                            'created_by_user' => $userId ? (string)$userId : $updatedBy,
                            'updated_by_user' => $userId ? (string)$userId : $updatedBy,
                        ]);
                        
                        $this->writeLog("[DB] Reconnection log entry created for Account: " . ($billingAccount->account_no ?? 'Unknown'));
                    } else {
                        $this->writeLog("[WARNING] Could not find billing account for reconnection log (Account: $accountNo, User: $username)");
                    }
                } catch (Throwable $dbEx) {
                    $this->writeLog("[DB ERROR] Failed to create reconnection log: " . $dbEx->getMessage());
                    // Log the full error to help debugging
                    \Log::error("Reconnection Log Insertion Failed: " . $dbEx->getMessage(), [
                        'accountNo' => $accountNo,
                        'username' => $username,
                        'updatedBy' => $updatedBy
                    ]);
                }

                $radiusApplied = $this->radiusOps(
                    $radiusEndpoints,
                    $username,
                    $cleanPlan,
                    'Active',
                    true, // isDisconnectAction
                    $accountNo,
                    $updatedBy
                );

                if (!$radiusApplied) {
                    throw new Exception("Failed to connect to RADIUS server or apply reconnect for user '{$username}'");
                }
            } catch (Throwable $radiusEx) {
                $this->writeLog("[RADIUS ERROR] Operation failed: " . $radiusEx->getMessage());
                throw $radiusEx; // Re-throw to be caught by outer catch (returns error status -> caller queues)
            }

            // NOTE: Email notification is handled by the calling controller (ServiceOrderController / ServiceOrderApiController)
            // to avoid duplicate emails. Do NOT add email sending here.

            $this->writeLog("[SUCCESS] User reconnected successfully");
            $this->writeLog("=== RECONNECT USER END ===");

            return [
                'status' => 'success',
                'message' => 'User reconnected successfully',
                'output' => 'Success: User Reconnected'
            ];

        } catch (Throwable $e) {
            $this->writeLog("[EXCEPTION] " . $e->getMessage());
            $this->writeLog("[TRACE] " . $e->getTraceAsString());
            $this->writeLog("=== RECONNECT USER END ===");
            
            return [
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ];
        }
    }

    /**
     * Update user group/plan in RADIUS (only disconnects if group changes)
     */
    public function updateGroup(array $params): array
    {
        try {
            $accountNo = $params['accountNumber'] ?? '';
            $username = $params['username'] ?? '';
            $rawPlan = $params['plan'] ?? '';
            $updatedBy = $params['updatedBy'] ?? 'System';

            $this->writeLog("=== UPDATE GROUP START ===");
            $this->writeLog("Account: $accountNo | Username: $username | Raw Plan: $rawPlan");

            if (empty($username)) {
                throw new Exception("Username is required for group update operation");
            }

            if (empty($rawPlan)) {
                throw new Exception("Plan is required for group update operation");
            }

            // Clean plan name (strip price suffix like "SWIFT 1000", "STARTER - P799.00", etc.)
            $cleanPlan = preg_replace('/\s*-\s*(?:P|₱)?\d+.*/i', '', $rawPlan);
            $cleanPlan = preg_replace('/\s+(?:P|₱)?\d+.*/i', '', $cleanPlan);
            $cleanPlan = trim($cleanPlan);
            $this->writeLog("Clean Plan: $cleanPlan");

            // Get RADIUS configurations
            $radiusEndpoints = $this->getRadiusEndpoints();

            // Perform RADIUS operations without forcing session disconnect
            $this->radiusOps(
                $radiusEndpoints,
                $username,
                $cleanPlan,
                'Active',
                false, // isDisconnectAction = false
                $accountNo,
                $updatedBy
            );

            $this->writeLog("[SUCCESS] User group updated successfully");
            $this->writeLog("=== UPDATE GROUP END ===");

            return [
                'status' => 'success',
                'message' => 'User group updated successfully',
                'output' => 'Success: User group updated'
            ];

        } catch (Throwable $e) {
            $this->writeLog("[EXCEPTION] " . $e->getMessage());
            $this->writeLog("[TRACE] " . $e->getTraceAsString());
            $this->writeLog("=== UPDATE GROUP END ===");
            
            return [
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ];
        }
    }

    /**
     * Update user credentials in RADIUS and database
     */
    public function updateCredentials(array $params): array
    {
        try {
            $accountNo = $params['accountNumber'] ?? '';
            $oldUsername = $params['username'] ?? '';
            $newUsername = $params['newUsername'] ?? '';
            $newPassword = $params['newPassword'] ?? '';
            $updatedBy = $params['updatedBy'] ?? 'System';

            $this->writeLog("=== UPDATE CREDENTIALS START ===");
            $this->writeLog("Account: $accountNo | Old User: $oldUsername | New User: $newUsername");

            if (empty($oldUsername)) {
                throw new Exception("Current username is required");
            }

            if (empty($newUsername)) {
                throw new Exception("New username is required");
            }

            // Get RADIUS configurations
            $radiusEndpoints = $this->getRadiusEndpoints();

            // Step 1: Update database first (as requested)
            $this->updateDatabaseCredentials(
                $accountNo,
                $oldUsername,
                $newUsername,
                $updatedBy
            );

            // Step 2: Update RADIUS credentials
            $radiusFailureReason = null;
            $radiusSuccess = $this->updateRadiusCredentials(
                $radiusEndpoints,
                $oldUsername,
                $newUsername,
                $newPassword,
                $radiusFailureReason,
                $accountNo
            );

            if (!$radiusSuccess) {
                // DB username was already updated, but RADIUS could not be reached/updated.
                // Report failure so the caller queues the RADIUS rename for automatic retry.
                //
                // The reason is carried through verbatim rather than flattened into
                // "failed to connect": the queue stores this text as last_error, and it
                // is the only record of whether the server was down, the account was
                // missing, or the device refused the name.
                $this->writeLog("[WARNING] Database was updated, but RADIUS update failed. Will be queued for retry.");
                throw new Exception(
                    $radiusFailureReason !== null
                        ? "RADIUS credential update failed for '{$oldUsername}': {$radiusFailureReason}"
                        : "Failed to connect to RADIUS server or update credentials for user '{$oldUsername}'"
                );
            }

            $this->writeLog("[SUCCESS] Credentials updated successfully");
            $this->writeLog("=== UPDATE CREDENTIALS END ===");

            return [
                'status' => 'success',
                'message' => 'Credentials updated successfully',
                'output' => 'Success: Credentials Updated (RADIUS updated, DB username updated)'
            ];

        } catch (Throwable $e) {
            $this->writeLog("[EXCEPTION] " . $e->getMessage());
            $this->writeLog("[TRACE] " . $e->getTraceAsString());
            $this->writeLog("=== UPDATE CREDENTIALS END ===");
            
            return [
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ];
        }
    }

    /**
     * Disable user in RADIUS by setting disabled=yes
     */
    public function disabledUser(array $params): array
    {
        try {
            $accountNo = $params['accountNumber'] ?? '';
            $username = $params['username'] ?? '';
            $updatedBy = $params['updatedBy'] ?? 'System';

            $this->writeLog("=== DISABLE USER START ===");
            $this->writeLog("Account: $accountNo | Username: $username");

            if (empty($username)) {
                throw new Exception("Username is required");
            }

            $radiusEndpoints = $this->getRadiusEndpoints();

            // Step 1: Locate the user across ALL radius_config servers
            $located = $this->findRadiusUser($radiusEndpoints, $username);
            if (!$located) {
                throw new Exception("User '$username' not found in RADIUS");
            }
            $endpoint = $located['endpoint'];

            // Step 2: Set disabled=yes on the server where the account was found
            $config = $this->configFor($endpoint);
            if (!$config) {
                throw new Exception("No radius_config record behind {$endpoint['url']}");
            }

            $api = app(RouterosApiService::class);
            if (!$api->setUserDisabled($config, $located['id'], true)) {
                throw new Exception("Failed to update disabled status in RADIUS: " . $api->getLastError());
            }
            $this->writeLog("[DISABLE] Set disabled=yes for '$username' at {$endpoint['url']}");

            // Step 3: Kill active session (on the same server)
            $this->killUserSession([$endpoint], $username);

            $this->writeLog("[SUCCESS] User disabled successfully");
            $this->writeLog("=== DISABLE USER END ===");

            return [
                'status' => 'success',
                'message' => 'User disabled successfully',
                'output' => 'Success: User Disabled (disabled=yes)'
            ];

        } catch (Throwable $e) {
            $this->writeLog("[EXCEPTION] " . $e->getMessage());
            $this->writeLog("=== DISABLE USER END ===");
            return [
                'status' => 'error',
                'message' => $e->getMessage()
            ];
        }
    }

    /**
     * Enable user in RADIUS by setting disabled=no
     */
    public function enabledUser(array $params): array
    {
        try {
            $accountNo = $params['accountNumber'] ?? '';
            $username = $params['username'] ?? '';
            $updatedBy = $params['updatedBy'] ?? 'System';

            $this->writeLog("=== ENABLE USER START ===");
            $this->writeLog("Account: $accountNo | Username: $username");

            if (empty($username)) {
                throw new Exception("Username is required");
            }

            $radiusEndpoints = $this->getRadiusEndpoints();

            // Step 1: Locate the user across ALL radius_config servers
            $located = $this->findRadiusUser($radiusEndpoints, $username);
            if (!$located) {
                throw new Exception("User '$username' not found in RADIUS");
            }
            $endpoint = $located['endpoint'];

            // Step 2: Set disabled=no on the server where the account was found
            $config = $this->configFor($endpoint);
            if (!$config) {
                throw new Exception("No radius_config record behind {$endpoint['url']}");
            }

            $api = app(RouterosApiService::class);
            if (!$api->setUserDisabled($config, $located['id'], false)) {
                throw new Exception("Failed to update disabled status in RADIUS: " . $api->getLastError());
            }
            $this->writeLog("[ENABLE] Set disabled=no for '$username' at {$endpoint['url']}");

            $this->writeLog("[SUCCESS] User enabled successfully");
            $this->writeLog("=== ENABLE USER END ===");

            return [
                'status' => 'success',
                'message' => 'User enabled successfully',
                'output' => 'Success: User Enabled (disabled=no)'
            ];

        } catch (Throwable $e) {
            $this->writeLog("[EXCEPTION] " . $e->getMessage());
            $this->writeLog("=== ENABLE USER END ===");
            return [
                'status' => 'error',
                'message' => $e->getMessage()
            ];
        }
    }


    /**
     * Update RADIUS credentials (username and password)
     */
    /**
     * Update RADIUS credentials (username and password)
     */
    public function updateRadiusCredentials(
        array $radiusEndpoints,
        string $oldUsername,
        string $newUsername,
        ?string $newPassword = null,
        ?string &$failureReason = null,
        ?string $accountNo = null
    ): bool {
        $this->writeLog("[CREDENTIALS] Attempting RADIUS update: '$oldUsername' -> '$newUsername'");

        // Every name this account may answer to on the device, most likely first.
        // The queued params freeze the name as it was when the job was created,
        // but the database rename runs before the RADIUS leg — so after a failed
        // first attempt the device may hold the old name while the database holds
        // the new one. Looking for only one of them is what made a retry conclude
        // the account had vanished.
        $candidates = $this->candidateUsernames($accountNo, $oldUsername, $newUsername);
        $this->writeLog("[CREDENTIALS] Looking for: " . implode(', ', array_map(
            static fn (string $name): string => "'{$name}'",
            $candidates
        )));

        $totalSuccessCount = 0;
        $alreadyNamedCount = 0;
        $unreachableCount = 0;
        $absentCount = 0;
        $rejectedCount = 0;
        $reasons = [];
        $failureReason = null;

        $api = app(RouterosApiService::class);

        foreach ($radiusEndpoints as $index => $endpoint) {
            $serverName = "Server #" . ($index + 1) . " ({$endpoint['url']})";
            $this->writeLog("[CREDENTIALS] Processing $serverName");

            $config = $this->configFor($endpoint);

            if (!$config) {
                $this->writeLog("[CREDENTIALS] [SKIP] No radius_config record behind $serverName");
                $reasons[] = "$serverName: no radius_config record";
                continue;
            }

            // 0. Reach the device FIRST, so an unreachable server is never confused
            //    with a server that simply does not carry this account. findUser()
            //    answers null for both, and reporting the second as the first is
            //    what sent renames round a retry ladder they could never finish.
            if (!$api->connect($config)) {
                $error = $api->getLastError() !== '' ? $api->getLastError() : 'no endpoint responded';
                $this->writeLog("[CREDENTIALS] [UNREACHABLE] $serverName - $error");
                $reasons[] = "$serverName unreachable: $error";
                $unreachableCount++;
                continue;
            }

            // 1. Find the account on THIS specific server, under whichever of its
            //    known names the device still holds, to get the correct ID.
            $findResult = null;
            $matchedName = '';

            foreach ($candidates as $candidate) {
                $findResult = $api->findUser($config, $candidate);

                if ($findResult !== null) {
                    $matchedName = $candidate;
                    break;
                }
            }

            // 2. Present under none of its names: this server does not carry the
            //    account at all. That is a different problem from an unreachable
            //    server, and no amount of retrying will change it.
            if ($findResult === null) {
                $this->writeLog("[CREDENTIALS] [SKIP] Account not present on $serverName under any known name");
                $reasons[] = "$serverName: account absent under all known names";
                $absentCount++;
                continue;
            }

            $radiusId = $findResult['.id'];
            $deviceName = (string) ($findResult['username'] ?? '');
            $this->writeLog("[CREDENTIALS] Found on $serverName as '$deviceName' (matched '$matchedName', id $radiusId)");

            // 3. The device already carries the target name — an earlier attempt
            //    landed, or the rename only changes capitalisation, which the
            //    device treats as the same name. Either way there is nothing to
            //    rename, and only a password may still need applying.
            if ($deviceName === $newUsername) {
                $this->writeLog("[CREDENTIALS] [ALREADY DONE] $serverName already carries '$newUsername'");
                $this->applyPasswordIfGiven($api, $config, $radiusId, $newPassword, $serverName);
                $alreadyNamedCount++;
                continue;
            }

            // 4. DISABLE user temporarily to prevent instant auto-reconnect during rename
            $this->writeLog("[CREDENTIALS] Temporarily disabling user to clear sessions...");
            $api->setUserDisabled($config, $radiusId, true);

            // 5. KILL active sessions for the name the device actually holds, which
            //    is not always the name the job was queued with.
            $api->killSessionsForUser($config, $deviceName !== '' ? $deviceName : $matchedName);

            // Small pause for RADIUS to stabilize
            sleep(1);

            // 6. UPDATE credentials (Rename)
            $payload = ['name' => $newUsername];
            if (!empty($newPassword)) {
                $payload['password'] = $newPassword;
            }

            $this->writeLog("[CREDENTIALS] Applying rename in RADIUS...");
            $patchApplied = $api->updateUser($config, $radiusId, $payload);
            $patchError = $patchApplied ? '' : $api->getLastError();

            // 7. RE-ENABLE the user. Addressed by the RADIUS id, which survives the rename,
            //    so the account is never left disabled because its name has moved on.
            $this->writeLog("[CREDENTIALS] Re-enabling user...");
            $api->setUserDisabled($config, $radiusId, false);

            if ($patchApplied) {
                $this->writeLog("[CREDENTIALS] [SUCCESS] Updated credentials on $serverName");
                $totalSuccessCount++;
                continue;
            }

            // The set was refused. Ask the device what it holds now: a reply lost
            // after the change was applied looks identical to a rejection from
            // here, and only the device can tell the two apart.
            $after = $api->findUser($config, $newUsername);

            if ($after !== null && (string) ($after['.id'] ?? '') === (string) $radiusId) {
                $this->writeLog("[CREDENTIALS] [SUCCESS] Rename did land on $serverName despite the error reply");
                $totalSuccessCount++;
                continue;
            }

            $this->writeLog("[CREDENTIALS] [FAILED] Rename rejected on $serverName - " . $patchError);
            $reasons[] = "$serverName rejected the rename: " . ($patchError !== '' ? $patchError : 'no reason given');
            $rejectedCount++;
        }

        if ($totalSuccessCount > 0 || $alreadyNamedCount > 0) {
            return true;
        }

        // Name the real problem. The queue decides how long to keep trying from
        // this text, and "could not reach the server" deserves a retry while
        // "the account is on no server" never will.
        if ($unreachableCount > 0) {
            $failureReason = "could not reach any RADIUS server holding '$oldUsername' ("
                . implode('; ', $reasons) . ')';
        } elseif ($rejectedCount > 0) {
            $failureReason = "RADIUS rejected the rename of '$oldUsername' to '$newUsername' ("
                . implode('; ', $reasons) . ')';
        } elseif ($absentCount > 0) {
            $failureReason = "'$oldUsername' is on no RADIUS server under either its old or new name"
                . " — nothing to rename (" . implode('; ', $reasons) . ')';
        } else {
            $failureReason = "no RADIUS server was usable for '$oldUsername' ("
                . ($reasons === [] ? 'no endpoints configured' : implode('; ', $reasons)) . ')';
        }

        return false;
    }

    /**
     * Every name this account may still be known by on a RADIUS device, ordered
     * by how likely the device is to hold it.
     *
     * The queued name comes first: if the RADIUS leg failed outright, that is what
     * the device still has. The database name comes next, because the database is
     * renamed BEFORE the RADIUS call, so on any retry it already holds the new
     * name — and if the device was renamed too, this is what finds it. The target
     * name comes last as a backstop for an account whose database row never moved.
     *
     * Matching on the device is case-insensitive, so names differing only in case
     * are collapsed here rather than costing a second lookup.
     *
     * @return array<int, string>
     */
    private function candidateUsernames(?string $accountNo, string $oldUsername, string $newUsername): array
    {
        $ordered = array_merge(
            [$oldUsername],
            $this->databaseUsernames($accountNo, $oldUsername),
            [$newUsername]
        );

        $candidates = [];
        $seen = [];

        foreach ($ordered as $name) {
            $name = trim((string) $name);

            if ($name === '') {
                continue;
            }

            $key = strtolower($name);

            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $candidates[] = $name;
        }

        return $candidates;
    }

    /**
     * The PPPoE usernames the database currently holds for this account.
     *
     * technical_details is the record of truth and is read both by account_no and
     * through billing_accounts, because the column is populated inconsistently.
     * job_orders.pppoe_username is read as a last resort for accounts whose
     * technical_details row is missing or was never filled in.
     *
     * @return array<int, string>
     */
    private function databaseUsernames(?string $accountNo, string $oldUsername): array
    {
        $names = [];

        if (!empty($accountNo)) {
            $technical = DB::table('technical_details')
                ->where('account_no', $accountNo)
                ->value('username');

            if (!empty($technical)) {
                $names[] = (string) $technical;
                $this->writeLog("[CREDENTIALS] [DB] technical_details (account_no $accountNo) holds '{$technical}'");
            }

            $account = DB::table('billing_accounts')->where('account_no', $accountNo)->first();

            if ($account) {
                $byId = DB::table('technical_details')
                    ->where('account_id', $account->id)
                    ->value('username');

                if (!empty($byId)) {
                    $names[] = (string) $byId;
                    $this->writeLog("[CREDENTIALS] [DB] technical_details (account_id {$account->id}) holds '{$byId}'");
                }

                $jobOrder = DB::table('job_orders')
                    ->where('account_id', $account->id)
                    ->orderByDesc('id')
                    ->value('pppoe_username');

                if (!empty($jobOrder)) {
                    $names[] = (string) $jobOrder;
                    $this->writeLog("[CREDENTIALS] [DB] job_orders holds '{$jobOrder}'");
                }
            }
        }

        // No account number on the job: the queued name is the only way back to the row.
        if ($names === [] && $oldUsername !== '') {
            $byUsername = DB::table('technical_details')
                ->where('username', $oldUsername)
                ->value('username');

            if (!empty($byUsername)) {
                $names[] = (string) $byUsername;
            }
        }

        if ($names === []) {
            $this->writeLog('[CREDENTIALS] [DB] No stored username found; using the queued names only');
        }

        return $names;
    }

    /**
     * Set the password on an account whose name is already correct.
     *
     * Reached when a rename turns out to have landed already: the name needs no
     * work, but a password supplied with it still does.
     *
     * @param RadiusConfig $config
     */
    private function applyPasswordIfGiven(
        RouterosApiService $api,
        $config,
        string $radiusId,
        ?string $newPassword,
        string $serverName
    ): void {
        if (empty($newPassword)) {
            return;
        }

        if ($api->updateUser($config, $radiusId, ['password' => $newPassword])) {
            $this->writeLog("[CREDENTIALS] Password applied on $serverName");

            return;
        }

        $this->writeLog("[CREDENTIALS] [WARNING] Password not applied on $serverName - " . $api->getLastError());
    }

    /**
     * Update database credentials (username only)
     */
    private function updateDatabaseCredentials(string $accountNo, string $oldUsername, string $newUsername, string $updatedBy): void
    {
        $rowsUpdated = 0;
        $accountId = null;

        // PPPoE Username is in technical_details table, not billing_accounts
        if (!empty($accountNo)) {
            $billingAccount = DB::table('billing_accounts')->where('account_no', $accountNo)->first();
            if ($billingAccount) {
                $accountId = $billingAccount->id;
                $rowsUpdated = DB::table('technical_details')
                    ->where('account_id', $billingAccount->id)
                    ->update([
                        'username' => $newUsername,
                        'updated_at' => now(),
                        'updated_by' => $updatedBy
                    ]);

                if ($rowsUpdated > 0) {
                    $this->writeLog("[DB] Updated username via Account No: $accountNo");
                }
            }
        }

        // Fallback to old username in technical_details if account no update didn't happen
        if ($rowsUpdated === 0) {
            $this->writeLog("[DB] Account No update failed/skipped. Trying old username...");
            
            $techDetail = DB::table('technical_details')->where('username', $oldUsername)->first();
            if ($techDetail) {
                $accountId = $techDetail->account_id;
            }

            $rowsUpdated = DB::table('technical_details')
                ->where('username', $oldUsername)
                ->update([
                    'username' => $newUsername,
                    'updated_at' => now(),
                    'updated_by' => $updatedBy
                ]);

            if ($rowsUpdated > 0) {
                $this->writeLog("[DB] Database credentials updated successfully via username");
            }
        }

        // If technical_details was updated successfully, also sync job_orders
        if ($rowsUpdated > 0) {
            if ($accountId) {
                $joUpdated = DB::table('job_orders')
                    ->where('account_id', $accountId)
                    ->update([
                        'pppoe_username' => $newUsername,
                        'username' => $newUsername,
                        'updated_at' => now()
                    ]);
                
                $this->writeLog("[DB] Synced job_orders username & pppoe_username for Account ID: $accountId ($joUpdated rows affected)");
            } else {
                $this->writeLog("[WARNING] Could not determine account_id to sync job_orders table");
            }
        } else {
            $this->writeLog("[WARNING] RADIUS updated, but database update affected 0 rows");
        }
    }

    /**
     * Locate a user across ALL configured RADIUS servers.
     *
     * Checks each radius_config in order (primary first, then the rest) and returns
     * as soon as the user is found on any server. A failure/timeout on one server is
     * logged and skipped so it never prevents the remaining servers from being checked.
     *
     * The RADIUS record id (`.id`) is server-specific, so the endpoint it was found on
     * is returned alongside it — callers must target that same endpoint for any follow-up
     * PATCH/DELETE to stay correct and avoid duplicate requests to other servers.
     *
     * @return array{id: string, group: string, endpoint: array}|null Null if not found on any server.
     */
    private function findRadiusUser(array $radiusEndpoints, string $username): ?array
    {
        $api = app(RouterosApiService::class);

        foreach ($radiusEndpoints as $index => $endpoint) {
            $serverName = "Server #" . ($index + 1) . " ({$endpoint['url']})";
            $this->writeLog("[LOOKUP] Searching for '$username' on $serverName");

            $config = $this->configFor($endpoint);

            if (!$config) {
                $this->writeLog("[LOOKUP] No radius_config record behind $serverName — skipping");
                continue;
            }

            try {
                $result = $api->findUser($config, $username);
            } catch (Throwable $e) {
                // A failure on this server must not stop us from checking the others.
                $this->writeLog("[LOOKUP] Error querying $serverName: " . $e->getMessage() . " — continuing to next server");
                continue;
            }

            if ($result !== null) {
                $currentGroup = $result['group'];
                $this->writeLog("[LOOKUP] Found '$username' on $serverName (ID: {$result['.id']} | Group: '$currentGroup')");
                return [
                    'id' => $result['.id'],
                    'group' => $currentGroup,
                    'disabled' => $result['disabled'],
                    'endpoint' => $endpoint,
                ];
            }

            $error = $api->getLastError();
            if ($error !== '') {
                $this->writeLog("[LOOKUP] $serverName unreachable: $error — continuing to next server");
                continue;
            }

            $this->writeLog("[LOOKUP] '$username' not found on $serverName — trying next");
        }

        $this->writeLog("[LOOKUP] '$username' not found on any RADIUS server");
        return null;
    }

    /**
     * Core RADIUS operations (disconnect/reconnect)
     */
    private function radiusOps(
        array $radiusEndpoints,
        string $username,
        string $targetGroup,
        string $dbStatus,
        bool $isDisconnectAction,
        string $accountNo = '',
        string $updatedBy = 'System'
    ): bool {
        $this->writeLog("[RADIUS OPS] User: $username | Target: $targetGroup | isDC: " . ($isDisconnectAction ? 'Yes' : 'No'));

        // Whether the change was actually applied/confirmed on a live RADIUS server.
        // Stays false when the server is unreachable so the caller can queue a retry
        // instead of falsely reporting success.
        $radiusApplied = false;

        // Locate the user across ALL radius_config servers (primary first, then the rest),
        // tolerating a failure on any single server.
        $located = $this->findRadiusUser($radiusEndpoints, $username);

        if ($located) {
            $radiusId = $located['id'];
            $currentRadiusGroup = $located['group'];
            $endpoint = $located['endpoint'];

            $patchHappened = false;

            // Check if group needs updating. Patch ONLY the server where the user was
            // found — the RADIUS id is server-specific, so hitting other servers with it
            // would be incorrect and would issue duplicate requests.
            $needsPatch = ($currentRadiusGroup !== $targetGroup);
            if ($needsPatch) {
                $this->writeLog("[PATCH] Mismatch ('$currentRadiusGroup' != '$targetGroup'). Applying '$targetGroup' on {$endpoint['url']}...");

                $config = $this->configFor($endpoint);

                if ($config) {
                    $api = app(RouterosApiService::class);

                    if ($api->setUserGroup($config, $radiusId, $targetGroup)) {
                        $this->writeLog("[PATCH] Success at {$endpoint['url']}");
                        $patchHappened = true;
                    } else {
                        $this->writeLog("[PATCH] Failed at {$endpoint['url']} - " . $api->getLastError());
                    }
                } else {
                    $this->writeLog("[PATCH] Failed at {$endpoint['url']} - no radius_config record behind this endpoint");
                }
            } else {
                $this->writeLog("[PATCH] User already in group '$targetGroup' — no patch needed");
            }

            // The operation is considered applied if no patch was needed (already in the
            // desired group) or the patch succeeded on the server where the user lives.
            $radiusApplied = $needsPatch ? $patchHappened : true;

            // Determine if session should be killed (only on the server where the user was found).
            $shouldKill = $isDisconnectAction || $patchHappened;

            if ($shouldKill) {
                $this->writeLog("[DECISION] Killing session on {$endpoint['url']}...");
                $this->killUserSession([$endpoint], $username, true);
            } else {
                $this->writeLog("[DECISION] No changes needed, keeping session");
            }
        } else {
            // User could not be located on ANY RADIUS server. This happens when every
            // server is unreachable/timing out (connection error) or the user is missing.
            // Either way the change was NOT applied — report failure so it gets queued.
            $this->writeLog("[WARNING] User '$username' not found in RADIUS (server unreachable or user missing)");
        }

        // Update database (local status) regardless — the queue handles RADIUS retry.
        $this->updateDatabaseStatus($accountNo, $username, $dbStatus, $updatedBy);

        return $radiusApplied;
    }

    /**
     * Update database status
     */
    private function updateDatabaseStatus(string $accountNo, string $username, string $dbStatus, string $updatedBy): void
    {
        // Get status ID from billing_status table
        $statusId = DB::table('billing_status')->where('status_name', $dbStatus)->value('id');

        // If status name not found (e.g. "Inactive" or "Restricted"), try "Disconnected" as fallback
        if (!$statusId && in_array($dbStatus, ['Inactive', 'Restricted'])) {
             $statusId = DB::table('billing_status')->where('status_name', 'Disconnected')->value('id');
        }

        if (!$statusId) {
            $this->writeLog("[WARNING] Status '$dbStatus' not found in billing_status table. Database update skipped.");
            return;
        }

        $rowsUpdated = 0;

        // Try via Account No first
        if (!empty($accountNo)) {
            $rowsUpdated = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->update([
                    'billing_status_id' => $statusId,
                    'updated_at' => now(),
                    'updated_by' => $updatedBy
                ]);
        }

        // Fallback to searching technical_details since billing_accounts doesn't have username
        if ($rowsUpdated === 0 && !empty($username)) {
            try {
                $techDetail = DB::table('technical_details')->where('username', $username)->first();
                if ($techDetail) {
                    $rowsUpdated = DB::table('billing_accounts')
                        ->where('id', $techDetail->account_id)
                        ->update([
                            'billing_status_id' => $statusId,
                            'updated_at' => now(),
                            'updated_by' => $updatedBy
                        ]);
                }
            } catch (Throwable $e) {
                $this->writeLog("[DB ERROR] Error updating status via tech details: " . $e->getMessage());
            }
        }

        if ($rowsUpdated > 0) {
            $this->writeLog("[DB] Status updated to: $dbStatus (ID: $statusId)");
        } else {
            $this->writeLog("[WARNING] Database status update affected 0 rows for Account: $accountNo, User: $username");
        }
    }

    /**
     * Kill active user sessions (with failover support)
     */
    private function killUserSession(array $radiusEndpoints, string $username, bool $useFailover = true): void
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
            } catch (Throwable $e) {
                $this->writeLog("[SESSION] Error cutting sessions on {$endpoint['url']}: " . $e->getMessage());
                continue;
            }

            if ($killed > 0) {
                $killedAnywhere += $killed;
                $this->writeLog("[KILL] Terminated {$killed} session(s) for '$username' on {$endpoint['url']}");

                // FAILOVER LOGIC: the account lives on exactly one server, so stop at the
                // one that had the live session instead of hitting the rest.
                if ($useFailover) {
                    return;
                }
            }
        }

        if ($killedAnywhere === 0) {
            $this->writeLog("[SESSION] No active session found");
        }
    }

    /**
     * Can any configured RADIUS server actually be worked with right now?
     *
     * AutoDisconnectService has always called this to decide whether to apply a
     * restriction immediately or defer it to the retry queue — but the method did not
     * exist. PHP raised `Error: Call to undefined method`, which implements Throwable and
     * so was swallowed by that caller's `catch (Throwable)`, and the probe therefore
     * answered "unreachable" on every single run. Nothing was ever restricted at the
     * decision point; every disconnection silently took the queued path and logged
     * "RADIUS server unreachable during auto-disconnect" even while RADIUS was healthy.
     *
     * "Reachable" deliberately means a completed API login, not an open socket. The
     * RouterOS API port accepts a TCP connection and then answers nothing a non-API
     * client can use, so a socket test reports success against a device that cannot be
     * worked with — the exact false signal that made this fault so hard to see.
     *
     * Goes through the shared connection layer like every other RADIUS call, so it picks
     * up the saved-then-alternate transport order and the circuit breaker: a server
     * already known to be down costs no socket and no timeout here either, and the
     * connection this opens is pooled for the operation that follows it.
     */
    public function isRadiusReachable(): bool
    {
        $api = app(RouterosApiService::class);

        foreach (RadiusConfig::orderBy('id')->get() as $config) {
            if ($api->ping($config)) {
                return true;
            }

            $this->writeLog("[REACHABILITY] {$config->ip} did not answer: " . $api->getLastError());
        }

        return false;
    }

    /**
     * Get RADIUS endpoint configurations.
     *
     * Each entry carries the RadiusConfig record the native RouterOS API client operates
     * on, alongside the `url`/`username`/`password` keys the existing log lines and the
     * public updateRadiusCredentials() signature still read. `url` is now a human label
     * for the device, not a REST base URL — nothing appends a path to it any more.
     *
     * @return array<int, array{config: RadiusConfig, url: string, username: string, password: string}>
     */
    private function getRadiusEndpoints(): array
    {
        $radiusConfigs = RadiusConfig::orderBy('id')->get();

        if ($radiusConfigs->isEmpty()) {
            throw new Exception("No RADIUS configurations found");
        }

        $endpoints = [];
        foreach ($radiusConfigs as $config) {
            $endpoints[] = [
                'config'   => $config,
                'url'      => "{$config->ip} (Config #{$config->id})",
                'username' => $config->username,
                'password' => $config->password
            ];
        }

        return $endpoints;
    }

    /**
     * The RadiusConfig behind an endpoint entry.
     *
     * updateRadiusCredentials() is public and may still be handed endpoint arrays built
     * elsewhere, so an entry without a `config` key is resolved back to its record by IP
     * rather than failing the operation.
     */
    private function configFor(array $endpoint): ?RadiusConfig
    {
        if (isset($endpoint['config']) && $endpoint['config'] instanceof RadiusConfig) {
            return $endpoint['config'];
        }

        $host = $endpoint['ip'] ?? null;

        if ($host === null && isset($endpoint['url'])) {
            // Tolerates both the old "https://host:port" shape and the current label.
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
    private function writeLog(string $message): void
    {
        // Errors and run summaries only - see App\Support\CronLog. This is a raw
        // file write, so LOG_LEVEL never reached it and the narration accumulated
        // no matter how the channels were configured.
        if (!CronLog::shouldWrite($message)) {
            return;
        }

        $timestamp = now()->format('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] [{$this->logName}] {$message}";
        
        // Write to custom log file
        $logPath = storage_path('logs/manual_radius_operations.log');
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

    /**
     * Delete user account from RADIUS
     */
    public function deleteAccount(string $username): array
    {
        try {
            $this->writeLog("=== DELETE ACCOUNT START ===");
            $this->writeLog("Username: $username");

            if (empty($username)) {
                throw new Exception("Username is required for delete operation");
            }

            // Get RADIUS configurations
            $radiusEndpoints = $this->getRadiusEndpoints();
            
            $api = app(RouterosApiService::class);

            $deleteCount = 0;
            foreach ($radiusEndpoints as $endpoint) {
                $config = $this->configFor($endpoint);

                if (!$config) {
                    $this->writeLog("[DELETE] No radius_config record behind {$endpoint['url']} — skipping");
                    continue;
                }

                $this->writeLog("[DELETE] Calling endpoint: {$endpoint['url']}");

                // removeUser() is idempotent: an account already absent from this server is
                // reported as success, so re-running a delete never fails on a clean device.
                if ($api->removeUser($config, $username)) {
                    $this->writeLog("[DELETE] Successfully deleted user '$username' from {$endpoint['url']}");
                    $deleteCount++;
                } else {
                    $this->writeLog("[DELETE] Failed to delete user '$username' from {$endpoint['url']} - " . $api->getLastError());
                }
            }

            $this->writeLog("=== DELETE ACCOUNT END ===");

            return [
                'status' => 'success',
                'message' => "Delete operation completed ($deleteCount servers affected)",
                'delete_count' => $deleteCount
            ];

        } catch (Throwable $e) {
            $this->writeLog("[EXCEPTION] " . $e->getMessage());
            $this->writeLog("=== DELETE ACCOUNT END ===");
            
            return [
                'status' => 'error',
                'message' => $e->getMessage()
            ];
        }
    }
}






