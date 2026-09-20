<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\BillingReconciliationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * HTTP surface for the Billing Reconcile tool.
 *
 * Validates, delegates to BillingReconciliationService, and formats the response. No
 * query, no billing arithmetic and no generation decision lives here — the service
 * re-checks every account against live state before it bills anything, so a posted id
 * cannot bypass a guard by arriving from a stale screen.
 */
class BillingReconciliationController extends Controller
{
    /** SuperAdmin sees every organization; everyone else is scoped to their own. */
    private const SUPERADMIN_ROLE_ID = 7;

    public function __construct(private BillingReconciliationService $service)
    {
    }

    /**
     * GET /api/billing-reconciliation/audit
     *
     * Every account whose current cycle produced no invoice, and the reason. Read-only:
     * opening this screen generates nothing and notifies nobody.
     */
    public function audit(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'reason'         => ['nullable', 'string', 'in:' . implode(',', array_keys(BillingReconciliationService::REASON_LABELS))],
            'billing_status' => ['nullable', 'string', 'max:100'],
            'billing_day'    => ['nullable', 'integer', 'min:0', 'max:31'],
            'search'         => ['nullable', 'string', 'max:191'],
            // Accounts that WERE billed are excluded by default; the worklist is what
            // needs attention, not a full ledger of the month.
            'include_ok'     => ['nullable', 'boolean'],
        ]);

        return response()->json([
            'success' => true,
            'data'    => $this->service->getAudit($validated, $this->organizationId($request)),
        ]);
    }

    /**
     * GET /api/billing-reconciliation/reasons
     *
     * The reason vocabulary, so the UI's filter and badges are built from the server's
     * list rather than a second copy that can drift out of step with it.
     */
    public function reasons(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data'    => [
                'labels' => BillingReconciliationService::REASON_LABELS,
                'generatable' => BillingReconciliationService::GENERATABLE_REASONS,
                'max_batch' => BillingReconciliationService::MAX_GENERATE_BATCH,
            ],
        ]);
    }

    /**
     * POST /api/billing-reconciliation/generate
     *
     * Raise the current cycle's bill for the accounts named, through the same generator
     * the nightly cron uses. Safe to repeat: an account already billed this cycle comes
     * back as skipped, not billed twice.
     */
    public function generate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'account_ids'   => ['required', 'array', 'min:1', 'max:' . BillingReconciliationService::MAX_GENERATE_BATCH],
            'account_ids.*' => ['integer', 'min:1'],
        ]);

        $result = $this->service->generate(
            $validated['account_ids'],
            (int) ($request->user()->id ?? 0),
            $this->organizationId($request)
        );

        return response()->json([
            'success'  => $result['failed'] === 0,
            'message'  => $this->generateMessage($result),
            'data'     => $result,
        ], $result['failed'] === 0 ? 200 : 422);
    }

    /**
     * POST /api/billing-reconciliation/dismiss
     *
     * Record that these accounts are deliberately not being billed this cycle, so the
     * genuine problems stop competing with them on the worklist.
     */
    public function dismiss(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'account_ids'   => ['required', 'array', 'min:1', 'max:1000'],
            'account_ids.*' => ['integer', 'min:1'],
            'reason'        => ['nullable', 'string', 'max:255'],
        ]);

        $result = $this->service->dismiss(
            $validated['account_ids'],
            $validated['reason'] ?? null,
            (int) ($request->user()->id ?? 0),
            $this->organizationId($request)
        );

        return response()->json([
            'success' => $result['failed'] === 0,
            'message' => sprintf(
                '%d account(s) marked do-not-generate for this cycle%s.',
                $result['success'],
                $result['skipped'] > 0 ? ', ' . $result['skipped'] . ' out of scope' : ''
            ),
            'data'    => $result,
        ], $result['failed'] === 0 ? 200 : 422);
    }

    /**
     * POST /api/billing-reconciliation/restore
     *
     * Undo a dismissal and put the account back on this cycle's worklist.
     */
    public function restore(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'account_ids'   => ['required', 'array', 'min:1', 'max:1000'],
            'account_ids.*' => ['integer', 'min:1'],
        ]);

        $result = $this->service->restore($validated['account_ids'], $this->organizationId($request));

        return response()->json([
            'success' => $result['failed'] === 0,
            'message' => $result['success'] . ' account(s) returned to the worklist.',
            'data'    => $result,
        ], $result['failed'] === 0 ? 200 : 422);
    }

    /**
     * @param array{success:int, failed:int, skipped:int} $result
     */
    private function generateMessage(array $result): string
    {
        if ($result['success'] === 0 && $result['skipped'] === 0 && $result['failed'] === 0) {
            return 'Nothing to generate.';
        }

        return sprintf(
            'Generated %d, skipped %d, failed %d.',
            $result['success'],
            $result['skipped'],
            $result['failed']
        );
    }

    /**
     * The organization this request is confined to, or null for SuperAdmin.
     */
    private function organizationId(Request $request): ?int
    {
        $user = $request->user();

        if ($user === null) {
            return null;
        }

        if ((int) ($user->role_id ?? 0) === self::SUPERADMIN_ROLE_ID) {
            return null;
        }

        return $user->organization_id !== null ? (int) $user->organization_id : null;
    }
}
