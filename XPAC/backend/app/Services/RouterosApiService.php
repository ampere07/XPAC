<?php

namespace App\Services;

use App\Models\RadiusConfig;
use App\Support\RadiusCircuitBreaker;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

/**
 * Native MikroTik RouterOS API client, written in pure PHP.
 *
 * This replaces the REST transport (`/rest/user-manage/...`, RouterOS v7 only) that every
 * RADIUS service in this application used to speak. It talks the binary RouterOS API
 * protocol directly on top of stream_socket_client() over port 8728 (plain) or 8729
 * (TLS) — no composer package is involved, and no new dependency is introduced.
 *
 * Two things it does that callers rely on:
 *
 *  1. CONNECTION REUSE. A single operation typically locates a user, changes its group and
 *     then cuts its sessions — three calls that would otherwise mean three TCP handshakes
 *     and three logins. Connections are pooled per device+credential for the life of the
 *     request and reused, so an operation costs one handshake.
 *  2. VERSION-AWARE COMMAND PREFIX. User Manager lives at `/user-manager` on RouterOS 7 and
 *     at `/tool/user-manager` on RouterOS 6. The version is read from
 *     `/system/resource/print` on connect and the prefix chosen once, so callers never have
 *     to know which line they are pointed at.
 *
 * TLS certificates are deliberately not verified: RouterOS ships a self-signed certificate
 * for api-ssl (and frequently an anonymous-DH one), exactly as the REST transport this
 * replaces already did with `verify => false`.
 *
 * Every method is read-then-act and safe to call repeatedly: addUser() will not create a
 * second copy of an account that already exists, and removeUser() reports success for an
 * account that is already gone.
 */
class RouterosApiService
{
    /** Standard RouterOS API service ports. */
    public const API_PORT_PLAIN = 8728;
    public const API_PORT_SSL   = 8729;

    /** User Manager command trees, by RouterOS major version. */
    public const UM_PREFIX_V7 = '/user-manager';
    public const UM_PREFIX_V6 = '/tool/user-manager';

    /** Seconds allowed for the TCP/TLS connect, and for any single read. */
    public const DEFAULT_CONNECT_TIMEOUT = 4;
    public const DEFAULT_READ_TIMEOUT    = 10;

    /** Runaway guards — a corrupt length prefix must not allocate the world. */
    private const MAX_WORD_LENGTH  = 16777216;
    private const MAX_REPLY_BLOCKS = 250000;

    /** Name used to probe which User Manager tree exists when the version is unreadable. */
    private const PREFIX_PROBE_NAME = '__akmiis_prefix_probe__';

    private string $logName = 'Routeros_API';

    /**
     * Live connections, keyed by device + credential.
     *
     * @var array<string, array{socket: resource, prefix: string, version: int, endpoint: string, credentials: array<string, mixed>}>
     */
    private array $pool = [];

    /** Pool key of the connection the protocol methods currently act on. */
    private ?string $current = null;

    private string $lastError = '';

    /**
     * True when the last failed connect found every endpoint for the config in
     * cool-off, so only a single probe was spent rather than a full walk.
     * Lets a caller abandon this config immediately instead of retrying it.
     */
    private bool $lastConnectAllEndpointsDown = false;

    // =========================================================================
    // Connection lifecycle
    // =========================================================================

    /**
     * Open (or reuse) an authenticated API connection to the device behind $config.
     *
     * @param RadiusConfig|array<string, mixed> $config
     * @param int|null    $port Overrides the port resolved from $config.
     * @param string|null $user Overrides the username resolved from $config.
     * @param string|null $pass Overrides the password resolved from $config.
     * @param string|null $ssl  Overrides the ssl_type resolved from $config ('https'/'ssl' vs 'http'/'tcp').
     */
    public function connect($config, ?int $port = null, ?string $user = null, ?string $pass = null, ?string $ssl = null, int $timeout = self::DEFAULT_CONNECT_TIMEOUT): bool
    {
        $this->lastError = '';

        $credentials = $this->resolveCredentials($config, $port, $user, $pass, $ssl, $timeout);

        if ($credentials === null) {
            return false;
        }

        $key = $this->poolKey($credentials);

        // Reuse the live socket rather than re-handshaking for every call of an operation.
        if (isset($this->pool[$key]) && $this->socketAlive($this->pool[$key]['socket'])) {
            $this->current = $key;
            return true;
        }

        $this->closeKey($key);

        return $this->establish($credentials);
    }

    /**
     * Close the current connection politely (`/quit`) and drop it from the pool.
     */
    public function disconnect(): void
    {
        if ($this->current !== null) {
            $this->closeKey($this->current);
        }
    }

    /**
     * Close every pooled connection. Called on destruct; safe to call explicitly.
     */
    public function disconnectAll(): void
    {
        foreach (array_keys($this->pool) as $key) {
            $this->closeKey($key);
        }
    }

    public function isConnected(): bool
    {
        return $this->current !== null
            && isset($this->pool[$this->current])
            && $this->socketAlive($this->pool[$this->current]['socket']);
    }

    public function getLastError(): string
    {
        return $this->lastError;
    }

    /**
     * Did the last failed connect() find every transport for that config already
     * marked down? A caller looping over configs should move to the next one
     * rather than spending its retry budget on this one.
     */
    public function lastConnectAllEndpointsDown(): bool
    {
        return $this->lastConnectAllEndpointsDown;
    }

    /**
     * The endpoint the current connection is using, e.g. `tcp://10.0.0.1:8728`.
     * Empty when nothing is connected.
     */
    public function activeEndpoint(): string
    {
        return $this->currentEndpoint();
    }

    /**
     * Per-transport reachability for a config, for logs and diagnostics.
     *
     * @param RadiusConfig|array<string, mixed> $config
     * @return array<string, string> endpoint => 'up'|'down'
     */
    public function endpointStates($config): array
    {
        $credentials = $this->resolveCredentials($config, null, null, null, null, self::DEFAULT_CONNECT_TIMEOUT);

        if ($credentials === null) {
            return [];
        }

        $states = [];
        foreach ($this->candidateEndpoints($credentials) as $endpoint) {
            $label = $this->endpointLabel($credentials, $endpoint);
            $states[$label] = RadiusCircuitBreaker::state($label);
        }

        return $states;
    }

