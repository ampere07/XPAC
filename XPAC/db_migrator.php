<?php
declare(strict_types=1);

/**
 * XPAC Database Migration Tool
 * -----------------------------------------------------------------------------
 * Standalone, single-file, web-based migration utility.
 *
 *   Source DB (MySQL / MariaDB / PostgreSQL / SQL Server / SQLite)
 *        -> column mapping + transformations (incl. full-name splitting)
 *        -> Destination MySQL / MariaDB DB
 *
 * This file is intentionally self-contained: it does not load, modify or depend
 * on the Laravel application in ./backend or the React app in ./frontend.
 *
 * Runtime state (audit log, per-job error files) lives in the ./.db_migrator
 * directory, which is made web-inaccessible on first run.
 *
 * NOTE: there is no built-in login. Anyone who can reach this URL can read the
 * source database and write to the destination. Protect it at the web server
 * (auth, VPN, IP allow-list) and delete the file when the migration is done.
 *
 * Requirements: PHP 8.0+, ext-pdo, ext-pdo_mysql, ext-openssl.
 */

// -----------------------------------------------------------------------------
// 1. Bootstrap & hardening
// -----------------------------------------------------------------------------

const DBM_APP      = 'XPAC Database Migrator';
const DBM_VERSION  = '1.0.0';
const DBM_STATE    = __DIR__ . DIRECTORY_SEPARATOR . '.db_migrator';
const DBM_IDLE_TTL = 1800;   // seconds of inactivity before the session is dropped

ini_set('display_errors', '0');
error_reporting(E_ALL);
mb_internal_encoding('UTF-8');

if (PHP_VERSION_ID < 80000) {
    header('Content-Type: text/plain; charset=utf-8');
    exit('XPAC Database Migrator requires PHP 8.0 or newer.');
}
if (!extension_loaded('pdo')) {
    header('Content-Type: text/plain; charset=utf-8');
    exit('The PDO extension is required.');
}

/** Create the private state directory and lock it down. */
function dbm_state_dir(): string
{
    if (!is_dir(DBM_STATE)) {
        @mkdir(DBM_STATE, 0700, true);
    }
    $guards = [
        '.htaccess'  => "Require all denied\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n",
        'index.html' => '',
        '.gitignore' => "*\n",
        'web.config' => '<configuration><system.webServer><authorization><deny users="*" />'
                      . '</authorization></system.webServer></configuration>' . "\n",
    ];
    foreach ($guards as $name => $body) {
        $path = DBM_STATE . DIRECTORY_SEPARATOR . $name;
        if (!file_exists($path)) {
            @file_put_contents($path, $body, LOCK_EX);
        }
    }
    return DBM_STATE;
}

/** Best-effort cleanup of stale per-job error files (older than 24h). */
function dbm_gc_jobs(): void
{
    foreach (glob(dbm_state_dir() . DIRECTORY_SEPARATOR . 'job_*.csv') ?: [] as $f) {
        if (is_file($f) && filemtime($f) < time() - 86400) {
            @unlink($f);
        }
    }
}

function dbm_is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') return true;
    if ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443') return true;
    if (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') return true;
    return false;
}

function dbm_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;

    session_name('XPACDBM');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') ?: '/',
        'httponly' => true,
        'secure'   => dbm_is_https(),
        'samesite' => 'Strict',
    ]);
    session_start();

    // Idle timeout: never leave live credentials sitting in an abandoned session.
    $now = time();
    if (isset($_SESSION['seen']) && ($now - (int) $_SESSION['seen']) > DBM_IDLE_TTL) {
        dbm_wipe_session();
    }
    $_SESSION['seen'] = $now;
}

function dbm_wipe_session(): void
{
    $_SESSION = [];
    session_regenerate_id(true);
    $_SESSION['seen'] = time();
}

// -----------------------------------------------------------------------------
// 2. Small helpers
// -----------------------------------------------------------------------------

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * @return never
 */
function dbm_json(array $payload, int $status = 200)
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store, no-cache, must-revalidate');
        header('Referrer-Policy: no-referrer');
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

/**
 * @return never
 */
function dbm_fail(string $message, int $status = 400, array $extra = [])
{
    if (dbm_soft_errors()) {
        throw new DbmError($message);
    }
    dbm_json(['ok' => false, 'error' => $message] + $extra, $status);
}

/** Raised instead of ending the request while soft-error mode is on. */
class DbmError extends RuntimeException
{
}

/**
 * While this is on, dbm_fail() throws instead of ending the request, so a loop
 * over many tables can record one failure and carry on with the rest.
 */
function dbm_soft_errors(?bool $set = null): bool
{
    static $on = false;
    if ($set !== null) $on = $set;

    return $on;
}

/** Decoded JSON request body (with form-post fallback). */
function dbm_input(): array
{
    static $cache = null;
    if ($cache !== null) return $cache;

    $raw  = file_get_contents('php://input') ?: '';
    $data = [];
    if ($raw !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) $data = $decoded;
    }
    if (!$data && $_POST) $data = $_POST;

    return $cache = $data;
}

function dbm_str(array $src, string $key, string $default = ''): string
{
    $v = $src[$key] ?? null;
    return is_scalar($v) ? trim((string) $v) : $default;
}

function dbm_int(array $src, string $key, int $default = 0): int
{
    $v = $src[$key] ?? null;
    return is_numeric($v) ? (int) $v : $default;
}

function dbm_bool(array $src, string $key, bool $default = false): bool
{
    $v = $src[$key] ?? null;
    if ($v === null) return $default;
    if (is_bool($v)) return $v;
    if (is_string($v)) return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
    return (bool) $v;
}

function dbm_arr(array $src, string $key): array
{
    $v = $src[$key] ?? [];
    return is_array($v) ? $v : [];
}

/** Strip anything credential-shaped out of a driver message before it is shown or stored. */
function dbm_safe_message(string $msg): string
{
    $patterns = [
        '/(password|passwd|pwd)\s*=\s*[^;\s\'"]+/i' => '$1=***',
        '/(user|uid|username)\s*=\s*[^;\s\'"]+/i'   => '$1=***',
        '/(host|hostname|server)\s*=\s*[^;\s\'"]+/i' => '$1=***',
        '/\/\/[^:\/\s]+:[^@\s]+@/'                  => '//***:***@',
    ];
    $msg = preg_replace(array_keys($patterns), array_values($patterns), $msg) ?? $msg;
    $msg = preg_replace('/\s+/', ' ', $msg) ?? $msg;

    return mb_substr(trim($msg), 0, 600);
}

/** Append an audit line. Connection details are deliberately never logged. */
function dbm_audit(string $event, array $context = []): void
{
    $line = json_encode([
        'ts'    => gmdate('c'),
        'event' => $event,
        'ip'    => substr(hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? '')), 0, 12),
    ] + $context, JSON_UNESCAPED_SLASHES);

    @file_put_contents(dbm_state_dir() . DIRECTORY_SEPARATOR . 'audit.log', $line . PHP_EOL, FILE_APPEND | LOCK_EX);
}

// -----------------------------------------------------------------------------
// 3. Request integrity (CSRF)
//
// This tool has no passphrase: anyone who can load the URL can drive it.
// Keep it behind whatever already protects the deployment (server auth, VPN,
// IP allow-list) and delete the file once the migration is finished.
// -----------------------------------------------------------------------------

function dbm_csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['csrf'];
}

function dbm_csrf_check(): void
{
    $sent = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? dbm_str(dbm_input(), 'csrf'));
    if ($sent === '' || !hash_equals(dbm_csrf_token(), $sent)) {
        dbm_fail('Invalid or expired security token. Reload the page and try again.', 419);
    }
}

// -----------------------------------------------------------------------------
// 4. Credential vault
//
// Connection details live only in the server-side session for the length of the
// session. Passwords are additionally encrypted with a per-session key that is
// held in a separate cookie, so a leaked session file alone does not reveal
// them. Nothing is persisted to disk by this tool.
// -----------------------------------------------------------------------------

function dbm_vault_key(): string
{
    static $key = null;
    if ($key !== null) return $key;

    $cookie = (string) ($_COOKIE['XPACDBMK'] ?? '');
    $raw    = $cookie !== '' ? base64_decode($cookie, true) : false;

    if (!is_string($raw) || strlen($raw) !== 32) {
        $raw = random_bytes(32);
        if (!headers_sent()) {
            $p = session_get_cookie_params();
            setcookie('XPACDBMK', base64_encode($raw), [
                'expires'  => 0,
                'path'     => $p['path'],
                'httponly' => true,
                'secure'   => dbm_is_https(),
                'samesite' => 'Strict',
            ]);
        }
        $_COOKIE['XPACDBMK'] = base64_encode($raw);
    }
    return $key = $raw;
}

