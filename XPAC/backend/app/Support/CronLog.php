<?php

namespace App\Support;

/**
 * Keeps a cron's log file to the two things anybody actually reads: what went wrong, and
 * which records the run touched.
 *
 * The services under app/Services each keep their own `writeLog()` that writes every line
 * they produce straight to a file with file_put_contents — the step commentary, the
 * per-account narration, the box-drawing banners. Being a raw file write, it is not
 * subject to LOG_LEVEL, so this deployment running at LOG_LEVEL=error trims the Laravel
 * channels and leaves these files untouched. On an estate of any size that buries the few
 * lines that matter under thousands that do not, and the file has to be read end to end to
 * find out whether anything failed.
 *
 * So a line is kept when it reports a fault, and everything else is dropped. What is lost
 * is the narration, and it is replaced with something more useful: one summary per run
 * listing the records by outcome, quoted so it pastes straight into a SQL `IN (...)`.
 *
 *     [2026-08-30 02:00:05] [AutoDisconnect] » PROCESSED (6) "20220000124","20220000176",…
 *     [2026-08-30 02:00:05] [AutoDisconnect] » SKIPPED   (2) "20220000401","20220000455"
 *     [2026-08-30 02:00:05] [AutoDisconnect] » FAILED    (1) "20220000368"
 *
 * Filtering is deliberately biased towards keeping too much rather than too little: an
 * extra line costs nothing, a dropped error costs an incident. Uppercase tags are matched
 * as whole words — these services tag consistently, and mid-line as often as at the start
 * ("[3/17] ✗ ERROR (isolated, continuing): …") — and a short list of failure phrases is
 * matched case-insensitively to catch lines that describe a fault without carrying a tag,
 * the "[RADIUS] Restrict failed: …" shape.
 *
 * Set CRON_LOG_ERRORS_ONLY=false to restore the old behaviour of writing every line.
 */
class CronLog
{
    /** Prefix on lines this class emits. They always survive filtering. */
    private const SUMMARY_MARKER = '»';

    /**
     * Uppercase severity tags that mark a line as a fault.
     */
    private const ERROR_TAGS = [
        'ERROR', 'EXCEPTION', 'CRITICAL', 'FATAL', 'FAILED', 'FAILURE', 'FAIL',
    ];

    /** Kept only when warnings are opted back in. */
    private const WARNING_TAGS = ['WARNING', 'WARN'];

    /**
     * Tags that survive the filter no matter how it is configured.
     *
     * The filter keeps faults and drops narration, which is right for a run that
     * either worked or did not. It is wrong for a line reporting that MONEY is in
     * an unexpected state — an incentive earned but never billable, a completed
     * quota reversed because the install failed. Those are not faults; nothing
     * threw, and the run reports success. But they are the only warning anybody
     * gets that an agent is owed something the scheme will not pay, and they were
     * being dropped in silence.
     *
     * Matched as whole uppercase words, the same way ERROR_TAGS are.
     */
    private const ALWAYS_KEEP_TAGS = ['UNBILLED', 'STRANDED', 'REVERSED', 'MONEY'];

    /**
     * Lower-confidence failure wording, matched case-insensitively, for the narrated
     * failures that carry a section tag rather than a severity one.
     */
    private const FAILURE_PHRASES = '/\b(fail(?:ed|ure|s)?|exception|unreachable|unavailable|unable to|could not|did not (?:answer|respond)|no [a-z ]{0,24}responded|refused|rejected|denied|timed out|timeout|invalid|abort(?:ed)?)\b/i';

    /**
     * Counted-summary wording that would otherwise trip the phrase match on a clean run —
     * "Errors: 0", "0 failed", "Failed: 0". A zero count is a result, not a fault.
     */
    private const ZERO_COUNT = '/\b(?:0\s+(?:fail\w*|error\w*)|(?:fail\w*|error\w*)\s*[:=]\s*0)\b/i';

    /** @var array<string, array<int, string>> outcome => identifiers, insertion-ordered */
    private array $buckets = [];

    // =========================================================================
    // Filtering
    // =========================================================================

    /** Is line-level filtering switched on at all? */
    public static function errorsOnly(): bool
    {
        return (bool) config('cronlog.errors_only', true);
    }

    /** Are warnings kept alongside errors? */
    public static function includeWarnings(): bool
    {
        return (bool) config('cronlog.include_warnings', false);
    }