    /**
     * User Manager command prefix in force on the current connection.
     */
    public function getUserManagerPrefix(): string
    {
        return $this->current !== null && isset($this->pool[$this->current])
            ? $this->pool[$this->current]['prefix']
            : self::UM_PREFIX_V7;
    }

    /**
     * RouterOS major version of the current connection (0 when it could not be read).
     */
    public function getRouterosVersion(): int
    {
        return $this->current !== null && isset($this->pool[$this->current])
            ? $this->pool[$this->current]['version']
            : 0;
    }

    /**
     * Connection + login test. The cheapest way to ask "is this device answering?".
     *
     * @param RadiusConfig|array<string, mixed> $config
     */
    public function ping($config): bool
    {
        return $this->connect($config);
    }

    // =========================================================================
    // User Manager — accounts
    // =========================================================================

    /**
     * Locate one User Manager account by name.
     *
     * The name is matched by the DEVICE via `?name=`, which is case-sensitive — the same
     * exact-match lookup the REST transport did. The comparison below is a safety net
     * against a device that answers a query it did not filter, not a case-insensitive
     * search; PPPoE usernames are generated by PppoeUsernameService and consistently cased.
     *
     * Returns null both when the account is absent and when the device could not be
     * reached; getLastError() is empty in the first case and populated in the second,
     * so callers that must tell them apart can.
     *
     * @param RadiusConfig|array<string, mixed> $config
     * @return array{".id": string, username: string, group: string, disabled: bool, password: string}|null
     */
    public function findUser($config, string $username): ?array
    {
        $username = trim($username);

        if ($username === '') {
            $this->lastError = 'A username is required to look up a User Manager account.';
            return null;
        }

        if (!$this->connect($config)) {
            return null;
        }

        $rows = $this->query($this->getUserManagerPrefix() . '/user/print', [], ['name' => $username]);

        foreach ($rows as $row) {
            if (strcasecmp(trim((string) ($row['name'] ?? '')), $username) === 0) {
                return $this->normalizeUser($row);
            }
        }

        return null;
    }

    /**
     * Every User Manager account on the device, optionally narrowed to one group.
     *
     * @param RadiusConfig|array<string, mixed> $config
     * @return array<int, array{".id": string, username: string, group: string, disabled: bool, password: string}>
     */
    public function getAllUsers($config, ?string $group = null): array
    {
        if (!$this->connect($config)) {
            return [];
        }

        $queries = [];
        if ($group !== null && trim($group) !== '') {
            $queries['group'] = trim($group);
        }

        $users = [];
        foreach ($this->query($this->getUserManagerPrefix() . '/user/print', [], $queries) as $row) {
            $user = $this->normalizeUser($row);
            if ($user['username'] === '') {
                continue;
            }
            $users[] = $user;
        }

        return $users;
    }

    /**
     * Live User Manager sessions, optionally narrowed to one account.
     *
     * The device also stores closed sessions, so rows carrying a terminating marker
     * (`active=no`, `status=stop`, a terminate cause, an end time) are dropped. A row with
     * no such marker is treated as live — which is how the REST transport behaved.
     *
     * @param RadiusConfig|array<string, mixed> $config
     * @return array<int, array{".id": string, username: string, ip: string, mac: string, upload: mixed, download: mixed, uptime: string}>
     */
    public function getActiveSessions($config, ?string $username = null): array
    {
        if (!$this->connect($config)) {
            return [];
        }

        $username = $username !== null ? trim($username) : null;

        $queries = [];
        if ($username !== null && $username !== '') {
            $queries['user'] = $username;
        }

        $sessions = [];
        foreach ($this->query($this->getUserManagerPrefix() . '/session/print', [], $queries) as $row) {
            if (!$this->isActiveSession($row)) {
                continue;
            }

            $session = $this->normalizeSession($row);

            if ($session['username'] === '') {
                continue;
            }

            // The device honours ?user= but re-check locally so a device that ignores the
            // query cannot return another subscriber's session to a per-user caller.
            if ($username !== null && $username !== '' && strcasecmp($session['username'], $username) !== 0) {
                continue;
            }

            $sessions[] = $session;
        }

        return $sessions;
    }

    /**
     * Create a User Manager account.
     *
     * Idempotent: an account that already exists is reported as success and left alone
     * rather than being duplicated, so a re-run of a queued create cannot produce a second
     * copy on the device.
     *
     * @param RadiusConfig|array<string, mixed> $config
     */
    public function addUser($config, string $username, string $password, string $group, bool $disabled = false): bool
    {
        $username = trim($username);
        $group    = trim($group);

        if ($username === '') {
            $this->lastError = 'A username is required to create a User Manager account.';
            return false;
        }

        if (!$this->connect($config)) {
            return false;
        }

        $existing = $this->findUser($config, $username);

        if ($existing !== null) {
            $this->log('info', 'User Manager account already exists; create skipped.', [
                'username' => $username,
                'group'    => $existing['group'],
                'endpoint' => $this->currentEndpoint(),
            ]);
            return true;
        }

        if ($this->lastError !== '') {
            return false;
        }

        $params = [
            'name'     => $username,
            'password' => $password,
            'disabled' => $disabled ? 'yes' : 'no',
        ];

        if ($group !== '') {
            $params['group'] = $group;
        }

        $blocks = $this->rawCommand($this->buildSentence($this->getUserManagerPrefix() . '/user/add', $params));

        if (!$this->succeeded($blocks)) {
            $this->log('error', 'Failed to create User Manager account.', [
                'username' => $username,
                'group'    => $group,
                'endpoint' => $this->currentEndpoint(),
                'error'    => $this->lastError,
            ]);
            return false;
        }

        $this->log('info', 'User Manager account created.', [
            'username' => $username,
            'group'    => $group,
            'endpoint' => $this->currentEndpoint(),
        ]);

        return true;
    }

