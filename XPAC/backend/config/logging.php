<?php

use Monolog\Handler\NullHandler;
use Monolog\Handler\StreamHandler;
use Monolog\Handler\SyslogUdpHandler;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Log Channel
    |--------------------------------------------------------------------------
    |
    | This option defines the default log channel that gets used when writing
    | messages to the logs. The name specified in this option should match
    | one of the channels defined in the "channels" configuration array.
    |
    */

    'default' => env('LOG_CHANNEL', 'stack'),

    /*
    |--------------------------------------------------------------------------
    | Deprecations Log Channel
    |--------------------------------------------------------------------------
    |
    | This option controls the log channel that should be used to log warnings
    | regarding deprecated PHP and library features. This allows you to get
    | your application ready for upcoming major versions of dependencies.
    |
    */

    'deprecations' => [
        'channel' => env('LOG_DEPRECATIONS_CHANNEL', 'null'),
        'trace' => false,
    ],

    /*
    |--------------------------------------------------------------------------
    | Log Channels
    |--------------------------------------------------------------------------
    |
    | Here you may configure the log channels for your application. Out of
    | the box, Laravel uses the Monolog PHP logging library. This gives
    | you a variety of powerful log handlers / formatters to utilize.
    |
    | Available Drivers: "single", "daily", "slack", "syslog",
    |                    "errorlog", "monolog",
    |                    "custom", "stack"
    |
    */

    'channels' => [
        'stack' => [
            'driver' => 'stack',
            'channels' => ['single'],
            'ignore_exceptions' => false,
        ],

        'single' => [
            'driver' => 'single',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'debug'),
        ],

        /*
        | What went wrong on the customer's device.
        |
        | The dashboard's balance card fails in the browser, where nothing on
        | this server can see it — the request the customer's phone could not
        | complete never arrives to be logged. A fault nobody can reproduce is
        | then invisible: the endpoint answers correctly for everyone who tries
        | it, and the customer is left looking at "Balance unavailable".
        |
        | Kept in its own file rather than laravel.log so it can be read on its
        | own, and rotated because it is written by clients rather than by us.
        */
        'client' => [
            'driver' => 'daily',
            'path' => storage_path('logs/customer-dashboard.log'),
            'level' => 'debug',
            'days' => 14,
        ],

        'daily' => [
            'driver' => 'daily',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'days' => 14,
        ],

        'slack' => [
            'driver' => 'slack',
            'url' => env('LOG_SLACK_WEBHOOK_URL'),
            'username' => 'Laravel Log',
            'emoji' => ':boom:',
            'level' => env('LOG_LEVEL', 'critical'),
        ],

        'papertrail' => [
            'driver' => 'monolog',
            'level' => env('LOG_LEVEL', 'debug'),
            'handler' => env('LOG_PAPERTRAIL_HANDLER', SyslogUdpHandler::class),
            'handler_with' => [
                'host' => env('PAPERTRAIL_URL'),
                'port' => env('PAPERTRAIL_PORT'),
                'connectionString' => 'tls://'.env('PAPERTRAIL_URL').':'.env('PAPERTRAIL_PORT'),
            ],
        ],

        'stderr' => [
            'driver' => 'monolog',
            'level' => env('LOG_LEVEL', 'debug'),
            'handler' => StreamHandler::class,
            'formatter' => env('LOG_STDERR_FORMATTER'),
            'with' => [
                'stream' => 'php://stderr',
            ],
        ],

        'syslog' => [
            'driver' => 'syslog',
            'level' => env('LOG_LEVEL', 'debug'),
        ],

        'errorlog' => [
            'driver' => 'errorlog',
            'level' => env('LOG_LEVEL', 'debug'),
        ],

        'null' => [
            'driver' => 'monolog',
            'handler' => NullHandler::class,
        ],

        'emergency' => [
            'path' => storage_path('logs/laravel.log'),
        ],

        'billing' => [
            'driver' => 'daily',
            'path' => storage_path('logs/billinggeneration.log'),
            /*
             * Explicit, not LOG_LEVEL.
             *
             * Its only writer is EnhancedBillingGenerationServiceWithNotifications, which
             * now decides for itself what is worth recording (App\Support\CronLog) and
             * drops the narration before it ever reaches here. Leaving this on LOG_LEVEL
             * — `error` in this deployment — would additionally discard the per-run
             * account summaries, which are not errors and are the whole point of the
             * change.
             */
            'level' => 'debug',
            'days' => 30,
        ],

        'payment' => [
            'driver' => 'daily',
            'path' => storage_path('logs/payment.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'days' => 30,
        ],

        'email' => [
            'driver' => 'daily',
            'path' => storage_path('logs/email.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'days' => 30,
        ],

        'overdue' => [
            'driver' => 'single',
            'path' => storage_path('logs/overdue.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'replace_placeholders' => true,
        ],

        'radiussync' => [
            'driver' => 'daily',
            'path' => storage_path('logs/radiussync/radiussync.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'days' => 30,
        ],

        'disconnection' => [
            'driver' => 'single',
            'path' => storage_path('logs/disconnectionnotice.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'replace_placeholders' => true,
        ],

        'billingreconcile' => [
            'driver' => 'single',
            'path' => storage_path('logs/billingreconcile.log'),
            'level' => env('LOG_LEVEL', 'debug'),
        ],

        'radiusrelated' => [
            'driver' => 'single',
            'path' => storage_path('logs/radiusrelated.log'),
            'level' => env('LOG_LEVEL', 'debug'),
        ],

        'smartoltrelated' => [
            'driver' => 'single',
            'path' => storage_path('logs/smartoltrelated.log'),
            'level' => env('LOG_LEVEL', 'debug'),
        ],

        'prorategeneration' => [
            'driver' => 'single',
            'path' => storage_path('logs/prorategeneration.log'),
            'level' => env('LOG_LEVEL', 'debug'),
        ],

        'sofailingauto' => [
            'driver' => 'single',
            'path' => storage_path('logs/sofailingauto.log'),
            'level' => env('LOG_LEVEL', 'debug'),
        ],
    ],

];


