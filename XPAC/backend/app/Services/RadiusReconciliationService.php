<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\RadiusConfig;
use App\Services\PppoeUsernameService;
use App\Support\PlanGroup;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Reconciliation engine between the Mikrotik User Manager (RADIUS) devices and
 * the AKMIIS billing database.
 *
 * Ported from the standalone `syncradius.php` utility, with three material changes
 * demanded by AKMIIS running MORE THAN ONE RADIUS server:
 *
 *  1. Every read and every mutation is scoped to a target: a single radius_config
 *     id, or the sentinel 'all' which merges every configured device.
 *  2. A username present on two or more devices at once is a first-class,
 *     highest-priority finding (`duplicate_radius`) — on a multi-server estate this
 *     is the defect that silently double-authenticates a subscriber.
 *  3. Every mutation snapshots the pre-change state into `activity_logs` so it can
 *     be reversed by undoOperation() without the operator reconstructing it by hand.
 *
 * Credentials are never taken from user input: RADIUS endpoints come from
 * `radius_config` via RadiusServerResolver, and the billing database comes from the
 * framework connection. Nothing here reads or writes a secret to the log.
 *
 * Transport note: device I/O runs over the native RouterOS API socket (RouterosApiService,
 * ports 8728/8729), not REST. The `/rest/user-manage/...` strings that remain are this
 * service's INTERNAL routing keys — callDevice() translates each into a User Manager API
 * command — kept so the mutation sites and their activity_logs reversal snapshots did not
 * have to be rewritten alongside the transport.
 */
class RadiusReconciliationService
{
    /** activity_logs.resource_type for everything this service writes. */
    public const RESOURCE_TYPE = 'mikrotik_tool';

    /** Sentinel accepted in place of a numeric radius_config id to mean "every device". */
    public const SERVER_ALL = 'all';

    /** User Manager group an account is parked in when service is withheld. */
    public const RESTRICTED_GROUP = 'Restricted';

    /** Password handed to an account created from the "missing in RADIUS" list. */
    public const DEFAULT_NEW_PASSWORD = '123456';

    /**
     * Which side wins when the RADIUS group and the billing plan disagree.
     *
     * `billing` pushes the plan's group onto the device — correct when the billing
     * database is where plan changes are entered. `radius` adopts the device's group
     * as the plan label instead, which is what an estate that provisions on the
     * router first needs. Nominated per run by the caller; the nightly cron defaults
     * to `billing`.
     */
    public const AUTHORITY_BILLING = 'billing';
    public const AUTHORITY_RADIUS  = 'radius';

    /**
     * billing_status_id values that mean billing no longer considers the account
     * live. Shared by the audit's state machine and the nightly restriction sweep so
     * the two can never drift into disagreeing about what "delinquent" means.
     */
    public const INACTIVE_BILLING_STATUS_IDS = [2, 3, 5];

    // ---- Reconciliation states, in the order they are evaluated -------------
    public const STATE_DUPLICATE         = 'duplicate_radius';
    public const STATE_RESTRICTED        = 'restricted';
    public const STATE_DISABLED_MISMATCH = 'disabled_mismatch';
    public const STATE_PASSWORD_MISMATCH = 'password_mismatch';
    public const STATE_GROUP_MISMATCH    = 'group_mismatch';
    public const STATE_ORPHAN_RADIUS     = 'orphan_radius';
    public const STATE_MISSING_RADIUS    = 'missing_radius';
    public const STATE_SYNCED            = 'synced';

    public const STATES = [
        self::STATE_DUPLICATE,
        self::STATE_RESTRICTED,
        self::STATE_DISABLED_MISMATCH,
        self::STATE_PASSWORD_MISMATCH,
        self::STATE_GROUP_MISMATCH,
        self::STATE_ORPHAN_RADIUS,
        self::STATE_MISSING_RADIUS,
        self::STATE_SYNCED,
    ];

    /** Bulk operations bulkAction() accepts. */
    public const BULK_OPERATIONS = [
        'sync_passwords',
        'sync_group_mikrotik',
        'sync_group_billing',
        'restrict',
        'disconnect',
        'delete',
        'align_username',
    ];

    private const LOG_CHANNEL       = 'radiusrelated';
    private const LOG_PREFIX        = 'Radius_Reconciliation';
    private const CONNECT_TIMEOUT   = 5;
    private const REQUEST_TIMEOUT   = 30;
    private const SUBSCRIBER_CHUNK  = 500;

    /**
     * Where the last completed audit is parked for the UI to open on.
     *
     * A full sweep contacts every RADIUS device twice and reads the whole subscriber
     * table; doing that on every page load punished the devices for a page nobody
     * had asked to act on yet. The tool now opens on this snapshot and only touches
     * hardware when the operator presses Sync & Reconcile Now.
     */
    private const SNAPSHOT_PREFIX = 'mikrotik_tool:snapshot:';
    private const SNAPSHOT_TTL    = 3600;

    /** Groups that mean "service withheld" regardless of the disabled flag. */
    private const RESTRICTED_GROUPS = ['restricted', 'disconnected'];

    /**
     * Billing-plan labels keyed by their bare RADIUS group name, memoized per request.
     *
     * @var array<string, string>|null
     */
    private ?array $planLabelMap = null;

    public function __construct(private RadiusServerResolver $resolver)
    {
    }

    // =========================================================================
    // Server discovery
    // =========================================================================

    /**
     * Analyze and classify the configured RADIUS devices.
     *
     * If two configs share the same IP address, the subsequent one is not a new
     * server, but a fallback/failover transport for that server (e.g. API SSL port 8729
     * vs plain 8728).
     *
     * @return array<int, array{config: RadiusConfig, id: int, server_number: int, is_fallback: bool, fallback_for: ?int, label: string}>
     */
    public function classifiedConfigs(?int $organizationId = null): array
    {
        $configs = $this->resolver->orderedConfigs($organizationId)->values();
        $classified = [];
        $serverNumber = 0;
        $ipMap = [];

        foreach ($configs as $config) {
            $ip = trim((string) $config->ip);
            if (isset($ipMap[$ip])) {
                $primaryNum = $ipMap[$ip]['server_number'];
                $classified[(int) $config->id] = [
                    'config'        => $config,
                    'id'            => (int) $config->id,
                    'server_number' => $primaryNum,
                    'is_fallback'   => true,
                    'fallback_for'  => $primaryNum,
                    'label'         => "Server #{$primaryNum} Fallback ({$config->ip})",
                ];
            } else {
                $serverNumber++;
                $ipMap[$ip] = [
                    'server_number' => $serverNumber,
                    'primary_id'    => (int) $config->id,
                ];
                $classified[(int) $config->id] = [
                    'config'        => $config,
                    'id'            => (int) $config->id,
                    'server_number' => $serverNumber,
                    'is_fallback'   => false,
                    'fallback_for'  => null,
                    'label'         => "Server #{$serverNumber} ({$config->ip})",
                ];
            }
        }

        return $classified;
    }

    /**
     * The RADIUS devices this operator may target, safe for transport to the UI.
     *
     * Never includes the device password — the UI only ever needs to name a server,
     * and the service resolves credentials itself from radius_config.
     *
     * @return array<int, array<string, mixed>>
     */
    public function getServers(?int $organizationId = null): array
    {
        $classified = $this->classifiedConfigs($organizationId);

        return array_values(array_map(function (array $item): array {
            /** @var RadiusConfig $config */
            $config = $item['config'];
            return [
                'id'           => $item['id'],
                'position'     => $item['server_number'],
                'label'        => $item['label'],
                'ip'           => $config->ip,
                'port'         => $config->port,
                'ssl_type'     => $config->ssl_type ?: 'https',
                'username'     => $config->username,
                'is_fallback'  => $item['is_fallback'],
                'fallback_for' => $item['fallback_for'],
            ];
        }, $classified));
    }

    /**
     * Resolve the caller's server selector into the configs to operate on.
     *
     * @return Collection<int, RadiusConfig>
     */
    private function targetConfigs(?string $serverId, ?int $organizationId = null): Collection
    {
        $configs = $this->resolver->orderedConfigs($organizationId);

        if ($serverId === null || $serverId === '' || strtolower($serverId) === self::SERVER_ALL) {
            return $configs;
        }

        return $configs->filter(fn (RadiusConfig $c): bool => (int) $c->id === (int) $serverId)->values();
    }

    /**
     * A single config by id, or null. Used by every mutation that names a device.
     */
    private function configById(int $serverId, ?int $organizationId = null): ?RadiusConfig
    {
        return $this->resolver->orderedConfigs($organizationId)
            ->first(fn (RadiusConfig $c): bool => (int) $c->id === $serverId);
    }

    /**
     * Human label for a config, matching what getServers() reports to the UI.
     */
    private function labelFor(RadiusConfig $config, ?int $organizationId = null): string
    {
        $classified = $this->classifiedConfigs($organizationId);
        $cid = (int) $config->id;

        if (isset($classified[$cid])) {
            return $classified[$cid]['label'];
        }

        return 'Server (' . $config->ip . ')';
    }

    // =========================================================================
    // Audit engine
    // =========================================================================

