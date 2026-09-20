<?php

namespace App\Models;

use App\Services\ReportDataset;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A scheduled report definition.
 *
 * The schedule vocabulary lives here so the API validator, the queueing command
 * and the front-end form all agree on which fields a given schedule requires.
 * Previously each of the three had its own idea, which is why the form demanded
 * a day-of-month even for "Every Day".
 */
class Report extends Model
{
    use HasFactory;

    public const SCHEDULE_DAILY     = 'Every Day';
    public const SCHEDULE_WEEKLY    = 'Every Week';
    public const SCHEDULE_MONTHLY   = 'Every Month';
    public const SCHEDULE_QUARTERLY = 'Every 3 Months';
    public const SCHEDULE_YEARLY    = 'Every Year';

    /**
     * Which extra fields each schedule needs.
     *
     *   day      day of month (1–31)
     *   weekday  Monday…Sunday
     *   month    1–12 (anchor month; quarterly also fires +3, +6, +9 from it)
     */
    public const SCHEDULE_REQUIREMENTS = [
        self::SCHEDULE_DAILY     => [],
        self::SCHEDULE_WEEKLY    => ['weekday'],
        self::SCHEDULE_MONTHLY   => ['day'],
        self::SCHEDULE_QUARTERLY => ['day', 'month'],
        self::SCHEDULE_YEARLY    => ['month', 'day'],
    ];

    public const WEEKDAYS = [
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ];

    /**
     * Legacy schedule spellings seen in existing rows, mapped onto the canonical
     * values so old records keep firing after this change.
     */
    private const SCHEDULE_ALIASES = [
        'daily'          => self::SCHEDULE_DAILY,
        'every day'      => self::SCHEDULE_DAILY,
        'everyday'       => self::SCHEDULE_DAILY,
        'weekly'         => self::SCHEDULE_WEEKLY,
        'every week'     => self::SCHEDULE_WEEKLY,
        'monthly'        => self::SCHEDULE_MONTHLY,
        'every month'    => self::SCHEDULE_MONTHLY,
        'quarterly'      => self::SCHEDULE_QUARTERLY,
        'every 3 months' => self::SCHEDULE_QUARTERLY,
        'every quarter'  => self::SCHEDULE_QUARTERLY,
        'yearly'         => self::SCHEDULE_YEARLY,
        'annually'       => self::SCHEDULE_YEARLY,
        'every year'     => self::SCHEDULE_YEARLY,
    ];

    protected $fillable = [
        'report_name',
        'report_type',
        'report_schedule',
        'report_time',
        'day',
        'report_weekday',
        'report_month',
        'send_to',
        'date_range',
        'created_by',
        'file_url',
        'csv_file_url',
        'is_active',
        'organization_id',
    ];

    protected $casts = [
        'is_active'          => 'boolean',
        'report_month'       => 'integer',
        'last_dispatched_at' => 'datetime',
        'last_period_end'    => 'date',
        'created_at'         => 'datetime',
    ];

    public $timestamps = false;

    const CREATED_AT = 'created_at';
    const UPDATED_AT = null;

    public function dispatches(): HasMany
    {
        return $this->hasMany(ReportDispatch::class);
    }

    // ── Schedule vocabulary ───────────────────────────────────────────────────

    public static function schedules(): array
    {
        return array_keys(self::SCHEDULE_REQUIREMENTS);
    }

    /** Normalise a stored/user-supplied schedule to its canonical form. */
    public static function normalizeSchedule(?string $schedule): ?string
    {
        $key = strtolower(trim((string) $schedule));

        if ($key === '') {
            return null;
        }

        return self::SCHEDULE_ALIASES[$key]
            ?? (isset(self::SCHEDULE_REQUIREMENTS[$schedule]) ? $schedule : null);
    }

    public function canonicalSchedule(): ?string
    {
        return self::normalizeSchedule($this->report_schedule);
    }

    /** Which extra fields this report's schedule requires. */
    public function requiredScheduleFields(): array
    {
        $schedule = $this->canonicalSchedule();

        return $schedule ? self::SCHEDULE_REQUIREMENTS[$schedule] : [];
    }

