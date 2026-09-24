<?php

namespace App\Http\Controllers;

use App\Models\PrepaidOverrideRequest;
use App\Models\User;
use App\Services\PrepaidOverrideService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;

/**
 * API for the Prepaid Override module (Billing -> Prepaid Override).
 *
 * Requests are raised from the clock icon on Customer Details and decided from the list view. All
 * of the actual work — transaction boundaries, idempotency, RADIUS enforcement — lives in
 * {@see PrepaidOverrideService}; this class validates input, scopes reads to the caller's
 * organization, and maps service outcomes onto HTTP.
 */
class PrepaidOverrideRequestController extends Controller
{
    public function __construct(private PrepaidOverrideService $service)
    {
    }

    /**
     * List override requests visible to the caller.
     *
     * Supports `updated_since` for the front-end's incremental poll, which is why the response
     * carries `server_time` — the client sends it back on the next tick rather than trusting its own
     * clock.
     */
    public function index(Request $request): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser->organization_id ?? null;
            $roleId = $authUser->role_id ?? null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            // Eager-loaded up front: the list renders a customer name and a requester email per row,
            // so resolving these lazily would be one extra query per row.
            $query = PrepaidOverrideRequest::with(PrepaidOverrideService::EAGER_RELATIONS);

            if ($request->filled('updated_since')) {
                $query->where('updated_at', '>', $request->input('updated_since'));
            }

            if ($request->filled('status')) {
                $query->where('status', strtolower(trim($request->input('status'))));
            }

            if ($request->filled('account_no')) {
                $query->where('account_no', trim($request->input('account_no')));
            }

            if (!$isSuperAdmin && $organizationId) {
                $query->where('organization_id', $organizationId);
            }

            $requests = $query->orderBy('created_at', 'desc')->get();