    /**
     * Change attributes of an existing account. Accepts a RouterOS `.id` (`*1A`) or a username.
     *
     * Supported keys: group, password, disabled, name.
     *
     * @param RadiusConfig|array<string, mixed> $config
     * @param array<string, mixed> $attributes
     */
    public function updateUser($config, string $idOrUsername, array $attributes): bool
    {
        if (!$this->connect($config)) {
            return false;
        }

        $params = [];

        foreach ($attributes as $key => $value) {
            switch ((string) $key) {
                case 'group':
                    $params['group'] = trim((string) $value);
                    break;
                case 'password':
                    $params['password'] = (string) $value;
                    break;
                case 'name':
                case 'username':
                    $params['name'] = trim((string) $value);
                    break;
                case 'disabled':
                    $params['disabled'] = $this->toBool($value) ? 'yes' : 'no';
                    break;
                default:
                    // Unknown keys are ignored on purpose: this method is the only writer
                    // of User Manager attributes and its surface is deliberately closed.
                    break;
            }
        }

        if ($params === []) {
            $this->lastError = 'No supported attribute was supplied for the User Manager update.';
            return false;
        }

        $radiusId = $this->resolveUserId($config, $idOrUsername);

        if ($radiusId === null) {
            if ($this->lastError === '') {
                $this->lastError = "User Manager account '{$idOrUsername}' was not found on this device.";
            }
            return false;
        }

        $params['.id'] = $radiusId;

        $blocks = $this->rawCommand($this->buildSentence($this->getUserManagerPrefix() . '/user/set', $params));

        if (!$this->succeeded($blocks)) {
            $this->log('error', 'Failed to update User Manager account.', [
                'account'    => $idOrUsername,
                'attributes' => array_keys($params),
                'endpoint'   => $this->currentEndpoint(),
                'error'      => $this->lastError,
            ]);
            return false;
        }

        return true;
    }

    /**
     * @param RadiusConfig|array<string, mixed> $config
     */
    public function setUserGroup($config, string $idOrUsername, string $group): bool
    {
        return $this->updateUser($config, $idOrUsername, ['group' => $group]);
    }

    /**
     * @param RadiusConfig|array<string, mixed> $config
     */
    public function setUserPassword($config, string $idOrUsername, string $password): bool
    {
        return $this->updateUser($config, $idOrUsername, ['password' => $password]);
    }

    /**
     * @param RadiusConfig|array<string, mixed> $config
     */
    public function setUserDisabled($config, string $idOrUsername, bool $disabled): bool
    {
        return $this->updateUser($config, $idOrUsername, ['disabled' => $disabled]);
    }

    /**
     * Remove a User Manager account. An account that is already absent counts as success.
     *
     * @param RadiusConfig|array<string, mixed> $config
     */
    public function removeUser($config, string $idOrUsername): bool
    {
        if (!$this->connect($config)) {
            return false;
        }

        $radiusId = $this->resolveUserId($config, $idOrUsername);

        if ($radiusId === null) {
            if ($this->lastError !== '') {
                return false;
            }

            $this->log('info', 'User Manager account already absent; remove skipped.', [
                'account'  => $idOrUsername,
                'endpoint' => $this->currentEndpoint(),
            ]);

            return true;
        }

        $blocks = $this->rawCommand($this->buildSentence(
            $this->getUserManagerPrefix() . '/user/remove',
            ['.id' => $radiusId]
        ));

        if (!$this->succeeded($blocks)) {
            $this->log('error', 'Failed to remove User Manager account.', [
                'account'  => $idOrUsername,
                'endpoint' => $this->currentEndpoint(),
                'error'    => $this->lastError,
            ]);
            return false;
        }

        $this->log('info', 'User Manager account removed.', [
            'account'  => $idOrUsername,
            'endpoint' => $this->currentEndpoint(),
        ]);

        return true;
    }

    // =========================================================================
    // User Manager — sessions
    // =========================================================================

    /**
     * Terminate one session by its RouterOS `.id`.
     *
     * @param RadiusConfig|array<string, mixed> $config
     */
    public function killSession($config, string $sessionId): bool
    {
        $sessionId = trim($sessionId);

        if ($sessionId === '') {
            $this->lastError = 'A session id is required to terminate a session.';
            return false;
        }

        if (!$this->connect($config)) {
            return false;
        }

        $blocks = $this->rawCommand($this->buildSentence(
            $this->getUserManagerPrefix() . '/session/remove',
            ['.id' => $sessionId]
        ));

        if (!$this->succeeded($blocks)) {
            $this->log('warning', 'Failed to terminate User Manager session.', [
                'session_id' => $sessionId,
                'endpoint'   => $this->currentEndpoint(),
                'error'      => $this->lastError,
            ]);
            return false;
        }

        return true;
    }

    /**
     * Terminate every live session belonging to one account. Returns how many were cut.
     *
     * @param RadiusConfig|array<string, mixed> $config
     */
    public function killSessionsForUser($config, string $username): int
    {
        $username = trim($username);

        if ($username === '') {
            return 0;
        }

        $sessions = $this->getActiveSessions($config, $username);

        if ($sessions === []) {
            return 0;
        }

        $killed = 0;

        foreach ($sessions as $session) {
            $sessionId = (string) ($session['.id'] ?? '');

            if ($sessionId === '') {
                continue;
            }

            if ($this->killSession($config, $sessionId)) {
                $killed++;
            }
        }

        if ($killed > 0) {
            $this->log('info', 'Terminated live User Manager session(s).', [
                'username' => $username,
                'killed'   => $killed,
                'endpoint' => $this->currentEndpoint(),
            ]);
        }

        return $killed;
    }

    // =========================================================================
    // User Manager — groups
    // =========================================================================

    /**
     * The group names the device offers: User Manager groups on v7, profiles on v6.
     *
     * @param RadiusConfig|array<string, mixed> $config
     * @return array<int, string>
     */
    public function getGroups($config): array
    {
        if (!$this->connect($config)) {
            return [];
        }

        $prefix  = $this->getUserManagerPrefix();
        $command = $prefix === self::UM_PREFIX_V6
            ? $prefix . '/profile/print'
            : $prefix . '/user/group/print';

        $names = [];

        foreach ($this->query($command) as $row) {
            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $names[strtolower($name)] = $name;
        }

        $groups = array_values($names);
        sort($groups, SORT_NATURAL | SORT_FLAG_CASE);

        return $groups;
    }