    public static function requiresField(?string $schedule, string $field): bool
    {
        $canonical = self::normalizeSchedule($schedule);

        return $canonical !== null
            && in_array($field, self::SCHEDULE_REQUIREMENTS[$canonical], true);
    }

    /** Normalise a weekday name; returns null when unrecognised. */
    public static function normalizeWeekday(?string $weekday): ?string
    {
        $key = strtolower(trim((string) $weekday));

        foreach (self::WEEKDAYS as $name) {
            if (strtolower($name) === $key || strtolower(substr($name, 0, 3)) === $key) {
                return $name;
            }
        }

        return null;
    }

    // ── Schedule evaluation ───────────────────────────────────────────────────

    /**
     * Does this report's schedule fire on the given date?
     *
     * Time-of-day is deliberately not considered here — the caller decides which
     * minute to fire in — so this method is directly unit-testable.
     */
    public function firesOn(Carbon $date): bool
    {
        $schedule = $this->canonicalSchedule();
        if ($schedule === null) {
            return false;
        }

        switch ($schedule) {
            case self::SCHEDULE_DAILY:
                return true;

            case self::SCHEDULE_WEEKLY:
                $weekday = self::normalizeWeekday($this->report_weekday);

                // No weekday recorded (legacy row): fall back to the weekday the
                // report was created on rather than never firing.
                if ($weekday === null) {
                    $weekday = $this->created_at
                        ? Carbon::parse($this->created_at)->format('l')
                        : 'Monday';
                }

                return $date->format('l') === $weekday;

            case self::SCHEDULE_MONTHLY:
                return $this->matchesDayOfMonth($date);

            case self::SCHEDULE_QUARTERLY:
                if (!$this->matchesDayOfMonth($date)) {
                    return false;
                }

                $anchor = $this->anchorMonth();

                // Fires in the anchor month and every third month after it, in
                // both directions, so the quarter cycle is stable regardless of
                // which month the check runs in. The old modulo on
                // (currentMonth - createdMonth) went negative for months before
                // the creation month and skipped them.
                return ((($date->month - $anchor) % 3) + 3) % 3 === 0;

            case self::SCHEDULE_YEARLY:
                return $date->month === $this->anchorMonth()
                    && $this->matchesDayOfMonth($date);
        }

        return false;
    }

    /**
     * Day-of-month match, clamped to the length of the month.
     *
     * A report set to day 31 must still fire in February — otherwise it silently
     * skips four to five months a year.
     */
    private function matchesDayOfMonth(Carbon $date): bool
    {
        $day = (int) $this->day;
        if ($day < 1) {
            return false;
        }

        $effective = min($day, $date->daysInMonth);

        return $date->day === $effective;
    }

    private function anchorMonth(): int
    {
        $month = (int) $this->report_month;
        if ($month >= 1 && $month <= 12) {
            return $month;
        }

        return $this->created_at ? Carbon::parse($this->created_at)->month : 1;
    }

    // ── Rolling reporting window ──────────────────────────────────────────────

    /** The originally configured [start, end] window, chronological. */
    public function originalPeriodBounds(): array
    {
        return ReportDataset::parseDateRange($this->date_range);
    }

    /** Length in days of the originally configured window, or null if unset. */
    public function periodLengthInDays(): ?int
    {
        [$start, $end] = $this->originalPeriodBounds();
        if ($start === null || $end === null) {
            return null;
        }

        return (int) Carbon::parse($start)->diffInDays(Carbon::parse($end)) + 1;
    }

