<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SmartOltReconciliationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * HTTP surface for the SmartOLT Tool.
 *
 * Validates, delegates to SmartOltReconciliationService, and formats the response.
 * The permanent-deletion endpoint additionally requires the literal confirmation
 * phrase, so a mis-posted request can never unprovision an ONU.
 */
class SmartOltReconciliationController extends Controller
{
    /** SuperAdmin sees every organization; everyone else is scoped to their own. */
    private const SUPERADMIN_ROLE_ID = 7;

    public function __construct(private SmartOltReconciliationService $service)
    {
    }

    /**
     * GET /api/smartolt-reconciliation/state
     */
    public function state(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data'    => $this->service->getState(
                $request->boolean('include_rows'),
                $this->organizationId($request)
            ),
        ]);
    }

    /**
     * GET /api/smartolt-reconciliation/mac-discovery
     *
     * Read the bridge MAC behind each named ONU, or behind every ONU that has never
     * been crawled. One SmartOLT call per ONU against the hardest-throttled endpoint
     * on the API, so the sweep is capped and the caller repeats until `remaining`
     * reaches zero.
     */
    public function macDiscovery(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'external_ids'   => ['nullable', 'array', 'max:200'],
            'external_ids.*' => ['string', 'max:120'],
            'limit'          => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $result = $this->service->discoverBridgeMacs(
            $validated['external_ids'] ?? [],
            $validated['limit'] ?? 25
        );

        return response()->json($result, $result['success'] ? 200 : 422);
    }

    /**
     * GET /api/smartolt-reconciliation/optical-power
     *
     * @deprecated The crawl no longer reads optical power. Kept as an alias of
     * macDiscovery() so anything still pointed at the old path keeps working.
     */
    public function opticalPower(Request $request): JsonResponse
    {
        return $this->macDiscovery($request);
    }

    /**
     * GET /api/smartolt-reconciliation/alignment-preview
     */
    public function alignmentPreview(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data'    => $this->service->getAlignmentPreview($this->organizationId($request)),
        ]);
    }

    /**
     * GET /api/smartolt-reconciliation/mac-alignment
     *
     * The MAC-matched alignment pass: SmartOLT bridge MAC against the RADIUS
     * calling-station-id, proposing the subscriber's RADIUS username as the ONU name.
     */
    public function macAlignment(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data'    => $this->service->getMacAlignmentPreview($this->organizationId($request)),
        ]);
    }

    /**
     * GET /api/smartolt-reconciliation/sn-alignment
     *
     * The router/modem SN pass: SmartOLT's reported serial against the subscriber's
     * stored technical_details.router_modem_sn, matched by bridge MAC.
     */
    public function snAlignment(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data'    => $this->service->getSnAlignmentPreview($this->organizationId($request)),
        ]);
    }

    /**
     * GET /api/smartolt-reconciliation/profile-preview
     */
    public function profilePreview(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data'    => $this->service->getProfilePreview($this->organizationId($request)),
        ]);
    }

    /**
     * GET /api/smartolt-reconciliation/cleanup-preview
     */
    public function cleanupPreview(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'offline_days' => ['nullable', 'integer', 'min:1', 'max:3650'],
        ]);

        return response()->json([
            'success' => true,
            'data'    => $this->service->getCleanupPreview(
                $validated['offline_days'] ?? SmartOltReconciliationService::DEFAULT_OFFLINE_DAYS,
                $this->organizationId($request)
            ),
        ]);
    }

    /**
     * POST /api/smartolt-reconciliation/start-job
     */
    public function startJob(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'type'                 => ['required', 'string', 'in:' . implode(',', SmartOltReconciliationService::JOB_TYPES)],
            'confirmation'         => ['nullable', 'string', 'max:32'],
            'offline_days'         => ['nullable', 'integer', 'min:1', 'max:3650'],
            // Cleanup only. Off by default: an operator-selected ONU is removed on
            // the strength of that selection, with any safety objection recorded
            // against the deletion rather than refusing it. Send true to restore the
            // refusing behaviour for a caller that wants the guards to bind.
            'enforce_safety'       => ['nullable', 'boolean'],
            // Optical scan only: re-read every ONU instead of just the uncrawled ones.
            'rescan'               => ['nullable', 'boolean'],
            'external_ids'         => ['nullable', 'array', 'max:5000'],
            'external_ids.*'       => ['string', 'max:120'],
            'items'                => ['nullable', 'array', 'max:5000'],
            'items.*.external_id'  => ['required_with:items', 'string', 'max:120'],
            'items.*.new_name'     => ['nullable', 'string', 'max:128'],
            'items.*.new_address'  => ['nullable', 'string', 'max:255'],
            'items.*.new_contact'  => ['nullable', 'string', 'max:100'],
            'items.*.new_latitude'  => ['nullable', 'string', 'max:32'],
            'items.*.new_longitude' => ['nullable', 'string', 'max:32'],
            'items.*.address_changed' => ['nullable', 'boolean'],
            'items.*.contact_changed' => ['nullable', 'boolean'],
            'items.*.coords_changed'  => ['nullable', 'boolean'],
            // SN alignment: the billing row to write and the serial to write into it.
            'items.*.technical_detail_id' => ['nullable', 'integer', 'min:1'],
            'items.*.new_sn'              => ['nullable', 'string', 'max:255'],
        ]);

        $type = $validated['type'];
        unset($validated['type']);

        $result = $this->service->startJob($type, $validated, $this->organizationId($request));

        return response()->json([
            'success' => (bool) $result['success'],
            'skipped' => (bool) ($result['skipped'] ?? false),
            'message' => $result['message'],
            'job'     => $result['job'] ?? null,
        ], $result['success'] ? 200 : 422);
    }

    /**
     * POST /api/smartolt-reconciliation/process-job
     */
    public function processJob(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'job_id' => ['required', 'integer', 'min:1'],
        ]);

        $result = $this->service->processJob($validated['job_id']);

        return response()->json([
            'success' => (bool) $result['success'],
            'skipped' => (bool) ($result['skipped'] ?? false),
            'message' => $result['message'],
            'job'     => $result['job'] ?? null,
        ], $result['success'] ? 200 : 422);
    }

    /**
     * GET /api/smartolt-reconciliation/job-status
     *
     * Progress for one job, read-only.
     *
     * This is what the tool polls. Jobs are advanced by `cron:tool-jobs-drain` in the
     * background, so the browser no longer has to drive a sweep to keep it moving —
     * it only watches. Polling therefore stays a plain read: reopening the page a day
     * later reattaches to whatever the sweep has reached, and nothing about the job
     * depends on anyone being on this endpoint.
     */
    public function jobStatus(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'job_id' => ['required', 'integer', 'min:1'],
        ]);

        $job = $this->service->getJob($validated['job_id']);

        if ($job === null) {
            return response()->json([
                'success' => false,
                'message' => 'Job #' . $validated['job_id'] . ' does not exist.',
                'job'     => null,
            ], 404);
        }

        return response()->json([
            'success' => true,
            'message' => $job['message'],
            'job'     => $job,
        ]);
    }

    /**
     * GET /api/smartolt-reconciliation/active-job
     *
     * The job currently occupying the single active slot, if any.
     *
     * Lets the tool reattach its progress bar on load without the caller having to
     * remember a job id across the reload that closed the tab in the first place.
     */
    public function activeJob(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'job'     => $this->service->activeJob($this->organizationId($request)),
        ]);
    }

    /**
     * POST /api/smartolt-reconciliation/abort-job
     */
    public function abortJob(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'job_id' => ['required', 'integer', 'min:1'],
        ]);

        $result = $this->service->abortJob($validated['job_id']);

        return response()->json([
            'success' => (bool) $result['success'],
            'skipped' => (bool) ($result['skipped'] ?? false),
            'message' => $result['message'],
            'job'     => $result['job'] ?? null,
        ], $result['success'] ? 200 : 422);
    }

    /**
     * POST /api/smartolt-reconciliation/undo
     */
    public function undo(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'log_id' => ['required', 'integer', 'min:1'],
        ]);

        $result = $this->service->undoOperation($validated['log_id']);

        return response()->json([
            'success' => (bool) $result['success'],
            'skipped' => (bool) ($result['skipped'] ?? false),
            'message' => $result['message'],
        ], $result['success'] ? 200 : 422);
    }

    /**
     * GET /api/smartolt-reconciliation/logs
     */
    public function logs(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        return response()->json([
            'success' => true,
            'data'    => $this->service->getLogs($validated['limit'] ?? 50, $this->organizationId($request)),
        ]);
    }

    /**
     * GET /api/smartolt-reconciliation/export
     */
    public function export(Request $request): StreamedResponse
    {
        $validated = $request->validate([
            'dataset' => ['nullable', 'string', 'in:inventory,alignment,sn_alignment,profile,cleanup'],
        ]);

        $export = $this->service->exportCsv(
            $validated['dataset'] ?? 'inventory',
            $this->organizationId($request)
        );

        return response()->streamDownload(function () use ($export): void {
            $handle = fopen('php://output', 'wb');
            fputcsv($handle, $export['headers']);
            foreach ($export['rows'] as $row) {
                fputcsv($handle, $row);
            }
            fclose($handle);
        }, $export['filename'], ['Content-Type' => 'text/csv']);
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
