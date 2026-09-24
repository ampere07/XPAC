<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Throwable;
use Exception;
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
                $sessPath = "/rest/user-manage/session?user=" . urlencode($username);
                foreach ($radiusEndpoints as $endpoint) {
                    $fullUrl = $endpoint['url'] . $sessPath;
                    $sessResult = $this->callApiWithRetry($fullUrl, 'GET', null, $endpoint['username'], $endpoint['password']);
                    if ($sessResult && is_array($sessResult) && isset($sessResult[0]['.id'])) {
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
                $sessPath = "/rest/user-manage/session?user=" . urlencode($username);
                foreach ($radiusEndpoints as $endpoint) {
                    $fullUrl = $endpoint['url'] . $sessPath;
                    $sessResult = $this->callApiWithRetry($fullUrl, 'GET', null, $endpoint['username'], $endpoint['password']);
                    if ($sessResult && is_array($sessResult) && isset($sessResult[0]['.id'])) {
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
     *
     * Optional param `preserveBillingStatus` (bool, default false): leave billing_status_id
     * exactly as the caller committed it instead of forcing it to Active.
     *
     * A plain reconnect means "this customer paid, put them back in service", so writing Active
     * is right for every payment-driven caller and stays the default. It is wrong for VIP: a VIP
     * carries its own billing status (id 7), which is what makes billing generation skip the
     * account and what vip:check-expiration sweeps on. Forcing Active here would silently strip
     * both the moment the account was comped — the account would keep getting invoiced and its
     * vip_expiration would never be enforced. Callers that own the status pass true.
     *
     * The RADIUS side is identical either way: the user is moved into their plan group.
     */
    public function reconnectUser(array $params): array
    {
        try {
            $accountNo = $params['accountNumber'] ?? '';
            $username = $params['username'] ?? '';
            $rawPlan = $params['plan'] ?? '';
            $updatedBy = $params['updatedBy'] ?? 'System';
            $preserveBillingStatus = (bool) ($params['preserveBillingStatus'] ?? false);

            $this->writeLog("=== RECONNECT USER START ===");
            $this->writeLog("Account: $accountNo | Username: $username | Raw Plan: $rawPlan");
            if ($preserveBillingStatus) {
                $this->writeLog("[MODE] preserveBillingStatus — RADIUS group only, billing status left as committed by caller");
            }

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
                    // null = do not touch billing_status_id; see preserveBillingStatus above.
                    $preserveBillingStatus ? null : 'Active',
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
                $updatedBy,
                $newPassword
            );

            // Step 2: Update RADIUS credentials
            $radiusSuccess = $this->updateRadiusCredentials(
                $radiusEndpoints,
                $oldUsername,
                $newUsername,
                $newPassword
            );

            if (!$radiusSuccess) {
                // DB username was already updated, but RADIUS could not be reached/updated.
                // Report failure so the caller queues the RADIUS rename for automatic retry.
                $this->writeLog("[WARNING] Database was updated, but RADIUS update failed. Will be queued for retry.");
                throw new Exception("Failed to connect to RADIUS server or update credentials for user '{$oldUsername}'");
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

            // Step 2: Patch user to set disabled=yes on the server where it was found
            $targetUrl = $endpoint['url'] . "/rest/user-manage/user/" . $located['id'];
            $result = $this->callApiWithRetry($targetUrl, 'PATCH', ['disabled' => 'true'], $endpoint['username'], $endpoint['password']);
            if ($result === false) {
                throw new Exception("Failed to update disabled status in RADIUS");
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

            // Step 2: Patch user to set disabled=no on the server where it was found
            $targetUrl = $endpoint['url'] . "/rest/user-manage/user/" . $located['id'];
            $result = $this->callApiWithRetry($targetUrl, 'PATCH', ['disabled' => 'false'], $endpoint['username'], $endpoint['password']);
            if ($result === false) {
                throw new Exception("Failed to update disabled status in RADIUS");
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
    public function updateRadiusCredentials(array $radiusEndpoints, string $oldUsername, string $newUsername, ?string $newPassword = null): bool
    {
        $this->writeLog("[CREDENTIALS] Attempting RADIUS update: '$oldUsername' -> '$newUsername'");

        $totalSuccessCount = 0;

        foreach ($radiusEndpoints as $index => $endpoint) {
            $serverName = "Server #" . ($index + 1) . " ({$endpoint['url']})";
            $this->writeLog("[CREDENTIALS] Processing $serverName");

            // 1. Find the user on THIS specific server to get the correct ID
            $userPath = "/rest/user-manage/user/" . urlencode($oldUsername);
            $findResult = $this->callApiWithRetry($endpoint['url'] . $userPath, 'GET', null, $endpoint['username'], $endpoint['password']);

            if (!$findResult || !isset($findResult['.id'])) {
                $this->writeLog("[CREDENTIALS] [SKIP] User '$oldUsername' not found on $serverName");
                continue;
            }

            $radiusId = $findResult['.id'];
            $targetUrl = $endpoint['url'] . "/rest/user-manage/user/" . $radiusId;

            // 2. DISABLE user temporarily to prevent instant auto-reconnect during rename
            $this->writeLog("[CREDENTIALS] Temporarily disabling user to clear sessions...");
            $this->callApiWithRetry($targetUrl, 'PATCH', ['disabled' => 'true'], $endpoint['username'], $endpoint['password']);

            // 3. KILL active sessions for the OLD username
            $sessPath = "/rest/user-manage/session?user=" . urlencode($oldUsername);
            $sessions = $this->callApiWithRetry($endpoint['url'] . $sessPath, 'GET', null, $endpoint['username'], $endpoint['password']);
            
            if ($sessions && is_array($sessions)) {
                foreach ($sessions as $session) {
                    if (isset($session['.id'])) {
                        $this->callApiWithRetry($endpoint['url'] . "/rest/user-manage/session/" . $session['.id'], 'DELETE', null, $endpoint['username'], $endpoint['password']);
                    }
                }
            }
            
            // Small pause for RADIUS to stabilize
            sleep(1);

            // 4. UPDATE credentials (Rename)
            $payload = ['name' => $newUsername];
            if (!empty($newPassword)) {
                $payload['password'] = $newPassword;
            }

            $this->writeLog("[CREDENTIALS] Applying rename in RADIUS...");
            $patchResult = $this->callApiWithRetry($targetUrl, 'PATCH', $payload, $endpoint['username'], $endpoint['password']);

            // 5. RE-ENABLE the user
            $this->writeLog("[CREDENTIALS] Re-enabling user...");
            $this->callApiWithRetry($targetUrl, 'PATCH', ['disabled' => 'false'], $endpoint['username'], $endpoint['password']);

            if ($patchResult !== false) {
                $this->writeLog("[CREDENTIALS] [SUCCESS] Updated credentials on $serverName");
                $totalSuccessCount++;
            }
        }

        return $totalSuccessCount > 0;
    }

    /**
     * Update database credentials (username and optional password)
     */
    private function updateDatabaseCredentials(string $accountNo, string $oldUsername, string $newUsername, string $updatedBy, ?string $newPassword = null): void
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
                $joUpdate = [
                    'pppoe_username' => $newUsername,
                    'username' => $newUsername,
                    'updated_at' => now()
                ];
                if (!empty($newPassword)) {
                    $joUpdate['pppoe_password'] = $newPassword;
                }

                $joUpdated = DB::table('job_orders')
                    ->where('account_id', $accountId)
                    ->update($joUpdate);
                
                $this->writeLog("[DB] Synced job_orders username, pppoe_username & password for Account ID: $accountId ($joUpdated rows affected)");
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
        $userPath = "/rest/user-manage/user/" . urlencode($username);

        foreach ($radiusEndpoints as $index => $endpoint) {
            $serverName = "Server #" . ($index + 1) . " ({$endpoint['url']})";
            $this->writeLog("[LOOKUP] Searching for '$username' on $serverName");

            try {
                $result = $this->callApiWithRetry(
                    $endpoint['url'] . $userPath,
                    'GET',
                    null,
                    $endpoint['username'],
                    $endpoint['password']
                );
            } catch (Throwable $e) {
                // A failure on this server must not stop us from checking the others.
                $this->writeLog("[LOOKUP] Error querying $serverName: " . $e->getMessage() . " — continuing to next server");
                continue;
            }

            if ($result && isset($result['.id'])) {
                $currentGroup = $result['group'] ?? '';
                $this->writeLog("[LOOKUP] Found '$username' on $serverName (ID: {$result['.id']} | Group: '$currentGroup')");
                return [
                    'id' => $result['.id'],
                    'group' => $currentGroup,
                    'endpoint' => $endpoint,
                ];
            }

            $this->writeLog("[LOOKUP] '$username' not found on $serverName — trying next");
        }

        $this->writeLog("[LOOKUP] '$username' not found on any RADIUS server");
        return null;
    }

    /**
     * The group a username currently sits in on the live RADIUS servers.
     *
     * A read-only window onto findRadiusUser() for callers that need to know the
     * network's actual state before deciding to change it — the restricted-status
     * enforcement command in particular, which must not issue a restrict for a
     * user already restricted, and must not act at all on a user it could not
     * confirm.
     *
     * Null means "no server could tell us", which covers both a missing user and
     * an unreachable fleet. The two are deliberately not distinguished here
     * because the correct response to either is the same: do nothing and report
     * it. A caller that treated "not found" as "no group, restrict it" would turn
     * a RADIUS outage into a mass disconnection.
     */
    public function findUserGroup(string $username): ?string
    {
        if (trim($username) === '') {
            return null;
        }

        $located = $this->findRadiusUser($this->getRadiusEndpoints(), $username);

        return $located === null ? null : (string) ($located['group'] ?? '');
    }

    /**
     * Core RADIUS operations (disconnect/reconnect)
     *
     * $dbStatus is the billing_status name to write once the RADIUS side is done, or NULL to
     * leave billing_status_id alone because the caller already owns it. See
     * {@see reconnectUser()}'s preserveBillingStatus param for the case that needs NULL.
     */
    private function radiusOps(
        array $radiusEndpoints,
        string $username,
        string $targetGroup,
        ?string $dbStatus,
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
                $targetUrl = $endpoint['url'] . "/rest/user-manage/user/" . $radiusId;
                $result = $this->callApiWithRetry(
                    $targetUrl,
                    'PATCH',
                    ['group' => $targetGroup],
                    $endpoint['username'],
                    $endpoint['password']
                );

                if ($result !== false) {
                    $this->writeLog("[PATCH] Success at {$endpoint['url']}");
                    $patchHappened = true;
                } else {
                    $this->writeLog("[PATCH] Failed at {$endpoint['url']}");
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
        // Unless the caller owns the billing status (NULL), in which case writing one here would
        // overwrite a status that was just committed deliberately — e.g. stripping VIP (id 7)
        // back to Active on a VIP reconnect.
        if ($dbStatus !== null) {
            $this->updateDatabaseStatus($accountNo, $username, $dbStatus, $updatedBy);
        } else {
            $this->writeLog("[DB] Billing status left untouched — owned by caller");
        }

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
        $sessPath = "/rest/user-manage/session?user=" . urlencode($username);
        $sessions = null;
        $activeEndpoint = null;

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
                $activeEndpoint = $endpoint;
                $this->writeLog("[SESSION] Found " . count($sessions) . " active session(s) on {$endpoint['url']}");
                break;
            }
        }

        if (!$sessions || empty($sessions)) {
            $this->writeLog("[SESSION] No active session found");
            return;
        }

        // Kill sessions - FAILOVER LOGIC: only kill on the server where we found the session
        foreach ($sessions as $session) {
            if (isset($session['.id'])) {
                $sessionId = $session['.id'];
                
                if ($useFailover && $activeEndpoint) {
                    // Only kill on the active endpoint
                    $delUrl = $activeEndpoint['url'] . "/rest/user-manage/session/" . $sessionId;
                    $result = $this->callApiWithRetry(
                        $delUrl,
                        'DELETE',
                        null,
                        $activeEndpoint['username'],
                        $activeEndpoint['password']
                    );
                    if ($result !== false) {
                        $this->writeLog("[KILL] Terminated session ID $sessionId on {$activeEndpoint['url']}");
                    }
                } else {
                    // Legacy: Kill on all endpoints
                    foreach ($radiusEndpoints as $endpoint) {
                        $delUrl = $endpoint['url'] . "/rest/user-manage/session/" . $sessionId;
                        $this->callApiWithRetry(
                            $delUrl,
                            'DELETE',
                            null,
                            $endpoint['username'],
                            $endpoint['password']
                        );
                        $this->writeLog("[KILL] Terminated session ID $sessionId on {$endpoint['url']}");
                    }
                }
            }
        }
    }

    /**
     * Get RADIUS endpoint configurations
     */
    private function getRadiusEndpoints(): array
    {
        $radiusConfigs = DB::table('radius_config')
            ->orderBy('id')
            ->get();

        if ($radiusConfigs->isEmpty()) {
            throw new Exception("No RADIUS configurations found");
        }

        $endpoints = [];
        foreach ($radiusConfigs as $config) {
            $endpoints[] = [
                'url' => "{$config->ssl_type}://{$config->ip}:{$config->port}",
                'username' => $config->username,
                'password' => $config->password
            ];
        }

        return $endpoints;
    }

    /**
     * Lightweight connectivity + authentication probe against the configured RADIUS servers.
     *
     * Returns true as soon as ANY configured server answers an authenticated request
     * (this mirrors the failover used by the disconnect/restrict operations, which try
     * every server). Returns false when no server can be reached for a connection-related
     * reason — connection timeout, network error, or authentication failure (HTTP 401/403) —
     * so callers can queue the operation for later retry instead of aborting.
     *
     * Any HTTP response that is not an auth failure (including a 404 for the throwaway probe
     * username) proves the server is up and the credentials are valid, so it counts as reachable.
     */
    public function isRadiusReachable(): bool
    {
        try {
            $radiusEndpoints = $this->getRadiusEndpoints();
        } catch (Throwable $e) {
            $this->writeLog("[PING] Unable to load RADIUS endpoints: " . $e->getMessage());
            return false;
        }

        // Harmless read-only lookup of a username that will never exist; a live server
        // returns 404/empty, an unreachable one throws, and bad credentials return 401/403.
        $probePath = "/rest/user-manage/user/__gowiser_healthcheck__";

        foreach ($radiusEndpoints as $index => $endpoint) {
            // Try the configured protocol first, then the alternate (same strategy as callApiWithRetry).
            $urlsToTry = [$endpoint['url']];
            if (str_starts_with($endpoint['url'], 'https://')) {
                $urlsToTry[] = str_replace('https://', 'http://', $endpoint['url']);
            } elseif (str_starts_with($endpoint['url'], 'http://')) {
                $urlsToTry[] = str_replace('http://', 'https://', $endpoint['url']);
            }

            foreach ($urlsToTry as $baseUrl) {
                try {
                    $response = Http::withBasicAuth($endpoint['username'], $endpoint['password'])
                        ->connectTimeout(2)
                        ->timeout(4)
                        ->withOptions(['verify' => false])
                        ->get($baseUrl . $probePath);

                    $status = $response->status();

                    // Rejected credentials => treat as NOT reachable so the operation is queued.
                    if ($status === 401 || $status === 403) {
                        $this->writeLog("[PING] Authentication failure (HTTP {$status}) at {$baseUrl}");
                        continue;
                    }

                    $this->writeLog("[PING] RADIUS reachable at {$baseUrl} (HTTP {$status})");
                    return true;
                } catch (Throwable $e) {
                    $this->writeLog("[PING] Connection error at {$baseUrl}: " . $e->getMessage());
                }
            }
        }

        $this->writeLog("[PING] No RADIUS server reachable on any configured endpoint/protocol.");
        return false;
    }

    /**
     * Call API with retry logic
     * Tries both HTTPS and HTTP protocols per URL (same strategy as RadiusStatusSyncService)
     */
    private function callApiWithRetry(
        string $url,
        string $method,
        ?array $payload,
        string $username,
        string $password,
        int $retries = 1
    ) {
        // Build list of URLs to try: configured protocol first, then alternate
        // This mirrors RadiusStatusSyncService which tries both protocols per config
        $urlsToTry = [$url];
        if (str_starts_with($url, 'https://')) {
            $urlsToTry[] = str_replace('https://', 'http://', $url);
        } elseif (str_starts_with($url, 'http://') && !str_starts_with($url, 'https://')) {
            $urlsToTry[] = str_replace('http://', 'https://', $url);
        }

        foreach ($urlsToTry as $tryUrl) {
            for ($attempt = 1; $attempt <= $retries; $attempt++) {
                try {
                    $this->writeLog("[API] Attempt $attempt/$retries: $method $tryUrl");

                    $response = Http::withBasicAuth($username, $password)
                        ->connectTimeout(2)
                        ->timeout(4)
                        ->withOptions(['verify' => false]);

                    switch (strtoupper($method)) {
                        case 'GET':
                            $response = $response->get($tryUrl);
                            break;
                        case 'POST':
                            $response = $response->post($tryUrl, $payload);
                            break;
                        case 'PATCH':
                            $response = $response->patch($tryUrl, $payload);
                            break;
                        case 'DELETE':
                            $response = $response->delete($tryUrl);
                            break;
                        default:
                            return false;
                    }

                    if ($response->successful()) {
                        $data = $response->json();
                        return $data;
                    } else {
                        $this->writeLog("[API] HTTP Error {$response->status()}: " . $response->body());
                    }

                } catch (Exception $e) {
                    $this->writeLog("[API] Exception on attempt $attempt: " . $e->getMessage());

                    if ($attempt < $retries) {
                        sleep(1);
                    }
                }
            }
        }

        $this->writeLog("[API] Request failed after trying all protocols and attempts.");
        return false;
    }

    /**
     * Write to log file
     */
    private function writeLog(string $message): void
    {
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
        Log::channel('single')->info("[{$this->logName}] {$message}");
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
            
            $deleteCount = 0;
            foreach ($radiusEndpoints as $endpoint) {
                // Construct path using username directly as requested
                $targetPath = "/rest/user-manage/user/" . urlencode($username);
                $targetUrl = $endpoint['url'] . $targetPath;
                
                $this->writeLog("[DELETE] Calling endpoint: $targetUrl");

                $delResult = $this->callApiWithRetry(
                    $targetUrl,
                    'DELETE',
                    null, // No payload for delete request
                    $endpoint['username'],
                    $endpoint['password']
                );
                
                if ($delResult !== false) {
                    $this->writeLog("[DELETE] Successfully deleted user '$username' from {$endpoint['url']}");
                    $deleteCount++;
                } else {
                    $this->writeLog("[DELETE] Failed to delete user '$username' from {$endpoint['url']} (or user already deleted)");
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






