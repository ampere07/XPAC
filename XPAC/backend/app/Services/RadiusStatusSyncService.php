<?php

namespace App\Services;

use App\Events\OnlineStatusBatchUpdated;
use App\Models\OnlineStatus;
use App\Models\BillingAccount;
use App\Models\TechnicalDetail;
use App\Models\RadiusConfig;
use App\Support\RadiusStatusSyncPolicy;
use App\Support\RadiusCircuitBreaker;
use App\Services\RouterosApiService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Mirrors RADIUS (User Manager) state into the online_status table.
 *
 * Shape of a run, and why it is split this way:
 *
 *  1. Seed  - every account that has a PPPoE username gets an online_status row
 *             (INSERT IGNORE), walked in id windows rather than as one statement
 *             over the whole table.
 *  2. Fetch - users and sessions are read from each RADIUS server in BULK: two
 *             requests per server, whatever the size of the estate. This part is
 *             deliberately not batched. RouterOS answers one list request far
 *             more cheaply than it answers thousands of per-user lookups, and
 *             per-account requests are what actually floods a RADIUS box.
 *  3. Apply - the local database work IS batched. Accounts are walked in batches
 *             of RadiusStatusSyncPolicy::batchSize(); each batch is read,
 *             compared and committed before the next one is read.
 *
 * The batching in step 3 is what keeps a large estate safe: peak memory stays
 * flat, no transaction spans the run, a failure costs one batch instead of the
 * whole sync, and work already committed is never thrown away. The sync is
 * idempotent - status is derived from the fetched maps, never from what is
 * already stored - so anything one run misses the next run re-derives.
 */
class RadiusStatusSyncService
{
    private const MAX_RETRIES = 3;
    private const RETRY_DELAY = 2;

    /**
     * A connection failure is not worth three tries. Nothing answered, so each
     * attempt costs a full timeout and the next one will cost the same; one retry
     * covers a dropped packet, after that the server is down.
     */
    private const MAX_CONNECTION_ATTEMPTS = 2;

    /**
     * Only the fields this sync actually reads.
     *
     * Asking User Manager for whole records makes it serialise every attribute of
     * every subscriber - the expensive part of this job on a RouterOS box, and the
     * reason a sync can leave it too busy to accept new connections. `.proplist`
     * cuts the response to these columns. A build that does not understand it
     * rejects the request, and callRadiusApiForConfig() then drops the parameter
     * and asks for the full record set instead.
     *
     * USER_PROPS is down to the two fields the status logic actually consumes.
     * It used to ask for `.id` and `disabled` as well, which nothing ever read:
     * RouterOS serialised them, the network carried them, and the merged map held
     * them for the length of the run, all for nothing.
     */
    private const USER_PROPS    = 'name,group';
    private const SESSION_PROPS = '.id,user,user-address,calling-station-id,upload,download';

    /**
     * Where the reusable user list lives. One fixed key, with the server set
     * recorded inside the entry, so any caller can drop it by name.
     */
    private const USER_CACHE_KEY = 'radius:status-sync:users';

    /**
     * Proof that a run is still working, refreshed as it goes.
     *
     * The command holds a cache lock so two syncs cannot run at once, but a lock
     * has a TTL and a run that outlives it releases its claim without knowing:
     * the next invocation then acquires the lock and starts a second sync
     * alongside the first. The TTL cannot simply be raised to cover that, because
     * the same TTL is what frees the lock after a run is killed — a long one and
     * a dead one look identical from the outside.
     *
     * This is what tells them apart. A working run stamps the key at every step
     * that takes any time, so it stays fresh for as long as the run is genuinely
     * doing something and goes stale within a minute or two of the process dying.
     */
    private const HEARTBEAT_KEY = 'radius:status-sync:heartbeat';

    /**
     * How long after the last stamp a run is presumed dead rather than slow.
     *
     * Comfortably longer than the largest gap between two stamps. The widest one
     * is a single RADIUS request: a connect timeout plus a request timeout, both
     * configurable, and stamped again after every attempt.
     */
    public const HEARTBEAT_STALE_AFTER = 90;

    /** Mark the run as alive. Called at each step that takes measurable time. */
    public static function heartbeat(): void
    {
        // Held for twice the staleness window so the key outlives the judgement
        // that reads it — a heartbeat that expired from the cache and one that
        // was never written are indistinguishable, and both mean "not alive".
        Cache::put(self::HEARTBEAT_KEY, now()->timestamp, self::HEARTBEAT_STALE_AFTER * 2);
    }

