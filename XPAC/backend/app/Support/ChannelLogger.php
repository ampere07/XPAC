<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;
use Psr\Log\LoggerInterface;

/**
 * Builds dedicated per-subsystem log channels that are NOT subject to the global
 * LOG_LEVEL.
 *
 * Why this exists: this deployment runs LOG_LEVEL=error, so every Log::warning()
 * and Log::info() written to the default `stack` channel is discarded. That is a
 * reasonable choice for application noise, but it also silently swallowed the
 * diagnostics that matter most for unattended work — report calculation
 * validation warnings, and "the attachment was missing so the email went out
 * without it". Those are exactly the signals an operator needs after the fact.
 *
 * Channels created here declare level=debug explicitly, so they record
 * regardless of LOG_LEVEL, and write to storage/logs/<name>/<name>.log.
 *
 * Instances are memoised per name so a hot loop does not rebuild the handler.
 */
class ChannelLogger
{
    /** @var array<string, LoggerInterface> */
    private static array $channels = [];

    public static function for(string $name): LoggerInterface
    {
        if (isset(self::$channels[$name])) {
            return self::$channels[$name];
        }

        $directory = storage_path('logs/' . $name);
        if (!is_dir($directory)) {
            @mkdir($directory, 0775, true);
        }

        try {
            $logger = Log::build([
                'driver' => 'single',
                'path'   => $directory . DIRECTORY_SEPARATOR . $name . '.log',
                'level'  => 'debug',
            ]);
        } catch (\Throwable $e) {
            // Never let logging be the thing that breaks the job.
            $logger = Log::channel();
        }

        return self::$channels[$name] = $logger;
    }

    /** Drop memoised channels (test helper). */
    public static function flush(): void
    {
        self::$channels = [];
    }
}
