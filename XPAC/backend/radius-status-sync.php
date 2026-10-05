<?php
/**
 * RADIUS Status Sync (standalone entry point)
 *
 * Kept only so a crontab or a habit that still runs `php radius-status-sync.php` keeps
 * working. It used to carry its own copy of the sync, talking to the first radius_config
 * row over the RouterOS REST API (`/rest/user-manage/...`, RouterOS v7 only). That copy
 * knew nothing of the second server, and when the REST call failed it wrote every
 * account to online_status as "Not Found".
 *
 * It now runs the same command the scheduler runs, so there is one sync, over the native
 * RouterOS API. The command has no run lock of its own (the scheduler's
 * withoutOverlapping() only guards scheduled runs), so do not schedule this alongside it.
 *
 * Usage: php radius-status-sync.php
 * Logs:  storage/logs/radiussync/radiussync.log
 */

define('LARAVEL_START', microtime(true));

require __DIR__.'/vendor/autoload.php';

$app = require_once __DIR__.'/bootstrap/app.php';

$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);

$status = $kernel->handle(
    $input = new Symfony\Component\Console\Input\ArrayInput([
        'command' => 'cron:sync-radius-status'
    ]),
    new Symfony\Component\Console\Output\ConsoleOutput
);

$kernel->terminate($input, $status);

exit($status);