    /**
     * The [start, end] window the NEXT automatic (schedule-triggered) dispatch
     * should cover.
     *
     * date_range is captured once, at creation/edit time. Before this method
     * existed, every scheduled occurrence re-read that same literal string
     * forever, so a report created for "Jan 1-30" kept mailing that exact
     * month no matter how many times it fired. What should repeat is the
     * window's LENGTH, not its dates: each automatic send now picks up the
     * day after the previous one left off (`last_period_end`), so consecutive
     * periods neither overlap (no duplicate records) nor skip a day.
     *
     * Manual sends (sendNow / --force) deliberately do not call this and keep
     * using date_range verbatim — this only changes the cron path.
     *
     * Returns null when there is nothing new to send yet, e.g. a schedule
     * that fires more often than its configured period is long will
     * occasionally catch up to "today" and have to wait for the next
     * calendar day before a further period exists at all. Callers should
     * skip (not send an empty/duplicate report) when this returns null.
     *
     * @return array{0: string, 1: string}|null
     */
    public function nextAutomaticWindow(Carbon $occurrence): ?array
    {
        [$origStart, $origEnd] = $this->originalPeriodBounds();
        $periodDays = $this->periodLengthInDays();
        if ($origStart === null || $origEnd === null || $periodDays === null) {
            return null;
        }

        // These are calendar dates, not instants. $occurrence arrives in the
        // reports timezone while a bare "YYYY-MM-DD" parses in the app default,
        // so every boundary is rebuilt in the occurrence's zone — otherwise the
        // offset between the two makes the comparisons below a day out.
        $timezone = $occurrence->getTimezone();
        $today    = $occurrence->copy()->startOfDay();

        $lastEnd = $this->last_period_end;

        $start = $lastEnd
            ? Carbon::parse($lastEnd->format('Y-m-d'), $timezone)->addDay()
            : Carbon::parse($origStart, $timezone);

        if ($start->greaterThan($today)) {
            return null;
        }

        $naturalEnd = $start->copy()->addDays($periodDays - 1);
        $end        = $naturalEnd->greaterThan($today) ? $today->copy() : $naturalEnd;

        return [$start->format('Y-m-d'), $end->format('Y-m-d')];
    }

    /** Scheduled send time as H:i, or null when not set. */
    public function scheduledTime(): ?string
    {
        if (empty($this->report_time)) {
            return null;
        }

        try {
            return Carbon::parse($this->report_time)->format('H:i');
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Stable identifier for one scheduled occurrence, e.g. "2026-07-30_17:40".
     * Used as the dedupe key in report_dispatches.
     */
    public function occurrenceKey(Carbon $date): string
    {
        return $date->format('Y-m-d') . '_' . ($this->scheduledTime() ?? '00:00');
    }

    /** Human-readable schedule detail, e.g. "on day 15" or "every Monday". */
    public function scheduleDetail(): string
    {
        $schedule = $this->canonicalSchedule();

        switch ($schedule) {
            case self::SCHEDULE_WEEKLY:
                $weekday = self::normalizeWeekday($this->report_weekday);

                return $weekday ? "every {$weekday}" : '';

            case self::SCHEDULE_MONTHLY:
                return $this->day ? "on day {$this->day}" : '';

            case self::SCHEDULE_QUARTERLY:
                $parts = [];
                if ($this->report_month) {
                    $parts[] = 'starting ' . Carbon::create(null, (int) $this->report_month, 1)->format('F');
                }
                if ($this->day) {
                    $parts[] = "on day {$this->day}";
                }

                return implode(' ', $parts);

            case self::SCHEDULE_YEARLY:
                if ($this->report_month && $this->day) {
                    return 'on ' . Carbon::create(null, (int) $this->report_month, 1)->format('F')
                        . ' ' . (int) $this->day;
                }

                return '';
        }

        return '';
    }

    /** Recipient emails, trimmed, de-duplicated and validated. */
    public function recipients(): array
    {
        $raw = preg_split('/[,;\s]+/', (string) $this->send_to, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $emails = [];
        foreach ($raw as $candidate) {
            $email = trim($candidate);
            if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
                // Case-insensitive de-dupe: "Admin@x.com" and "admin@x.com" are
                // the same mailbox and must not each receive a copy. The first
                // spelling wins so the order and casing the user typed survive.
                $emails[strtolower($email)] ??= $email;
            }
        }

        return array_values($emails);
    }

    /** Recipient entries that are not valid email addresses. */
    public function invalidRecipients(): array
    {
        $raw = preg_split('/[,;\s]+/', (string) $this->send_to, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        return array_values(array_filter(
            array_map('trim', $raw),
            fn ($email) => $email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)
        ));
    }
}
