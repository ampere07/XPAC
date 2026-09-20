<?php
/**
 * RADIUS Status Sync Worker (Standalone)
 * 
 * Syncs RADIUS user status and session data to the online_status table
 * Based on billing_accounts and technical_details tables
 * 
 * Usage: php radius-status-sync.php
 */

require_once __DIR__ . '/vendor/autoload.php';

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$logFile = storage_path('logs/radiussync/radiussync_standalone.log');
$logDir = dirname($logFile);
if (!file_exists($logDir)) {
    mkdir($logDir, 0755, true);
}

function writeLog($message) {
    global $logFile;
    $timestamp = date('Y-m-d H:i:s');
    $logMessage = "[$timestamp] $message" . PHP_EOL;
    file_put_contents($logFile, $logMessage, FILE_APPEND);
    echo $logMessage;
}

writeLog("=== STARTING RADIUS STATUS SYNC ===");

try {
    set_time_limit(300);

    // Step 1: Get RADIUS Configuration
    writeLog("Step 1: Fetching RADIUS configuration...");
    $radiusConfig = DB::table('radius_config')->first();
    
    if (!$radiusConfig) {
        throw new Exception('RADIUS configuration not found in database');
    }
    
    $baseUrl = sprintf(
        '%s://%s:%s',
        $radiusConfig->ssl_type,
        $radiusConfig->ip,
        $radiusConfig->port
    );
    
    writeLog("RADIUS Server: $baseUrl");

    // Step 2: Sync accounts to online_status table
    writeLog("Step 2: Syncing billing accounts to online_status...");
    $inserted = DB::statement("
        INSERT IGNORE INTO online_status (account_id, account_no, username, created_at, updated_at)
        SELECT ba.id, ba.account_no, td.username, NOW(), NOW()
        FROM billing_accounts ba
        LEFT JOIN technical_details td ON ba.id = td.account_id
        WHERE td.username IS NOT NULL
    ");
    
    $insertedCount = DB::select("SELECT ROW_COUNT() as count")[0]->count ?? 0;
    writeLog("Inserted new accounts: $insertedCount");

    // Step 3: Fetch RADIUS Users
    writeLog("Step 3: Fetching RADIUS users...");
    $radiusUsers = [];
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => "$baseUrl/rest/user-manage/user",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $radiusConfig->username . ':' . $radiusConfig->password,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_TIMEOUT => 10
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200) {
        $users = json_decode($response, true);
        if (is_array($users)) {
            foreach ($users as $user) {
                $username = $user['name'] ?? null;
                if ($username) {
                    $radiusUsers[$username] = [
                        'id' => $user['.id'] ?? '',
                        'group' => $user['group'] ?? '',
                        'disabled' => ($user['disabled'] ?? 'false') === 'true'
                    ];
                }
            }
        }
        writeLog("Fetched RADIUS users: " . count($radiusUsers));
    } else {
        writeLog("WARNING: Failed to fetch RADIUS users (HTTP $httpCode)");
    }

    // Step 4: Fetch RADIUS Sessions
    writeLog("Step 4: Fetching RADIUS sessions...");
    $radiusSessions = [];
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => "$baseUrl/rest/user-manage/session",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $radiusConfig->username . ':' . $radiusConfig->password,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_TIMEOUT => 10
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200) {
        $sessions = json_decode($response, true);
        if (is_array($sessions)) {
            foreach ($sessions as $session) {
                $username = $session['user'] ?? null;
                if ($username) {
                    $radiusSessions[$username] = [
                        'session_id' => $session['.id'] ?? '',
                        'ip' => $session['user-address'] ?? '',
                        'mac' => $session['calling-station-id'] ?? '',
                        'upload' => $session['upload'] ?? 0,
                        'download' => $session['download'] ?? 0
                    ];
                }
            }
        }
        writeLog("Fetched RADIUS sessions: " . count($radiusSessions));
    } else {
        writeLog("WARNING: Failed to fetch RADIUS sessions (HTTP $httpCode)");
    }

    // Step 5: Process accounts and update online_status
    writeLog("Step 5: Processing accounts and updating status...");
    
    $accounts = DB::table('billing_accounts as ba')
        ->leftJoin('technical_details as td', 'ba.id', '=', 'td.account_id')
        ->select('ba.id as account_id', 'ba.account_no', 'td.username')
        ->whereNotNull('td.username')
        ->get();
    
    writeLog("Processing " . count($accounts) . " accounts...");
    
    $stats = [
        'updated' => 0,
        'online' => 0,
        'offline' => 0,
        'restricted' => 0,
        'disconnected' => 0,
        'not_found' => 0,
        'errors' => 0
    ];
    
    DB::beginTransaction();
    
    foreach ($accounts as $account) {
        try {
            $username = trim($account->username);
            $accountNo = $account->account_no;
            
            $status = 'Offline';
            $group = null;
            $sessionId = null;
            $ip = null;
            $mac = null;
            $download = null;
            $upload = null;
            
            if (isset($radiusUsers[$username])) {
                $user = $radiusUsers[$username];
                $group = $user['group'];
                $hasSession = isset($radiusSessions[$username]);
                
                if ($group === 'Disconnected' || $group === 'Mikrotik-Group:Disconnected') {
                    if ($hasSession) {
                        $status = 'Disconnected';
                        $stats['disconnected']++;
                    } else {
                        $status = 'Restricted';
                        $stats['restricted']++;
                    }
                } else {
                    if ($hasSession) {
                        $status = 'Online';
                        $stats['online']++;
                    } else {
                        $status = 'Offline';
                        $stats['offline']++;
                    }
                }
                
                if ($hasSession) {
                    $session = $radiusSessions[$username];
                    $sessionId = $session['session_id'];
                    $ip = $session['ip'];
                    $mac = $session['mac'];
                    $download = $session['download'];
                    $upload = $session['upload'];
                }
            } else {
                $status = 'Not Found';
                $stats['not_found']++;
            }
            
            DB::table('online_status')
                ->updateOrInsert(
                    ['account_no' => $accountNo],
                    [
                        'account_id' => $account->account_id,
                        'username' => $username,
                        'session_status' => $status,
                        'session_group' => $group,
                        'session_id' => $sessionId,
                        'ip_address' => $ip,
                        'session_mac_address' => $mac,
                        'total_download' => $download,
                        'total_upload' => $upload,
                        'updated_at' => now(),
                        'updated_by_user' => 'system'
                    ]
                );
            
            $stats['updated']++;
            
        } catch (Exception $e) {
            $stats['errors']++;
            writeLog("ERROR processing account $accountNo: " . $e->getMessage());
        }
    }
    
    DB::commit();
    
    writeLog("=== SYNC COMPLETE ===");
    writeLog("Updated: {$stats['updated']}");
    writeLog("Online: {$stats['online']}");
    writeLog("Offline: {$stats['offline']}");
    writeLog("Restricted: {$stats['restricted']}");
    writeLog("Disconnected: {$stats['disconnected']}");
    writeLog("Not Found: {$stats['not_found']}");
    writeLog("Errors: {$stats['errors']}");
    
    echo "\nSync Complete. Check log: $logFile\n";
    
} catch (Exception $e) {
    if (DB::transactionLevel() > 0) {
        DB::rollBack();
    }
    writeLog("CRITICAL ERROR: " . $e->getMessage());
    writeLog("Stack trace: " . $e->getTraceAsString());
    echo "\nError: " . $e->getMessage() . "\n";
    exit(1);
}