    /**
     * Does the device already carry a group of this name? Trimmed, case-insensitive.
     *
     * Returns false when the device cannot be reached — callers that must not block on an
     * outage should check getLastError() before treating false as "the group is missing".
     *
     * @param RadiusConfig|array<string, mixed> $config
     */
    public function groupExists($config, string $groupName): bool
    {
        $groupName = trim($groupName);

        if ($groupName === '') {
            return false;
        }

        foreach ($this->getGroups($config) as $group) {
            if (strcasecmp(trim($group), $groupName) === 0) {
                return true;
            }
        }

        return false;
    }

    // =========================================================================
    // Protocol engine
    // =========================================================================

    /**
     * Send one API sentence and collect every reply block until !done / !fatal.
     *
     * @param array<int, string> $sentence
     * @return array<int, array{type: string, attributes: array<string, string>}>
     */
    public function rawCommand(array $sentence): array
    {
        if ($sentence === []) {
            $this->lastError = 'An empty RouterOS sentence cannot be sent.';
            return [];
        }

        if ($this->current === null || !isset($this->pool[$this->current])) {
            $this->lastError = 'Not connected to a RouterOS device.';
            return [];
        }

        $this->lastError = '';

        $key         = $this->current;
        $credentials = $this->pool[$key]['credentials'];
        $writeFailed = false;

        $blocks = $this->executeOn($this->pool[$key]['socket'], $sentence, $writeFailed);

        // A pooled socket the device has since closed fails on the write, before any byte
        // of the command was accepted — re-handshake once and replay. A failure during the
        // READ is never replayed: the device may already have applied the change.
        if ($blocks === null && $writeFailed) {
            $this->closeKey($key);

            if ($this->establish($credentials)) {
                $retryWriteFailed = false;
                $blocks = $this->executeOn($this->pool[$this->current]['socket'], $sentence, $retryWriteFailed);
            }
        }

        if ($blocks === null) {
            return [];
        }

        foreach ($blocks as $block) {
            if ($block['type'] === '!trap' || $block['type'] === '!fatal') {
                $this->lastError = $block['attributes']['message']
                    ?? $block['attributes']['_message']
                    ?? 'The RouterOS device rejected the command.';
            }
        }

        return $blocks;
    }

    /**
     * Run a print/query command and return its `!re` rows as associative arrays.
     *
     * @param array<string, mixed> $params  Command attributes, sent as `=key=value`.
     * @param array<string, mixed> $queries Row filters, sent as `?key=value`.
     * @return array<int, array<string, string>>
     */
    public function query(string $cmd, array $params = [], array $queries = []): array
    {
        $sentence = $this->buildSentence($cmd, $params, $queries);
        $blocks   = $this->rawCommand($sentence);

        $rows = [];

        foreach ($blocks as $block) {
            if ($block['type'] === '!re') {
                $rows[] = $block['attributes'];
            }
        }

        return $rows;
    }

    // =========================================================================
    // Internals — connection
    // =========================================================================

    /**
     * Normalise a RadiusConfig record (or a plain array) into connection credentials.
     *
     * @param RadiusConfig|array<string, mixed> $config
     * @return array<string, mixed>|null
     */
    private function resolveCredentials($config, ?int $port, ?string $user, ?string $pass, ?string $ssl, int $timeout): ?array
    {
        if ($config instanceof RadiusConfig) {
            $source = [
                'ip'       => $config->ip,
                'port'     => $config->port,
                'username' => $config->username,
                'password' => $config->password,
                'ssl_type' => $config->ssl_type,
                'id'       => $config->id,
            ];
        } elseif (is_array($config)) {
            $source = $config;
        } elseif (is_object($config)) {
            // Tolerates the stdClass rows the older services fetch with the query builder.
            $source = get_object_vars($config);
        } else {
            $this->lastError = 'A RadiusConfig record or configuration array is required.';
            return null;
        }

        $host = trim((string) ($source['ip'] ?? $source['host'] ?? ''));

        if ($host === '') {
            $this->lastError = 'The RADIUS configuration carries no host address.';
            $this->log('error', 'Cannot connect: radius_config has no IP address.', [
                'radius_config_id' => $source['id'] ?? null,
            ]);
            return null;
        }

        $configuredPort = (int) ($source['port'] ?? 0);

        return [
            'id'            => $source['id'] ?? null,
            'host'          => $host,
            'port'          => $port ?? $configuredPort,
            'port_explicit' => $port !== null,
            'username'      => (string) ($user ?? $source['username'] ?? $source['user'] ?? ''),
            'password'      => (string) ($pass ?? $source['password'] ?? $source['pass'] ?? ''),
            'ssl_type'      => (string) ($ssl ?? $source['ssl_type'] ?? ''),
            'timeout'       => max(1, $timeout),
        ];
    }

    /**
     * @param array<string, mixed> $credentials
     */
    private function poolKey(array $credentials): string
    {
        return sha1(implode('|', [
            $credentials['host'],
            (string) $credentials['port'],
            $credentials['port_explicit'] ? '1' : '0',
            $credentials['username'],
            strtolower($credentials['ssl_type']),
            md5($credentials['password']),
        ]));
    }