    /** Is a sync still working, whatever the state of the lock? */
    public static function isRunAlive(): bool
    {
        $last = Cache::get(self::HEARTBEAT_KEY);

        return is_numeric($last)
            && (now()->timestamp - (int) $last) < self::HEARTBEAT_STALE_AFTER;
    }

    /** Called by the run that finishes, so the next one is not made to wait. */
    public static function clearHeartbeat(): void
    {
        Cache::forget(self::HEARTBEAT_KEY);
    }

    /**
     * The online_status columns this sync owns.
     *
     * A row is only rewritten when one of these differs from what the sync is
     * about to write (see rowNeedsUpdate()). updated_at is deliberately absent:
     * it changes on every run by definition, so including it would defeat the
     * comparison entirely.
     */
    private const SYNCED_COLUMNS = [
        'account_no',
        'username',
        'session_status',
        'session_group',
        'session_id',
        'ip_address',
        'session_mac_address',
        'total_download',
        'total_upload',
        'active_sessions',
        'updated_by_user',
    ];

    /**
     * The columns a watching operator is actually looking at.
     *
     * A run rewrites a row when any synced column moves — a counter ticking up is enough. Those are
     * not worth a WebSocket frame; a subscriber going from Online to Offline, or picking up a new
     * address, is. Narrowing the broadcast to these two is what keeps a quiet estate silent.
     */
    private const BROADCAST_COLUMNS = ['session_status', 'ip_address'];

    /** Accounts per broadcast frame. */
    private const BROADCAST_CHUNK = 250;

    /**
     * Above this many changed accounts, broadcast nothing.
     *
     * A change set this size is not subscribers coming and going — it is a seeding run, a RADIUS
     * server that just came back, or a mass regrade. Pushing it would put hundreds of frames
     * through Soketi and make every open tab re-render for minutes to deliver news the operator
     * cannot read anyway. The client refreshes anything older than a minute on its own, so the
     * screens converge regardless; only the live nudge is dropped.
     */
    private const BROADCAST_MAX = 2000;

    /**
     * Accounts whose broadcast columns moved during this run, keyed by account number so a batch
     * that is replayed after a failed transaction records each account once.
     *
     * @var array<string, array>
     */
    private array $changedStatuses = [];

