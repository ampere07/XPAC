<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Decides whether a job order is allowed to appear in a JO-number notification.
 *
 * A JO notification names the job order by number and tells the reader the work
 * is finished. That claim is only true once BOTH statuses of the job order have
 * landed:
 *
 *   billing_status  the job order's own billing state. If it is still Pending,
 *                   the JO has not been billed yet.
 *
 *   onsite_status   the job order's own onsite work state. While it is still
 *                   Pending the onsite installation work is not completed yet.
 *
 * Either one pending suppresses the notification. Suppression is logged with the
 * JO id and the reason, because "the notification never arrived" is otherwise
 * indistinguishable from "the job order was never done", and the two lead
 * support down completely different paths.
 *
 * Read-only and side-effect free apart from the log line, so a caller may run it
 * as many times as it likes — the notification feeds are polled endpoints and
 * re-evaluate the same job orders on every request.
 */
class JobOrderNotificationGuard
{
    /**
     * Status values that mean "not settled yet".
     *
     * Compared case-insensitively after trimming: the column is free-text
     * varchar written by several different forms, and production data carries
     * 'Pending', 'pending' and ' Pending ' interchangeably. Blank and NULL are
     * deliberately NOT treated as pending.
     */
    private const PENDING_STATES = ['pending'];

    public const REASON_BILLING_PENDING = 'billing_status is pending';
    public const REASON_ONSITE_PENDING = 'onsite_status is pending';

    /**
     * Job order ids that must NOT be notified, mapped to why.
     *
     * One query for the whole batch rather than one per job order: these feeds
     * render a page of notifications at a time, and a per-row check would be a
     * round trip per notification on an endpoint the header polls.
     *
     * @param  iterable<int|string>  $jobOrderIds
     * @return array<int,string>  [job_order_id => reason]
     */
    public function suppressed(iterable $jobOrderIds): array
    {
        $ids = $this->normaliseIds($jobOrderIds);

        if ($ids === []) {
            return [];
        }

        $rows = DB::table('job_orders as jo')
            ->whereIn('jo.id', $ids)
            ->select('jo.id', 'jo.billing_status', 'jo.onsite_status')
            ->get();

        $suppressed = [];

        foreach ($rows as $row) {
            $reason = $this->reasonFor($row->billing_status, $row->onsite_status);

            if ($reason === null) {
                continue;
            }

            $suppressed[(int) $row->id] = $reason;

            $this->logSuppressed($row->id, $reason, [
                'billing_status' => $row->billing_status,
                'onsite_status' => $row->onsite_status,
            ]);
        }

        return $suppressed;
    }

    /**
     * Whether one job order may be notified.
     *
     * For the single-dispatch callers (a push notification about one JO). Batch
     * callers should use suppressed() instead so the check costs one query for
     * the whole page.
     */
    public function mayNotify($jobOrderId): bool
    {
        return $this->suppressed([$jobOrderId]) === [];
    }

    /**
     * The suppression reason for a pair of statuses the caller already holds.
     *
     * Pure — no query, no log. Callers that suppress on the strength of this
     * must call logSuppressed() themselves.
     *
     * @return string|null  null when the job order may be notified
     */
    public function reasonFor($billingStatus, $onsiteStatus): ?string
    {
        $reasons = [];

        if ($this->isPending($billingStatus)) {
            $reasons[] = self::REASON_BILLING_PENDING;
        }

        if ($this->isPending($onsiteStatus)) {
            $reasons[] = self::REASON_ONSITE_PENDING;
        }

        return $reasons === [] ? null : implode(' and ', $reasons);
    }

    /**
     * Records that a JO number notification was withheld.
     *
     * Logged at info rather than warning: suppression is the rule working, not
     * a fault. It is logged at all because a notification that never arrives is
     * otherwise indistinguishable from a job order that was never done.
     */
    public function logSuppressed($jobOrderId, string $reason, array $context = []): void
    {
        Log::info('JO number notification suppressed', array_merge([
            'job_order_id' => (int) $jobOrderId,
            'reason' => $reason,
        ], $context));
    }

    /**
     * Drops the suppressed entries from a notification collection.
     *
     * Takes the id out of each entry through a callback rather than assuming a
     * key name, because the two feeds that use this shape their rows
     * differently — one has already mapped to the response array, the other is
     * still holding raw query rows.
     *
     * @template T
     * @param  \Illuminate\Support\Collection<int,T>  $notifications
     * @param  callable(T):(int|string|null)  $idOf
     * @return \Illuminate\Support\Collection<int,T>
     */
    public function filter($notifications, callable $idOf)
    {
        $ids = $notifications->map($idOf)->filter()->all();

        $suppressed = $this->suppressed($ids);

        if ($suppressed === []) {
            return $notifications;
        }

        return $notifications
            ->reject(fn ($entry) => isset($suppressed[(int) $idOf($entry)]))
            ->values();
    }

    /**
     * Only positive integer ids reach the query.
     *
     * The callers pass ids straight out of request payloads and query results,
     * so a null or a non-numeric string is possible; letting one through would
     * widen the whereIn rather than narrowing it.
     *
     * @return array<int,int>
     */
    private function normaliseIds(iterable $ids): array
    {
        $clean = [];

        foreach ($ids as $id) {
            if (is_numeric($id) && (int) $id > 0) {
                $clean[(int) $id] = (int) $id;
            }
        }

        return array_values($clean);
    }

    private function isPending($status): bool
    {
        if ($status === null) {
            return false;
        }

        return in_array(strtolower(trim((string) $status)), self::PENDING_STATES, true);
    }
}