    /**
     * Endpoints to try, in order.
     *
     * `radius_config.port` addresses the device's REST/web service on most installs, so it
     * is only used as an API endpoint when it really is one (8728/8729). Otherwise the
     * standard API ports are tried, preferred scheme first then the alternate — mirroring
     * the https-then-http fallback the REST transport used, so a device with only one of
     * api / api-ssl enabled still answers.
     *
     * A port passed explicitly by the caller is honoured ALONE. Silently falling back to
     * 8728/8729 there would let a probe of one endpoint report success for a different one.
     *
     * @param array<string, mixed> $credentials
     * @return array<int, array{transport: string, port: int}>
     */
    private function candidateEndpoints(array $credentials): array
    {
        $configured = (int) $credentials['port'];
        $secure     = $this->prefersSsl((string) $credentials['ssl_type']);

        if ($credentials['port_explicit'] && $configured > 0) {
            return [['transport' => $secure ? 'ssl' : 'tcp', 'port' => $configured]];
        }

        $candidates = [];

        if ($configured === self::API_PORT_SSL) {
            $candidates[] = ['transport' => 'ssl', 'port' => self::API_PORT_SSL];
        } elseif ($configured === self::API_PORT_PLAIN) {
            $candidates[] = ['transport' => 'tcp', 'port' => self::API_PORT_PLAIN];
        }

        $candidates[] = $secure
            ? ['transport' => 'ssl', 'port' => self::API_PORT_SSL]
            : ['transport' => 'tcp', 'port' => self::API_PORT_PLAIN];

        $candidates[] = $secure
            ? ['transport' => 'tcp', 'port' => self::API_PORT_PLAIN]
            : ['transport' => 'ssl', 'port' => self::API_PORT_SSL];

        $unique = [];
        foreach ($candidates as $candidate) {
            $unique[$candidate['transport'] . ':' . $candidate['port']] = $candidate;
        }

        return array_values($unique);
    }

    private function prefersSsl(string $sslType): bool
    {
        $value = strtolower(trim($sslType));

        return in_array($value, ['https', 'ssl', 'tls', 'secure', 'api-ssl'], true);
    }

    /**
     * Open a socket, log in, work out the User Manager tree and store the connection.
     *
     * @param array<string, mixed> $credentials
     */
    private function establish(array $credentials): bool
    {
        $this->lastConnectAllEndpointsDown = false;

        $preferred = $this->candidateEndpoints($credentials);
        $plan      = $this->plannedEndpoints($credentials, $preferred, $allDown);

        $this->lastConnectAllEndpointsDown = $allDown;

        $errors = [];

        foreach ($plan as $endpoint) {
            $error  = '';
            $label  = $this->endpointLabel($credentials, $endpoint);
            $role   = $endpoint === $preferred[0] ? 'saved' : 'alternate';

            $this->log('info', 'Trying RADIUS transport.', [
                'radius_config_id' => $credentials['id'] ?? null,
                'endpoint'         => $label,
                'transport_role'   => $role,
                'breaker'          => RadiusCircuitBreaker::state($label),
            ]);

            $socket = $this->openSocket(
                (string) $credentials['host'],
                $endpoint['transport'],
                $endpoint['port'],
                (int) $credentials['timeout'],
                $error
            );

            if ($socket === null) {
                $errors[] = $label . ': ' . $error;
                RadiusCircuitBreaker::recordFailure($label);
                continue;
            }

            if (!$this->login($socket, (string) $credentials['username'], (string) $credentials['password'])) {
                $errors[] = $label . ': ' . ($this->lastError !== '' ? $this->lastError : 'login rejected');
                $this->closeSocket($socket);
                RadiusCircuitBreaker::recordFailure($label);
                continue;
            }

            $version = $this->detectVersion($socket);
            $prefix  = $this->resolvePrefix($socket, $version);

            $key = $this->poolKey($credentials);

            $this->pool[$key] = [
                'socket'      => $socket,
                'prefix'      => $prefix,
                'version'     => $version,
                'endpoint'    => $label,
                'credentials' => $credentials,
            ];

            $this->current   = $key;
            $this->lastError = '';

            // The device answered, so this transport is proven good: clear any
            // failures standing against it and put it back at the front.
            RadiusCircuitBreaker::recordSuccess($label);

            $this->log('info', 'Connected to RouterOS API.', [
                'radius_config_id' => $credentials['id'] ?? null,
                'endpoint'         => $label,
                'transport_role'   => $role,
                'routeros_version' => $version ?: 'unknown',
                'um_prefix'        => $prefix,
            ]);

            return true;
        }

        $this->current   = null;
        $this->lastError = $errors === []
            ? 'No RouterOS API endpoint responded.'
            : implode(' | ', $errors);

        $this->log('error', 'RADIUS device unreachable on every transport.', [
            'radius_config_id'  => $credentials['id'] ?? null,
            'host'              => $credentials['host'],
            'transports_tried'  => array_map(fn (array $e): string => $this->endpointLabel($credentials, $e), $plan),
            'all_marked_down'   => $allDown,
            'error'             => $this->lastError,
        ]);

        return false;
    }

    /**
     * Narrow the preference-ordered endpoints down to the ones worth a socket.
     *
     * An endpoint in cool-off is skipped outright — no socket, no connect
     * timeout — so a config whose saved transport is down reaches its alternate
     * immediately instead of paying the dead one's timeout on every call.
     *
     * If BOTH transports are in cool-off the config is not abandoned: the most
     * preferred one is returned alone as a half-open probe. That bounds the cost
     * of a total outage to a single attempt while still letting the endpoint
     * prove it has recovered, so the system can never wedge itself shut.
     *
     * @param array<string, mixed> $credentials
     * @param array<int, array{transport: string, port: int}> $preferred
     * @param bool|null $allDown Set to true when every endpoint was in cool-off.
     * @return array<int, array{transport: string, port: int}>
     */
    private function plannedEndpoints(array $credentials, array $preferred, ?bool &$allDown = null): array
    {
        $allDown = false;

        if ($preferred === [] || !RadiusCircuitBreaker::enabled()) {
            return $preferred;
        }

        $healthy = array_values(array_filter(
            $preferred,
            fn (array $endpoint): bool => !RadiusCircuitBreaker::isOpen($this->endpointLabel($credentials, $endpoint))
        ));

        if ($healthy !== []) {
            return $healthy;
        }

        $allDown = true;

        $this->log('warning', 'Every RADIUS transport for this config is in cool-off; sending one probe.', [
            'radius_config_id' => $credentials['id'] ?? null,
            'probe'            => $this->endpointLabel($credentials, $preferred[0]),
        ]);

        return [$preferred[0]];
    }

