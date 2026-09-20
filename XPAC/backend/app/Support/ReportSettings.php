<?php

namespace App\Support;

use App\Models\SystemConfig;

/**
 * Global reporting switches, persisted in system_config so they survive a
 * restart and are visible to both the API and the cron process.
 *
 * These are deliberately separate from Report::$is_active, which enables or
 * disables one report. This is the master switch for the whole automatic
 * pipeline.
 */
class ReportSettings
{
    /** system_config.config_key holding the automatic-send master switch. */
    public const AUTO_SEND_KEY = 'reports_auto_send_enabled';

    /**
     * May the cron send scheduled reports?
     *
     * Absent (or blank) means enabled: deployments upgrading to this switch
     * were already sending automatically, and introducing the setting must not
     * silently stop them.
     */
    public static function autoSendEnabled(): bool
    {
        $value = SystemConfig::where('config_key', self::AUTO_SEND_KEY)->value('config_value');

        if ($value === null || $value === '') {
            return true;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    public static function setAutoSendEnabled(bool $enabled, string $updatedBy): void
    {
        SystemConfig::updateOrCreate(
            ['config_key' => self::AUTO_SEND_KEY],
            [
                'config_value' => $enabled ? '1' : '0',
                // system_config.updated_by is NOT NULL with no default.
                'updated_by'   => $updatedBy !== '' ? $updatedBy : 'system',
            ]
        );
    }
}