            return response()->json([
                'success' => true,
                'data' => $requests,
                'count' => $requests->count(),
                'server_time' => now()->toISOString(),
            ]);
        } catch (\Throwable $e) {
            Log::error('[PREPAID OVERRIDE] Failed to list requests', [
                'user_id' => auth()->id(),
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch prepaid override requests',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Raise a new override request from the Customer Details clock icon.
     */
    public function store(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'account_no' => 'required|string|max:100|exists:billing_accounts,account_no',
                // Signed: positive extends the period, negative claws days back. `not_in:0` because
                // a zero-day adjustment is a request to change nothing, which nobody should be
                // asked to review.
                'days_adjustment' => [
                    'required',
                    'integer',
                    'not_in:0',
                    'min:-' . PrepaidOverrideRequest::MAX_DAYS_ADJUSTMENT,
                    'max:' . PrepaidOverrideRequest::MAX_DAYS_ADJUSTMENT,
                ],
                'reason' => 'required|string|max:2000',
                'remarks' => 'nullable|string|max:2000',
                // Accepted for parity with the revert form, which identifies the requester by
                // email. The authenticated user still wins — see resolveActor().
                'requested_by' => 'nullable|string|max:255',
            ], [
                'days_adjustment.not_in' => 'Enter a non-zero number of days to add or deduct.',
                'account_no.exists' => 'That billing account does not exist.',
            ]);

            $actor = $this->resolveActor($request->input('requested_by'));

            $result = $this->service->createRequest($validated, $actor);

            return response()->json(array_filter([
                'success' => $result['success'],
                'message' => $result['message'],
                'data' => $result['data'] ?? null,
                'error' => $result['error'] ?? null,
            ], static fn ($value) => $value !== null), $result['status']);
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors(),
            ], 422);
        } catch (\Throwable $e) {
            Log::error('[PREPAID OVERRIDE] Failed to store request', [
                'user_id' => auth()->id(),
                'account_no' => $request->input('account_no'),
                'days_adjustment' => $request->input('days_adjustment'),
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to submit prepaid override request',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function show(string $id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser->organization_id ?? null;
            $roleId = $authUser->role_id ?? null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $overrideRequest = PrepaidOverrideRequest::with(PrepaidOverrideService::EAGER_RELATIONS)->find($id);

            if (!$overrideRequest) {
                return response()->json([
                    'success' => false,
                    'message' => 'Prepaid override request not found',
                ], 404);
            }

            if (!$isSuperAdmin && $organizationId && $overrideRequest->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to prepaid override request',
                ], 403);
            }

            return response()->json(['success' => true, 'data' => $overrideRequest]);
        } catch (\Throwable $e) {
            Log::error('[PREPAID OVERRIDE] Failed to show request', [
                'request_id' => $id,
                'user_id' => auth()->id(),
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch prepaid override request',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Approve or reject a pending request.
     *
     * Approval applies the expiry adjustment in one transaction and only then, once that has
     * committed, brings RADIUS in line — see {@see PrepaidOverrideService::enforceAfterCommit()}.
     * A RADIUS failure never fails the response: the adjustment is already durable, and the
     * outcome is reported in `enforcement` so the caller can see what happened.
     */
    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $accountNoForLog = null;

        try {
            $validated = $request->validate([
                'status' => ['required', 'string', Rule::in([
                    PrepaidOverrideRequest::STATUS_APPROVED,
                    PrepaidOverrideRequest::STATUS_PROCESSED,
                    PrepaidOverrideRequest::STATUS_REJECTED,
                ])],
                'remarks' => 'nullable|string|max:2000',
                'updated_by' => 'nullable|string|max:255',
            ]);

            $authUser = auth()->user();
            $organizationId = $authUser->organization_id ?? null;
            $roleId = $authUser->role_id ?? null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $overrideRequest = PrepaidOverrideRequest::find($id);

            if (!$overrideRequest) {
                return response()->json([
                    'success' => false,
                    'message' => 'Prepaid override request not found',
                ], 404);
            }

            $accountNoForLog = $overrideRequest->account_no;

            if (!$isSuperAdmin && $organizationId && $overrideRequest->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to prepaid override request',
                ], 403);
            }

            $actor = $this->resolveActor($request->input('updated_by'));

            if (PrepaidOverrideRequest::isApprovalStatus($validated['status'])) {
                $result = $this->service->approve((int) $id, $actor);

                // Only an approval that actually moved the expiry has anything to enforce; a
                // repeat approval returns no plan and therefore issues no RADIUS call.
                $enforcement = null;
                if (!empty($result['enforcement'])) {
                    $enforcement = $this->service->enforceAfterCommit($result['enforcement'], $actor);
                }

                return response()->json(array_filter([
                    'success' => $result['success'],
                    'message' => $result['message'],
                    'data' => $result['data'] ?? null,
                    'enforcement' => $enforcement,
                    'error' => $result['error'] ?? null,
                ], static fn ($value) => $value !== null), $result['status']);
            }

            $result = $this->service->reject((int) $id, $actor, $validated['remarks'] ?? null);

            return response()->json(array_filter([
                'success' => $result['success'],
                'message' => $result['message'],
                'data' => $result['data'] ?? null,
                'error' => $result['error'] ?? null,
            ], static fn ($value) => $value !== null), $result['status']);
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors(),
            ], 422);
        } catch (\Throwable $e) {
            Log::error('[PREPAID OVERRIDE] Failed to update request status', [
                'request_id' => $id,
                'account_no' => $accountNoForLog,
                'requested_status' => $request->input('status'),
                'user_id' => auth()->id(),
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to update prepaid override request',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Who is performing this action.
     *
     * The authenticated user is authoritative. The email in the body is only a fallback for the
     * same reason TransactionRevertController accepts one — some clients post the acting user's
     * email — and it can never be used to attribute an action to someone else while a session is
     * present.
     */
    private function resolveActor(?string $emailFallback): ?User
    {
        $authUser = auth()->user();

        if ($authUser instanceof User) {
            return $authUser;
        }

        if ($emailFallback && trim($emailFallback) !== '') {
            return User::where('email_address', trim($emailFallback))->first();
        }

        return null;
    }
}