    /**
     * Canonical endpoint name, e.g. `tcp://10.0.0.1:8728`. This is the circuit
     * breaker key, so it must stay stable and carry the transport.
     *
     * @param array<string, mixed> $credentials
     * @param array{transport: string, port: int} $endpoint
     */
    private function endpointLabel(array $credentials, array $endpoint): string
    {
        return $endpoint['transport'] . '://' . $credentials['host'] . ':' . $endpoint['port'];
    }

    /**
     * @return resource|null
     */
    private function openSocket(string $host, string $transport, int $port, int $timeout, string &$error)
    {
        $remote = $transport . '://' . $host . ':' . $port;

        foreach ($this->streamContextProfiles($transport) as $options) {
            $errno  = 0;
            $errstr = '';

            $context = stream_context_create($options);

            $socket = @stream_socket_client(
                $remote,
                $errno,
                $errstr,
                max(1, $timeout),
                STREAM_CLIENT_CONNECT,
                $context
            );

            if (is_resource($socket)) {
                stream_set_timeout($socket, self::DEFAULT_READ_TIMEOUT);
                stream_set_blocking($socket, true);
                return $socket;
            }

            $error = trim($errstr) !== ''
                ? trim($errstr)
                : 'connection failed (errno ' . $errno . ')';
        }

        return null;
    }

    /**
     * Stream context profiles to try for a transport.
     *
     * RouterOS' api-ssl service commonly presents either a self-signed certificate or an
     * anonymous-DH suite when no certificate is installed, so a permissive profile is tried
     * first and the platform default second — the second attempt covers OpenSSL builds that
     * reject the @SECLEVEL directive outright.
     *
     * @return array<int, array<string, array<string, mixed>>>
     */
    private function streamContextProfiles(string $transport): array
    {
        if ($transport !== 'ssl') {
            return [[]];
        }

        $base = [
            'verify_peer'       => false,
            'verify_peer_name'  => false,
            'allow_self_signed' => true,
        ];

        return [
            ['ssl' => $base + ['ciphers' => 'ADH:DEFAULT:@SECLEVEL=0']],
            ['ssl' => $base],
        ];
    }

    /**
     * Authenticate. Handles both the plain login of RouterOS 6.43+ and the older
     * MD5 challenge/response handshake, which answers the first /login with `=ret=`.
     *
     * @param resource $socket
     */
    private function login($socket, string $user, string $pass): bool
    {
        $writeFailed = false;
        $blocks = $this->executeOn($socket, ['/login', '=name=' . $user, '=password=' . $pass], $writeFailed);

        if ($blocks === null) {
            return false;
        }

        if ($this->hasError($blocks)) {
            return false;
        }

        $challengeHex = '';
        foreach ($blocks as $block) {
            if ($block['type'] === '!done' && isset($block['attributes']['ret'])) {
                $challengeHex = trim((string) $block['attributes']['ret']);
            }
        }

        if ($challengeHex === '') {
            return true;
        }

        if (!ctype_xdigit($challengeHex) || (strlen($challengeHex) % 2) !== 0) {
            $this->lastError = 'The RouterOS device returned an unusable login challenge.';
            return false;
        }

        $response = '00' . md5(chr(0) . $pass . pack('H*', $challengeHex));

        $legacyWriteFailed = false;
        $legacy = $this->executeOn($socket, ['/login', '=name=' . $user, '=response=' . $response], $legacyWriteFailed);

        if ($legacy === null) {
            return false;
        }

        return !$this->hasError($legacy);
    }

    /**
     * Read the RouterOS major version from /system/resource/print. 0 when unreadable.
     *
     * @param resource $socket
     */
    private function detectVersion($socket): int
    {
        $writeFailed = false;
        $blocks = $this->executeOn($socket, ['/system/resource/print'], $writeFailed);

        if ($blocks === null) {
            return 0;
        }

        foreach ($blocks as $block) {
            if ($block['type'] !== '!re') {
                continue;
            }

            $version = trim((string) ($block['attributes']['version'] ?? ''));

            if ($version !== '' && preg_match('/^(\d+)/', $version, $matches) === 1) {
                return (int) $matches[1];
            }
        }

        return 0;
    }

    /**
     * Pick the User Manager command tree for this device.
     *
     * @param resource $socket
     */
    private function resolvePrefix($socket, int $majorVersion): string
    {
        if ($majorVersion >= 7) {
            return self::UM_PREFIX_V7;
        }

        if ($majorVersion === 6) {
            return self::UM_PREFIX_V6;
        }

        // Version unreadable (a restricted API user cannot read /system/resource). Probe the
        // v7 tree — the only one that also speaks REST — and fall back to the v6 tree.
        $writeFailed = false;
        $blocks = $this->executeOn(
            $socket,
            [self::UM_PREFIX_V7 . '/user/print', '?name=' . self::PREFIX_PROBE_NAME],
            $writeFailed
        );

        if ($blocks === null || $this->hasError($blocks)) {
            return self::UM_PREFIX_V6;
        }

        return self::UM_PREFIX_V7;
    }

    /**
     * @param array<int, array{type: string, attributes: array<string, string>}> $blocks
     */
    private function hasError(array $blocks): bool
    {
        foreach ($blocks as $block) {
            if ($block['type'] === '!trap' || $block['type'] === '!fatal') {
                $this->lastError = $block['attributes']['message']
                    ?? $block['attributes']['_message']
                    ?? 'The RouterOS device rejected the command.';
                return true;
            }
        }

        return false;
    }

    /**
     * @param resource $socket
     */
    private function socketAlive($socket): bool
    {
        return is_resource($socket) && !feof($socket);
    }

    private function closeKey(string $key): void
    {
        if (isset($this->pool[$key])) {
            $this->closeSocket($this->pool[$key]['socket'], true);
            unset($this->pool[$key]);
        }

        if ($this->current === $key) {
            $this->current = null;
        }
    }

    /**
     * @param resource $socket
     */
    private function closeSocket($socket, bool $announce = false): void
    {
        if (!is_resource($socket)) {
            return;
        }

        try {
            if ($announce && !feof($socket)) {
                $this->writeSentence($socket, ['/quit']);
            }
        } catch (Throwable $e) {
            // The device is gone; closing the handle is all that is left to do.
        }

        @fclose($socket);
    }

