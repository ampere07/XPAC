<?php

namespace App\Services;

use App\Models\OnlineStatus;
use App\Models\BillingAccount;
use App\Models\TechnicalDetail;
use App\Models\RadiusConfig;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class RadiusStatusSyncService
{
    private const MAX_RETRIES = 3;
    private const RETRY_DELAY = 2;

    public function syncRadiusStatus(): array
    {
        $stats = [
            'synced' => 0,
            'inserted' => 0,
            'updated' => 0,
            'skipped' => 0,
            'not_found' => 0,
            'offline' => 0,
            'online' => 0,
            'restricted' => 0,
            'disconnected' => 0,
            'errors' => 0,
            'radius_users_per_config' => [],
            'radius_sessions_per_config' => [],
            'duplicate_records' => 0,
            'unique_records' => 0,
        ];

        try {
            // Step 1: Sync billing accounts to online_status quickly (outside of a long transaction)
            $this->syncAccountsToOnlineStatus($stats);

            // Ordered by id so the labels "Radius Config 1", "Radius Config 2", ... are stable.
            $radiusConfigs = RadiusConfig::orderBy('id')->get();
            if ($radiusConfigs->isEmpty()) {
                throw new \Exception('RADIUS configuration not found');
            }

            // Step 2: Fetch from EVERY radius config, merged and de-duplicated by username.
            // Each server is queried independently — one being down does not stop the others.
            $usersReport    = $this->fetchRadiusUsers($radiusConfigs);
            $sessionsReport = $this->fetchRadiusSessions($radiusConfigs);

            $radiusUsers    = $usersReport['users'];
            $radiusSessions = $sessionsReport['sessions'];

            // Surface per-source + de-duplication metrics.
            $stats['radius_users_per_config']    = $usersReport['per_config'];
            $stats['radius_sessions_per_config'] = $sessionsReport['per_config'];
            $stats['duplicate_records']          = $usersReport['duplicates'];
            $stats['unique_records']             = $usersReport['unique'];

            foreach ($usersReport['per_config'] as $label => $count) {
                Log::info("[STATUS SYNC] {$label}: {$count} user record(s) retrieved");
            }
            Log::info('[STATUS SYNC] Duplicate users across servers: ' . $usersReport['duplicates']);
            Log::info('[STATUS SYNC] Unique users to process: ' . $usersReport['unique']);

            // Guard: if EVERY server was unreachable for users, abort instead of wrongly
            // flagging every account as "Not Found"/offline from an empty dataset.
            if ($usersReport['reachable'] === 0) {
                throw new \RuntimeException('All RADIUS servers were unreachable for user data; aborting to avoid mass status changes.');
            }

            // Anti-timeout: ensure DB connection is alive after API calls
            try {
                DB::connection()->getPdo()->query('SELECT 1');
            } catch (\Throwable $e) {
                Log::warning('DB connection lost before processing accounts, attempting reconnect', [
                    'error' => $e->getMessage(),
                ]);
                $default = config('database.default');
                DB::purge($default);
                DB::reconnect($default);
            }

            // Step 3: Process and update DB within a short transaction
            DB::beginTransaction();

            $this->processAccounts($radiusUsers, $radiusSessions, $stats);

            // Update the radius config timestamp to reflect last sync
            if ($radiusConfigs->first()) {
                $radiusConfigs->first()->touch();
            }

            DB::commit();

            Log::info('[STATUS SYNC] Complete', [
                'unique_records' => $stats['unique_records'],
                'duplicates'     => $stats['duplicate_records'],
                'inserted'       => $stats['inserted'],
                'updated'        => $stats['updated'],
                'skipped'        => $stats['skipped'],
                'errors'         => $stats['errors'],
            ]);

            return $stats;

        } catch (\Exception $e) {
            if (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
            Log::error('RADIUS Status Sync Failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            \Log::channel('radiusrelated')->error('[STATUS SYNC CRITICAL] Global failure: ' . $e->getMessage());
            throw $e;
        }
    }

    private function syncAccountsToOnlineStatus(array &$stats): void
    {
        $inserted = DB::statement("
            INSERT IGNORE INTO online_status (account_id, account_no, username, created_at, updated_at)
            SELECT ba.id, ba.account_no, td.username, NOW(), NOW()
            FROM billing_accounts ba
            LEFT JOIN technical_details td ON ba.id = td.account_id
            WHERE td.username IS NOT NULL AND TRIM(td.username) != ''
        ");

        if ($inserted) {
            $insertedCount = DB::select("SELECT ROW_COUNT() as count")[0]->count ?? 0;
            $stats['inserted'] = $insertedCount;
            Log::info('Synced new accounts to online_status', ['count' => $insertedCount]);
        }
    }

    /**
     * Fetch users from EVERY radius config, merge them, and de-duplicate by username
     * (the unique identifier). Each server is queried independently; a failure on one
     * server is logged and skipped so the remaining server(s) still contribute.
     *
     * @return array{users: array, per_config: array<string,int>, duplicates: int, unique: int, reachable: int}
     */
    private function fetchRadiusUsers($radiusConfigs): array
    {
        $merged     = [];
        $perConfig  = [];
        $duplicates = 0;
        $reachable  = 0;

        foreach ($radiusConfigs as $index => $config) {
            $label = 'Radius Config ' . ($index + 1);
            $response = $this->callRadiusApiForConfig($config, '/rest/user-manage/user', 'GET');

            if ($response === null || !is_array($response)) {
                $perConfig[$label] = 0;
                \Log::channel('radiusrelated')->warning("[STATUS SYNC] {$label} ({$config->ip}) unreachable for users; continuing with remaining server(s).");
                continue;
            }

            $reachable++;
            $count = 0;

            foreach ($response as $user) {
                $username = $user['name'] ?? null;
                if (!$username) {
                    continue;
                }
                $count++;

                // De-dup by username: if the same account exists on more than one
                // server, keep the first seen and only tally the duplicate. This
                // guarantees a single insert/update per account downstream.
                if (isset($merged[$username])) {
                    $duplicates++;
                    continue;
                }

                $merged[$username] = [
                    'id'       => $user['.id'] ?? '',
                    'group'    => $user['group'] ?? '',
                    'disabled' => ($user['disabled'] ?? 'false') === 'true',
                    'source'   => $label,
                ];
            }

            $perConfig[$label] = $count;
            Log::info("[STATUS SYNC] Fetched RADIUS users from {$label}", ['count' => $count]);
        }

        return [
            'users'      => $merged,
            'per_config' => $perConfig,
            'duplicates' => $duplicates,
            'unique'     => count($merged),
            'reachable'  => $reachable,
        ];
    }

    /**
     * Fetch sessions from EVERY radius config and merge by username. If a user somehow
     * has active sessions on more than one server, the active counts are summed and the
     * most recently seen session details are kept. Per-server failures are isolated.
     *
     * @return array{sessions: array, per_config: array<string,int>, reachable: int}
     */
    private function fetchRadiusSessions($radiusConfigs): array
    {
        $sessions  = [];
        $perConfig = [];
        $reachable = 0;

        foreach ($radiusConfigs as $index => $config) {
            $label = 'Radius Config ' . ($index + 1);
            $response = $this->callRadiusApiForConfig($config, '/rest/user-manage/session', 'GET');

            if ($response === null || !is_array($response)) {
                $perConfig[$label] = 0;
                \Log::channel('radiusrelated')->warning("[STATUS SYNC] {$label} ({$config->ip}) unreachable for sessions; continuing with remaining server(s).");
                continue;
            }

            $reachable++;
            $count = 0;

            foreach ($response as $session) {
                $username = $session['user'] ?? null;
                if (!$username) {
                    continue;
                }
                $count++;

                if (!isset($sessions[$username])) {
                    $sessions[$username] = [
                        'active_count' => 0,
                        'last_session' => null,
                    ];
                }

                $sessions[$username]['active_count']++;
                $sessions[$username]['last_session'] = [
                    'session_id' => $session['.id'] ?? '',
                    'ip'         => $session['user-address'] ?? '',
                    'mac'        => $session['calling-station-id'] ?? '',
                    'upload'     => $session['upload'] ?? 0,
                    'download'   => $session['download'] ?? 0,
                ];
            }

            $perConfig[$label] = $count;
            Log::info("[STATUS SYNC] Fetched RADIUS sessions from {$label}", ['count' => $count]);
        }

        return [
            'sessions'   => $sessions,
            'per_config' => $perConfig,
            'reachable'  => $reachable,
        ];
    }

    private function processAccounts(array $radiusUsers, array $radiusSessions, array &$stats): void
    {
        $accounts = DB::table('billing_accounts as ba')
            ->leftJoin('technical_details as td', 'ba.id', '=', 'td.account_id')
            ->select('ba.id as account_id', 'ba.account_no', 'td.username')
            ->whereNotNull('td.username')
            ->whereRaw("TRIM(td.username) <> ''")
            ->get();

        Log::info('Processing accounts for RADIUS sync', ['count' => count($accounts)]);

        foreach ($accounts as $account) {
            try {
                $username = trim($account->username ?? '');
                if ($username === '') {
                    // Skip records with empty usernames
                    $stats['skipped']++;
                    continue;
                }
                $accountNo = $account->account_no;

                $status = 'Offline';
                $group = null;
                $sessionId = null;
                $ip = null;
                $mac = null;
                $download = null;
                $mac = null;
                $download = null;
                $upload = null;
                $activeSessions = 0;

                if (isset($radiusUsers[$username])) {
                    $user = $radiusUsers[$username];
                    $group = $user['group'];
                    $hasSession = isset($radiusSessions[$username]);

                    // NEW ALGO
                    $isRestricted = ($group === 'Restricted' || $group === 'Mikrotik-Group:Restricted');
                    $isDisconnected = ($group === 'Disconnected' || $group === 'Mikrotik-Group:Disconnected');

                    if ($isRestricted) {
                        $status = 'Restricted';
                        $stats['restricted']++;
                    } elseif ($isDisconnected) {
                        $status = 'Disconnected';
                        $stats['disconnected']++;
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
                        $sessionInfo = $radiusSessions[$username];
                        $activeSessions = $sessionInfo['active_count'];
                        $session = $sessionInfo['last_session'];
                        
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
                        ['account_id' => $account->account_id],
                        [
                            'account_no' => $accountNo,
                            'username' => $username,
                            'session_status' => $status,
                            'session_group' => $group,
                            'session_id' => $sessionId,
                            'ip_address' => $ip,
                            'session_mac_address' => $mac,
                            'total_download' => $download,
                            'total_upload' => $upload,
                            'active_sessions' => $activeSessions,
                            'updated_at' => now(),
                            'updated_by_user' => 'system'
                        ]
                    );

                $stats['updated']++;

            } catch (\Exception $e) {
                $stats['errors']++;
                Log::error('Error processing account for RADIUS sync', [
                    'account_no' => $account->account_no ?? 'unknown',
                    'username' => $account->username ?? 'unknown',
                    'error' => $e->getMessage()
                ]);
                \Log::channel('radiusrelated')->error('[STATUS SYNC ACCOUNT ERROR] Account: ' . ($account->account_no ?? 'Unknown') . ' - Error: ' . $e->getMessage());
            }
        }

        $stats['synced'] = $stats['updated'];
    }

    /**
     * Call the RADIUS API for a SINGLE config, trying https then http with retries.
     * Returns the decoded array on success, or null if this server is unreachable —
     * the caller isolates the failure and continues with the other server(s).
     */
    private function callRadiusApiForConfig($config, string $path, string $method): ?array
    {
        $protocols = ['https', 'http'];

        foreach ($protocols as $protocol) {
            $url = sprintf('%s://%s:%s%s', $protocol, $config->ip, $config->port, $path);

            for ($attempt = 1; $attempt <= self::MAX_RETRIES; $attempt++) {
                try {
                    $response = Http::withBasicAuth($config->username, $config->password)
                        ->withOptions([
                            'verify' => false,
                            'timeout' => 5,
                        ])
                        ->$method($url);

                    if ($response->successful()) {
                        return $response->json();
                    }

                    Log::warning('RADIUS API request failed', [
                        'url' => $url,
                        'attempt' => $attempt,
                        'status' => $response->status(),
                        'body' => $response->body()
                    ]);

                } catch (\Exception $e) {
                    Log::warning('RADIUS API request exception', [
                        'url' => $url,
                        'attempt' => $attempt,
                        'error' => $e->getMessage()
                    ]);
                }

                if ($attempt < self::MAX_RETRIES) {
                    sleep(self::RETRY_DELAY);
                }
            }
        }

        \Log::channel('radiusrelated')->error(sprintf(
            '[STATUS SYNC API FAILED] Config #%s (%s) unreachable for path %s after all protocols/retries.',
            $config->id ?? '?',
            $config->ip ?? '?',
            $path
        ));

        return null;
    }
}