    /**
     * Build the full reconciliation dataset for one device or for the whole estate.
     *
     * Read-only: no transaction, no mutation. Every RADIUS device is contacted once
     * for users and once for sessions; the billing side is read in one chunked sweep
     * with its relations eager-loaded, so the row count does not drive query count.
     *
     * @return array{
     *     success: bool,
     *     mode: string,
     *     servers: array<int, array<string, mixed>>,
     *     summary: array<string, int>,
     *     duplicates: array<int, array<string, mixed>>,
     *     rows: array<int, array<string, mixed>>,
     *     errors: array<int, string>,
     *     trace: array<int, array<string, string>>
     * }
     */
    public function fetchReconciliationData(?string $serverId = null, ?int $organizationId = null): array
    {
        $started = microtime(true);
        $trace   = [];
        $errors  = [];

        $configs = $this->targetConfigs($serverId, $organizationId);
        $isCombined = $serverId === null || $serverId === '' || strtolower((string) $serverId) === self::SERVER_ALL;

        if ($configs->isEmpty()) {
            return [
                'success'    => false,
                'mode'       => $isCombined ? self::SERVER_ALL : (string) $serverId,
                'servers'    => [],
                'summary'    => $this->emptySummary(),
                'duplicates' => [],
                'rows'       => [],
                'errors'     => ['No RADIUS server matched the requested target.'],
                'trace'      => $this->trace($trace, 'No radius_config record matched the requested target.', 'ERROR'),
            ];
        }

        // ---- 1. Pull every targeted device -----------------------------------
        // radiusByServer[configId][username] = user record
        $radiusByServer   = [];
        $sessionsByServer = [];
        $serverMeta       = [];

        if ($isCombined) {
            // Group configs by IP. For each IP, query the primary endpoint first;
            // only query the fallback config if the primary endpoint fails to read users.
            $configsByIp = [];
            foreach ($configs as $config) {
                $ip = trim((string) $config->ip);
                $configsByIp[$ip][] = $config;
            }

            foreach ($configsByIp as $ip => $ipConfigs) {
                $primaryConfig = $ipConfigs[0];
                $primaryId     = (int) $primaryConfig->id;
                $primaryLabel  = $this->labelFor($primaryConfig, $organizationId);

                $targetConfig = $primaryConfig;
                $targetId     = $primaryId;
                $targetLabel  = $primaryLabel;

                // Try reading users from the primary endpoint
                $primaryErrors = [];
                $primaryTrace  = [];
                $users = $this->fetchUsers($primaryConfig, $primaryTrace, $primaryErrors, $primaryLabel);

                // If primary endpoint failed and fallback config(s) exist for this IP, try fallback
                if ($primaryErrors !== [] && count($ipConfigs) > 1) {
                    $fallbackSucceeded = false;
                    for ($i = 1; $i < count($ipConfigs); $i++) {
                        $fallbackConfig = $ipConfigs[$i];
                        $fallbackId     = (int) $fallbackConfig->id;
                        $fallbackLabel  = $this->labelFor($fallbackConfig, $organizationId);

                        $this->trace(
                            $trace,
                            "{$primaryLabel} failed to read users (" . implode(', ', $primaryErrors) . "); attempting fallback endpoint {$fallbackLabel}...",
                            'WARNING'
                        );

                        $fallbackErrors = [];
                        $fallbackTrace  = [];
                        $fallbackUsers  = $this->fetchUsers($fallbackConfig, $fallbackTrace, $fallbackErrors, $fallbackLabel);

                        if ($fallbackErrors === []) {
                            $targetConfig      = $fallbackConfig;
                            $targetId          = $fallbackId;
                            $targetLabel       = $fallbackLabel;
                            $users             = $fallbackUsers;
                            $trace             = array_merge($trace, $fallbackTrace);
                            $fallbackSucceeded = true;
                            break;
                        } else {
                            $this->trace(
                                $trace,
                                "{$fallbackLabel} also failed: " . implode(', ', $fallbackErrors),
                                'WARNING'
                            );
                        }
                    }

                    if (!$fallbackSucceeded) {
                        $trace  = array_merge($trace, $primaryTrace);
                        $errors = array_merge($errors, $primaryErrors);
                    }
                } else {
                    $trace  = array_merge($trace, $primaryTrace);
                    $errors = array_merge($errors, $primaryErrors);
                }

                $serverMeta[$targetId] = [
                    'id'    => $targetId,
                    'label' => $targetLabel,
                    'ip'    => $targetConfig->ip,
                ];

                $sessions = $this->fetchSessions($targetConfig, $trace, $errors, $targetLabel);
                $radiusByServer[$targetId]   = $users;
                $sessionsByServer[$targetId] = $sessions;

                $serverMeta[$targetId]['user_count']    = count($users);
                $serverMeta[$targetId]['session_count'] = count($sessions);
            }
        } else {
            foreach ($configs as $config) {
                $serverKey = (int) $config->id;
                $label     = $this->labelFor($config, $organizationId);

                $serverMeta[$serverKey] = [
                    'id'    => $serverKey,
                    'label' => $label,
                    'ip'    => $config->ip,
                ];

                $users = $this->fetchUsers($config, $trace, $errors, $label);
                $radiusByServer[$serverKey]   = $users;
                $sessionsByServer[$serverKey] = $this->fetchSessions($config, $trace, $errors, $label);

                $serverMeta[$serverKey]['user_count']    = count($users);
                $serverMeta[$serverKey]['session_count'] = count($sessionsByServer[$serverKey]);
            }
        }

        // ---- 2. Cross-server duplicate detection -----------------------------
        // Only meaningful in combined mode; in single-server mode a username can
        // appear at most once so the map is always empty.
        // A duplicate requires the account to exist across distinct server IP addresses
        // (same IP on different ports is a primary/fallback relationship, not a duplicate server).
        $usernameServers = [];
        foreach ($radiusByServer as $sid => $users) {
            foreach (array_keys($users) as $username) {
                $usernameServers[$username][] = $sid;
            }
        }
        $duplicateUsernames = array_keys(array_filter(
            $usernameServers,
            function (array $sids) use ($serverMeta): bool {
                if (count($sids) <= 1) {
                    return false;
                }
                $distinctIps = [];
                foreach ($sids as $sid) {
                    $ip = $serverMeta[$sid]['ip'] ?? (string) $sid;
                    $distinctIps[$ip] = true;
                }
                return count($distinctIps) > 1;
            }
        ));

        if ($duplicateUsernames !== []) {
            $this->trace(
                $trace,
                'Detected ' . count($duplicateUsernames) . ' username(s) present on more than one RADIUS device.',
                'WARNING'
            );
        }

        // ---- 3. Billing side, hoisted and chunked ----------------------------
        $billing = $this->loadBillingSubscribers($organizationId);
        $this->trace($trace, 'Loaded ' . count($billing) . ' subscriber record(s) from the billing database.', 'INFO');

        // ---- 4. Categorize ---------------------------------------------------
        $rows       = [];
        $duplicates = [];
        $seen       = [];

        foreach ($radiusByServer as $sid => $users) {
            $sessions = $sessionsByServer[$sid] ?? [];

            foreach ($users as $username => $radInfo) {
                $bill      = $billing[$username] ?? null;
                $isDup     = in_array($username, $duplicateUsernames, true);
                $session   = $sessions[$username] ?? null;

                $row = $this->buildRow(
                    $username,
                    $radInfo,
                    $bill,
                    $session,
                    $serverMeta[$sid],
                    $isDup,
                    $usernameServers[$username] ?? [$sid]
                );

                $rows[] = $row;
                $seen[$username] = true;

                if ($isDup && !isset($duplicates[$username])) {
                    $duplicates[$username] = $this->buildDuplicateSummary(
                        $username,
                        $usernameServers[$username],
                        $radiusByServer,
                        $sessionsByServer,
                        $serverMeta
                    );
                }
            }
        }

        // Active in billing but absent from every targeted device.
        $pppoeHelper = new PppoeUsernameService();
        foreach ($billing as $username => $bill) {
            if (isset($seen[$username])) {
                continue;
            }

            $formatCheck = $pppoeHelper->validateUsernameFormat($username, [
                'first_name'     => $bill['first_name'] ?? '',
                'middle_initial' => $bill['middle_initial'] ?? '',
                'last_name'      => $bill['last_name'] ?? '',
                'mobile_number'  => $bill['mobile_number'] ?? '',
                'lcp'            => $bill['lcp'] ?? '',
                'nap'            => $bill['nap'] ?? '',
                'port'           => $bill['port'] ?? '',
                'lcpnap'         => $bill['lcpnap'] ?? '',
            ]);

            $rows[] = [
                'username'          => $username,
                'account_no'        => $bill['account_no'],
                'customer_name'     => $bill['customer_name'],
                'account_id'        => $bill['account_id'],
                'state'             => self::STATE_MISSING_RADIUS,
                'server_id'         => null,
                'server_label'      => '—',
                'rad_id'            => null,
                'rad_group'         => null,
                'rad_password'      => null,
                'rad_disabled'      => null,
                'bill_group'        => $bill['plan_label'] ?: 'None',
                'bill_target_group' => $bill['plan_group'] ?: 'Default',
                'db_password'       => $bill['pppoe_password'],
                'billing_status_id' => $bill['billing_status_id'],
                'online'            => false,
                'session_id'        => null,
                'session_ip'        => null,
                'session_mac'       => null,
                'duplicate_servers' => [],
                'is_format_valid'   => $formatCheck['valid'],
                'format_issue'      => $formatCheck['reason'],
                'suggested_username'=> $formatCheck['suggested'],
            ];
        }

        $distinctServerCount = count($radiusByServer);
        $summary = $this->summarize($rows, $distinctServerCount, count($billing), count($duplicates));

        $this->trace(
            $trace,
            sprintf(
                'Reconciliation complete in %sms across %d device(s): %d row(s), %d duplicate account(s).',
                round((microtime(true) - $started) * 1000, 2),
                $distinctServerCount,
                count($rows),
                count($duplicates)
            ),
            'SUCCESS'
        );

        $result = [
            'success'    => true,
            'mode'       => $isCombined ? self::SERVER_ALL : (string) $serverId,
            'servers'    => array_values($serverMeta),
            'summary'    => $summary,
            'duplicates' => array_values($duplicates),
            'rows'       => $rows,
            'errors'     => $errors,
            'trace'      => $trace,
            'stale'      => false,
            'synced_at'  => now()->toIso8601String(),
        ];

        $this->putSnapshot($result['mode'], $result);

        return $result;
    }

    /**
     * The last completed audit for this target, without touching a device.
     *
     * This is what the tool loads on open. `stale` tells the UI it is looking at a
     * recording rather than live state, and a target that has never been swept comes
     * back idle with an empty row set — never a silent fabricated "everything is in
     * sync", which is the one wrong answer this screen must not give.
     *
     * @return array<string, mixed>
     */
    public function getSnapshot(?string $serverId = null, ?int $organizationId = null): array
    {
        $isCombined = $serverId === null || $serverId === '' || strtolower((string) $serverId) === self::SERVER_ALL;
        $mode       = $isCombined ? self::SERVER_ALL : (string) $serverId;

        $cached = Cache::get(self::SNAPSHOT_PREFIX . $mode);

        if (is_array($cached) && isset($cached['rows'])) {
            $cached['stale'] = true;

            return $cached;
        }

        return [
            'success'    => true,
            'mode'       => $mode,
            'servers'    => $this->getServers($organizationId),
            'summary'    => $this->emptySummary(),
            'duplicates' => [],
            'rows'       => [],
            'errors'     => [],
            'trace'      => [[
                'timestamp' => now()->format('H:i:s.v'),
                'level'     => 'INFO',
                'message'   => 'No audit has been run for this target yet. Press "Sync & Reconcile Now" to contact the RADIUS devices.',
            ]],
            'stale'      => true,
            'synced_at'  => null,
        ];
    }