function dbm_secret_encrypt(string $plain): string
{
    if ($plain === '' || !function_exists('openssl_encrypt')) return $plain === '' ? '' : base64_encode($plain);

    $iv  = random_bytes(12);
    $tag = '';
    $ct  = openssl_encrypt($plain, 'aes-256-gcm', dbm_vault_key(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($ct === false) return base64_encode($plain);

    return 'v1:' . base64_encode($iv . $tag . $ct);
}

function dbm_secret_decrypt(string $stored): string
{
    if ($stored === '') return '';
    if (!str_starts_with($stored, 'v1:')) return (string) base64_decode($stored, true);

    $raw = base64_decode(substr($stored, 3), true);
    if (!is_string($raw) || strlen($raw) < 29) return '';

    $iv  = substr($raw, 0, 12);
    $tag = substr($raw, 12, 16);
    $ct  = substr($raw, 28);
    $pt  = openssl_decrypt($ct, 'aes-256-gcm', dbm_vault_key(), OPENSSL_RAW_DATA, $iv, $tag);

    return is_string($pt) ? $pt : '';
}

// -----------------------------------------------------------------------------
// 5. Drivers, DSN building and connections
//
// The source may be any database PHP has a PDO driver for; the destination is
// always MySQL/MariaDB. Each driver carries a small "dialect" describing how to
// quote identifiers, paginate a SELECT and read the schema catalog.
//
//   form     server | file | odbc   -> which connection fields the UI shows
//   quote    backtick | bracket | double
//   page     limit_offset | offset_fetch | rownum | rows_to | none
//   catalog  mysql | pgsql | sqlsrv | oracle | firebird | sqlite | ansi
//   schemas  true when table names are qualified as schema.table
// -----------------------------------------------------------------------------

function dbm_driver_catalog(): array
{
    return [
        'mysql' => [
            'label' => 'MySQL', 'pdo' => 'mysql', 'port' => 3306, 'dest' => true,
            'form' => 'server', 'quote' => 'backtick', 'page' => 'limit_offset',
            'catalog' => 'mysql', 'schemas' => false, 'charset' => 'utf8mb4', 'note' => '',
        ],
        'mariadb' => [
            'label' => 'MariaDB', 'pdo' => 'mysql', 'port' => 3306, 'dest' => true,
            'form' => 'server', 'quote' => 'backtick', 'page' => 'limit_offset',
            'catalog' => 'mysql', 'schemas' => false, 'charset' => 'utf8mb4', 'note' => '',
        ],
        'pgsql' => [
            'label' => 'PostgreSQL', 'pdo' => 'pgsql', 'port' => 5432, 'dest' => false,
            'form' => 'server', 'quote' => 'double', 'page' => 'limit_offset',
            'catalog' => 'pgsql', 'schemas' => true, 'charset' => 'UTF8', 'note' => '',
        ],
        'sqlsrv' => [
            'label' => 'SQL Server (Microsoft driver)', 'pdo' => 'sqlsrv', 'port' => 1433, 'dest' => false,
            'form' => 'server', 'quote' => 'bracket', 'page' => 'offset_fetch',
            'catalog' => 'sqlsrv', 'schemas' => true, 'charset' => '', 'note' => 'Needs pdo_sqlsrv. Paging requires SQL Server 2012 or newer.',
        ],
        'dblib' => [
            'label' => 'SQL Server / Sybase (FreeTDS)', 'pdo' => 'dblib', 'port' => 1433, 'dest' => false,
            'form' => 'server', 'quote' => 'bracket', 'page' => 'offset_fetch',
            'catalog' => 'sqlsrv', 'schemas' => true, 'charset' => 'UTF-8', 'note' => 'Uses pdo_dblib/FreeTDS. Switch paging to ROWNUM-free "none" for very old servers.',
        ],
        'oci' => [
            'label' => 'Oracle', 'pdo' => 'oci', 'port' => 1521, 'dest' => false,
            'form' => 'server', 'quote' => 'double', 'page' => 'offset_fetch',
            'catalog' => 'oracle', 'schemas' => true, 'charset' => 'AL32UTF8', 'note' => 'Database name is the service name. Choose ROWNUM paging for Oracle 11g and older.',
        ],
        'firebird' => [
            'label' => 'Firebird / InterBase', 'pdo' => 'firebird', 'port' => 3050, 'dest' => false,
            'form' => 'server', 'quote' => 'double', 'page' => 'rows_to',
            'catalog' => 'firebird', 'schemas' => false, 'charset' => 'UTF8', 'note' => 'Database name is the server-side path or alias of the .fdb file.',
        ],
        'odbc' => [
            'label' => 'Any other database (ODBC)', 'pdo' => 'odbc', 'port' => 0, 'dest' => false,
            'form' => 'odbc', 'quote' => 'double', 'page' => 'none',
            'catalog' => 'ansi', 'schemas' => true, 'charset' => '', 'note' => 'Reaches DB2, Informix, Access, Sybase, Snowflake, Teradata and anything else with an ODBC driver. Set the paging style to match the backend for large tables.',
        ],
        'sqlite' => [
            'label' => 'SQLite (file)', 'pdo' => 'sqlite', 'port' => 0, 'dest' => false,
            'form' => 'file', 'quote' => 'double', 'page' => 'limit_offset',
            'catalog' => 'sqlite', 'schemas' => false, 'charset' => '', 'note' => '',
        ],
    ];
}

/**
 * Batch sizes offered in the UI — how many source rows are read, transformed
 * and inserted per round trip. Defined once here so the dropdown and the
 * server-side validation can never drift apart.
 */
function dbm_batch_sizes(): array
{
    return [50, 100, 250, 500];
}

function dbm_default_batch_size(): int
{
    return 500;
}

/**
 * Accept only a size the UI actually offers; anything else falls back to the
 * default rather than being silently clamped to something unexpected.
 */
function dbm_clean_batch_size($value, ?int $default = null): int
{
    $default = $default ?? dbm_default_batch_size();
    $n = is_numeric($value) ? (int) $value : $default;

    return in_array($n, dbm_batch_sizes(), true) ? $n : $default;
}

/** Paging styles the operator may force on a connection. */
function dbm_page_styles(): array
{
    return [
        ''             => 'Automatic (driver default)',
        'limit_offset' => 'LIMIT n OFFSET n  (MySQL, PostgreSQL, SQLite)',
        'offset_fetch' => 'OFFSET n ROWS FETCH NEXT n  (SQL Server 2012+, Oracle 12c+, DB2)',
        'rownum'       => 'ROWNUM subquery  (Oracle 11g and older)',
        'rows_to'      => 'ROWS a TO b  (Firebird)',
        'none'         => 'No SQL paging — read sequentially (slowest, always works)',
    ];
}

function dbm_drivers_available(): array
{
    $have = PDO::getAvailableDrivers();
    $out  = [];
    foreach (dbm_driver_catalog() as $key => $meta) {
        $out[] = [
            'key'       => $key,
            'label'     => $meta['label'],
            'port'      => $meta['port'],
            'dest'      => $meta['dest'],
            'form'      => $meta['form'],
            'charset'   => $meta['charset'],
            'schemas'   => $meta['schemas'],
            'note'      => $meta['note'],
            'extension' => 'pdo_' . $meta['pdo'],
            'available' => in_array($meta['pdo'], $have, true),
        ];
    }
    return $out;
}

function dbm_driver_meta(string $type): array
{
    $catalog = dbm_driver_catalog();
    if (!isset($catalog[$type])) {
        dbm_fail('Unsupported database type.');
    }
    return $catalog[$type];
}

/** The paging style in force for a connection (explicit override wins). */
function dbm_page_style(array $cfg): string
{
    $override = (string) ($cfg['page'] ?? '');
    if ($override !== '' && array_key_exists($override, dbm_page_styles())) return $override;

    return dbm_driver_meta($cfg['type'])['page'];
}

/**
 * Validate and normalise a connection payload coming from the browser.
 *
 * @param string $role 'source' or 'dest'
 */
function dbm_validate_conn(array $in, string $role): array
{
    $type = dbm_str($in, 'type');
    $meta = dbm_driver_meta($type);

    if ($role === 'dest' && !$meta['dest']) {
        dbm_fail('The destination database must be MySQL or MariaDB.');
    }
    if (!in_array($meta['pdo'], PDO::getAvailableDrivers(), true)) {
        dbm_fail(sprintf(
            'PHP on this server has no %s driver. Enable the %s extension to use %s as a source.',
            $meta['label'], 'pdo_' . $meta['pdo'], $meta['label']
        ));
    }

    $page = dbm_str($in, 'page');
    if ($page !== '' && !array_key_exists($page, dbm_page_styles())) dbm_fail('Unknown paging style.');

    $cfg = [
        'type'       => $type,
        'host'       => '',
        'port'       => 0,
        'db'         => '',
        'user'       => '',
        'pass'       => '',
        'odbc_dsn'   => '',
        'ssl'        => dbm_bool($in, 'ssl'),
        'ssl_ca'     => dbm_str($in, 'ssl_ca'),
        'ssl_verify' => dbm_bool($in, 'ssl_verify', true),
        'charset'    => dbm_str($in, 'charset', $meta['charset']),
        'page'       => $page,
    ];

    if ($cfg['charset'] !== '' && !preg_match('/^[A-Za-z0-9_\-]{1,32}$/', $cfg['charset'])) {
        dbm_fail('Invalid character set.');
    }
    if ($cfg['ssl_ca'] !== '' && !is_file($cfg['ssl_ca'])) {
        dbm_fail('The CA certificate path does not exist on the server.');
    }

    // --- SQLite: a readable file on this server --------------------------------
    if ($meta['form'] === 'file') {
        $path = dbm_str($in, 'db');
        if ($path === '') dbm_fail('Provide the path to the database file.');
        if (!is_file($path) || !is_readable($path)) dbm_fail('The database file does not exist or is not readable by PHP.');
        $cfg['db'] = $path;

        return $cfg;
    }

    // --- ODBC: a DSN name or a full connection string ---------------------------
    if ($meta['form'] === 'odbc') {
        $dsn = is_string($in['odbc_dsn'] ?? null) ? trim((string) $in['odbc_dsn']) : '';
        if ($dsn === '') dbm_fail('Provide an ODBC DSN name or connection string.');
        if (mb_strlen($dsn) > 1024) dbm_fail('The ODBC connection string is too long.');
        if (preg_match('/[\r\n\x00]/', $dsn)) dbm_fail('The ODBC connection string contains illegal characters.');

        $cfg['odbc_dsn'] = $dsn;
        $cfg['user']     = dbm_str($in, 'user');
        $cfg['pass']     = is_string($in['pass'] ?? null) ? (string) $in['pass'] : '';
        // Used only as a display label and for information_schema filtering.
        $cfg['db']       = dbm_str($in, 'db');
        if ($cfg['db'] !== '' && !preg_match('/^[A-Za-z0-9_$\-. ]{1,128}$/', $cfg['db'])) {
            dbm_fail('Database/catalog name contains invalid characters.');
        }

        return $cfg;
    }

    // --- Everything else: host / port / database / credentials ------------------
    $host = dbm_str($in, 'host');
    if ($host === '') dbm_fail('Host is required.');
    if (!preg_match('/^[A-Za-z0-9._\-:\[\]]{1,255}$/', $host)) dbm_fail('Host contains invalid characters.');
    if (!filter_var($host, FILTER_VALIDATE_IP) && !filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
        dbm_fail('Host must be a valid hostname or IP address.');
    }

    $port = dbm_int($in, 'port', $meta['port']);
    if ($port < 1 || $port > 65535) dbm_fail('Port must be between 1 and 65535.');

    $db = dbm_str($in, 'db');
    if ($db === '') dbm_fail('Database name is required.');

    // Firebird takes a server-side file path or alias; the rest take an identifier.
    if ($type === 'firebird') {
        if (mb_strlen($db) > 512 || preg_match('/[\r\n\x00;]/', $db)) dbm_fail('Invalid database path.');
    } elseif (!preg_match('/^[A-Za-z0-9_$\-.]{1,128}$/', $db)) {
        dbm_fail('Database name contains invalid characters.');
    }

    $user = dbm_str($in, 'user');
    if ($user === '') dbm_fail('Username is required.');
    if (mb_strlen($user) > 128) dbm_fail('Username is too long.');

    $cfg['host'] = $host;
    $cfg['port'] = $port;
    $cfg['db']   = $db;
    $cfg['user'] = $user;
    $cfg['pass'] = is_string($in['pass'] ?? null) ? (string) $in['pass'] : '';

    return $cfg;
}

function dbm_dsn(array $cfg): string
{
    $meta = dbm_driver_meta($cfg['type']);
    $cs   = (string) ($cfg['charset'] ?? '');

    switch ($meta['pdo']) {
        case 'mysql':
            $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s', $cfg['host'], $cfg['port'], $cfg['db']);
            if ($cs !== '') $dsn .= ';charset=' . $cs;
            return $dsn;

        case 'pgsql':
            $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s;connect_timeout=10', $cfg['host'], $cfg['port'], $cfg['db']);
            $dsn .= ';sslmode=' . (!empty($cfg['ssl']) ? (!empty($cfg['ssl_verify']) ? 'verify-full' : 'require') : 'prefer');
            if (!empty($cfg['ssl']) && !empty($cfg['ssl_ca'])) $dsn .= ';sslrootcert=' . $cfg['ssl_ca'];
            return $dsn;

        case 'sqlsrv':
            $dsn = sprintf('sqlsrv:Server=%s,%d;Database=%s;LoginTimeout=10', $cfg['host'], $cfg['port'], $cfg['db']);
            if (!empty($cfg['ssl'])) {
                $dsn .= ';Encrypt=1;TrustServerCertificate=' . (!empty($cfg['ssl_verify']) ? '0' : '1');
            }
            return $dsn;

        case 'dblib':
            $dsn = sprintf('dblib:host=%s:%d;dbname=%s', $cfg['host'], $cfg['port'], $cfg['db']);
            if ($cs !== '') $dsn .= ';charset=' . $cs;
            return $dsn;

        case 'oci':
            $dsn = sprintf('oci:dbname=//%s:%d/%s', $cfg['host'], $cfg['port'], $cfg['db']);
            if ($cs !== '') $dsn .= ';charset=' . $cs;
            return $dsn;

        case 'firebird':
            $dsn = sprintf('firebird:dbname=%s/%d:%s', $cfg['host'], $cfg['port'], $cfg['db']);
            if ($cs !== '') $dsn .= ';charset=' . $cs;
            return $dsn;

        case 'odbc':
            return 'odbc:' . $cfg['odbc_dsn'];

        case 'sqlite':
            return 'sqlite:' . $cfg['db'];
    }

    dbm_fail('Unsupported database type.');
}

/** setAttribute that tolerates drivers which do not know the attribute. */
function dbm_try_attr(PDO $pdo, int $attr, $value): void
{
    try {
        $pdo->setAttribute($attr, $value);
    } catch (Throwable $e) {
        // The driver does not support it; the default behaviour is fine.
    }
}

function dbm_connect(array $cfg): PDO
{
    $meta    = dbm_driver_meta($cfg['type']);
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ];

    // Only MySQL gets driver-specific constructor options; everything else is
    // configured after connecting so an unknown attribute cannot break the connect.
    if ($meta['pdo'] === 'mysql') {
        $options[PDO::ATTR_EMULATE_PREPARES] = false;
        $options[PDO::ATTR_TIMEOUT]          = 10;
        if (defined('PDO::MYSQL_ATTR_USE_BUFFERED_QUERY')) {
            $options[PDO::MYSQL_ATTR_USE_BUFFERED_QUERY] = true;
        }
        if (!empty($cfg['ssl'])) {
            if (!empty($cfg['ssl_ca']) && defined('PDO::MYSQL_ATTR_SSL_CA')) {
                $options[PDO::MYSQL_ATTR_SSL_CA] = $cfg['ssl_ca'];
            }
            if (defined('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')) {
                $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = !empty($cfg['ssl_verify']);
            }
        }
    }

    $user = $pass = null;
    if ($meta['form'] !== 'file') {
        $user = ((string) ($cfg['user'] ?? '')) !== '' ? (string) $cfg['user'] : null;
        $pass = ((string) ($cfg['pass'] ?? '')) !== '' ? (string) $cfg['pass'] : null;
    }

    $pdo = new PDO(dbm_dsn($cfg), $user, $pass, $options);

    dbm_try_attr($pdo, PDO::ATTR_STRINGIFY_FETCHES, false);
    if ($meta['pdo'] !== 'mysql') {
        dbm_try_attr($pdo, PDO::ATTR_TIMEOUT, 10);
    }

    $cs = (string) ($cfg['charset'] ?? '');
    try {
        if ($meta['pdo'] === 'mysql' && $cs !== '') {
            $pdo->exec('SET NAMES ' . $pdo->quote($cs));
        } elseif ($meta['pdo'] === 'pgsql' && $cs !== '') {
            $pdo->exec('SET client_encoding TO ' . $pdo->quote($cs));
        } elseif ($meta['pdo'] === 'oci') {
            // Make Oracle hand dates back in an unambiguous, parseable shape.
            $pdo->exec("ALTER SESSION SET NLS_DATE_FORMAT='YYYY-MM-DD HH24:MI:SS'");
            $pdo->exec("ALTER SESSION SET NLS_TIMESTAMP_FORMAT='YYYY-MM-DD HH24:MI:SS'");
        }
    } catch (Throwable $e) {
        // A session setting the server rejects must not stop the migration.
    }

    return $pdo;
}

/** Open (and memoise per request) the connection stored for a role. */
function dbm_conn(string $role): PDO
{
    static $pool = [];
    if (isset($pool[$role])) return $pool[$role];

    $cfg = dbm_stored_conn($role);
    if ($cfg === null) {
        dbm_fail(sprintf('No %s database connection has been configured yet.', $role), 409, ['reconnect' => $role]);
    }

    try {
        return $pool[$role] = dbm_connect($cfg);
    } catch (Throwable $e) {
        dbm_fail(sprintf('Could not connect to the %s database: %s', $role, dbm_safe_message($e->getMessage())), 502);
    }
}

/** Secrets are encrypted before they are put in the session. */
function dbm_secret_fields(): array
{
    return ['pass', 'odbc_dsn'];
}

function dbm_store_conn(string $role, array $cfg): void
{
    $safe = $cfg;
    foreach (dbm_secret_fields() as $f) {
        $safe[$f] = dbm_secret_encrypt((string) ($cfg[$f] ?? ''));
    }
    $_SESSION['conn'][$role] = $safe;
}

function dbm_stored_conn(string $role): ?array
{
    $cfg = $_SESSION['conn'][$role] ?? null;
    if (!is_array($cfg)) return null;

    foreach (dbm_secret_fields() as $f) {
        $cfg[$f] = dbm_secret_decrypt((string) ($cfg[$f] ?? ''));
    }
    return $cfg;
}

/** Connection summary safe to hand back to the browser (never includes secrets). */
function dbm_conn_public(string $role): ?array
{
    $cfg = $_SESSION['conn'][$role] ?? null;
    if (!is_array($cfg)) return null;

    $meta  = dbm_driver_catalog()[$cfg['type']] ?? null;
    $label = $meta['label'] ?? $cfg['type'];

    // Describe an ODBC target without leaking the credentials inside its DSN.
    $where = $cfg['db'];
    if (($meta['form'] ?? '') === 'odbc') {
        $plain = dbm_secret_decrypt((string) ($cfg['odbc_dsn'] ?? ''));
        $first = trim(explode(';', $plain)[0]);
        $where = $cfg['db'] !== '' ? $cfg['db'] : (preg_match('/^(DSN|DRIVER)=/i', $first) ? $first : 'ODBC');
    }

    return [
        'type'    => $cfg['type'],
        'label'   => $label,
        'form'    => $meta['form'] ?? 'server',
        'host'    => $cfg['host'],
        'port'    => $cfg['port'],
        'db'      => $where,
        'user'    => $cfg['user'],
        'ssl'     => !empty($cfg['ssl']),
        'page'    => dbm_page_style($cfg),
        'schemas' => !empty($meta['schemas']),
    ];
}

// -----------------------------------------------------------------------------
// 6. Identifier safety & schema introspection
//
// Nothing the browser sends is ever concatenated into SQL directly. Table names
// are resolved against the live catalog (or, when a driver cannot enumerate its
// catalog, probed) and re-emitted using the server's own spelling.
// -----------------------------------------------------------------------------

/** Cheap syntactic gate. The authoritative check is membership of the live schema. */
function dbm_ident_ok(string $name): bool
{
    return $name !== ''
        && mb_strlen($name) <= 128
        && (bool) preg_match('/^[A-Za-z0-9_$#][A-Za-z0-9_$# \-]*$/u', $name);
}

/** Split "schema.table" for drivers that qualify names; otherwise one part. */
function dbm_split_qualified(string $type, string $name): array
{
    if (dbm_driver_meta($type)['schemas'] && substr_count($name, '.') === 1) {
        [$schema, $table] = explode('.', $name, 2);
        return [$schema, $table];
    }
    return [null, $name];
}

function dbm_qualified_ok(string $type, string $name): bool
{
    [$schema, $table] = dbm_split_qualified($type, $name);

    return ($schema === null || dbm_ident_ok($schema)) && dbm_ident_ok($table);
}

function dbm_quote_ident(string $type, string $name): string
{
    $style = dbm_driver_meta($type)['quote'];
    $quote = static function (string $part) use ($style): string {
        return match ($style) {
            'backtick' => '`' . str_replace('`', '``', $part) . '`',
            'bracket'  => '[' . str_replace(']', ']]', $part) . ']',
            default    => '"' . str_replace('"', '""', $part) . '"',
        };
    };

    [$schema, $table] = dbm_split_qualified($type, $name);
    if (!dbm_qualified_ok($type, $name)) {
        dbm_fail('Refusing to build SQL with the identifier: ' . $name);
    }

    return $schema === null ? $quote($table) : $quote($schema) . '.' . $quote($table);
}

/** Firebird reports column types as numeric codes. */
function dbm_firebird_type(int $code, ?int $sub): string
{
    $map = [
        7 => 'smallint', 8 => 'integer', 9 => 'quad', 10 => 'float', 11 => 'd_float',
        12 => 'date', 13 => 'time', 14 => 'char', 16 => 'bigint', 27 => 'double precision',
        35 => 'timestamp', 37 => 'varchar', 40 => 'cstring', 45 => 'blob_id', 261 => 'blob',
    ];
    $name = $map[$code] ?? ('type_' . $code);
    if (in_array($code, [7, 8, 16], true) && $sub === 1) $name = 'numeric';
    if (in_array($code, [7, 8, 16], true) && $sub === 2) $name = 'decimal';

    return $name;
}

/**
 * List the tables (and views) visible on a connection.
 *
 * @return string[] qualified as schema.table for drivers that use schemas
 */
function dbm_list_tables(PDO $pdo, array $cfg): array
{
    $meta = dbm_driver_meta($cfg['type']);
    $rows = [];

    try {
        switch ($meta['catalog']) {
            case 'mysql': {
                $st = $pdo->prepare(
                    'SELECT NULL AS s, TABLE_NAME AS t FROM information_schema.TABLES
                     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN (\'BASE TABLE\', \'VIEW\')
                     ORDER BY TABLE_NAME'
                );
                $st->execute([$cfg['db']]);
                $rows = $st->fetchAll();
                break;
            }
            case 'pgsql': {
                $st = $pdo->query(
                    'SELECT table_schema AS s, table_name AS t FROM information_schema.tables
                     WHERE table_schema NOT IN (\'pg_catalog\', \'information_schema\')
                     ORDER BY table_schema, table_name'
                );
                $rows = $st->fetchAll();
                break;
            }
            case 'sqlsrv': {
                $st = $pdo->query(
                    'SELECT TABLE_SCHEMA AS s, TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES
                     ORDER BY TABLE_SCHEMA, TABLE_NAME'
                );
                $rows = $st->fetchAll();
                break;
            }
            case 'oracle': {
                $st = $pdo->query(
                    'SELECT owner AS s, table_name AS t FROM all_tables
                       WHERE owner NOT IN (\'SYS\',\'SYSTEM\',\'SYSAUX\',\'OUTLN\',\'XDB\',\'CTXSYS\',\'MDSYS\',
                                           \'OLAPSYS\',\'ORDSYS\',\'ORDDATA\',\'WMSYS\',\'DBSNMP\',\'APPQOSSYS\',
                                           \'GSMADMIN_INTERNAL\',\'LBACSYS\',\'DVSYS\',\'AUDSYS\',\'OJVMSYS\')
                     UNION ALL
                     SELECT owner AS s, view_name AS t FROM all_views
                       WHERE owner NOT IN (\'SYS\',\'SYSTEM\',\'SYSAUX\',\'XDB\',\'CTXSYS\',\'MDSYS\',\'WMSYS\',\'AUDSYS\')
                     ORDER BY 1, 2'
                );
                $rows = $st->fetchAll();
                break;
            }
            case 'firebird': {
                $st = $pdo->query(
                    'SELECT NULL AS s, TRIM(rdb$relation_name) AS t FROM rdb$relations
                      WHERE COALESCE(rdb$system_flag, 0) = 0 ORDER BY 2'
                );
                $rows = $st->fetchAll();
                break;
            }
            case 'sqlite': {
                $st = $pdo->query(
                    'SELECT NULL AS s, name AS t FROM sqlite_master
                      WHERE type IN (\'table\', \'view\') AND name NOT LIKE \'sqlite_%\' ORDER BY name'
                );
                $rows = $st->fetchAll();
                break;
            }
            default: { // ansi / odbc: whatever the backend exposes
                $sql = 'SELECT table_schema AS s, table_name AS t FROM information_schema.tables';
                if (($cfg['db'] ?? '') !== '') {
                    $st = $pdo->prepare($sql . ' WHERE table_catalog = ? ORDER BY 1, 2');
                    $st->execute([$cfg['db']]);
                } else {
                    $st = $pdo->query($sql . ' ORDER BY 1, 2');
                }
                $rows = $st->fetchAll();
            }
        }
    } catch (Throwable $e) {
        // The driver cannot enumerate its catalog. Callers fall back to a probe,
        // and the UI lets the operator type table names in by hand.
        return [];
    }

    $useSchema = $meta['schemas'];
    $out = [];
    foreach ($rows as $row) {
        $vals   = array_values($row);
        $schema = $row['s'] ?? $row['S'] ?? $vals[0] ?? null;
        $table  = $row['t'] ?? $row['T'] ?? $vals[1] ?? null;
        if (!is_string($table)) continue;

        $table  = trim($table);
        $schema = is_string($schema) ? trim($schema) : '';
        if ($table === '' || !dbm_ident_ok($table)) continue;

        if ($useSchema && $schema !== '' && dbm_ident_ok($schema)) $out[] = $schema . '.' . $table;
        else $out[] = $table;
    }

    sort($out, SORT_NATURAL | SORT_FLAG_CASE);

    return $out;
}

/** Per-request cache so repeated asserts do not re-query the catalog. */
function dbm_tables_cached(PDO $pdo, array $cfg, string $role): array
{
    static $cache = [];
    if (!array_key_exists($role, $cache)) $cache[$role] = dbm_list_tables($pdo, $cfg);

    return $cache[$role];
}

/**
 * Resolve a caller-supplied table name to the server's own spelling, refusing
 * anything that is not really there.
 */
function dbm_assert_table(PDO $pdo, array $cfg, string $table, string $role = 'source'): string
{
    if (!dbm_qualified_ok($cfg['type'], $table)) dbm_fail('Invalid table name.');

    $tables = dbm_tables_cached($pdo, $cfg, $role);
    if ($tables) {
        foreach ($tables as $t) {
            if (strcasecmp($t, $table) === 0) return $t;
        }
        // A schema-qualified driver may have been given a bare name.
        foreach ($tables as $t) {
            if (str_contains($t, '.') && strcasecmp(explode('.', $t, 2)[1], $table) === 0) return $t;
        }
        dbm_fail('Table not found in the selected database: ' . $table, 404);
    }

    // Catalog enumeration is unavailable (some ODBC backends). Prove the table
    // exists by asking the server for its shape; the name is already validated.
    try {
        $pdo->query('SELECT * FROM ' . dbm_quote_ident($cfg['type'], $table) . ' WHERE 1 = 0')->closeCursor();
    } catch (Throwable $e) {
        dbm_fail('Table not found or not readable: ' . $table, 404);
    }

    return $table;
}

/** Last-resort column discovery that works on every driver. */
function dbm_columns_via_meta(PDO $pdo, array $cfg, string $table): array
{
    $st = $pdo->query('SELECT * FROM ' . dbm_quote_ident($cfg['type'], $table) . ' WHERE 1 = 0');
    $cols = [];
    for ($i = 0, $n = $st->columnCount(); $i < $n; $i++) {
        $m = $st->getColumnMeta($i);
        if (!is_array($m) || !isset($m['name'])) continue;
        $cols[] = [
            'name'     => (string) $m['name'],
            'type'     => strtolower((string) ($m['native_type'] ?? 'unknown')),
            'native'   => (string) ($m['native_type'] ?? 'unknown'),
            'nullable' => true,
            'pk'       => false,
            'auto'     => false,
            'length'   => isset($m['len']) && (int) $m['len'] > 0 ? (int) $m['len'] : null,
            'default'  => null,
        ];
    }
    $st->closeCursor();

    return $cols;
}

/**
 * @return array<int, array{name:string,type:string,native:string,nullable:bool,pk:bool,auto:bool,length:?int,default:?string}>
 */
function dbm_list_columns(PDO $pdo, array $cfg, string $table, string $role = 'source'): array
{
    $table = dbm_assert_table($pdo, $cfg, $table, $role);
    $meta  = dbm_driver_meta($cfg['type']);
    [$schema, $bare] = dbm_split_qualified($cfg['type'], $table);
    $cols = [];

    try {
        switch ($meta['catalog']) {
            case 'mysql': {
                $st = $pdo->prepare(
                    'SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA,
                            CHARACTER_MAXIMUM_LENGTH, COLUMN_DEFAULT
                     FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION'
                );
                $st->execute([$cfg['db'], $bare]);
                foreach ($st->fetchAll() as $r) {
                    $cols[] = [
                        'name'     => (string) $r['COLUMN_NAME'],
                        'type'     => strtolower((string) $r['DATA_TYPE']),
                        'native'   => (string) $r['COLUMN_TYPE'],
                        'nullable' => strtoupper((string) $r['IS_NULLABLE']) === 'YES',
                        'pk'       => strtoupper((string) $r['COLUMN_KEY']) === 'PRI',
                        'auto'     => str_contains(strtolower((string) $r['EXTRA']), 'auto_increment'),
                        'length'   => $r['CHARACTER_MAXIMUM_LENGTH'] !== null ? (int) $r['CHARACTER_MAXIMUM_LENGTH'] : null,
                        'default'  => $r['COLUMN_DEFAULT'] !== null ? (string) $r['COLUMN_DEFAULT'] : null,
                    ];
                }
                break;
            }

            case 'oracle': {
                $st = $pdo->prepare(
                    'SELECT column_name, data_type, nullable, data_length, data_default, data_precision, data_scale
                       FROM all_tab_columns WHERE owner = ? AND table_name = ? ORDER BY column_id'
                );
                $st->execute([$schema ?? '', $bare]);
                $pk = [];
                $pkSt = $pdo->prepare(
                    'SELECT cc.column_name FROM all_constraints c
                       JOIN all_cons_columns cc ON cc.constraint_name = c.constraint_name AND cc.owner = c.owner
                      WHERE c.constraint_type = \'P\' AND c.owner = ? AND c.table_name = ?'
                );
                $pkSt->execute([$schema ?? '', $bare]);
                foreach ($pkSt->fetchAll() as $r) $pk[strtolower((string) reset($r))] = true;

                foreach ($st->fetchAll() as $r) {
                    $name = (string) $r['COLUMN_NAME'];
                    $type = strtolower((string) $r['DATA_TYPE']);
                    $cols[] = [
                        'name'     => $name,
                        'type'     => $type,
                        'native'   => $type . ($r['DATA_PRECISION'] !== null ? '(' . (int) $r['DATA_PRECISION'] . ',' . (int) ($r['DATA_SCALE'] ?? 0) . ')' : ''),
                        'nullable' => strtoupper((string) $r['NULLABLE']) === 'Y',
                        'pk'       => isset($pk[strtolower($name)]),
                        'auto'     => false,
                        'length'   => $r['DATA_LENGTH'] !== null ? (int) $r['DATA_LENGTH'] : null,
                        'default'  => $r['DATA_DEFAULT'] !== null ? trim((string) $r['DATA_DEFAULT']) : null,
                    ];
                }
                break;
            }

            case 'firebird': {
                $st = $pdo->prepare(
                    'SELECT TRIM(rf.rdb$field_name) AS fname, f.rdb$field_type AS ftype, f.rdb$field_sub_type AS fsub,
                            f.rdb$character_length AS flen, rf.rdb$null_flag AS fnull, rf.rdb$default_source AS fdef
                       FROM rdb$relation_fields rf
                       JOIN rdb$fields f ON f.rdb$field_name = rf.rdb$field_source
                      WHERE rf.rdb$relation_name = ? ORDER BY rf.rdb$field_position'
                );
                $st->execute([$bare]);
                $pk = [];
                $pkSt = $pdo->prepare(
                    'SELECT TRIM(s.rdb$field_name) AS fname FROM rdb$relation_constraints rc
                       JOIN rdb$index_segments s ON s.rdb$index_name = rc.rdb$index_name
                      WHERE rc.rdb$constraint_type = \'PRIMARY KEY\' AND rc.rdb$relation_name = ?'
                );
                $pkSt->execute([$bare]);
                foreach ($pkSt->fetchAll() as $r) $pk[strtolower(trim((string) reset($r)))] = true;

                foreach ($st->fetchAll() as $r) {
                    $vals = array_change_key_case($r, CASE_LOWER);
                    $name = trim((string) ($vals['fname'] ?? ''));
                    if ($name === '') continue;
                    $type = dbm_firebird_type((int) ($vals['ftype'] ?? 0), $vals['fsub'] !== null ? (int) $vals['fsub'] : null);
                    $cols[] = [
                        'name'     => $name,
                        'type'     => $type,
                        'native'   => $type,
                        'nullable' => empty($vals['fnull']),
                        'pk'       => isset($pk[strtolower($name)]),
                        'auto'     => false,
                        'length'   => $vals['flen'] !== null ? (int) $vals['flen'] : null,
                        'default'  => $vals['fdef'] !== null ? trim((string) $vals['fdef']) : null,
                    ];
                }
                break;
            }

            case 'sqlite': {
                $st = $pdo->query('PRAGMA table_info(' . dbm_quote_ident($cfg['type'], $bare) . ')');
                foreach ($st->fetchAll() as $r) {
                    $cols[] = [
                        'name'     => (string) $r['name'],
                        'type'     => strtolower((string) $r['type']),
                        'native'   => (string) $r['type'],
                        'nullable' => (int) $r['notnull'] === 0,
                        'pk'       => (int) $r['pk'] > 0,
                        'auto'     => (int) $r['pk'] > 0 && stripos((string) $r['type'], 'int') !== false,
                        'length'   => null,
                        'default'  => $r['dflt_value'] !== null ? (string) $r['dflt_value'] : null,
                    ];
                }
                break;
            }

            default: { // pgsql, sqlsrv, dblib and ANSI-ish ODBC backends
                $sql = 'SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
                          FROM information_schema.columns WHERE table_name = ?';
                $args = [$bare];
                if ($schema !== null) { $sql .= ' AND table_schema = ?'; $args[] = $schema; }
                $sql .= ' ORDER BY ordinal_position';

                $st = $pdo->prepare($sql);
                $st->execute($args);

                $pk = [];
                try {
                    $pkSql = 'SELECT k.column_name FROM information_schema.table_constraints t
                                JOIN information_schema.key_column_usage k
                                  ON k.constraint_name = t.constraint_name AND k.table_schema = t.table_schema
                               WHERE t.constraint_type = \'PRIMARY KEY\' AND t.table_name = ?';
                    $pkArgs = [$bare];
                    if ($schema !== null) { $pkSql .= ' AND t.table_schema = ?'; $pkArgs[] = $schema; }
                    $pkSt = $pdo->prepare($pkSql);
                    $pkSt->execute($pkArgs);
                    foreach ($pkSt->fetchAll() as $r) $pk[strtolower((string) reset($r))] = true;
                } catch (Throwable $e) {
                    // Primary keys are a nicety here, not a requirement.
                }

                foreach ($st->fetchAll() as $r) {
                    $v    = array_change_key_case($r, CASE_LOWER);
                    $name = (string) ($v['column_name'] ?? '');
                    if ($name === '') continue;
                    $default = $v['column_default'] ?? null;
                    $cols[] = [
                        'name'     => $name,
                        'type'     => strtolower((string) ($v['data_type'] ?? '')),
                        'native'   => (string) ($v['data_type'] ?? ''),
                        'nullable' => strtoupper((string) ($v['is_nullable'] ?? 'YES')) === 'YES',
                        'pk'       => isset($pk[strtolower($name)]),
                        'auto'     => $default !== null && str_contains((string) $default, 'nextval('),
                        'length'   => isset($v['character_maximum_length']) && $v['character_maximum_length'] !== null
                                      ? (int) $v['character_maximum_length'] : null,
                        'default'  => $default !== null ? (string) $default : null,
                    ];
                }
            }
        }
    } catch (Throwable $e) {
        $cols = [];
    }

    if (!$cols) {
        // Catalog query failed or returned nothing usable: ask the result set itself.
        try {
            $cols = dbm_columns_via_meta($pdo, $cfg, $table);
        } catch (Throwable $e) {
            dbm_fail('Could not read the structure of ' . $table . ': ' . dbm_safe_message($e->getMessage()));
        }
    }
    if (!$cols) dbm_fail('No columns found for table ' . $table, 404);

    return $cols;
}

/**
 * Resolve a user-supplied column name against the live column list.
 * Returns the server's canonical spelling, or null when it does not exist.
 */
function dbm_resolve_column(array $columns, string $name): ?string
{
    foreach ($columns as $c) {
        if (strcasecmp($c['name'], $name) === 0) return $c['name'];
    }
    return null;
}

// -----------------------------------------------------------------------------
// 7. Full-name splitting
// -----------------------------------------------------------------------------

/** Surname particles, including the ones common in Filipino and Spanish names. */
function dbm_name_particles(): array
{
    return [
        'de', 'del', 'dela', 'delas', 'delos', 'della', 'di', 'da', 'das', 'do', 'dos', 'du',
        'la', 'las', 'le', 'les', 'lo', 'los', 'san', 'santa', 'santo', 'st', 'st.', 'ste',
        'van', 'von', 'der', 'den', 'ter', 'ten', 'af', 'av', 'bin', 'binti', 'binte', 'ibn',
        'al', 'el', 'abu', 'mac', 'mc', 'ng', 'y', "o'",
    ];
}

function dbm_name_suffixes(): array
{
    return [
        'jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v', 'vi',
        'md', 'm.d.', 'phd', 'ph.d.', 'dds', 'dvm', 'esq', 'esq.',
        'rn', 'cpa', 'mba', 'jd', 'lpt', 'ret', 'ret.',
    ];
}

function dbm_name_prefixes(): array
{
    return ['mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss', 'dr', 'dr.', 'prof', 'prof.', 'atty', 'atty.', 'engr', 'engr.', 'rev', 'rev.', 'hon', 'hon.', 'sr', 'fr', 'fr.'];
}

function dbm_title_case(string $s): string
{
    if ($s === '') return '';

    $out = preg_replace_callback('/\p{L}[\p{L}\p{M}\']*/u', static function (array $m): string {
        $w = $m[0];
        $lower = mb_strtolower($w);

        // Keep Roman-numeral style suffixes and initials upper-cased.
        if (preg_match('/^(ii|iii|iv|vi{0,3}|ix|xi{0,2})$/i', $w)) return mb_strtoupper($w);

        if (mb_strlen($lower) > 2 && str_starts_with($lower, "mc")) {
            return 'Mc' . mb_strtoupper(mb_substr($lower, 2, 1)) . mb_substr($lower, 3);
        }
        if (mb_strlen($lower) > 3 && str_starts_with($lower, "o'")) {
            return "O'" . mb_strtoupper(mb_substr($lower, 2, 1)) . mb_substr($lower, 3);
        }
        return mb_strtoupper(mb_substr($lower, 0, 1)) . mb_substr($lower, 1);
    }, $s);

    return $out ?? $s;
}

/**
 * Split a full name into parts.
 *
 * Returns first/middle/last/suffix/prefix plus middle_initial, the detected
 * format, and a list of human-readable warnings so the operator can eyeball
 * anything unusual in the preview rather than trusting the parser blindly.
 *
 * Options:
 *   order          auto|first_last|last_first   (default auto)
 *   particles      bool  glue "dela", "van der" etc. onto the surname (default true)
 *   suffixes       bool  detect Jr./III/MD (default true)
 *   prefixes       bool  strip Mr./Dr. (default true)
 *   single_token   first|last  where a one-word name goes (default first)
 *   case           keep|title|upper  output casing (default keep)
 *   initial_dot    bool  append "." to the middle initial (default true)
 *
 * @return array{first:string,middle:string,middle_initial:string,last:string,suffix:string,prefix:string,order:string,warnings:string[]}
 */
function dbm_split_name(?string $full, array $opt = []): array
{
    $opt += [
        'order'        => 'auto',
        'particles'    => true,
        'suffixes'     => true,
        'prefixes'     => true,
        'single_token' => 'first',
        'case'         => 'keep',
        'initial_dot'  => true,
    ];

    $result = [
        'first' => '', 'middle' => '', 'middle_initial' => '', 'last' => '',
        'suffix' => '', 'prefix' => '', 'order' => 'first_last', 'warnings' => [],
    ];

    $raw = trim((string) $full);
    $raw = preg_replace('/\s+/u', ' ', $raw) ?? $raw;
    if ($raw === '') {
        $result['warnings'][] = 'Empty name';
        return $result;
    }

    if (preg_match('/[0-9@]/u', $raw)) {
        $result['warnings'][] = 'Contains digits or @ — may not be a person name';
    }

    $work = $raw;

    // 1. Trailing suffixes ("Dela Cruz, Jr." / "Jose Rizal III").
    if ($opt['suffixes']) {
        $suffixList = dbm_name_suffixes();
        $found = [];
        for ($guard = 0; $guard < 3; $guard++) {
            if (!preg_match('/^(.*?)[,\s]+([^\s,]+)$/u', $work, $m)) break;
            $candidate = mb_strtolower(trim($m[2]));
            if (!in_array($candidate, $suffixList, true)) break;
            array_unshift($found, trim($m[2]));
            $work = trim($m[1]);
        }
        if ($found) {
            $result['suffix'] = implode(' ', $found);
            $result['warnings'][] = 'Suffix detected: ' . $result['suffix'];
        }
    }

    // 2. Leading courtesy title.
    if ($opt['prefixes']) {
        $parts = explode(' ', $work);
        if (count($parts) > 1 && in_array(mb_strtolower($parts[0]), dbm_name_prefixes(), true)) {
            $result['prefix'] = array_shift($parts);
            $work = implode(' ', $parts);
            $result['warnings'][] = 'Title removed: ' . $result['prefix'];
        }
    }

    // 3. Determine the ordering.
    $order = $opt['order'];
    $lastFirst = false;
    if ($order === 'last_first') {
        $lastFirst = true;
    } elseif ($order === 'auto' && str_contains($work, ',')) {
        $lastFirst = true;
        $result['warnings'][] = 'Comma format detected (Last, First)';
    }
    $result['order'] = $lastFirst ? 'last_first' : 'first_last';

    if ($lastFirst) {
        if (str_contains($work, ',')) {
            $bits  = array_map('trim', explode(',', $work, 2));
            $lastP = $bits[0] ?? '';
            $rest  = $bits[1] ?? '';
        } else {
            // Explicitly surname-first but unpunctuated: take the leading token
            // (plus any particles in front of it) as the surname.
            $tokens = ($preg = preg_split('/\s+/u', $work)) ? $preg : [];
            $idx    = 0;
            if ($opt['particles']) {
                $particles = dbm_name_particles();
                while ($idx < count($tokens) - 1 && in_array(mb_strtolower($tokens[$idx]), $particles, true)) {
                    $idx++;
                }
            }
            $lastP = implode(' ', array_slice($tokens, 0, $idx + 1));
            $rest  = implode(' ', array_slice($tokens, $idx + 1));
            if ($rest === '') $result['warnings'][] = 'Only one part found';
        }

        $result['last'] = $lastP;
        $restTokens = $rest === '' ? [] : ((preg_split('/\s+/u', $rest) ?: []));
        if ($restTokens) {
            $result['first']  = (string) array_shift($restTokens);
            $result['middle'] = implode(' ', $restTokens);
        } elseif ($lastP !== '' && str_contains($work, ',')) {
            $result['warnings'][] = 'Only one part found';
        }
    } else {
        $work   = str_replace(',', ' ', $work);
        $work   = preg_replace('/\s+/u', ' ', trim($work)) ?? $work;
        $tokens = $work === '' ? [] : (preg_split('/\s+/u', $work) ?: []);
        $n      = count($tokens);

        if ($n === 0) {
            $result['warnings'][] = 'Empty name';
        } elseif ($n === 1) {
            $result['warnings'][] = 'Single word name — verify manually';
            if ($opt['single_token'] === 'last') $result['last'] = $tokens[0];
            else $result['first'] = $tokens[0];
        } else {
            // Walk back from the end collecting particles onto the surname.
            $lastIdx = $n - 1;
            if ($opt['particles']) {
                $particles = dbm_name_particles();
                $i = $lastIdx - 1;
                while ($i >= 1 && in_array(mb_strtolower($tokens[$i]), $particles, true)) {
                    $lastIdx = $i;
                    $i--;
                }
                if ($lastIdx < $n - 1) {
                    $result['warnings'][] = 'Compound surname: ' . implode(' ', array_slice($tokens, $lastIdx));
                }
            }
            $result['last']  = implode(' ', array_slice($tokens, $lastIdx));
            $result['first'] = $tokens[0];
            $middle = array_slice($tokens, 1, $lastIdx - 1);
            $result['middle'] = implode(' ', $middle);

            if (count($middle) > 1) {
                $result['warnings'][] = 'Multiple middle names';
            }
            if ($n > 4) {
                $result['warnings'][] = 'Unusually long name — verify manually';
            }
        }
    }

    foreach (['first', 'middle', 'last', 'suffix', 'prefix'] as $k) {
        $result[$k] = trim((string) $result[$k]);
        if ($opt['case'] === 'title')      $result[$k] = dbm_title_case($result[$k]);
        elseif ($opt['case'] === 'upper')  $result[$k] = mb_strtoupper($result[$k]);
    }

    if ($result['middle'] !== '') {
        $initial = mb_strtoupper(mb_substr($result['middle'], 0, 1));
        $result['middle_initial'] = $opt['initial_dot'] ? $initial . '.' : $initial;
    }

    return $result;
}

// -----------------------------------------------------------------------------
// 8. Transformations
// -----------------------------------------------------------------------------

/** Catalog handed to the UI so the transform editor stays in sync with the engine. */
function dbm_transform_catalog(): array
{
    return [
        ['id' => 'trim',        'label' => 'Trim whitespace',       'params' => []],
        ['id' => 'upper',       'label' => 'UPPERCASE',             'params' => []],
        ['id' => 'lower',       'label' => 'lowercase',             'params' => []],
        ['id' => 'title',       'label' => 'Title Case',            'params' => []],
        ['id' => 'ucfirst',     'label' => 'Capitalise first letter', 'params' => []],
        ['id' => 'name_part',   'label' => 'Full name -> part',     'params' => [
            ['key' => 'part', 'label' => 'Part', 'type' => 'select',
             'options' => ['first' => 'First name', 'middle' => 'Middle name', 'middle_initial' => 'Middle initial', 'last' => 'Last name', 'suffix' => 'Suffix']],
        ]],
        ['id' => 'digits',      'label' => 'Keep digits only',      'params' => []],
        ['id' => 'replace',     'label' => 'Find & replace',        'params' => [
            ['key' => 'search',  'label' => 'Find',    'type' => 'text'],
            ['key' => 'replace', 'label' => 'Replace', 'type' => 'text'],
        ]],
        ['id' => 'substring',   'label' => 'Substring',             'params' => [
            ['key' => 'start',  'label' => 'Start', 'type' => 'number'],
            ['key' => 'length', 'label' => 'Length (blank = rest)', 'type' => 'number'],
        ]],
        ['id' => 'concat',      'label' => 'Add prefix / suffix',   'params' => [
            ['key' => 'prefix', 'label' => 'Prefix', 'type' => 'text'],
            ['key' => 'suffix', 'label' => 'Suffix', 'type' => 'text'],
        ]],
        ['id' => 'value_map',   'label' => 'Map values',            'params' => [
            ['key' => 'pairs',    'label' => 'One "old=new" per line', 'type' => 'textarea'],
            ['key' => 'fallback', 'label' => 'If no match (blank = keep original)', 'type' => 'text'],
        ]],
        ['id' => 'default',     'label' => 'Default when empty',    'params' => [
            ['key' => 'value', 'label' => 'Value', 'type' => 'text'],
        ]],
        ['id' => 'null_if_empty', 'label' => 'Empty -> NULL',       'params' => []],
        ['id' => 'static',      'label' => 'Fixed value',           'params' => [
            ['key' => 'value', 'label' => 'Value', 'type' => 'text'],
        ]],
        ['id' => 'now',         'label' => 'Current date/time',     'params' => [
            ['key' => 'format', 'label' => 'PHP date format', 'type' => 'text', 'default' => 'Y-m-d H:i:s'],
        ]],
        ['id' => 'date_format', 'label' => 'Reformat date',         'params' => [
            ['key' => 'format', 'label' => 'Output format', 'type' => 'text', 'default' => 'Y-m-d H:i:s'],
        ]],
        ['id' => 'to_int',      'label' => 'Cast to integer',       'params' => []],
        ['id' => 'to_decimal',  'label' => 'Cast to decimal',       'params' => [
            ['key' => 'scale', 'label' => 'Decimal places', 'type' => 'number', 'default' => '2'],
        ]],
        ['id' => 'to_bool',     'label' => 'Cast to 0/1',           'params' => []],
        ['id' => 'truncate',    'label' => 'Truncate to length',    'params' => [
            ['key' => 'length', 'label' => 'Max length', 'type' => 'number'],
        ]],
        ['id' => 'bcrypt',      'label' => 'Hash (bcrypt)',         'params' => []],
    ];
}

function dbm_transform_ids(): array
{
    return array_column(dbm_transform_catalog(), 'id');
}

/**
 * Apply one transform step.
 *
 * @param mixed  $value    current value in the chain
 * @param array  $step     ['type' => string, 'params' => array]
 * @param string $rawSource the untouched source value (used by name_part)
 * @param array  $ctx      ['overrides' => array<string,array>, 'nameOpts' => array]
 * @return mixed
 */
function dbm_apply_transform($value, array $step, string $rawSource, array $ctx)
{
    $type   = (string) ($step['type'] ?? '');
    $params = is_array($step['params'] ?? null) ? $step['params'] : [];

    // NULL in, NULL out. Only the steps that exist to produce or replace a value
    // are allowed to turn a NULL into something else.
    if ($value === null && !in_array($type, ['default', 'static', 'now', 'null_if_empty'], true)) {
        return null;
    }

    $s = $value === null ? '' : (string) $value;

    switch ($type) {
        case 'trim':    return trim($s);
        case 'upper':   return mb_strtoupper($s);
        case 'lower':   return mb_strtolower($s);
        case 'title':   return dbm_title_case($s);
        case 'ucfirst': return $s === '' ? $s : mb_strtoupper(mb_substr($s, 0, 1)) . mb_substr($s, 1);

        case 'name_part':
            $part = (string) ($params['part'] ?? 'first');
            $key  = 'ov:' . md5($rawSource);
            $over = $ctx['overrides'][$key] ?? null;
            if (is_array($over) && array_key_exists($part, $over)) {
                return (string) $over[$part];
            }
            $split = dbm_split_name($s, $ctx['nameOpts'] ?? []);
            return (string) ($split[$part] ?? '');

        case 'digits':
            return preg_replace('/\D+/u', '', $s) ?? '';

        case 'replace':
            $search = (string) ($params['search'] ?? '');
            return $search === '' ? $s : str_replace($search, (string) ($params['replace'] ?? ''), $s);

        case 'substring':
            $start = (int) ($params['start'] ?? 0);
            $len   = ($params['length'] ?? '') === '' ? null : (int) $params['length'];
            return $len === null ? mb_substr($s, $start) : mb_substr($s, $start, $len);

        case 'concat':
            return (string) ($params['prefix'] ?? '') . $s . (string) ($params['suffix'] ?? '');

        case 'value_map':
            $map = [];
            foreach (preg_split('/\r\n|\r|\n/', (string) ($params['pairs'] ?? '')) ?: [] as $line) {
                if (!str_contains($line, '=')) continue;
                [$from, $to] = explode('=', $line, 2);
                $map[trim($from)] = trim($to);
            }
            if (array_key_exists($s, $map)) return $map[$s];
            $fallback = (string) ($params['fallback'] ?? '');
            return $fallback === '' ? $s : $fallback;

        case 'default':
            return ($value === null || $s === '') ? (string) ($params['value'] ?? '') : $s;

        case 'null_if_empty':
            return ($value === null || trim($s) === '') ? null : $s;

        case 'static':
            return (string) ($params['value'] ?? '');

        case 'now':
            $fmt = (string) ($params['format'] ?? 'Y-m-d H:i:s');
            return date($fmt === '' ? 'Y-m-d H:i:s' : $fmt);

        case 'date_format':
            if ($value === null || trim($s) === '') return null;
            $fmt = (string) ($params['format'] ?? 'Y-m-d H:i:s');
            try {
                $dt = new DateTimeImmutable($s);
            } catch (Throwable $e) {
                $ts = strtotime($s);
                if ($ts === false) return $s; // leave it alone; the insert will report the real error
                $dt = (new DateTimeImmutable())->setTimestamp($ts);
            }
            return $dt->format($fmt === '' ? 'Y-m-d H:i:s' : $fmt);

        case 'to_int':
            return $s === '' ? null : (int) preg_replace('/[^0-9\-]/', '', $s);

        case 'to_decimal':
            if ($s === '') return null;
            $scale = max(0, min(10, (int) ($params['scale'] ?? 2)));
            $clean = preg_replace('/[^0-9\.\-]/', '', $s) ?? '0';
            return number_format((float) $clean, $scale, '.', '');

        case 'to_bool':
            $t = mb_strtolower(trim($s));
            return in_array($t, ['1', 'true', 'yes', 'y', 't', 'on', 'active', 'enabled'], true) ? 1 : 0;

        case 'truncate':
            $len = (int) ($params['length'] ?? 0);
            return $len > 0 ? mb_substr($s, 0, $len) : $s;

        case 'bcrypt':
            return $s === '' ? null : password_hash($s, PASSWORD_BCRYPT);
    }

    return $value;
}

// -----------------------------------------------------------------------------
// 9. Migration plan
//
// A job is a list of table pairs. Each pair carries its own column mapping,
// transformations, ordering, duplicate handling and row window, so one run can
// move many tables with completely different shapes.
// -----------------------------------------------------------------------------

function dbm_normalise_name_opts(array $in): array
{
    $pick = static function ($value, array $allowed, string $default): string {
        $v = is_string($value) ? $value : $default;
        return in_array($v, $allowed, true) ? $v : $default;
    };

    return [
        'order'        => $pick($in['order'] ?? null, ['auto', 'first_last', 'last_first'], 'auto'),
        'particles'    => (bool) ($in['particles'] ?? true),
        'suffixes'     => (bool) ($in['suffixes'] ?? true),
        'prefixes'     => (bool) ($in['prefixes'] ?? true),
        'single_token' => $pick($in['single_token'] ?? null, ['first', 'last'], 'first'),
        'case'         => $pick($in['case'] ?? null, ['keep', 'title', 'upper'], 'keep'),
        'initial_dot'  => (bool) ($in['initial_dot'] ?? true),
    ];
}

/**
 * Validate one source-table -> destination-table pair against the live schemas.
 * Everything that ends up in SQL is resolved to a canonical server-side name here.
 */
function dbm_build_table_plan(array $entry, array $globals, array $srcCfg, array $dstCfg, PDO $srcPdo, PDO $dstPdo): array
{
    $label    = dbm_str($entry, 'sourceTable') . ' -> ' . dbm_str($entry, 'destTable');
    $srcTable = dbm_assert_table($srcPdo, $srcCfg, dbm_str($entry, 'sourceTable'), 'source');
    $dstTable = dbm_assert_table($dstPdo, $dstCfg, dbm_str($entry, 'destTable'), 'dest');

    $srcCols = dbm_list_columns($srcPdo, $srcCfg, $srcTable, 'source');
    $dstCols = dbm_list_columns($dstPdo, $dstCfg, $dstTable, 'dest');

    $transformIds = dbm_transform_ids();
    $mappings     = [];
    $usedSource   = [];

    foreach (dbm_arr($entry, 'mappings') as $m) {
        if (!is_array($m) || !empty($m['skip'])) continue;

        $destName = dbm_resolve_column($dstCols, dbm_str($m, 'dest'));
        if ($destName === null) dbm_fail($label . ': unknown destination column ' . dbm_str($m, 'dest'));

        $steps = [];
        foreach (dbm_arr($m, 'transforms') as $t) {
            if (!is_array($t)) continue;
            $type = (string) ($t['type'] ?? '');
            if ($type === '' || $type === 'none') continue;
            if (!in_array($type, $transformIds, true)) dbm_fail($label . ': unknown transformation ' . $type);

            $params = [];
            foreach (dbm_arr($t, 'params') as $k => $v) {
                if (!is_string($k) || !is_scalar($v)) continue;
                $params[$k] = (string) $v;
            }
            $steps[] = ['type' => $type, 'params' => $params];
        }

        $constantOnly = false;
        foreach ($steps as $st) {
            if (in_array($st['type'], ['static', 'now'], true)) $constantOnly = true;
        }

        $sourceRaw  = dbm_str($m, 'source');
        $sourceName = null;
        if ($sourceRaw !== '') {
            $sourceName = dbm_resolve_column($srcCols, $sourceRaw);
            if ($sourceName === null) dbm_fail($label . ': unknown source column ' . $sourceRaw);
            $usedSource[$sourceName] = true;
        } elseif (!$constantOnly) {
            dbm_fail($label . ': destination column "' . $destName . '" has no source. Pick one, add a fixed value, or skip it.');
        }

        $mappings[] = ['dest' => $destName, 'source' => $sourceName, 'transforms' => $steps];
    }

    if (!$mappings) dbm_fail($label . ': map at least one column, or remove the table from the job.');

    $seen = [];
    foreach ($mappings as $m) {
        $k = strtolower($m['dest']);
        if (isset($seen[$k])) dbm_fail($label . ': destination column "' . $m['dest'] . '" is mapped more than once.');
        $seen[$k] = true;
    }

    // Ordering column: keeps batching stable across requests.
    $orderBy = dbm_str($entry, 'orderBy');
    $orderPk = false;
    if ($orderBy !== '') {
        $resolved = dbm_resolve_column($srcCols, $orderBy);
        if ($resolved === null) dbm_fail($label . ': unknown ordering column ' . $orderBy);
        $orderBy = $resolved;
    } else {
        foreach ($srcCols as $c) {
            if ($c['pk']) { $orderBy = $c['name']; break; }
        }
    }
    foreach ($srcCols as $c) {
        if ($orderBy !== '' && strcasecmp($c['name'], $orderBy) === 0 && $c['pk']) $orderPk = true;
    }

    $mode = dbm_str($entry, 'mode', 'insert');
    if (!in_array($mode, ['insert', 'skip_duplicates', 'update_duplicates'], true)) {
        dbm_fail($label . ': unknown insert mode.');
    }

    $truncate = dbm_bool($entry, 'truncate');
    if (($mode === 'update_duplicates' || $truncate) && empty($globals['allowOverwrite'])) {
        dbm_fail($label . ': this option changes existing destination data. Enable "Allow overwriting destination data" first.');
    }

    // Manually corrected name splits, keyed by a hash of the raw source value.
    $overrides = [];
    foreach (dbm_arr($entry, 'nameOverrides') as $key => $parts) {
        if (!is_string($key) || !str_starts_with($key, 'ov:') || !is_array($parts)) continue;
        $clean = [];
        foreach (['first', 'middle', 'middle_initial', 'last', 'suffix'] as $p) {
            if (isset($parts[$p]) && is_scalar($parts[$p])) $clean[$p] = (string) $parts[$p];
        }
        if ($clean) $overrides[$key] = $clean;
    }

    $selectCols = array_keys($usedSource);
    if ($orderBy !== '' && !in_array($orderBy, $selectCols, true)) $selectCols[] = $orderBy;
    if (!$selectCols) $selectCols[] = $srcCols[0]['name'];   // constant-only rows still need something to iterate

    $srcTypes = [];
    foreach ($srcCols as $c) $srcTypes[$c['name']] = $c['native'] !== '' ? $c['native'] : $c['type'];

    return [
        'srcType'    => $srcCfg['type'],
        'dstType'    => $dstCfg['type'],
        'page'       => dbm_page_style($srcCfg),
        'srcTable'   => $srcTable,
        'dstTable'   => $dstTable,
        'selectCols' => $selectCols,
        'srcTypes'   => $srcTypes,
        'mappings'   => $mappings,
        'orderBy'    => $orderBy,
        'orderPk'    => $orderPk,
        'mode'       => $mode,
        'truncate'   => $truncate,
        'batchSize'  => dbm_clean_batch_size($entry['batchSize'] ?? null, (int) $globals['batchSize']),
        'limit'      => max(0, dbm_int($entry, 'limit', 0)),
        'offset'     => max(0, dbm_int($entry, 'offset', 0)),
        'nameOpts'   => $globals['nameOpts'],
        'overrides'  => $overrides,
    ];
}

/**
 * Validate a whole job (every table pair) before anything is written.
 *
 * @return array{globals:array, plans:array}
 */
function dbm_build_plans(array $in): array
{
    $srcCfg = dbm_stored_conn('source');
    if ($srcCfg === null) dbm_fail('Source connection is not configured.', 409, ['reconnect' => 'source']);
    $dstCfg = dbm_stored_conn('dest');
    if ($dstCfg === null) dbm_fail('Destination connection is not configured.', 409, ['reconnect' => 'dest']);

    $srcPdo = dbm_conn('source');
    $dstPdo = dbm_conn('dest');

    $globals = [
        'batchSize'      => dbm_clean_batch_size($in['batchSize'] ?? null),
        'allowOverwrite' => dbm_bool($in, 'allowOverwrite'),
        'stopOnError'    => dbm_bool($in, 'stopOnError'),
        'disableFk'      => dbm_bool($in, 'disableFk'),
        'nameOpts'       => dbm_normalise_name_opts(dbm_arr($in, 'nameOptions')),
    ];

    if ($globals['disableFk'] && !$globals['allowOverwrite']) {
        dbm_fail('Turning off foreign key checks needs "Allow overwriting destination data" as well.');
    }

    $entries = dbm_arr($in, 'tables');
    if (!$entries) dbm_fail('Add at least one source table to the job.');
    if (count($entries) > 200) dbm_fail('A single job is limited to 200 tables.');

    $plans = [];
    $seen  = [];
    foreach ($entries as $entry) {
        if (!is_array($entry)) continue;
        $plan = dbm_build_table_plan($entry, $globals, $srcCfg, $dstCfg, $srcPdo, $dstPdo);

        $key = strtolower($plan['srcTable'] . '=>' . $plan['dstTable']);
        if (isset($seen[$key])) {
            dbm_fail('The pair ' . $plan['srcTable'] . ' -> ' . $plan['dstTable'] . ' is listed twice.');
        }
        $seen[$key] = true;
        $plans[] = $plan;
    }

    if (!$plans) dbm_fail('Add at least one source table to the job.');

    return ['globals' => $globals, 'plans' => $plans];
}

// -----------------------------------------------------------------------------
// 10. Reading the source: pagination that works across dialects
// -----------------------------------------------------------------------------

function dbm_base_select(array $plan, bool $withOrder = true): string
{
    $type = $plan['srcType'];
    $cols = implode(', ', array_map(static fn($c) => dbm_quote_ident($type, $c), $plan['selectCols']));
    $sql  = 'SELECT ' . $cols . ' FROM ' . dbm_quote_ident($type, $plan['srcTable']);

    if ($withOrder && $plan['orderBy'] !== '') {
        $sql .= ' ORDER BY ' . dbm_quote_ident($type, $plan['orderBy']) . ' ASC';
    }
    return $sql;
}

/**
 * Wrap the base SELECT in whatever paging syntax the source speaks.
 * Returns null when the dialect has none and rows must be skipped in PHP.
 */
function dbm_page_sql(array $plan, int $limit, int $offset): ?string
{
    $base   = dbm_base_select($plan);
    $limit  = max(1, $limit);
    $offset = max(0, $offset);

    switch ($plan['page']) {
        case 'limit_offset':
            return $base . sprintf(' LIMIT %d OFFSET %d', $limit, $offset);

        case 'offset_fetch':
            // SQL Server refuses OFFSET without an ORDER BY; Oracle does not care.
            if ($plan['orderBy'] === '' && in_array($plan['srcType'], ['sqlsrv', 'dblib'], true)) {
                $base .= ' ORDER BY (SELECT NULL)';
            }
            return $base . sprintf(' OFFSET %d ROWS FETCH NEXT %d ROWS ONLY', $offset, $limit);

        case 'rownum':
            return sprintf(
                'SELECT * FROM (SELECT a.*, ROWNUM AS dbm_rn FROM (%s) a WHERE ROWNUM <= %d) WHERE dbm_rn > %d',
                $base, $offset + $limit, $offset
            );

        case 'rows_to':
            return $base . sprintf(' ROWS %d TO %d', $offset + 1, $offset + $limit);
    }

    return null;
}

/**
 * Fetch one page of source rows.
 *
 * @return array<int, array<string, mixed>>
 */
function dbm_fetch_page(PDO $pdo, array $plan, int $limit, int $offset): array
{
    $sql = dbm_page_sql($plan, $limit, $offset);

    if ($sql !== null) {
        $rows = $pdo->query($sql)->fetchAll();
        foreach ($rows as $i => $r) {
            unset($rows[$i]['dbm_rn'], $rows[$i]['DBM_RN']);   // ROWNUM helper column
        }
        return array_values($rows);
    }

    // No paging dialect (generic ODBC): stream and skip. Slower, but universal.
    $st   = $pdo->query(dbm_base_select($plan));
    $rows = [];
    $seen = 0;
    while (($row = $st->fetch()) !== false) {
        if ($seen++ < $offset) continue;
        $rows[] = $row;
        if (count($rows) >= $limit) break;
    }
    $st->closeCursor();

    return $rows;
}

function dbm_count_source(PDO $pdo, array $plan): int
{
    $sql = 'SELECT COUNT(*) AS c FROM ' . dbm_quote_ident($plan['srcType'], $plan['srcTable']);

    try {
        $row = $pdo->query($sql)->fetch();
        $n   = (int) (is_array($row) ? (reset($row) ?: 0) : 0);
    } catch (Throwable $e) {
        return -1;
    }

    $n = max(0, $n - $plan['offset']);
    if ($plan['limit'] > 0) $n = min($n, $plan['limit']);

    return $n;
}

/**
 * Apply the mapping to one source row.
 *
 * @return array<string, mixed> destination column => value
 */
function dbm_transform_row(array $row, array $plan): array
{
    $ctx = ['overrides' => $plan['overrides'], 'nameOpts' => $plan['nameOpts']];
    $out = [];

    foreach ($plan['mappings'] as $m) {
        $raw   = $m['source'] !== null ? ($row[$m['source']] ?? null) : null;
        $value = $raw;
        $rawS  = $raw === null ? '' : (string) $raw;

        foreach ($m['transforms'] as $step) {
            $value = dbm_apply_transform($value, $step, $rawS, $ctx);
        }
        $out[$m['dest']] = $value;
    }

    return $out;
}

/**
 * Warnings raised by the statement just executed.
 *
 * This matters because INSERT IGNORE — and any server not in strict mode —
 * downgrades "value too long" or "invalid date" from an error to a warning and
 * silently stores a coerced value. Counting them turns that silent data loss
 * into a number the operator can see.
 */
function dbm_warning_count(PDO $pdo): int
{
    try {
        $row = $pdo->query('SELECT @@warning_count AS w')->fetch();
        return (int) (is_array($row) ? (reset($row) ?: 0) : 0);
    } catch (Throwable $e) {
        return 0;
    }
}

/** Bind a PHP value with a sensible PDO type. */
function dbm_bind_type($value): int
{
    if ($value === null) return PDO::PARAM_NULL;
    if (is_bool($value)) return PDO::PARAM_BOOL;
    if (is_int($value))  return PDO::PARAM_INT;

    return PDO::PARAM_STR;
}

// -----------------------------------------------------------------------------
// 11. Migration engine
// -----------------------------------------------------------------------------

function dbm_job_file(string $jobId): string
{
    if (!preg_match('/^[a-f0-9]{16}$/', $jobId)) dbm_fail('Invalid job id.');

    return dbm_state_dir() . DIRECTORY_SEPARATOR . 'job_' . $jobId . '.csv';
}

function dbm_job_error_write(string $jobId, array $rows): void
{
    $path = dbm_job_file($jobId);
    $new  = !is_file($path);
    $fh   = @fopen($path, 'a');
    if (!$fh) return;

    if ($new) fputcsv($fh, ['source_table', 'destination_table', 'row_number', 'error', 'row_data']);
    foreach ($rows as $r) {
        fputcsv($fh, [
            $r['srcTable'] ?? '',
            $r['dstTable'] ?? '',
            $r['row'] ?? '',
            $r['error'] ?? '',
            json_encode($r['data'] ?? null, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE),
        ]);
    }
    fclose($fh);
    @chmod($path, 0600);
}

/** Build the INSERT statement for a chunk of N rows. */
function dbm_insert_sql(array $plan, int $rowCount): string
{
    $type   = $plan['dstType'];
    $cols   = array_column($plan['mappings'], 'dest');
    $quoted = implode(', ', array_map(static fn($c) => dbm_quote_ident($type, $c), $cols));

    $placeholderRow = '(' . implode(', ', array_fill(0, count($cols), '?')) . ')';
    $values = implode(', ', array_fill(0, $rowCount, $placeholderRow));

    $verb = $plan['mode'] === 'skip_duplicates' ? 'INSERT IGNORE INTO' : 'INSERT INTO';
    $sql  = $verb . ' ' . dbm_quote_ident($type, $plan['dstTable']) . ' (' . $quoted . ') VALUES ' . $values;

    if ($plan['mode'] === 'update_duplicates') {
        $updates = [];
        foreach ($cols as $c) {
            $q = dbm_quote_ident($type, $c);
            $updates[] = $q . ' = VALUES(' . $q . ')';
        }
        $sql .= ' ON DUPLICATE KEY UPDATE ' . implode(', ', $updates);
    }

    return $sql;
}

/**
 * Process one batch of one table. Returns counters plus any per-row errors.
 *
 * The batch is inserted inside a transaction as a single multi-row statement.
 * If that fails, the transaction is rolled back and the rows are retried one by
 * one so a single bad record cannot discard the whole batch.
 */
function dbm_run_batch(PDO $src, PDO $dst, array $plan, int $offset, int $size, string $jobId): array
{
    $stat = ['read' => 0, 'inserted' => 0, 'skipped' => 0, 'failed' => 0, 'warnings' => 0, 'errors' => []];

    $rows = dbm_fetch_page($src, $plan, $size, $offset);
    $stat['read'] = count($rows);
    if (!$rows) return $stat;

    $cols     = array_column($plan['mappings'], 'dest');
    $colCount = max(1, count($cols));
    $chunkMax = max(1, (int) floor(20000 / $colCount)); // stay well under the placeholder limit

    $prepared = [];
    foreach ($rows as $i => $row) {
        try {
            $values = dbm_transform_row($row, $plan);
            $flat   = [];
            foreach ($cols as $c) $flat[] = $values[$c] ?? null;
            $prepared[] = ['index' => $offset + $i + 1, 'flat' => $flat, 'assoc' => $values];
        } catch (Throwable $e) {
            $stat['failed']++;
            $stat['errors'][] = [
                'srcTable' => $plan['srcTable'], 'dstTable' => $plan['dstTable'],
                'row'      => $offset + $i + 1,
                'error'    => 'Transformation failed: ' . dbm_safe_message($e->getMessage()),
                'data'     => $row,
            ];
        }
    }

    foreach (array_chunk($prepared, $chunkMax) as $chunk) {
        $count = count($chunk);
        if ($count === 0) continue;

        $inTx = false;
        try {
            $dst->beginTransaction();
            $inTx = true;

            $st = $dst->prepare(dbm_insert_sql($plan, $count));
            $p  = 1;
            foreach ($chunk as $item) {
                foreach ($item['flat'] as $v) {
                    $st->bindValue($p++, $v, dbm_bind_type($v));
                }
            }
            $st->execute();
            $stat['warnings'] += dbm_warning_count($dst);

            $affected = $st->rowCount();
            $dst->commit();
            $inTx = false;

            if ($plan['mode'] === 'skip_duplicates') {
                // INSERT IGNORE: affected rows tells us how many really landed.
                $ins = max(0, min($count, $affected));
                $stat['inserted'] += $ins;
                $stat['skipped']  += $count - $ins;
            } else {
                $stat['inserted'] += $count;
            }
        } catch (Throwable $e) {
            if ($inTx && $dst->inTransaction()) {
                try { $dst->rollBack(); } catch (Throwable $ignored) {}
            }
            // Retry row by row to isolate the offenders.
            foreach ($chunk as $item) {
                try {
                    $one = $dst->prepare(dbm_insert_sql($plan, 1));
                    $p = 1;
                    foreach ($item['flat'] as $v) $one->bindValue($p++, $v, dbm_bind_type($v));
                    $one->execute();
                    $stat['warnings'] += dbm_warning_count($dst);

                    if ($plan['mode'] === 'skip_duplicates' && $one->rowCount() === 0) $stat['skipped']++;
                    else $stat['inserted']++;
                } catch (Throwable $rowError) {
                    $stat['failed']++;
                    $stat['errors'][] = [
                        'srcTable' => $plan['srcTable'], 'dstTable' => $plan['dstTable'],
                        'row'      => $item['index'],
                        'error'    => dbm_safe_message($rowError->getMessage()),
                        'data'     => $item['assoc'],
                    ];
                }
            }
        }
    }

    if ($stat['errors']) dbm_job_error_write($jobId, $stat['errors']);

    return $stat;
}

/** Empty a destination table, falling back to DELETE when TRUNCATE is refused. */
function dbm_clear_table(PDO $dst, array $plan): void
{
    $quoted = dbm_quote_ident($plan['dstType'], $plan['dstTable']);
    try {
        $dst->exec('TRUNCATE TABLE ' . $quoted);
    } catch (Throwable $e) {
        try {
            $dst->exec('DELETE FROM ' . $quoted);
        } catch (Throwable $e2) {
            dbm_fail('Could not clear ' . $plan['dstTable'] . ': ' . dbm_safe_message($e2->getMessage()));
        }
    }
}

// -----------------------------------------------------------------------------
// 12. Saved mappings
//
// A saved mapping is the reusable half of a job: which tables pair up, how their
// columns line up, the transformation steps, the name-parsing options and the
// per-table read settings. It is stored as JSON in the private state directory
// so it outlives the session.
//
// Deliberately NOT saved: connection details and passwords (they belong to the
// session only), and the destructive per-run switches — "empty the table first",
// "allow overwriting" and "turn off foreign key checks" — which must be chosen
// again, on purpose, every time a job is run.
// -----------------------------------------------------------------------------

const DBM_MAX_PROFILES = 100;

function dbm_profile_dir(): string
{
    $dir = dbm_state_dir() . DIRECTORY_SEPARATOR . 'mappings';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);

    return $dir;
}

function dbm_profile_path(string $id): string
{
    if (!preg_match('/^[a-f0-9]{16}$/', $id)) dbm_fail('Invalid saved mapping id.');

    return dbm_profile_dir() . DIRECTORY_SEPARATOR . 'map_' . $id . '.json';
}

/** Manual name-split corrections, keyed by a hash of the raw source value. */
function dbm_profile_clean_overrides(array $in): array
{
    $out = [];
    foreach ($in as $key => $parts) {
        if (!is_string($key) || !str_starts_with($key, 'ov:') || !is_array($parts)) continue;
        $clean = [];
        foreach (['first', 'middle', 'middle_initial', 'last', 'suffix'] as $p) {
            if (isset($parts[$p]) && is_scalar($parts[$p])) $clean[$p] = mb_substr((string) $parts[$p], 0, 200);
        }
        if ($clean) $out[$key] = $clean;
        if (count($out) >= 2000) break;
    }

    return $out;
}

/**
 * Keep only what is meaningful to replay later, with every field bounded.
 * Table and column names are stored verbatim; they are re-resolved against the
 * live schema when the mapping is loaded, so a stale name can never reach SQL.
 */
function dbm_profile_clean_tables(array $tables): array
{
    $transformIds = dbm_transform_ids();
    $out = [];

    foreach ($tables as $entry) {
        if (!is_array($entry)) continue;
        $src = dbm_str($entry, 'sourceTable');
        $dst = dbm_str($entry, 'destTable');
        if ($src === '' || $dst === '') continue;

        $mappings = [];
        foreach (dbm_arr($entry, 'mappings') as $m) {
            if (!is_array($m)) continue;
            $dest = dbm_str($m, 'dest');
            if ($dest === '') continue;

            $steps = [];
            foreach (dbm_arr($m, 'transforms') as $t) {
                if (!is_array($t)) continue;
                $type = (string) ($t['type'] ?? '');
                if (!in_array($type, $transformIds, true)) continue;

                $params = [];
                foreach (dbm_arr($t, 'params') as $k => $v) {
                    if (is_string($k) && is_scalar($v)) $params[$k] = mb_substr((string) $v, 0, 2000);
                }
                $steps[] = ['type' => $type, 'params' => $params];
                if (count($steps) >= 20) break;
            }

            $mappings[] = [
                'dest'       => mb_substr($dest, 0, 128),
                'source'     => mb_substr(dbm_str($m, 'source'), 0, 128),
                'skip'       => dbm_bool($m, 'skip'),
                'transforms' => $steps,
            ];
            if (count($mappings) >= 500) break;
        }

        $mode = dbm_str($entry, 'mode', 'insert');
        $out[] = [
            'sourceTable'   => mb_substr($src, 0, 257),
            'destTable'     => mb_substr($dst, 0, 257),
            'mappings'      => $mappings,
            'nameOverrides' => dbm_profile_clean_overrides(dbm_arr($entry, 'nameOverrides')),
            'orderBy'       => mb_substr(dbm_str($entry, 'orderBy'), 0, 128),
            'mode'          => in_array($mode, ['insert', 'skip_duplicates', 'update_duplicates'], true) ? $mode : 'insert',
            'limit'         => max(0, dbm_int($entry, 'limit')),
            'offset'        => max(0, dbm_int($entry, 'offset')),
        ];
        if (count($out) >= 200) break;
    }

    return $out;
}

/** One-line description of a connection, for the "saved against" hint. */
function dbm_profile_conn_label(string $role): string
{
    $pub = dbm_conn_public($role);
    if ($pub === null) return '';

    return trim($pub['label'] . ($pub['db'] !== '' ? ' / ' . $pub['db'] : ''));
}

function dbm_profile_read(string $id): ?array
{
    $raw = @file_get_contents(dbm_profile_path($id));
    if (!is_string($raw) || $raw === '') return null;

    $doc = json_decode($raw, true);

    return (is_array($doc) && is_array($doc['tables'] ?? null) && $doc['tables']) ? $doc : null;
}

/** @return array<int, array> newest first, without the bulky table payload */
function dbm_profile_index(): array
{
    $out = [];
    foreach (glob(dbm_profile_dir() . DIRECTORY_SEPARATOR . 'map_*.json') ?: [] as $file) {
        $raw = @file_get_contents($file);
        $doc = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($doc) || empty($doc['id']) || !is_array($doc['tables'] ?? null) || !$doc['tables']) continue;

        $columns = 0;
        foreach ($doc['tables'] as $t) {
            if (!is_array($t) || !is_array($t['mappings'] ?? null)) continue;
            foreach ($t['mappings'] as $m) {
                if (is_array($m) && empty($m['skip'])) $columns++;
            }
        }

        $out[] = [
            'id'      => (string) $doc['id'],
            'name'    => (string) ($doc['name'] ?? 'Untitled'),
            'savedAt' => (string) ($doc['savedAt'] ?? ''),
            'tables'  => count($doc['tables']),
            'columns' => $columns,
            'source'  => (string) ($doc['sourceLabel'] ?? ''),
            'dest'    => (string) ($doc['destLabel'] ?? ''),
        ];
    }

    usort($out, static fn($a, $b) => strcmp($b['savedAt'], $a['savedAt']));

    return $out;
}

// -----------------------------------------------------------------------------
// 13. API
// -----------------------------------------------------------------------------

dbm_state_dir();
dbm_session_start();
dbm_gc_jobs();

$action = (string) ($_GET['action'] ?? '');

if ($action !== '') {
    if ($action === 'end_session') {
        dbm_csrf_check();
        dbm_audit('session_ended');
        dbm_wipe_session();
        dbm_json(['ok' => true]);
    }

    dbm_csrf_check();

    // Each request handles at most one batch, but give slow links room to finish.
    if (in_array($action, ['migrate_start', 'migrate_step', 'preview'], true)) {
        @set_time_limit(300);
    }

    try {
        switch ($action) {
            case 'bootstrap':
                dbm_json([
                    'ok'         => true,
                    'drivers'    => dbm_drivers_available(),
                    'pageStyles' => dbm_page_styles(),
                    'batchSizes' => dbm_batch_sizes(),
                    'batchDefault' => dbm_default_batch_size(),
                    'transforms' => dbm_transform_catalog(),
                    'source'     => dbm_conn_public('source'),
                    'dest'       => dbm_conn_public('dest'),
                ]);

            case 'test_connection': {
                $in   = dbm_input();
                $role = dbm_str($in, 'role') === 'dest' ? 'dest' : 'source';
                $cfg  = dbm_validate_conn(dbm_arr($in, 'conn'), $role);

                $t0 = microtime(true);
                try {
                    $pdo    = dbm_connect($cfg);
                    $ver    = (string) $pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
                    $tables = dbm_list_tables($pdo, $cfg);
                } catch (Throwable $e) {
                    dbm_json(['ok' => false, 'error' => dbm_safe_message($e->getMessage())]);
                }

                dbm_json([
                    'ok'         => true,
                    'server'     => $ver !== '' ? $ver : 'connected',
                    'tables'     => count($tables),
                    'enumerable' => (bool) $tables,
                    'ms'         => (int) round((microtime(true) - $t0) * 1000),
                ]);
            }

            case 'save_connection': {
                $in   = dbm_input();
                $role = dbm_str($in, 'role') === 'dest' ? 'dest' : 'source';
                $cfg  = dbm_validate_conn(dbm_arr($in, 'conn'), $role);

                try {
                    $pdo    = dbm_connect($cfg);
                    $tables = dbm_list_tables($pdo, $cfg);
                } catch (Throwable $e) {
                    dbm_json(['ok' => false, 'error' => dbm_safe_message($e->getMessage())]);
                }

                dbm_store_conn($role, $cfg);
                unset($_SESSION['job']);
                dbm_audit('connection_saved', ['role' => $role, 'type' => $cfg['type']]);

                dbm_json([
                    'ok'         => true,
                    'tables'     => $tables,
                    'enumerable' => (bool) $tables,
                    'conn'       => dbm_conn_public($role),
                ]);
            }

            case 'tables': {
                $role = dbm_str(dbm_input(), 'role') === 'dest' ? 'dest' : 'source';
                $cfg  = dbm_stored_conn($role);
                if ($cfg === null) dbm_fail('Connect to the ' . $role . ' database first.', 409, ['reconnect' => $role]);

                $tables = dbm_list_tables(dbm_conn($role), $cfg);
                dbm_json(['ok' => true, 'tables' => $tables, 'enumerable' => (bool) $tables]);
            }

            case 'columns': {
                $in   = dbm_input();
                $role = dbm_str($in, 'role') === 'dest' ? 'dest' : 'source';
                $cfg  = dbm_stored_conn($role);
                if ($cfg === null) dbm_fail('Connect to the ' . $role . ' database first.', 409, ['reconnect' => $role]);

                $pdo   = dbm_conn($role);
                $table = dbm_assert_table($pdo, $cfg, dbm_str($in, 'table'), $role);
                $cols  = dbm_list_columns($pdo, $cfg, $table, $role);

                $rows = -1;
                try {
                    $row  = $pdo->query('SELECT COUNT(*) AS c FROM ' . dbm_quote_ident($cfg['type'], $table))->fetch();
                    $rows = (int) (is_array($row) ? (reset($row) ?: 0) : 0);
                } catch (Throwable $e) {
                    $rows = -1;
                }

                dbm_json(['ok' => true, 'table' => $table, 'columns' => $cols, 'rowCount' => $rows]);
            }

            case 'columns_bulk': {
                // Structure for several tables at once, so the mapping step can be
                // built for a whole multi-table job in one round trip.
                $in   = dbm_input();
                $role = dbm_str($in, 'role') === 'dest' ? 'dest' : 'source';
                $cfg  = dbm_stored_conn($role);
                if ($cfg === null) dbm_fail('Connect to the ' . $role . ' database first.', 409, ['reconnect' => $role]);

                $pdo    = dbm_conn($role);
                $wanted = dbm_arr($in, 'tables');
                if (count($wanted) > 200) dbm_fail('Too many tables requested at once.');

                $out = [];
                foreach ($wanted as $t) {
                    if (!is_string($t) || $t === '') continue;
                    dbm_soft_errors(true);   // one bad table must not sink the whole request
                    try {
                        $canonical = dbm_assert_table($pdo, $cfg, $t, $role);
                        $rows = -1;
                        try {
                            $row  = $pdo->query('SELECT COUNT(*) AS c FROM ' . dbm_quote_ident($cfg['type'], $canonical))->fetch();
                            $rows = (int) (is_array($row) ? (reset($row) ?: 0) : 0);
                        } catch (Throwable $e) {
                            $rows = -1;
                        }
                        $out[$t] = [
                            'ok' => true, 'table' => $canonical,
                            'columns' => dbm_list_columns($pdo, $cfg, $canonical, $role),
                            'rowCount' => $rows,
                        ];
                    } catch (Throwable $e) {
                        $out[$t] = ['ok' => false, 'error' => dbm_safe_message($e->getMessage())];
                    } finally {
                        dbm_soft_errors(false);
                    }
                }

                dbm_json(['ok' => true, 'results' => $out]);
            }

            case 'split_preview': {
                // Ad-hoc preview used by the "Split Full Name" dialog.
                $in  = dbm_input();
                $cfg = dbm_stored_conn('source');
                if ($cfg === null) dbm_fail('Connect to the source database first.', 409, ['reconnect' => 'source']);

                $pdo    = dbm_conn('source');
                $table  = dbm_assert_table($pdo, $cfg, dbm_str($in, 'table'), 'source');
                $cols   = dbm_list_columns($pdo, $cfg, $table, 'source');
                $column = dbm_resolve_column($cols, dbm_str($in, 'column'));
                if ($column === null) dbm_fail('Unknown column: ' . dbm_str($in, 'column'));

                $opts  = dbm_normalise_name_opts(dbm_arr($in, 'options'));
                $limit = max(1, min(50, dbm_int($in, 'limit', 10)));

                $probe = [
                    'srcType'    => $cfg['type'],
                    'page'       => dbm_page_style($cfg),
                    'srcTable'   => $table,
                    'selectCols' => [$column],
                    'orderBy'    => '',
                ];

                $out = [];
                foreach (dbm_fetch_page($pdo, $probe, $limit, 0) as $r) {
                    $value = reset($r);
                    $raw   = $value === null ? '' : (string) $value;
                    $out[] = ['raw' => $raw, 'key' => 'ov:' . md5($raw), 'parts' => dbm_split_name($raw, $opts)];
                }

                dbm_json(['ok' => true, 'rows' => $out]);
            }

            // ---- Saved mappings -------------------------------------------
            case 'mappings': {
                dbm_json(['ok' => true, 'mappings' => dbm_profile_index()]);
            }

            case 'mapping_save': {
                $in   = dbm_input();
                $name = dbm_str($in, 'name');
                if ($name === '') dbm_fail('Give the mapping a name so you can find it again.');
                if (mb_strlen($name) > 120) dbm_fail('That name is too long (120 characters maximum).');

                $tables = dbm_profile_clean_tables(dbm_arr($in, 'tables'));
                if (!$tables) dbm_fail('There is nothing to save yet — map at least one column first.');

                // An empty id means "save as new"; otherwise overwrite that entry.
                $id = dbm_str($in, 'id');
                if ($id === '') {
                    if (count(dbm_profile_index()) >= DBM_MAX_PROFILES) {
                        dbm_fail('You already have ' . DBM_MAX_PROFILES . ' saved mappings. Delete one first.');
                    }
                    $id = bin2hex(random_bytes(8));
                } elseif (dbm_profile_read($id) === null) {
                    dbm_fail('That saved mapping no longer exists.', 404);
                }

                $doc = [
                    'id'          => $id,
                    'name'        => $name,
                    'savedAt'     => gmdate('c'),
                    'app'         => DBM_APP,
                    'version'     => DBM_VERSION,
                    'sourceLabel' => dbm_profile_conn_label('source'),
                    'destLabel'   => dbm_profile_conn_label('dest'),
                    'nameOptions' => dbm_normalise_name_opts(dbm_arr($in, 'nameOptions')),
                    'batchSize'   => dbm_clean_batch_size($in['batchSize'] ?? null),
                    'stopOnError' => dbm_bool($in, 'stopOnError'),
                    'tables'      => $tables,
                ];

                $json = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE);
                if (!is_string($json)) dbm_fail('The mapping could not be encoded.', 500);

                $path = dbm_profile_path($id);
                if (@file_put_contents($path, $json, LOCK_EX) === false) {
                    dbm_fail('Could not write the mapping. Make sure PHP can write to ' . basename(DBM_STATE) . '.', 500);
                }
                @chmod($path, 0600);
                dbm_audit('mapping_saved', ['id' => $id, 'tables' => count($tables)]);

                dbm_json(['ok' => true, 'id' => $id, 'mappings' => dbm_profile_index()]);
            }

            case 'mapping_load': {
                $doc = dbm_profile_read(dbm_str(dbm_input(), 'id'));
                if ($doc === null) dbm_fail('That saved mapping could not be read.', 404);

                dbm_json(['ok' => true, 'mapping' => $doc]);
            }

            case 'mapping_delete': {
                $id = dbm_str(dbm_input(), 'id');
                if (dbm_profile_read($id) === null) dbm_fail('That saved mapping no longer exists.', 404);

                @unlink(dbm_profile_path($id));
                dbm_audit('mapping_deleted', ['id' => $id]);

                dbm_json(['ok' => true, 'mappings' => dbm_profile_index()]);
            }

            case 'preview': {
                $in    = dbm_input();
                $built = dbm_build_plans($in);
                $plans = $built['plans'];

                $index = max(0, min(count($plans) - 1, dbm_int($in, 'tableIndex', 0)));
                $limit = max(1, min(100, dbm_int($in, 'previewRows', 10)));
                $plan  = $plans[$index];
                $src   = dbm_conn('source');

                $rows = dbm_fetch_page($src, $plan, $limit, $plan['offset']);
                $out  = [];
                foreach ($rows as $row) {
                    $transformed = dbm_transform_row($row, $plan);

                    // Surface name-parser warnings for any name_part mapping.
                    $notes = [];
                    $keys  = [];
                    foreach ($plan['mappings'] as $m) {
                        foreach ($m['transforms'] as $t) {
                            if ($t['type'] !== 'name_part' || $m['source'] === null) continue;
                            $raw = (string) ($row[$m['source']] ?? '');
                            $keys[$m['dest']] = ['key' => 'ov:' . md5($raw), 'part' => $t['params']['part'] ?? 'first', 'raw' => $raw];
                            foreach (dbm_split_name($raw, $plan['nameOpts'])['warnings'] as $w) {
                                $notes[$w] = true;
                            }
                        }
                    }

                    $out[] = [
                        'source'      => $row,
                        'transformed' => $transformed,
                        'nameCells'   => $keys,
                        'warnings'    => array_keys($notes),
                    ];
                }

                // A one-line summary of every table in the job.
                $summary = [];
                foreach ($plans as $i => $p) {
                    $summary[] = [
                        'index'    => $i,
                        'source'   => $p['srcTable'],
                        'dest'     => $p['dstTable'],
                        'columns'  => count($p['mappings']),
                        'rows'     => dbm_count_source($src, $p),
                        'mode'     => $p['mode'],
                        'truncate' => $p['truncate'],
                        'orderBy'  => $p['orderBy'],
                        'orderPk'  => $p['orderPk'],
                    ];
                }

                dbm_json([
                    'ok'          => true,
                    'index'       => $index,
                    'rows'        => $out,
                    'destColumns' => array_column($plan['mappings'], 'dest'),
                    'srcTypes'    => $plan['srcTypes'],
                    'summary'     => $summary,
                ]);
            }

            case 'migrate_start': {
                $in      = dbm_input();
                $built   = dbm_build_plans($in);
                $plans   = $built['plans'];
                $globals = $built['globals'];

                $wantsClear = false;
                foreach ($plans as $p) {
                    if ($p['truncate']) $wantsClear = true;
                }
                if ($wantsClear && dbm_str($in, 'confirm') !== 'OVERWRITE') {
                    dbm_fail('Type OVERWRITE to confirm clearing destination tables.');
                }

                $src = dbm_conn('source');
                $dst = dbm_conn('dest');

                $tables = [];
                foreach ($plans as $p) {
                    $total = dbm_count_source($src, $p);
                    if ($total < 0 && $p['limit'] > 0) $total = $p['limit'];

                    $before = -1;
                    try {
                        $row    = $dst->query('SELECT COUNT(*) AS c FROM ' . dbm_quote_ident($p['dstType'], $p['dstTable']))->fetch();
                        $before = (int) (is_array($row) ? (reset($row) ?: 0) : 0);
                    } catch (Throwable $e) {
                        $before = -1;
                    }

                    $tables[] = [
                        'src'       => $p['srcTable'],
                        'dst'       => $p['dstTable'],
                        'total'     => $total,
                        'before'    => $before,
                        'processed' => 0,
                        'inserted'  => 0,
                        'skipped'   => 0,
                        'failed'    => 0,
                        'warnings'  => 0,
                        'cursor'    => $p['offset'],
                        'state'     => 'pending',
                    ];
                }

                $jobId = bin2hex(random_bytes(8));
                @unlink(dbm_job_file($jobId));

                $_SESSION['job'] = [
                    'id'        => $jobId,
                    'plans'     => $plans,
                    'globals'   => $globals,
                    'tables'    => $tables,
                    'current'   => 0,
                    'errors'    => [],
                    'startedAt' => microtime(true),
                    'done'      => false,
                    'cancelled' => false,
                    'stopped'   => false,
                ];

                dbm_audit('migration_start', [
                    'job'    => $jobId,
                    'tables' => count($plans),
                    'rows'   => array_sum(array_map(static fn($t) => max(0, $t['total']), $tables)),
                ]);

                dbm_json(['ok' => true] + dbm_job_progress($_SESSION['job']));
            }

            case 'migrate_step': {
                $job = $_SESSION['job'] ?? null;
                if (!is_array($job)) dbm_fail('No migration is running.', 409);
                if (dbm_str(dbm_input(), 'jobId') !== $job['id']) dbm_fail('Job id mismatch.', 409);

                if ($job['done'] || $job['cancelled']) {
                    dbm_json(['ok' => true] + dbm_job_progress($job));
                }

                $src = dbm_conn('source');
                $dst = dbm_conn('dest');

                // Connections are per-request, so this has to be re-applied each step.
                if (!empty($job['globals']['disableFk'])) {
                    try { $dst->exec('SET FOREIGN_KEY_CHECKS = 0'); } catch (Throwable $e) {}
                }

                $count = count($job['plans']);
                $i     = (int) $job['current'];
                while ($i < $count && $job['tables'][$i]['state'] === 'done') $i++;

                if ($i >= $count) {
                    $job['current'] = $count;
                    $job['done']    = true;
                    $_SESSION['job'] = $job;
                    dbm_audit('migration_finished', ['job' => $job['id']] + dbm_job_totals($job));
                    dbm_json(['ok' => true] + dbm_job_progress($job));
                }

                $plan = $job['plans'][$i];
                $t    = $job['tables'][$i];

                if ($t['state'] === 'pending') {
                    if ($plan['truncate']) {
                        dbm_clear_table($dst, $plan);
                        dbm_audit('destination_cleared', [
                            'job' => $job['id'], 'table' => $plan['dstTable'], 'previousRows' => $t['before'],
                        ]);
                    }
                    $t['state'] = 'running';
                }

                $size = (int) $plan['batchSize'];
                if ($t['total'] >= 0) {
                    $size = (int) min($size, max(0, $t['total'] - $t['processed']));
                }

                if ($size <= 0) {
                    $t['state'] = 'done';
                } else {
                    $stat = dbm_run_batch($src, $dst, $plan, $t['cursor'], $size, $job['id']);

                    $t['cursor']    += $stat['read'];
                    $t['processed'] += $stat['read'];
                    $t['inserted']  += $stat['inserted'];
                    $t['skipped']   += $stat['skipped'];
                    $t['failed']    += $stat['failed'];
                    $t['warnings']  += $stat['warnings'];

                    foreach ($stat['errors'] as $e) {
                        if (count($job['errors']) < 300) $job['errors'][] = $e;
                    }

                    if ($stat['read'] === 0 || $stat['read'] < $size || ($t['total'] >= 0 && $t['processed'] >= $t['total'])) {
                        $t['state'] = 'done';
                    }
                    if (!empty($job['globals']['stopOnError']) && $stat['failed'] > 0) {
                        $t['state']     = 'done';
                        $job['stopped'] = true;
                        $job['done']    = true;
                    }
                }

                $job['tables'][$i] = $t;
                if ($t['state'] === 'done' && !$job['done']) {
                    dbm_audit('table_finished', [
                        'job' => $job['id'], 'from' => $t['src'], 'to' => $t['dst'],
                        'processed' => $t['processed'], 'inserted' => $t['inserted'],
                        'skipped' => $t['skipped'], 'failed' => $t['failed'],
                    ]);
                    $i++;
                }
                $job['current'] = $i;

                if (!$job['done'] && $i >= $count) {
                    $job['done'] = true;
                }
                if ($job['done']) {
                    dbm_audit('migration_finished', ['job' => $job['id']] + dbm_job_totals($job));
                }

                $_SESSION['job'] = $job;
                dbm_json(['ok' => true] + dbm_job_progress($job));
            }

            case 'migrate_cancel': {
                $job = $_SESSION['job'] ?? null;
                if (!is_array($job)) dbm_fail('No migration is running.', 409);

                $job['cancelled'] = true;
                $job['done']      = true;
                $_SESSION['job']  = $job;
                dbm_audit('migration_cancelled', ['job' => $job['id']] + dbm_job_totals($job));

                dbm_json(['ok' => true] + dbm_job_progress($job));
            }

            case 'migrate_status': {
                $job = $_SESSION['job'] ?? null;
                if (!is_array($job)) dbm_json(['ok' => true, 'idle' => true]);

                dbm_json(['ok' => true] + dbm_job_progress($job));
            }

            case 'errors_csv': {
                $job = $_SESSION['job'] ?? null;
                if (!is_array($job)) dbm_fail('No migration results available.', 404);

                $path = dbm_job_file($job['id']);
                if (!is_file($path)) dbm_fail('No failed records were recorded.', 404);

                header('Content-Type: text/csv; charset=utf-8');
                header('Content-Disposition: attachment; filename="migration_errors_' . $job['id'] . '.csv"');
                header('X-Content-Type-Options: nosniff');
                readfile($path);
                exit;
            }

            case 'reset': {
                unset($_SESSION['conn'], $_SESSION['job']);
                dbm_json(['ok' => true]);
            }
        }

        dbm_fail('Unknown action.', 404);
    } catch (PDOException $e) {
        dbm_fail('Database error: ' . dbm_safe_message($e->getMessage()), 500);
    } catch (Throwable $e) {
        dbm_fail('Unexpected error: ' . dbm_safe_message($e->getMessage()), 500);
    }
}

function dbm_job_totals(array $job): array
{
    $sum = ['total' => 0, 'processed' => 0, 'inserted' => 0, 'skipped' => 0, 'failed' => 0, 'warnings' => 0];
    foreach ($job['tables'] as $t) {
        $sum['total']     += max(0, (int) $t['total']);
        $sum['processed'] += (int) $t['processed'];
        $sum['inserted']  += (int) $t['inserted'];
        $sum['skipped']   += (int) $t['skipped'];
        $sum['failed']    += (int) $t['failed'];
        $sum['warnings']  += (int) ($t['warnings'] ?? 0);
    }
    return $sum;
}

function dbm_job_progress(array $job): array
{
    $elapsed = max(0.001, microtime(true) - (float) $job['startedAt']);
    $totals  = dbm_job_totals($job);

    $tables = [];
    foreach ($job['tables'] as $i => $t) {
        $tables[] = $t + ['index' => $i, 'mode' => $job['plans'][$i]['mode']];
    }

    return [
        'jobId'        => $job['id'],
        'totals'       => $totals,
        'tables'       => $tables,
        'current'      => (int) $job['current'],
        'tableCount'   => count($job['tables']),
        'errors'       => $job['errors'],
        'done'         => (bool) $job['done'],
        'cancelled'    => (bool) $job['cancelled'],
        'stopped'      => (bool) ($job['stopped'] ?? false),
        'elapsed'      => round($elapsed, 1),
        'rate'         => (int) round($totals['processed'] / $elapsed),
        'hasErrorFile' => is_file(dbm_job_file($job['id'])),
    ];
}

// -----------------------------------------------------------------------------
// 14. HTML shell
// -----------------------------------------------------------------------------

$csrf = dbm_csrf_token();

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?= h(DBM_APP) ?></title>
<style>
  :root{
    --bg:#f5f6f8; --panel:#ffffff; --ink:#16181d; --muted:#697086; --line:#e2e5ec;
    --brand:#2f5bea; --brand-ink:#ffffff; --ok:#128a52; --ok-bg:#e7f6ee;
    --warn:#9a6400; --warn-bg:#fdf3e0; --err:#c2352c; --err-bg:#fdeceb;
    --radius:10px; --shadow:0 1px 2px rgba(16,20,35,.06),0 8px 24px rgba(16,20,35,.06);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--brand)}
  .wrap{max-width:1180px;margin:0 auto;padding:24px 20px 80px}
  header.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:17px}
  .brand .dot{width:26px;height:26px;border-radius:7px;background:var(--brand);color:#fff;display:grid;place-items:center;font-size:13px}
  .ver{color:var(--muted);font-weight:400;font-size:12px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
  .card+.card{margin-top:16px}
  .card h2{margin:0;padding:16px 20px;border-bottom:1px solid var(--line);font-size:15px;font-weight:650}
  .card .body{padding:20px}
  .muted{color:var(--muted)}
  .small{font-size:12.5px}
  /* stepper */
  .steps{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:18px}
  .step{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 13px;border-radius:999px;border:1px solid var(--line);
        background:#fff;color:var(--muted);font-size:13px;cursor:pointer;white-space:nowrap}
  .step .n{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#eef0f5;color:var(--muted);font-size:11px;font-weight:650}
  .step.active{border-color:var(--brand);color:var(--brand);background:#eef2ff}
  .step.active .n{background:var(--brand);color:#fff}
  .step.done{color:var(--ok);border-color:#bfe6d2}
  .step.done .n{background:var(--ok-bg);color:var(--ok)}
  .step.locked{opacity:.5;cursor:not-allowed}
  /* forms */
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
  label.f{display:block;font-size:12.5px;font-weight:600;color:#39405a;margin-bottom:5px}
  input[type=text],input[type=password],input[type=number],select,textarea{
    width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);font:inherit}
  input:focus,select:focus,textarea:focus{outline:2px solid #c9d6ff;border-color:var(--brand)}
  textarea{min-height:70px;resize:vertical}
  .check{display:flex;align-items:flex-start;gap:8px;font-size:13px}
  .check input{margin-top:3px}
  .btn{display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:8px;border:1px solid var(--line);
       background:#fff;color:var(--ink);font:inherit;font-weight:600;cursor:pointer}
  .btn:hover{background:#f7f8fb}
  .btn.primary{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}
  .btn.primary:hover{filter:brightness(1.06)}
  .btn.danger{background:var(--err);border-color:var(--err);color:#fff}
  .btn.ghost{background:transparent;border-color:transparent;color:var(--brand)}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .btn.sm{padding:5px 10px;font-size:12.5px}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .foot{display:flex;justify-content:space-between;gap:10px;padding:14px 20px;border-top:1px solid var(--line);background:#fafbfd;border-radius:0 0 var(--radius) var(--radius)}
  /* notices */
  .note{padding:10px 13px;border-radius:8px;font-size:13px;margin-bottom:14px;border:1px solid transparent}
  .note.ok{background:var(--ok-bg);color:var(--ok);border-color:#bfe6d2}
  .note.err{background:var(--err-bg);color:var(--err);border-color:#f4c9c6}
  .note.warn{background:var(--warn-bg);color:var(--warn);border-color:#f0dcae}
  .note.info{background:#eef2ff;color:#2a45a8;border-color:#ccd8ff}
  .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:650;background:#eef0f5;color:var(--muted)}
  .pill.ok{background:var(--ok-bg);color:var(--ok)}
  .pill.warn{background:var(--warn-bg);color:var(--warn)}
  .pill.err{background:var(--err-bg);color:var(--err)}
  /* tables */
  .tbl-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px;max-height:60vh}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  th{background:#f7f8fb;font-weight:650;position:sticky;top:0;z-index:1;white-space:nowrap}
  tbody tr:hover{background:#fafbfe}
  td.mono,th.mono,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
  .type{color:var(--muted);font-size:11.5px}
  tr.skipped td{opacity:.45}
  /* progress */
  .bar{height:10px;border-radius:999px;background:#e8eaf1;overflow:hidden}
  .bar>i{display:block;height:100%;background:var(--brand);width:0;transition:width .25s ease}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:16px 0}
  .stat{border:1px solid var(--line);border-radius:8px;padding:12px}
  .stat b{display:block;font-size:22px;font-weight:700;line-height:1.2}
  .stat span{font-size:12px;color:var(--muted)}
  /* modal */
  .modal{position:fixed;inset:0;background:rgba(16,20,35,.45);display:none;place-items:center;padding:20px;z-index:50}
  .modal.open{display:grid}
  .modal .box{background:#fff;border-radius:12px;max-width:760px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)}
  .modal h3{margin:0;padding:16px 20px;border-bottom:1px solid var(--line);font-size:15px}
  .modal .mbody{padding:20px}
  .modal .mfoot{padding:14px 20px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:10px;background:#fafbfd}
  .hide{display:none !important}
  .spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
  .btn:not(.primary) .spinner{border-color:rgba(0,0,0,.2);border-top-color:var(--ink)}
  @keyframes spin{to{transform:rotate(360deg)}}
  .kbd{font-family:ui-monospace,monospace;background:#eef0f5;border-radius:4px;padding:1px 5px;font-size:12px}
  code{background:#eef0f5;border-radius:4px;padding:1px 5px;font-size:12.5px}
  /* multi-table layout */
  .split{display:grid;grid-template-columns:270px 1fr;gap:18px;align-items:start}
  @media(max-width:860px){.split{grid-template-columns:1fr}}
  .pairnav{border:1px solid var(--line);border-radius:8px;overflow:hidden;max-height:62vh;overflow-y:auto}
  .pairnav .ph{padding:9px 12px;background:#f7f8fb;border-bottom:1px solid var(--line);font-size:12px;font-weight:650;color:var(--muted)}
  .pairnav .pi{padding:9px 12px;border-bottom:1px solid var(--line);cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center}
  .pairnav .pi:last-child{border-bottom:0}
  .pairnav .pi:hover{background:#fafbfe}
  .pairnav .pi.on{background:#eef2ff;box-shadow:inset 3px 0 0 var(--brand)}
  .pairnav .pi .nm{min-width:0}
  .pairnav .pi .nm b{display:block;font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pairnav .pi .nm span{display:block;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .minibar{height:5px;border-radius:999px;background:#e8eaf1;overflow:hidden;min-width:70px}
  .minibar>i{display:block;height:100%;background:var(--brand);width:0}
  .tag{display:inline-block;padding:1px 6px;border-radius:5px;font-size:11px;background:#eef0f5;color:var(--muted);font-weight:600}
  .searchbox{width:100%;margin-bottom:8px}
  .picker{border:1px solid var(--line);border-radius:8px;max-height:280px;overflow:auto}
  .picker label{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--line);font-size:13px;cursor:pointer}
  .picker label:last-child{border-bottom:0}
  .picker label:hover{background:#fafbfe}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand"><span class="dot">DB</span> <?= h(DBM_APP) ?> <span class="ver">v<?= h(DBM_VERSION) ?></span></div>
    <div class="row" id="topActions"></div>
  </header>

  <!-- ===================== App ===================== -->
  <div id="app">
    <nav class="steps" id="steps"></nav>
    <div id="globalMsg"></div>

    <!-- Step 1 & 2: connections -->
    <section class="card pane" data-pane="1">
      <h2>1 &middot; Source database</h2>
      <div class="body">
        <p class="small muted" style="margin-top:0">Read from any database PHP can reach: MySQL, MariaDB, PostgreSQL,
          SQL Server, Oracle, Firebird, SQLite, or anything else through ODBC.</p>
        <div id="srcMsg"></div>
        <div class="grid" id="srcForm"></div>
      </div>
      <div class="foot">
        <div class="row">
          <button class="btn" data-test="source">Test connection</button>
          <span class="small muted">Credentials stay in this server-side session only.</span>
        </div>
        <button class="btn primary" data-connect="source">Connect &amp; continue</button>
      </div>
    </section>

    <section class="card pane hide" data-pane="2">
      <h2>2 &middot; Destination database (MySQL / MariaDB)</h2>
      <div class="body">
        <div id="dstMsg"></div>
        <div class="grid" id="dstForm"></div>
      </div>
      <div class="foot">
        <div class="row">
          <button class="btn" data-back="1">Back</button>
          <button class="btn" data-test="dest">Test connection</button>
        </div>
        <button class="btn primary" data-connect="dest">Connect &amp; continue</button>
      </div>
    </section>

    <!-- Step 3: tables -->
    <section class="card pane hide" data-pane="3">
      <h2>3 &middot; Select tables</h2>
      <div class="body">
        <div id="tblMsg"></div>
        <div class="split">
          <div>
            <label class="f">Source tables</label>
            <input type="text" class="searchbox" id="srcSearch" placeholder="Filter tables…" autocomplete="off">
            <div class="picker" id="srcPicker"></div>
            <div class="row" style="margin-top:10px">
              <button class="btn sm" id="btnAddSelected">Add selected</button>
              <button class="btn sm" id="btnAddAll">Add all</button>
            </div>
            <div style="margin-top:12px">
              <label class="f" for="manualTable">Or type a table name</label>
              <div class="row">
                <input type="text" id="manualTable" placeholder="schema.table" autocomplete="off" style="flex:1;min-width:120px">
                <button class="btn sm" id="btnAddManual">Add</button>
              </div>
              <div class="small muted" style="margin-top:5px" id="manualHint"></div>
            </div>
          </div>
          <div>
            <div class="row" style="margin-bottom:10px">
              <b style="font-size:13px">Tables in this job</b>
              <span class="pill" id="pairCount">0</span>
              <button class="btn sm" id="btnAutoMatch">Auto-match destinations</button>
              <button class="btn sm" id="btnClearPairs">Clear all</button>
              <button class="btn sm" id="btnProfiles3">Saved mappings…</button>
            </div>
            <div class="tbl-wrap">
              <table id="pairTable">
                <thead><tr>
                  <th style="width:26%">Source table</th>
                  <th style="width:30%">Destination table</th>
                  <th style="width:10%">Rows</th>
                  <th style="width:20%">Status</th>
                  <th style="width:14%">Order</th>
                </tr></thead>
                <tbody></tbody>
              </table>
            </div>
            <p class="small muted" style="margin-bottom:0">Add tables whenever you like — come back to this step at any
              point and the mapping and transformations already set up on the other tables are kept.
              Order matters when the destination has foreign keys: migrate parent tables before the tables that reference them.</p>
          </div>
        </div>
      </div>
      <div class="foot">
        <button class="btn" data-back="2">Back</button>
        <button class="btn primary" id="btnLoadColumns">Load structure &amp; continue</button>
      </div>
    </section>

    <!-- Step 4: mapping -->
    <section class="card pane hide" data-pane="4">
      <h2>4 &middot; Map columns</h2>
      <div class="body">
        <div id="mapMsg"></div>
        <div class="split">
          <div class="pairnav" id="mapNav"></div>
          <div>
            <div class="row" style="margin-bottom:12px">
              <button class="btn sm" id="btnAutoMap">Auto-map this table</button>
              <button class="btn sm" id="btnAutoMapAll">Auto-map every table</button>
              <button class="btn sm" id="btnSplitName">Split full name…</button>
              <button class="btn sm" id="btnClearMap">Clear this table</button>
              <button class="btn sm" id="btnAddMore">+ Add another table</button>
              <button class="btn sm" id="btnProfiles">Saved mappings…</button>
            </div>
            <div class="small muted" style="margin-bottom:10px" id="mapSummary"></div>
            <div class="tbl-wrap">
              <table id="mapTable">
                <thead>
                  <tr>
                    <th style="width:26%">Destination column</th>
                    <th style="width:14%">Dest. type</th>
                    <th style="width:30%">Source column</th>
                    <th style="width:16%">Source type</th>
                    <th style="width:14%">Skip</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
            <details style="margin-top:14px">
              <summary class="small muted" style="cursor:pointer">Source columns reference</summary>
              <div class="tbl-wrap" style="margin-top:10px;max-height:34vh">
                <table id="srcColsTable">
                  <thead><tr><th>Source column</th><th>Data type</th><th>Nullable</th><th>Used for</th></tr></thead>
                  <tbody></tbody>
                </table>
              </div>
            </details>
          </div>
        </div>
      </div>
      <div class="foot">
        <button class="btn" data-back="3">Back</button>
        <button class="btn primary" data-go="5">Continue to transformations</button>
      </div>
    </section>

    <!-- Step 5: transforms -->
    <section class="card pane hide" data-pane="5">
      <h2>5 &middot; Transform data</h2>
      <div class="body">
        <div id="trMsg"></div>
        <div class="split">
          <div class="pairnav" id="trNav"></div>
          <div>
            <p class="small muted" style="margin-top:0">Steps run in order, top to bottom, on the mapped source value.
              Columns with no steps are copied as-is.</p>
            <div id="trList"></div>
            <details style="margin-top:18px" id="nameOptsBox">
              <summary class="small" style="cursor:pointer;font-weight:600">Full-name parsing options (apply to the whole job)</summary>
              <div class="grid" style="margin-top:12px" id="nameOptsGrid"></div>
            </details>
          </div>
        </div>
      </div>
      <div class="foot">
        <button class="btn" data-back="4">Back</button>
        <button class="btn primary" data-go="6">Preview</button>
      </div>
    </section>

    <!-- Step 6: preview -->
    <section class="card pane hide" data-pane="6">
      <h2>6 &middot; Preview</h2>
      <div class="body">
        <div id="pvMsg"></div>
        <div class="split">
          <div class="pairnav" id="pvNav"></div>
          <div>
            <div class="row" style="margin-bottom:14px">
              <label class="f" style="margin:0">Rows</label>
              <input type="number" id="previewRows" value="10" min="1" max="100" style="width:90px">
              <button class="btn sm" id="btnPreview">Refresh preview</button>
              <span class="small muted" id="previewInfo"></span>
            </div>
            <div id="previewOut"></div>
          </div>
        </div>
        <h3 style="font-size:14px;margin:22px 0 8px">Job summary</h3>
        <div id="summaryOut"></div>
      </div>
      <div class="foot">
        <button class="btn" data-back="5">Back</button>
        <button class="btn primary" data-go="7">Continue to migration</button>
      </div>
    </section>

    <!-- Step 7: migration options -->
    <section class="card pane hide" data-pane="7">
      <h2>7 &middot; Migration</h2>
      <div class="body">
        <div id="runMsg"></div>
        <div class="grid">
          <div>
            <label class="f" for="batchSize">Batch size (rows per round trip)</label>
            <select id="batchSize"></select>
            <div class="small muted" style="margin-top:6px" id="batchHint"></div>
          </div>
        </div>
        <div style="margin-top:16px;display:grid;gap:10px">
          <label class="check"><input type="checkbox" id="allowOverwrite">
            <span><b>Allow overwriting destination data.</b> Required for "update duplicates", for emptying a table and for turning off foreign key checks.</span></label>
          <label class="check"><input type="checkbox" id="stopOnError">
            <span>Stop the whole job at the first failed batch.</span></label>
          <div class="note info small" style="margin:0">
            <b>About "Skip duplicates".</b> It uses MySQL's <code>INSERT IGNORE</code>, which downgrades
            <i>every</i> error to a warning — not just duplicate keys. A value too long for its column, or an
            unparseable date, is silently shortened or zeroed instead of being reported as a failed row.
            Any such row is counted under <b>Coerced</b> in the results. Use "Insert only" when you would
            rather see those rows fail loudly.
          </div>
          <label class="check"><input type="checkbox" id="disableFk" disabled>
            <span><b>Turn off foreign key checks while migrating.</b> Useful when related tables are loaded out of order; constraints are not validated for the inserted rows.</span></label>
        </div>

        <h3 style="font-size:14px;margin:22px 0 8px">Per-table settings</h3>
        <div class="tbl-wrap">
          <table id="runTable">
            <thead><tr>
              <th style="width:24%">Table</th>
              <th style="width:22%">When a row already exists</th>
              <th style="width:18%">Read order</th>
              <th style="width:10%">Limit</th>
              <th style="width:10%">Skip</th>
              <th style="width:16%">Empty first</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>

        <div id="progressBox" class="hide" style="margin-top:22px">
          <div class="bar"><i id="progressBar"></i></div>
          <div class="row" style="justify-content:space-between;margin-top:8px">
            <span class="small muted" id="progressText">Starting…</span>
            <span class="small muted" id="progressRate"></span>
          </div>
          <div class="stats" id="liveStats"></div>
          <div class="tbl-wrap" style="max-height:34vh"><table id="liveTable">
            <thead><tr><th>Table</th><th style="width:24%">Progress</th><th>Migrated</th><th>Skipped</th><th>Failed</th><th>Coerced</th><th>State</th></tr></thead>
            <tbody></tbody>
          </table></div>
        </div>
      </div>
      <div class="foot">
        <button class="btn" data-back="6">Back</button>
        <div class="row">
          <button class="btn danger hide" id="btnCancel">Cancel migration</button>
          <button class="btn primary" id="btnStart">Review &amp; start migration</button>
        </div>
      </div>
    </section>

    <!-- Step 8: results -->
    <section class="card pane hide" data-pane="8">
      <h2>8 &middot; Migration results</h2>
      <div class="body">
        <div id="resultMsg"></div>
        <div class="stats" id="resultStats"></div>
        <h3 style="font-size:14px;margin:18px 0 8px">Per table</h3>
        <div class="tbl-wrap"><table id="resultTable">
          <thead><tr><th>Source</th><th>Destination</th><th>Read</th><th>Migrated</th><th>Skipped</th><th>Failed</th><th>Coerced</th><th>State</th></tr></thead>
          <tbody></tbody>
        </table></div>
        <div id="errorBox"></div>
      </div>
      <div class="foot">
        <button class="btn" data-back="7">Back to options</button>
        <div class="row">
          <button class="btn" id="btnDownloadErrors">Download error report (CSV)</button>
          <button class="btn primary" id="btnNewMigration">Start another migration</button>
        </div>
      </div>
    </section>
  </div>
</div>

<!-- ===================== Modals ===================== -->
<div class="modal" id="splitModal">
  <div class="box">
    <h3>Split full name into parts</h3>
    <div class="mbody">
      <p class="small muted" style="margin-top:0" id="snScope"></p>
      <div class="grid">
        <div>
          <label class="f" for="snSource">Source column holding the full name</label>
          <select id="snSource"></select>
        </div>
        <div>
          <label class="f" for="snOrder">Name order</label>
          <select id="snOrder">
            <option value="auto">Auto-detect</option>
            <option value="first_last">First Middle Last</option>
            <option value="last_first">Last, First Middle</option>
          </select>
        </div>
      </div>
      <div class="grid" style="margin-top:14px">
        <div><label class="f" for="snFirst">&rarr; First name column</label><select id="snFirst"></select></div>
        <div><label class="f" for="snMiddle">&rarr; Middle name column</label><select id="snMiddle"></select></div>
        <div><label class="f" for="snMiddleInit">&rarr; Middle initial column</label><select id="snMiddleInit"></select></div>
        <div><label class="f" for="snLast">&rarr; Last name column</label><select id="snLast"></select></div>
        <div><label class="f" for="snSuffix">&rarr; Suffix column</label><select id="snSuffix"></select></div>
      </div>
      <div style="margin-top:14px;display:grid;gap:8px">
        <label class="check"><input type="checkbox" id="snParticles" checked>
          <span>Keep surname particles together (<i>Dela Cruz</i>, <i>De Los Santos</i>, <i>van der Berg</i>)</span></label>
        <label class="check"><input type="checkbox" id="snSuffixes" checked><span>Detect suffixes (Jr., III, MD)</span></label>
        <label class="check"><input type="checkbox" id="snPrefixes" checked><span>Strip titles (Mr., Dr., Atty.)</span></label>
        <label class="check"><input type="checkbox" id="snDot" checked><span>Add a period after the middle initial</span></label>
      </div>
      <div class="row" style="margin-top:14px">
        <label class="f" style="margin:0" for="snCase">Output casing</label>
        <select id="snCase" style="width:auto"><option value="keep">Keep as-is</option><option value="title">Title Case</option><option value="upper">UPPERCASE</option></select>
        <button class="btn sm" id="btnSplitPreview">Preview split</button>
      </div>
      <div id="snMsg" style="margin-top:14px"></div>
      <div id="snPreview" style="margin-top:8px"></div>
    </div>
    <div class="mfoot">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="btnApplySplit">Apply mapping</button>
    </div>
  </div>
</div>

<div class="modal" id="profileModal">
  <div class="box">
    <h3>Saved mappings</h3>
    <div class="mbody">
      <p class="small muted" style="margin-top:0">A saved mapping keeps the table pairs, the column mapping, every
        transformation step, the name-split corrections and the name-parsing options — everything you built in steps 3
        to 5. Connection details and passwords are never saved, and neither are the destructive run options
        (<i>empty the table first</i>, <i>allow overwriting</i>, <i>turn off foreign key checks</i>); those are chosen
        again each run.</p>
      <div class="row">
        <input type="text" id="profName" placeholder="Name this mapping, e.g. “Legacy HR → XPAC staff”"
               autocomplete="off" style="flex:1;min-width:180px" maxlength="120">
        <button class="btn primary sm" id="btnProfSave">Save current mapping</button>
      </div>
      <div id="profMsg" style="margin-top:14px"></div>
      <div id="profList" style="margin-top:10px"></div>
    </div>
    <div class="mfoot">
      <button class="btn" data-close-modal>Close</button>
    </div>
  </div>
</div>

<div class="modal" id="confirmModal">
  <div class="box">
    <h3>Confirm migration</h3>
    <div class="mbody" id="confirmBody"></div>
    <div class="mfoot">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="btnConfirmRun">Start migration</button>
    </div>
  </div>
</div>

<script>
(function () {
  'use strict';

  const ENDPOINT = window.location.pathname;
  const STEP_NAMES = ['Source database','Destination database','Select tables','Map columns','Transform data','Preview','Migration','Results'];

  const state = {
    csrf: <?= json_encode($csrf) ?>,
    step: 1,
    maxStep: 1,
    drivers: [],
    pageStyles: {},
    batchSizes: [50, 100, 250, 500],
    batchDefault: 500,
    transforms: [],
    conn: { source: null, dest: null },
    tables: { source: [], dest: [] },
    enumerable: { source: true, dest: true },
    columns: { source: {}, dest: {} },   // table name -> column list
    rowCounts: { source: {}, dest: {} },
    pairs: [],                            // [{src,dst,mappings,nameOverrides,orderBy,mode,truncate,limit,offset}]
    active: 0,
    nameOptions: { order:'auto', particles:true, suffixes:true, prefixes:true, single_token:'first', case:'keep', initial_dot:true },
    job: null
  };

  // ---------- tiny DOM helpers ----------
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  function notice(container, kind, message) {
    const box = typeof container === 'string' ? $(container) : container;
    if (!box) return;
    box.innerHTML = '';
    if (!message) return;
    box.appendChild(el('div', { class: 'note ' + kind, text: message }));
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '';
      btn.appendChild(el('span', { class: 'spinner' }));
      btn.appendChild(document.createTextNode(' ' + (label || 'Working…')));
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || btn.textContent;
    }
  }

  const num = v => Number(v || 0).toLocaleString();

  async function api(action, payload, opts) {
    const res = await fetch(ENDPOINT + '?action=' + encodeURIComponent(action), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf },
      body: JSON.stringify(payload || {})
    });
    let data;
    try { data = await res.json(); }
    catch (e) { throw new Error('Server returned an unreadable response (HTTP ' + res.status + ').'); }

    if (!res.ok && !(opts && opts.raw)) throw new Error((data && data.error) || ('Request failed (HTTP ' + res.status + ').'));
    return data;
  }

  // ---------- stepper ----------
  function renderSteps() {
    const nav = $('#steps');
    nav.innerHTML = '';
    STEP_NAMES.forEach((name, i) => {
      const n = i + 1;
      const cls = 'step' + (n === state.step ? ' active' : '') + (n < state.step ? ' done' : '') + (n > state.maxStep ? ' locked' : '');
      nav.appendChild(el('div', {
        class: cls,
        onclick: () => { if (n <= state.maxStep) goStep(n); }
      }, [el('span', { class: 'n', text: String(n) }), document.createTextNode(name)]));
    });
  }

  function goStep(n) {
    state.step = n;
    state.maxStep = Math.max(state.maxStep, n);
    $$('.pane').forEach(p => p.classList.toggle('hide', Number(p.dataset.pane) !== n));
    renderSteps();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (n === 4) { renderPairNav('#mapNav', 4); renderMapTable(); }
    if (n === 5) { renderPairNav('#trNav', 5); renderTransforms(); }
    if (n === 6) { renderPairNav('#pvNav', 6); runPreview(); }
    if (n === 7) renderRunTable();
  }

  $$('[data-back]').forEach(b => b.addEventListener('click', () => goStep(Number(b.dataset.back))));
  $$('[data-go]').forEach(b => b.addEventListener('click', () => {
    const target = Number(b.dataset.go);
    if (target >= 5 && !validateJob()) return;
    goStep(target);
  }));
  $$('[data-close-modal]').forEach(b => b.addEventListener('click', () => {
    b.closest('.modal').classList.remove('open');
  }));

  // ---------- connection forms ----------
  function driver(key) { return state.drivers.find(d => d.key === key); }

  function connFields(role) {
    const p = role === 'source' ? 'src' : 'dst';
    const list = state.drivers.filter(d => role === 'dest' ? d.dest : true);
    const wrap = $('#' + p + 'Form');
    wrap.innerHTML = '';

    const field = (labelText, node, id) => el('div', { id: id || null }, [el('label', { class: 'f', text: labelText }), node]);

    const typeSel = el('select', { id: p + 'Type' });
    list.forEach(d => {
      typeSel.appendChild(el('option', {
        value: d.key,
        text: d.label + (d.available ? '' : '  — ' + d.extension + ' not installed'),
        disabled: d.available ? null : 'disabled'
      }));
    });
    wrap.appendChild(field('Database type', typeSel));

    wrap.appendChild(field('Host / IP address', el('input', { type: 'text', id: p + 'Host', value: '127.0.0.1', autocomplete: 'off' }), p + 'HostF'));
    wrap.appendChild(field('Port', el('input', { type: 'number', id: p + 'Port', value: 3306, min: 1, max: 65535 }), p + 'PortF'));
    wrap.appendChild(field('Database name', el('input', { type: 'text', id: p + 'Db', autocomplete: 'off' }), p + 'DbF'));
    wrap.appendChild(field('ODBC DSN or connection string',
      el('input', { type: 'text', id: p + 'Odbc', autocomplete: 'off', placeholder: 'DSN=mydsn   or   Driver={…};Server=…;Database=…' }), p + 'OdbcF'));
    wrap.appendChild(field('Username', el('input', { type: 'text', id: p + 'User', autocomplete: 'off' }), p + 'UserF'));
    wrap.appendChild(field('Password', el('input', { type: 'password', id: p + 'Pass', autocomplete: 'new-password' }), p + 'PassF'));
    wrap.appendChild(field('Character set', el('input', { type: 'text', id: p + 'Charset', autocomplete: 'off' }), p + 'CharsetF'));

    if (role === 'source') {
      const pageSel = el('select', { id: p + 'Page' });
      Object.keys(state.pageStyles).forEach(k => pageSel.appendChild(el('option', { value: k, text: state.pageStyles[k] })));
      wrap.appendChild(field('SQL paging style', pageSel, p + 'PageF'));
    }

    wrap.appendChild(el('div', { id: p + 'SslF' }, [
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', id: p + 'Ssl' }),
        el('span', { text: 'Use an encrypted (TLS/SSL) connection' })
      ]),
      el('div', { class: 'hide', id: p + 'SslExtra', style: 'margin-top:8px' }, [
        el('label', { class: 'f', text: 'CA certificate path on this server (optional)' }),
        el('input', { type: 'text', id: p + 'SslCa', autocomplete: 'off' }),
        el('label', { class: 'check', style: 'margin-top:8px' }, [
          el('input', { type: 'checkbox', id: p + 'SslVerify', checked: 'checked' }),
          el('span', { text: 'Verify the server certificate' })
        ])
      ])
    ]));

    wrap.appendChild(el('div', { id: p + 'Note', class: 'small muted', style: 'grid-column:1/-1' }));

    $('#' + p + 'Ssl').addEventListener('change', ev => {
      $('#' + p + 'SslExtra').classList.toggle('hide', !ev.target.checked);
    });
    typeSel.addEventListener('change', () => applyDriverForm(role));
    applyDriverForm(role);
  }

  function applyDriverForm(role) {
    const p = role === 'source' ? 'src' : 'dst';
    const d = driver($('#' + p + 'Type').value);
    if (!d) return;

    const show = (id, on) => { const n = $('#' + id); if (n) n.classList.toggle('hide', !on); };
    const server = d.form === 'server', file = d.form === 'file', odbc = d.form === 'odbc';

    show(p + 'HostF', server);
    show(p + 'PortF', server);
    show(p + 'OdbcF', odbc);
    show(p + 'UserF', server || odbc);
    show(p + 'PassF', server || odbc);
    show(p + 'CharsetF', !!d.charset);
    show(p + 'SslF', server && (d.key === 'mysql' || d.key === 'mariadb' || d.key === 'pgsql' || d.key === 'sqlsrv'));
    show(p + 'DbF', true);

    const dbLabel = $('#' + p + 'DbF').firstChild;
    if (dbLabel) {
      dbLabel.textContent = file ? 'Database file path on this server'
        : d.key === 'oci' ? 'Service name'
        : d.key === 'firebird' ? 'Database path or alias on the server'
        : odbc ? 'Catalog name (optional, narrows the table list)'
        : 'Database name';
    }

    const port = $('#' + p + 'Port'); if (port && d.port) port.value = d.port;
    const cs = $('#' + p + 'Charset'); if (cs && !cs.value) cs.value = d.charset || '';
    const note = $('#' + p + 'Note'); if (note) note.textContent = d.note || '';
  }

  function readConn(role) {
    const p = role === 'source' ? 'src' : 'dst';
    const v = id => { const n = $('#' + p + id); return n ? n.value : ''; };
    const c = id => { const n = $('#' + p + id); return n ? n.checked : false; };
    return {
      type: v('Type'), host: v('Host'), port: Number(v('Port')) || 0, db: v('Db'),
      odbc_dsn: v('Odbc'), user: v('User'), pass: v('Pass'), charset: v('Charset'),
      page: v('Page'), ssl: c('Ssl'), ssl_ca: v('SslCa'), ssl_verify: c('SslVerify')
    };
  }

  function clearPassword(role) {
    const node = $('#' + (role === 'source' ? 'src' : 'dst') + 'Pass');
    if (node) { node.value = ''; node.placeholder = '•••••••• (held in session)'; }
  }

  $$('[data-test]').forEach(btn => btn.addEventListener('click', async () => {
    const role = btn.dataset.test;
    const box  = role === 'source' ? '#srcMsg' : '#dstMsg';
    notice(box, '', '');
    busy(btn, true, 'Testing…');
    try {
      const r = await api('test_connection', { role: role, conn: readConn(role) }, { raw: true });
      if (r.ok) {
        let msg = 'Connected to ' + (r.server || 'the server') + ' in ' + r.ms + ' ms. ';
        msg += r.enumerable ? (r.tables + ' table(s) visible.') : 'This driver cannot list tables — you can still type table names in by hand.';
        notice(box, r.enumerable ? 'ok' : 'warn', msg);
      } else notice(box, 'err', r.error || 'Connection failed.');
    } catch (e) { notice(box, 'err', e.message); }
    busy(btn, false);
  }));

  $$('[data-connect]').forEach(btn => btn.addEventListener('click', async () => {
    const role = btn.dataset.connect;
    const box  = role === 'source' ? '#srcMsg' : '#dstMsg';
    notice(box, '', '');
    busy(btn, true, 'Connecting…');
    try {
      const r = await api('save_connection', { role: role, conn: readConn(role) }, { raw: true });
      if (!r.ok) { notice(box, 'err', r.error || 'Connection failed.'); busy(btn, false); return; }

      state.conn[role]       = r.conn;
      state.tables[role]     = r.tables || [];
      state.enumerable[role] = !!r.enumerable;
      state.columns[role]    = {};
      state.pairs            = [];
      clearPassword(role);
      renderTopActions();

      if (role === 'source') goStep(2);
      else { renderPicker(); renderPairs(); goStep(3); }
    } catch (e) { notice(box, 'err', e.message); }
    busy(btn, false);
  }));

  // ---------- step 3: table pairs ----------
  function normalise(n) { return String(n || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function bareName(n) { const s = String(n || ''); return s.includes('.') ? s.split('.').pop() : s; }

  function renderPicker() {
    const host = $('#srcPicker');
    const filter = normalise($('#srcSearch').value);
    host.innerHTML = '';

    const list = state.tables.source.filter(t => !filter || normalise(t).includes(filter));
    if (!list.length) {
      host.appendChild(el('div', { class: 'small muted', style: 'padding:10px',
        text: state.enumerable.source ? 'No tables match.' : 'This driver cannot list tables — type names in below.' }));
    }
    list.forEach(t => {
      const chk = el('input', { type: 'checkbox', value: t });
      if (state.pairs.some(p => p.src === t)) { chk.checked = true; chk.disabled = true; }
      host.appendChild(el('label', {}, [chk, el('span', { class: 'mono', text: t })]));
    });

    $('#manualHint').textContent = state.enumerable.source
      ? 'Use this for tables the list does not show.'
      : 'Required: this driver cannot enumerate tables.';
  }

  $('#srcSearch').addEventListener('input', renderPicker);

  function guessDest(srcTable) {
    const bare = bareName(srcTable);
    return state.tables.dest.find(t => t === bare)
        || state.tables.dest.find(t => normalise(t) === normalise(bare))
        || '';
  }

  function addPair(srcTable) {
    if (!srcTable || state.pairs.some(p => p.src === srcTable)) return false;
    state.pairs.push({
      src: srcTable, dst: guessDest(srcTable), mappings: [], nameOverrides: {},
      orderBy: '', mode: 'insert', truncate: false, limit: 0, offset: 0,
      // The pair of tables whose structure is currently loaded. While these
      // match src/dst the pair is left alone when structure is (re)read, so
      // tables configured earlier keep their mapping and transformations.
      loadedSrc: '', loadedDst: ''
    });
    return true;
  }

  /** A pair is configured once its structure has been read for these exact tables. */
  function isLoaded(p) {
    return p.loadedSrc === p.src && p.loadedDst === p.dst && p.mappings.length > 0;
  }

  /** Reorder two pairs, keeping the selected table selected. */
  function swapPairs(a, b) {
    if (b < 0 || b >= state.pairs.length) return;
    const keep = state.pairs[state.active];
    const t = state.pairs[a];
    state.pairs[a] = state.pairs[b];
    state.pairs[b] = t;
    const at = state.pairs.indexOf(keep);
    if (at >= 0) state.active = at;
    renderPairs();
  }

  function renderPairs() {
    const tbody = $('#pairTable tbody');
    tbody.innerHTML = '';
    $('#pairCount').textContent = state.pairs.length;

    if (!state.pairs.length) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan: '5', class: 'small muted', text: 'No tables added yet.' })]));
    }

    state.pairs.forEach((p, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'mono', text: p.src }));

      const sel = el('select', { onchange: ev => { p.dst = ev.target.value; renderPairs(); } });
      sel.appendChild(el('option', { value: '', text: '— choose destination —' }));
      state.tables.dest.forEach(t => {
        const o = el('option', { value: t, text: t });
        if (t === p.dst) o.selected = true;
        sel.appendChild(o);
      });
      if (!state.enumerable.dest) {
        const manual = el('input', { type: 'text', class: 'mono', value: p.dst, placeholder: 'destination table',
          oninput: ev => { p.dst = ev.target.value.trim(); } });
        tr.appendChild(el('td', {}, [manual]));
      } else {
        tr.appendChild(el('td', {}, [sel]));
      }

      const rows = state.rowCounts.source[p.src];
      tr.appendChild(el('td', { class: 'small muted', text: rows === undefined ? '—' : (rows < 0 ? 'unknown' : num(rows)) }));

      // Say plainly which tables are already set up, so it is obvious that
      // continuing only reads the structure of the ones just added.
      const done = isLoaded(p);
      tr.appendChild(el('td', {}, [
        el('span', {
          class: 'pill' + (done ? ' ok' : ''),
          text: done ? (mappedCount(p) + ' columns mapped') : (p.mappings.length ? 're-read on continue' : 'not set up yet')
        }),
        done ? el('button', {
          class: 'btn sm', style: 'margin-left:6px', text: 'Edit',
          title: 'Jump to the mapping for this table',
          onclick: () => { state.active = i; goStep(4); }
        }) : document.createTextNode('')
      ]));

      tr.appendChild(el('td', {}, [
        el('div', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' }, [
          el('button', { class: 'btn sm', text: '↑', title: 'Move up', onclick: () => swapPairs(i, i - 1) }),
          el('button', { class: 'btn sm', text: '↓', title: 'Move down', onclick: () => swapPairs(i, i + 1) }),
          el('button', { class: 'btn sm', text: '✕', title: 'Remove', onclick: () => {
            state.pairs.splice(i, 1);
            state.active = Math.max(0, Math.min(state.active, state.pairs.length - 1));
            renderPairs(); renderPicker();
          } })
        ])
      ]));

      tbody.appendChild(tr);
    });
  }

  $('#btnAddSelected').addEventListener('click', () => {
    let n = 0;
    $$('#srcPicker input[type=checkbox]:checked:not(:disabled)').forEach(c => { if (addPair(c.value)) n++; });
    renderPairs(); renderPicker();
    notice('#tblMsg', n ? 'ok' : 'warn', n ? ('Added ' + n + ' table(s).') : 'Nothing selected.');
  });

  $('#btnAddAll').addEventListener('click', () => {
    let n = 0;
    state.tables.source.forEach(t => { if (addPair(t)) n++; });
    renderPairs(); renderPicker();
    notice('#tblMsg', n ? 'ok' : 'warn', n ? ('Added ' + n + ' table(s).') : 'Every table is already in the job.');
  });

  $('#btnAddManual').addEventListener('click', () => {
    const name = $('#manualTable').value.trim();
    if (!name) return;
    if (addPair(name)) { $('#manualTable').value = ''; renderPairs(); renderPicker(); notice('#tblMsg', '', ''); }
    else notice('#tblMsg', 'warn', 'That table is already in the job.');
  });

  $('#btnClearPairs').addEventListener('click', () => {
    state.pairs = [];
    renderPairs(); renderPicker();
  });

  $('#btnAutoMatch').addEventListener('click', () => {
    let n = 0;
    state.pairs.forEach(p => { if (!p.dst) { const g = guessDest(p.src); if (g) { p.dst = g; n++; } } });
    renderPairs();
    notice('#tblMsg', n ? 'ok' : 'warn', n ? ('Matched ' + n + ' destination table(s) by name.') : 'No further tables matched by name.');
  });

  $('#btnLoadColumns').addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    notice('#tblMsg', '', '');

    if (!state.pairs.length) { notice('#tblMsg', 'err', 'Add at least one source table.'); return; }
    const missing = state.pairs.filter(p => !p.dst);
    if (missing.length) { notice('#tblMsg', 'err', 'Choose a destination table for: ' + missing.map(p => p.src).join(', ')); return; }

    // Read structure only for pairs that are new, or whose source/destination
    // was changed since it was last read. Everything already configured is left
    // untouched, so a table added later never costs you the earlier mapping.
    const pending = state.pairs.filter(p => !isLoaded(p));
    if (!pending.length) {
      state.active = Math.min(state.active, state.pairs.length - 1);
      goStep(4);
      return;
    }

    busy(btn, true, 'Reading structure…');
    try {
      const [s, d] = await Promise.all([
        api('columns_bulk', { role: 'source', tables: pending.map(p => p.src) }),
        api('columns_bulk', { role: 'dest',   tables: pending.map(p => p.dst) })
      ]);

      const problems = [];
      const fresh = [];
      pending.forEach(p => {
        const sr = s.results[p.src], dr = d.results[p.dst];
        if (!sr || !sr.ok) { problems.push(p.src + ': ' + ((sr && sr.error) || 'could not be read')); return; }
        if (!dr || !dr.ok) { problems.push(p.dst + ': ' + ((dr && dr.error) || 'could not be read')); return; }

        p.src = sr.table; p.dst = dr.table;
        state.columns.source[p.src] = sr.columns;
        state.columns.dest[p.dst]   = dr.columns;
        state.rowCounts.source[p.src] = sr.rowCount;
        state.rowCounts.dest[p.dst]   = dr.rowCount;

        p.mappings = dr.columns.map(c => ({ dest: c.name, source: '', skip: !!c.auto, transforms: [] }));
        p.nameOverrides = {};
        const pk = sr.columns.find(c => c.pk);
        p.orderBy = pk ? pk.name : '';
        p.loadedSrc = p.src;
        p.loadedDst = p.dst;

        autoMapPair(p);   // only the new pair; the others keep what they have
        fresh.push(p);
      });

      renderPairs();
      if (problems.length) { notice('#tblMsg', 'err', problems.slice(0, 4).join('  ·  ')); busy(btn, false); return; }

      // Open the first table that was just added rather than jumping back to
      // the one already finished.
      state.active = fresh.length ? state.pairs.indexOf(fresh[0]) : 0;
      notice('#mapMsg', 'ok', fresh.length === state.pairs.length
        ? ('Structure read for ' + fresh.length + ' table(s).')
        : ('Added ' + fresh.length + ' table(s). The ' + (state.pairs.length - fresh.length) + ' already set up were left as they were.'));
      goStep(4);
    } catch (e) { notice('#tblMsg', 'err', e.message); }
    busy(btn, false);
  });

  $('#btnAddMore').addEventListener('click', () => {
    notice('#tblMsg', '', '');
    renderPicker();
    renderPairs();
    goStep(3);
  });

  // ---------- pair navigation shared by steps 4-6 ----------
  function pair() { return state.pairs[state.active] || null; }
  function srcCols() { const p = pair(); return (p && state.columns.source[p.src]) || []; }
  function dstCols() { const p = pair(); return (p && state.columns.dest[p.dst]) || []; }

  function mappedCount(p) {
    return p.mappings.filter(m => !m.skip && (m.source || m.transforms.some(t => t.type === 'static' || t.type === 'now'))).length;
  }

  function renderPairNav(sel, step) {
    const host = $(sel);
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'ph', text: state.pairs.length + ' table' + (state.pairs.length === 1 ? '' : 's') + ' in this job' }));

    state.pairs.forEach((p, i) => {
      const n = mappedCount(p);
      host.appendChild(el('div', {
        class: 'pi' + (i === state.active ? ' on' : ''),
        onclick: () => {
          state.active = i;
          renderPairNav(sel, step);
          if (step === 4) renderMapTable();
          if (step === 5) renderTransforms();
          if (step === 6) runPreview();
        }
      }, [
        el('div', { class: 'nm' }, [
          el('b', { text: p.src }),
          el('span', { text: '→ ' + p.dst })
        ]),
        el('span', { class: 'tag' + (n ? '' : ' '), text: n ? (n + ' cols') : 'none' })
      ]));
    });
  }

  // ---------- step 4: column mapping ----------
  function sourceType(name) {
    const c = srcCols().find(x => x.name === name);
    return c ? (c.native || c.type) : '';
  }
  function destMeta(name) { return dstCols().find(x => x.name === name) || {}; }

  function renderMapTable() {
    const tbody = $('#mapTable tbody');
    const p = pair();
    tbody.innerHTML = '';
    if (!p) return;

    p.mappings.forEach(m => {
      const dc = destMeta(m.dest);
      const tr = el('tr', { class: m.skip ? 'skipped' : '' });

      tr.appendChild(el('td', {}, [
        el('div', { class: 'mono', text: m.dest }),
        el('div', { class: 'type', text: [dc.pk ? 'PK' : '', dc.auto ? 'auto' : '', dc.nullable ? 'nullable' : 'NOT NULL'].filter(Boolean).join(' · ') })
      ]));
      tr.appendChild(el('td', { class: 'type', text: dc.native || dc.type || '' }));

      const sel = el('select', { onchange: ev => { m.source = ev.target.value; renderMapTable(); } });
      sel.appendChild(el('option', { value: '', text: '— not mapped —' }));
      srcCols().forEach(c => {
        const o = el('option', { value: c.name, text: c.name });
        if (c.name === m.source) o.selected = true;
        sel.appendChild(o);
      });
      sel.disabled = m.skip;
      tr.appendChild(el('td', {}, [sel]));

      const constant = m.transforms.some(t => t.type === 'static' || t.type === 'now');
      tr.appendChild(el('td', { class: 'type', text: m.source ? sourceType(m.source) : (constant ? 'fixed value' : '—') }));

      const chk = el('input', { type: 'checkbox', onchange: ev => { m.skip = ev.target.checked; renderMapTable(); } });
      chk.checked = !!m.skip;
      tr.appendChild(el('td', {}, [el('label', { class: 'check' }, [chk, el('span', { class: 'small', text: 'Skip' })])]));

      tbody.appendChild(tr);
    });

    renderSourceReference();
    const rows = state.rowCounts.source[p.src];
    $('#mapSummary').textContent = p.src + ' → ' + p.dst + '  ·  ' + mappedCount(p) + ' of ' + p.mappings.length +
      ' destination columns mapped  ·  ' + (rows === undefined || rows < 0 ? 'unknown' : num(rows)) + ' source rows';
    renderPairNav('#mapNav', 4);
  }

  function renderSourceReference() {
    const tbody = $('#srcColsTable tbody');
    const p = pair();
    tbody.innerHTML = '';
    if (!p) return;

    srcCols().forEach(c => {
      const uses = p.mappings.filter(m => !m.skip && m.source === c.name).map(m => m.dest);
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'mono', text: c.name }),
        el('td', { class: 'type', text: c.native || c.type }),
        el('td', { class: 'small', text: c.nullable ? 'yes' : 'no' }),
        el('td', { class: 'small', text: uses.length ? uses.join(', ') : '— unused —' })
      ]));
    });
  }

  function autoMapPair(p) {
    const cols = state.columns.source[p.src] || [];
    let hits = 0;
    p.mappings.forEach(m => {
      if (m.skip || m.source) return;
      const target = normalise(m.dest);
      const exact = cols.find(c => c.name === m.dest) || cols.find(c => normalise(c.name) === target);
      if (exact) { m.source = exact.name; hits++; }
    });
    return hits;
  }

  function autoMapAll(quiet) {
    let hits = 0;
    state.pairs.forEach(p => { hits += autoMapPair(p); });
    if (!quiet) {
      renderMapTable();
      notice('#mapMsg', hits ? 'ok' : 'warn', hits ? ('Matched ' + hits + ' column(s) across ' + state.pairs.length + ' table(s).') : 'No further columns matched by name.');
    }
    return hits;
  }

  $('#btnAutoMap').addEventListener('click', () => {
    const p = pair(); if (!p) return;
    const hits = autoMapPair(p);
    renderMapTable();
    notice('#mapMsg', hits ? 'ok' : 'warn', hits ? ('Matched ' + hits + ' column(s) by name.') : 'No further columns matched by name.');
  });
  $('#btnAutoMapAll').addEventListener('click', () => autoMapAll(false));

  $('#btnClearMap').addEventListener('click', () => {
    const p = pair(); if (!p) return;
    p.mappings = (state.columns.dest[p.dst] || []).map(c => ({ dest: c.name, source: '', skip: !!c.auto, transforms: [] }));
    p.nameOverrides = {};
    renderMapTable();
    notice('#mapMsg', '', '');
  });

  function validateJob() {
    const problems = [];
    let firstBad = -1;
    state.pairs.forEach((p, i) => {
      const before = problems.length;
      const label = p.src + ' → ' + p.dst;
      if (!p.mappings.length) {
        problems.push(label + ': structure not read yet — go back and press "Load structure & continue"');
      } else if (!mappedCount(p)) {
        problems.push(label + ': nothing mapped');
      } else {
        p.mappings.filter(m => !m.skip).forEach(m => {
          if (!m.source && !m.transforms.some(t => t.type === 'static' || t.type === 'now')) {
            problems.push(label + ': "' + m.dest + '" has no source');
          }
        });
      }
      if (firstBad < 0 && problems.length > before) firstBad = i;
    });

    if (problems.length) {
      // Open the table the complaint is about, not whichever one was last viewed.
      if (firstBad >= 0) state.active = firstBad;
      notice('#mapMsg', 'err', problems.slice(0, 4).join('  ·  ') + (problems.length > 4 ? '  · …' : ''));
      goStep(4);
      return false;
    }
    notice('#mapMsg', '', '');
    return true;
  }

  // ---------- full-name split modal ----------
  $('#btnSplitName').addEventListener('click', () => {
    const p = pair(); if (!p) return;
    $('#snScope').textContent = 'Applies to ' + p.src + ' → ' + p.dst + '.';

    const cols = srcCols();
    const textLike = cols.filter(c => /char|text|string|varying|clob|name/i.test(c.native || c.type));
    const candidates = textLike.length ? textLike : cols;

    const src = $('#snSource');
    src.innerHTML = '';
    candidates.forEach(c => src.appendChild(el('option', { value: c.name, text: c.name + '  (' + (c.native || c.type) + ')' })));
    const guess = candidates.find(c => /(full.?name|complete.?name|pangalan|^name$)/i.test(c.name)) || candidates.find(c => /name/i.test(c.name));
    if (guess) src.value = guess.name;

    [['snFirst', /(first.?name|fname|given)/i], ['snMiddle', /(middle.?name|mname)/i],
     ['snMiddleInit', /(middle.?initial|^mi$|m_i)/i], ['snLast', /(last.?name|lname|surname|family)/i],
     ['snSuffix', /(suffix|ext(ension)?.?name)/i]].forEach(([id, re]) => {
      const sel = $('#' + id);
      sel.innerHTML = '';
      sel.appendChild(el('option', { value: '', text: '— none —' }));
      dstCols().forEach(c => sel.appendChild(el('option', { value: c.name, text: c.name })));
      const hit = dstCols().find(c => re.test(c.name));
      sel.value = hit ? hit.name : '';
    });

    notice('#snMsg', '', '');
    $('#snPreview').innerHTML = '';
    $('#splitModal').classList.add('open');
  });

  function splitOptions() {
    return {
      order: $('#snOrder').value,
      particles: $('#snParticles').checked,
      suffixes: $('#snSuffixes').checked,
      prefixes: $('#snPrefixes').checked,
      initial_dot: $('#snDot').checked,
      case: $('#snCase').value,
      single_token: 'first'
    };
  }

  $('#btnSplitPreview').addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    const p = pair(); if (!p) return;
    notice('#snMsg', '', '');
    busy(btn, true, 'Loading…');
    try {
      const r = await api('split_preview', { table: p.src, column: $('#snSource').value, options: splitOptions(), limit: 10 });
      const table = el('table');
      table.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Full name' }), el('th', { text: 'First' }), el('th', { text: 'Middle' }),
        el('th', { text: 'M.I.' }), el('th', { text: 'Last' }), el('th', { text: 'Suffix' }), el('th', { text: 'Notes' })
      ])]));
      const tb = el('tbody');
      r.rows.forEach(row => {
        const q = row.parts;
        tb.appendChild(el('tr', {}, [
          el('td', { class: 'mono', text: row.raw || '(empty)' }),
          el('td', { text: q.first }), el('td', { text: q.middle }), el('td', { text: q.middle_initial }),
          el('td', { text: q.last }), el('td', { text: q.suffix }),
          el('td', { class: 'small muted', text: (q.warnings || []).join('; ') })
        ]));
      });
      table.appendChild(tb);
      $('#snPreview').innerHTML = '';
      $('#snPreview').appendChild(el('div', { class: 'tbl-wrap' }, [table]));
      $('#snPreview').appendChild(el('p', { class: 'small muted', text: 'Values can still be corrected row-by-row in the Preview step.' }));
    } catch (e) { notice('#snMsg', 'err', e.message); }
    busy(btn, false);
  });

  $('#btnApplySplit').addEventListener('click', () => {
    const p = pair(); if (!p) return;
    const source = $('#snSource').value;
    const pairsToApply = [['snFirst', 'first'], ['snMiddle', 'middle'], ['snMiddleInit', 'middle_initial'], ['snLast', 'last'], ['snSuffix', 'suffix']];
    let applied = 0;

    pairsToApply.forEach(([id, part]) => {
      const destName = $('#' + id).value;
      if (!destName) return;
      const m = p.mappings.find(x => x.dest === destName);
      if (!m) return;
      m.skip = false;
      m.source = source;
      m.transforms = [{ type: 'name_part', params: { part: part } }];
      applied++;
    });

    if (!applied) { notice('#snMsg', 'err', 'Choose at least one destination column.'); return; }

    state.nameOptions = Object.assign({}, state.nameOptions, splitOptions());
    p.nameOverrides = {};
    $('#splitModal').classList.remove('open');
    renderMapTable();
    notice('#mapMsg', 'ok', 'Full-name split applied to ' + applied + ' column(s). Check the Preview step before migrating.');
  });

  // ---------- step 5: transforms ----------
  function transformMeta(id) { return state.transforms.find(t => t.id === id); }

  function renderTransforms() {
    const host = $('#trList');
    const p = pair();
    host.innerHTML = '';
    if (!p) return;

    host.appendChild(el('div', { class: 'small muted', style: 'margin-bottom:6px',
      text: p.src + ' → ' + p.dst }));

    const active = p.mappings.filter(m => !m.skip);
    if (!active.length) { host.appendChild(el('p', { class: 'muted', text: 'No mapped columns.' })); return; }

    active.forEach(m => {
      const card = el('div', { class: 'card', style: 'box-shadow:none;margin-top:12px' });
      card.appendChild(el('div', { style: 'padding:12px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
        el('div', {}, [
          el('span', { class: 'mono', text: m.source || '(fixed value)' }),
          el('span', { class: 'muted', text: '  →  ' }),
          el('span', { class: 'mono', text: m.dest }),
          el('span', { class: 'type', text: '   ' + (m.source ? sourceType(m.source) : '') + ' → ' + (destMeta(m.dest).native || '') })
        ]),
        el('button', { class: 'btn sm', text: '+ Add step', onclick: () => { m.transforms.push({ type: 'trim', params: {} }); renderTransforms(); } })
      ]));

      const body = el('div', { style: 'padding:12px 16px' });
      if (!m.transforms.length) {
        body.appendChild(el('p', { class: 'small muted', style: 'margin:0', text: 'Copied without changes.' }));
      }

      m.transforms.forEach((step, i) => {
        const row = el('div', { style: 'display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;padding:8px 0;border-bottom:1px dashed var(--line)' });

        const sel = el('select', { style: 'width:210px', onchange: ev => { step.type = ev.target.value; step.params = {}; renderTransforms(); } });
        state.transforms.forEach(t => {
          const o = el('option', { value: t.id, text: t.label });
          if (t.id === step.type) o.selected = true;
          sel.appendChild(o);
        });
        row.appendChild(sel);

        const meta = transformMeta(step.type);
        (meta ? meta.params : []).forEach(prm => {
          const wrap = el('div', { style: 'min-width:170px;flex:1' });
          wrap.appendChild(el('label', { class: 'f', text: prm.label }));
          let input;
          if (prm.type === 'select') {
            input = el('select', { onchange: ev => { step.params[prm.key] = ev.target.value; } });
            if (!step.params[prm.key]) step.params[prm.key] = Object.keys(prm.options)[0];
            Object.keys(prm.options).forEach(k => {
              const o = el('option', { value: k, text: prm.options[k] });
              if (step.params[prm.key] === k) o.selected = true;
              input.appendChild(o);
            });
          } else if (prm.type === 'textarea') {
            input = el('textarea', { oninput: ev => { step.params[prm.key] = ev.target.value; } });
            input.value = step.params[prm.key] || '';
          } else {
            input = el('input', { type: prm.type === 'number' ? 'number' : 'text', oninput: ev => { step.params[prm.key] = ev.target.value; } });
            if (step.params[prm.key] === undefined && prm.default !== undefined) step.params[prm.key] = prm.default;
            input.value = step.params[prm.key] || '';
          }
          wrap.appendChild(input);
          row.appendChild(wrap);
        });

        row.appendChild(el('button', {
          class: 'btn sm', text: 'Remove', style: 'align-self:center',
          onclick: () => { m.transforms.splice(i, 1); renderTransforms(); }
        }));
        body.appendChild(row);
      });

      card.appendChild(body);
      host.appendChild(card);
    });

    renderNameOptions();
    renderPairNav('#trNav', 5);
  }

  function renderNameOptions() {
    const grid = $('#nameOptsGrid');
    grid.innerHTML = '';
    const usesNames = state.pairs.some(p => p.mappings.some(m => !m.skip && m.transforms.some(t => t.type === 'name_part')));
    $('#nameOptsBox').classList.toggle('hide', !usesNames);
    if (!usesNames) return;

    const clearOverrides = () => state.pairs.forEach(p => { p.nameOverrides = {}; });

    const selField = (label, key, options) => {
      const wrap = el('div', {});
      wrap.appendChild(el('label', { class: 'f', text: label }));
      const sel = el('select', { onchange: ev => { state.nameOptions[key] = ev.target.value; clearOverrides(); } });
      Object.keys(options).forEach(k => {
        const o = el('option', { value: k, text: options[k] });
        if (state.nameOptions[key] === k) o.selected = true;
        sel.appendChild(o);
      });
      wrap.appendChild(sel);
      return wrap;
    };
    const boolField = (label, key) => {
      const chk = el('input', { type: 'checkbox', onchange: ev => { state.nameOptions[key] = ev.target.checked; clearOverrides(); } });
      chk.checked = !!state.nameOptions[key];
      return el('div', {}, [el('label', { class: 'check' }, [chk, el('span', { text: label })])]);
    };

    grid.appendChild(selField('Name order', 'order', { auto: 'Auto-detect', first_last: 'First Middle Last', last_first: 'Last, First Middle' }));
    grid.appendChild(selField('Output casing', 'case', { keep: 'Keep as-is', title: 'Title Case', upper: 'UPPERCASE' }));
    grid.appendChild(selField('Single-word names go to', 'single_token', { first: 'First name', last: 'Last name' }));
    grid.appendChild(boolField('Keep surname particles together', 'particles'));
    grid.appendChild(boolField('Detect suffixes (Jr., III)', 'suffixes'));
    grid.appendChild(boolField('Strip titles (Mr., Dr.)', 'prefixes'));
    grid.appendChild(boolField('Period after middle initial', 'initial_dot'));
  }

  // ---------- job payload ----------
  function jobPayload(extra) {
    return Object.assign({
      tables: state.pairs.map(p => ({
        sourceTable: p.src,
        destTable: p.dst,
        mappings: p.mappings.map(m => ({ dest: m.dest, source: m.source, skip: m.skip, transforms: m.transforms })),
        nameOverrides: p.nameOverrides,
        orderBy: p.orderBy,
        mode: p.mode,
        truncate: p.truncate,
        limit: Number(p.limit) || 0,
        offset: Number(p.offset) || 0
      })),
      nameOptions: state.nameOptions,
      batchSize: Number($('#batchSize').value) || state.batchDefault,
      allowOverwrite: $('#allowOverwrite').checked,
      stopOnError: $('#stopOnError').checked,
      disableFk: $('#disableFk').checked
    }, extra || {});
  }

  // ---------- saved mappings ----------
  // Everything built in steps 3-5 can be stored under a name and replayed later.
  // On load the saved names are re-resolved against the live schema, so a column
  // that has since been renamed or dropped is reported instead of failing later.
  let profiles = [];
  let profileId = '';     // the entry currently loaded/saved, for "Update"

  function openProfiles() {
    notice('#profMsg', '', '');
    $('#profileModal').classList.add('open');
    refreshProfiles();
  }

  async function refreshProfiles(list) {
    if (list) { profiles = list; renderProfiles(); return; }
    try {
      const r = await api('mappings', {});
      profiles = r.mappings || [];
    } catch (e) { notice('#profMsg', 'err', e.message); profiles = []; }
    renderProfiles();
  }

  function whenText(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function renderProfiles() {
    const host = $('#profList');
    host.innerHTML = '';
    if (!profiles.length) {
      host.appendChild(el('p', { class: 'muted small', style: 'margin:0', text: 'Nothing saved yet.' }));
      return;
    }

    const table = el('table');
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Name' }), el('th', { style: 'width:15%', text: 'Scope' }),
      el('th', { style: 'width:22%', text: 'Saved' }), el('th', { style: 'width:26%', text: '' })
    ])]));

    const tb = el('tbody');
    profiles.forEach(pr => {
      const where = [pr.source, pr.dest].filter(Boolean).join('  →  ');
      tb.appendChild(el('tr', {}, [
        el('td', {}, [
          el('div', { style: 'font-weight:600' }, [
            document.createTextNode(pr.name),
            pr.id === profileId ? el('span', { class: 'pill ok', style: 'margin-left:6px', text: 'open' })
                                : document.createTextNode('')
          ]),
          el('div', { class: 'small muted', text: where || '—' })
        ]),
        el('td', { class: 'small', text: pr.tables + ' table' + (pr.tables === 1 ? '' : 's') + ', ' + pr.columns + ' cols' }),
        el('td', { class: 'small muted', text: whenText(pr.savedAt) }),
        el('td', {}, [el('div', { class: 'row', style: 'gap:5px;flex-wrap:nowrap' }, [
          el('button', { class: 'btn sm primary', text: 'Load', onclick: ev => loadProfile(pr, ev.currentTarget) }),
          el('button', {
            class: 'btn sm', text: 'Update', title: 'Overwrite this entry with the mapping open right now',
            onclick: ev => saveProfile(pr.id, pr.name, ev.currentTarget)
          }),
          el('button', {
            class: 'btn sm danger', text: 'Delete',
            onclick: async ev => {
              if (!confirm('Delete the saved mapping “' + pr.name + '”? This cannot be undone.')) return;
              busy(ev.currentTarget, true, '…');
              try {
                const r = await api('mapping_delete', { id: pr.id });
                if (profileId === pr.id) profileId = '';
                notice('#profMsg', 'ok', 'Deleted “' + pr.name + '”.');
                refreshProfiles(r.mappings || []);
              } catch (e) { notice('#profMsg', 'err', e.message); busy(ev.currentTarget, false); }
            }
          })
        ])])
      ]));
    });
    table.appendChild(tb);
    host.appendChild(el('div', { class: 'tbl-wrap', style: 'max-height:36vh' }, [table]));
  }

  async function saveProfile(id, name, btn) {
    notice('#profMsg', '', '');
    if (!state.pairs.length) { notice('#profMsg', 'err', 'There is no mapping open to save.'); return; }

    busy(btn, true, 'Saving…');
    try {
      const r = await api('mapping_save', jobPayload({ id: id || '', name: name }));
      profileId = r.id;
      $('#profName').value = name;
      notice('#profMsg', 'ok', 'Saved “' + name + '” — ' + state.pairs.length + ' table(s).');
      refreshProfiles(r.mappings || []);
    } catch (e) { notice('#profMsg', 'err', e.message); }
    busy(btn, false);
  }

  $('#btnProfiles').addEventListener('click', openProfiles);
  $('#btnProfiles3').addEventListener('click', openProfiles);

  $('#btnProfSave').addEventListener('click', ev => {
    const name = $('#profName').value.trim();
    if (!name) { notice('#profMsg', 'err', 'Give the mapping a name first.'); return; }

    // Same name as an existing entry means update it rather than pile up copies.
    const existing = profiles.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing && !confirm('“' + name + '” already exists. Overwrite it?')) return;
    saveProfile(existing ? existing.id : '', name, ev.currentTarget);
  });

  $('#profName').addEventListener('keydown', ev => { if (ev.key === 'Enter') $('#btnProfSave').click(); });

  async function loadProfile(entry, btn) {
    notice('#profMsg', '', '');
    if (!state.conn.source || !state.conn.dest) {
      notice('#profMsg', 'err', 'Connect the source and destination databases first.');
      return;
    }
    if (state.pairs.length && !confirm('Replace the mapping currently open with “' + entry.name + '”?')) return;

    busy(btn, true, 'Loading…');
    try {
      const doc = (await api('mapping_load', { id: entry.id })).mapping;
      const notes = await applyProfile(doc);

      profileId = doc.id;
      $('#profName').value = doc.name || '';
      $('#profileModal').classList.remove('open');

      const head = 'Loaded “' + (doc.name || 'mapping') + '” — ' + state.pairs.length + ' table(s).';
      if (notes.length) {
        notice('#mapMsg', 'warn', head + '  ' + notes.length + ' item(s) did not line up with the current databases: ' +
          notes.slice(0, 3).join('  ·  ') + (notes.length > 3 ? '  · …' : '') + '  Check the mapping before migrating.');
      } else {
        notice('#mapMsg', 'ok', head + ' Everything matched the current schema.');
      }
      goStep(4);
    } catch (e) { notice('#profMsg', 'err', e.message); }
    busy(btn, false);
  }

  /**
   * Rebuild state.pairs from a saved document, resolving every stored table and
   * column name against the live schema. Returns the list of things that no
   * longer exist so the operator sees exactly what was dropped.
   */
  async function applyProfile(doc) {
    const wanted = Array.isArray(doc.tables) ? doc.tables : [];
    if (!wanted.length) throw new Error('That saved mapping is empty.');

    const [s, d] = await Promise.all([
      api('columns_bulk', { role: 'source', tables: wanted.map(t => t.sourceTable) }),
      api('columns_bulk', { role: 'dest',   tables: wanted.map(t => t.destTable) })
    ]);

    const notes = [];
    const pairs = [];
    const overwriteOn = $('#allowOverwrite').checked;

    wanted.forEach(t => {
      const sr = s.results[t.sourceTable], dr = d.results[t.destTable];
      if (!sr || !sr.ok) { notes.push(t.sourceTable + ' is not in the source database'); return; }
      if (!dr || !dr.ok) { notes.push(t.destTable + ' is not in the destination database'); return; }

      state.columns.source[sr.table] = sr.columns;
      state.columns.dest[dr.table]   = dr.columns;
      state.rowCounts.source[sr.table] = sr.rowCount;
      state.rowCounts.dest[dr.table]   = dr.rowCount;

      const find = (cols, name) => cols.find(c => c.name.toLowerCase() === String(name || '').toLowerCase());

      const saved = {};
      (t.mappings || []).forEach(m => { saved[String(m.dest).toLowerCase()] = m; });

      // Start from the destination's real columns, then lay the saved mapping on top.
      const mappings = dr.columns.map(c => {
        const was = saved[c.name.toLowerCase()];
        if (!was) return { dest: c.name, source: '', skip: !!c.auto, transforms: [] };

        let source = '';
        if (was.source) {
          const hit = find(sr.columns, was.source);
          if (hit) source = hit.name;
          else notes.push(sr.table + '.' + was.source + ' is gone (' + c.name + ' left unmapped)');
        }
        return {
          dest: c.name,
          source: source,
          skip: !!was.skip,
          transforms: Array.isArray(was.transforms) ? was.transforms : []
        };
      });

      (t.mappings || []).forEach(m => {
        if (!find(dr.columns, m.dest)) notes.push(dr.table + '.' + m.dest + ' is gone (mapping dropped)');
      });

      const order = t.orderBy ? find(sr.columns, t.orderBy) : null;
      if (t.orderBy && !order) notes.push(sr.table + ': read-order column ' + t.orderBy + ' is gone');

      pairs.push({
        src: sr.table,
        dst: dr.table,
        mappings: mappings,
        nameOverrides: (t.nameOverrides && typeof t.nameOverrides === 'object') ? t.nameOverrides : {},
        orderBy: order ? order.name : '',
        // "Update duplicates" rewrites existing rows, so it only comes back
        // when overwriting is switched on for this run.
        mode: (t.mode === 'update_duplicates' && !overwriteOn) ? 'insert' : (t.mode || 'insert'),
        truncate: false,
        limit: Number(t.limit) || 0,
        offset: Number(t.offset) || 0,
        loadedSrc: sr.table,
        loadedDst: dr.table
      });
    });

    if (!pairs.length) throw new Error('None of those tables exist in the databases you are connected to.');

    state.pairs = pairs;
    state.active = 0;
    if (doc.nameOptions) state.nameOptions = Object.assign({}, state.nameOptions, doc.nameOptions);
    if (doc.batchSize && state.batchSizes.includes(Number(doc.batchSize))) $('#batchSize').value = String(doc.batchSize);
    if (typeof doc.stopOnError === 'boolean') $('#stopOnError').checked = doc.stopOnError;

    state.maxStep = Math.max(state.maxStep, 4);
    renderPicker();
    renderPairs();
    renderBatchChoices();

    return notes;
  }

  // ---------- step 6: preview ----------
  async function runPreview() {
    notice('#pvMsg', '', '');
    const host = $('#previewOut');
    const p = pair();
    if (!p) return;

    host.innerHTML = '<p class="muted small">Loading preview…</p>';
    try {
      const r = await api('preview', jobPayload({
        tableIndex: state.active,
        previewRows: Number($('#previewRows').value) || 10
      }));

      renderSummary(r.summary);
      const mine = r.summary[state.active] || {};
      $('#previewInfo').textContent = p.src + ' → ' + p.dst + '  ·  ' +
        (mine.rows >= 0 ? num(mine.rows) + ' row(s) queued' : 'row count unavailable');

      host.innerHTML = '';
      if (!r.rows.length) { host.appendChild(el('p', { class: 'muted', text: 'The source query returned no rows.' })); return; }

      const warnAll = {};
      r.rows.forEach(row => (row.warnings || []).forEach(w => { warnAll[w] = (warnAll[w] || 0) + 1; }));
      const warnKeys = Object.keys(warnAll);
      if (warnKeys.length) {
        notice('#pvMsg', 'warn', 'Name parsing notes in this sample: ' + warnKeys.map(w => w + ' (' + warnAll[w] + ')').join(', ') +
          '. Edit any cell below to override it for that exact value.');
      }

      const table = el('table');
      const headRow = el('tr');
      headRow.appendChild(el('th', { text: '#' }));
      r.destColumns.forEach(c => {
        const m = p.mappings.find(x => x.dest === c);
        headRow.appendChild(el('th', {}, [
          el('div', { class: 'mono', text: c }),
          el('div', { class: 'type', text: (m && m.source) ? ('from ' + m.source + ' · ' + (r.srcTypes[m.source] || '')) : 'fixed' })
        ]));
      });
      table.appendChild(el('thead', {}, [headRow]));

      const tb = el('tbody');
      r.rows.forEach((row, i) => {
        const tr = el('tr');
        tr.appendChild(el('td', { class: 'small muted', text: String(i + 1) }));
        r.destColumns.forEach(c => {
          const v = row.transformed[c];
          const nameCell = row.nameCells && row.nameCells[c];
          const td = el('td');
          if (nameCell) {
            const input = el('input', {
              type: 'text', class: 'mono', style: 'min-width:130px',
              oninput: ev => {
                p.nameOverrides[nameCell.key] = p.nameOverrides[nameCell.key] || {};
                p.nameOverrides[nameCell.key][nameCell.part] = ev.target.value;
              }
            });
            input.value = v === null || v === undefined ? '' : String(v);
            input.title = 'Source: ' + nameCell.raw;
            td.appendChild(input);
          } else if (v === null || v === undefined) {
            td.appendChild(el('span', { class: 'pill', text: 'NULL' }));
          } else {
            td.appendChild(el('span', { class: 'mono', text: String(v) }));
          }
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      host.appendChild(el('div', { class: 'tbl-wrap' }, [table]));
      host.appendChild(el('p', { class: 'small muted', style: 'margin-top:10px',
        text: 'Editable cells are name-split results. An edit applies to every row of this table whose original value is identical.' }));
    } catch (e) {
      host.innerHTML = '';
      notice('#pvMsg', 'err', e.message);
    }
  }

  function renderSummary(summary) {
    const host = $('#summaryOut');
    host.innerHTML = '';
    if (!summary) return;

    const table = el('table');
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: '#' }), el('th', { text: 'Source' }), el('th', { text: 'Destination' }),
      el('th', { text: 'Columns' }), el('th', { text: 'Rows' }), el('th', { text: 'Duplicates' }), el('th', { text: 'Read order' })
    ])]));
    const tb = el('tbody');
    summary.forEach(s => {
      tb.appendChild(el('tr', { class: s.index === state.active ? '' : '' }, [
        el('td', { class: 'small muted', text: String(s.index + 1) }),
        el('td', { class: 'mono', text: s.source }),
        el('td', { class: 'mono', text: s.dest + (s.truncate ? '  (emptied first)' : '') }),
        el('td', { class: 'small', text: String(s.columns) }),
        el('td', { class: 'small', text: s.rows >= 0 ? num(s.rows) : 'unknown' }),
        el('td', { class: 'small', text: s.mode.replace('_', ' ') }),
        el('td', { class: 'small' + (s.orderBy ? '' : ' muted'), text: s.orderBy ? (s.orderBy + (s.orderPk ? ' (PK)' : '')) : 'server default' })
      ]));
    });
    table.appendChild(tb);
    host.appendChild(el('div', { class: 'tbl-wrap' }, [table]));
  }

  $('#btnPreview').addEventListener('click', runPreview);

  // ---------- step 7: per-table options + run ----------
  function renderBatchChoices() {
    const sel = $('#batchSize');
    if (!sel) return;
    const current = Number(sel.value) || state.batchDefault;
    sel.innerHTML = '';
    state.batchSizes.forEach(n => {
      const o = el('option', { value: String(n), text: num(n) + ' rows per batch' });
      if (n === current) o.selected = true;
      sel.appendChild(o);
    });
    if (!state.batchSizes.includes(current)) sel.value = String(state.batchDefault);
    sel.onchange = renderBatchHint;
    renderBatchHint();
  }

  // Make the choice concrete: say how many round trips it works out to.
  function renderBatchHint() {
    const hint = $('#batchHint');
    if (!hint) return;
    const size = Number($('#batchSize').value) || state.batchDefault;

    let batches = 0, rows = 0, unknown = false;
    state.pairs.forEach(p => {
      let n = state.rowCounts.source[p.src];
      if (n === undefined || n < 0) { unknown = true; return; }
      if (p.limit > 0) n = Math.min(n, p.limit);
      n = Math.max(0, n - (p.offset || 0));
      rows += n;
      batches += Math.ceil(n / size);
    });

    if (!state.pairs.length) { hint.textContent = ''; return; }
    hint.textContent = unknown
      ? 'Smaller batches mean more round trips but less memory per step.'
      : num(rows) + ' row(s) across ' + state.pairs.length + ' table(s) — about ' + num(batches) +
        ' batch' + (batches === 1 ? '' : 'es') + ' of up to ' + num(size) + '.';
  }

  function renderRunTable() {
    renderBatchChoices();
    const tbody = $('#runTable tbody');
    tbody.innerHTML = '';

    state.pairs.forEach(p => {
      const cols = state.columns.source[p.src] || [];
      const tr = el('tr');

      tr.appendChild(el('td', {}, [
        el('div', { class: 'mono', text: p.src }),
        el('div', { class: 'type', text: '→ ' + p.dst })
      ]));

      const mode = el('select', { onchange: ev => {
        if (ev.target.value === 'update_duplicates' && !$('#allowOverwrite').checked) {
          notice('#runMsg', 'warn', 'Updating duplicates modifies existing rows — tick "Allow overwriting destination data" first.');
          ev.target.value = p.mode;
          return;
        }
        p.mode = ev.target.value;
      } });
      [['insert', 'Insert only'], ['skip_duplicates', 'Skip duplicates (INSERT IGNORE)'], ['update_duplicates', 'Update duplicates']].forEach(([v, t]) => {
        const o = el('option', { value: v, text: t });
        if (p.mode === v) o.selected = true;
        mode.appendChild(o);
      });
      tr.appendChild(el('td', {}, [mode]));

      const order = el('select', { onchange: ev => { p.orderBy = ev.target.value; } });
      order.appendChild(el('option', { value: '', text: 'server default' }));
      cols.forEach(c => {
        const o = el('option', { value: c.name, text: c.name + (c.pk ? ' (PK)' : '') });
        if (c.name === p.orderBy) o.selected = true;
        order.appendChild(o);
      });
      tr.appendChild(el('td', {}, [order]));

      const lim = el('input', { type: 'number', min: 0, value: p.limit, style: 'width:80px', oninput: ev => { p.limit = Number(ev.target.value) || 0; renderBatchHint(); } });
      tr.appendChild(el('td', {}, [lim]));

      const off = el('input', { type: 'number', min: 0, value: p.offset, style: 'width:80px', oninput: ev => { p.offset = Number(ev.target.value) || 0; renderBatchHint(); } });
      tr.appendChild(el('td', {}, [off]));

      const trunc = el('input', { type: 'checkbox', onchange: ev => {
        if (ev.target.checked && !$('#allowOverwrite').checked) {
          notice('#runMsg', 'warn', 'Emptying a table needs "Allow overwriting destination data" first.');
          ev.target.checked = false;
          return;
        }
        p.truncate = ev.target.checked;
      } });
      trunc.checked = !!p.truncate;
      trunc.disabled = !$('#allowOverwrite').checked;
      tr.appendChild(el('td', {}, [el('label', { class: 'check' }, [trunc, el('span', { class: 'small', text: 'Empty' })])]));

      tbody.appendChild(tr);
    });

    const noPk = state.pairs.filter(p => !(state.columns.source[p.src] || []).some(c => c.pk) && !p.orderBy);
    if (noPk.length) {
      notice('#runMsg', 'warn', 'No primary key on: ' + noPk.map(p => p.src).join(', ') +
        '. Choose a stable read order so batching stays consistent.');
    }
  }

  $('#allowOverwrite').addEventListener('change', ev => {
    const on = ev.target.checked;
    $('#disableFk').disabled = !on;
    if (!on) {
      $('#disableFk').checked = false;
      state.pairs.forEach(p => {
        p.truncate = false;
        if (p.mode === 'update_duplicates') p.mode = 'insert';
      });
    }
    renderRunTable();
  });

  $('#btnStart').addEventListener('click', () => {
    if (!validateJob()) return;

    const body = $('#confirmBody');
    body.innerHTML = '';

    const line = (k, v) => el('div', { style: 'display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--line)' }, [
      el('div', { class: 'small muted', style: 'width:180px', text: k }), el('div', { class: 'small', text: v })
    ]);

    const totalRows = state.pairs.reduce((a, p) => {
      const n = state.rowCounts.source[p.src];
      return a + (n > 0 ? n : 0);
    }, 0);

    body.appendChild(line('Source', (state.conn.source ? state.conn.source.label + ' · ' + state.conn.source.db : '')));
    body.appendChild(line('Destination', (state.conn.dest ? state.conn.dest.label + ' · ' + state.conn.dest.db : '')));
    body.appendChild(line('Tables', state.pairs.length + ' pair(s)'));
    body.appendChild(line('Rows to read', '~' + num(totalRows)));

    const toClear = state.pairs.filter(p => p.truncate);
    const toUpdate = state.pairs.filter(p => p.mode === 'update_duplicates');

    const list = el('div', { class: 'tbl-wrap', style: 'margin-top:12px;max-height:30vh' });
    const t = el('table');
    t.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: '#' }), el('th', { text: 'Source' }), el('th', { text: 'Destination' }), el('th', { text: 'Existing rows' }), el('th', { text: 'Action' })])]));
    const tb = el('tbody');
    state.pairs.forEach((p, i) => {
      const before = state.rowCounts.dest[p.dst];
      tb.appendChild(el('tr', {}, [
        el('td', { class: 'small muted', text: String(i + 1) }),
        el('td', { class: 'mono', text: p.src }),
        el('td', { class: 'mono', text: p.dst }),
        el('td', { class: 'small', text: before === undefined || before < 0 ? 'unknown' : num(before) }),
        el('td', { class: 'small', text: p.truncate ? 'EMPTY then insert' : (p.mode === 'update_duplicates' ? 'insert / update' : (p.mode === 'skip_duplicates' ? 'insert, skip duplicates' : 'insert only')) })
      ]));
    });
    t.appendChild(tb);
    list.appendChild(t);
    body.appendChild(list);

    if (toClear.length) {
      body.appendChild(el('div', { class: 'note err', style: 'margin-top:14px',
        text: toClear.length + ' destination table(s) will be EMPTIED first. Those existing rows are deleted permanently.' }));
      body.appendChild(el('label', { class: 'f', text: 'Type OVERWRITE to confirm' }));
      body.appendChild(el('input', { type: 'text', id: 'confirmWord', autocomplete: 'off' }));
    } else if (toUpdate.length) {
      body.appendChild(el('div', { class: 'note warn', style: 'margin-top:14px',
        text: 'Rows that collide on a primary or unique key will be UPDATED in ' + toUpdate.length + ' table(s).' }));
    } else {
      body.appendChild(el('div', { class: 'note info', style: 'margin-top:14px',
        text: 'Existing destination rows will not be modified. New rows are appended.' }));
    }
    if ($('#disableFk').checked) {
      body.appendChild(el('div', { class: 'note warn', style: 'margin-top:10px',
        text: 'Foreign key checks will be off for this run — inserted rows are not validated against their parents.' }));
    }

    $('#confirmModal').classList.add('open');
  });

  $('#btnConfirmRun').addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    const confirmNode = $('#confirmWord');
    busy(btn, true, 'Starting…');
    try {
      const p = await api('migrate_start', jobPayload({ confirm: confirmNode ? confirmNode.value : '' }));
      $('#confirmModal').classList.remove('open');
      state.job = { id: p.jobId };

      notice('#runMsg', 'info', 'Migrating ' + num(p.totals.total) + ' row(s) across ' + p.tableCount + ' table(s)…');
      $('#progressBox').classList.remove('hide');
      $('#btnCancel').classList.remove('hide');
      $('#btnStart').disabled = true;
      paint(p);

      await pump();
    } catch (e) {
      notice('#runMsg', 'err', e.message);
      $('#confirmModal').classList.remove('open');
    }
    busy(btn, false);
  });

  function renderStats(host, totals) {
    host.innerHTML = '';
    const stat = (label, value, cls) => el('div', { class: 'stat' }, [
      el('b', { text: num(value), style: cls ? 'color:var(--' + cls + ')' : '' }),
      el('span', { text: label })
    ]);
    host.appendChild(stat('Processed', totals.processed));
    host.appendChild(stat('Migrated', totals.inserted, 'ok'));
    host.appendChild(stat('Skipped', totals.skipped, 'warn'));
    host.appendChild(stat('Failed', totals.failed, 'err'));
    host.appendChild(stat('Coerced', totals.warnings, 'warn'));
    host.appendChild(stat('Total', totals.total));
  }

  function paint(p) {
    const t = p.totals;
    const pct = t.total > 0 ? Math.min(100, Math.round(t.processed / t.total * 100)) : (p.done ? 100 : 0);
    $('#progressBar').style.width = pct + '%';
    $('#progressText').textContent = num(t.processed) + ' / ' + num(t.total) + ' rows (' + pct + '%)  ·  table ' +
      Math.min(p.current + 1, p.tableCount) + ' of ' + p.tableCount;
    $('#progressRate').textContent = p.rate + ' rows/s · ' + p.elapsed + 's elapsed';
    renderStats($('#liveStats'), t);

    const tbody = $('#liveTable tbody');
    tbody.innerHTML = '';
    p.tables.forEach(row => {
      const pc = row.total > 0 ? Math.min(100, Math.round(row.processed / row.total * 100)) : (row.state === 'done' ? 100 : 0);
      const bar = el('div', { class: 'minibar' }, [el('i')]);
      bar.firstChild.style.width = pc + '%';
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'mono small', text: row.src + ' → ' + row.dst }),
        el('td', {}, [bar, el('span', { class: 'small muted', text: num(row.processed) + ' / ' + (row.total < 0 ? '?' : num(row.total)) })]),
        el('td', { class: 'small', text: num(row.inserted) }),
        el('td', { class: 'small', text: num(row.skipped) }),
        el('td', { class: 'small', text: num(row.failed) }),
        el('td', { class: 'small', text: num(row.warnings) }),
        el('td', {}, [el('span', { class: 'pill' + (row.state === 'done' ? ' ok' : (row.state === 'running' ? ' warn' : '')), text: row.state })])
      ]));
    });
  }

  async function pump() {
    let last = null;
    try {
      while (true) {
        const p = await api('migrate_step', { jobId: state.job.id });
        last = p;
        paint(p);
        if (p.done || p.cancelled) break;
      }
    } catch (e) {
      notice('#runMsg', 'err', e.message);
    }
    $('#btnCancel').classList.add('hide');
    $('#btnStart').disabled = false;
    if (last) showResults(last);
  }

  $('#btnCancel').addEventListener('click', async () => {
    try { await api('migrate_cancel', {}); notice('#runMsg', 'warn', 'Cancelling after the current batch…'); }
    catch (e) { notice('#runMsg', 'err', e.message); }
  });

  // ---------- step 8: results ----------
  function showResults(p) {
    renderStats($('#resultStats'), p.totals);

    let kind = 'ok', msg = 'Migration complete.';
    if (p.cancelled) { kind = 'warn'; msg = 'Migration cancelled after ' + num(p.totals.processed) + ' row(s).'; }
    else if (p.stopped) { kind = 'warn'; msg = 'Migration stopped at the first failed batch.'; }
    else if (p.totals.failed > 0) { kind = 'warn'; msg = 'Migration finished with ' + num(p.totals.failed) + ' failed record(s).'; }
    msg += '  ' + p.tableCount + ' table(s) in ' + p.elapsed + 's.';
    if (p.totals.warnings > 0) {
      kind = kind === 'ok' ? 'warn' : kind;
      msg += '  The server raised ' + num(p.totals.warnings) + ' warning(s): some values were shortened or ' +
             'converted to fit the destination column instead of being rejected. Spot-check those columns.';
    }
    notice('#resultMsg', kind, msg);

    const tbody = $('#resultTable tbody');
    tbody.innerHTML = '';
    p.tables.forEach(row => {
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'mono small', text: row.src }),
        el('td', { class: 'mono small', text: row.dst }),
        el('td', { class: 'small', text: num(row.processed) }),
        el('td', { class: 'small', text: num(row.inserted) }),
        el('td', { class: 'small', text: num(row.skipped) }),
        el('td', { class: 'small', text: num(row.failed) }),
        el('td', { class: 'small', text: num(row.warnings) }),
        el('td', {}, [el('span', { class: 'pill' + (row.state === 'done' ? ' ok' : ''), text: row.state })])
      ]));
    });

    const box = $('#errorBox');
    box.innerHTML = '';
    if (p.errors && p.errors.length) {
      box.appendChild(el('h3', { style: 'font-size:14px;margin:18px 0 8px',
        text: 'Failed records (' + p.errors.length + (p.totals.failed > p.errors.length ? ' of ' + p.totals.failed + ' shown' : '') + ')' }));
      const table = el('table');
      table.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', { style: 'width:18%', text: 'Table' }), el('th', { style: 'width:70px', text: 'Row' }),
        el('th', { style: 'width:34%', text: 'Error' }), el('th', { text: 'Data' })
      ])]));
      const tb = el('tbody');
      p.errors.forEach(e => {
        tb.appendChild(el('tr', {}, [
          el('td', { class: 'small mono', text: e.srcTable || '' }),
          el('td', { class: 'small mono', text: String(e.row) }),
          el('td', { class: 'small', text: e.error }),
          el('td', { class: 'small mono', text: JSON.stringify(e.data) })
        ]));
      });
      table.appendChild(tb);
      box.appendChild(el('div', { class: 'tbl-wrap' }, [table]));
    } else {
      box.appendChild(el('p', { class: 'muted small', style: 'margin-top:16px', text: 'No failed records.' }));
    }
    $('#btnDownloadErrors').classList.toggle('hide', !p.hasErrorFile);

    goStep(8);
  }

  $('#btnDownloadErrors').addEventListener('click', () => {
    const form = el('form', { method: 'POST', action: ENDPOINT + '?action=errors_csv', target: '_blank' });
    form.appendChild(el('input', { type: 'hidden', name: 'csrf', value: state.csrf }));
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  });

  $('#btnNewMigration').addEventListener('click', () => {
    state.job = null;
    state.pairs.forEach(p => { p.nameOverrides = {}; });
    $('#progressBox').classList.add('hide');
    $('#progressBar').style.width = '0%';
    notice('#runMsg', '', '');
    renderPicker();
    goStep(3);
  });

  // ---------- top bar ----------
  function renderTopActions() {
    const host = $('#topActions');
    host.innerHTML = '';

    if (state.conn.source) host.appendChild(el('span', { class: 'pill ok', text: 'Source: ' + state.conn.source.label + ' / ' + state.conn.source.db }));
    if (state.conn.dest)   host.appendChild(el('span', { class: 'pill ok', text: 'Dest: ' + state.conn.dest.db }));

    host.appendChild(el('button', {
      class: 'btn sm', text: 'Clear connections',
      onclick: async () => {
        if (!confirm('Forget both stored connections and the current migration state?')) return;
        await api('reset', {});
        state.conn = { source: null, dest: null };
        state.tables = { source: [], dest: [] };
        state.columns = { source: {}, dest: {} };
        state.pairs = [];
        state.maxStep = 1;
        renderTopActions();
        goStep(1);
      }
    }));
    host.appendChild(el('button', {
      class: 'btn sm', text: 'End session',
      onclick: async () => {
        if (!confirm('End this session and discard everything held in it?')) return;
        await api('end_session', {});
        window.location.reload();
      }
    }));
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const r = await api('bootstrap', {});
      state.drivers = r.drivers;
      state.pageStyles = r.pageStyles;
      state.batchSizes = r.batchSizes || state.batchSizes;
      state.batchDefault = r.batchDefault || state.batchDefault;
      renderBatchChoices();
      state.transforms = r.transforms;
      state.conn.source = r.source;
      state.conn.dest = r.dest;

      connFields('source');
      connFields('dest');
      const dstType = $('#dstType');
      if (dstType) { dstType.value = 'mysql'; applyDriverForm('dest'); }

      // No banner for unavailable drivers: the type dropdown already shows each
      // one as "— pdo_x not installed" and disables it, which says the same
      // thing at the moment it matters.

      renderTopActions();

      if (state.conn.source && state.conn.dest) {
        const [s, d] = await Promise.all([api('tables', { role: 'source' }), api('tables', { role: 'dest' })]);
        state.tables.source = s.tables || [];  state.enumerable.source = !!s.enumerable;
        state.tables.dest   = d.tables || [];  state.enumerable.dest   = !!d.enumerable;
        renderPicker();
        renderPairs();
        state.maxStep = 3;
        goStep(3);
        return;
      }
      if (state.conn.source) { state.maxStep = 2; goStep(2); return; }
      goStep(1);
    } catch (e) {
      notice('#globalMsg', 'err', e.message);
      goStep(1);
    }
  }

  renderSteps();
  boot();
})();

</script>
</body>
</html>
