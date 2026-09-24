<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\SmartOlt;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * SmartOLT inventory, bridge-MAC discovery and reconciliation engine.
 *
 * Ported from the standalone `smartolt.php` utility. Everything the standalone tool
 * kept in a private JSON storage folder now lives in two places instead: the ONU
 * inventory and status snapshots go into the framework cache, and long-running work
 * goes into `tool_jobs` so progress survives a page reload and can be polled.
 *
 * Credentials come from `smart_olt` via SmartOlt::first() — there is no settings
 * panel here and no second copy of the token.
 *
 * Endpoint note: the verified SmartOLT surface is
 *   GET  onu/get_all_onus_details            paged ONU inventory
 *   GET  onu/get_onus_statuses               bulk status/last-change
 *   GET  onu/get_onu_full_status_info/{id}   per-ONU detail; read for the bridge MACs
 *   POST onu/update_location_details/{id}    name / address_or_comment / contact
 *   POST onu/delete/{id}                     permanent unprovision
 * There is no `update_name` endpoint on this API — renames go through
 * update_location_details. The bridge MACs are read out of the full-status payload,
 * which is the only place SmartOLT exposes them.
 */
class SmartOltReconciliationService
{
    /** activity_logs.resource_type for everything this service writes. */
    public const RESOURCE_TYPE = 'smartolt_tool';

    // Optical power is no longer collected. `onu/get_onu_full_status_info/{id}` costs
    // one call per ONU against the hardest-throttled quota on this API, and reading a
    // dBm figure out of it bought a colour band nobody acted on while spending the
    // quota that bridge-MAC discovery needs. The crawl now takes the MAC and nothing
    // else, which is what every matching pass in this service actually binds on.

    // ---- Background job types ----------------------------------------------
    public const JOB_SMARTOLT_SYNC = 'smartolt_sync';
    public const JOB_RADIUS_SCAN = 'radius_scan';

    /**
     * Per-ONU bridge-MAC crawl.
     *
     * One `onu/get_onu_full_status_info/{id}` call per ONU — the most expensive and
     * hardest-throttled thing this service does, which is why it only ever runs as a
     * background job in bounded slices and never inline on a request.
     *
     * `mac_discovery` is the original name for the same work and is kept as an
     * accepted alias: it is what already-deployed frontends post and what any job
     * row still sitting in `tool_jobs` carries. Both resolve to the same step.
     */
    public const JOB_OPTICAL_SCAN = 'optical_scan';
    public const JOB_MAC_DISCOVERY = 'mac_discovery';

    public const JOB_RENAME = 'rename';
    public const JOB_PROFILE_SYNC = 'profile_sync';
    public const JOB_DELETE = 'delete';

    /**
     * Adopt the ONU's SmartOLT serial as the subscriber's router/modem SN.
     *
     * The only job in this service that writes a billing row rather than calling
     * SmartOLT: it copies the hardware serial the OLT reports into
     * `technical_details.router_modem_sn`. Direction is deliberately one-way —
     * SmartOLT is where the serial is read off the device, so it is the source of
     * truth and billing is the copy.
     */
    public const JOB_SN_ALIGNMENT = 'sn_alignment';

    public const JOB_TYPES = [
        self::JOB_SMARTOLT_SYNC,
        self::JOB_RADIUS_SCAN,
        self::JOB_OPTICAL_SCAN,
        self::JOB_MAC_DISCOVERY,
        self::JOB_RENAME,
        self::JOB_PROFILE_SYNC,
        self::JOB_SN_ALIGNMENT,
        self::JOB_DELETE,
    ];

    public const STATUS_PENDING = 'pending';
    public const STATUS_RUNNING = 'running';
    public const STATUS_PAUSED = 'paused';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';
    public const STATUS_ABORTED = 'aborted';

    /** Statuses that still own the single active-job slot. */
    public const LIVE_STATUSES = [self::STATUS_PENDING, self::STATUS_RUNNING, self::STATUS_PAUSED];

    /** Confirmation phrase the caller must echo before a permanent delete runs. */
    public const DELETE_CONFIRMATION = 'DELETE';

    /** ONU statuses eligible for decommissioning. */
    public const CLEANUP_STATUSES = ['offline', 'los', 'pwrfail'];

    /** billing_status_id that means the account is Terminated. */
    public const BILLING_STATUS_TERMINATED = 5;

    /** Job order statuses that no longer block a decommission. */
    public const CLOSED_JOB_STATUSES = ['done', 'completed', 'cancelled', 'canceled'];

    public const DEFAULT_OFFLINE_DAYS = 30;

    /**
     * Consecutive offline/LOS/PwrFail days before the unattended daily sweep will
     * consider an ONU for removal. Deliberately far tighter than the operator-driven
     * default above, and overridable per run — see runDailyAutomation().
     */
    public const AUTOMATION_OFFLINE_DAYS = 3;

    /**
     * Ceiling on `get_onu_full_status_info` calls the unattended sweep will make in
     * one run.
     *
     * That endpoint costs one call per ONU and is the hardest-throttled thing on this
     * API, so the sweep only ever spends it on ONUs it has never read before — see
     * automateDiscovery(). On a settled estate the queue is empty and the phase costs
     * nothing; the cap only bites on the first run after this shipped, or after a
     * batch of new installs, and whatever it does not reach is picked up tomorrow.
     */
    public const AUTOMATION_MAX_DISCOVERY = 250;

    /** Ceiling on billing router/modem SN writes applied in one unattended run. */
    public const AUTOMATION_MAX_SN_UPDATES = 200;

    private const LOG_CHANNEL = 'smartoltrelated';
    private const LOG_PREFIX = 'SmartOLT_Reconciliation';
    private const CACHE_PREFIX = 'smartolt_tool:';
    private const CACHE_TTL = 21600; // 6h — inventory is re-synced by an explicit job

    /**
     * Cache keys that are never allowed to expire.
     *
     * `optical` holds the bridge MACs discovered by the per-ONU crawl, and that crawl
     * is the most expensive call this service makes. Letting those MACs age out of a
     * 6h window meant a later sweep had to re-crawl the estate to rediscover facts it
     * already held — a MAC behind an ONU does not change on its own, and when it does
     * the ONU is re-read explicitly by a rescan. So the entry is written with no
     * expiry and mirrored into `smart_olt_cache`, which is what carries it across a
     * cache flush, a worker restart, and the gap between the web process and cron.
     *
     * Inventory and status snapshots deliberately stay on CACHE_TTL: those describe
     * live state, and going stale is the correct behaviour for them.
     */
    private const PERSISTENT_CACHE_KEYS = ['optical'];

    /**
     * ONUs crawled between flushes of the discovery phase's MAC snapshot.
     *
     * One write per ONU would push the whole snapshot into `smart_olt_cache` on every
     * iteration; one write at the end would lose the run's work if the process were
     * killed mid-sweep. Flushing every batch bounds both.
     */
    private const DISCOVERY_FLUSH_EVERY = 25;

    private const INVENTORY_PAGE = 100;
    private const REQUEST_TIMEOUT = 45;
    private const SUBSCRIBER_CHUNK = 500;

    /**
     * Items advanced per processJob() tick.
     *
     * The slice is what keeps a 4,000-ONU sweep off any single request: the caller
     * comes back for the next 50 rather than holding one connection open for the
     * whole estate. SLICE_BUDGET_SECONDS is the second half of that guarantee — a
     * slice of 50 per-ONU API calls would outlive an HTTP timeout on a slow OLT, so
     * the loop also stops once it has spent its time budget, whichever comes first.
     */
    private const SLICE_SIZE = 50;
    private const SLICE_BUDGET_SECONDS = 20;

    /**
     * How long a driver's claim on a job stays valid.
     *
     * A driver killed mid-slice — a worker restart, a PHP fatal, a closed tab — never
     * releases its claim. Anything older than this is treated as abandoned and may be
     * taken over, so a job cannot be stranded by a driver that went away. It is well
     * clear of SLICE_BUDGET_SECONDS so a slow slice is never mistaken for a dead one.
     */
    private const CLAIM_TTL_MINUTES = 5;

    /**
     * Wall-clock budget for one `cron:tool-jobs-drain` pass.
     *
     * Sized to finish inside a one-minute schedule so consecutive passes do not queue
     * up behind each other. A job that needs longer is simply resumed next minute
     * from the checkpoint this pass left.
     */
    private const DRIVE_BUDGET_SECONDS = 50;

    // ---- Rate limiting ------------------------------------------------------

    /**
     * SmartOLT enforces per-minute and per-hour quotas on the per-ONU endpoints
     * (get_onu_full_status_info above all). Hitting one is a normal operating
     * condition on a large estate, not a failure: the job checkpoints where it got
     * to, parks itself, and the next tick or cron run picks it up from there.
     */
    private const RATE_LIMIT_STATUSES = [429, 503];

    /** Quota wording SmartOLT returns with a 200 body when the limit is hit. */
    private const RATE_LIMIT_MARKERS = [
        'rate limit',
        'rate-limit',
        'ratelimit',
        'too many requests',
        'quota',
        'limit exceeded',
        'exceeded the limit',
        'try again later',
    ];

    /** How long a rate-limited job waits before it may resume. */
    private const RATE_LIMIT_COOLDOWN_MINUTES = 60;

    /** Fields update_location_details is proven to accept. */
    private const PUSHABLE_FIELDS = ['name', 'address_or_comment', 'contact', 'latitude', 'longitude'];

    // ---- MAC alignment row states -------------------------------------------

    /** The ONU's name already equals the matched RADIUS username. */
    public const ALIGN_ALIGNED = 'aligned';

    /** Matched to a RADIUS session, but the SmartOLT name differs from the username. */
    public const ALIGN_RENAME = 'rename_needed';

    /** The ONU has a discovered MAC, but no live RADIUS session carries it. */
    public const ALIGN_UNMATCHED = 'unmatched';

    /** No MAC has been discovered for this ONU yet — run MAC discovery first. */
    public const ALIGN_NO_MAC = 'no_mac';

    // ---- SN alignment row states --------------------------------------------
    //
    // Matching is MAC-only, exactly as the name-alignment pass is: the bridge MAC
    // behind the ONU is matched to a live PPPoE calling-station-id, and the session's
    // username locates the billing record. Nothing here matches on the ONU's *name*,
    // because a misnamed ONU would then write its serial onto somebody else's account.

    /** Billing already carries this ONU's serial. */
    public const SN_ALIGNED = 'sn_aligned';

    /** Matched, and the billing record has no serial at all — filling a blank. */
    public const SN_MISSING = 'sn_missing';

    /** Matched, but billing carries a different serial — this one overwrites a value. */
    public const SN_MISMATCH = 'sn_mismatch';

    /** Matched to a session whose username has no technical_details row. */
    public const SN_NO_SUBSCRIBER = 'sn_no_subscriber';

    /** The ONU has a discovered MAC, but no live RADIUS session carries it. */
    public const SN_UNMATCHED = 'sn_unmatched';

    /** No MAC discovered for this ONU yet, or SmartOLT reports no serial for it. */
    public const SN_NO_MAC = 'sn_no_mac';

    private ?SmartOlt $config = null;

    /**
     * Cleanup safety maps, keyed by organization scope.
     *
     * @var array<string, array<string, mixed>>
     */
    private array $safetyMap = [];

    /**
     * The RADIUS side is read through the reconciliation service rather than a
     * second RouterOS client: session parsing, multi-server ordering and credential
     * resolution already live there and must not be duplicated here.
     */
    public function __construct(private RadiusReconciliationService $radius)
    {
    }

    // =========================================================================
    // State & inventory
    // =========================================================================

    /**
     * Everything the UI needs to render the tool on load: config presence, cache
     * freshness, inventory counts, the fifteen dashboard metrics and the active job.
     *
     * @return array<string, mixed>
     */
    public function getState(bool $includeRows = false, ?int $organizationId = null): array
    {
        $configured = $this->smartOltConfig() !== null;
        $inventory = $this->cachedInventory();
        $statuses = $this->cachedStatuses();
        $macCache = $this->cachedBridgeMacs();

        $statusCounts = [];
        $rows = [];
        $macCached = 0;
        $nameNotSet = 0;

        foreach ($inventory['items'] as $externalId => $onu) {
            $status = $this->resolveStatus($onu, $statuses);
            $statusCounts[$status] = ($statusCounts[$status] ?? 0) + 1;

            if ($this->isPlaceholderName(trim((string) ($onu['name'] ?? '')))) {
                $nameNotSet++;
            }

            $entry = $macCache['items'][$externalId] ?? null;
            $mac = $this->primaryMac($entry);

            if ($mac !== '') {
                $macCached++;
            }

            if ($includeRows) {
                $rows[] = [
                    'external_id' => (string) $externalId,
                    'sn' => $onu['sn'] ?? '',
                    'name' => $onu['name'] ?? '',
                    'olt_name' => $onu['olt_name'] ?? '',
                    'board' => $onu['board'] ?? '',
                    'port' => $onu['port'] ?? '',
                    'zone_name' => $onu['zone_name'] ?? '',
                    'odb_name' => $onu['odb_name'] ?? '',
                    'address' => $onu['address'] ?? '',
                    'contact' => $onu['contact'] ?? '',
                    'status' => $status,
                    'last_status_change' => $onu['last_status_change'] ?? '',
                    'days_offline' => $this->daysOffline($onu, $statuses),
                    // Colon-delimited for the screen only. Every comparison in this
                    // service runs on normalizeMac()'s bare uppercase hex.
                    'mac_address' => $mac,
                    'mac_checked_at' => is_array($entry) ? ($entry['checked_at'] ?? null) : null,
                ];
            }
        }

        $inventoryCount = count($inventory['items']);

        return [
            'configured' => $configured,
            'sub_domain' => $configured ? $this->smartOltConfig()->sub_domain : null,
            'inventory_count' => $inventoryCount,
            'inventory_synced_at' => $inventory['updated_at'],
            'status_synced_at' => $statuses['updated_at'],
            'mac_synced_at' => $macCache['updated_at'],
            'mac_cached' => $macCached,
            // Deprecated alias of mac_cached, kept for anything written while the
            // crawl still reported a count of optical readings.
            'optical_checked' => $macCached,
            'status_counts' => $statusCounts,
            'metrics' => $this->buildMetrics($inventoryCount, $statusCounts, $macCached, $nameNotSet),
            'active_job' => $this->activeJob($organizationId),
            'rows' => $rows,
        ];
    }

    /**
     * The fifteen headline figures the dashboard grid renders.
     *
     * Split by cost, deliberately. The first nine come from the inventory, status and
     * MAC snapshots this call already holds, so they are free. The last six describe
     * work the alignment, profile and cleanup passes did - each of those contacts the
     * RADIUS estate and reads the subscriber table - so they are read back from the
     * compact summary each pass parked, not recomputed on every page poll.
     *
     * A figure whose pass has never run is null, not zero: "not computed yet" and
     * "nothing to do" are different answers and the grid shows which one it has.
     *
     * @param array<string, int> $statusCounts
     * @return array<string, mixed>
     */
    private function buildMetrics(int $inventoryCount, array $statusCounts, int $macCached, int $nameNotSet): array
    {
        $mac = $this->cachedSummary('mac_alignment');
        $profile = $this->cachedSummary('profile_preview');
        $cleanup = $this->cachedSummary('cleanup');

        $macSummary = is_array($mac['summary'] ?? null) ? $mac['summary'] : null;
        $profileSummary = is_array($profile['summary'] ?? null) ? $profile['summary'] : null;
        $cleanupSummary = is_array($cleanup['summary'] ?? null) ? $cleanup['summary'] : null;

        return [
            'inventory' => $inventoryCount,
            'authorized' => (int) ($statusCounts['online'] ?? 0),
            'offline' => (int) ($statusCounts['offline'] ?? 0),
            'los' => (int) ($statusCounts['los'] ?? 0),
            'pwrfail' => (int) ($statusCounts['pwrfail'] ?? 0),
            'name_not_set' => $nameNotSet,
            'named' => max(0, $inventoryCount - $nameNotSet),
            'mac_cached' => $macCached,
            'pending_discovery' => max(0, $inventoryCount - $macCached),
            'radius_active' => $macSummary === null ? null : (int) ($macSummary['sessions'] ?? 0),
            'matched_sessions' => $macSummary === null ? null : (int) ($macSummary['matched'] ?? 0),
            'rename_required' => $macSummary === null ? null : (int) ($macSummary['rename_needed'] ?? 0),
            'already_correct' => $macSummary === null ? null : (int) ($macSummary['aligned'] ?? 0),
            'address_updates' => $profileSummary === null ? null : (int) ($profileSummary['eligible'] ?? 0),
            'delete_candidates' => $cleanupSummary === null ? null : (int) ($cleanupSummary['eligible'] ?? 0),
            'computed_at' => [
                'mac_alignment' => $mac['updated_at'] ?? null,
                'profile' => $profile['updated_at'] ?? null,
                'cleanup' => $cleanup['updated_at'] ?? null,
            ],
        ];
    }

    /**
     * Discover the bridge MAC behind each ONU the caller names, or behind every ONU
     * whose MAC has never been read.
     *
     * Each ONU costs one `get_onu_full_status_info` call - the hardest-throttled
     * endpoint on this API - so the sweep is capped per request and the caller repeats
     * until `remaining` reaches zero, the same shape the background jobs use. The MAC
     * is cached without expiry (see PERSISTENT_CACHE_KEYS): a MAC behind an ONU does
     * not change on its own, so re-crawling to rediscover one is pure quota waste.
     *
     * @param array<int, string> $externalIds
     * @return array{success: bool, checked: int, remaining: int, items: array<int, array<string, mixed>>, errors: array<int, string>}
     */
    public function discoverBridgeMacs(array $externalIds = [], int $limit = 25): array
    {
        $config = $this->smartOltConfig();

        if ($config === null) {
            return ['success' => false, 'checked' => 0, 'remaining' => 0, 'items' => [], 'errors' => ['SmartOLT is not configured.']];
        }

        $inventory = $this->cachedInventory();
        $macCache = $this->cachedBridgeMacs();
        $statuses = $this->cachedStatuses();

        $targets = $externalIds !== []
            ? array_values(array_intersect($externalIds, array_keys($inventory['items'])))
            : array_values(array_diff(array_keys($inventory['items']), array_keys($macCache['items'])));

        $remaining = max(0, count($targets) - $limit);
        $targets = array_slice($targets, 0, max(1, $limit));

        $errors = [];
        $checked = 0;

        foreach ($targets as $externalId) {
            try {
                $response = $this->callSmartOlt('GET', 'onu/get_onu_full_status_info/' . rawurlencode((string) $externalId));

                if (!$response['success']) {
                    $errors[] = $externalId . ': ' . $response['error'];
                    continue;
                }

                $payload = $response['data']['full_status_json'] ?? $response['data'];

                $macCache['items'][$externalId] = [
                    'macs' => $this->extractBridgeMacs($payload),
                    'checked_at' => now()->toIso8601String(),
                ];
                $checked++;
            } catch (Throwable $e) {
                $errors[] = $externalId . ': ' . $e->getMessage();
                $this->log('error', 'Bridge MAC discovery failed.', ['external_id' => $externalId, 'error' => $e->getMessage()]);
            }
        }

        $macCache['updated_at'] = now()->toIso8601String();
        $this->putCache('optical', $macCache);

        $items = [];
        foreach ($targets as $externalId) {
            $onu = $inventory['items'][$externalId] ?? [];
            $entry = $macCache['items'][$externalId] ?? null;
            $macs = is_array($entry) && is_array($entry['macs'] ?? null) ? $entry['macs'] : [];

            $items[] = [
                'external_id' => (string) $externalId,
                'sn' => $onu['sn'] ?? '',
                'name' => $onu['name'] ?? '',
                'status' => $this->resolveStatus($onu, $statuses),
                'mac_address' => $this->primaryMac($entry),
                'macs' => array_map(fn ($mac): string => $this->formatMac((string) $mac), $macs),
                'checked_at' => is_array($entry) ? ($entry['checked_at'] ?? null) : null,
            ];
        }

        return [
            'success' => true,
            'checked' => $checked,
            'remaining' => $remaining,
            'items' => $items,
            'errors' => $errors,
        ];
    }