    /**
     * Park a completed audit for the next page load.
     *
     * @param array<string, mixed> $result
     */
    private function putSnapshot(string $mode, array $result): void
    {
        try {
            Cache::put(self::SNAPSHOT_PREFIX . $mode, $result, self::SNAPSHOT_TTL);
        } catch (Throwable $e) {
            // A cache write failure costs the operator a snapshot on next open,
            // nothing more. It must never fail the audit that just succeeded.
            $this->log('warning', 'Could not cache the reconciliation snapshot.', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Decide a single account's state and assemble its row.
     *
     * Order matters: a duplicate outranks everything (it is the finding that must not
     * be hidden behind a lesser one), then withheld service, then the disabled flag,
     * then credential drift, then plan drift.
     *
     * @param array<string, mixed>       $radInfo
     * @param array<string, mixed>|null  $bill
     * @param array<string, mixed>|null  $session
     * @param array<string, mixed>       $server
     * @param array<int, int>            $onServers
     * @return array<string, mixed>
     */
    private function buildRow(
        string $username,
        array $radInfo,
        ?array $bill,
        ?array $session,
        array $server,
        bool $isDuplicate,
        array $onServers
    ): array {
        $radGroup = (string) $radInfo['group'];
        $disabled = (bool) $radInfo['disabled'];

        $isRestricted = $disabled || in_array(strtolower(trim($radGroup)), self::RESTRICTED_GROUPS, true);

        if ($isDuplicate) {
            $state = self::STATE_DUPLICATE;
        } elseif ($bill === null) {
            $state = $isRestricted ? self::STATE_RESTRICTED : self::STATE_ORPHAN_RADIUS;
        } elseif ($isRestricted) {
            // Withheld on the device. If billing still calls the account live, that
            // disagreement is the more actionable finding.
            $state = $this->billingConsidersActive($bill) && $disabled
                ? self::STATE_DISABLED_MISMATCH
                : self::STATE_RESTRICTED;
        } elseif ((string) $bill['pppoe_password'] !== '' && (string) $bill['pppoe_password'] !== (string) $radInfo['password']) {
            $state = self::STATE_PASSWORD_MISMATCH;
        } elseif (!$this->groupsAgree($radGroup, (string) $bill['plan_label'])) {
            $state = self::STATE_GROUP_MISMATCH;
        } else {
            $state = self::STATE_SYNCED;
        }

        $formatCheck = (new PppoeUsernameService())->validateUsernameFormat(
            $username,
            $bill ? [
                'first_name'     => $bill['first_name'] ?? '',
                'middle_initial' => $bill['middle_initial'] ?? '',
                'last_name'      => $bill['last_name'] ?? '',
                'mobile_number'  => $bill['mobile_number'] ?? '',
                'lcp'            => $bill['lcp'] ?? '',
                'nap'            => $bill['nap'] ?? '',
                'port'           => $bill['port'] ?? '',
                'lcpnap'         => $bill['lcpnap'] ?? '',
            ] : null
        );

        return [
            'username'          => $username,
            'account_no'        => $bill['account_no'] ?? null,
            'customer_name'     => $bill['customer_name'] ?? null,
            'account_id'        => $bill['account_id'] ?? null,
            'state'             => $state,
            'server_id'         => $server['id'],
            'server_label'      => $server['label'],
            'rad_id'            => $radInfo['id'],
            'rad_group'         => $radGroup !== '' ? $radGroup : 'None',
            'rad_password'      => $radInfo['password'],
            'rad_disabled'      => $disabled,
            'bill_group'        => $bill['plan_label'] ?? 'None',
            'bill_target_group' => $bill['plan_group'] ?? 'Default',
            'db_password'       => $bill['pppoe_password'] ?? '',
            'billing_status_id' => $bill['billing_status_id'] ?? null,
            'online'            => $session !== null,
            'session_id'        => $session['id'] ?? null,
            'session_ip'        => $session['ip'] ?? null,
            'session_mac'       => $session['mac'] ?? null,
            'duplicate_servers' => $isDuplicate ? array_values($onServers) : [],
            'is_format_valid'   => $formatCheck['valid'],
            'format_issue'      => $formatCheck['reason'],
            'suggested_username'=> $formatCheck['suggested'],
        ];
    }

    /**
     * Describe one cross-server duplicate: where it lives, and how the copies disagree.
     *
     * @param array<int, int> $serverIds
     * @param array<int, array<string, mixed>> $radiusByServer
     * @param array<int, array<string, mixed>> $sessionsByServer
     * @param array<int, array<string, mixed>> $serverMeta
     * @return array<string, mixed>
     */
    private function buildDuplicateSummary(
        string $username,
        array $serverIds,
        array $radiusByServer,
        array $sessionsByServer,
        array $serverMeta
    ): array {
        $instances  = [];
        $passwords  = [];
        $groups     = [];
        $activeOn   = [];

        foreach ($serverIds as $sid) {
            $rad = $radiusByServer[$sid][$username] ?? null;
            if ($rad === null) {
                continue;
            }

            $online = isset($sessionsByServer[$sid][$username]);
            if ($online) {
                $activeOn[] = $serverMeta[$sid]['label'];
            }

            $passwords[] = (string) $rad['password'];
            $groups[]    = strtolower(trim((string) $rad['group']));

            $instances[] = [
                'server_id'    => $sid,
                'server_label' => $serverMeta[$sid]['label'],
                'server_ip'    => $serverMeta[$sid]['ip'],
                'rad_id'       => $rad['id'],
                'group'        => $rad['group'] !== '' ? $rad['group'] : 'None',
                'disabled'     => (bool) $rad['disabled'],
                'online'       => $online,
            ];
        }

        $discrepancies = [];
        if (count(array_unique($passwords)) > 1) {
            $discrepancies[] = 'Password differs between servers.';
        }
        if (count(array_unique($groups)) > 1) {
            $discrepancies[] = 'RADIUS group differs between servers.';
        }
        if (count($activeOn) > 1) {
            $discrepancies[] = 'Live session active on more than one server (' . implode(', ', $activeOn) . ').';
        }
        if ($discrepancies === []) {
            $discrepancies[] = 'Copies are identical — the duplicate is redundant but not conflicting.';
        }

        return [
            'username'      => $username,
            'server_count'  => count($instances),
            'instances'     => $instances,
            'discrepancies' => $discrepancies,
        ];
    }

    /**
     * Read every subscriber that carries a PPPoE username, keyed by that username.
     *
     * chunkById keeps the sweep off the whole-table `get()` path, and the relations
     * are eager-loaded so plan/customer access inside the loop stays free.
     *
     * @return array<string, array<string, mixed>>
     */
    private function loadBillingSubscribers(?int $organizationId = null): array
    {
        $subscribers = [];

        $query = DB::table('technical_details as td')
            ->join('billing_accounts as ba', 'ba.id', '=', 'td.account_id')
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id')
            ->whereNotNull('td.username')
            ->where('td.username', '!=', '')
            ->select([
                'td.id as td_id',
                'td.username',
                'td.pppoe_password',
                'td.lcp',
                'td.nap',
                'td.port',
                'td.lcpnap',
                'ba.id as account_id',
                'ba.account_no',
                'ba.billing_status_id',
                'c.id as customer_id',
                'c.first_name',
                'c.middle_initial',
                'c.last_name',
                'c.contact_number_primary',
                'c.desired_plan',
            ]);

        if ($organizationId !== null) {
            $query->where(function ($q) use ($organizationId): void {
                $q->where('td.organization_id', $organizationId)
                  ->orWhereNull('td.organization_id');
            });
        }

        $query->orderBy('td.id')->chunkById(self::SUBSCRIBER_CHUNK, function ($chunk) use (&$subscribers): void {
            foreach ($chunk as $row) {
                $username = trim((string) $row->username);
                if ($username === '') {
                    continue;
                }

                $planLabel = trim((string) ($row->desired_plan ?? ''));

                $subscribers[$username] = [
                    'td_id'             => (int) $row->td_id,
                    'account_id'        => (int) $row->account_id,
                    'account_no'        => $row->account_no,
                    'customer_id'       => $row->customer_id !== null ? (int) $row->customer_id : null,
                    'customer_name'     => trim(($row->first_name ?? '') . ' ' . ($row->last_name ?? '')) ?: null,
                    'first_name'        => (string) ($row->first_name ?? ''),
                    'middle_initial'    => (string) ($row->middle_initial ?? ''),
                    'last_name'         => (string) ($row->last_name ?? ''),
                    'mobile_number'     => (string) ($row->contact_number_primary ?? ''),
                    'lcp'               => (string) ($row->lcp ?? ''),
                    'nap'               => (string) ($row->nap ?? ''),
                    'port'              => (string) ($row->port ?? ''),
                    'lcpnap'            => (string) ($row->lcpnap ?? ''),
                    'billing_status_id' => $row->billing_status_id,
                    'pppoe_password'    => (string) ($row->pppoe_password ?? ''),
                    'plan_label'        => $planLabel,
                    'plan_group'        => $this->bareGroup($planLabel),
                ];
            }
        }, 'td.id', 'td_id');

        return $subscribers;
    }

    /**
     * Fetch every User Manager account from one device, keyed by username.
     *
     * @param array<int, array<string, string>> $trace
     * @param array<int, string>                $errors
     * @return array<string, array<string, mixed>>
     */
    private function fetchUsers(RadiusConfig $config, array &$trace, array &$errors, string $label): array
    {
        $response = $this->callDevice($config, 'GET', '/rest/user-manage/user', null, $trace, $label);

        if (!$response['success'] || !is_array($response['data'])) {
            $errors[] = $label . ': unable to read User Manager accounts — ' . $response['error'];
            return [];
        }

        $users = [];
        foreach ($response['data'] as $user) {
            if (!is_array($user)) {
                continue;
            }
            $username = trim((string) ($user['name'] ?? ''));
            if ($username === '') {
                continue;
            }

            $users[$username] = [
                'id'       => (string) ($user['.id'] ?? ''),
                'group'    => trim((string) ($user['group'] ?? '')),
                'disabled' => ($user['disabled'] ?? 'false') === 'true' || ($user['disabled'] ?? false) === true,
                'password' => (string) ($user['password'] ?? ''),
            ];
        }

        $this->trace($trace, $label . ': fetched ' . count($users) . ' User Manager account(s).', 'INFO');

        return $users;
    }

    /**
     * Fetch live sessions from one device, keyed by username.
     *
     * @param array<int, array<string, string>> $trace
     * @param array<int, string>                $errors
     * @return array<string, array<string, mixed>>
     */
    private function fetchSessions(RadiusConfig $config, array &$trace, array &$errors, string $label): array
    {
        $response = $this->callDevice($config, 'GET', '/rest/user-manage/session', null, $trace, $label);

        if (!$response['success'] || !is_array($response['data'])) {
            // A device that answers for users but not sessions is degraded, not fatal:
            // the audit still stands, it just cannot report who is online.
            $errors[] = $label . ': unable to read live sessions — ' . $response['error'];
            return [];
        }

        $sessions = [];
        foreach ($response['data'] as $session) {
            if (!is_array($session)) {
                continue;
            }
            $username = trim((string) ($session['user'] ?? $session['username'] ?? ''));
            if ($username === '') {
                continue;
            }

            $sessions[$username] = [
                'id'  => (string) ($session['.id'] ?? ''),
                'ip'  => (string) ($session['user-address'] ?? ''),
                'mac' => (string) ($session['calling-station-id'] ?? ''),
            ];
        }

        $this->trace($trace, $label . ': fetched ' . count($sessions) . ' live session(s).', 'INFO');

        return $sessions;
    }

    /**
     * Live PPPoE sessions across every configured device, indexed both ways.
     *
     * Exposed because two other engines need it and neither should be opening its
     * own RouterOS connection: the SmartOLT tool matches an ONU's bridge MAC to a
     * session's calling-station-id to learn the subscriber's RADIUS username, and
     * its cleanup pass refuses to unprovision any ONU whose subscriber is online.
     *
     * Read-only, no transaction, and every device failure is reported rather than
     * thrown - a device that cannot be reached must never be read as "nobody is
     * online", because that is the reading that would delete a live subscriber.
     *
     * Every configured device is queried, but only the ones this deployment expects
     * to be live decide `available`. A failover server is configured on purpose and
     * is dark by design; counting its silence as an outage parked the SmartOLT
     * cleanup pass and banner-ed the alignment tabs on an estate where the server
     * that actually holds the sessions had answered in full. A standby that does
     * answer is still merged in, and its failures are still reported - under
     * `standby_errors`, where they read as information rather than as a fault.
     *
     * @return array{
     *     available: bool,
     *     by_mac: array<string, array<string, mixed>>,
     *     by_username: array<string, array<string, mixed>>,
     *     errors: array<int, string>,
     *     standby_errors: array<int, string>,
     *     server_count: int,
     *     active_server_count: int
     * }
     */
    public function activeSessions(?int $organizationId = null): array
    {
        $trace  = [];
        $errors = [];
        $standbyErrors = [];

        $configs = $this->targetConfigs(null, $organizationId);

        if ($configs->isEmpty()) {
            return [
                'available'    => false,
                'by_mac'       => [],
                'by_username'  => [],
                'errors'       => ['No RADIUS server is configured.'],
                'standby_errors' => [],
                'server_count' => 0,
                'active_server_count' => 0,
            ];
        }

        // Hoisted once: the sweep below is a membership test per device, not a
        // resolver call per device.
        $activeIds = $this->resolver->activeConfigs($organizationId)
            ->map(static fn (RadiusConfig $config): int => (int) $config->id)
            ->all();

        $byMac      = [];
        $byUsername = [];
        $answered   = 0;

        foreach ($configs as $config) {
            $label    = $this->labelFor($config, $organizationId);
            $isActive = in_array((int) $config->id, $activeIds, true);

            // Collected per device so a failure can be attributed. fetchSessions()
            // returns an empty list both for "no sessions" and for "did not answer",
            // and those must not be conflated.
            $deviceErrors = [];
            $sessions = $this->fetchSessions($config, $trace, $deviceErrors, $label);

            if ($deviceErrors === []) {
                if ($isActive) {
                    $answered++;
                }
            } elseif ($isActive) {
                $errors = array_merge($errors, $deviceErrors);
            } else {
                $standbyErrors = array_merge($standbyErrors, $deviceErrors);
            }

            foreach ($sessions as $username => $session) {
                $entry = [
                    'username'     => $username,
                    'server_id'    => (int) $config->id,
                    'server_label' => $label,
                    'ip'           => $session['ip'] ?? '',
                    'mac'          => $session['mac'] ?? '',
                    'session_id'   => $session['id'] ?? '',
                ];

                $byUsername[$username] = $entry;

                $mac = $this->normalizeMac((string) ($session['mac'] ?? ''));
                if ($mac !== '') {
                    $byMac[$mac] = $entry;
                }
            }
        }

        if ($standbyErrors !== []) {
            $this->log('info', 'Standby RADIUS server(s) did not answer the session sweep.', [
                'standby_errors' => $standbyErrors,
                'active_servers' => count($activeIds),
                'answered'       => $answered,
            ]);
        }

        // Partial data is still usable for matching, but a caller about to delete
        // something must be able to see that a device it depends on did not answer.
        // `$answered > 0` guards the case where every live server failed: no errors
        // would be attributed to a standby, and an empty session list must not read
        // as "nobody is online".
        return [
            'available'    => $errors === [] && $answered > 0,
            'by_mac'       => $byMac,
            'by_username'  => $byUsername,
            'errors'       => $errors,
            'standby_errors' => $standbyErrors,
            'server_count' => $configs->count(),
            'active_server_count' => count($activeIds),
        ];
    }

    /**
     * Strip a MAC to its bare hex so RouterOS and SmartOLT formats compare equal.
     */
    private function normalizeMac(string $value): string
    {
        return strtoupper(preg_replace('/[^A-Fa-f0-9]/', '', trim($value)) ?? '');
    }

    // =========================================================================
    // Mutations — each snapshots state, then writes, then logs reversibly
    // =========================================================================

    /**
     * Adopt the device's password as the billing record's password.
     *
     * Writes technical_details and the account's latest job_order in one transaction.
     * No HTTP happens inside it. Re-running once the values already agree is a skip.
     *
     * @return array<string, mixed>
     */
    public function syncPasswordToDb(string $username, string $radPassword): array
    {
        $username = trim($username);

        if ($username === '') {
            return $this->failure('Username is required.');
        }

        $technical = DB::table('technical_details')->where('username', $username)->first();
        if ($technical === null) {
            return $this->failure("No billing record carries the PPPoE username '{$username}'.");
        }

        if ((string) ($technical->pppoe_password ?? '') === $radPassword) {
            return $this->skipped("Billing password for '{$username}' already matches the RADIUS device.");
        }

        $jobOrder = DB::table('job_orders')
            ->where('account_id', $technical->account_id)
            ->orderByDesc('id')
            ->first();

        $previous = [
            'technical_details' => [
                'id'             => (int) $technical->id,
                'pppoe_password' => (string) ($technical->pppoe_password ?? ''),
            ],
            'job_orders' => $jobOrder === null ? null : [
                'id'             => (int) $jobOrder->id,
                'pppoe_username' => (string) ($jobOrder->pppoe_username ?? ''),
                'pppoe_password' => (string) ($jobOrder->pppoe_password ?? ''),
            ],
        ];

        try {
            DB::transaction(function () use ($technical, $jobOrder, $username, $radPassword): void {
                DB::table('technical_details')
                    ->where('id', $technical->id)
                    ->lockForUpdate()
                    ->update(['pppoe_password' => $radPassword, 'updated_at' => now()]);

                if ($jobOrder !== null) {
                    DB::table('job_orders')
                        ->where('id', $jobOrder->id)
                        ->lockForUpdate()
                        ->update([
                            'pppoe_username' => $username,
                            'pppoe_password' => $radPassword,
                            'updated_at'     => now(),
                        ]);
                }
            });
        } catch (Throwable $e) {
            return $this->failure("Failed to write the password for '{$username}': " . $e->getMessage(), $e, ['username' => $username]);
        }

        $this->recordLog(
            'sync_password',
            "Adopted the RADIUS password into billing for '{$username}'.",
            $username,
            $previous,
            [
                'technical_details' => ['id' => (int) $technical->id, 'pppoe_password' => $radPassword],
                'job_orders'        => $jobOrder === null ? null : ['id' => (int) $jobOrder->id, 'pppoe_username' => $username, 'pppoe_password' => $radPassword],
            ],
            null
        );

        return $this->success("Billing password for '{$username}' now matches the RADIUS device.");
    }

    /**
     * Update a subscriber's PPPoE username in the database (technical_details and job_orders)
     * and automatically sync the rename to MikroTik User Manager if present.
     *
     * @param string $currentUsername
     * @param string $newUsername
     * @param int|null $organizationId
     * @param int|null $serverId
     * @return array<string, mixed>
     */
    public function alignUsername(string $currentUsername, string $newUsername, ?int $organizationId = null, ?int $serverId = null): array
    {
        $currentUsername = trim($currentUsername);
        $newUsername     = trim($newUsername);

        if ($currentUsername === '') {
            return $this->failure('Current username is required.');
        }

        if ($newUsername === '') {
            return $this->failure('New username cannot be empty.');
        }

        if ($currentUsername === $newUsername) {
            return $this->skipped("Username is already '{$newUsername}'.");
        }

        $technical = DB::table('technical_details')->where('username', $currentUsername)->first();
        if ($technical === null) {
            return $this->failure("No billing record found with the PPPoE username '{$currentUsername}'.");
        }

        if ($organizationId !== null && $technical->organization_id !== null && (int)$technical->organization_id !== $organizationId) {
            return $this->failure("Subscriber record belongs to another organization.");
        }

        // Check uniqueness of new username
        $conflictTech = DB::table('technical_details')
            ->where('username', $newUsername)
            ->where('id', '!=', $technical->id)
            ->exists();

        if ($conflictTech) {
            return $this->failure("The username '{$newUsername}' is already used by another account in technical details.");
        }

        $jobOrders = DB::table('job_orders')
            ->where('account_id', $technical->account_id)
            ->get();

        $previous = [
            'technical_details' => [
                'id'       => (int) $technical->id,
                'username' => $technical->username,
            ],
            'job_orders_count' => $jobOrders->count(),
        ];

        try {
            DB::transaction(function () use ($technical, $newUsername): void {
                DB::table('technical_details')
                    ->where('id', $technical->id)
                    ->lockForUpdate()
                    ->update([
                        'username'   => $newUsername,
                        'updated_at' => now(),
                    ]);

                DB::table('job_orders')
                    ->where('account_id', $technical->account_id)
                    ->lockForUpdate()
                    ->update([
                        'pppoe_username' => $newUsername,
                        'username'       => $newUsername,
                        'updated_at'     => now(),
                    ]);
            });

            // Automated MikroTik User Manager sync (outside DB transaction per Rule 4.3)
            $routerRenamed = false;
            $located = $this->locateUser($currentUsername, $serverId, null, $organizationId);
            if ($located['success'] && isset($located['config']) && isset($located['user'])) {
                /** @var RadiusConfig $config */
                $config = $located['config'];
                $currentRad = $located['user'];
                try {
                    $routerApi = app(RouterosApiService::class);
                    $renamed = $routerApi->updateUser($config, (string) $currentRad['id'], ['name' => $newUsername]);
                    if ($renamed) {
                        $routerRenamed = true;
                        // Disconnect active session if online so it re-authenticates with new credentials
                        $this->disconnectSession($currentUsername, (int) $config->id, $organizationId);
                    }
                } catch (Throwable $re) {
                    $this->log('warning', "Failed to rename account '{$currentUsername}' on MikroTik router.", [
                        'error' => $re->getMessage(),
                    ]);
                }
            }

            $this->recordLog(
                'align_username',
                "Aligned PPPoE username from '{$currentUsername}' to '{$newUsername}' on database" . ($routerRenamed ? " and MikroTik router." : "."),
                $newUsername,
                $previous,
                ['technical_details' => ['id' => $technical->id, 'username' => $newUsername]],
                $located['config']->id ?? null,
                true,
                ['account_id' => $technical->account_id, 'old_username' => $currentUsername, 'router_renamed' => $routerRenamed]
            );

            // Invalidate snapshot cache so the table refreshes
            Cache::forget(self::SNAPSHOT_PREFIX . self::SERVER_ALL);

            $msg = $routerRenamed
                ? "PPPoE username successfully aligned and updated to '{$newUsername}' on database and MikroTik router."
                : "PPPoE username successfully aligned and updated to '{$newUsername}' on database.";

            return $this->success($msg);
        } catch (Throwable $e) {
            $this->log('error', "Failed to align username from '{$currentUsername}' to '{$newUsername}'.", [
                'error' => $e->getMessage()
            ]);
            return $this->failure("Database error while updating username: " . $e->getMessage());
        }
    }

    /**
     * Push the billing plan's group onto the device.
     *
     * @return array<string, mixed>
     */
    public function syncGroupToMikrotik(string $username, string $targetGroup, ?int $serverId, ?string $radId = null, ?int $organizationId = null): array
    {
        $username    = trim($username);
        $targetGroup = trim($targetGroup);

        if ($username === '' || $targetGroup === '') {
            return $this->failure('Username and target group are both required.');
        }

        $located = $this->locateUser($username, $serverId, $radId, $organizationId);
        if (!$located['success']) {
            return $located;
        }

        /** @var RadiusConfig $config */
        $config  = $located['config'];
        $current = $located['user'];

        if (strcasecmp((string) $current['group'], $targetGroup) === 0 && !$current['disabled']) {
            return $this->skipped("'{$username}' is already in group '{$targetGroup}' on " . $located['label'] . '.');
        }

        $result = $this->callDevice(
            $config,
            'PATCH',
            '/rest/user-manage/user/' . rawurlencode((string) $current['id']),
            ['group' => $targetGroup, 'disabled' => 'false']
        );

        if (!$result['success']) {
            return $this->failure("Could not move '{$username}' to '{$targetGroup}' on " . $located['label'] . ': ' . $result['error']);
        }

        $this->recordLog(
            'sync_group_mikrotik',
            "Moved '{$username}' to RADIUS group '{$targetGroup}' on " . $located['label'] . '.',
            $username,
            ['group' => $current['group'], 'disabled' => $current['disabled'], 'rad_id' => $current['id']],
            ['group' => $targetGroup, 'disabled' => false, 'rad_id' => $current['id']],
            (int) $config->id
        );

        return $this->success("'{$username}' moved to group '{$targetGroup}' on " . $located['label'] . '.');
    }

    /**
     * Adopt the device's group as the billing record's plan.
     *
     * The device holds no price, so the bare group is resolved back to the priced
     * label the billing side stores (e.g. "LITE" -> "LITE - P699.00") using labels
     * already present in the customers table. Without a match the bare group is
     * written and the caller is told the price suffix was not recoverable.
     *
     * @return array<string, mixed>
     */
    public function syncGroupToBilling(string $username, string $radGroup): array
    {
        $username = trim($username);
        $radGroup = trim($radGroup);

        if ($username === '' || $radGroup === '') {
            return $this->failure('Username and RADIUS group are both required.');
        }

        $technical = DB::table('technical_details')->where('username', $username)->first();
        if ($technical === null) {
            return $this->failure("No billing record carries the PPPoE username '{$username}'.");
        }

        $account = DB::table('billing_accounts')->where('id', $technical->account_id)->first();
        if ($account === null || $account->customer_id === null) {
            return $this->failure("'{$username}' has no customer record to update.");
        }

        $customer = DB::table('customers')->where('id', $account->customer_id)->first();
        if ($customer === null) {
            return $this->failure("Customer #{$account->customer_id} for '{$username}' no longer exists.");
        }

        $resolved  = $this->resolvePlanLabel($radGroup);
        $planLabel = $resolved['label'];

        if ((string) ($customer->desired_plan ?? '') === $planLabel
            && (string) ($customer->group_name ?? '') === $planLabel) {
            return $this->skipped("Billing plan for '{$username}' is already '{$planLabel}'.");
        }

        $previous = [
            'customer_id'  => (int) $customer->id,
            'desired_plan' => (string) ($customer->desired_plan ?? ''),
            'group_name'   => (string) ($customer->group_name ?? ''),
        ];

        try {
            DB::transaction(function () use ($customer, $planLabel): void {
                DB::table('customers')
                    ->where('id', $customer->id)
                    ->lockForUpdate()
                    ->update([
                        'desired_plan' => $planLabel,
                        'group_name'   => $planLabel,
                        'updated_at'   => now(),
                    ]);
            });
        } catch (Throwable $e) {
            return $this->failure("Failed to update the billing plan for '{$username}': " . $e->getMessage(), $e, ['username' => $username]);
        }

        $this->recordLog(
            'sync_group_billing',
            "Adopted RADIUS group '{$radGroup}' into billing as '{$planLabel}' for '{$username}'.",
            $username,
            $previous,
            ['customer_id' => (int) $customer->id, 'desired_plan' => $planLabel, 'group_name' => $planLabel],
            null
        );

        $message = "Billing plan for '{$username}' set to '{$planLabel}'.";
        if (!$resolved['matched']) {
            $message .= ' No priced label was found for this group, so the bare group name was written — the price suffix could not be recovered.';
        }

        return $this->success($message);
    }

    /**
     * Park an account in the Restricted group, disable it, and cut any live session.
     *
     * @return array<string, mixed>
     */
    public function restrictAccount(string $username, ?int $serverId, ?string $radId = null, ?int $organizationId = null): array
    {
        $username = trim($username);

        if ($username === '') {
            return $this->failure('Username is required.');
        }

        $located = $this->locateUser($username, $serverId, $radId, $organizationId);
        if (!$located['success']) {
            return $located;
        }

        /** @var RadiusConfig $config */
        $config  = $located['config'];
        $current = $located['user'];

        if (strcasecmp((string) $current['group'], self::RESTRICTED_GROUP) === 0 && $current['disabled']) {
            return $this->skipped("'{$username}' is already restricted on " . $located['label'] . '.');
        }

        $result = $this->callDevice(
            $config,
            'PATCH',
            '/rest/user-manage/user/' . rawurlencode((string) $current['id']),
            ['group' => self::RESTRICTED_GROUP, 'disabled' => 'true']
        );

        if (!$result['success']) {
            return $this->failure("Could not restrict '{$username}' on " . $located['label'] . ': ' . $result['error']);
        }

        $killed = $this->killSessions($config, $username);

        $this->recordLog(
            'restrict',
            "Restricted '{$username}' on " . $located['label'] . ($killed > 0 ? " and cut {$killed} session(s)." : '.'),
            $username,
            ['group' => $current['group'], 'disabled' => $current['disabled'], 'rad_id' => $current['id']],
            ['group' => self::RESTRICTED_GROUP, 'disabled' => true, 'rad_id' => $current['id']],
            (int) $config->id
        );

        return $this->success(
            "'{$username}' restricted on " . $located['label'] . ($killed > 0 ? " and {$killed} live session(s) terminated." : '.')
        );
    }

    /**
     * Terminate every live session for an account.
     *
     * Not reversible — a cut session cannot be un-cut, so the log entry is written
     * with reversible = false rather than offering an undo that would do nothing.
     *
     * @return array<string, mixed>
     */
    public function disconnectSession(string $username, ?int $serverId, ?int $organizationId = null): array
    {
        $username = trim($username);

        if ($username === '') {
            return $this->failure('Username is required.');
        }

        $configs = $serverId === null
            ? $this->resolver->orderedConfigs($organizationId)
            : collect(array_filter([$this->configById($serverId, $organizationId)]));

        if ($configs->isEmpty()) {
            return $this->failure('No RADIUS server matched the requested target.');
        }

        $killed = 0;
        $hit    = [];

        foreach ($configs as $config) {
            $count = $this->killSessions($config, $username);
            if ($count > 0) {
                $killed += $count;
                $hit[]   = $this->labelFor($config, $organizationId);
            }
        }

        if ($killed === 0) {
            return $this->skipped("'{$username}' has no live session to terminate.");
        }

        $this->recordLog(
            'disconnect',
            "Terminated {$killed} live session(s) for '{$username}' on " . implode(', ', $hit) . '.',
            $username,
            ['sessions_terminated' => 0],
            ['sessions_terminated' => $killed, 'servers' => $hit],
            $serverId,
            false
        );

        return $this->success("Terminated {$killed} live session(s) for '{$username}'.");
    }

    /**
     * Create an account on a named device.
     *
     * @return array<string, mixed>
     */
    public function addToRadius(string $username, string $password, string $group, int $serverId, ?int $organizationId = null): array
    {
        $username = trim($username);
        $group    = trim($group) ?: 'Default';
        $password = $password !== '' ? $password : self::DEFAULT_NEW_PASSWORD;

        if ($username === '') {
            return $this->failure('Username is required.');
        }

        $config = $this->configById($serverId, $organizationId);
        if ($config === null) {
            return $this->failure("RADIUS server #{$serverId} does not exist.");
        }

        $label = $this->labelFor($config, $organizationId);

        // Creating a user that already exists would duplicate it on the device, which
        // is precisely the defect this tool reports — so check first, always.
        $existing = $this->findUserOnConfig($config, $username);
        if ($existing !== null) {
            return $this->skipped("'{$username}' already exists on {$label}.");
        }

        $result = $this->callDevice($config, 'PUT', '/rest/user-manage/user', [
            'name'     => $username,
            'group'    => $group,
            'password' => $password,
            'disabled' => 'false',
        ]);

        if (!$result['success']) {
            return $this->failure("Could not create '{$username}' on {$label}: " . $result['error']);
        }

        $createdId = is_array($result['data']) ? (string) ($result['data']['.id'] ?? '') : '';

        $this->recordLog(
            'add_user',
            "Created '{$username}' in group '{$group}' on {$label}.",
            $username,
            ['exists' => false],
            ['exists' => true, 'group' => $group, 'rad_id' => $createdId],
            (int) $config->id
        );

        return $this->success("'{$username}' created on {$label} in group '{$group}'.");
    }

    /**
     * Remove an account from a named device.
     *
     * The full pre-delete record is snapshotted so undo can recreate it, password
     * included — that snapshot lives in activity_logs.additional_data and is the one
     * place this service stores a credential, because undo is impossible without it.
     *
     * @return array<string, mixed>
     */
    public function deleteFromRadius(string $username, ?string $radId, int $serverId, ?int $organizationId = null): array
    {
        $username = trim($username);

        if ($username === '') {
            return $this->failure('Username is required.');
        }

        $config = $this->configById($serverId, $organizationId);
        if ($config === null) {
            return $this->failure("RADIUS server #{$serverId} does not exist.");
        }

        $label   = $this->labelFor($config, $organizationId);
        $current = $this->findUserOnConfig($config, $username);

        if ($current === null) {
            return $this->skipped("'{$username}' is not present on {$label}.");
        }

        $result = $this->callDevice($config, 'POST', '/rest/user-manage/user/remove', [
            'numbers' => (string) $current['id'],
        ]);

        if (!$result['success']) {
            return $this->failure("Could not delete '{$username}' from {$label}: " . $result['error']);
        }

        $this->recordLog(
            'delete_user',
            "Deleted '{$username}' from {$label}.",
            $username,
            [
                'exists'   => true,
                'group'    => $current['group'],
                'password' => $current['password'],
                'disabled' => $current['disabled'],
                'rad_id'   => $current['id'],
            ],
            ['exists' => false],
            (int) $config->id
        );

        return $this->success("'{$username}' deleted from {$label}.");
    }

    /**
     * Resolve a cross-server duplicate by keeping one copy and removing the other.
     *
     * Refuses to act unless the account really is present on both named devices, so
     * a stale UI row cannot turn this into an ordinary delete.
     *
     * @return array<string, mixed>
     */
    public function resolveDuplicate(string $username, int $keepServerId, int $removeServerId, ?int $organizationId = null): array
    {
        $username = trim($username);

        if ($username === '') {
            return $this->failure('Username is required.');
        }

        if ($keepServerId === $removeServerId) {
            return $this->failure('The server to keep and the server to clear must be different.');
        }

        $keepConfig   = $this->configById($keepServerId, $organizationId);
        $removeConfig = $this->configById($removeServerId, $organizationId);

        if ($keepConfig === null || $removeConfig === null) {
            return $this->failure('One or both of the named RADIUS servers do not exist.');
        }

        if (trim((string) $keepConfig->ip) === trim((string) $removeConfig->ip)) {
            return $this->failure("Cannot resolve duplicate: both configurations point to the same IP ({$keepConfig->ip}). One is a fallback connection, not a separate server.");
        }

        $keepLabel   = $this->labelFor($keepConfig, $organizationId);
        $removeLabel = $this->labelFor($removeConfig, $organizationId);

        $onKeep   = $this->findUserOnConfig($keepConfig, $username);
        $onRemove = $this->findUserOnConfig($removeConfig, $username);

        if ($onKeep === null) {
            return $this->failure("'{$username}' is not on {$keepLabel}, so there is nothing to keep. Refusing to delete the only remaining copy.");
        }

        if ($onRemove === null) {
            return $this->skipped("'{$username}' is no longer on {$removeLabel} — the duplicate is already resolved.");
        }

        $result = $this->callDevice($removeConfig, 'POST', '/rest/user-manage/user/remove', [
            'numbers' => (string) $onRemove['id'],
        ]);

        if (!$result['success']) {
            return $this->failure("Could not remove the duplicate of '{$username}' from {$removeLabel}: " . $result['error']);
        }

        $this->killSessions($removeConfig, $username);

        $this->recordLog(
            'delete_duplicate',
            "Removed the duplicate of '{$username}' from {$removeLabel}, keeping the copy on {$keepLabel}.",
            $username,
            [
                'exists'   => true,
                'group'    => $onRemove['group'],
                'password' => $onRemove['password'],
                'disabled' => $onRemove['disabled'],
                'rad_id'   => $onRemove['id'],
            ],
            ['exists' => false],
            (int) $removeConfig->id,
            true,
            ['kept_server_id' => (int) $keepConfig->id, 'kept_server_label' => $keepLabel]
        );

        return $this->success("Duplicate of '{$username}' removed from {$removeLabel}. The copy on {$keepLabel} was left untouched.");
    }

    // =========================================================================
    // Batch
    // =========================================================================

    /**
     * Run one operation across many accounts.
     *
     * Each account is isolated: its own try/catch, its own transaction where a
     * transaction is needed, its own audit entry. One failure never rolls back or
     * aborts the rest, and a re-run of a completed batch reports every item as
     * skipped with failed = 0.
     *
     * @param array<int, array<string, mixed>> $users
     * @return array{success: int, failed: int, skipped: int, errors: array<int, string>, data: array<int, array<string, mixed>>}
     */
    public function bulkAction(string $operation, array $users, ?string $serverId = null, ?int $organizationId = null): array
    {
        $result = ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => [], 'data' => []];

        if (!in_array($operation, self::BULK_OPERATIONS, true)) {
            $result['failed'] = count($users);
            $result['errors'][] = "Unknown bulk operation '{$operation}'.";
            return $result;
        }

        $defaultServerId = ($serverId !== null && $serverId !== '' && strtolower($serverId) !== self::SERVER_ALL)
            ? (int) $serverId
            : null;

        $this->log('info', "Bulk '{$operation}' starting for " . count($users) . ' account(s).', [
            'operation' => $operation,
            'server_id' => $serverId ?? self::SERVER_ALL,
        ]);

        foreach ($users as $item) {
            $username = trim((string) ($item['username'] ?? ''));

            if ($username === '') {
                $result['failed']++;
                $result['errors'][] = 'An entry in the batch carried no username.';
                continue;
            }

            $itemServerId = isset($item['server_id']) && $item['server_id'] !== null && $item['server_id'] !== ''
                ? (int) $item['server_id']
                : $defaultServerId;

            try {
                $outcome = match ($operation) {
                    'sync_passwords'      => $this->syncPasswordToDb($username, (string) ($item['rad_password'] ?? '')),
                    'sync_group_mikrotik' => $this->syncGroupToMikrotik($username, (string) ($item['target_group'] ?? ''), $itemServerId, $item['rad_id'] ?? null, $organizationId),
                    'sync_group_billing'  => $this->syncGroupToBilling($username, (string) ($item['rad_group'] ?? '')),
                    'restrict'            => $this->restrictAccount($username, $itemServerId, $item['rad_id'] ?? null, $organizationId),
                    'disconnect'          => $this->disconnectSession($username, $itemServerId, $organizationId),
                    'delete'              => $itemServerId === null
                        ? $this->failure("'{$username}' cannot be deleted without naming the server it lives on.")
                        : $this->deleteFromRadius($username, $item['rad_id'] ?? null, $itemServerId, $organizationId),
                    'align_username'      => empty($item['suggested_username'])
                        ? $this->skipped("No suggested username available to align '{$username}'.")
                        : $this->alignUsername($username, (string) $item['suggested_username'], $organizationId, $itemServerId),
                    default               => $this->failure("Unknown bulk operation '{$operation}'."),
                };

                if ($outcome['skipped'] ?? false) {
                    $result['skipped']++;
                } elseif ($outcome['success']) {
                    $result['success']++;
                } else {
                    $result['failed']++;
                    $result['errors'][] = $username . ': ' . $outcome['message'];
                }

                $result['data'][] = [
                    'username' => $username,
                    'status'   => ($outcome['skipped'] ?? false) ? 'skipped' : ($outcome['success'] ? 'success' : 'failed'),
                    'message'  => $outcome['message'],
                ];
            } catch (Throwable $e) {
                $result['failed']++;
                $result['errors'][] = $username . ': ' . $e->getMessage();
                $result['data'][]   = ['username' => $username, 'status' => 'failed', 'message' => $e->getMessage()];

                $this->log('error', "Bulk '{$operation}' failed for an account.", [
                    'username'  => $username,
                    'operation' => $operation,
                    'error'     => $e->getMessage(),
                ]);
            }
        }

        $this->log('info', "Bulk '{$operation}' finished.", [
            'operation' => $operation,
            'success'   => $result['success'],
            'failed'    => $result['failed'],
            'skipped'   => $result['skipped'],
        ]);

        return $result;
    }

    // =========================================================================
    // Unattended daily reconciliation
    // =========================================================================

    /**
     * The nightly pass: audit every device, then close the gaps that are safe to
     * close without an operator watching.
     *
     * Three things happen here and nothing else. Passwords the billing database is
     * missing are adopted from the device. Plan groups that disagree are settled in
     * favour of whichever side the caller nominates as authoritative. Accounts
     * billing has already written off keep their service withheld on the device.
     *
     * What it deliberately will not do unattended: create a RADIUS account that does
     * not exist, delete one that has no billing record, or resolve a cross-server
     * duplicate. Each of those either provisions or removes service on a judgement
     * call, and they stay in the operator's tool where a human sees them first.
     *
     * Every device call happens before any write and no HTTP runs inside a
     * transaction — the individual mutations own their own narrow ones.
     *
     * Idempotent by construction: each mutation compares current state first and
     * reports `skipped` when the two sides already agree, so a second run the same
     * night ends with success = 0 and failed = 0.
     *
     * @param array{
     *     authority?: string,
     *     sync_passwords?: bool,
     *     reconcile_groups?: bool,
     *     enforce_restricted?: bool,
     *     dry_run?: bool,
     *     server_id?: string|null
     * } $options
     * @return array{success:int,failed:int,skipped:int,errors:array<int,mixed>,actions:array<int,array<string,string>>,summary:array<string,int>}
     */
    public function runDailyReconciliation(array $options = [], ?int $organizationId = null): array
    {
        $result = ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => [], 'actions' => [], 'summary' => $this->emptySummary()];

        $authority        = strtolower((string) ($options['authority'] ?? self::AUTHORITY_BILLING));
        $syncPasswords    = (bool) ($options['sync_passwords'] ?? true);
        $reconcileGroups  = (bool) ($options['reconcile_groups'] ?? true);
        $enforceRestrict  = (bool) ($options['enforce_restricted'] ?? true);
        $dryRun           = (bool) ($options['dry_run'] ?? false);
        $serverId         = $options['server_id'] ?? null;

        if (!in_array($authority, [self::AUTHORITY_BILLING, self::AUTHORITY_RADIUS], true)) {
            $result['errors'][] = "Unknown master authority '{$authority}'. Use 'billing' or 'radius'.";
            $result['failed']++;

            return $result;
        }

        $this->log('info', 'Daily RADIUS reconciliation starting.', [
            'authority'          => $authority,
            'sync_passwords'     => $syncPasswords,
            'reconcile_groups'   => $reconcileGroups,
            'enforce_restricted' => $enforceRestrict,
            'dry_run'            => $dryRun,
            'server_id'          => $serverId ?? self::SERVER_ALL,
        ]);

        // ---- Read everything first, outside every transaction ----------------
        try {
            $audit = $this->fetchReconciliationData($serverId, $organizationId);
        } catch (Throwable $e) {
            $this->log('error', 'Daily reconciliation could not read the estate.', ['error' => $e->getMessage()]);
            $result['errors'][] = 'Audit failed: ' . $e->getMessage();
            $result['failed']++;

            return $result;
        }

        $result['summary'] = $audit['summary'];

        foreach ($audit['errors'] as $error) {
            // A device that did not answer is reported but does not stop the pass;
            // the rows it would have contributed simply are not there to act on.
            $result['errors'][] = $error;
        }

        foreach ($audit['rows'] as $row) {
            $username = (string) $row['username'];

            try {
                // 1. Adopt a password the billing database never received.
                if ($syncPasswords && $this->needsPasswordAdoption($row)) {
                    $this->applyStep(
                        $result,
                        $username,
                        'sync_password',
                        $dryRun,
                        fn (): array => $this->syncPasswordToDb($username, (string) $row['rad_password'])
                    );
                }

                // 2. Settle a plan-group disagreement in favour of the nominated side.
                if ($reconcileGroups && $row['state'] === self::STATE_GROUP_MISMATCH) {
                    $this->applyStep(
                        $result,
                        $username,
                        'reconcile_group_' . $authority,
                        $dryRun,
                        $authority === self::AUTHORITY_BILLING
                            ? fn (): array => $this->syncGroupToMikrotik(
                                $username,
                                (string) $row['bill_target_group'],
                                $row['server_id'] !== null ? (int) $row['server_id'] : null,
                                $row['rad_id'],
                                $organizationId
                            )
                            : fn (): array => $this->syncGroupToBilling($username, (string) $row['rad_group'])
                    );
                }

                // 3. Keep service withheld where billing has written the account off.
                if ($enforceRestrict && $this->needsRestriction($row)) {
                    $this->applyStep(
                        $result,
                        $username,
                        'restrict',
                        $dryRun,
                        fn (): array => $this->restrictAccount(
                            $username,
                            $row['server_id'] !== null ? (int) $row['server_id'] : null,
                            $row['rad_id'],
                            $organizationId
                        )
                    );
                }
            } catch (Throwable $e) {
                // One account must never abandon the rest of the estate.
                $result['failed']++;
                $result['errors'][] = ['username' => $username, 'error' => $e->getMessage()];

                $this->log('error', 'Daily reconciliation failed for an account.', [
                    'username' => $username,
                    'state'    => $row['state'],
                    'error'    => $e->getMessage(),
                ]);
            }
        }

        $this->log('info', 'Daily RADIUS reconciliation finished.', [
            'success' => $result['success'],
            'failed'  => $result['failed'],
            'skipped' => $result['skipped'],
        ]);

        return $result;
    }

    /**
     * Run one unattended mutation and fold its outcome into the batch counters.
     *
     * @param array<string, mixed>       $result
     * @param callable(): array<string, mixed> $mutation
     * @return bool whether the step did anything at all
     */
    private function applyStep(array &$result, string $username, string $action, bool $dryRun, callable $mutation): bool
    {
        if ($dryRun) {
            $result['skipped']++;
            $result['actions'][] = ['username' => $username, 'action' => $action, 'outcome' => 'dry_run'];

            return true;
        }

        $outcome = $mutation();

        if (($outcome['skipped'] ?? false) === true) {
            // Already in the desired state — the shape a re-run takes.
            $result['skipped']++;
            $result['actions'][] = ['username' => $username, 'action' => $action, 'outcome' => 'skipped'];

            return true;
        }

        if (($outcome['success'] ?? false) === true) {
            $result['success']++;
            $result['actions'][] = ['username' => $username, 'action' => $action, 'outcome' => 'applied'];

            return true;
        }

        $result['failed']++;
        $result['errors'][] = ['username' => $username, 'action' => $action, 'error' => $outcome['message'] ?? 'Unknown failure.'];
        $result['actions'][] = ['username' => $username, 'action' => $action, 'outcome' => 'failed'];

        return true;
    }

    /**
     * Should the billing record adopt the device's password?
     *
     * Only when billing has nothing and the device has something. A password that
     * differs on both sides is a real conflict and is left for the operator — the
     * device could be the stale copy, and overwriting billing would erase the
     * credential the technician actually configured.
     *
     * @param array<string, mixed> $row
     */
    private function needsPasswordAdoption(array $row): bool
    {
        return $row['account_no'] !== null
            && trim((string) ($row['db_password'] ?? '')) === ''
            && trim((string) ($row['rad_password'] ?? '')) !== '';
    }

    /**
     * Should this account be withheld on the device?
     *
     * Billing has written it off, it is matched to a real billing record, and the
     * device is still serving it. An account with no billing record is never touched
     * here — that is an orphan, and orphans are an operator decision.
     *
     * @param array<string, mixed> $row
     */
    private function needsRestriction(array $row): bool
    {
        if ($row['account_no'] === null || $row['state'] === self::STATE_MISSING_RADIUS) {
            return false;
        }

        $status = $row['billing_status_id'] ?? null;
        if ($status === null || !in_array((int) $status, self::INACTIVE_BILLING_STATUS_IDS, true)) {
            return false;
        }

        // Already withheld: disabled and sitting in a restricted group.
        $alreadyRestricted = ($row['rad_disabled'] ?? false) === true
            && in_array(strtolower(trim((string) ($row['rad_group'] ?? ''))), self::RESTRICTED_GROUPS, true);

        return !$alreadyRestricted;
    }

    // =========================================================================
    // Undo
    // =========================================================================

    /**
     * Reverse a previously logged mutation back to its snapshotted state.
     *
     * Guarded twice: the entry must be marked reversible, and it must not already
     * have been reversed — so a double-click or a re-post is a skip, never a second
     * write. The reversal itself is recorded as its own log entry.
     *
     * @return array<string, mixed>
     */
    public function undoOperation(int $logId, ?int $organizationId = null): array
    {
        $entry = ActivityLog::where('log_id', $logId)
            ->where('resource_type', self::RESOURCE_TYPE)
            ->first();

        if ($entry === null) {
            return $this->failure("Operation log #{$logId} does not exist.");
        }

        $data = is_array($entry->additional_data) ? $entry->additional_data : [];

        if (($data['reversible'] ?? false) !== true) {
            return $this->failure('This operation was recorded as not reversible.');
        }

        if (($data['reversed'] ?? false) === true) {
            return $this->skipped("Operation #{$logId} has already been reversed.");
        }

        $username = (string) ($data['username'] ?? '');
        $previous = is_array($data['previous_state'] ?? null) ? $data['previous_state'] : [];
        $serverId = $data['server_id'] ?? null;

        if ($username === '') {
            return $this->failure("Operation #{$logId} carries no target username and cannot be reversed.");
        }

        try {
            $outcome = match ($entry->action) {
                'sync_password'                        => $this->undoPasswordSync($previous),
                'align_username'                       => $this->undoAlignUsername($previous, $username),
                'sync_group_billing'                   => $this->undoBillingGroup($previous),
                'sync_group_mikrotik', 'restrict'      => $this->undoDeviceGroup($username, $previous, $serverId, $organizationId),
                'add_user'                             => $this->undoAdd($username, $serverId, $organizationId),
                'delete_user', 'delete_duplicate'      => $this->undoDelete($username, $previous, $serverId, $organizationId),
                default                                => $this->failure("No reversal is defined for action '{$entry->action}'."),
            };
        } catch (Throwable $e) {
            $this->log('error', 'Undo failed.', ['log_id' => $logId, 'action' => $entry->action, 'error' => $e->getMessage()]);
            return $this->failure("Undo of operation #{$logId} failed: " . $e->getMessage());
        }

        if (!$outcome['success'] && !($outcome['skipped'] ?? false)) {
            return $outcome;
        }

        // Stamp the original entry first, so a concurrent retry sees it as reversed.
        $data['reversed']    = true;
        $data['reversed_at'] = now()->toIso8601String();
        $data['reversed_by'] = auth()->id();
        $entry->additional_data = $data;
        $entry->save();

        $this->recordLog(
            'undo_' . $entry->action,
            "Reversed operation #{$logId} ({$entry->action}) for '{$username}'.",
            $username,
            is_array($data['new_state'] ?? null) ? $data['new_state'] : [],
            $previous,
            is_numeric($serverId) ? (int) $serverId : null,
            false,
            ['reverted_log_id' => $logId]
        );

        return $this->success("Operation #{$logId} reversed. " . $outcome['message']);
    }

    /**
     * @param array<string, mixed> $previous
     * @return array<string, mixed>
     */
    private function undoPasswordSync(array $previous): array
    {
        $technical = is_array($previous['technical_details'] ?? null) ? $previous['technical_details'] : null;
        $jobOrder  = is_array($previous['job_orders'] ?? null) ? $previous['job_orders'] : null;

        if ($technical === null) {
            return $this->failure('The snapshot holds no technical_details state to restore.');
        }

        DB::transaction(function () use ($technical, $jobOrder): void {
            DB::table('technical_details')
                ->where('id', $technical['id'])
                ->lockForUpdate()
                ->update(['pppoe_password' => $technical['pppoe_password'], 'updated_at' => now()]);

            if ($jobOrder !== null) {
                DB::table('job_orders')
                    ->where('id', $jobOrder['id'])
                    ->lockForUpdate()
                    ->update([
                        'pppoe_username' => $jobOrder['pppoe_username'],
                        'pppoe_password' => $jobOrder['pppoe_password'],
                        'updated_at'     => now(),
                    ]);
            }
        });

        return $this->success('The previous billing password was restored.');
    }

    /**
     * Reversal for align_username.
     *
     * @param array<string, mixed> $previous
     * @param string $currentUsername
     * @return array<string, mixed>
     */
    private function undoAlignUsername(array $previous, string $currentUsername): array
    {
        $technical = is_array($previous['technical_details'] ?? null) ? $previous['technical_details'] : null;

        if ($technical === null || empty($technical['username'])) {
            return $this->failure('The snapshot holds no previous username state to restore.');
        }

        $oldUsername = $technical['username'];
        $techId      = (int) $technical['id'];

        try {
            DB::transaction(function () use ($techId, $oldUsername): void {
                DB::table('technical_details')
                    ->where('id', $techId)
                    ->lockForUpdate()
                    ->update(['username' => $oldUsername, 'updated_at' => now()]);

                $techRow = DB::table('technical_details')->where('id', $techId)->first();
                if ($techRow) {
                    DB::table('job_orders')
                        ->where('account_id', $techRow->account_id)
                        ->lockForUpdate()
                        ->update([
                            'pppoe_username' => $oldUsername,
                            'username'       => $oldUsername,
                            'updated_at'     => now(),
                        ]);
                }
            });

            Cache::forget(self::SNAPSHOT_PREFIX . self::SERVER_ALL);

            return $this->success("The previous username '{$oldUsername}' was restored.");
        } catch (Throwable $e) {
            return $this->failure("Failed to restore username to '{$oldUsername}': " . $e->getMessage());
        }
    }

    /**
     * @param array<string, mixed> $previous
     * @return array<string, mixed>
     */
    private function undoBillingGroup(array $previous): array
    {
        if (!isset($previous['customer_id'])) {
            return $this->failure('The snapshot holds no customer to restore.');
        }

        DB::transaction(function () use ($previous): void {
            DB::table('customers')
                ->where('id', $previous['customer_id'])
                ->lockForUpdate()
                ->update([
                    'desired_plan' => $previous['desired_plan'] ?? null,
                    'group_name'   => $previous['group_name'] ?? null,
                    'updated_at'   => now(),
                ]);
        });

        return $this->success('The previous billing plan was restored.');
    }

    /**
     * @param array<string, mixed> $previous
     * @return array<string, mixed>
     */
    private function undoDeviceGroup(string $username, array $previous, mixed $serverId, ?int $organizationId): array
    {
        $config = is_numeric($serverId) ? $this->configById((int) $serverId, $organizationId) : null;
        if ($config === null) {
            return $this->failure('The RADIUS server named in the snapshot no longer exists.');
        }

        $current = $this->findUserOnConfig($config, $username);
        if ($current === null) {
            return $this->failure("'{$username}' is no longer present on that RADIUS server.");
        }

        $result = $this->callDevice($config, 'PATCH', '/rest/user-manage/user/' . rawurlencode((string) $current['id']), [
            'group'    => (string) ($previous['group'] ?? 'Default'),
            'disabled' => ($previous['disabled'] ?? false) ? 'true' : 'false',
        ]);

        if (!$result['success']) {
            return $this->failure('The RADIUS device rejected the reversal: ' . $result['error']);
        }

        return $this->success("'{$username}' was returned to group '" . ($previous['group'] ?? 'Default') . "'.");
    }

    /**
     * @return array<string, mixed>
     */
    private function undoAdd(string $username, mixed $serverId, ?int $organizationId): array
    {
        $config = is_numeric($serverId) ? $this->configById((int) $serverId, $organizationId) : null;
        if ($config === null) {
            return $this->failure('The RADIUS server named in the snapshot no longer exists.');
        }

        $current = $this->findUserOnConfig($config, $username);
        if ($current === null) {
            return $this->skipped("'{$username}' is already absent from that RADIUS server.");
        }

        $result = $this->callDevice($config, 'POST', '/rest/user-manage/user/remove', ['numbers' => (string) $current['id']]);

        if (!$result['success']) {
            return $this->failure('The RADIUS device rejected the removal: ' . $result['error']);
        }

        return $this->success("'{$username}' was removed again.");
    }

    /**
     * @param array<string, mixed> $previous
     * @return array<string, mixed>
     */
    private function undoDelete(string $username, array $previous, mixed $serverId, ?int $organizationId): array
    {
        $config = is_numeric($serverId) ? $this->configById((int) $serverId, $organizationId) : null;
        if ($config === null) {
            return $this->failure('The RADIUS server named in the snapshot no longer exists.');
        }

        $current = $this->findUserOnConfig($config, $username);
        if ($current !== null) {
            return $this->skipped("'{$username}' already exists on that RADIUS server.");
        }

        $result = $this->callDevice($config, 'PUT', '/rest/user-manage/user', [
            'name'     => $username,
            'group'    => (string) ($previous['group'] ?? 'Default'),
            'password' => (string) ($previous['password'] ?? self::DEFAULT_NEW_PASSWORD),
            'disabled' => ($previous['disabled'] ?? false) ? 'true' : 'false',
        ]);

        if (!$result['success']) {
            return $this->failure('The RADIUS device rejected the re-creation: ' . $result['error']);
        }

        return $this->success("'{$username}' was recreated from the snapshot.");
    }

    // =========================================================================
    // Logs & export
    // =========================================================================

    /**
     * Recent operations from this tool, newest first, shaped for the UI's log tab.
     *
     * The stored snapshots can hold a credential (delete/undo needs it), so the
     * password fields are masked on the way out — the UI never needs their value.
     *
     * @return array<int, array<string, mixed>>
     */
    public function getLogs(int $limit = 50, ?int $organizationId = null): array
    {
        $query = ActivityLog::with('user')
            ->where('resource_type', self::RESOURCE_TYPE)
            ->orderByDesc('created_at')
            ->limit(max(1, min($limit, 500)));

        if ($organizationId !== null) {
            $query->where(function ($q) use ($organizationId): void {
                $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
            });
        }

        return $query->get()->map(function (ActivityLog $entry): array {
            $data = is_array($entry->additional_data) ? $entry->additional_data : [];

            return [
                'log_id'         => (int) $entry->log_id,
                'created_at'     => optional($entry->created_at)->toIso8601String(),
                'level'          => $entry->level,
                'action'         => $entry->action,
                'message'        => $entry->message,
                'operator'       => $entry->user?->username ?? $entry->user?->email_address ?? 'System',
                'username'       => $data['username'] ?? null,
                'server_id'      => $data['server_id'] ?? null,
                'server_label'   => $data['server_label'] ?? null,
                'previous_state' => $this->maskSecrets(is_array($data['previous_state'] ?? null) ? $data['previous_state'] : []),
                'new_state'      => $this->maskSecrets(is_array($data['new_state'] ?? null) ? $data['new_state'] : []),
                'reversible'     => (bool) ($data['reversible'] ?? false),
                'reversed'       => (bool) ($data['reversed'] ?? false),
                'reversed_at'    => $data['reversed_at'] ?? null,
            ];
        })->all();
    }

    /**
     * Reconciliation rows as CSV, filtered by state.
     *
     * Reads the dataset fresh rather than trusting a client-side selection, so an
     * export always covers every matching row and not just the visible page.
     *
     * @return array{filename: string, headers: array<int, string>, rows: array<int, array<int, mixed>>}
     */
    public function exportCsv(string $filter = 'all', ?string $serverId = null, ?int $organizationId = null): array
    {
        $data = $this->fetchReconciliationData($serverId, $organizationId);
        $rows = $data['rows'];

        if ($filter !== 'all' && in_array($filter, self::STATES, true)) {
            $rows = array_values(array_filter($rows, static fn (array $r): bool => $r['state'] === $filter));
        }

        $headers = [
            'Username', 'Account No', 'Customer', 'State', 'Server', 'RADIUS Group',
            'Billing Plan', 'Password Match', 'Disabled', 'Online', 'Duplicate Servers',
        ];

        $csvRows = array_map(static function (array $r): array {
            return [
                $r['username'],
                $r['account_no'] ?? '',
                $r['customer_name'] ?? '',
                $r['state'],
                $r['server_label'],
                $r['rad_group'] ?? '',
                $r['bill_group'] ?? '',
                ((string) $r['rad_password'] !== '' && (string) $r['rad_password'] === (string) $r['db_password']) ? 'yes' : 'no',
                ($r['rad_disabled'] ?? false) ? 'yes' : 'no',
                $r['online'] ? 'yes' : 'no',
                count($r['duplicate_servers']) > 1 ? implode(' | ', $r['duplicate_servers']) : '',
            ];
        }, $rows);

        return [
            'filename' => 'radius-reconciliation-' . $filter . '-' . now()->format('Ymd-His') . '.csv',
            'headers'  => $headers,
            'rows'     => $csvRows,
        ];
    }

    // =========================================================================
    // Device I/O
    // =========================================================================

    /**
     * Call one RADIUS device over the native RouterOS API.
     *
     * The (method, path, payload) tuple is retained as this service's internal calling
     * convention — every mutation site already speaks it, and the reversal snapshots in
     * activity_logs are written around it — but it is now TRANSLATED into RouterosApiService
     * calls rather than issued as REST. `status` keeps its HTTP-like shape so callers and
     * the trace stay readable: 200 for a successful read, 204 for a successful mutation,
     * 0 when the device could not be reached at all.
     *
     * Always outside a database transaction — every caller here either takes no
     * transaction at all or closes it before reaching this method.
     *
     * @param array<string, mixed>|null $payload
     * @param array<int, array<string, string>>|null $trace
     * @return array{success: bool, status: int, data: mixed, error: string}
     */
    private function callDevice(
        RadiusConfig $config,
        string $method,
        string $path,
        ?array $payload = null,
        ?array &$trace = null,
        string $label = ''
    ): array {
        $method  = strtoupper($method);
        $payload = $payload ?? [];
        $api     = app(RouterosApiService::class);

        try {
            if (!$api->connect($config)) {
                $error = $api->getLastError() !== '' ? $api->getLastError() : 'No RADIUS endpoint responded.';

                if ($trace !== null) {
                    $this->trace($trace, trim($label . ' ' . $config->ip . ' unreachable: ' . $error), 'ERROR');
                }

                $this->log('error', 'RADIUS device unreachable.', [
                    'radius_config_id' => $config->id,
                    'radius_ip'        => $config->ip,
                    'method'           => $method,
                    'path'             => $path,
                    'error'            => $error,
                ]);

                return ['success' => false, 'status' => 0, 'data' => null, 'error' => $error];
            }

            $outcome = $this->dispatchDeviceCall($api, $config, $method, $path, $payload);
        } catch (Throwable $e) {
            $outcome = ['success' => false, 'status' => 0, 'data' => null, 'error' => $e->getMessage()];
        }

        if ($trace !== null) {
            $this->trace(
                $trace,
                trim($label . ' ' . $method . ' ' . $path) . ' → ' . ($outcome['success'] ? 'OK ' . $outcome['status'] : $outcome['error']),
                $outcome['success'] ? 'DEBUG' : 'WARNING'
            );
        }

        if (!$outcome['success']) {
            $this->log('error', 'RADIUS device call failed.', [
                'radius_config_id' => $config->id,
                'radius_ip'        => $config->ip,
                'method'           => $method,
                'path'             => $path,
                'error'            => $outcome['error'],
            ]);
        }

        return $outcome;
    }

    /**
     * Translate one (method, path, payload) tuple into a RouterosApiService call.
     *
     * @param array<string, mixed> $payload
     * @return array{success: bool, status: int, data: mixed, error: string}
     */
    private function dispatchDeviceCall(
        RouterosApiService $api,
        RadiusConfig $config,
        string $method,
        string $path,
        array $payload
    ): array {
        $route = strtok($path, '?');
        $route = $route === false ? $path : $route;
        $route = rtrim($route, '/');

        // Reads
        if ($method === 'GET') {
            if ($route === '/rest/user-manage/user') {
                $name = $this->pathQueryValue($path, 'name');
                $rows = $name !== null
                    ? array_values(array_filter(
                        [$api->findUser($config, $name)],
                        static fn ($row): bool => $row !== null
                    ))
                    : $api->getAllUsers($config);

                return $this->deviceSuccess(array_map([$this, 'restShapeUser'], $rows));
            }

            if ($route === '/rest/user-manage/session') {
                $user     = $this->pathQueryValue($path, 'user');
                $sessions = $api->getActiveSessions($config, $user);

                return $this->deviceSuccess(array_map([$this, 'restShapeSession'], $sessions));
            }
        }

        // Create
        if ($method === 'PUT' && $route === '/rest/user-manage/user') {
            $created = $api->addUser(
                $config,
                (string) ($payload['name'] ?? ''),
                (string) ($payload['password'] ?? ''),
                (string) ($payload['group'] ?? ''),
                ($payload['disabled'] ?? 'false') === 'true' || ($payload['disabled'] ?? false) === true
            );

            if (!$created) {
                return $this->deviceFailure($api);
            }

            $user = $api->findUser($config, (string) ($payload['name'] ?? ''));

            return ['success' => true, 'status' => 204, 'data' => $user !== null ? $this->restShapeUser($user) : null, 'error' => ''];
        }

        // Update by RouterOS id, e.g. /rest/user-manage/user/*1A
        if ($method === 'PATCH' && strpos($route, '/rest/user-manage/user/') === 0) {
            $radiusId = rawurldecode(substr($route, strlen('/rest/user-manage/user/')));

            if (!$api->updateUser($config, $radiusId, $payload)) {
                return $this->deviceFailure($api);
            }

            return ['success' => true, 'status' => 204, 'data' => null, 'error' => ''];
        }

        // Removals — the REST collection used POST .../remove with a `numbers` id.
        if ($method === 'POST' && $route === '/rest/user-manage/user/remove') {
            if (!$api->removeUser($config, (string) ($payload['numbers'] ?? ''))) {
                return $this->deviceFailure($api);
            }

            return ['success' => true, 'status' => 204, 'data' => null, 'error' => ''];
        }

        if ($method === 'POST' && $route === '/rest/user-manage/session/remove') {
            if (!$api->killSession($config, (string) ($payload['numbers'] ?? ''))) {
                return $this->deviceFailure($api);
            }

            return ['success' => true, 'status' => 204, 'data' => null, 'error' => ''];
        }

        return [
            'success' => false,
            'status'  => 0,
            'data'    => null,
            'error'   => "Unsupported RADIUS operation '{$method} {$path}'.",
        ];
    }

    /**
     * @param array<int, mixed> $data
     * @return array{success: bool, status: int, data: mixed, error: string}
     */
    private function deviceSuccess(array $data): array
    {
        return ['success' => true, 'status' => 200, 'data' => $data, 'error' => ''];
    }

    /**
     * @return array{success: bool, status: int, data: mixed, error: string}
     */
    private function deviceFailure(RouterosApiService $api): array
    {
        $error = $api->getLastError();

        return [
            'success' => false,
            'status'  => $api->isConnected() ? 400 : 0,
            'data'    => null,
            'error'   => $error !== '' ? $error : 'The RADIUS device rejected the operation.',
        ];
    }

    /**
     * Read one query-string value out of an internal route path.
     */
    private function pathQueryValue(string $path, string $key): ?string
    {
        $query = parse_url($path, PHP_URL_QUERY);

        if (!is_string($query) || $query === '') {
            return null;
        }

        parse_str($query, $parsed);

        $value = $parsed[$key] ?? null;

        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * Re-shape a normalised API user into the REST field names this service parses.
     *
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    private function restShapeUser(array $user): array
    {
        return [
            '.id'      => (string) ($user['.id'] ?? ''),
            'name'     => (string) ($user['username'] ?? ''),
            'group'    => (string) ($user['group'] ?? ''),
            'disabled' => !empty($user['disabled']) ? 'true' : 'false',
            'password' => (string) ($user['password'] ?? ''),
        ];
    }

    /**
     * @param array<string, mixed> $session
     * @return array<string, mixed>
     */
    private function restShapeSession(array $session): array
    {
        return [
            '.id'                => (string) ($session['.id'] ?? ''),
            'user'               => (string) ($session['username'] ?? ''),
            'user-address'       => (string) ($session['ip'] ?? ''),
            'calling-station-id' => (string) ($session['mac'] ?? ''),
            'upload'             => $session['upload'] ?? 0,
            'download'           => $session['download'] ?? 0,
            'uptime'             => (string) ($session['uptime'] ?? ''),
        ];
    }

    /**
     * Look up one account on one device.
     *
     * @return array<string, mixed>|null
     */
    private function findUserOnConfig(RadiusConfig $config, string $username): ?array
    {
        $username = trim($username);

        try {
            $user = app(RouterosApiService::class)->findUser($config, $username);
        } catch (Throwable $e) {
            $this->log('error', 'RADIUS account lookup failed.', [
                'radius_config_id' => $config->id,
                'radius_ip'        => $config->ip,
                'username'         => $username,
                'error'            => $e->getMessage(),
            ]);

            return null;
        }

        if ($user === null) {
            return null;
        }

        return [
            'id'       => $user['.id'],
            'group'    => $user['group'],
            'disabled' => $user['disabled'],
            'password' => $user['password'],
        ];
    }

    /**
     * Find the device an account lives on: the named one, or the first that has it.
     *
     * @return array<string, mixed>
     */
    private function locateUser(string $username, ?int $serverId, ?string $radId, ?int $organizationId): array
    {
        $configs = $serverId === null
            ? $this->resolver->orderedConfigs($organizationId)
            : collect(array_filter([$this->configById($serverId, $organizationId)]));

        if ($configs->isEmpty()) {
            return $this->failure(
                $serverId === null
                    ? 'No RADIUS server is configured.'
                    : "RADIUS server #{$serverId} does not exist."
            );
        }

        foreach ($configs as $config) {
            $user = $this->findUserOnConfig($config, $username);
            if ($user !== null) {
                return [
                    'success' => true,
                    'skipped' => false,
                    'message' => '',
                    'config'  => $config,
                    'label'   => $this->labelFor($config, $organizationId),
                    'user'    => $user,
                ];
            }
        }

        return $this->failure("'{$username}' was not found on the targeted RADIUS server(s).");
    }

    /**
     * Terminate every live session for an account on one device. Returns the count cut.
     */
    private function killSessions(RadiusConfig $config, string $username): int
    {
        try {
            return app(RouterosApiService::class)->killSessionsForUser($config, $username);
        } catch (Throwable $e) {
            // Cutting sessions is a follow-up to a change that already landed; a device
            // that will not answer here must not turn that change into a reported failure.
            $this->log('warning', 'Could not terminate live sessions.', [
                'radius_config_id' => $config->id,
                'radius_ip'        => $config->ip,
                'username'         => $username,
                'error'            => $e->getMessage(),
            ]);

            return 0;
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Two group names agree if they name the same plan.
     *
     * Delegated to {@see PlanGroup::matches()}, which settles it on the *first word*
     * of each label — the same reduction Job Order account creation applies when it
     * picks the User Manager group to create a subscriber in. That is the fix for
     * `group_mismatch` being raised against healthy accounts: the device stores
     * "SWIFT", billing stores "SWIFT 1000", and a whole-label comparison called that
     * a discrepancy on every sweep. Whole-label and bare-group agreement are still
     * accepted, so nothing that matched before stops matching.
     */
    private function groupsAgree(string $radGroup, string $billLabel): bool
    {
        return PlanGroup::matches($radGroup, $billLabel);
    }

    /**
     * Reduce a priced plan label to the bare group name the device stores.
     *
     * @see PlanGroup::bare() the shared implementation; this stays as the name the
     *      rest of this service calls it by.
     */
    private function bareGroup(string $label): string
    {
        return PlanGroup::bare($label);
    }

    /**
     * Resolve a bare RADIUS group back to the priced label billing stores.
     *
     * The map is built from labels already present in `customers.desired_plan`, so
     * the price format is whatever this deployment actually uses rather than one
     * reconstructed here. plan_list backfills any group with no customer on it yet.
     *
     * @return array{label: string, matched: bool}
     */
    private function resolvePlanLabel(string $radGroup): array
    {
        $radGroup = trim(preg_replace('/\s*\(Disabled\)\s*$/i', '', $radGroup) ?? '');

        if ($this->planLabelMap === null) {
            $map = [];

            // plan_list first, so a real customer label always wins over it.
            DB::table('plan_list')
                ->select(['plan_name', 'price'])
                ->whereNotNull('plan_name')
                ->orderBy('id')
                ->get()
                ->each(function ($plan) use (&$map): void {
                    $name = trim((string) $plan->plan_name);
                    if ($name === '') {
                        return;
                    }
                    $map[strtoupper($name)] = $plan->price !== null
                        ? $name . ' - P' . number_format((float) $plan->price, 2, '.', '')
                        : $name;
                });

            DB::table('customers')
                ->select('desired_plan')
                ->whereNotNull('desired_plan')
                ->where('desired_plan', '!=', '')
                ->distinct()
                ->get()
                ->each(function ($row) use (&$map): void {
                    $label = trim((string) $row->desired_plan);
                    $bare  = $this->bareGroup($label);
                    if ($bare !== '') {
                        $map[strtoupper($bare)] = $label;
                    }
                });

            $this->planLabelMap = $map;
        }

        $key = strtoupper($radGroup);

        return isset($this->planLabelMap[$key])
            ? ['label' => $this->planLabelMap[$key], 'matched' => true]
            : ['label' => $radGroup, 'matched' => false];
    }

    /**
     * Whether the billing side still treats this account as live.
     *
     * Status 5 is Terminated and 2/3 are the disconnected tier; anything else is
     * treated as live, which is the conservative reading for a mismatch check.
     *
     * @param array<string, mixed> $bill
     */
    private function billingConsidersActive(array $bill): bool
    {
        $status = $bill['billing_status_id'] ?? null;

        return $status === null || !in_array((int) $status, self::INACTIVE_BILLING_STATUS_IDS, true);
    }

    /**
     * Persist one reversible (or not) operation to activity_logs.
     *
     * @param array<string, mixed> $previousState
     * @param array<string, mixed> $newState
     * @param array<string, mixed> $extra
     */
    private function recordLog(
        string $action,
        string $message,
        string $username,
        array $previousState,
        array $newState,
        ?int $serverId,
        bool $reversible = true,
        array $extra = []
    ): void {
        // Resolved straight off the id rather than through orderedConfigs(), which is
        // organization-scoped — a log written for an org-specific device must still
        // name that device, not fall back to null.
        $serverLabel = null;
        if ($serverId !== null) {
            $config = RadiusConfig::find($serverId);
            $serverLabel = $config !== null
                ? $this->labelFor($config, $config->organization_id !== null ? (int) $config->organization_id : null)
                : null;
        }

        ActivityLog::log($action, $message, 'info', [
            'resource_type'   => self::RESOURCE_TYPE,
            'additional_data' => array_merge([
                'username'       => $username,
                'server_id'      => $serverId,
                'server_label'   => $serverLabel,
                'previous_state' => $previousState,
                'new_state'      => $newState,
                'reversible'     => $reversible,
                'reversed'       => false,
            ], $extra),
        ]);

        $this->log('info', $message, ['action' => $action, 'username' => $username, 'server_id' => $serverId]);
    }

    /**
     * Blank any credential in a snapshot before it leaves the service.
     *
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    private function maskSecrets(array $state): array
    {
        foreach ($state as $key => $value) {
            if (is_array($value)) {
                $state[$key] = $this->maskSecrets($value);
                continue;
            }
            if (is_string($key) && preg_match('/pass|password|token|secret/i', $key) && $value !== '' && $value !== null) {
                $state[$key] = '••••••';
            }
        }

        return $state;
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @return array<string, int>
     */
    private function summarize(array $rows, int $serverCount, int $billingCount, int $duplicateCount): array
    {
        $summary = $this->emptySummary();
        $summary['total']           = count($rows);
        $summary['servers']         = $serverCount;
        $summary['total_billing']   = $billingCount;
        $summary['duplicate_accounts'] = $duplicateCount;

        foreach ($rows as $row) {
            $summary[$row['state']] = ($summary[$row['state']] ?? 0) + 1;
        }

        return $summary;
    }

    /**
     * @return array<string, int>
     */
    private function emptySummary(): array
    {
        return array_merge(
            ['total' => 0, 'servers' => 0, 'total_billing' => 0, 'duplicate_accounts' => 0],
            array_fill_keys(self::STATES, 0)
        );
    }

    /**
     * Append one line to the live diagnostic trace the UI drawer renders.
     *
     * @param array<int, array<string, string>> $trace
     * @return array<int, array<string, string>>
     */
    private function trace(array &$trace, string $message, string $level = 'INFO'): array
    {
        $trace[] = [
            'timestamp' => now()->format('H:i:s.v'),
            'level'     => strtoupper($level),
            'message'   => $message,
        ];

        return $trace;
    }

    private function briefBody(string $body): string
    {
        $body = trim(preg_replace('/\s+/', ' ', $body) ?? '');

        return mb_strlen($body) > 200 ? mb_substr($body, 0, 200) . '…' : $body;
    }

    /**
     * @return array{success: bool, skipped: bool, message: string}
     */
    private function success(string $message): array
    {
        return ['success' => true, 'skipped' => false, 'message' => $message];
    }

    /**
     * @return array{success: bool, skipped: bool, message: string}
     */
    private function skipped(string $message): array
    {
        return ['success' => true, 'skipped' => true, 'message' => $message];
    }

    /**
     * @param array<string, mixed> $context
     * @return array{success: bool, skipped: bool, message: string}
     */
    private function failure(string $message, ?Throwable $e = null, array $context = []): array
    {
        if ($e !== null) {
            $this->log('error', $message, array_merge($context, ['error' => $e->getMessage()]));
        }

        return ['success' => false, 'skipped' => false, 'message' => $message];
    }

    /**
     * @param array<string, mixed> $context
     */
    private function log(string $level, string $message, array $context = []): void
    {
        Log::channel(self::LOG_CHANNEL)->{$level}('[' . self::LOG_PREFIX . '] ' . $message, $context);
    }
}