    private function currentEndpoint(): string
    {
        return $this->current !== null && isset($this->pool[$this->current])
            ? $this->pool[$this->current]['endpoint']
            : '';
    }

    // =========================================================================
    // Internals — wire protocol
    // =========================================================================

    /**
     * @param array<string, mixed> $params
     * @param array<string, mixed> $queries
     * @return array<int, string>
     */
    private function buildSentence(string $cmd, array $params = [], array $queries = []): array
    {
        $sentence = [$this->normalizeCommand($cmd)];

        foreach ($params as $key => $value) {
            $sentence[] = '=' . $key . '=' . $this->stringify($value);
        }

        foreach ($queries as $key => $value) {
            $sentence[] = '?' . $key . '=' . $this->stringify($value);
        }

        return $sentence;
    }

    private function normalizeCommand(string $cmd): string
    {
        $cmd = trim($cmd);

        return $cmd !== '' && $cmd[0] === '/' ? $cmd : '/' . $cmd;
    }

    /**
     * @param mixed $value
     */
    private function stringify($value): string
    {
        if (is_bool($value)) {
            return $value ? 'yes' : 'no';
        }

        if ($value === null) {
            return '';
        }

        return (string) $value;
    }

    /**
     * Write a sentence and read the reply, reporting socket failures as null.
     *
     * $writeFailed distinguishes "the device never received the command" (safe to replay)
     * from "the command was sent but the reply was lost" (never replayed).
     *
     * @param resource $socket
     * @param array<int, string> $sentence
     * @return array<int, array{type: string, attributes: array<string, string>}>|null
     */
    private function executeOn($socket, array $sentence, bool &$writeFailed): ?array
    {
        $writeFailed = false;

        try {
            $this->writeSentence($socket, $sentence);
        } catch (Throwable $e) {
            $writeFailed     = true;
            $this->lastError = $e->getMessage();
            return null;
        }

        try {
            return $this->readSentences($socket);
        } catch (Throwable $e) {
            $this->lastError = $e->getMessage();
            $this->log('error', 'RouterOS API read failed.', [
                'command' => $sentence[0] ?? '',
                'error'   => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * @param resource $socket
     * @param array<int, string> $sentence
     */
    private function writeSentence($socket, array $sentence): void
    {
        $payload = '';

        foreach ($sentence as $word) {
            $word     = (string) $word;
            $payload .= $this->encodeLength(strlen($word)) . $word;
        }

        // A sentence is terminated by a zero-length word.
        $payload .= chr(0);

        $this->writeBytes($socket, $payload);
    }

    /**
     * @param resource $socket
     * @return array<int, array{type: string, attributes: array<string, string>}>
     */
    private function readSentences($socket): array
    {
        $blocks = [];

        while (true) {
            $block = $this->readSentence($socket);

            if ($block === null) {
                // A bare sentence terminator with no reply word — keep reading.
                continue;
            }

            $blocks[] = $block;

            if ($block['type'] === '!done' || $block['type'] === '!fatal') {
                break;
            }

            if (count($blocks) > self::MAX_REPLY_BLOCKS) {
                throw new RuntimeException('The RouterOS device returned an implausible number of reply blocks.');
            }
        }

        return $blocks;
    }

    /**
     * @param resource $socket
     * @return array{type: string, attributes: array<string, string>}|null
     */
    private function readSentence($socket): ?array
    {
        $type       = '';
        $attributes = [];
        $plain      = [];
        $first      = true;

        while (true) {
            $word = $this->readWord($socket);

            if ($word === '') {
                break;
            }

            if ($first) {
                $type  = $word;
                $first = false;
                continue;
            }

            if ($word[0] === '=') {
                $pair = explode('=', substr($word, 1), 2);
                $attributes[$pair[0]] = $pair[1] ?? '';
                continue;
            }

            if (strpos($word, '.tag=') === 0) {
                $attributes['.tag'] = substr($word, 5);
                continue;
            }

            // !fatal carries its reason as a bare word rather than =message=.
            $plain[] = $word;
        }

        if ($type === '') {
            return null;
        }

        if ($plain !== []) {
            $attributes['_message'] = implode(' ', $plain);
        }

        return ['type' => $type, 'attributes' => $attributes];
    }

    /**
     * @param resource $socket
     */
    private function readWord($socket): string
    {
        $length = $this->readLength($socket);

        if ($length === 0) {
            return '';
        }

        if ($length < 0 || $length > self::MAX_WORD_LENGTH) {
            throw new RuntimeException('The RouterOS device announced an implausible word length.');
        }

        return $this->readBytes($socket, $length);
    }

    /**
     * Decode the 1-5 byte length prefix that precedes every API word.
     *
     * @param resource $socket
     */
    private function readLength($socket): int
    {
        $first = ord($this->readBytes($socket, 1));

        if (($first & 0x80) === 0x00) {
            return $first;
        }

        if (($first & 0xC0) === 0x80) {
            return (($first & 0x3F) << 8) + ord($this->readBytes($socket, 1));
        }

        if (($first & 0xE0) === 0xC0) {
            $rest = $this->readBytes($socket, 2);
            return (($first & 0x1F) << 16) + (ord($rest[0]) << 8) + ord($rest[1]);
        }

        if (($first & 0xF0) === 0xE0) {
            $rest = $this->readBytes($socket, 3);
            return (($first & 0x0F) << 24) + (ord($rest[0]) << 16) + (ord($rest[1]) << 8) + ord($rest[2]);
        }

        if (($first & 0xF8) === 0xF0) {
            $rest = $this->readBytes($socket, 4);
            return (ord($rest[0]) << 24) + (ord($rest[1]) << 16) + (ord($rest[2]) << 8) + ord($rest[3]);
        }

        throw new RuntimeException('The RouterOS device sent an unrecognised word-length prefix.');
    }

    /**
     * Encode a word length using the 1-5 byte scheme the RouterOS API defines.
     */
    private function encodeLength(int $length): string
    {
        if ($length < 0x80) {
            return chr($length);
        }

        if ($length < 0x4000) {
            $length |= 0x8000;
            return chr(($length >> 8) & 0xFF) . chr($length & 0xFF);
        }

        if ($length < 0x200000) {
            $length |= 0xC00000;
            return chr(($length >> 16) & 0xFF) . chr(($length >> 8) & 0xFF) . chr($length & 0xFF);
        }

        if ($length < 0x10000000) {
            $length |= 0xE0000000;
            return chr(($length >> 24) & 0xFF) . chr(($length >> 16) & 0xFF) . chr(($length >> 8) & 0xFF) . chr($length & 0xFF);
        }

        return chr(0xF0)
            . chr(($length >> 24) & 0xFF)
            . chr(($length >> 16) & 0xFF)
            . chr(($length >> 8) & 0xFF)
            . chr($length & 0xFF);
    }

    /**
     * @param resource $socket
     */
    private function readBytes($socket, int $length): string
    {
        if ($length <= 0) {
            return '';
        }

        $buffer = '';

        while (strlen($buffer) < $length) {
            $chunk = @fread($socket, $length - strlen($buffer));

            if ($chunk === false || $chunk === '') {
                $meta = stream_get_meta_data($socket);

                if (!empty($meta['timed_out'])) {
                    throw new RuntimeException('Timed out waiting for the RouterOS device to reply.');
                }

                throw new RuntimeException('The RouterOS device closed the connection.');
            }

            $buffer .= $chunk;
        }

        return $buffer;
    }

    /**
     * @param resource $socket
     */
    private function writeBytes($socket, string $data): void
    {
        $length  = strlen($data);
        $written = 0;

        while ($written < $length) {
            $chunk = @fwrite($socket, substr($data, $written));

            if ($chunk === false || $chunk === 0) {
                throw new RuntimeException('Failed to write to the RouterOS socket.');
            }

            $written += $chunk;
        }
    }

    // =========================================================================
    // Internals — shaping
    // =========================================================================

    /**
     * @param array<string, mixed> $row
     * @return array{".id": string, username: string, group: string, disabled: bool, password: string}
     */
    private function normalizeUser(array $row): array
    {
        return [
            '.id'      => (string) ($row['.id'] ?? ''),
            'username' => trim((string) ($row['name'] ?? $row['username'] ?? '')),
            'group'    => trim((string) ($row['group'] ?? $row['actual-profile'] ?? '')),
            'disabled' => $this->toBool($row['disabled'] ?? false),
            'password' => (string) ($row['password'] ?? ''),
        ];
    }

    /**
     * @param array<string, mixed> $row
     * @return array{".id": string, username: string, ip: string, mac: string, upload: mixed, download: mixed, uptime: string}
     */
    private function normalizeSession(array $row): array
    {
        return [
            '.id'      => (string) ($row['.id'] ?? ''),
            'username' => trim((string) ($row['user'] ?? $row['username'] ?? '')),
            'ip'       => (string) ($row['user-address'] ?? $row['address'] ?? ''),
            'mac'      => (string) ($row['calling-station-id'] ?? $row['mac-address'] ?? ''),
            'upload'   => $row['upload'] ?? 0,
            'download' => $row['download'] ?? 0,
            'uptime'   => (string) ($row['uptime'] ?? ''),
        ];
    }

    /**
     * Is this session row a live one?
     *
     * Checked in order of how explicit the marker is; a row with no terminating marker at
     * all is treated as live, which is how the REST transport read the same data.
     *
     * @param array<string, mixed> $row
     */
    private function isActiveSession(array $row): bool
    {
        $active = strtolower(trim((string) ($row['active'] ?? '')));
        if ($active !== '') {
            return in_array($active, ['yes', 'true', '1'], true);
        }

        $status = strtolower(trim((string) ($row['status'] ?? '')));
        if ($status !== '') {
            return in_array($status, ['start', 'started', 'active', 'running'], true);
        }

        foreach (['terminated', 'ended', 'till-time', 'terminate-cause', 'end-time'] as $key) {
            if (!array_key_exists($key, $row)) {
                continue;
            }

            $value = strtolower(trim((string) $row[$key]));

            if ($value === '' || $value === 'never' || $value === 'no' || $value === 'false') {
                continue;
            }

            return false;
        }

        return true;
    }

    /**
     * @param mixed $value
     */
    private function toBool($value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower(trim((string) $value)), ['true', 'yes', '1'], true);
    }

    /**
     * Resolve a caller-supplied identifier to a RouterOS `.id`.
     *
     * A value beginning with `*` is already an id; anything else is looked up by name.
     *
     * @param RadiusConfig|array<string, mixed> $config
     */
    private function resolveUserId($config, string $idOrUsername): ?string
    {
        $value = trim($idOrUsername);

        if ($value === '') {
            $this->lastError = 'A username or RouterOS id is required.';
            return null;
        }

        if ($value[0] === '*') {
            return $value;
        }

        $user = $this->findUser($config, $value);

        if ($user === null || $user['.id'] === '') {
            return null;
        }

        return $user['.id'];
    }

    /**
     * A command succeeded when the device answered and nothing in the answer was an error.
     *
     * @param array<int, array{type: string, attributes: array<string, string>}> $blocks
     */
    private function succeeded(array $blocks): bool
    {
        if ($blocks === []) {
            if ($this->lastError === '') {
                $this->lastError = 'The RouterOS device returned no reply.';
            }
            return false;
        }

        foreach ($blocks as $block) {
            if ($block['type'] === '!trap' || $block['type'] === '!fatal') {
                return false;
            }
        }

        return true;
    }

    /**
     * @param array<string, mixed> $context
     */
    private function log(string $level, string $message, array $context = []): void
    {
        try {
            Log::channel('radiusrelated')->{$level}("[{$this->logName}] {$message}", $context);
        } catch (Throwable $e) {
            // Logging must never turn a RADIUS operation into a failure.
        }
    }

    public function __destruct()
    {
        $this->disconnectAll();
    }
}
