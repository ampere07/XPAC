<?php

namespace App\Support;

/**
 * The batching rules for the RADIUS status sync.
 *
 * RadiusStatusSyncService asks this class how much work a single batch may
 * carry rather than deciding for itself, so the sync can be retuned in
 * configuration — or per run, with `cron:sync-radius-status --batch=` — without
 * touching the processing logic. Mirrors RadiusRetryPolicy, which does the same
 * job for the RADIUS operation queue.
 *
 * Every accessor clamps what it reads: a missing, zero or nonsensical setting
 * falls back to the default instead of collapsing the sync into single-row
 * batches or a batch large enough to defeat the point of batching.
 */
class RadiusStatusSyncPolicy
{
    /** Fallbacks used when configuration is missing or unusable. */
    private const DEFAULT_BATCH_SIZE      = 500;
    private const DEFAULT_SEED_BATCH_SIZE = 2000;
    private const DEFAULT_CONNECT_TIMEOUT = 3;
    private const DEFAULT_REQUEST_TIMEOUT = 15;

    /**
     * An upper bound on any batch, whatever the configuration or the caller
     * asks for. Past this the batch stops being a batch: memory, lock time and
     * the cost of replaying a failed batch all grow with it.
     */
    private const MAX_BATCH_SIZE = 10000;

    /**
     * Accounts applied to online_status per batch.
     *
     * @param  int|null  $override  A per-run size (the --batch option); ignored when null or <= 0.
     */
    public static function batchSize(?int $override = null): int
    {
        if ($override !== null && $override > 0) {
            return min($override, self::MAX_BATCH_SIZE);
        }

        $configured = (int) config('radius.status_sync.batch_size', self::DEFAULT_BATCH_SIZE);

        return $configured > 0
            ? min($configured, self::MAX_BATCH_SIZE)
            : self::DEFAULT_BATCH_SIZE;
    }

    /**
     * Rows per statement while seeding online_status with accounts that have no row yet.
     */
    public static function seedBatchSize(): int
    {
        $configured = (int) config('radius.status_sync.seed_batch_size', self::DEFAULT_SEED_BATCH_SIZE);

        return $configured > 0
            ? min($configured, self::MAX_BATCH_SIZE)
            : self::DEFAULT_SEED_BATCH_SIZE;
    }

    /**
     * Pause between batches, converted to the microseconds usleep() wants.
     * Zero means no pause.
     */
    public static function batchPauseMicroseconds(): int
    {
        $milliseconds = (int) config('radius.status_sync.batch_pause_ms', 0);

        return $milliseconds > 0 ? $milliseconds * 1000 : 0;
    }

    /**
     * Should a row whose synced columns are already correct be left alone?
     */
    public static function skipsUnchanged(): bool
    {
        return (bool) config('radius.status_sync.skip_unchanged', true);
    }

    /**
     * Minutes the merged RADIUS user list may be reused before it is re-fetched.
     * Zero means fetch it on every run.
     */
    public static function userCacheMinutes(): int
    {
        $configured = (int) config('radius.status_sync.user_cache_minutes', 0);

        return $configured > 0 ? $configured : 0;
    }

    /** Does this run reuse a cached user list at all? */
    public static function cachesUserList(): bool
    {
        return self::userCacheMinutes() > 0;
    }

    /** Connection timeout, in seconds, for a User Manager request. */
    public static function connectTimeout(): int
    {
        $configured = (int) config('radius.status_sync.connect_timeout', self::DEFAULT_CONNECT_TIMEOUT);

        return $configured > 0 ? $configured : self::DEFAULT_CONNECT_TIMEOUT;
    }

    /** Response timeout, in seconds, for a User Manager request. */
    public static function requestTimeout(): int
    {
        $configured = (int) config('radius.status_sync.request_timeout', self::DEFAULT_REQUEST_TIMEOUT);

        return $configured > 0 ? $configured : self::DEFAULT_REQUEST_TIMEOUT;
    }
}
