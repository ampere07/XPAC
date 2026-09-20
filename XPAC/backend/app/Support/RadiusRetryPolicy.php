<?php

namespace App\Support;

use Carbon\Carbon;

/**
 * The retry rules for the RADIUS operation queue.
 *
 * All of the arithmetic behind "when is this job tried again, and is it allowed
 * another go at all" lives here, reading config/radius.php. The queue service
 * asks this class rather than computing delays itself, so the schedule can be
 * retuned in configuration without touching the processing logic.
 *
 * Attempt numbering used throughout: attempt 1 is the first try. A job with
 * `attempts = 3` has already been tried three times, so its next try is
 * attempt 4.
 */
class RadiusRetryPolicy
{
    /** Fallback used when configuration is missing or unusable. */
    private const DEFAULT_MAX_ATTEMPTS = 10;
    private const DEFAULT_DELAYS       = [15, 25, 35, 45, 55, 65, 75, 85, 95];

    /**
     * Total attempts allowed for one job, including the first.
     */
    public static function maxAttempts(): int
    {
        $configured = (int) config('radius.queue.max_attempts', self::DEFAULT_MAX_ATTEMPTS);

        return $configured > 0 ? $configured : self::DEFAULT_MAX_ATTEMPTS;
    }

    /**
     * The progressive delay schedule, in minutes.
     *
     * @return int[]
     */
    public static function delays(): array
    {
        $configured = config('radius.queue.retry_delays', self::DEFAULT_DELAYS);

        if (!is_array($configured) || $configured === []) {
            return self::DEFAULT_DELAYS;
        }

        // Ignore anything that is not a usable positive number of minutes, so a
        // malformed entry cannot collapse the schedule into an immediate retry.
        $delays = array_values(array_filter(
            array_map(static fn ($minutes) => (int) $minutes, $configured),
            static fn (int $minutes) => $minutes > 0
        ));

        return $delays !== [] ? $delays : self::DEFAULT_DELAYS;
    }

    /**
     * Minutes to wait after `$failedAttempt` has failed, before trying again.
     *
     * The schedule does not have to cover every attempt: once it runs out the
     * final value is reused, so the job keeps retrying at a steady interval
     * rather than dropping back to no delay at all.
     */
    public static function delayMinutesAfter(int $failedAttempt): int
    {
        $delays = self::delays();
        $index  = max(1, $failedAttempt) - 1;

        return $delays[$index] ?? $delays[count($delays) - 1];
    }

    /**
     * When the job should next be picked up, after `$failedAttempt` has failed.
     */
    public static function nextRetryAt(int $failedAttempt, ?Carbon $from = null): Carbon
    {
        return ($from ? $from->copy() : Carbon::now())
            ->addMinutes(self::delayMinutesAfter($failedAttempt));
    }

    /**
     * Has this job exhausted its allowance?
     *
     * @param  int       $attemptsMade  Attempts already made, including the one that just failed.
     * @param  int|null  $maxAttempts   The job's own limit; falls back to the configured maximum.
     */
    public static function isExhausted(int $attemptsMade, ?int $maxAttempts = null): bool
    {
        return $attemptsMade >= self::resolveMaxAttempts($maxAttempts);
    }

    /**
     * How many attempts remain after `$attemptsMade`. Never negative.
     */
    public static function attemptsRemaining(int $attemptsMade, ?int $maxAttempts = null): int
    {
        return max(0, self::resolveMaxAttempts($maxAttempts) - $attemptsMade);
    }

    /**
     * A job's effective limit.
     *
     * Rows created before this limit was raised — or by a caller that did not
     * set one — carry a stale or empty value. Treating those as the configured
     * maximum keeps one setting in charge of the whole queue.
     */
    public static function resolveMaxAttempts(?int $maxAttempts): int
    {
        return ($maxAttempts !== null && $maxAttempts > 0) ? $maxAttempts : self::maxAttempts();
    }

    /**
     * Minutes after which a row stuck in 'processing' is assumed to belong to a
     * worker that died, and is returned to the queue.
     */
    public static function staleProcessingMinutes(): int
    {
        $configured = (int) config('radius.queue.stale_processing_minutes', 15);

        return $configured > 0 ? $configured : 15;
    }

    /** Should queueing skip an operation that is already waiting? */
    public static function preventsDuplicates(): bool
    {
        return (bool) config('radius.queue.prevent_duplicates', true);
    }

    /** Default number of items to process in one run. */
    public static function batchSize(): int
    {
        $configured = (int) config('radius.queue.batch_size', 20);

        return $configured > 0 ? $configured : 20;
    }

    /**
     * The schedule rendered for logs and diagnostics, e.g. "15m, 25m, 35m…".
     */
    public static function describeSchedule(): string
    {
        return implode(', ', array_map(static fn (int $m) => "{$m}m", self::delays()));
    }
}