    /**
     * @deprecated Renamed to discoverBridgeMacs() when the crawl stopped reading
     * optical power. The route and the controller action are unchanged, so anything
     * still calling the old name keeps working.
     *
     * @param array<int, string> $externalIds
     * @return array<string, mixed>
     */
    public function getOpticalPower(array $externalIds = [], int $limit = 25): array
    {
        return $this->discoverBridgeMacs($externalIds, $limit);
    }

    // =========================================================================
    // Name alignment
    // =========================================================================

    /**
     * Match every cached ONU against a subscriber and propose a standard name.
     *
     * Matching is tried in descending confidence: serial number, then PPPoE username,
     * then account number, then a MAC seen on both sides. The proposal is
     * `[ACC_NO] - [CUSTOMER NAME] - [PLAN]`.
     *
     * @return array{summary: array<string, int>, rows: array<int, array<string, mixed>>}
     */
    public function getAlignmentPreview(?int $organizationId = null): array
    {
        $inventory = $this->cachedInventory();
        $macCache = $this->cachedBridgeMacs();
        $statuses = $this->cachedStatuses();
        $subscribers = $this->loadSubscribers($organizationId);

        // Hoisted lookup indexes — built once, not per ONU.
        $bySerial = [];
        $byUsername = [];
        $byAccount = [];
        $byMac = [];

        foreach ($subscribers as $sub) {
            if ($sub['sn'] !== '') {
                $bySerial[$this->normalizeSerial($sub['sn'])] = $sub;
            }
            if ($sub['username'] !== '') {
                $byUsername[strtolower($sub['username'])] = $sub;
            }
            if ($sub['account_no'] !== '') {
                $byAccount[strtolower($sub['account_no'])] = $sub;
            }
            if ($sub['mac'] !== '') {
                $byMac[$this->normalizeMac($sub['mac'])] = $sub;
            }
        }

        $summary = ['total' => 0, 'matched' => 0, 'rename_needed' => 0, 'aligned' => 0, 'unmatched' => 0, 'placeholder' => 0];
        $rows = [];

        foreach ($inventory['items'] as $externalId => $onu) {
            $summary['total']++;

            $serial = $this->normalizeSerial((string) ($onu['sn'] ?? ''));
            $name = trim((string) ($onu['name'] ?? ''));
            $matched = null;
            $matchedBy = null;

            if ($serial !== '' && isset($bySerial[$serial])) {
                $matched = $bySerial[$serial];
                $matchedBy = 'serial_number';
            } else {
                // The ONU name often already carries the username or account number.
                $needle = strtolower($name);
                foreach ($byUsername as $username => $sub) {
                    if ($needle !== '' && str_contains($needle, $username)) {
                        $matched = $sub;
                        $matchedBy = 'pppoe_username';
                        break;
                    }
                }

                if ($matched === null) {
                    foreach ($byAccount as $accountNo => $sub) {
                        if ($needle !== '' && str_contains($needle, $accountNo)) {
                            $matched = $sub;
                            $matchedBy = 'account_no';
                            break;
                        }
                    }
                }

                if ($matched === null) {
                    foreach (($macCache['items'][$externalId]['macs'] ?? []) as $mac) {
                        $key = $this->normalizeMac($mac);
                        if ($key !== '' && isset($byMac[$key])) {
                            $matched = $byMac[$key];
                            $matchedBy = 'mac_address';
                            break;
                        }
                    }
                }
            }

            if ($matched === null) {
                $summary['unmatched']++;
                $rows[] = [
                    'external_id' => (string) $externalId,
                    'sn' => $onu['sn'] ?? '',
                    'current_name' => $name !== '' ? $name : 'not set',
                    'proposed_name' => '',
                    'matched_by' => null,
                    'account_no' => null,
                    'customer_name' => null,
                    'plan' => null,
                    'status' => $this->resolveStatus($onu, $statuses),
                    'rename_needed' => false,
                    'eligible' => false,
                    'reason' => 'No subscriber matched this ONU by serial, username, account number or MAC.',
                ];
                continue;
            }

            $summary['matched']++;

            $proposed = $this->proposedName($matched);
            $isPlaceholder = $this->isPlaceholderName($name);
            if ($isPlaceholder) {
                $summary['placeholder']++;
            }

            // A placeholder name always participates: "not set" is exactly what this
            // pass exists to fix, so it must never be treated as already aligned.
            $renameNeeded = $proposed !== '' && ($isPlaceholder || strcasecmp($name, $proposed) !== 0);

            if ($renameNeeded) {
                $summary['rename_needed']++;
            } else {
                $summary['aligned']++;
            }

            $rows[] = [
                'external_id' => (string) $externalId,
                'sn' => $onu['sn'] ?? '',
                'current_name' => $name !== '' ? $name : 'not set',
                'proposed_name' => $proposed,
                'matched_by' => $matchedBy,
                'account_no' => $matched['account_no'],
                'customer_name' => $matched['customer_name'],
                'plan' => $matched['plan_label'],
                'status' => $this->resolveStatus($onu, $statuses),
                'rename_needed' => $renameNeeded,
                'eligible' => $renameNeeded,
                'reason' => $renameNeeded ? 'Name differs from the standard format.' : 'Already aligned.',
            ];
        }

        $result = ['summary' => $summary, 'rows' => $rows, 'updated_at' => now()->toIso8601String()];
        $this->putCache('alignment', $result);

        return $result;
    }

    // =========================================================================
    // MAC alignment — SmartOLT bridge MAC against the RADIUS calling-station-id
    // =========================================================================

    /**
     * Match each ONU to the subscriber actually authenticating through it, by MAC.
     *
     * This is the authoritative alignment pass, and it is deliberately different from
     * getAlignmentPreview() above. That one matches on what the billing database says
     * an ONU's serial or account number is, and proposes a descriptive label. This one
     * matches on what the network is doing right now: the bridge MAC SmartOLT reports
     * behind the ONU against the calling-station-id of the live PPPoE session. The
     * name it proposes is therefore not a label at all — it is exactly the RADIUS
     * username, so that a technician reading an ONU in SmartOLT is reading the same
     * identifier they will search for in User Manager.
     *
     * Both sides are cached reads plus one RADIUS session sweep; nothing is written.
     * The lookup index is built once, so cost is linear in ONU count, not quadratic.
     *
     * @return array{summary: array<string, int>, rows: array<int, array<string, mixed>>, errors: array<int, string>}
     */
    public function getMacAlignmentPreview(?int $organizationId = null): array
    {
        $inventory = $this->cachedInventory();
        $macCache = $this->cachedBridgeMacs();
        $statuses = $this->cachedStatuses();

        $sessions = $this->radius->activeSessions($organizationId);

        // Hoisted once: MAC -> session. Every ONU below is a hash lookup.
        $byMac = $sessions['by_mac'];

        $summary = [
            'total' => 0,
            'matched' => 0,
            'rename_needed' => 0,
            'aligned' => 0,
            'unmatched' => 0,
            'no_mac' => 0,
            'sessions' => count($sessions['by_username']),
        ];

        $rows = [];

        foreach ($inventory['items'] as $externalId => $onu) {
            $summary['total']++;

            $currentName = trim((string) ($onu['name'] ?? ''));
            $status = $this->resolveStatus($onu, $statuses);
            $macs = $macCache['items'][$externalId]['macs'] ?? [];

            $matched = null;
            $matchedMac = '';

            foreach ($macs as $mac) {
                $key = $this->normalizeMac((string) $mac);
                if ($key !== '' && isset($byMac[$key])) {
                    $matched = $byMac[$key];
                    $matchedMac = (string) $mac;
                    break;
                }
            }

            if ($matched === null) {
                // An ONU with no discovered MAC has not been crawled yet; one with
                // MACs but no session match is genuinely unattributable right now.
                // Separating them keeps "run MAC discovery" from looking like "this
                // ONU has no subscriber".
                $state = $macs === [] ? self::ALIGN_NO_MAC : self::ALIGN_UNMATCHED;
                $summary[$state === self::ALIGN_NO_MAC ? 'no_mac' : 'unmatched']++;

                $rows[] = [
                    'external_id' => (string) $externalId,
                    'state' => $state,
                    'radius_username' => '',
                    'calling_station_id' => $macs === [] ? '' : $this->formatMac((string) $macs[0]),
                    'current_name' => $currentName !== '' ? $currentName : 'not set',
                    'target_name' => '',
                    'sn' => (string) ($onu['sn'] ?? ''),
                    'status' => $status,
                    'server_id' => null,
                    'server_label' => '—',
                    'eligible' => false,
                    'reason' => $state === self::ALIGN_NO_MAC
                        ? 'No MAC has been discovered for this ONU yet — run MAC Discovery first.'
                        : 'No live RADIUS session is using any MAC seen behind this ONU.',
                ];
                continue;
            }

            $summary['matched']++;

            // The contract for this pass: the target name IS the RADIUS username.
            $targetName = $this->sanitizeName((string) $matched['username']);
            $renameNeeded = $targetName !== ''
                && ($this->isPlaceholderName($currentName) || strcmp($currentName, $targetName) !== 0);

            if ($renameNeeded) {
                $summary['rename_needed']++;
                $state = self::ALIGN_RENAME;
            } else {
                $summary['aligned']++;
                $state = self::ALIGN_ALIGNED;
            }

            $rows[] = [
                'external_id' => (string) $externalId,
                'state' => $state,
                'radius_username' => (string) $matched['username'],
                'calling_station_id' => $this->formatMac($matchedMac),
                'current_name' => $currentName !== '' ? $currentName : 'not set',
                'target_name' => $targetName,
                'sn' => (string) ($onu['sn'] ?? ''),
                'status' => $status,
                'server_id' => $matched['server_id'],
                'server_label' => $matched['server_label'],
                'eligible' => $renameNeeded,
                'reason' => $renameNeeded
                    ? 'The SmartOLT name does not match the RADIUS username.'
                    : 'Already named for the RADIUS username.',
            ];
        }

        $result = [
            'summary' => $summary,
            'rows' => $rows,
            'errors' => $sessions['errors'],
            'updated_at' => now()->toIso8601String(),
        ];

        $this->putCache('mac_alignment', $result);
        $this->rememberSummary('mac_alignment', $summary, $result['updated_at']);

        return $result;
    }

    // =========================================================================
    // SN alignment
    // =========================================================================

    /**
     * Compare each ONU's SmartOLT serial against the subscriber's stored
     * `technical_details.router_modem_sn`, and propose adopting the SmartOLT value.
     *
     * Direction is one-way by design. The serial SmartOLT reports is read off the
     * device itself, so it is the fact; the billing column is a copy that drifts when
     * a technician swaps a modem and updates one system but not the other. This pass
     * closes that gap in the direction that can be trusted.
     *
     * Matching is MAC-only, the same binding the name-alignment pass uses: the bridge
     * MAC behind the ONU is matched to a live PPPoE calling-station-id, and that
     * session's username locates the billing record. Matching on the ONU's name was
     * considered and rejected — a misnamed ONU would write its serial onto the wrong
     * subscriber, and unlike a rename that is a change to a billing record.
     *
     * Read-only: nothing here writes. Applying is the `sn_alignment` job.
     *
     * @return array{summary: array<string, int>, rows: array<int, array<string, mixed>>, errors: array<int, mixed>, updated_at: string}
     */
    public function getSnAlignmentPreview(?int $organizationId = null): array
    {
        $inventory = $this->cachedInventory();
        $macCache = $this->cachedBridgeMacs();
        $statuses = $this->cachedStatuses();

        $sessions = $this->radius->activeSessions($organizationId);
        $byMac = $sessions['by_mac'];

        // Hoisted once, keyed by username: every ONU below is a hash lookup rather
        // than a query. technical_details.username carries a unique index, so one
        // username resolves to exactly one billing record.
        $byUsername = [];
        foreach ($this->loadSubscribers($organizationId) as $tdId => $sub) {
            $key = strtolower($sub['username']);
            if ($key !== '' && !isset($byUsername[$key])) {
                $byUsername[$key] = $sub + ['td_id' => (int) $tdId];
            }
        }

        $summary = [
            'total' => 0,
            'matched' => 0,
            'aligned' => 0,
            'missing' => 0,
            'mismatch' => 0,
            'no_subscriber' => 0,
            'unmatched' => 0,
            'no_mac' => 0,
            'sessions' => count($sessions['by_username']),
        ];

        $rows = [];

        foreach ($inventory['items'] as $externalId => $onu) {
            $summary['total']++;

            $onuSerial = trim((string) ($onu['sn'] ?? ''));
            $status = $this->resolveStatus($onu, $statuses);
            $macs = $macCache['items'][$externalId]['macs'] ?? [];

            // Defaults every row starts from. Rows that override one of these must
            // use array_merge(), never `$base + [...]`: the union operator keeps the
            // LEFT value on a duplicate key, so `'eligible' => true` silently lost to
            // the false below it and no SN row was ever writable - which is what made
            // every batch action on this tab report "nothing to do".
            $base = [
                'external_id' => (string) $externalId,
                'sn' => $onuSerial,
                'current_name' => trim((string) ($onu['name'] ?? '')) !== ''
                    ? trim((string) ($onu['name'] ?? ''))
                    : 'not set',
                'status' => $status,
                'calling_station_id' => '',
                'radius_username' => '',
                'account_no' => '',
                'customer_name' => '',
                'billing_sn' => '',
                'technical_detail_id' => null,
                'server_id' => null,
                'server_label' => '—',
                'eligible' => false,
            ];

            // An ONU SmartOLT reports no serial for has nothing to copy, whatever
            // else is known about it.
            if ($onuSerial === '') {
                $summary['no_mac']++;
                $rows[] = array_merge($base, [
                    'state' => self::SN_NO_MAC,
                    'reason' => 'SmartOLT reports no serial for this ONU — nothing to copy.',
                ]);
                continue;
            }

            $matched = null;
            $matchedMac = '';

            foreach ($macs as $mac) {
                $key = $this->normalizeMac((string) $mac);
                if ($key !== '' && isset($byMac[$key])) {
                    $matched = $byMac[$key];
                    $matchedMac = (string) $mac;
                    break;
                }
            }

            if ($matched === null) {
                // Not yet crawled versus genuinely unattributable — the same split the
                // name-alignment pass makes, so "run MAC discovery" never reads as
                // "this ONU has no subscriber".
                $state = $macs === [] ? self::SN_NO_MAC : self::SN_UNMATCHED;
                $summary[$state === self::SN_NO_MAC ? 'no_mac' : 'unmatched']++;

                $rows[] = array_merge($base, [
                    'state' => $state,
                    'calling_station_id' => $macs === [] ? '' : $this->formatMac((string) $macs[0]),
                    'reason' => $state === self::SN_NO_MAC
                        ? 'No MAC has been discovered for this ONU yet — run MAC Discovery first.'
                        : 'No live RADIUS session is using any MAC seen behind this ONU.',
                ]);
                continue;
            }

            $summary['matched']++;

            $username = (string) $matched['username'];
            $subscriber = $byUsername[strtolower($username)] ?? null;

            $base = array_merge($base, [
                'calling_station_id' => $this->formatMac($matchedMac),
                'radius_username' => $username,
                'server_id' => $matched['server_id'],
                'server_label' => $matched['server_label'],
            ]);

            if ($subscriber === null) {
                $summary['no_subscriber']++;
                $rows[] = array_merge($base, [
                    'state' => self::SN_NO_SUBSCRIBER,
                    'reason' => "No billing record carries the PPPoE username '{$username}'.",
                ]);
                continue;
            }

            $billingSn = trim((string) $subscriber['sn']);

            $base = array_merge($base, [
                'account_no' => $subscriber['account_no'],
                'customer_name' => $subscriber['customer_name'],
                'billing_sn' => $billingSn,
                'technical_detail_id' => $subscriber['td_id'],
            ]);

            // Compared normalized so punctuation or case alone never reads as drift,
            // but the value written is SmartOLT's verbatim.
            if ($billingSn !== '' && $this->normalizeSerial($billingSn) === $this->normalizeSerial($onuSerial)) {
                $summary['aligned']++;
                $rows[] = array_merge($base, [
                    'state' => self::SN_ALIGNED,
                    'reason' => 'Billing already carries this ONU serial.',
                ]);
                continue;
            }

            if ($billingSn === '') {
                $summary['missing']++;
                $rows[] = array_merge($base, [
                    'state' => self::SN_MISSING,
                    'eligible' => true,
                    'reason' => 'The billing record has no router/modem SN — this fills it in.',
                ]);
                continue;
            }

            $summary['mismatch']++;
            $rows[] = array_merge($base, [
                'state' => self::SN_MISMATCH,
                'eligible' => true,
                'reason' => "Billing holds a different serial ({$billingSn}) — applying overwrites it.",
            ]);
        }

        $result = [
            'summary' => $summary,
            'rows' => $rows,
            'errors' => $sessions['errors'],
            'updated_at' => now()->toIso8601String(),
        ];

        $this->putCache('sn_alignment', $result);
        $this->rememberSummary('sn_alignment', $summary, $result['updated_at']);

        return $result;
    }

    // =========================================================================
    // Profile sync
    // =========================================================================

