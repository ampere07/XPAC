<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ForApprovalQueueService;
use App\Support\JobOrderListFormatter;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * For Approval: pending transactions and done job orders, one page at a time.
 *
 * Read-only. Approving a listed record goes through its own endpoint — transactions/{id}/approve
 * or job-orders/{id}/approve — with that endpoint's own key and rules, so approving from this
 * queue is the same act as approving from the Transaction List or the Job Order page. See
 * App\Services\ForApprovalQueueService for what is listed and why.
 *
 * Every list response also carries the counts for both categories, so the page refreshes its
 * rows and its filter counts with one request after an approval.
 */
class ForApprovalController extends Controller
{
    private const DEFAULT_LIMIT = 25;
    private const MAX_LIMIT = 100;

    public function __construct(private ForApprovalQueueService $queue)
    {
    }

    /** GET /for-approval/transactions?page=&limit=&search= */
    public function transactions(Request $request): JsonResponse
    {
        if ($denied = $this->denyWithoutPermission()) {
            return $denied;
        }

        // Outside the try: a ValidationException must reach the client as the usual 422.
        [$page, $limit, $search] = $this->validatedFilters($request);

        try {
            $user = auth()->user();

            // Newest first, as the Transaction List orders them.
            $paginator = $this->queue->transactions($user, $search)
                ->with(ForApprovalQueueService::TRANSACTION_RELATIONS)
                ->orderBy('created_at', 'desc')
                ->orderBy('id', 'desc')
                ->paginate($limit, ['*'], 'page', $page);

            return $this->listResponse($paginator, collect($paginator->items()), $user);
        } catch (\Throwable $e) {
            Log::error('[FOR APPROVAL] Transactions failed: ' . $e->getMessage());
            return response()->json(['success' => false, 'message' => 'Failed to load transactions awaiting approval.'], 500);
        }
    }

    /** GET /for-approval/job-orders?page=&limit=&search= */
    public function jobOrders(Request $request): JsonResponse
    {
        if ($denied = $this->denyWithoutPermission()) {
            return $denied;
        }

        [$page, $limit, $search] = $this->validatedFilters($request);

        try {
            $user = auth()->user();

            // Newest first, as the Job Order list orders them.
            $paginator = $this->queue->jobOrders($user, $search)
                ->with(ForApprovalQueueService::JOB_ORDER_RELATIONS)
                ->orderBy('id', 'desc')
                ->paginate($limit, ['*'], 'page', $page);

            // The Job Order list's own row shape: the details pane and the Approve flow read it.
            $rows = JobOrderListFormatter::formatMany($paginator->getCollection());

            return $this->listResponse($paginator, $rows, $user);
        } catch (\Throwable $e) {
            Log::error('[FOR APPROVAL] Job orders failed: ' . $e->getMessage());
            return response()->json(['success' => false, 'message' => 'Failed to load job orders awaiting approval.'], 500);
        }
    }

    /** @return array{0: int, 1: int, 2: string} page, limit, search */
    private function validatedFilters(Request $request): array
    {
        $filters = $request->validate([
            'page'   => ['nullable', 'integer', 'min:1'],
            'limit'  => ['nullable', 'integer', 'min:1', 'max:' . self::MAX_LIMIT],
            'search' => ['nullable', 'string', 'max:100'],
        ]);

        return [
            (int) ($filters['page'] ?? 1),
            (int) ($filters['limit'] ?? self::DEFAULT_LIMIT),
            trim((string) ($filters['search'] ?? '')),
        ];
    }

    /**
     * @param  \Illuminate\Contracts\Pagination\LengthAwarePaginator  $paginator
     * @param  \Illuminate\Support\Collection  $rows
     */
    private function listResponse($paginator, $rows, $user): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $rows->values(),
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
            ],
            'counts' => $this->queue->counts($user),
        ]);
    }

    /**
     * Checked here, not left to ApiAccessControl, which only logs on this deployment: the queue
     * lists every payment and installation awaiting a decision, so it must never answer a user
     * without the page key (Administrator and SuperAdmin among the seeded roles).
     */
    private function denyWithoutPermission(): ?JsonResponse
    {
        return Permissions::allows(auth()->user(), 'for-approval')
            ? null
            : response()->json(['success' => false, 'message' => 'You do not have permission to view the approval queue.'], 403);
    }
}
