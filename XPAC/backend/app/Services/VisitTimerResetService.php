<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * Clears the onsite timings when a Failed or Rescheduled visit is put back In Progress.
 *
 * start_time / end_time on a job order or a service order describe ONE visit. While the
 * order sits at Failed or Reschedule that pair is correct and must be kept — it is what
 * the tech-performance widgets report on, and what the Team Detailed Queue shows for the
 * twenty minutes a finished row lingers there.
 *
 * Moving the order back to In Progress starts a NEW attempt, and from that moment the old
 * pair is actively wrong:
 *
 *   - The Team Detailed Queue derives its duration from `now - start_time` whenever
 *     end_time is absent. A job failed yesterday and picked up again this morning reads as
 *     "1d 4h 12m" the instant it is reassigned.
 *   - The mobile JO/SO detail screens gate the Start Timer button on `!!start_time`
 *     (JobOrderDetails / ServiceOrderDetails), so the technician cannot stamp a fresh one.
 *     The stale value is sticky, and every metric downstream inherits it.
 *   - A leftover end_time makes the retry look finished before it has begun.
 *
 * The web Done form already clears both by hand when it reschedules
 * (JobOrderDoneFormModal). Doing it here makes it true for every client — notably the
 * mobile app, which sends the status change on its own with no timing fields attached.
 *
 * Idempotent by construction: the reset is keyed on the TRANSITION, not on the destination
 * status. Saving an order that is already In Progress leaves the timings alone, so the
 * repeated saves the Done forms perform cannot wipe a timer the technician has since
 * started.
 */
class VisitTimerResetService
{
    /**
     * States that close an attempt and own the timings currently on the row.
     *
     * The columns behind this are free-text varchar written by several forms across three
     * clients, so the spellings that reach production are matched rather than a single
     * canonical value: 'Reschedule' is what the web and mobile pickers write, while
     * 'Rescheduled' and 'resched' appear on rows carried over from the old system.
     */
    private const CLOSED_ATTEMPT_STATES = [
        'failed',
        'fail',
        'reschedule',
        'rescheduled',
        'resched',
    ];

    /** States that mean a new attempt is under way. */
    private const IN_PROGRESS_STATES = [
        'in progress',
        'inprogress',
        'ongoing',
    ];

    /**
     * Is this status change a retry of a closed attempt?
     *
     * Pure — no query, no log, no side effect, so a caller may ask as often as it likes.
     * A null or blank `$incoming` means the request did not carry the status field at all
     * and therefore changes nothing.
     */
    public function isRetryTransition($previous, $incoming): bool
    {
        $from = $this->normalise($previous);
        $to = $this->normalise($incoming);

        if ($from === '' || $to === '') {
            return false;
        }

        return in_array($from, self::CLOSED_ATTEMPT_STATES, true)
            && in_array($to, self::IN_PROGRESS_STATES, true);
    }

    /**
     * Returns the update payload with the visit timings cleared, when the transition calls
     * for it. Returns it untouched otherwise.
     *
     * Writing into the payload the caller is already about to persist — rather than issuing
     * a second UPDATE — is deliberate: the reset lands in the same statement as the status
     * change, so the two can never diverge, and the controllers' existing audit-trail diffs
     * pick the cleared columns up for free.
     *
     * An explicit non-empty start_time in the same request wins. That is a client saying
     * "the new attempt starts now", which is exactly the fresh state this is trying to
     * reach, and discarding it would throw away a real timestamp.
     *
     * @param  array<string,mixed>  $data      the pending update payload
     * @param  mixed  $previous                the status currently on the row
     * @param  mixed  $incoming                the status the request is setting
     * @param  array<string,mixed>  $context   extra fields for the log line (ids, actor)
     * @return array<string,mixed>
     */
    public function applyTo(array $data, $previous, $incoming, array $context = []): array
    {
        if (!$this->isRetryTransition($previous, $incoming)) {
            return $data;
        }

        $keepsIncomingStart = array_key_exists('start_time', $data)
            && $data['start_time'] !== null
            && trim((string) $data['start_time']) !== '';

        if (!$keepsIncomingStart) {
            $data['start_time'] = null;
        }

        $data['end_time'] = null;

        Log::info('Visit timings reset on retry transition', array_merge([
            'from' => $previous,
            'to' => $incoming,
            'start_time_kept_from_request' => $keepsIncomingStart,
        ], $context));

        return $data;
    }

    /**
     * Lowercase, trimmed, with separators folded to a single space.
     *
     * Folds '_' and '-' so 'in_progress', 'in-progress' and 'In Progress' are one value —
     * the three clients each spell it differently, and the API accepts whatever they send.
     */
    private function normalise($status): string
    {
        if ($status === null) {
            return '';
        }

        $value = strtolower(trim((string) $status));
        $value = str_replace(['_', '-'], ' ', $value);

        return trim(preg_replace('/\s+/', ' ', $value) ?? '');
    }
}