    /**
     * Compare each matched ONU's location details against the billing record.
     *
     * Address, contact and coordinates are pushable through update_location_details.
     * VLAN is surfaced for comparison only — SmartOLT changes an ONU's VLAN through
     * provisioning, not location details, so this pass reports the difference and
     * deliberately does not push it. See the note on PUSHABLE_FIELDS.
     *
     * @return array{summary: array<string, int>, rows: array<int, array<string, mixed>>}
     */
    public function getProfilePreview(?int $organizationId = null): array
    {
        $inventory = $this->cachedInventory();
        $subscribers = $this->loadSubscribers($organizationId);

        $bySerial = [];
        foreach ($subscribers as $sub) {
            if ($sub['sn'] !== '') {
                $bySerial[$this->normalizeSerial($sub['sn'])] = $sub;
            }
        }

        $summary = ['total' => 0, 'eligible' => 0, 'unchanged' => 0, 'unmatched' => 0, 'vlan_drift' => 0];
        $rows = [];

        foreach ($inventory['items'] as $externalId => $onu) {
            $summary['total']++;

            $serial = $this->normalizeSerial((string) ($onu['sn'] ?? ''));
            $matched = $serial !== '' ? ($bySerial[$serial] ?? null) : null;

            if ($matched === null) {
                $summary['unmatched']++;
                continue;
            }

            $oldAddress = $this->sanitizeAddress((string) ($onu['address'] ?? ''));
            $oldContact = $this->sanitizeContact((string) ($onu['contact'] ?? ''));
            $oldLat = $onu['latitude'] ?? '';
            $oldLng = $onu['longitude'] ?? '';

            $newAddress = $this->sanitizeAddress($matched['address']);
            $newContact = $this->sanitizeContact($matched['contact']);
            [$newLat, $newLng] = $this->splitCoordinates($matched['coordinates']);

            $addressChanged = $newAddress !== '' && $newAddress !== $oldAddress;
            $contactChanged = $newContact !== '' && $newContact !== $oldContact;
            $coordsChanged = $newLat !== '' && $newLng !== '' && ((string) $oldLat !== $newLat || (string) $oldLng !== $newLng);
            $vlanDrift = $matched['vlan'] !== '' && (string) ($onu['vlan'] ?? '') !== '' && (string) $onu['vlan'] !== $matched['vlan'];

            if ($vlanDrift) {
                $summary['vlan_drift']++;
            }

            $eligible = $addressChanged || $contactChanged || $coordsChanged;
            if ($eligible) {
                $summary['eligible']++;
            } else {
                $summary['unchanged']++;
            }

            $rows[] = [
                'external_id' => (string) $externalId,
                'sn' => $onu['sn'] ?? '',
                'name' => $onu['name'] ?? '',
                'account_no' => $matched['account_no'],
                'customer_name' => $matched['customer_name'],
                'old_address' => $oldAddress,
                'new_address' => $newAddress,
                'old_contact' => $oldContact,
                'new_contact' => $newContact,
                'old_latitude' => (string) $oldLat,
                'new_latitude' => $newLat,
                'old_longitude' => (string) $oldLng,
                'new_longitude' => $newLng,
                'olt_vlan' => (string) ($onu['vlan'] ?? ''),
                'billing_vlan' => $matched['vlan'],
                'address_changed' => $addressChanged,
                'contact_changed' => $contactChanged,
                'coords_changed' => $coordsChanged,
                'vlan_drift' => $vlanDrift,
                'eligible' => $eligible,
            ];
        }

        $result = [
            'summary' => $summary,
            'rows' => $rows,
            'vlan_note' => 'VLAN differences are reported for review only. SmartOLT changes an ONU VLAN through provisioning, not update_location_details, so this pass does not push it.',
            'updated_at' => now()->toIso8601String(),
        ];
        $this->putCache('profile_preview', $result);
        $this->rememberSummary('profile_preview', $summary, $result['updated_at']);

        return $result;
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    /**
     * ONUs that are offline past the threshold and carry no live billing reason to exist.
     *
     * An ONU is only eligible when every check passes; each failed check is reported
     * verbatim so the operator sees exactly what is protecting the record.
     *
     * @return array{summary: array<string, int>, rows: array<int, array<string, mixed>>}
     */
    public function getCleanupPreview(int $offlineDays = self::DEFAULT_OFFLINE_DAYS, ?int $organizationId = null): array
    {
        $offlineDays = max(1, $offlineDays);
        $inventory = $this->cachedInventory();
        $statuses = $this->cachedStatuses();
        $safety = $this->buildSafetyMap($organizationId);
        // Hoisted: one cache read for the whole sweep, not one per candidate ONU.
        $macCache = $this->cachedBridgeMacs();

        $summary = ['total' => 0, 'eligible' => 0, 'blocked' => 0];
        $rows = [];

        foreach ($inventory['items'] as $externalId => $onu) {
            $status = $this->resolveStatus($onu, $statuses);

            if (!in_array($status, self::CLEANUP_STATUSES, true)) {
                continue;
            }

            $days = $this->daysOffline($onu, $statuses);
            if ($days === null || $days < $offlineDays) {
                continue;
            }

            $summary['total']++;

            $reasons = $this->cleanupBlockers((string) ($onu['sn'] ?? ''), $safety);
            $eligible = $reasons === [];

            if ($eligible) {
                $summary['eligible']++;
            } else {
                $summary['blocked']++;
            }

            // The bridge MAC discovered for this ONU, for the operator reviewing a
            // decommission list. Empty means "never crawled", not "this ONU has no MAC".
            $entry = $macCache['items'][(string) $externalId] ?? [];

            $rows[] = [
                'external_id' => (string) $externalId,
                'sn' => $onu['sn'] ?? '',
                'name' => $onu['name'] ?? '',
                'zone_name' => $onu['zone_name'] ?? '',
                'odb_name' => $onu['odb_name'] ?? '',
                'olt_name' => $onu['olt_name'] ?? '',
                'status' => $status,
                'last_status_change' => $onu['last_status_change'] ?? '',
                'days_offline' => $days,
                'mac_address' => $this->primaryMac($entry),
                'mac_checked_at' => $entry['checked_at'] ?? null,
                // Retained, and still authoritative for the unattended nightly pass.
                // The operator-driven tool shows these as context rather than as a
                // gate: an operator who has selected a row has already made the call.
                'eligible' => $eligible,
                'reasons' => $reasons,
            ];
        }

        $result = ['summary' => $summary, 'rows' => $rows, 'offline_days' => $offlineDays, 'updated_at' => now()->toIso8601String()];
        $this->putCache('cleanup', $result);
        $this->rememberSummary('cleanup', $summary, $result['updated_at']);

        return $result;
    }

    /**
     * Re-check a single deletion candidate immediately before the delete fires.
     *
     * The preview can be minutes old by the time an operator confirms; this is what
     * makes a stale preview unable to delete a record that has come back to life.
     *
     * @param array<string, mixed> $safety
     * @return array{eligible: bool, reasons: array<int, string>}
     */
    private function revalidateCleanup(string $externalId, int $offlineDays, array $safety): array
    {
        $inventory = $this->cachedInventory();
        $statuses = $this->cachedStatuses();
        $onu = $inventory['items'][$externalId] ?? null;

        if (!is_array($onu)) {
            return ['eligible' => false, 'reasons' => ['The ONU is no longer in the cached inventory.']];
        }

        $status = $this->resolveStatus($onu, $statuses);
        if (!in_array($status, self::CLEANUP_STATUSES, true)) {
            return ['eligible' => false, 'reasons' => ["The ONU status is no longer eligible ({$status})."]];
        }

        $days = $this->daysOffline($onu, $statuses);
        if ($days === null || $days < $offlineDays) {
            return ['eligible' => false, 'reasons' => ['The ONU no longer meets the offline-days threshold.']];
        }

        $reasons = $this->cleanupBlockers((string) ($onu['sn'] ?? ''), $safety);

        return ['eligible' => $reasons === [], 'reasons' => $reasons];
    }

    /**
     * Every billing reason an ONU must not be deleted.
     *
     * @param array<string, mixed> $safety
     * @return array<int, string>
     */
    private function cleanupBlockers(string $serialRaw, array $safety): array
    {
        $reasons = [];
        $serial = $this->normalizeSerial($serialRaw);

        if (!$safety['available']) {
            $reasons[] = 'Billing safety validation is unavailable.';
        }

        // Being unable to see who is online is itself a blocker. Reading an
        // unreachable RADIUS device as "nobody is connected" is exactly the failure
        // mode that would unprovision a subscriber who is using the service.
        if (($safety['sessions_available'] ?? false) !== true) {
            $reasons[] = 'RADIUS session state is unavailable, so an active connection cannot be ruled out.';
        }

        if ($serial === '') {
            $reasons[] = 'The ONU carries no serial number, so it cannot be matched to a billing record.';
            return array_values(array_unique($reasons));
        }

        foreach ($safety['accounts'][$serial] ?? [] as $account) {
            if ((int) ($account['billing_status_id'] ?? 0) !== self::BILLING_STATUS_TERMINATED) {
                $reasons[] = 'A billing account on this serial is not Terminated (status ' . ($account['billing_status_id'] ?? 'unknown') . ').';
            }
        }

        foreach ($safety['job_orders'][$serial] ?? [] as $status) {
            $status = strtolower(trim((string) $status));
            if ($status !== '' && !in_array($status, self::CLOSED_JOB_STATUSES, true)) {
                $reasons[] = "An open job order ({$status}) exists for this serial.";
            }
        }

        foreach ($safety['usernames'][$serial] ?? [] as $username) {
            if (isset($safety['online'][strtolower((string) $username)])) {
                $reasons[] = "'{$username}' holds a live RADIUS session on this serial.";
            }
        }

        return array_values(array_unique($reasons));
    }

    // =========================================================================
    // Background jobs
    // =========================================================================

    /**
     * Claim and start a job.
     *
     * Only one job may be active at a time. The claim is a transaction with
     * lockForUpdate over the active rows, so two operators pressing the button at
     * the same moment produce one job and one rejection, not two overlapping sweeps.
     *
     * @param array<string, mixed> $options
     * @return array<string, mixed>
     */
    public function startJob(string $type, array $options = [], ?int $organizationId = null): array
    {
        if (!in_array($type, self::JOB_TYPES, true)) {
            return $this->failure("Unknown job type '{$type}'.");
        }

        if ($this->smartOltConfig() === null && $type !== self::JOB_RADIUS_SCAN) {
            return $this->failure('SmartOLT is not configured — set the sub-domain and token in SmartOLT Config first.');
        }

        if ($type === self::JOB_DELETE) {
            $confirmation = (string) ($options['confirmation'] ?? '');
            if ($confirmation !== self::DELETE_CONFIRMATION) {
                return $this->failure('Permanent deletion requires the confirmation phrase "' . self::DELETE_CONFIRMATION . '".');
            }
        }

        try {
            $job = DB::transaction(function () use ($type, $options, $organizationId): ?array {
                $threshold = now()->subMinutes(self::CLAIM_TTL_MINUTES);

                // Scoped to this tool. The filter was missing, so a live job belonging
                // to any other tool in the suite also blocked SmartOLT from starting —
                // the single-slot rule is per tool, not across the whole table.
                $active = DB::table('tool_jobs')
                    ->where('tool', self::RESOURCE_TYPE)
                    ->whereIn('status', self::LIVE_STATUSES)
                    ->lockForUpdate()
                    ->get();

                $blocking = [];
                $stranded = [];

                foreach ($active as $row) {
                    if ($this->jobIsStranded($row, $threshold)) {
                        $stranded[] = $row;
                    } else {
                        $blocking[] = $row;
                    }
                }

                // Retire the abandoned ones. A job left `running` by a driver that went
                // away — a closed tab before the drain was scheduled, a worker killed
                // mid-slice, a deploy — otherwise holds the single slot forever and
                // every later start is refused with nothing visibly running. Nothing is
                // rolled back: the steps it applied stand, exactly as an operator abort.
                if ($stranded !== []) {
                    $strandedIds = array_map(static fn (object $row): int => (int) $row->id, $stranded);

                    // Conditional on status, so a job another transaction finished in
                    // the meantime is not dragged back out of its terminal state.
                    DB::table('tool_jobs')
                        ->whereIn('id', $strandedIds)
                        ->whereIn('status', self::LIVE_STATUSES)
                        ->update([
                            'status'     => self::STATUS_ABORTED,
                            'message'    => 'Abandoned — nothing advanced this job for over '
                                . self::CLAIM_TTL_MINUTES . ' minutes, so the slot was released.',
                            'locked_by'  => null,
                            'locked_at'  => null,
                            'updated_at' => now(),
                        ]);

                    $this->log('warning', 'Released stranded job(s) holding the active slot.', [
                        'job_ids'     => $strandedIds,
                        'ttl_minutes' => self::CLAIM_TTL_MINUTES,
                        'starting'    => $type,
                    ]);
                }

                if ($blocking !== []) {
                    return null;
                }

                $context = $this->buildJobContext($type, $options, $organizationId);

                $id = DB::table('tool_jobs')->insertGetId([
                    'tool' => self::RESOURCE_TYPE,
                    'type' => $type,
                    'status' => self::STATUS_RUNNING,
                    'current' => 0,
                    'total' => $context['total'],
                    'message' => $context['message'],
                    'context' => json_encode($context['context']),
                    'summary' => null,
                    'user_id' => auth()->id(),
                    'organization_id' => $organizationId,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                return ['id' => $id];
            });
        } catch (Throwable $e) {
            $this->log('error', 'Could not start job.', ['type' => $type, 'error' => $e->getMessage()]);
            return $this->failure('Could not start the job: ' . $e->getMessage());
        }

        if ($job === null) {
            // Reached only when a genuinely live job holds the slot — an abandoned one
            // was already released above — so the operator is told what to wait for.
            $holder = DB::table('tool_jobs')
                ->where('tool', self::RESOURCE_TYPE)
                ->whereIn('status', self::LIVE_STATUSES)
                ->orderByDesc('id')
                ->first();

            if ($holder === null) {
                return $this->failure('Another operation claimed the slot first. Try again.');
            }

            $detail = $holder->status === self::STATUS_PAUSED
                ? 'is paused on a SmartOLT rate limit and will resume on its own'
                : sprintf('is running (%d of %d)', (int) $holder->current, (int) $holder->total);

            return $this->failure(sprintf(
                "'%s' %s. Wait for it to finish, or abort it first.",
                $holder->type,
                $detail
            ));
        }

        $this->log('info', "Job '{$type}' started.", ['job_id' => $job['id'], 'type' => $type]);

        return ['success' => true, 'skipped' => false, 'message' => 'Job started.', 'job' => $this->readJob((int) $job['id'])];
    }

    /**
     * Is this live job abandoned, or is something still working on it?
     *
     * Two independent signs of life, because they alternate. A driver inside a slice
     * holds `locked_at`; between slices the claim is released and it is `saveJob()`
     * bumping `updated_at` that shows progress. Either one inside the TTL means the
     * job is moving and must be left alone.
     *
     * A paused job is the exception worth getting right: it is idle *by design* while
     * a SmartOLT quota cooldown runs, and that cooldown is an hour — far longer than
     * the TTL. Treating it as abandoned would throw away a checkpointed sweep that was
     * about to resume on its own. So a pause is only stranded once its own `resume_at`
     * has passed and still nothing has moved it.
     *
     * @param object $row raw `tool_jobs` row
     */
    private function jobIsStranded(object $row, \Carbon\Carbon $threshold): bool
    {
        foreach (['locked_at', 'updated_at'] as $column) {
            $value = $row->{$column} ?? null;

            if ($value === null || $value === '') {
                continue;
            }

            try {
                if (\Carbon\Carbon::parse($value)->greaterThan($threshold)) {
                    return false;
                }
            } catch (Throwable $e) {
                // An unparseable timestamp is not evidence of abandonment; treat the
                // job as live so a bad value can never trigger an automatic abort.
                return false;
            }
        }

        if (($row->status ?? '') === self::STATUS_PAUSED) {
            $context  = json_decode((string) ($row->context ?? '{}'), true);
            $resumeAt = is_array($context) ? (string) ($context['resume_at'] ?? '') : '';

            if ($resumeAt !== '') {
                try {
                    if (\Carbon\Carbon::parse($resumeAt)->isFuture()) {
                        return false;
                    }
                } catch (Throwable $e) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Advance a job by one bounded slice and report progress.
     *
     * The client calls this repeatedly. Each call does a little work and returns, so
     * neither PHP's execution limit nor an HTTP timeout can strand a long sweep.
     *
     * A paused job resumes here too: if its cooldown has elapsed the slice runs from
     * the checkpoint the pause recorded, so a quota stop costs waiting time and never
     * progress. A paused job whose cooldown has not elapsed is a no-op, not an error.
     *
     * @return array<string, mixed>
     */
    public function processJob(int $jobId): array
    {
        $job = $this->readJob($jobId);

        if ($job === null) {
            return $this->failure("Job #{$jobId} does not exist.");
        }

        if (!in_array($job['status'], self::LIVE_STATUSES, true)) {
            return ['success' => true, 'skipped' => true, 'message' => 'The job is no longer running.', 'job' => $job];
        }

        if ($job['status'] === self::STATUS_PAUSED) {
            if (!$this->cooldownElapsed($job)) {
                return [
                    'success' => true,
                    'skipped' => true,
                    'message' => $job['message'],
                    'job' => $job,
                ];
            }
        }

        // Only one driver may be inside a job at a time. The scheduler drains jobs
        // unattended while an operator may still have the tool open, so without this
        // both could run the same queue index and apply the same step twice — two
        // deletions for one selected ONU. Losing the race is a no-op, not an error:
        // the other driver is already advancing the job and the caller sees its
        // progress on the next poll.
        $owner = $this->driverId();

        if (!$this->claimJob($jobId, $owner)) {
            return [
                'success' => true,
                'skipped' => true,
                'message' => $job['message'],
                'job' => $this->readJob($jobId) ?? $job,
            ];
        }

        try {
            return $this->advanceJob($jobId, $owner);
        } finally {
            // Released even on a throw, so a failed slice cannot hold the claim for
            // the full TTL before the next driver may pick the job up.
            $this->releaseJob($jobId, $owner);
        }
    }

    /**
     * Run one bounded slice of an already-claimed job.
     *
     * Split out of processJob() so the claim is taken once, around the whole slice,
     * and released once — including on the failure path.
     *
     * @return array<string, mixed>
     */
    private function advanceJob(int $jobId, string $owner): array
    {
        // Re-read under the claim. Between the pre-claim read and here another driver
        // may have finished, aborted or advanced this job, and acting on the stale
        // copy would replay a step that has already been applied.
        $job = $this->readJob($jobId);

        if ($job === null) {
            return $this->failure("Job #{$jobId} does not exist.");
        }

        if (!in_array($job['status'], self::LIVE_STATUSES, true)) {
            return ['success' => true, 'skipped' => true, 'message' => 'The job is no longer running.', 'job' => $job];
        }

        if ($job['status'] === self::STATUS_PAUSED) {
            if (!$this->cooldownElapsed($job)) {
                return ['success' => true, 'skipped' => true, 'message' => $job['message'], 'job' => $job];
            }

            $job = $this->resumeJob($job);
        }

        $deadline = microtime(true) + self::SLICE_BUDGET_SECONDS;

        try {
            for ($step = 0; $step < self::SLICE_SIZE; $step++) {
                $job = match ($job['type']) {
                    self::JOB_SMARTOLT_SYNC => $this->stepInventorySync($job),
                    self::JOB_RADIUS_SCAN => $this->stepStatusSync($job),
                        // Canonical name and its legacy alias run the same crawl.
                    self::JOB_OPTICAL_SCAN,
                    self::JOB_MAC_DISCOVERY => $this->stepOpticalDiscovery($job),
                    self::JOB_RENAME => $this->stepRename($job),
                    self::JOB_PROFILE_SYNC => $this->stepProfileSync($job),
                    self::JOB_SN_ALIGNMENT => $this->stepSnAlignment($job),
                    self::JOB_DELETE => $this->stepDelete($job),
                    default => $this->finishJob($job, self::STATUS_FAILED, "Unknown job type '{$job['type']}'."),
                };

                if ($job['status'] !== self::STATUS_RUNNING) {
                    break;
                }

                // Per-ONU endpoints can spend most of a slice on one call; stop on the
                // time budget so the response comes back inside the caller's timeout.
                if (microtime(true) >= $deadline) {
                    break;
                }
            }
        } catch (Throwable $e) {
            $this->log('error', 'Job step failed.', ['job_id' => $jobId, 'type' => $job['type'], 'error' => $e->getMessage()]);
            $job = $this->finishJob($job, self::STATUS_FAILED, 'The job stopped: ' . $e->getMessage());
        }

        return ['success' => true, 'skipped' => false, 'message' => $job['message'], 'job' => $job];
    }

    /**
     * Park a job on a SmartOLT quota rejection, keeping its checkpoint intact.
     *
     * Nothing about the queue or the index is reset — the context is written back
     * exactly as the step left it, which is what makes the resume start on the item
     * that was refused rather than at the beginning.
     *
     * @param array<string, mixed> $job
     * @param array<string, mixed> $context context to checkpoint, as the step left it
     * @return array<string, mixed>
     */
    private function pauseForRateLimit(array $job, array $context, string $reason, ?int $retryAfter = null): array
    {
        $seconds = $retryAfter !== null && $retryAfter > 0
            ? min($retryAfter, self::RATE_LIMIT_COOLDOWN_MINUTES * 60)
            : self::RATE_LIMIT_COOLDOWN_MINUTES * 60;

        $resumeAt = now()->addSeconds($seconds);

        $context['rate_limited'] = true;
        $context['rate_limit_hits'] = (int) ($context['rate_limit_hits'] ?? 0) + 1;
        $context['paused_at'] = now()->toIso8601String();
        $context['resume_at'] = $resumeAt->toIso8601String();
        $context['pause_reason'] = $reason;

        $job['status'] = self::STATUS_PAUSED;
        $job['context'] = $context;
        $job['message'] = sprintf(
            'Paused on the SmartOLT API rate limit — resuming automatically after %s. %s',
            $resumeAt->format('H:i'),
            $reason
        );

        DB::table('tool_jobs')->where('id', $job['id'])->update([
            'status' => self::STATUS_PAUSED,
            'current' => $job['current'],
            'total' => $job['total'],
            'message' => $job['message'],
            'context' => json_encode($context),
            'updated_at' => now(),
        ]);

        $this->log('warning', 'Job paused on the SmartOLT rate limit.', [
            'job_id' => $job['id'],
            'type' => $job['type'],
            'progress' => $job['current'] . '/' . $job['total'],
            'resume_at' => $resumeAt->toDateTimeString(),
            'reason' => $reason,
        ]);

        return $job;
    }

    /**
     * Has a paused job's cooldown elapsed?
     *
     * A job with no recorded resume time is treated as resumable — a missing
     * checkpoint must not strand the sweep forever.
     *
     * @param array<string, mixed> $job
     */
    private function cooldownElapsed(array $job): bool
    {
        $resumeAt = (string) ($job['context']['resume_at'] ?? '');

        if ($resumeAt === '') {
            return true;
        }

        try {
            return \Carbon\Carbon::parse($resumeAt)->isPast();
        } catch (Throwable) {
            return true;
        }
    }

    /**
     * Return a paused job to running, leaving its checkpoint untouched.
     *
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    private function resumeJob(array $job): array
    {
        $context = $job['context'];
        $context['rate_limited'] = false;
        $context['resumed_at'] = now()->toIso8601String();
        unset($context['resume_at'], $context['pause_reason']);

        $job['status'] = self::STATUS_RUNNING;
        $job['context'] = $context;
        $job['message'] = sprintf('Resumed after the rate-limit cooldown at %d of %d.', $job['current'], $job['total']);

        DB::table('tool_jobs')->where('id', $job['id'])->update([
            'status' => self::STATUS_RUNNING,
            'message' => $job['message'],
            'context' => json_encode($context),
            'updated_at' => now(),
        ]);

        $this->log('info', 'Job resumed after the rate-limit cooldown.', [
            'job_id' => $job['id'],
            'type' => $job['type'],
            'progress' => $job['current'] . '/' . $job['total'],
        ]);

        return $job;
    }

    /**
     * Every job still holding the active slot, paused ones included.
     *
     * The daily cron uses this to drain work left parked by a quota stop before it
     * starts anything new.
     *
     * @return array<int, array<string, mixed>>
     */
    public function resumableJobs(?int $organizationId = null): array
    {
        $query = DB::table('tool_jobs')
            ->where('tool', self::RESOURCE_TYPE)
            ->whereIn('status', [self::STATUS_PENDING, self::STATUS_RUNNING, self::STATUS_PAUSED])
            ->orderBy('id');

        if ($organizationId !== null) {
            $query->where(function ($q) use ($organizationId): void {
                $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
            });
        }

        return $query->get()->map(fn(object $row): array => $this->hydrateJob($row))->all();
    }

    /**
     * Stop a running job. Already-applied steps stand; nothing is rolled back.
     *
     * @return array<string, mixed>
     */
    public function abortJob(int $jobId): array
    {
        $job = $this->readJob($jobId);

        if ($job === null) {
            return $this->failure("Job #{$jobId} does not exist.");
        }

        if (!in_array($job['status'], self::LIVE_STATUSES, true)) {
            return ['success' => true, 'skipped' => true, 'message' => 'The job had already stopped.', 'job' => $job];
        }

        $job = $this->finishJob($job, self::STATUS_ABORTED, 'Aborted by the operator.');
        $this->log('info', 'Job aborted.', ['job_id' => $jobId, 'type' => $job['type']]);

        return ['success' => true, 'skipped' => false, 'message' => 'Job aborted.', 'job' => $job];
    }

    /**
     * Identity of this driver, for the claim.
     *
     * Host plus process id, so a stuck claim in `tool_jobs.locked_by` names something
     * an operator can actually go and look at rather than an opaque token.
     */
    private function driverId(): string
    {
        return substr(gethostname() ?: 'unknown', 0, 40) . ':' . getmypid();
    }

    /**
     * Take the claim on a job, or report that someone else holds it.
     *
     * One conditional UPDATE, never a SELECT followed by an UPDATE: the WHERE clause
     * carries the precondition, so two drivers issuing this at the same instant give
     * one row affected and one zero. Whoever gets the row runs the slice.
     *
     * A claim older than CLAIM_TTL_MINUTES is takeable — that is the path that
     * recovers a job whose driver died without ever releasing.
     */
    private function claimJob(int $jobId, string $owner): bool
    {
        $expiry = now()->subMinutes(self::CLAIM_TTL_MINUTES);

        $claimed = DB::table('tool_jobs')
            ->where('id', $jobId)
            ->where('tool', self::RESOURCE_TYPE)
            ->whereIn('status', self::LIVE_STATUSES)
            ->where(function ($q) use ($expiry): void {
                $q->whereNull('locked_at')->orWhere('locked_at', '<=', $expiry);
            })
            ->update(['locked_by' => $owner, 'locked_at' => now()]);

        return $claimed === 1;
    }

    /**
     * Give up the claim, but only if it is still ours.
     *
     * The `locked_by` predicate matters: if our claim already expired and another
     * driver took the job over, an unconditional clear here would release *their*
     * claim and let a third driver in alongside them.
     */
    private function releaseJob(int $jobId, string $owner): void
    {
        try {
            DB::table('tool_jobs')
                ->where('id', $jobId)
                ->where('locked_by', $owner)
                ->update(['locked_by' => null, 'locked_at' => null]);
        } catch (Throwable $e) {
            // A claim that cannot be cleared still expires on its own, so this must
            // never turn a completed slice into a failure.
            $this->log('warning', 'Could not release the job claim.', ['job_id' => $jobId, 'error' => $e->getMessage()]);
        }
    }

    /**
     * One job, by id — read-only, for the UI progress poll.
     *
     * The tool polls this instead of driving the job itself, so a sweep keeps running
     * when the tab is closed and the progress bar simply reattaches on the next visit.
     *
     * @return array<string, mixed>|null
     */
    public function getJob(int $jobId): ?array
    {
        return $this->readJob($jobId);
    }

    /**
     * Advance every live job until they finish, park, or the budget runs out.
     *
     * This is what makes a sweep independent of the browser that started it. The
     * scheduler calls it once a minute; each pass takes the claim on one job at a
     * time and steps it, so a sync started at 17:00 keeps running through the night
     * whether or not anyone is watching. Closing the tab now costs nothing.
     *
     * Repeat-safe by construction. It starts no work of its own — it only advances
     * rows that startJob() already created — and every step is checkpointed by index
     * in `tool_jobs.context`. A pass that dies halfway loses at most the slice in
     * flight, and the claim it held expires and is retaken. Two passes overlapping
     * cannot both enter the same job.
     *
     * @return array{success:int,failed:int,skipped:int,errors:array<int,mixed>,jobs:array<int,array<string,mixed>>}
     */
    public function driveJobs(?int $organizationId = null, int $budgetSeconds = self::DRIVE_BUDGET_SECONDS): array
    {
        $result = ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => [], 'jobs' => []];
        $deadline = microtime(true) + max(1, $budgetSeconds);
        $owner = $this->driverId();

        foreach ($this->resumableJobs($organizationId) as $queued) {
            if (microtime(true) >= $deadline) {
                break;
            }

            $jobId = (int) $queued['id'];

            // Per-job try/catch: one broken job must not abandon the rest of the
            // queue, and what failed has to reach errors[] rather than be swallowed.
            try {
                if (!$this->claimJob($jobId, $owner)) {
                    // Another driver, or an operator's open tab, already has it.
                    $result['skipped']++;
                    continue;
                }

                $steps = 0;

                try {
                    // Keep stepping this job while it stays runnable and the pass has
                    // time left, so one drain finishes short jobs outright instead of
                    // advancing every job by a single slice per minute.
                    while (microtime(true) < $deadline) {
                        $outcome = $this->advanceJob($jobId, $owner);
                        $after = $outcome['job'] ?? null;
                        $steps++;

                        if (!is_array($after) || $after['status'] !== self::STATUS_RUNNING) {
                            break;
                        }
                    }
                } finally {
                    $this->releaseJob($jobId, $owner);
                }

                $final = $this->readJob($jobId);
                $status = $final['status'] ?? self::STATUS_FAILED;

                if ($status === self::STATUS_FAILED) {
                    $result['failed']++;
                    $result['errors'][] = ['job_id' => $jobId, 'error' => $final['message'] ?? 'The job failed.'];
                } elseif (in_array($status, [self::STATUS_PAUSED, self::STATUS_PENDING], true)) {
                    // Parked on a SmartOLT quota stop. Not a failure: the checkpoint
                    // stands and a later pass resumes it once the cooldown elapses.
                    $result['skipped']++;
                } else {
                    $result['success']++;
                }

                $result['jobs'][] = [
                    'job_id' => $jobId,
                    'type' => $final['type'] ?? $queued['type'],
                    'status' => $status,
                    'current' => $final['current'] ?? 0,
                    'total' => $final['total'] ?? 0,
                    'steps' => $steps,
                ];
            } catch (Throwable $e) {
                $result['failed']++;
                $result['errors'][] = ['job_id' => $jobId, 'error' => $e->getMessage()];
                $this->log('error', 'Could not drive a job.', ['job_id' => $jobId, 'error' => $e->getMessage()]);
            }
        }

        return $result;
    }

    // ---- Individual step processors ----------------------------------------

    /**
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    private function stepInventorySync(array $job): array
    {
        $context = $job['context'];
        $page = max(1, (int) ($context['page'] ?? 1));
        $items = is_array($context['items'] ?? null) ? $context['items'] : [];

        $response = $this->callSmartOlt('GET', 'onu/get_all_onus_details', [], [
            'page' => $page,
            'page_size' => self::INVENTORY_PAGE,
        ]);

        if (!$response['success']) {
            if ($response['rate_limited']) {
                // Checkpoint on the page that was refused, not the one after it.
                $context['page'] = $page;
                $context['items'] = $items;

                return $this->pauseForRateLimit($job, $context, 'Inventory download stopped on page ' . $page . '.', $response['retry_after']);
            }

            return $this->finishJob($job, self::STATUS_FAILED, 'SmartOLT rejected the inventory request on page ' . $page . ': ' . $response['error']);
        }

        $merged = $this->mergeInventoryPage($response['data'], $items);
        $items = $merged['items'];

        $totalPages = $merged['total_pages'];
        $hasMore = $totalPages > 0 ? ($page < $totalPages) : ($merged['count'] >= self::INVENTORY_PAGE);

        if ($hasMore) {
            $context['page'] = $page + 1;
            $context['items'] = $items;

            return $this->saveJob($job, [
                'current' => $page,
                'total' => $totalPages > 0 ? $totalPages : $page + 1,
                'message' => sprintf('Downloaded inventory page %d (%d ONUs cached).', $page, count($items)),
                'context' => $context,
            ]);
        }

        $this->putCache('inventory', ['items' => $items, 'updated_at' => now()->toIso8601String()]);

        return $this->finishJob($job, self::STATUS_COMPLETED, 'SmartOLT inventory synchronized.', [
            'inventory_count' => count($items),
            'pages' => $page,
        ]);
    }

    /**
     * Fold one page of get_all_onus_details into the accumulating inventory.
     *
     * Shared by the interactive job step and the unattended daily sweep so the two
     * cannot drift on how a page is parsed or how the last page is detected.
     *
     * @param array<string, mixed> $items inventory accumulated so far
     * @return array{items: array<string, array<string, mixed>>, count: int, total_pages: int}
     */
    private function mergeInventoryPage(mixed $payload, array $items): array
    {
        $onus = is_array($payload) ? ($payload['onus'] ?? $payload['response'] ?? []) : [];

        if (!is_array($onus)) {
            $onus = [];
        }

        foreach ($onus as $onu) {
            if (!is_array($onu)) {
                continue;
            }
            $externalId = $this->externalId($onu);
            if ($externalId !== '') {
                $items[$externalId] = $this->compactOnu($onu, $externalId);
            }
        }

        return [
            'items' => $items,
            'count' => count($onus),
            'total_pages' => is_array($payload) ? (int) ($payload['total_pages'] ?? 0) : 0,
        ];
    }

    /**
     * Parse a get_onus_statuses payload into the cached status shape.
     *
     * @return array<string, array<string, string>>
     */
    private function parseStatusPayload(mixed $payload): array
    {
        $rows = is_array($payload) ? ($payload['onus'] ?? $payload['response'] ?? []) : [];

        if (!is_array($rows)) {
            $rows = [];
        }

        $statuses = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $externalId = $this->externalId($row);
            if ($externalId !== '') {
                $statuses[$externalId] = [
                    'status' => $this->normalizeStatus($row['status'] ?? $row['onu_status'] ?? ''),
                    'last_status_change' => (string) ($row['last_status_change'] ?? $row['status_changed_at'] ?? ''),
                ];
            }
        }

        return $statuses;
    }

    /**
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    private function stepStatusSync(array $job): array
    {
        $response = $this->callSmartOlt('GET', 'onu/get_onus_statuses');

        if (!$response['success']) {
            if ($response['rate_limited']) {
                return $this->pauseForRateLimit($job, $job['context'], 'Status synchronization was refused.', $response['retry_after']);
            }

            return $this->finishJob($job, self::STATUS_FAILED, 'SmartOLT rejected the status request: ' . $response['error']);
        }

        $statuses = $this->parseStatusPayload($response['data']);

        $this->putCache('statuses', ['items' => $statuses, 'updated_at' => now()->toIso8601String()]);

        return $this->finishJob($job, self::STATUS_COMPLETED, 'ONU statuses synchronized.', ['status_count' => count($statuses)]);
    }

    /**
     * One ONU per slice: read its full status, keep the bridge MACs, discard the rest.
     *
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    private function stepOpticalDiscovery(array $job): array
    {
        $context = $job['context'];
        $queue = is_array($context['queue'] ?? null) ? $context['queue'] : [];
        $index = (int) ($context['index'] ?? 0);

        if ($index >= count($queue)) {
            return $this->finishJob($job, self::STATUS_COMPLETED, 'Bridge MAC discovery completed.', [
                'checked' => (int) ($context['checked'] ?? 0),
                'with_macs' => (int) ($context['with_macs'] ?? 0),
            ]);
        }

        $externalId = (string) $queue[$index];
        $macCache = $this->cachedBridgeMacs();

        $response = $this->callSmartOlt('GET', 'onu/get_onu_full_status_info/' . rawurlencode($externalId));

        // This is the endpoint SmartOLT throttles hardest - one call per ONU, against
        // both a per-minute and a per-hour quota. The index is left pointing at the
        // refused ONU so the resume re-reads it instead of skipping past it.
        if (!$response['success'] && $response['rate_limited']) {
            return $this->pauseForRateLimit(
                $job,
                $context,
                sprintf('Bridge MAC discovery stopped at %d of %d.', $index + 1, count($queue)),
                $response['retry_after']
            );
        }

        if ($response['success']) {
            $payload = $response['data']['full_status_json'] ?? $response['data'];
            $macs = $this->extractBridgeMacs($payload);

            $macCache['items'][$externalId] = [
                'macs' => $macs,
                'checked_at' => now()->toIso8601String(),
            ];

            $context['checked'] = (int) ($context['checked'] ?? 0) + 1;
            if ($macs !== []) {
                $context['with_macs'] = (int) ($context['with_macs'] ?? 0) + 1;
            }

            $macCache['updated_at'] = now()->toIso8601String();
            $this->putCache('optical', $macCache);
        }

        $context['index'] = $index + 1;

        return $this->saveJob($job, [
            'current' => $index + 1,
            'message' => sprintf('Discovered bridge MAC %d of %d (%s).', $index + 1, count($queue), $externalId),
            'context' => $context,
        ]);
    }

    /**
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    private function stepRename(array $job): array
    {
        $context = $job['context'];
        $queue = is_array($context['queue'] ?? null) ? $context['queue'] : [];
        $index = (int) ($context['index'] ?? 0);

        if ($index >= count($queue)) {
            return $this->finishJob($job, self::STATUS_COMPLETED, 'Batch ONU rename completed.', [
                'renamed' => (int) ($context['renamed'] ?? 0),
                'skipped' => (int) ($context['skipped'] ?? 0),
                'failed' => (int) ($context['failed'] ?? 0),
            ]);
        }

        $item = $queue[$index];
        $externalId = (string) ($item['external_id'] ?? '');
        $newName = $this->sanitizeName((string) ($item['new_name'] ?? ''));

        $inventory = $this->cachedInventory();
        $oldName = (string) ($inventory['items'][$externalId]['name'] ?? '');

        if ($newName === '') {
            $context['failed'] = (int) ($context['failed'] ?? 0) + 1;
        } elseif ($oldName === $newName) {
            // Already carries the proposed name — a re-run of a finished batch lands here.
            $context['skipped'] = (int) ($context['skipped'] ?? 0) + 1;
        } else {
            $response = $this->callSmartOlt('POST', 'onu/update_location_details/' . rawurlencode($externalId), ['name' => $newName]);

            if (!$response['success'] && $response['rate_limited']) {
                return $this->pauseForRateLimit(
                    $job,
                    $context,
                    sprintf('Rename stopped at %d of %d.', $index + 1, count($queue)),
                    $response['retry_after']
                );
            }

            if ($response['success']) {
                $context['renamed'] = (int) ($context['renamed'] ?? 0) + 1;

                $inventory['items'][$externalId]['name'] = $newName;
                $this->putCache('inventory', $inventory);

                $this->recordLog(
                    'rename_onu',
                    "Renamed ONU {$externalId} to '{$newName}'.",
                    $externalId,
                    ['name' => $oldName],
                    ['name' => $newName]
                );
            } else {
                $context['failed'] = (int) ($context['failed'] ?? 0) + 1;
                $this->log('warning', 'ONU rename rejected.', ['external_id' => $externalId, 'error' => $response['error']]);
            }
        }

        $context['index'] = $index + 1;

        return $this->saveJob($job, [
            'current' => $index + 1,
            'message' => sprintf('Renaming ONU %d of %d.', $index + 1, count($queue)),
            'context' => $context,
        ]);
    }

    /**
     * Write one matched ONU's SmartOLT serial into its subscriber's billing record.
     *
     * The only step in this service that touches a billing table, so it is also the
     * only one that opens a transaction. The transaction is per item and sits inside
     * the loop, never around it: one failed row must not roll back the hundreds that
     * already succeeded. No SmartOLT or RouterOS call happens in here at all, so
     * there is no HTTP inside the transaction and no rate limit to park on.
     *
     * Idempotent by re-read, not by trust. The target is resolved and compared again
     * under `lockForUpdate` at write time rather than relying on what the preview
     * computed, so a serial that was already applied — by an earlier run of this same
     * batch, by another operator, or by a service order in between — is counted as
     * skipped and written again by nobody. Re-running a finished batch therefore ends
     * with `updated = 0`, `failed = 0`.
     *
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    private function stepSnAlignment(array $job): array
    {
        $context = $job['context'];
        $queue = is_array($context['queue'] ?? null) ? $context['queue'] : [];
        $index = (int) ($context['index'] ?? 0);

        if ($index >= count($queue)) {
            return $this->finishJob($job, self::STATUS_COMPLETED, 'Router/modem SN alignment completed.', [
                'updated' => (int) ($context['updated'] ?? 0),
                'skipped' => (int) ($context['skipped'] ?? 0),
                'blocked' => (int) ($context['blocked'] ?? 0),
                'failed' => (int) ($context['failed'] ?? 0),
            ]);
        }

        $scopeId = $context['organization_id'] ?? null;

        $item = $queue[$index];
        $externalId = (string) ($item['external_id'] ?? '');
        $tdId = (int) ($item['technical_detail_id'] ?? 0);
        $newSn = trim((string) ($item['new_sn'] ?? ''));

        if ($tdId <= 0 || $newSn === '') {
            $context['failed'] = (int) ($context['failed'] ?? 0) + 1;
            $this->log('warning', 'SN alignment item is missing its target or serial.', [
                'external_id' => $externalId,
                'technical_detail_id' => $tdId,
            ]);
        } else {
            try {
                // Returns the previous serial when a write happened, null when the
                // record already carried this serial and nothing was done.
                $previousSn = $this->applySnAlignment($tdId, $newSn, $scopeId);

                if ($previousSn === null) {
                    $context['skipped'] = (int) ($context['skipped'] ?? 0) + 1;
                } else {
                    $context['updated'] = (int) ($context['updated'] ?? 0) + 1;

                    $this->recordLog(
                        'align_router_sn',
                        "Adopted SmartOLT serial '{$newSn}' as the router/modem SN for technical_details #{$tdId}.",
                        $externalId,
                        ['technical_detail_id' => $tdId, 'router_modem_sn' => $previousSn],
                        ['technical_detail_id' => $tdId, 'router_modem_sn' => $newSn]
                    );
                }
            } catch (\DomainException $e) {
                // Refused on scope, not broken — counted apart from genuine failures.
                $context['blocked'] = (int) ($context['blocked'] ?? 0) + 1;
                $this->log('warning', 'SN alignment target is outside the caller\'s organization.', [
                    'external_id' => $externalId,
                    'technical_detail_id' => $tdId,
                    'organization_id' => $scopeId,
                ]);
            } catch (Throwable $e) {
                $context['failed'] = (int) ($context['failed'] ?? 0) + 1;
                $this->log('error', 'SN alignment write failed.', [
                    'external_id' => $externalId,
                    'technical_detail_id' => $tdId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $context['index'] = $index + 1;

        return $this->saveJob($job, [
            'current' => $index + 1,
            'message' => sprintf('Aligning router/modem SN %d of %d.', $index + 1, count($queue)),
            'context' => $context,
        ]);
    }

    /**
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    private function stepProfileSync(array $job): array
    {
        $context = $job['context'];
        $queue = is_array($context['queue'] ?? null) ? $context['queue'] : [];
        $index = (int) ($context['index'] ?? 0);

        if ($index >= count($queue)) {
            return $this->finishJob($job, self::STATUS_COMPLETED, 'Profile synchronization completed.', [
                'updated' => (int) ($context['updated'] ?? 0),
                'skipped' => (int) ($context['skipped'] ?? 0),
                'failed' => (int) ($context['failed'] ?? 0),
            ]);
        }

        $item = $queue[$index];
        $externalId = (string) ($item['external_id'] ?? '');
        $inventory = $this->cachedInventory();
        $onu = $inventory['items'][$externalId] ?? [];

        $payload = [];
        $previous = [];
        $next = [];

        if (($item['address_changed'] ?? false) && ($item['new_address'] ?? '') !== '') {
            $payload['address_or_comment'] = $this->sanitizeAddress((string) $item['new_address']);
            $previous['address'] = (string) ($onu['address'] ?? '');
            $next['address'] = $payload['address_or_comment'];
        }

        if (($item['contact_changed'] ?? false) && ($item['new_contact'] ?? '') !== '') {
            $payload['contact'] = $this->sanitizeContact((string) $item['new_contact']);
            $previous['contact'] = (string) ($onu['contact'] ?? '');
            $next['contact'] = $payload['contact'];
        }

        if (($item['coords_changed'] ?? false) && ($item['new_latitude'] ?? '') !== '' && ($item['new_longitude'] ?? '') !== '') {
            $payload['latitude'] = (string) $item['new_latitude'];
            $payload['longitude'] = (string) $item['new_longitude'];
            $previous['latitude'] = (string) ($onu['latitude'] ?? '');
            $previous['longitude'] = (string) ($onu['longitude'] ?? '');
            $next['latitude'] = $payload['latitude'];
            $next['longitude'] = $payload['longitude'];
        }

        if ($payload === []) {
            $context['skipped'] = (int) ($context['skipped'] ?? 0) + 1;
        } else {
            $response = $this->callSmartOlt('POST', 'onu/update_location_details/' . rawurlencode($externalId), $payload);

            if (!$response['success'] && $response['rate_limited']) {
                return $this->pauseForRateLimit(
                    $job,
                    $context,
                    sprintf('Profile push stopped at %d of %d.', $index + 1, count($queue)),
                    $response['retry_after']
                );
            }

            if ($response['success']) {
                $context['updated'] = (int) ($context['updated'] ?? 0) + 1;

                foreach ($next as $field => $value) {
                    $inventory['items'][$externalId][$field] = $value;
                }
                $this->putCache('inventory', $inventory);

                $this->recordLog(
                    'sync_profile',
                    "Pushed location details for ONU {$externalId}.",
                    $externalId,
                    $previous,
                    $next
                );
            } else {
                $context['failed'] = (int) ($context['failed'] ?? 0) + 1;
                $this->log('warning', 'Profile push rejected.', ['external_id' => $externalId, 'error' => $response['error']]);
            }
        }

        $context['index'] = $index + 1;

        return $this->saveJob($job, [
            'current' => $index + 1,
            'message' => sprintf('Pushing profile %d of %d.', $index + 1, count($queue)),
            'context' => $context,
        ]);
    }

    /**
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    private function stepDelete(array $job): array
    {
        $context = $job['context'];
        $queue = is_array($context['queue'] ?? null) ? $context['queue'] : [];
        $index = (int) ($context['index'] ?? 0);

        if ($index >= count($queue)) {
            return $this->finishJob($job, self::STATUS_COMPLETED, 'Inactive ONU cleanup completed.', [
                'deleted' => (int) ($context['deleted'] ?? 0),
                'blocked' => (int) ($context['blocked'] ?? 0),
                'overridden' => (int) ($context['overridden'] ?? 0),
                'failed' => (int) ($context['failed'] ?? 0),
            ]);
        }

        $externalId = (string) $queue[$index];
        $offlineDays = (int) ($context['offline_days'] ?? self::DEFAULT_OFFLINE_DAYS);
        $safety = $this->buildSafetyMap($context['organization_id'] ?? null);

        // Operator-driven cleanup runs on the selection, not on a verdict.
        //
        // The rows in this queue were picked by a person off the Inactive ONU table,
        // so the guard result is advice they have already seen and acted against; the
        // sweep no longer refuses their selection. It is still *computed*, because
        // what was overridden is exactly what an audit needs afterwards: the reasons
        // are attached to the activity-log entry for each deletion.
        //
        // `enforce_safety` restores the refusing behaviour for a caller that wants
        // it. It defaults to false here and is not set by the tool. The unattended
        // nightly pass does not come through this step at all — automateCleanup()
        // keeps its own hard guards, because nothing there was reviewed by a person.
        $enforceSafety = (bool) ($context['enforce_safety'] ?? false);

        $check = $this->revalidateCleanup($externalId, $offlineDays, $safety);

        if ($enforceSafety && !$check['eligible']) {
            $context['blocked'] = (int) ($context['blocked'] ?? 0) + 1;
            $this->log('warning', 'Deletion blocked at final revalidation.', [
                'external_id' => $externalId,
                'reasons' => $check['reasons'],
            ]);
        } else {
            if (!$check['eligible']) {
                $context['overridden'] = (int) ($context['overridden'] ?? 0) + 1;
                $this->log('warning', 'Operator-selected ONU deleted over a safety objection.', [
                    'external_id' => $externalId,
                    'reasons' => $check['reasons'],
                ]);
            }

            $inventory = $this->cachedInventory();
            $onu = $inventory['items'][$externalId] ?? [];

            $response = $this->callSmartOlt('POST', 'onu/delete/' . rawurlencode($externalId));

            if (!$response['success'] && $response['rate_limited']) {
                return $this->pauseForRateLimit(
                    $job,
                    $context,
                    sprintf('Cleanup stopped at %d of %d.', $index + 1, count($queue)),
                    $response['retry_after']
                );
            }

            if ($response['success']) {
                $context['deleted'] = (int) ($context['deleted'] ?? 0) + 1;

                unset($inventory['items'][$externalId]);
                $this->putCache('inventory', $inventory);

                // Unprovisioning is permanent on the OLT side, so this is recorded as
                // an audit entry with no undo rather than a reversible one.
                $this->recordLog(
                    'delete_onu',
                    "Permanently unprovisioned ONU {$externalId} (" . ($onu['sn'] ?? 'no serial') . ').',
                    $externalId,
                    ['onu' => $onu],
                    // What the guards said at the moment of deletion travels with the
                    // entry, so an override is answerable later rather than invisible.
                    ['deleted' => true, 'safety_eligible' => $check['eligible'], 'safety_reasons' => $check['reasons']],
                    false
                );
            } else {
                $context['failed'] = (int) ($context['failed'] ?? 0) + 1;
                $this->log('error', 'ONU deletion rejected.', ['external_id' => $externalId, 'error' => $response['error']]);
            }
        }

        $context['index'] = $index + 1;

        return $this->saveJob($job, [
            'current' => $index + 1,
            'message' => sprintf('Decommissioning ONU %d of %d.', $index + 1, count($queue)),
            'context' => $context,
        ]);
    }

    /**
     * Build the starting context and step total for a job type.
     *
     * @param array<string, mixed> $options
     * @return array{context: array<string, mixed>, total: int, message: string}
     */
    private function buildJobContext(string $type, array $options, ?int $organizationId): array
    {
        switch ($type) {
            case self::JOB_SMARTOLT_SYNC:
                return ['context' => ['page' => 1, 'items' => []], 'total' => 1, 'message' => 'Starting inventory download.'];

            case self::JOB_RADIUS_SCAN:
                return ['context' => [], 'total' => 1, 'message' => 'Starting status synchronization.'];

            case self::JOB_OPTICAL_SCAN:
            case self::JOB_MAC_DISCOVERY:
                $inventory = $this->cachedInventory();
                $macCache = $this->cachedBridgeMacs();
                $requested = is_array($options['external_ids'] ?? null) ? $options['external_ids'] : [];

                // With no explicit target list, only ONUs never read before are
                // queued — so re-running the scan costs nothing for ONUs already
                // crawled instead of spending quota on them again. `rescan` forces
                // the full estate when a genuinely fresh reading is wanted.
                $rescan = (bool) ($options['rescan'] ?? false);

                if ($requested !== []) {
                    $queue = array_values(array_intersect($requested, array_keys($inventory['items'])));
                } elseif ($rescan) {
                    $queue = array_keys($inventory['items']);
                } else {
                    $queue = array_values(array_diff(array_keys($inventory['items']), array_keys($macCache['items'])));
                }

                return [
                    'context' => ['queue' => $queue, 'index' => 0, 'checked' => 0, 'with_macs' => 0],
                    'total' => count($queue),
                    'message' => 'Starting bridge MAC discovery for ' . count($queue) . ' ONU(s).',
                ];

            case self::JOB_RENAME:
                $queue = [];
                foreach (is_array($options['items'] ?? null) ? $options['items'] : [] as $item) {
                    if (!is_array($item) || ($item['external_id'] ?? '') === '' || ($item['new_name'] ?? '') === '') {
                        continue;
                    }
                    $queue[] = ['external_id' => (string) $item['external_id'], 'new_name' => (string) $item['new_name']];
                }

                return [
                    'context' => ['queue' => $queue, 'index' => 0, 'renamed' => 0, 'skipped' => 0, 'failed' => 0],
                    'total' => count($queue),
                    'message' => 'Starting rename of ' . count($queue) . ' ONU(s).',
                ];

            case self::JOB_SN_ALIGNMENT:
                $queue = [];
                foreach (is_array($options['items'] ?? null) ? $options['items'] : [] as $item) {
                    if (!is_array($item)) {
                        continue;
                    }
                    $tdId = (int) ($item['technical_detail_id'] ?? 0);
                    $newSn = trim((string) ($item['new_sn'] ?? ''));
                    if ($tdId <= 0 || $newSn === '') {
                        continue;
                    }
                    $queue[] = [
                        'external_id' => (string) ($item['external_id'] ?? ''),
                        'technical_detail_id' => $tdId,
                        'new_sn' => $newSn,
                    ];
                }

                return [
                    // The caller's scope is checkpointed with the queue. The step
                    // re-checks every row against it, because the ids in `items` came
                    // from the request and a scoped operator must not be able to write
                    // another organization's billing record by posting its id.
                    'context' => [
                        'queue' => $queue,
                        'index' => 0,
                        'updated' => 0,
                        'skipped' => 0,
                        'failed' => 0,
                        'blocked' => 0,
                        'organization_id' => $organizationId,
                    ],
                    'total' => count($queue),
                    'message' => 'Starting router/modem SN alignment for ' . count($queue) . ' subscriber(s).',
                ];

            case self::JOB_PROFILE_SYNC:
                $queue = [];
                foreach (is_array($options['items'] ?? null) ? $options['items'] : [] as $item) {
                    if (!is_array($item) || ($item['external_id'] ?? '') === '') {
                        continue;
                    }
                    $queue[] = $item;
                }

                return [
                    'context' => ['queue' => $queue, 'index' => 0, 'updated' => 0, 'skipped' => 0, 'failed' => 0],
                    'total' => count($queue),
                    'message' => 'Starting profile push for ' . count($queue) . ' ONU(s).',
                ];

            case self::JOB_DELETE:
            default:
                $queue = [];
                foreach (is_array($options['external_ids'] ?? null) ? $options['external_ids'] : [] as $externalId) {
                    if ((string) $externalId !== '') {
                        $queue[] = (string) $externalId;
                    }
                }

                return [
                    'context' => [
                        'queue' => $queue,
                        'index' => 0,
                        'deleted' => 0,
                        'blocked' => 0,
                        'overridden' => 0,
                        'failed' => 0,
                        'offline_days' => max(1, (int) ($options['offline_days'] ?? self::DEFAULT_OFFLINE_DAYS)),
                        // Off by default: the operator's selection is the decision.
                        'enforce_safety' => (bool) ($options['enforce_safety'] ?? false),
                        'organization_id' => $organizationId,
                    ],
                    'total' => count($queue),
                    'message' => 'Starting permanent removal of ' . count($queue) . ' ONU(s).',
                ];
        }
    }

    // =========================================================================
    // Unattended daily automation
    // =========================================================================

    /**
     * The nightly SmartOLT pass, in one call.
     *
     * Refresh the ONU inventory and statuses, read who is authenticating on the
     * RADIUS estate, name every matched ONU for its subscriber's RADIUS username,
     * and unprovision what has been dark long enough and is safe to remove.
     *
     * Resumability without a checkpoint row. Every phase re-derives what is left to
     * do from current state rather than from a saved cursor: a rename is skipped once
     * the ONU already carries the username, and a deleted ONU is gone from the
     * inventory. So a run cut short by a quota stop loses nothing — the next run
     * simply finds less to do. Any operator job parked by the same quota stop is
     * drained first, from its own checkpoint in tool_jobs.
     *
     * Every SmartOLT and RouterOS call here is outside a transaction. This engine
     * writes no billing rows at all; its only database writes are activity_logs
     * audit entries, made by recordLog() after each accepted change.
     *
     * @param array{
     *     offline_days?: int,
     *     discovery?: bool,
     *     rename?: bool,
     *     sn_alignment?: bool,
     *     cleanup?: bool,
     *     dry_run?: bool,
     *     max_discovery?: int,
     *     max_renames?: int,
     *     max_sn?: int,
     *     max_deletes?: int
     * } $options
     * @return array{success:int,failed:int,skipped:int,errors:array<int,mixed>,phases:array<string,mixed>}
     */
    public function runDailyAutomation(array $options = [], ?int $organizationId = null): array
    {
        $result = ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => [], 'phases' => []];

        $offlineDays = max(1, (int) ($options['offline_days'] ?? self::AUTOMATION_OFFLINE_DAYS));
        $doDiscovery = (bool) ($options['discovery'] ?? true);
        $doRename = (bool) ($options['rename'] ?? true);
        $doSnAlignment = (bool) ($options['sn_alignment'] ?? true);
        $doCleanup = (bool) ($options['cleanup'] ?? true);
        $dryRun = (bool) ($options['dry_run'] ?? false);
        $maxDiscovery = max(0, (int) ($options['max_discovery'] ?? self::AUTOMATION_MAX_DISCOVERY));
        $maxRenames = max(0, (int) ($options['max_renames'] ?? 500));
        $maxSn = max(0, (int) ($options['max_sn'] ?? self::AUTOMATION_MAX_SN_UPDATES));
        $maxDeletes = max(0, (int) ($options['max_deletes'] ?? 100));

        $this->log('info', 'SmartOLT daily automation starting.', [
            'offline_days' => $offlineDays,
            'discovery' => $doDiscovery,
            'rename' => $doRename,
            'sn_alignment' => $doSnAlignment,
            'cleanup' => $doCleanup,
            'dry_run' => $dryRun,
            'max_discovery' => $maxDiscovery,
            'max_renames' => $maxRenames,
            'max_sn' => $maxSn,
            'max_deletes' => $maxDeletes,
        ]);

        if ($this->smartOltConfig() === null) {
            $result['errors'][] = 'SmartOLT is not configured — set the sub-domain and token in SmartOLT Config first.';
            $result['failed']++;

            return $result;
        }

        // ---- Phase 0: drain anything a quota stop parked earlier -------------
        $result['phases']['resumed'] = $this->drainParkedJobs($result, $organizationId);

        // ---- Phase 1: inventory ---------------------------------------------
        $inventory = $this->refreshInventory();
        $result['phases']['inventory'] = $inventory;

        if (!$inventory['success']) {
            $result['errors'][] = 'Inventory sync: ' . $inventory['error'];
            $result['failed']++;

            // Without a current inventory every later phase would be acting on a
            // stale picture of the estate. Renaming from stale data is untidy;
            // deleting from it is an outage. Stop here.
            $this->log('warning', 'SmartOLT daily automation stopped after the inventory phase.', ['error' => $inventory['error']]);

            return $result;
        }

        // ---- Phase 2: statuses ----------------------------------------------
        $statuses = $this->refreshStatuses();
        $result['phases']['statuses'] = $statuses;

        if (!$statuses['success']) {
            $result['errors'][] = 'Status sync: ' . $statuses['error'];
            $result['failed']++;

            // Offline-days is derived from last_status_change, so cleanup without
            // fresh statuses is not safe. Renaming does not depend on it.
            $doCleanup = false;
        }

        // ---- Phase 3: one-time bridge-MAC discovery for un-crawled ONUs ------
        // Deliberately before the rename phase: an ONU whose MAC is discovered here
        // is matchable in the same run rather than waiting for the next one.
        if ($doDiscovery) {
            $result['phases']['discovery'] = $this->automateDiscovery($result, $dryRun, $maxDiscovery);
        }

        // ---- Phase 4: MAC match and rename to the RADIUS username ------------
        if ($doRename) {
            $result['phases']['rename'] = $this->automateRenames($result, $organizationId, $dryRun, $maxRenames);
        }

        // ---- Phase 5: adopt the SmartOLT serial as the billing router/modem SN -
        // Runs after the rename phase because it is the second half of the same
        // alignment: the MAC binds the ONU to a live session, the session's username
        // binds it to one billing record, and only then is the serial copied across.
        if ($doSnAlignment) {
            $result['phases']['sn_alignment'] = $this->automateSnAlignment($result, $organizationId, $dryRun, $maxSn);
        }

        // ---- Phase 6: 3-day offline / LOS / PwrFail cleanup ------------------
        if ($doCleanup) {
            $result['phases']['cleanup'] = $this->automateCleanup($result, $organizationId, $offlineDays, $dryRun, $maxDeletes);
        }

        $this->log('info', 'SmartOLT daily automation finished.', [
            'success' => $result['success'],
            'failed' => $result['failed'],
            'skipped' => $result['skipped'],
        ]);

        return $result;
    }

    /**
     * Advance every job left pending, running or paused, so a quota stop from an
     * earlier run does not sit parked forever waiting for an operator to reopen the
     * page. Each job gets one slice; the rest waits for the next run.
     *
     * @param array<string, mixed> $result
     * @return array<string, mixed>
     */
    private function drainParkedJobs(array &$result, ?int $organizationId): array
    {
        $drained = ['examined' => 0, 'advanced' => 0, 'still_paused' => 0];

        foreach ($this->resumableJobs($organizationId) as $job) {
            $drained['examined']++;

            try {
                $outcome = $this->processJob((int) $job['id']);
                $after = $outcome['job'] ?? null;

                if (is_array($after) && $after['status'] === self::STATUS_PAUSED) {
                    $drained['still_paused']++;
                    $result['skipped']++;
                    continue;
                }

                $drained['advanced']++;
                $result['success']++;
            } catch (Throwable $e) {
                $result['failed']++;
                $result['errors'][] = ['job_id' => $job['id'], 'error' => $e->getMessage()];
                $this->log('error', 'Could not advance a parked job.', ['job_id' => $job['id'], 'error' => $e->getMessage()]);
            }
        }

        return $drained;
    }

    /**
     * Re-download the full ONU inventory in one pass.
     *
     * @return array{success: bool, count: int, pages: int, rate_limited: bool, error: string}
     */
    private function refreshInventory(): array
    {
        $items = [];
        $page = 1;

        // A hard ceiling so a paging bug on the far side cannot loop forever.
        $maxPages = 500;

        while ($page <= $maxPages) {
            $response = $this->callSmartOlt('GET', 'onu/get_all_onus_details', [], [
                'page' => $page,
                'page_size' => self::INVENTORY_PAGE,
            ]);

            if (!$response['success']) {
                // A quota stop partway through leaves a partial inventory, and a
                // partial inventory read as complete would make every ONU that was
                // not downloaded look absent. Keep the previous cache instead.
                return [
                    'success' => false,
                    'count' => count($items),
                    'pages' => $page - 1,
                    'rate_limited' => (bool) $response['rate_limited'],
                    'error' => $response['rate_limited']
                        ? 'SmartOLT rate limit reached on page ' . $page . '; the cached inventory was left in place.'
                        : $response['error'],
                ];
            }

            $merged = $this->mergeInventoryPage($response['data'], $items);
            $items = $merged['items'];

            $hasMore = $merged['total_pages'] > 0
                ? ($page < $merged['total_pages'])
                : ($merged['count'] >= self::INVENTORY_PAGE);

            if (!$hasMore) {
                break;
            }

            $page++;
        }

        $this->putCache('inventory', ['items' => $items, 'updated_at' => now()->toIso8601String()]);

        return ['success' => true, 'count' => count($items), 'pages' => $page, 'rate_limited' => false, 'error' => ''];
    }

    /**
     * Re-download bulk ONU statuses.
     *
     * @return array{success: bool, count: int, rate_limited: bool, error: string}
     */
    private function refreshStatuses(): array
    {
        $response = $this->callSmartOlt('GET', 'onu/get_onus_statuses');

        if (!$response['success']) {
            return [
                'success' => false,
                'count' => 0,
                'rate_limited' => (bool) $response['rate_limited'],
                'error' => $response['error'],
            ];
        }

        $statuses = $this->parseStatusPayload($response['data']);
        $this->putCache('statuses', ['items' => $statuses, 'updated_at' => now()->toIso8601String()]);

        return ['success' => true, 'count' => count($statuses), 'rate_limited' => false, 'error' => ''];
    }

    /**
     * Discover the bridge MAC of every ONU that has never been crawled.
     *
     * This is the phase the whole persistent MAC store exists for. Every other pass
     * in this service matches an ONU to a subscriber through the bridge MAC sitting
     * behind it, and the only way to learn that MAC is `get_onu_full_status_info`,
     * which costs one call per ONU against the hardest quota on the API. Crawling the
     * estate nightly to rediscover MACs that were already known made the sweep scale
     * with the size of the estate instead of with the number of new installs.
     *
     * So the queue is exactly the ONUs the MAC snapshot has no entry for. On a
     * settled estate that is empty and this phase makes no calls at all; after a
     * batch of installs it is the size of that batch. An operator who genuinely wants
     * fresh readings for already-crawled ONUs still has the `optical_scan` job with
     * `rescan`, which is unchanged — this phase is only ever additive.
     *
     * Idempotency: the queue is derived from what is missing, so a second run in the
     * same night finds nothing left to do rather than repeating the first. Nothing is
     * enqueued and no billing row is touched; the only write is the optical snapshot.
     *
     * @param array<string, mixed> $result
     * @return array<string, mixed>
     */
    private function automateDiscovery(array &$result, bool $dryRun, int $maxDiscovery): array
    {
        $phase = [
            'pending' => 0,
            'crawled' => 0,
            'with_macs' => 0,
            'failed' => 0,
            'rate_limited' => false,
            'capped' => false,
        ];

        $inventory = $this->cachedInventory();
        $macCache = $this->cachedBridgeMacs();

        // The un-crawled set: in the inventory, absent from the MAC snapshot.
        $queue = array_values(array_diff(array_keys($inventory['items']), array_keys($macCache['items'])));
        $phase['pending'] = count($queue);

        if ($queue === []) {
            $this->log('info', 'MAC discovery had nothing to crawl — every ONU already has a stored reading.', [
                'inventory' => count($inventory['items']),
                'stored' => count($macCache['items']),
            ]);

            return $phase;
        }

        if ($maxDiscovery > 0 && count($queue) > $maxDiscovery) {
            $phase['capped'] = true;
            $queue = array_slice($queue, 0, $maxDiscovery);
        } elseif ($maxDiscovery === 0) {
            $phase['capped'] = true;
            $queue = [];
        }

        $this->log('info', 'MAC discovery starting for un-crawled ONUs.', [
            'pending' => $phase['pending'],
            'this_run' => count($queue),
            'stored' => count($macCache['items']),
            'dry_run' => $dryRun,
        ]);

        if ($dryRun || $queue === []) {
            $result['skipped'] += count($queue);

            return $phase;
        }

        // MACs held back until the next flush. Buffered rather than written straight
        // into the snapshot so the flush can merge against whatever the store holds at
        // that moment — see mergeBridgeMacs().
        $fresh = [];

        foreach ($queue as $externalId) {
            $externalId = (string) $externalId;

            try {
                $response = $this->callSmartOlt('GET', 'onu/get_onu_full_status_info/' . rawurlencode($externalId));

                // A quota stop ends the phase rather than grinding through the rest of
                // the queue collecting refusals. What was read is already flushed
                // below, and what was not is still missing tomorrow, so the next run
                // resumes from the same place without a cursor.
                if (!$response['success'] && $response['rate_limited']) {
                    $phase['rate_limited'] = true;
                    $result['errors'][] = 'MAC discovery stopped on the SmartOLT rate limit.';
                    $this->log('warning', 'MAC discovery stopped on the SmartOLT rate limit.', [
                        'crawled' => $phase['crawled'],
                        'remaining' => $phase['pending'] - $phase['crawled'],
                    ]);
                    break;
                }

                if (!$response['success']) {
                    $phase['failed']++;
                    $result['failed']++;
                    $result['errors'][] = ['external_id' => $externalId, 'error' => $response['error']];
                    continue;
                }

                $payload = $response['data']['full_status_json'] ?? $response['data'];
                $macs = $this->extractBridgeMacs($payload);

                $fresh[$externalId] = [
                    'macs' => $macs,
                    'checked_at' => now()->toIso8601String(),
                ];

                $phase['crawled']++;
                $result['success']++;

                if ($macs !== []) {
                    $phase['with_macs']++;
                }

                if (count($fresh) >= self::DISCOVERY_FLUSH_EVERY) {
                    $this->mergeBridgeMacs($fresh);
                    $fresh = [];
                }
            } catch (Throwable $e) {
                $phase['failed']++;
                $result['failed']++;
                $result['errors'][] = ['external_id' => $externalId, 'error' => $e->getMessage()];
                $this->log('error', 'MAC discovery failed for an ONU.', [
                    'external_id' => $externalId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $this->mergeBridgeMacs($fresh);

        $this->log('info', 'MAC discovery finished.', $phase);

        return $phase;
    }

    /**
     * Fold freshly discovered bridge MACs into the stored snapshot.
     *
     * Re-read at flush time rather than writing back the snapshot the caller started
     * from. An operator-driven `optical_scan` can be crawling the same estate at the
     * same moment, and a blind write of a minutes-old copy would drop every reading it
     * discovered in between — each of which costs another throttled call to re-earn.
     *
     * Merging is additive and keyed by external id, so a re-flush of the same readings
     * overwrites its own entries and adds nothing. The read-modify-write is still not
     * atomic; what it buys is a window measured in one flush rather than one phase,
     * which for an additive merge is the difference between a rare lost reading and a
     * routine one.
     *
     * @param array<string, array<string, mixed>> $readings
     */
    private function mergeBridgeMacs(array $readings): void
    {
        if ($readings === []) {
            return;
        }

        $macCache = $this->cachedBridgeMacs();
        $macCache['items'] = array_merge($macCache['items'], $readings);
        $macCache['updated_at'] = now()->toIso8601String();

        $this->putCache('optical', $macCache);
    }

    /**
     * Adopt each matched ONU's SmartOLT serial as the subscriber's router/modem SN.
     *
     * The second half of the alignment the rename phase starts. The binding is the
     * same one and in the same order — bridge MAC to a live PPPoE calling-station-id,
     * that session's username to exactly one billing record — so a serial is only
     * ever written onto a subscriber the OLT and RADIUS agree on. Matching on the ONU
     * name was rejected for this pass: a misnamed ONU would write its serial onto the
     * wrong subscriber, and unlike a rename that is a change to a billing record.
     *
     * Direction is one-way. SmartOLT reads the serial off the device, so it is the
     * fact; `technical_details.router_modem_sn` is the copy that drifts when a modem
     * is swapped and only one system is updated. Rows already carrying the serial are
     * skipped, which is also what makes a second run in the same night a no-op.
     *
     * The only HTTP here happens while building the preview, before the loop. Each
     * write is its own narrow transaction inside the loop, so one refused row cannot
     * roll back the rest of the estate.
     *
     * @param array<string, mixed> $result
     * @return array<string, mixed>
     */
    private function automateSnAlignment(array &$result, ?int $organizationId, bool $dryRun, int $maxUpdates): array
    {
        $phase = ['candidates' => 0, 'updated' => 0, 'skipped' => 0, 'blocked' => 0, 'failed' => 0, 'capped' => false];

        try {
            $preview = $this->getSnAlignmentPreview($organizationId);
        } catch (Throwable $e) {
            $result['failed']++;
            $result['errors'][] = 'SN alignment: ' . $e->getMessage();
            $this->log('error', 'SN alignment preview failed.', ['error' => $e->getMessage()]);

            return $phase;
        }

        foreach ($preview['errors'] as $error) {
            $result['errors'][] = 'RADIUS: ' . $error;
        }

        foreach ($preview['rows'] as $row) {
            if (($row['eligible'] ?? false) !== true) {
                continue;
            }

            $phase['candidates']++;

            if ($phase['updated'] >= $maxUpdates) {
                // Budget spent. Eligibility is recomputed from current state, so the
                // remainder is simply found again tomorrow.
                $phase['capped'] = true;
                $phase['skipped']++;
                $result['skipped']++;
                continue;
            }

            $externalId = (string) ($row['external_id'] ?? '');
            $tdId = (int) ($row['technical_detail_id'] ?? 0);
            $newSn = trim((string) ($row['sn'] ?? ''));

            if ($tdId <= 0 || $newSn === '') {
                $phase['failed']++;
                $result['failed']++;
                $this->log('warning', 'SN alignment candidate is missing its target or serial.', [
                    'external_id' => $externalId,
                    'technical_detail_id' => $tdId,
                ]);
                continue;
            }

            if ($dryRun) {
                $phase['skipped']++;
                $result['skipped']++;
                continue;
            }

            try {
                $previousSn = $this->applySnAlignment($tdId, $newSn, $organizationId);

                if ($previousSn === null) {
                    $phase['skipped']++;
                    $result['skipped']++;
                    continue;
                }

                $phase['updated']++;
                $result['success']++;

                $this->recordLog(
                    'align_router_sn',
                    "Daily automation adopted SmartOLT serial '{$newSn}' as the router/modem SN for technical_details #{$tdId}.",
                    $externalId,
                    ['technical_detail_id' => $tdId, 'router_modem_sn' => $previousSn],
                    ['technical_detail_id' => $tdId, 'router_modem_sn' => $newSn],
                    true,
                    [
                        'source' => 'cron:smartolt-daily-automation',
                        'matched_mac' => $row['calling_station_id'] ?? '',
                        'radius_username' => $row['radius_username'] ?? '',
                    ]
                );
            } catch (\DomainException $e) {
                // Refused on scope, not broken — counted apart from genuine failures.
                $phase['blocked']++;
                $result['skipped']++;
                $this->log('warning', 'SN alignment target is outside the run\'s organization.', [
                    'external_id' => $externalId,
                    'technical_detail_id' => $tdId,
                    'organization_id' => $organizationId,
                ]);
            } catch (Throwable $e) {
                $phase['failed']++;
                $result['failed']++;
                $result['errors'][] = ['external_id' => $externalId, 'error' => $e->getMessage()];
                $this->log('error', 'Automated SN alignment write failed.', [
                    'external_id' => $externalId,
                    'technical_detail_id' => $tdId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $this->log('info', 'SN alignment phase finished.', $phase);

        return $phase;
    }

    /**
     * Write one router/modem SN, under a lock, inside its own transaction.
     *
     * Shared by the operator-driven `sn_alignment` job and the unattended phase so the
     * two cannot drift apart on what a scoped write is allowed to touch.
     *
     * @return string|null The serial replaced, or null when the row already carried
     *                     this serial and nothing was written.
     *
     * @throws \DomainException when the row belongs to another organization.
     * @throws \RuntimeException when the row no longer exists.
     */
    private function applySnAlignment(int $tdId, string $newSn, ?int $scopeId): ?string
    {
        return DB::transaction(function () use ($tdId, $newSn, $scopeId): ?string {
            $current = DB::table('technical_details')
                ->where('id', $tdId)
                ->lockForUpdate()
                ->first();

            if ($current === null) {
                throw new \RuntimeException("technical_details #{$tdId} no longer exists.");
            }

            // Out-of-scope target: refused, not written. Mirrors the scoping
            // loadSubscribers() applies when building the preview, so a write can only
            // ever land on a record the caller was allowed to see.
            if ($scopeId !== null) {
                $rowOrg = $current->organization_id === null ? null : (int) $current->organization_id;
                if ($rowOrg !== null && $rowOrg !== (int) $scopeId) {
                    throw new \DomainException("technical_details #{$tdId} belongs to another organization.");
                }
            }

            $stored = trim((string) ($current->router_modem_sn ?? ''));

            // Already aligned. Returning null here is what makes both callers
            // idempotent: a re-run reports a skip instead of rewriting the row and
            // logging a second audit entry for a change that did not happen.
            if ($stored !== '' && $this->normalizeSerial($stored) === $this->normalizeSerial($newSn)) {
                return null;
            }

            DB::table('technical_details')
                ->where('id', $tdId)
                ->update([
                    'router_modem_sn' => $newSn,
                    'updated_at' => now(),
                ]);

            return $stored;
        });
    }

    /**
     * Rename every MAC-matched ONU to its subscriber's RADIUS username.
     *
     * @param array<string, mixed> $result
     * @return array<string, mixed>
     */
    private function automateRenames(array &$result, ?int $organizationId, bool $dryRun, int $maxRenames): array
    {
        $phase = ['candidates' => 0, 'renamed' => 0, 'skipped' => 0, 'failed' => 0, 'rate_limited' => false, 'capped' => false];

        try {
            $preview = $this->getMacAlignmentPreview($organizationId);
        } catch (Throwable $e) {
            $result['failed']++;
            $result['errors'][] = 'MAC alignment: ' . $e->getMessage();
            $this->log('error', 'MAC alignment preview failed.', ['error' => $e->getMessage()]);

            return $phase;
        }

        foreach ($preview['errors'] as $error) {
            $result['errors'][] = 'RADIUS: ' . $error;
        }

        $inventory = $this->cachedInventory();

        foreach ($preview['rows'] as $row) {
            if (($row['eligible'] ?? false) !== true) {
                continue;
            }

            $phase['candidates']++;

            if ($phase['renamed'] >= $maxRenames) {
                // Budget spent. The remainder is picked up tomorrow, or sooner by an
                // operator; nothing is lost because eligibility is recomputed.
                $phase['capped'] = true;
                $phase['skipped']++;
                $result['skipped']++;
                continue;
            }

            $externalId = (string) $row['external_id'];
            $targetName = $this->sanitizeName((string) $row['target_name']);
            $oldName = (string) ($inventory['items'][$externalId]['name'] ?? '');

            if ($targetName === '' || strcmp($oldName, $targetName) === 0) {
                $phase['skipped']++;
                $result['skipped']++;
                continue;
            }

            if ($dryRun) {
                $phase['skipped']++;
                $result['skipped']++;
                continue;
            }

            try {
                $response = $this->callSmartOlt(
                    'POST',
                    'onu/update_location_details/' . rawurlencode($externalId),
                    ['name' => $targetName]
                );

                if (!$response['success'] && $response['rate_limited']) {
                    $phase['rate_limited'] = true;
                    $result['errors'][] = 'Rename phase stopped on the SmartOLT rate limit.';
                    $this->log('warning', 'Rename phase stopped on the SmartOLT rate limit.', [
                        'renamed' => $phase['renamed'],
                    ]);
                    break;
                }

                if (!$response['success']) {
                    $phase['failed']++;
                    $result['failed']++;
                    $result['errors'][] = ['external_id' => $externalId, 'error' => $response['error']];
                    continue;
                }

                $phase['renamed']++;
                $result['success']++;

                $inventory['items'][$externalId]['name'] = $targetName;
                $this->putCache('inventory', $inventory);

                $this->recordLog(
                    'rename_onu',
                    "Daily automation renamed ONU {$externalId} to the RADIUS username '{$targetName}'.",
                    $externalId,
                    ['name' => $oldName],
                    ['name' => $targetName],
                    true,
                    ['source' => 'cron:smartolt-daily-automation', 'matched_mac' => $row['calling_station_id'] ?? '']
                );
            } catch (Throwable $e) {
                $phase['failed']++;
                $result['failed']++;
                $result['errors'][] = ['external_id' => $externalId, 'error' => $e->getMessage()];
                $this->log('error', 'Automated rename failed.', ['external_id' => $externalId, 'error' => $e->getMessage()]);
            }
        }

        return $phase;
    }

    /**
     * Unprovision ONUs dark for the threshold and cleared by every safety guard.
     *
     * Each candidate is revalidated immediately before its delete fires — the
     * preview that selected it is already seconds old by then, and an ONU that has
     * come back to life in between must not be removed.
     *
     * @param array<string, mixed> $result
     * @return array<string, mixed>
     */
    private function automateCleanup(array &$result, ?int $organizationId, int $offlineDays, bool $dryRun, int $maxDeletes): array
    {
        $phase = ['candidates' => 0, 'deleted' => 0, 'blocked' => 0, 'failed' => 0, 'rate_limited' => false, 'capped' => false];

        try {
            $preview = $this->getCleanupPreview($offlineDays, $organizationId);
            $safety = $this->buildSafetyMap($organizationId);
        } catch (Throwable $e) {
            $result['failed']++;
            $result['errors'][] = 'Cleanup preview: ' . $e->getMessage();
            $this->log('error', 'Cleanup preview failed.', ['error' => $e->getMessage()]);

            return $phase;
        }

        // Refuse to delete anything at all while the guards are degraded. This is the
        // difference between "nothing was eligible tonight" and "we could not tell,
        // so we removed them anyway".
        if (($safety['available'] ?? false) !== true || ($safety['sessions_available'] ?? false) !== true) {
            $result['errors'][] = 'Cleanup skipped: billing or RADIUS session validation was unavailable.';
            $result['skipped']++;

            $this->log('warning', 'Automated cleanup skipped — safety validation unavailable.', [
                'billing_available' => $safety['available'] ?? false,
                'sessions_available' => $safety['sessions_available'] ?? false,
                'session_errors' => $safety['session_errors'] ?? [],
            ]);

            return $phase;
        }

        foreach ($preview['rows'] as $row) {
            if (($row['eligible'] ?? false) !== true) {
                $phase['blocked']++;
                continue;
            }

            $phase['candidates']++;

            if ($phase['deleted'] >= $maxDeletes) {
                $phase['capped'] = true;
                $result['skipped']++;
                continue;
            }

            $externalId = (string) $row['external_id'];

            if ($dryRun) {
                $result['skipped']++;
                continue;
            }

            try {
                // Last look before an irreversible call.
                $check = $this->revalidateCleanup($externalId, $offlineDays, $safety);

                if (!$check['eligible']) {
                    $phase['blocked']++;
                    $result['skipped']++;
                    $this->log('warning', 'Automated deletion blocked at final revalidation.', [
                        'external_id' => $externalId,
                        'reasons' => $check['reasons'],
                    ]);
                    continue;
                }

                $inventory = $this->cachedInventory();
                $onu = $inventory['items'][$externalId] ?? [];

                $response = $this->callSmartOlt('POST', 'onu/delete/' . rawurlencode($externalId));

                if (!$response['success'] && $response['rate_limited']) {
                    $phase['rate_limited'] = true;
                    $result['errors'][] = 'Cleanup phase stopped on the SmartOLT rate limit.';
                    $this->log('warning', 'Cleanup phase stopped on the SmartOLT rate limit.', ['deleted' => $phase['deleted']]);
                    break;
                }

                if (!$response['success']) {
                    $phase['failed']++;
                    $result['failed']++;
                    $result['errors'][] = ['external_id' => $externalId, 'error' => $response['error']];
                    continue;
                }

                $phase['deleted']++;
                $result['success']++;

                unset($inventory['items'][$externalId]);
                $this->putCache('inventory', $inventory);

                $this->recordLog(
                    'delete_onu',
                    "Daily automation unprovisioned ONU {$externalId} (" . ($onu['sn'] ?? 'no serial') . ') after ' . $offlineDays . '+ days offline.',
                    $externalId,
                    ['onu' => $onu],
                    ['deleted' => true],
                    false,
                    [
                        'source' => 'cron:smartolt-daily-automation',
                        'offline_days' => $row['days_offline'] ?? null,
                        'onu_status' => $row['status'] ?? null,
                    ]
                );
            } catch (Throwable $e) {
                $phase['failed']++;
                $result['failed']++;
                $result['errors'][] = ['external_id' => $externalId, 'error' => $e->getMessage()];
                $this->log('error', 'Automated deletion failed.', ['external_id' => $externalId, 'error' => $e->getMessage()]);
            }
        }

        return $phase;
    }

    // =========================================================================
    // Undo & logs
    // =========================================================================

    /**
     * Reverse a logged rename or profile push back to its snapshot.
     *
     * @return array<string, mixed>
     */
    public function undoOperation(int $logId): array
    {
        $entry = ActivityLog::where('log_id', $logId)
            ->where('resource_type', self::RESOURCE_TYPE)
            ->first();

        if ($entry === null) {
            return $this->failure("Operation log #{$logId} does not exist.");
        }

        $data = is_array($entry->additional_data) ? $entry->additional_data : [];

        if (($data['reversible'] ?? false) !== true) {
            return $this->failure('This operation was recorded as not reversible. Permanent ONU deletion cannot be undone from here — the ONU must be re-provisioned in SmartOLT.');
        }

        if (($data['reversed'] ?? false) === true) {
            return ['success' => true, 'skipped' => true, 'message' => "Operation #{$logId} has already been reversed."];
        }

        $externalId = (string) ($data['external_id'] ?? '');
        $previous = is_array($data['previous_state'] ?? null) ? $data['previous_state'] : [];

        // SN alignment is the one operation here that changed a billing row rather
        // than the ONU, so it is reversed against the database and never through the
        // SmartOLT API. Detected on the snapshot's shape rather than the action name,
        // so a renamed action string cannot route a DB change into the ONU path.
        if (array_key_exists('technical_detail_id', $previous)) {
            return $this->undoSnAlignment($entry, $data, $logId);
        }

        if ($externalId === '' || $previous === []) {
            return $this->failure("Operation #{$logId} carries no snapshot to restore.");
        }

        $payload = [];
        if (array_key_exists('name', $previous)) {
            $payload['name'] = $this->sanitizeName((string) $previous['name']);
        }
        if (array_key_exists('address', $previous)) {
            $payload['address_or_comment'] = $this->sanitizeAddress((string) $previous['address']);
        }
        if (array_key_exists('contact', $previous)) {
            $payload['contact'] = $this->sanitizeContact((string) $previous['contact']);
        }
        if (array_key_exists('latitude', $previous) && array_key_exists('longitude', $previous)) {
            $payload['latitude'] = (string) $previous['latitude'];
            $payload['longitude'] = (string) $previous['longitude'];
        }

        if ($payload === []) {
            return $this->failure("Operation #{$logId} holds no field this API can restore.");
        }

        $response = $this->callSmartOlt('POST', 'onu/update_location_details/' . rawurlencode($externalId), $payload);

        if (!$response['success']) {
            return $this->failure('SmartOLT rejected the reversal: ' . $response['error']);
        }

        $inventory = $this->cachedInventory();
        if (isset($inventory['items'][$externalId])) {
            foreach ($previous as $field => $value) {
                $inventory['items'][$externalId][$field] = $value;
            }
            $this->putCache('inventory', $inventory);
        }

        $data['reversed'] = true;
        $data['reversed_at'] = now()->toIso8601String();
        $data['reversed_by'] = auth()->id();
        $entry->additional_data = $data;
        $entry->save();

        $this->recordLog(
            'undo_' . $entry->action,
            "Reversed operation #{$logId} ({$entry->action}) for ONU {$externalId}.",
            $externalId,
            is_array($data['new_state'] ?? null) ? $data['new_state'] : [],
            $previous,
            false,
            ['reverted_log_id' => $logId]
        );

        return ['success' => true, 'skipped' => false, 'message' => "Operation #{$logId} reversed."];
    }

    /**
     * Reverse one SN adoption by putting the previous router/modem SN back.
     *
     * Refuses when the current value is no longer the one this operation wrote: a
     * later service order or another operator has since set the serial, and quietly
     * reverting to a snapshot older than that change would silently undo their work
     * too. The operator is told what it found instead.
     *
     * @param array<string, mixed> $data
     * @return array{success: bool, skipped: bool, message: string}
     */
    private function undoSnAlignment(ActivityLog $entry, array $data, int $logId): array
    {
        $previous = is_array($data['previous_state'] ?? null) ? $data['previous_state'] : [];
        $applied = is_array($data['new_state'] ?? null) ? $data['new_state'] : [];

        $tdId = (int) ($previous['technical_detail_id'] ?? 0);
        if ($tdId <= 0) {
            return $this->failure("Operation #{$logId} carries no billing record to restore.");
        }

        $previousSn = trim((string) ($previous['router_modem_sn'] ?? ''));
        $appliedSn = trim((string) ($applied['router_modem_sn'] ?? ''));

        try {
            $outcome = DB::transaction(function () use ($tdId, $previousSn, $appliedSn): string {
                $current = DB::table('technical_details')
                    ->where('id', $tdId)
                    ->lockForUpdate()
                    ->first();

                if ($current === null) {
                    return 'missing';
                }

                $stored = trim((string) ($current->router_modem_sn ?? ''));

                if ($appliedSn !== '' && $this->normalizeSerial($stored) !== $this->normalizeSerial($appliedSn)) {
                    return 'changed';
                }

                DB::table('technical_details')
                    ->where('id', $tdId)
                    ->update([
                        // An empty snapshot means the column was blank before this
                        // operation filled it; restore the blank, not an empty string.
                        'router_modem_sn' => $previousSn === '' ? null : $previousSn,
                        'updated_at' => now(),
                    ]);

                return 'restored';
            });
        } catch (Throwable $e) {
            $this->log('error', 'SN alignment reversal failed.', [
                'log_id' => $logId,
                'technical_detail_id' => $tdId,
                'error' => $e->getMessage(),
            ]);
            return $this->failure("Could not reverse operation #{$logId}: " . $e->getMessage());
        }

        if ($outcome === 'missing') {
            return $this->failure("The billing record this operation changed (technical_details #{$tdId}) no longer exists.");
        }

        if ($outcome === 'changed') {
            return $this->failure("The router/modem SN has been changed since operation #{$logId} ran, so it was left alone. Review the record before reversing by hand.");
        }

        $data['reversed'] = true;
        $data['reversed_at'] = now()->toIso8601String();
        $data['reversed_by'] = auth()->id();
        $entry->additional_data = $data;
        $entry->save();

        $this->recordLog(
            'undo_' . $entry->action,
            "Reversed operation #{$logId} ({$entry->action}) — restored the router/modem SN on technical_details #{$tdId}.",
            (string) ($data['external_id'] ?? ''),
            $applied,
            $previous,
            false,
            ['reverted_log_id' => $logId]
        );

        return ['success' => true, 'skipped' => false, 'message' => "Operation #{$logId} reversed."];
    }

    /**
     * Recent SmartOLT tool operations, newest first.
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
                'log_id' => (int) $entry->log_id,
                'created_at' => optional($entry->created_at)->toIso8601String(),
                'level' => $entry->level,
                'action' => $entry->action,
                'message' => $entry->message,
                'operator' => $entry->user?->username ?? $entry->user?->email_address ?? 'System',
                'external_id' => $data['external_id'] ?? null,
                'previous_state' => is_array($data['previous_state'] ?? null) ? $data['previous_state'] : [],
                'new_state' => is_array($data['new_state'] ?? null) ? $data['new_state'] : [],
                'reversible' => (bool) ($data['reversible'] ?? false),
                'reversed' => (bool) ($data['reversed'] ?? false),
                'reversed_at' => $data['reversed_at'] ?? null,
            ];
        })->all();
    }

    /**
     * One of the stored datasets as CSV, read fresh rather than from the client.
     *
     * @return array{filename: string, headers: array<int, string>, rows: array<int, array<int, mixed>>}
     */
    public function exportCsv(string $dataset, ?int $organizationId = null): array
    {
        switch ($dataset) {
            case 'alignment':
                $data = $this->getAlignmentPreview($organizationId);
                $headers = ['External ID', 'Serial', 'Current Name', 'Proposed Name', 'Matched By', 'Account No', 'Customer', 'Plan', 'Status', 'Rename Needed'];
                $rows = array_map(static fn(array $r): array => [
                    $r['external_id'],
                    $r['sn'],
                    $r['current_name'],
                    $r['proposed_name'],
                    $r['matched_by'] ?? '',
                    $r['account_no'] ?? '',
                    $r['customer_name'] ?? '',
                    $r['plan'] ?? '',
                    $r['status'],
                    $r['rename_needed'] ? 'yes' : 'no',
                ], $data['rows']);
                break;

            case 'profile':
                $data = $this->getProfilePreview($organizationId);
                $headers = ['External ID', 'Serial', 'Name', 'Account No', 'Old Address', 'New Address', 'Old Contact', 'New Contact', 'OLT VLAN', 'Billing VLAN', 'Eligible'];
                $rows = array_map(static fn(array $r): array => [
                    $r['external_id'],
                    $r['sn'],
                    $r['name'],
                    $r['account_no'] ?? '',
                    $r['old_address'],
                    $r['new_address'],
                    $r['old_contact'],
                    $r['new_contact'],
                    $r['olt_vlan'],
                    $r['billing_vlan'],
                    $r['eligible'] ? 'yes' : 'no',
                ], $data['rows']);
                break;

            case 'sn_alignment':
                $data = $this->getSnAlignmentPreview($organizationId);
                $headers = ['External ID', 'State', 'SmartOLT Serial', 'Billing SN', 'RADIUS Username', 'Calling-Station-Id', 'Account No', 'Customer', 'Status', 'Eligible', 'Reason'];
                $rows = array_map(static fn(array $r): array => [
                    $r['external_id'],
                    $r['state'],
                    $r['sn'],
                    $r['billing_sn'],
                    $r['radius_username'],
                    $r['calling_station_id'],
                    $r['account_no'],
                    $r['customer_name'],
                    $r['status'],
                    $r['eligible'] ? 'yes' : 'no',
                    $r['reason'],
                ], $data['rows']);
                break;

            case 'cleanup':
                $data = $this->getCleanupPreview(self::DEFAULT_OFFLINE_DAYS, $organizationId);
                $headers = [
                    'External ID',
                    'Serial',
                    'Name',
                    'Zone',
                    'Status',
                    'Last Status Change',
                    'Days Offline',
                    'MAC Address',
                    'MAC Discovered At',
                    'Eligible',
                    'Blockers',
                ];
                $rows = array_map(static fn(array $r): array => [
                    $r['external_id'],
                    $r['sn'],
                    $r['name'],
                    $r['zone_name'],
                    $r['status'],
                    $r['last_status_change'],
                    $r['days_offline'],
                    $r['mac_address'] ?? '',
                    $r['mac_checked_at'] ?? '',
                    $r['eligible'] ? 'yes' : 'no',
                    implode(' | ', $r['reasons']),
                ], $data['rows']);
                break;

            case 'inventory':
            default:
                $dataset = 'inventory';
                $state = $this->getState(true, $organizationId);
                $headers = ['External ID', 'Serial', 'Name', 'OLT', 'Board', 'Port', 'Zone', 'ODB', 'Status', 'Days Offline', 'MAC Address', 'MAC Discovered At'];
                $rows = array_map(static fn(array $r): array => [
                    $r['external_id'],
                    $r['sn'],
                    $r['name'],
                    $r['olt_name'],
                    $r['board'],
                    $r['port'],
                    $r['zone_name'],
                    $r['odb_name'],
                    $r['status'],
                    $r['days_offline'] ?? '',
                    $r['mac_address'] ?? '',
                    $r['mac_checked_at'] ?? '',
                ], $state['rows']);
                break;
        }

        return [
            'filename' => 'smartolt-' . $dataset . '-' . now()->format('Ymd-His') . '.csv',
            'headers' => $headers,
            'rows' => $rows,
        ];
    }

    // =========================================================================
    // SmartOLT I/O
    // =========================================================================

    private function smartOltConfig(): ?SmartOlt
    {
        if ($this->config === null) {
            $this->config = SmartOlt::first();
        }

        return $this->config;
    }

    /**
     * Call the SmartOLT REST API. Always outside a database transaction.
     *
     * Every return carries `rate_limited`, so a caller never has to re-inspect the
     * status code or parse the error text to tell a quota stop from a real failure.
     *
     * @param array<string, mixed> $form
     * @param array<string, mixed> $query
     * @return array{success: bool, status: int, data: mixed, error: string, rate_limited: bool, retry_after: int|null}
     */
    private function callSmartOlt(string $method, string $endpoint, array $form = [], array $query = []): array
    {
        $config = $this->smartOltConfig();

        if ($config === null) {
            return ['success' => false, 'status' => 0, 'data' => null, 'error' => 'SmartOLT is not configured.', 'rate_limited' => false, 'retry_after' => null];
        }

        $url = "https://{$config->sub_domain}.smartolt.com/api/" . ltrim($endpoint, '/');

        try {
            $request = Http::withHeaders(['X-Token' => $config->token])
                ->timeout(self::REQUEST_TIMEOUT)
                ->acceptJson();

            $response = strtoupper($method) === 'GET'
                ? $request->get($url, $query)
                : $request->asForm()->post($url, $form);

            $payload = $response->json();

            // SmartOLT answers 200 with {"status": false} on a rejected call.
            if (!$response->successful()) {
                $limited = in_array($response->status(), self::RATE_LIMIT_STATUSES, true)
                    || $this->looksRateLimited($response->body());

                return [
                    'success' => false,
                    'status' => $response->status(),
                    'data' => $payload,
                    'error' => $limited
                        ? 'SmartOLT rate limit reached (HTTP ' . $response->status() . ').'
                        : 'HTTP ' . $response->status(),
                    'rate_limited' => $limited,
                    'retry_after' => $this->retryAfterSeconds($response->header('Retry-After')),
                ];
            }

            if (is_array($payload) && array_key_exists('status', $payload) && $payload['status'] === false) {
                $error = (string) ($payload['error'] ?? $payload['message'] ?? 'SmartOLT rejected the request.');
                $limited = $this->looksRateLimited($error);

                return [
                    'success' => false,
                    'status' => $response->status(),
                    'data' => $payload,
                    'error' => $error,
                    'rate_limited' => $limited,
                    'retry_after' => $this->retryAfterSeconds($response->header('Retry-After')),
                ];
            }

            return ['success' => true, 'status' => $response->status(), 'data' => $payload, 'error' => '', 'rate_limited' => false, 'retry_after' => null];
        } catch (Throwable $e) {
            $this->log('error', 'SmartOLT request failed.', ['endpoint' => $endpoint, 'error' => $e->getMessage()]);

            return ['success' => false, 'status' => 0, 'data' => null, 'error' => $e->getMessage(), 'rate_limited' => false, 'retry_after' => null];
        }
    }

    /**
     * Does this response text read as a quota rejection rather than a real error?
     *
     * SmartOLT is not consistent about how it reports a throttle — sometimes a 429,
     * sometimes a 200 carrying {"status": false, "error": "..."} — so the text is
     * checked as well as the code. Being wrong in the permissive direction only
     * costs a cooldown; being wrong the other way burns the remaining quota.
     */
    private function looksRateLimited(string $body): bool
    {
        $body = strtolower($body);

        foreach (self::RATE_LIMIT_MARKERS as $marker) {
            if (str_contains($body, $marker)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Seconds from a Retry-After header, in either of its legal forms.
     */
    private function retryAfterSeconds(mixed $header): ?int
    {
        $header = trim((string) (is_array($header) ? ($header[0] ?? '') : $header));

        if ($header === '') {
            return null;
        }

        if (is_numeric($header)) {
            return max(0, (int) $header);
        }

        try {
            $when = \Carbon\Carbon::parse($header);

            return $when->isFuture() ? (int) now()->diffInSeconds($when) : 0;
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * Every bridge MAC anywhere in an ONU's full-status payload.
     *
     * SmartOLT reports the MACs behind an ONU under different keys depending on the
     * OLT vendor, so the payload is walked rather than indexed: any string shaped like
     * a MAC is taken. Order is preserved, because the first one discovered is the one
     * the matching passes try first and the one the UI shows.
     *
     * @return array<int, string>
     */
    private function extractBridgeMacs(mixed $payload): array
    {
        $macs = [];

        $walk = function (mixed $node) use (&$walk, &$macs): void {
            if (is_array($node)) {
                foreach ($node as $value) {
                    $walk($value);
                }

                return;
            }

            if (is_string($node) && preg_match('/^[0-9A-Fa-f]{2}([:\-][0-9A-Fa-f]{2}){5}$/', trim($node)) === 1) {
                $macs[] = trim($node);
            }
        };

        $walk($payload);

        return array_values(array_unique($macs));
    }

    // =========================================================================
    // Billing side
    // =========================================================================

    /**
     * Every subscriber that can be matched to an ONU, keyed by technical_details id.
     *
     * Chunked, with the columns named explicitly, so the sweep does not hydrate
     * models or grow queries with the row count.
     *
     * @return array<int, array<string, string|null>>
     */
    private function loadSubscribers(?int $organizationId = null): array
    {
        $subscribers = [];

        $query = DB::table('technical_details as td')
            ->join('billing_accounts as ba', 'ba.id', '=', 'td.account_id')
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id')
            ->select([
                'td.id as td_id',
                'td.username',
                'td.router_modem_sn',
                'td.vlan',
                'td.ip_address',
                'ba.account_no',
                'ba.billing_status_id',
                'c.first_name',
                'c.last_name',
                'c.address',
                'c.contact_number_primary',
                'c.address_coordinates',
                'c.desired_plan',
            ]);

        if ($organizationId !== null) {
            $query->where(function ($q) use ($organizationId): void {
                $q->where('td.organization_id', $organizationId)->orWhereNull('td.organization_id');
            });
        }

        $query->chunkById(self::SUBSCRIBER_CHUNK, function ($chunk) use (&$subscribers): void {
            foreach ($chunk as $row) {
                $subscribers[(int) $row->td_id] = [
                    'account_no' => trim((string) ($row->account_no ?? '')),
                    'username' => trim((string) ($row->username ?? '')),
                    'sn' => trim((string) ($row->router_modem_sn ?? '')),
                    'vlan' => trim((string) ($row->vlan ?? '')),
                    'mac' => '',
                    'customer_name' => trim(($row->first_name ?? '') . ' ' . ($row->last_name ?? '')),
                    'address' => trim((string) ($row->address ?? '')),
                    'contact' => trim((string) ($row->contact_number_primary ?? '')),
                    'coordinates' => trim((string) ($row->address_coordinates ?? '')),
                    'plan_label' => trim((string) ($row->desired_plan ?? '')),
                    'billing_status_id' => $row->billing_status_id,
                ];
            }
        }, 'td.id', 'td_id');

        return $subscribers;
    }

    /**
     * Billing and network state keyed by serial, for the cleanup safety checks.
     *
     * Memoized for the life of the instance. stepDelete() asks for this once per ONU
     * it is about to remove, and without the memo a 50-item slice would sweep
     * technical_details and job_orders fifty times over and re-read every RADIUS
     * session with them.
     *
     * @return array{
     *     available: bool,
     *     accounts: array<string, array<int, array<string, mixed>>>,
     *     job_orders: array<string, array<int, string>>,
     *     usernames: array<string, array<int, string>>,
     *     sessions_available: bool,
     *     online: array<string, bool>,
     *     session_errors: array<int, string>
     * }
     */
    private function buildSafetyMap(?int $organizationId = null): array
    {
        $key = 'org:' . ($organizationId ?? 'all');

        if (isset($this->safetyMap[$key])) {
            return $this->safetyMap[$key];
        }

        try {
            $accounts = [];
            $jobs = [];
            $usernames = [];

            DB::table('technical_details as td')
                ->join('billing_accounts as ba', 'ba.id', '=', 'td.account_id')
                ->whereNotNull('td.router_modem_sn')
                ->where('td.router_modem_sn', '!=', '')
                ->select(['td.router_modem_sn', 'td.username', 'ba.billing_status_id'])
                ->orderBy('td.id')
                ->chunk(self::SUBSCRIBER_CHUNK, function ($chunk) use (&$accounts, &$usernames): void {
                    foreach ($chunk as $row) {
                        $serial = $this->normalizeSerial((string) $row->router_modem_sn);
                        if ($serial === '') {
                            continue;
                        }

                        $accounts[$serial][] = ['billing_status_id' => $row->billing_status_id];

                        $username = trim((string) ($row->username ?? ''));
                        if ($username !== '') {
                            $usernames[$serial][] = $username;
                        }
                    }
                });

            DB::table('job_orders')
                ->whereNotNull('modem_router_sn')
                ->where('modem_router_sn', '!=', '')
                ->select(['modem_router_sn', 'status'])
                ->orderBy('id')
                ->chunk(self::SUBSCRIBER_CHUNK, function ($chunk) use (&$jobs): void {
                    foreach ($chunk as $row) {
                        $serial = $this->normalizeSerial((string) $row->modem_router_sn);
                        if ($serial !== '') {
                            $jobs[$serial][] = (string) ($row->status ?? '');
                        }
                    }
                });

            // Who is authenticating right now. An ONU whose subscriber holds a live
            // PPPoE session is in service whatever the OLT last reported, and is the
            // single most important thing standing between this sweep and a customer
            // outage. Read once, outside every transaction.
            $sessions = $this->radius->activeSessions($organizationId);

            $online = [];
            foreach (array_keys($sessions['by_username']) as $username) {
                $online[strtolower((string) $username)] = true;
            }

            $map = [
                'available' => true,
                'accounts' => $accounts,
                'job_orders' => $jobs,
                'usernames' => $usernames,
                'sessions_available' => $sessions['available'],
                'online' => $online,
                'session_errors' => $sessions['errors'],
            ];
        } catch (Throwable $e) {
            $this->log('error', 'Could not build the cleanup safety map.', ['error' => $e->getMessage()]);

            $map = [
                'available' => false,
                'accounts' => [],
                'job_orders' => [],
                'usernames' => [],
                'sessions_available' => false,
                'online' => [],
                'session_errors' => [$e->getMessage()],
            ];
        }

        $this->safetyMap[$key] = $map;

        return $map;
    }

    /**
     * The standard ONU name: `[ACC_NO] - [CUSTOMER NAME] - [PLAN]`.
     *
     * @param array<string, string|null> $subscriber
     */
    private function proposedName(array $subscriber): string
    {
        $parts = array_filter([
            trim((string) $subscriber['account_no']),
            trim((string) $subscriber['customer_name']),
            $this->bareGroup((string) $subscriber['plan_label']),
        ], static fn(string $part): bool => $part !== '');

        return $this->sanitizeName(implode(' - ', $parts));
    }

    // =========================================================================
    // Job persistence
    // =========================================================================

    /**
     * @return array<string, mixed>|null
     */
    private function readJob(int $jobId): ?array
    {
        $row = DB::table('tool_jobs')->where('id', $jobId)->where('tool', self::RESOURCE_TYPE)->first();

        return $row === null ? null : $this->hydrateJob($row);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function activeJob(?int $organizationId = null): ?array
    {
        $query = DB::table('tool_jobs')
            ->where('tool', self::RESOURCE_TYPE)
            ->whereIn('status', self::LIVE_STATUSES)
            ->orderByDesc('id');

        if ($organizationId !== null) {
            $query->where(function ($q) use ($organizationId): void {
                $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
            });
        }

        $row = $query->first();

        return $row === null ? null : $this->hydrateJob($row);
    }

    /**
     * @return array<string, mixed>
     */
    private function hydrateJob(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'type' => $row->type,
            'status' => $row->status,
            'current' => (int) $row->current,
            'total' => (int) $row->total,
            'message' => (string) $row->message,
            'context' => json_decode((string) ($row->context ?? '{}'), true) ?: [],
            'summary' => json_decode((string) ($row->summary ?? 'null'), true),
            'created_at' => $row->created_at,
            'updated_at' => $row->updated_at,
        ];
    }

    /**
     * @param array<string, mixed> $job
     * @param array<string, mixed> $changes
     * @return array<string, mixed>
     */
    private function saveJob(array $job, array $changes): array
    {
        $job = array_merge($job, $changes);

        DB::table('tool_jobs')->where('id', $job['id'])->update([
            'current' => $job['current'],
            'total' => $job['total'],
            'message' => $job['message'],
            'context' => json_encode($job['context']),
            'updated_at' => now(),
        ]);

        return $job;
    }

    /**
     * @param array<string, mixed> $job
     * @param array<string, mixed> $summary
     * @return array<string, mixed>
     */
    private function finishJob(array $job, string $status, string $message, array $summary = []): array
    {
        $job['status'] = $status;
        $job['message'] = $message;
        $job['summary'] = $summary;

        DB::table('tool_jobs')->where('id', $job['id'])->update([
            'status' => $status,
            'message' => $message,
            'current' => $job['current'],
            'total' => $job['total'],
            'context' => json_encode($job['context']),
            'summary' => $summary === [] ? null : json_encode($summary),
            'updated_at' => now(),
        ]);

        $this->log($status === self::STATUS_FAILED ? 'error' : 'info', "Job '{$job['type']}' {$status}: {$message}", [
            'job_id' => $job['id'],
            'summary' => $summary,
        ]);

        return $job;
    }

    // =========================================================================
    // Cache
    // =========================================================================

    /**
     * @return array{items: array<string, array<string, mixed>>, updated_at: string|null}
     */
    private function cachedInventory(): array
    {
        return $this->getCache('inventory');
    }

    /**
     * @return array{items: array<string, array<string, mixed>>, updated_at: string|null}
     */
    private function cachedStatuses(): array
    {
        return $this->getCache('statuses');
    }

    /**
     * The cached bridge-MAC snapshot: `external_id => ['macs' => [...], 'checked_at' => ...]`.
     *
     * Still stored under the `optical` cache key, deliberately: that key is one of
     * PERSISTENT_CACHE_KEYS and is mirrored into `smart_olt_cache`, and renaming it
     * would orphan every MAC already discovered for a live estate - each of which
     * costs a throttled API call to earn back.
     *
     * @return array{items: array<string, array<string, mixed>>, updated_at: string|null}
     */
    private function cachedBridgeMacs(): array
    {
        return $this->getCache('optical');
    }

    /**
     * Park a preview's summary under its own small cache key.
     *
     * The dashboard metrics need six figures out of passes that produce thousands of
     * rows. Reading them back off the full preview snapshot would mean decoding that
     * whole blob on every page poll, so each pass leaves a compact copy here instead.
     *
     * @param array<string, int> $summary
     */
    private function rememberSummary(string $name, array $summary, ?string $updatedAt = null): void
    {
        $this->putCache('summary:' . $name, [
            'summary' => $summary,
            'updated_at' => $updatedAt ?? now()->toIso8601String(),
        ]);
    }

    /**
     * Read back what rememberSummary() parked, or an empty array when that pass has
     * never run. Framework cache first, `smart_olt_cache` second - the same two layers
     * getCache() uses, without its `items` shape requirement.
     *
     * @return array<string, mixed>
     */
    private function cachedSummary(string $name): array
    {
        $key = 'summary:' . $name;
        $value = Cache::get(self::CACHE_PREFIX . $key);

        if (is_array($value)) {
            return $value;
        }

        try {
            $row = DB::table('smart_olt_cache')->where('cache_key', $key)->first(['data']);

            if ($row !== null && !empty($row->data)) {
                $decoded = json_decode($row->data, true);

                if (is_array($decoded)) {
                    $this->writeCacheLayer($key, $decoded);

                    return $decoded;
                }
            }
        } catch (Throwable $e) {
            // A metric the dashboard cannot read is a blank card, not a failed page.
            $this->log('warning', 'smart_olt_cache summary read failed.', [
                'cache_key' => $key,
                'error' => $e->getMessage(),
            ]);
        }

        return [];
    }

    /**
     * @return array{items: array<string, mixed>, updated_at: string|null}
     */
    private function getCache(string $key): array
    {
        $value = Cache::get(self::CACHE_PREFIX . $key);

        if (is_array($value) && isset($value['items']) && is_array($value['items'])) {
            return ['items' => $value['items'], 'updated_at' => $value['updated_at'] ?? null];
        }

        // DB fallback via smart_olt_cache, so the snapshot is shared between the web
        // process, the CLI and cron rather than living in one process's cache store.
        // For the persistent keys this is also what outlives a cache flush.
        try {
            $row = DB::table('smart_olt_cache')->where('cache_key', $key)->first();

            if ($row !== null && !empty($row->data)) {
                $decoded = json_decode($row->data, true);

                if (is_array($decoded) && isset($decoded['items']) && is_array($decoded['items'])) {
                    // Repopulate L1 on the same terms the key was written under.
                    $this->writeCacheLayer($key, $decoded);

                    return ['items' => $decoded['items'], 'updated_at' => $decoded['updated_at'] ?? null];
                }
            }
        } catch (Throwable $e) {
            // A missing or unreadable table is a degraded cache, not a failed sweep:
            // the caller gets an empty snapshot and rebuilds it. Logged rather than
            // swallowed, because silently re-crawling 4,000 ONUs every night is
            // exactly the symptom this table exists to prevent.
            $this->log('warning', 'smart_olt_cache read failed; falling back to an empty snapshot.', [
                'cache_key' => $key,
                'error' => $e->getMessage(),
            ]);
        }

        return ['items' => [], 'updated_at' => null];
    }

    /**
     * @param array<string, mixed> $value
     */
    private function putCache(string $key, array $value): void
    {
        $this->writeCacheLayer($key, $value);

        // Persistent DB write so state is shared across web server, CLI, and cron.
        // Keyed on cache_key, which carries a unique index, so a re-run overwrites the
        // row it wrote last time instead of adding another.
        try {
            DB::table('smart_olt_cache')->updateOrInsert(
                ['cache_key' => $key],
                [
                    'data' => json_encode($value),
                    'updated_at' => now(),
                ]
            );
        } catch (Throwable $e) {
            $this->log('warning', 'smart_olt_cache write failed; this snapshot is in-process only.', [
                'cache_key' => $key,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Write the framework-cache copy, with no expiry for the persistent keys.
     *
     * @param array<string, mixed> $value
     */
    private function writeCacheLayer(string $key, array $value): void
    {
        if (in_array($key, self::PERSISTENT_CACHE_KEYS, true)) {
            Cache::forever(self::CACHE_PREFIX . $key, $value);

            return;
        }

        Cache::put(self::CACHE_PREFIX . $key, $value, self::CACHE_TTL);
    }

    // =========================================================================
    // Normalization helpers
    // =========================================================================

    /**
     * @param array<string, mixed> $onu
     */
    private function externalId(array $onu): string
    {
        return trim((string) (
            $onu['unique_external_id']
            ?? $onu['external_id']
            ?? $onu['onu_external_id']
            ?? $onu['id']
            ?? ''
        ));
    }

    /**
     * Reduce an API ONU record to the fields this tool uses.
     *
     * @param array<string, mixed> $onu
     * @return array<string, string>
     */
    private function compactOnu(array $onu, string $externalId): array
    {
        return [
            'external_id' => $externalId,
            'sn' => trim((string) ($onu['sn'] ?? $externalId)),
            'olt_id' => trim((string) ($onu['olt_id'] ?? '')),
            'olt_name' => trim((string) ($onu['olt_name'] ?? '')),
            'board' => trim((string) ($onu['board'] ?? '')),
            'port' => trim((string) ($onu['port'] ?? '')),
            'onu' => trim((string) ($onu['onu'] ?? '')),
            'zone_name' => trim((string) ($onu['zone_name'] ?? $onu['zone'] ?? '')),
            'odb_name' => trim((string) ($onu['odb_name'] ?? $onu['odb'] ?? '')),
            'odb_port' => trim((string) ($onu['odb_port'] ?? '')),
            'name' => trim((string) ($onu['name'] ?? '')),
            'address' => trim((string) ($onu['address'] ?? '')),
            'contact' => trim((string) ($onu['contact'] ?? '')),
            'latitude' => trim((string) ($onu['latitude'] ?? '')),
            'longitude' => trim((string) ($onu['longitude'] ?? '')),
            'vlan' => trim((string) ($onu['vlan'] ?? '')),
            'status' => $this->normalizeStatus($onu['status'] ?? $onu['onu_status'] ?? ''),
            'last_status_change' => trim((string) ($onu['last_status_change'] ?? $onu['status_changed_at'] ?? '')),
        ];
    }

    /**
     * @param array<string, mixed> $onu
     * @param array{items: array<string, mixed>} $statuses
     */
    private function resolveStatus(array $onu, array $statuses): string
    {
        $externalId = (string) ($onu['external_id'] ?? '');
        $cached = $statuses['items'][$externalId] ?? null;

        if (is_array($cached) && ($cached['status'] ?? '') !== '') {
            return $this->normalizeStatus($cached['status']);
        }

        return $this->normalizeStatus($onu['status'] ?? '');
    }

    private function normalizeStatus(mixed $status): string
    {
        $status = strtolower(trim((string) $status));

        return match (true) {
            $status === '' => 'unknown',
            str_contains($status, 'online'), str_contains($status, 'working') => 'online',
            str_contains($status, 'los') => 'los',
            str_contains($status, 'pwrfail'), str_contains($status, 'power') => 'pwrfail',
            str_contains($status, 'offline'), str_contains($status, 'dying') => 'offline',
            default => $status,
        };
    }

    /**
     * @param array<string, mixed> $onu
     * @param array{items: array<string, mixed>} $statuses
     */
    private function daysOffline(array $onu, array $statuses): ?int
    {
        $externalId = (string) ($onu['external_id'] ?? '');
        $changed = $statuses['items'][$externalId]['last_status_change'] ?? ($onu['last_status_change'] ?? '');

        if (trim((string) $changed) === '') {
            return null;
        }

        try {
            $when = \Carbon\Carbon::parse((string) $changed);

            return $when->isFuture() ? null : (int) $when->diffInDays(now());
        } catch (Throwable) {
            return null;
        }
    }

    private function isPlaceholderName(string $name): bool
    {
        $name = strtolower(trim($name));

        return $name === '' || in_array($name, ['not set', 'notset', 'n/a', 'na', '-', '--', 'unknown', 'default'], true);
    }

    private function sanitizeName(string $name): string
    {
        $name = preg_replace('/[\r\n\t]+/', ' ', trim($name)) ?? '';
        $name = preg_replace('/\s+/', ' ', $name) ?? '';

        return mb_substr($name, 0, 128);
    }

    private function sanitizeAddress(string $value): string
    {
        $value = preg_replace('/[\r\n\t]+/', ' ', trim($value)) ?? '';
        $value = preg_replace('/\s+/', ' ', $value) ?? '';

        return mb_substr($value, 0, 255);
    }

    private function sanitizeContact(string $value): string
    {
        $value = preg_replace('/[^0-9+\-() ]/', '', trim($value)) ?? '';

        return mb_substr(trim($value), 0, 100);
    }

    private function normalizeSerial(string $value): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', trim($value)) ?? '');
    }

    /**
     * Strip a MAC to bare uppercase hex - the only form anything in this service
     * compares on. RouterOS reports `aa:bb:cc:dd:ee:ff` and SmartOLT reports
     * `AA-BB-CC-DD-EE-FF`; both must resolve to one key or nothing matches.
     */
    private function normalizeMac(string $value): string
    {
        return strtoupper(preg_replace('/[^A-Fa-f0-9]/', '', trim($value)) ?? '');
    }

    /**
     * The colon-delimited MAC this tool shows for an ONU.
     *
     * An ONU can bridge more than one MAC. The first discovered is the one every
     * matching pass tries first, so it is the one displayed. Empty when nothing has
     * been cached for this ONU yet.
     */
    private function primaryMac(mixed $entry): string
    {
        $macs = is_array($entry) ? ($entry['macs'] ?? []) : [];

        foreach (is_array($macs) ? $macs : [] as $mac) {
            $formatted = $this->formatMac((string) $mac);

            if ($formatted !== '') {
                return $formatted;
            }
        }

        return '';
    }

    /**
     * Colon-delimited MAC for display: XX:XX:XX:XX:XX:XX.
     *
     * Display only, and applied once at the edge. Every comparison in this service
     * runs on normalizeMac()'s bare uppercase hex, so SmartOLT's `AA-BB-CC-DD-EE-FF`
     * and RouterOS's `aa:bb:cc:dd:ee:ff` resolve to one key no matter which side
     * reported them. Anything that is not twelve hex digits is passed through
     * untouched rather than silently blanked.
     */
    private function formatMac(string $value): string
    {
        $bare = $this->normalizeMac($value);

        if (strlen($bare) !== 12) {
            return trim($value);
        }

        return implode(':', str_split($bare, 2));
    }

    /**
     * Split "14.5995,120.9842" into a latitude/longitude pair.
     *
     * @return array{0: string, 1: string}
     */
    private function splitCoordinates(string $coordinates): array
    {
        $coordinates = trim($coordinates);

        if ($coordinates === '' || !str_contains($coordinates, ',')) {
            return ['', ''];
        }

        [$lat, $lng] = array_map('trim', explode(',', $coordinates, 2));

        return is_numeric($lat) && is_numeric($lng) ? [$lat, $lng] : ['', ''];
    }

    private function bareGroup(string $label): string
    {
        $label = trim($label);

        if ($label === '') {
            return '';
        }

        return str_contains($label, ' - ') ? trim(explode(' - ', $label, 2)[0]) : $label;
    }

    // =========================================================================
    // Logging
    // =========================================================================

    /**
     * @param array<string, mixed> $previousState
     * @param array<string, mixed> $newState
     * @param array<string, mixed> $extra
     */
    private function recordLog(
        string $action,
        string $message,
        string $externalId,
        array $previousState,
        array $newState,
        bool $reversible = true,
        array $extra = []
    ): void {
        ActivityLog::log($action, $message, 'info', [
            'resource_type' => self::RESOURCE_TYPE,
            'additional_data' => array_merge([
                'external_id' => $externalId,
                'previous_state' => $previousState,
                'new_state' => $newState,
                'reversible' => $reversible,
                'reversed' => false,
            ], $extra),
        ]);
    }

    /**
     * @return array{success: bool, skipped: bool, message: string}
     */
    private function failure(string $message): array
    {
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
