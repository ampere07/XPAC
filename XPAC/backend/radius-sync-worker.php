<?php
/**
 * RADIUS Status Sync Worker
 * 
 * Standalone worker for syncing RADIUS user status and session data
 * Runs independently via cron without requiring Laravel Artisan
 * 
 * Cron: * * * * * cd /home/atsscbms/web/backend.atssfiber.ph/public_html && /usr/bin/php artisan cron:sync-radius-status
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
