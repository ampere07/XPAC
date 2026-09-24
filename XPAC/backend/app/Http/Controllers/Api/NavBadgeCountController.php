<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Attention counts for the sidebar menu badges and the header bell.
 *
 * One endpoint rather than five, because the sidebar renders every badge on the same paint and
 * five parallel requests on an interval is the kind of thing that quietly becomes the busiest
 * route on the box.
 *
 * "Needs attention" is expressed throughout as NOT-IN a terminal set, never as IN a pending set.
 * These status columns are free-text varchars written from several screens and two clients, so an
 * allow-list silently drops any spelling nobody thought of — and a badge that under-counts is
 * worse than useless, because staff learn to trust it. The terminal states are the short, stable,
 * well-known lists; everything else is by definition still open.
 */
class NavBadgeCountController extends Controller
{
    /**
     * Terminal states per menu. Anything outside these — including NULL and '' — counts.
     *
     * Compared case-insensitively (see notIn()), so 'done' / 'Done' / 'DONE' all resolve.
     */
    private const TERMINAL = [
        // Job Order attention count: billing_status = 'In Progress' AND onsite_status = 'Done'
        'job_order' => ['Done', 'Approved', 'Failed', 'Cancelled', 'Completed'],
        // Service Order support: 'In Progress' and 'For Visit' are the open states.
        'service_order' => ['Resolved', 'Failed', 'Cancelled'],
        'service_order_visit' => ['Done', 'Completed', 'Complete', 'Failed', 'Cancelled', 'Canceled'],
        // Work Order: 'Pending' and 'In Progress' are the open states.
        'work_order' => ['Completed', 'Done', 'Failed', 'Cancelled'],
    ];

    public function index(): JsonResponse
    {
        try {
            $organizationId = $this->scopedOrganizationId();

            $counts = [
                // Applications are the one menu the spec pins to an explicit value rather than to
                // "not finished": the list has eight statuses and only 'Pending' is a review queue.
                // 'Empty' there means an application still being keyed in, not one awaiting review.
                'application' => $this->countWhere('applications', $organizationId, function (Builder $q) {
                    $q->whereRaw('LOWER(TRIM(status)) = ?', ['pending']);
                }),

                'job_order' => $this->countWhere('job_orders', $organizationId, function (Builder $q) {
                    $q->whereIn(DB::raw('LOWER(TRIM(billing_status))'), ['in progress', 'inprogress'])
                      ->whereIn(DB::raw('LOWER(TRIM(onsite_status))'), ['done', 'completed', 'finish']);
                }),

                'service_order' => $this->countWhere('service_orders', $organizationId, function (Builder $q) {
                    $this->notIn($q, 'support_status', self::TERMINAL['service_order']);
                    $q->where(function (Builder $sub) {
                        $sub->where(DB::raw('LOWER(TRIM(COALESCE(support_status, "")))'), '!=', 'for visit')
                            ->orWhereNull('visit_status')
                            ->orWhereRaw("TRIM(visit_status) = ''")
                            ->orWhereNotIn(DB::raw('LOWER(TRIM(visit_status))'), array_map('strtolower', self::TERMINAL['service_order_visit']));
                    });
                }),

                // work_order, singular — see App\Models\WorkOrder::$table.
                'work_order' => $this->countWhere('work_order', $organizationId, function (Builder $q) {
                    $this->notIn($q, 'work_status', self::TERMINAL['work_order']);
                }),

                // QUEUED as well as Pending: a transaction handed to the payment worker is still
                // awaiting processing and is exactly what this badge is for.
                'transaction' => $this->countWhere('transactions', $organizationId, function (Builder $q) {
                    $q->whereIn(DB::raw('LOWER(TRIM(status))'), ['pending', 'queued']);
                }),
            ];

            return response()->json([
                'success' => true,
                'data' => $counts + ['total' => array_sum($counts)],
            ]);
        } catch (\Throwable $e) {
            Log::error('[NAV BADGES] Failed to build counts: ' . $e->getMessage());

            // A broken badge must never break the sidebar. Zeroes render as no badge at all,
            // which is the same thing the UI shows before the first response lands.
            return response()->json([
                'success' => false,
                'message' => 'Failed to load navigation counts',
                'data' => [
                    'application' => 0,
                    'job_order' => 0,
                    'service_order' => 0,
                    'work_order' => 0,
                    'transaction' => 0,
                    'total' => 0,
                ],
            ]);
        }
    }

    /**
     * The organization to scope counts to, or null to count across all of them.
     *
     * Matches the rule every list controller applies (role_id 7 is superadmin), so a badge can
     * never advertise work the user cannot see when they open the page.
     */
    private function scopedOrganizationId(): ?int
    {
        $user = auth()->user();

        if (!$user || (int) ($user->role_id ?? 0) === 7 || empty($user->organization_id)) {
            return null;
        }

        return (int) $user->organization_id;
    }

    /**
     * Count rows matching $filter, scoped to the organization when the table carries one.
     *
     * Returns 0 for a table that does not exist rather than throwing: a deployment that has not
     * run every migration should still get a working sidebar.
     */
    private function countWhere(string $table, ?int $organizationId, callable $filter): int
    {
        try {
            $query = DB::table($table);
            $filter($query);

            if ($organizationId !== null) {
                // Rows predating multi-tenancy have a NULL organization_id. They belong to the
                // original tenant, which is how every list screen treats them.
                $query->where(function (Builder $q) use ($organizationId) {
                    $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
                });
            }

            return (int) $query->count();
        } catch (\Throwable $e) {
            Log::warning("[NAV BADGES] Count failed for {$table}: " . $e->getMessage());
            return 0;
        }
    }

    /**
     * "$column is not one of $terminal", counting NULL and blank as not-terminal.
     *
     * whereNotIn() alone would drop both: in SQL, `NULL NOT IN (...)` is NULL, not TRUE. A job
     * order whose billing_status was never set is precisely one that needs attention, so losing
     * those rows would hide the most actionable ones.
     */
    private function notIn(Builder $query, string $column, array $terminal): void
    {
        $lowered = array_map('strtolower', $terminal);

        $query->where(function (Builder $q) use ($column, $lowered) {
            $q->whereNull($column)
                ->orWhereRaw("TRIM({$column}) = ''")
                ->orWhereNotIn(DB::raw("LOWER(TRIM({$column}))"), $lowered);
        });
    }
}