    /**
     * Should this line be written to the cron's own log file?
     *
     * Summary lines are always kept — they are the replacement for everything being
     * dropped, so they must not be removed by their own filter.
     */
    public static function shouldWrite(string $message): bool
    {
        if (!self::errorsOnly()) {
            return true;
        }

        return self::isSummary($message) || self::isMoneyNotice($message) || self::isError($message);
    }

    /**
     * Does this line report money in an unexpected state?
     *
     * Kept unconditionally — see ALWAYS_KEEP_TAGS. Checked before isError() so a
     * phrase like "not billed" cannot be written off as a zero count.
     */
    public static function isMoneyNotice(string $message): bool
    {
        return (bool) preg_match('/\b(' . implode('|', self::ALWAYS_KEEP_TAGS) . ')\b/', $message);
    }

    /** Does this line report a fault? */
    public static function isError(string $message): bool
    {
        if (self::isZeroCount($message)) {
            return false;
        }

        $tags = self::includeWarnings()
            ? array_merge(self::ERROR_TAGS, self::WARNING_TAGS)
            : self::ERROR_TAGS;

        if (preg_match('/\b(' . implode('|', $tags) . ')\b/', $message)) {
            return true;
        }

        return (bool) preg_match(self::FAILURE_PHRASES, $message);
    }

    /** "Errors: 0" and friends are a clean result. */
    private static function isZeroCount(string $message): bool
    {
        return (bool) preg_match(self::ZERO_COUNT, $message);
    }

    /** Lines emitted by summaryLines(). */
    public static function isSummary(string $message): bool
    {
        return str_starts_with(ltrim($message), self::SUMMARY_MARKER);
    }

    // =========================================================================
    // Per-run outcome collection
    // =========================================================================

    /**
     * Note that $identifier ended the run in $outcome.
     *
     * A blank identifier is ignored rather than recorded as an empty string: a summary
     * listing `""` is worse than one entry short. Duplicates collapse, so a record
     * touched twice appears once.
     */
    public function record(string $outcome, ?string $identifier): void
    {
        $identifier = trim((string) $identifier);

        if ($identifier === '') {
            return;
        }

        $outcome = strtoupper(trim($outcome));

        if (!isset($this->buckets[$outcome])) {
            $this->buckets[$outcome] = [];
        }

        if (!in_array($identifier, $this->buckets[$outcome], true)) {
            $this->buckets[$outcome][] = $identifier;
        }
    }

    public function processed(?string $identifier): void
    {
        $this->record('PROCESSED', $identifier);
    }

    public function skipped(?string $identifier): void
    {
        $this->record('SKIPPED', $identifier);
    }

    /**
     * A record the run brought into existence, as opposed to one it acted upon.
     *
     * Kept distinct from processed() because the two answer different questions:
     * "which accounts did this run touch" and "what did it create". A stage that
     * creates rows is the one most often accused of having done nothing, so the
     * things it created are worth listing on their own line.
     */
    public function created(?string $identifier): void
    {
        $this->record('CREATED', $identifier);
    }

    public function failed(?string $identifier): void
    {
        $this->record('FAILED', $identifier);
    }

    public function queued(?string $identifier): void
    {
        $this->record('QUEUED', $identifier);
    }

    public function isEmpty(): bool
    {
        foreach ($this->buckets as $ids) {
            if ($ids !== []) {
                return false;
            }
        }

        return true;
    }

    /** Drop everything collected, so one instance can serve consecutive runs. */
    public function reset(): void
    {
        $this->buckets = [];
    }

    /**
     * One line per non-empty outcome, quoted and comma-separated.
     *
     * $label distinguishes several runs that share a log file — a service that generates
     * statements and then invoices emits two sets. It is placed AFTER the marker rather
     * than being prepended by the caller, so the line still begins with the marker and
     * survives shouldWrite().
     *
     * @return array<int, string>
     */
    public function summaryLines(?string $label = null): array
    {
        $label = trim((string) $label);
        $label = $label === '' ? '' : $label . ' ';

        $width = 0;

        foreach ($this->buckets as $outcome => $ids) {
            if ($ids !== []) {
                $width = max($width, strlen($outcome));
            }
        }

        $lines = [];

        foreach ($this->buckets as $outcome => $ids) {
            if ($ids === []) {
                continue;
            }

            $list = implode(',', array_map(
                static fn (string $id): string => '"' . $id . '"',
                $ids
            ));

            $lines[] = self::SUMMARY_MARKER . ' ' . $label . str_pad($outcome, $width)
                . ' (' . count($ids) . ') ' . $list;
        }

        return $lines;
    }
}