    /**
     * @param  int|null  $batchSize  Accounts per batch for this run; null uses the configured size.
     */
    public function syncRadiusStatus(?int $batchSize = null, bool $refreshUsers = false): array
    {
        $batchSize = RadiusStatusSyncPolicy::batchSize($batchSize);

        // Cleared per run: the service is resolved from the container and one instance can be asked
        // to sync more than once, which would otherwise re-broadcast the previous run's changes.
        $this->changedStatuses = [];

        $stats = [
            'synced' => 0,
            'inserted' => 0,
            'updated' => 0,
            'unchanged' => 0,
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
'users_from_cache' => false,
            'duplicate_accounts' => 0,
            'batches' => 0,
            'batch_size' => $batchSize,
        ];

        try {
            self::heartbeat();

            // Step 1: Sync billing accounts to online_status quickly (outside of a long transaction)
            $this->syncAccountsToOnlineStatus($stats);
            self::heartbeat();

            // Ordered by id so the labels "Radius Config 1", "Radius Config 2", ... are stable.
            $radiusConfigs = RadiusConfig::orderBy('id')->get();
            if ($radiusConfigs->isEmpty()) {
                throw new \Exception('RADIUS configuration not found');
            }

            // Step 2: Fetch from EVERY radius config, merged and de-duplicated by username.
            // Each server is queried independently — one being down does not stop the others.
            $usersReport    = $this->fetchRadiusUsersCached($radiusConfigs, $refreshUsers);
            self::heartbeat();

            $sessionsReport = $this->fetchRadiusSessions($radiusConfigs);
            self::heartbeat();

            $radiusUsers    = $usersReport['users'];
            $radiusSessions = $sessionsReport['sessions'];

            // Surface per-source + de-duplication metrics.
            $stats['radius_users_per_config']    = $usersReport['per_config'];
            $stats['radius_sessions_per_config'] = $sessionsReport['per_config'];
            $stats['duplicate_records']          = $usersReport['duplicates'];
            $stats['unique_records']             = $usersReport['unique'];
            $stats['users_from_cache']           = (bool) ($usersReport['from_cache'] ?? false);

            foreach ($usersReport['per_config'] as $label => $count) {
                Log::info("[STATUS SYNC] {$label}: {$count} user record(s) retrieved");
            }
            Log::info('[STATUS SYNC] Duplicate users across servers: ' . $usersReport['duplicates']);
            Log::info('[STATUS SYNC] Unique users to process: ' . $usersReport['unique']);

            // Guard: if EVERY server was unreachable, abort instead of wrongly
            // flagging every account as "Not Found"/offline from an empty dataset.
            //
            // Which report carries that evidence depends on where the users came
            // from. A freshly fetched list is itself the probe: nobody answered it
            // means nobody is up. A CACHED list is not a probe at all — it records
            // the reachability of the run that wrote it, and only complete
            // snapshots are ever written, so it reports every server up no matter
            // what is happening now. Trusting it would let a run where every
            // server is dark sail past this guard on a stale "all reachable" and
            // mark the entire estate offline from an empty session sweep, which
            // is the exact outcome the guard exists to prevent.
            //
            // On a cached run the session sweep is the only live evidence there
            // is, so it is what decides.
            $usersFromCache = (bool) ($usersReport['from_cache'] ?? false);
            $reachableNow   = $usersFromCache
                ? $sessionsReport['reachable']
                : $usersReport['reachable'];

            if ($reachableNow === 0) {
                throw new \RuntimeException(sprintf(
                    'All RADIUS servers were unreachable for %s; aborting to avoid mass status changes.',
                    $usersFromCache ? 'sessions (user list served from cache)' : 'user data'
                ));
            }

            // Anti-timeout: the fetch phase can outlast the server's wait_timeout,
            // so make sure the connection is alive before the batches start writing.
            $this->ensureDatabaseConnection();

            // Step 3: Process and update the DB batch by batch. Each batch commits
            // on its own — there is no run-wide transaction, so a late failure
            // cannot roll back the work that already succeeded.
            $this->processAccounts($radiusUsers, $radiusSessions, $stats, $batchSize);

            // Update the radius config timestamp to reflect last sync
            if ($radiusConfigs->first()) {
                $radiusConfigs->first()->touch();
            }

            // After the batches, so a subscriber is only announced once its new status is
            // committed — a frame sent from inside the loop could arrive before the row it
            // describes, and a tab that then re-read the account would show the old value.
            $stats['broadcast'] = $this->broadcastStatusChanges();

            Log::info('[STATUS SYNC] Complete', [
                'unique_records' => $stats['unique_records'],
                'duplicates'     => $stats['duplicate_records'],
                'inserted'       => $stats['inserted'],
                'updated'        => $stats['updated'],
                'unchanged'      => $stats['unchanged'],
                'skipped'        => $stats['skipped'],
                'errors'         => $stats['errors'],
                'batches'        => $stats['batches'],
                'batch_size'     => $stats['batch_size'],
                'users_cached'   => $stats['users_from_cache'],
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

    /**
     * Give every account that has a PPPoE username an online_status row.
     *
     * Walked in id windows instead of one INSERT ... SELECT over the whole join:
     * on a first run, or after a bulk import, the single-statement form inserts
     * every account inside one transaction, holding locks on online_status and
     * writing one enormous binlog event. A window is a short statement that
     * commits on its own.
     */
    private function syncAccountsToOnlineStatus(array &$stats): void
    {
        $batchSize = RadiusStatusSyncPolicy::seedBatchSize();
        $lastId    = 0;
        $inserted  = 0;
        $windows   = 0;

        while (true) {
            // Take the id window first. INSERT IGNORE reports how many rows it
            // actually inserted — zero on a settled system — so it cannot tell us
            // whether there are more accounts left to walk.
            $window = DB::table('billing_accounts')
                ->where('id', '>', $lastId)
                ->orderBy('id')
                ->limit($batchSize)
                ->pluck('id');

            if ($window->isEmpty()) {
                break;
            }

            $windowStart = $lastId;
            $lastId      = (int) $window->last();
            $windows++;

            DB::statement("
                INSERT IGNORE INTO online_status (account_id, account_no, username, created_at, updated_at)
                SELECT ba.id, ba.account_no, td.username, NOW(), NOW()
                FROM billing_accounts ba
                LEFT JOIN technical_details td ON ba.id = td.account_id
                WHERE td.username IS NOT NULL AND TRIM(td.username) != ''
                  AND ba.id > ? AND ba.id <= ?
            ", [$windowStart, $lastId]);

            $inserted += (int) (DB::select("SELECT ROW_COUNT() as count")[0]->count ?? 0);
        }

        $stats['inserted'] = $inserted;

        if ($inserted > 0) {
            Log::info('Synced new accounts to online_status', [
                'count'   => $inserted,
                'windows' => $windows,
            ]);
        }
    }

    /**
     * The merged user list, from cache when it is still fresh enough.
     *
     * Of the two bulk requests this sync makes per server, the session list is
     * the one that has to be live — it is what changes from minute to minute.
     * The user list only says which group each subscriber is in, and on a settled
     * estate it comes back identical run after run, having made RouterOS
     * serialise its entire subscriber table to say nothing new.
     *
     * With radius.status_sync.user_cache_minutes set, that half is fetched on a
     * slower beat while sessions stay live. At zero (the default) this is a
     * straight pass-through and the behaviour is exactly as before.
     */
    private function fetchRadiusUsersCached($radiusConfigs, bool $forceRefresh = false): array
    {
        $minutes = RadiusStatusSyncPolicy::userCacheMinutes();

        if ($minutes <= 0) {
            return $this->fetchRadiusUsers($radiusConfigs);
        }

        // The server set is recorded inside the entry rather than in the key, so
        // that invalidateUserCache() can clear it without having to know which
        // radius_configs were in play when it was written.
        $signature = $radiusConfigs->pluck('id')->implode(',');

        if (!$forceRefresh) {
            $cached = Cache::get(self::USER_CACHE_KEY);

            if (is_array($cached)
                && ($cached['signature'] ?? null) === $signature
                && !empty($cached['users'])) {
                Log::info('[STATUS SYNC] Reusing cached RADIUS user list', [
                    'users'       => count($cached['users']),
                    'cached_at'   => $cached['cached_at'] ?? null,
                    'ttl_minutes' => $minutes,
                ]);

                $cached['from_cache'] = true;

                return $cached;
            }
        }

        $report = $this->fetchRadiusUsers($radiusConfigs);
        $report['from_cache'] = false;

        // Only a COMPLETE snapshot is worth keeping. Caching a partial one —
        // taken while a server was unreachable — would leave every account on
        // that server reading "Not Found" for the whole TTL, long after it came
        // back. A partial result is still used for this run; it just is not kept.
        if ($report['reachable'] === $radiusConfigs->count() && $report['users'] !== []) {
            $report['signature'] = $signature;
            $report['cached_at'] = now()->toDateTimeString();
            Cache::put(self::USER_CACHE_KEY, $report, now()->addMinutes($minutes));
        } else {
            Log::info('[STATUS SYNC] User list not cached: incomplete snapshot', [
                'reachable' => $report['reachable'],
                'servers'   => $radiusConfigs->count(),
            ]);
        }

        return $report;
    }

    /**
     * Drop the cached user list so the next sync re-reads groups from RADIUS.
     *
     * Anything that changes a subscriber's group on a RADIUS server should call
     * this. Without it, a restrict or reconnect applied through the app would not
     * show up in online_status until the cache expired — the one way a cached
     * user list can be visibly wrong, and the one case the app itself can see
     * coming. Harmless to call when caching is switched off.
     */
    public static function invalidateUserCache(): void
    {
        Cache::forget(self::USER_CACHE_KEY);
    }

    /**
     * Fetch users from EVERY radius config, merge them, and de-duplicate by username
     * (the unique identifier). Each server is queried independently; a failure on one
     * server is logged and skipped so the remaining server(s) still contribute.
     *
     * One request per server, not one per account: reading each list in bulk is
     * the point. RouterOS answers a single list request far more cheaply than it
     * answers thousands of individual lookups, and it has live subscribers to
     * authenticate at the same time.
     *
     * @return array{users: array, per_config: array<string,int>, duplicates: int, unique: int, reachable: int}
     */
    private function fetchRadiusUsers($radiusConfigs): array
    {
        $merged     = [];
        $perConfig  = [];
        $duplicates = 0;
        $reachable  = 0;

        $api = app(RouterosApiService::class);

        foreach ($radiusConfigs as $index => $config) {
            $label = 'Radius Config ' . ($index + 1);

            try {
                self::heartbeat();
                $response = $api->connect($config) ? $api->getAllUsers($config) : null;

                // An empty result WITH an error is a failed read, not an empty device.
                // Treating it as reachable would let the caller's mass-change guard pass
                // on no data and flag every account "Not Found".
                if ($response === [] && $api->getLastError() !== '') {
                    $response = null;
                }
            } catch (\Throwable $e) {
                $response = null;
                Log::warning('RouterOS user fetch threw', [
                    'radius_config_id' => $config->id ?? null,
                    'error'            => $e->getMessage(),
                ]);
            }

            if ($response === null) {
                $perConfig[$label] = 0;
                \Log::channel('radiusrelated')->warning("[STATUS SYNC] {$label} ({$config->ip}) unreachable for users; continuing with remaining server(s). " . $api->getLastError());
                continue;
            }

            $reachable++;
            $count = 0;

            foreach ($response as $user) {
                $username = $user['username'] ?? null;
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

                // Only 'group' is read downstream; 'source' costs nothing (every
                // entry shares one interned string) and says which server an
                // account came from when a status looks wrong.
                $merged[$username] = [
                    'id'       => $user['.id'] ?? '',
                    'group'    => $user['group'] ?? '',
                    'disabled' => $user['disabled'] ?? false,
                    'source'   => $label,
                ];
            }

            // Release the decoded response before the next server is queried, so
            // peak memory is one payload rather than every payload at once.
            unset($response);

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

        $api = app(RouterosApiService::class);

        foreach ($radiusConfigs as $index => $config) {
            $label = 'Radius Config ' . ($index + 1);

            try {
                self::heartbeat();
                $response = $api->connect($config) ? $api->getActiveSessions($config) : null;

                // As with users: empty WITH an error means the read failed, not that the
                // device has nobody online.
                if ($response === [] && $api->getLastError() !== '') {
                    $response = null;
                }
            } catch (\Throwable $e) {
                $response = null;
                Log::warning('RouterOS session fetch threw', [
                    'radius_config_id' => $config->id ?? null,
                    'error'            => $e->getMessage(),
                ]);
            }

            if ($response === null) {
                $perConfig[$label] = 0;
                \Log::channel('radiusrelated')->warning("[STATUS SYNC] {$label} ({$config->ip}) unreachable for sessions; continuing with remaining server(s). " . $api->getLastError());
                continue;
            }

            $reachable++;
            $count = 0;

            foreach ($response as $session) {
                $username = $session['username'] ?? null;
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
                    'ip'         => $session['ip'] ?? '',
                    'mac'        => $session['mac'] ?? '',
                    'upload'     => $session['upload'] ?? 0,
                    'download'   => $session['download'] ?? 0,
                ];
            }

            unset($response);

            $perConfig[$label] = $count;
            Log::info("[STATUS SYNC] Fetched RADIUS sessions from {$label}", ['count' => $count]);
        }

        return [
            'sessions'   => $sessions,
            'per_config' => $perConfig,
            'reachable'  => $reachable,
        ];
    }

    /**
     * Apply the fetched RADIUS state to every eligible account, batch by batch.
     *
     * chunkById keeps this off the whole-table `get()` path: it pages on
     * billing_accounts.id, so each round trip carries one batch and the walk ends
     * only when a page comes back short — which is what guarantees that every
     * eligible account is reached. The cursor moves strictly forward, so an
     * account is visited exactly once: rows inserted behind it mid-run are not
     * re-read, and nothing ahead of it is skipped.
     */
    private function processAccounts(array $radiusUsers, array $radiusSessions, array &$stats, int $batchSize): void
    {
        Log::info('Processing accounts for RADIUS sync', [
            'batch_size'     => $batchSize,
            'skip_unchanged' => RadiusStatusSyncPolicy::skipsUnchanged(),
        ]);

        $pause = RadiusStatusSyncPolicy::batchPauseMicroseconds();

        DB::table('billing_accounts as ba')
            ->leftJoin('technical_details as td', 'ba.id', '=', 'td.account_id')
            ->select('ba.id as account_id', 'ba.account_no', 'td.username')
            ->whereNotNull('td.username')
            ->whereRaw("TRIM(td.username) <> ''")
            ->orderBy('ba.id')
            ->chunkById($batchSize, function ($accounts) use ($radiusUsers, $radiusSessions, &$stats, $pause): void {
                $stats['batches']++;

                $this->processAccountBatch($accounts, $radiusUsers, $radiusSessions, $stats);

                // A batch is the unit of work in the longest phase of the run, so
                // stamping one per batch is what keeps a large estate from being
                // mistaken for a dead process.
                self::heartbeat();

                // Optional breather, so a long sync leaves headroom for
                // interactive traffic instead of monopolising the database.
                if ($pause > 0) {
                    usleep($pause);
                }
            }, 'ba.id', 'account_id');

        $stats['synced'] = $stats['updated'];

        Log::info('[STATUS SYNC] All batches processed', [
            'batches'   => $stats['batches'],
            'accounts'  => $stats['updated'],
            'unchanged' => $stats['unchanged'],
            'skipped'   => $stats['skipped'],
            'errors'    => $stats['errors'],
        ]);
    }

    /**
     * One batch: work out what every account in it should look like, read the rows
     * it is going to touch, write them — and only then move on to the next batch.
     *
     * Split into three phases so the write can be replayed. Phase 1 is pure
     * computation and phase 2 is a single read, which means a batch whose
     * transaction fails can be written again without re-deriving anything.
     */
    private function processAccountBatch($accounts, array $radiusUsers, array $radiusSessions, array &$stats): void
    {
        // --- Phase 1: decide, without touching the database ---
        $payloads = [];

        foreach ($accounts as $account) {
            $accountId = (int) $account->account_id;

            // An account can carry more than one technical_details row and the
            // join returns each of them. Only the first is applied, so a run
            // never writes the same account twice.
            if (isset($payloads[$accountId])) {
                $stats['duplicate_accounts']++;
                continue;
            }

            $username = trim($account->username ?? '');
            if ($username === '') {
                // Skip records with empty usernames
                $stats['skipped']++;
                continue;
            }

            $payloads[$accountId] = $this->buildStatusPayload($account, $username, $radiusUsers, $radiusSessions, $stats);
        }

        if ($payloads === []) {
            return;
        }

        // --- Phase 2: one indexed read of the rows this batch will touch ---
        // One lookup for the batch, in place of the SELECT that updateOrInsert
        // would otherwise issue for every single row.
        $existing = $this->currentStatusRows(array_keys($payloads));

        // --- Phase 3: write the batch, then commit it ---
        $before = [
            'updated'   => $stats['updated'],
            'unchanged' => $stats['unchanged'],
            'errors'    => $stats['errors'],
        ];

        try {
            DB::beginTransaction();
            $this->writeStatusRows($payloads, $existing, $stats);
            DB::commit();
        } catch (\Throwable $e) {
            if (DB::transactionLevel() > 0) {
                DB::rollBack();
            }

            // The batch failed as a whole — a deadlock, a lock wait timeout, a
            // dropped connection. Nothing was persisted, so the counters go back
            // to where they started and the batch is replayed outside a
            // transaction, where a row that cannot be written costs that row
            // alone. Only a second, systemic failure stops the sync.
            $stats['updated']   = $before['updated'];
            $stats['unchanged'] = $before['unchanged'];
            $stats['errors']    = $before['errors'];

            Log::warning('RADIUS status sync batch failed; replaying it row by row', [
                'accounts' => count($payloads),
                'error'    => $e->getMessage(),
            ]);
            \Log::channel('radiusrelated')->warning('[STATUS SYNC BATCH ERROR] ' . count($payloads) . ' account(s) - Error: ' . $e->getMessage());

            $this->ensureDatabaseConnection();
            $this->writeStatusRows($payloads, $existing, $stats);
        }
    }

    /**
     * Work out the online_status values for one account.
     *
     * This is the synchronisation logic itself, and batching leaves it alone: it
     * reads only the merged RADIUS maps and the account row, so an account gets
     * the same result whichever batch it happens to fall into.
     */
    private function buildStatusPayload($account, string $username, array $radiusUsers, array $radiusSessions, array &$stats): array
    {
        $status = 'Offline';
        $group = null;
        $sessionId = null;
        $ip = null;
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

        return [
            'account_no' => $account->account_no,
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
            'updated_by_user' => 'system',
        ];
    }

    /**
     * The current online_status rows for one batch, keyed by account_id.
     *
     * @param  int[]  $accountIds
     * @return array<int, object>
     */
    private function currentStatusRows(array $accountIds): array
    {
        return DB::table('online_status')
            ->whereIn('account_id', $accountIds)
            ->select(array_merge(['account_id'], self::SYNCED_COLUMNS))
            ->get()
            ->keyBy('account_id')
            ->all();
    }

    /**
     * Write one batch of payloads.
     *
     * Every row is guarded on its own, so a row that cannot be written — one
     * tripping the unique index on username or MAC, say — is counted and logged
     * while the rest of the batch, and the rest of the sync, carries on.
     *
     * Counting stays what it always was: `updated` is the number of accounts
     * brought up to date, which is what `synced` reports, whether or not a write
     * turned out to be necessary. `unchanged` is a subset of it, saying how many
     * of those already held the right values.
     *
     * @param  array<int, array>   $payloads
     * @param  array<int, object>  $existing
     */
    private function writeStatusRows(array $payloads, array $existing, array &$stats): void
    {
        $skipUnchanged = RadiusStatusSyncPolicy::skipsUnchanged();

        foreach ($payloads as $accountId => $payload) {
            try {
                $current = $existing[$accountId] ?? null;

                if ($current === null) {
                    // No row yet: the account arrived after this run seeded
                    // online_status. updateOrInsert keeps the insert safe if
                    // another process created the row in the meantime.
                    DB::table('online_status')->updateOrInsert(
                        ['account_id' => $accountId],
                        $payload + ['created_at' => now()]
                    );

                    $this->recordStatusChange(null, $payload);
                    $stats['updated']++;
                    continue;
                }

                if ($skipUnchanged && !$this->rowNeedsUpdate($current, $payload)) {
                    $stats['unchanged']++;
                    $stats['updated']++;
                    continue;
                }

                DB::table('online_status')
                    ->where('account_id', $accountId)
                    ->update($payload);

                // Compared here rather than inferred from "we wrote it": with skipUnchanged off
                // every row is written every run, so a write on its own says nothing about whether
                // anything an operator watches actually moved.
                $this->recordStatusChange($current, $payload);
                $stats['updated']++;

            } catch (\Exception $e) {
                // A deadlock or a dropped connection takes the whole transaction
                // with it, including the rows written before this one, so it is
                // not a single-row problem and must not be counted as one. Hand
                // it to the batch, which rolls back, reconnects and replays the
                // batch outside a transaction — where the same fault would cost
                // this row alone.
                if (DB::transactionLevel() > 0 && $this->isTransactionFatal($e)) {
                    throw $e;
                }

                $stats['errors']++;
                Log::error('Error processing account for RADIUS sync', [
                    'account_no' => $payload['account_no'] ?? 'unknown',
                    'username' => $payload['username'] ?? 'unknown',
                    'error' => $e->getMessage()
                ]);
                \Log::channel('radiusrelated')->error('[STATUS SYNC ACCOUNT ERROR] Account: ' . ($payload['account_no'] ?? 'Unknown') . ' - Error: ' . $e->getMessage());
            }
        }
    }

    /**
     * Is this failure one that has already taken the open transaction down with
     * it, rather than a problem with the single row being written?
     *
     * A deadlock (1213) or a dropped connection (2006/2013) invalidates
     * everything the transaction has written so far, and a lock wait timeout
     * (1205) can do the same depending on innodb_rollback_on_timeout. Treating
     * one of those as "this row failed, carry on" would silently lose the rows
     * written before it. A constraint violation is the opposite case: the
     * statement failed, the transaction did not, and the row really is the only
     * casualty.
     */
    private function isTransactionFatal(\Throwable $e): bool
    {
        $errorInfo = $e->errorInfo ?? null;
        $driverCode = is_array($errorInfo) ? ($errorInfo[1] ?? null) : null;

        if (in_array((int) $driverCode, [1205, 1213, 2006, 2013], true)) {
            return true;
        }

        $message = strtolower($e->getMessage());

        foreach (['deadlock', 'lock wait timeout', 'server has gone away', 'lost connection'] as $needle) {
            if (str_contains($message, $needle)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Note an account whose session status or address moved, for the end-of-run broadcast.
     *
     * $current is null for a row this run inserted, which counts as a change: the account had no
     * status at all a moment ago.
     */
    private function recordStatusChange(?object $current, array $payload): void
    {
        if ($current !== null) {
            $moved = false;

            foreach (self::BROADCAST_COLUMNS as $column) {
                if ($this->comparable($current->{$column} ?? null) !== $this->comparable($payload[$column] ?? null)) {
                    $moved = true;
                    break;
                }
            }

            if (!$moved) {
                return;
            }
        }

        $accountNo = (string) ($payload['account_no'] ?? '');

        if ($accountNo === '') {
            return;
        }

        $this->changedStatuses[$accountNo] = [
            'account_no'      => $accountNo,
            'session_status'  => $payload['session_status'] ?? null,
            // Named session_ip, as the billing API reports it — the client applies this payload to
            // records it loaded from there, so the two have to agree.
            'session_ip'      => $payload['ip_address'] ?? null,
            'active_sessions' => (int) ($payload['active_sessions'] ?? 0),
        ];
    }

    /**
     * Push this run's changes to every open browser, in frames of BROADCAST_CHUNK.
     *
     * Failure here is never allowed to fail the sync. The database is already correct at this
     * point; a Soketi that is down costs the operator a live update, not a status, and throwing
     * would roll a completed run back into the error path and have it logged as a failed sync.
     *
     * @return int accounts announced
     */
    private function broadcastStatusChanges(): int
    {
        $changed = array_values($this->changedStatuses);
        $this->changedStatuses = [];

        if ($changed === []) {
            return 0;
        }

        if (count($changed) > self::BROADCAST_MAX) {
            Log::info('[STATUS SYNC] Too many status changes to broadcast; clients will refresh on their own', [
                'changed' => count($changed),
                'limit'   => self::BROADCAST_MAX,
            ]);

            return 0;
        }

        $sent = 0;

        foreach (array_chunk($changed, self::BROADCAST_CHUNK) as $chunk) {
            try {
                event(new OnlineStatusBatchUpdated($chunk));
                $sent += count($chunk);
            } catch (\Throwable $e) {
                Log::warning('[STATUS SYNC] Failed to broadcast online status changes', [
                    'accounts' => count($chunk),
                    'error'    => $e->getMessage(),
                ]);
            }
        }

        Log::info('[STATUS SYNC] Broadcast online status changes', [
            'changed' => count($changed),
            'sent'    => $sent,
        ]);

        return $sent;
    }

    /**
     * Does the stored row differ from what the sync is about to write?
     */
    private function rowNeedsUpdate(object $current, array $payload): bool
    {
        foreach (self::SYNCED_COLUMNS as $column) {
            $stored = $this->comparable($current->{$column} ?? null);
            $fresh  = $this->comparable($payload[$column] ?? null);

            if ($stored !== $fresh) {
                return true;
            }
        }

        return false;
    }

    /**
     * PDO hands integer columns back as strings, and the RADIUS API sends its
     * counters as strings too, so comparing row against payload strictly would
     * call every row changed and rewrite the whole table on every run. Compare on
     * value instead, keeping NULL distinct from an empty string so a column that
     * has genuinely been cleared is still noticed.
     */
    private function comparable($value): ?string
    {
        return $value === null ? null : (string) $value;
    }

    /**
     * Make sure the connection is usable before writing, and prove it.
     *
     * The fetch phase can outlast the server's wait_timeout, and a batch that
     * failed may have failed because the connection went away, so this runs both
     * before the first batch and before a failed batch is replayed.
     *
     * Every attempt ends in a real `SELECT 1`, because DB::reconnect() only
     * installs a lazy PDO resolver — it opens no socket, so it cannot fail here
     * and cannot prove anything either. A reconnect that was never exercised used
     * to let the run walk straight into processAccounts(), where the deferred
     * connect failed on the chunk query instead and surfaced as a CRITICAL
     * carrying a 500-row SELECT rather than "the database was unreachable".
     *
     * Attempts are spaced, because the failure this guards against is a database
     * that is briefly unreachable: one immediate retry is no more likely to
     * succeed than the attempt that just failed.
     */
    private function ensureDatabaseConnection(int $attempts = 3): void
    {
        $lastError = null;

        for ($attempt = 1; $attempt <= $attempts; $attempt++) {
            try {
                DB::connection()->getPdo()->query('SELECT 1');

                if ($attempt > 1) {
                    Log::info('DB connection restored during RADIUS status sync', [
                        'attempt' => $attempt,
                    ]);
                }

                return;
            } catch (\Throwable $e) {
                $lastError = $e;

                Log::warning('DB connection lost during RADIUS status sync, attempting reconnect', [
                    'attempt' => $attempt . '/' . $attempts,
                    'error'   => $e->getMessage(),
                ]);

                if ($attempt === $attempts) {
                    break;
                }

                $default = config('database.default');

                try {
                    DB::purge($default);
                    DB::reconnect($default);
                } catch (\Throwable $reconnectError) {
                    // Reported, never fatal on its own: the SELECT at the top of
                    // the next pass is what decides whether the database is back.
                    Log::warning('Reconnect attempt itself failed during RADIUS status sync', [
                        'attempt' => $attempt . '/' . $attempts,
                        'error'   => $reconnectError->getMessage(),
                    ]);
                }

                sleep(2 ** ($attempt - 1));
            }
        }

        // Out of attempts. Name the problem plainly — the run is about to abort,
        // and "the database is unreachable" is what the operator needs to read.
        throw new \RuntimeException(
            'Database unreachable after ' . $attempts . ' attempts: '
            . ($lastError !== null ? $lastError->getMessage() : 'unknown error'),
            0,
            $lastError instanceof \Throwable ? $lastError : null
        );
    }
}
