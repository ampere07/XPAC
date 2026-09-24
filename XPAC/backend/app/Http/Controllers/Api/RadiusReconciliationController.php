<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\RadiusReconciliationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * HTTP surface for the Mikrotik Radius Tool.
 *
 * Validates, delegates to RadiusReconciliationService, and formats the response.
 * No query, no RADIUS call and no business rule lives here.
 *
 * Every endpoint is scoped to the caller's organization unless they are SuperAdmin,
 * so an administrator on one deployment can never audit or mutate another's devices.
 */
class RadiusReconciliationController extends Controller
{
    /** SuperAdmin sees every organization; everyone else is scoped to their own. */
    private const SUPERADMIN_ROLE_ID = 7;

    public function __construct(private RadiusReconciliationService $service)
    {
    }

    /**
     * GET /api/radius-reconciliation/servers
     */
    public function servers(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data'    => $this->service->getServers($this->organizationId($request)),
        ]);
    }

    /**
     * GET /api/radius-reconciliation/snapshot
     *
     * The last completed audit, without contacting a single device. This is what the
     * tool opens on; `data` below is the explicit "Sync & Reconcile Now" action and
     * is the only endpoint that touches hardware.
     */
    public function snapshot(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'server_id' => ['nullable', 'string', 'max:32'],
        ]);

        return response()->json($this->service->getSnapshot(
            $validated['server_id'] ?? RadiusReconciliationService::SERVER_ALL,
            $this->organizationId($request)
        ));
    }

    /**
     * GET /api/radius-reconciliation/data
     */
    public function data(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'server_id' => ['nullable', 'string', 'max:32'],
        ]);

        $result = $this->service->fetchReconciliationData(
            $validated['server_id'] ?? RadiusReconciliationService::SERVER_ALL,
            $this->organizationId($request)
        );

        return response()->json($result, $result['success'] ? 200 : 422);
    }

    /**
     * POST /api/radius-reconciliation/sync-password
     */
    public function syncPassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username'     => ['required', 'string', 'max:191'],
            'rad_password' => ['required', 'string', 'max:191'],
        ]);

        return $this->respond($this->service->syncPasswordToDb($validated['username'], $validated['rad_password']));
    }

    /**
     * POST /api/radius-reconciliation/sync-group-mikrotik
     */
    public function syncGroupMikrotik(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username'     => ['required', 'string', 'max:191'],
            'target_group' => ['required', 'string', 'max:191'],
            'server_id'    => ['nullable', 'integer'],
            'rad_id'       => ['nullable', 'string', 'max:64'],
        ]);

        return $this->respond($this->service->syncGroupToMikrotik(
            $validated['username'],
            $validated['target_group'],
            $validated['server_id'] ?? null,
            $validated['rad_id'] ?? null,
            $this->organizationId($request)
        ));
    }

    /**
     * POST /api/radius-reconciliation/sync-group-billing
     */
    public function syncGroupBilling(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username'  => ['required', 'string', 'max:191'],
            'rad_group' => ['required', 'string', 'max:191'],
        ]);

        return $this->respond($this->service->syncGroupToBilling($validated['username'], $validated['rad_group']));
    }

    /**
     * POST /api/radius-reconciliation/restrict
     */
    public function restrict(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username'  => ['required', 'string', 'max:191'],
            'server_id' => ['nullable', 'integer'],
            'rad_id'    => ['nullable', 'string', 'max:64'],
        ]);

        return $this->respond($this->service->restrictAccount(
            $validated['username'],
            $validated['server_id'] ?? null,
            $validated['rad_id'] ?? null,
            $this->organizationId($request)
        ));
    }

    /**
     * POST /api/radius-reconciliation/disconnect
     */
    public function disconnect(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username'  => ['required', 'string', 'max:191'],
            'server_id' => ['nullable', 'integer'],
        ]);

        return $this->respond($this->service->disconnectSession(
            $validated['username'],
            $validated['server_id'] ?? null,
            $this->organizationId($request)
        ));
    }

    /**
     * POST /api/radius-reconciliation/add-user
     */
    public function addUser(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username'  => ['required', 'string', 'max:191'],
            'password'  => ['nullable', 'string', 'max:191'],
            'group'     => ['nullable', 'string', 'max:191'],
            'server_id' => ['required', 'integer'],
        ]);

        return $this->respond($this->service->addToRadius(
            $validated['username'],
            $validated['password'] ?? RadiusReconciliationService::DEFAULT_NEW_PASSWORD,
            $validated['group'] ?? 'Default',
            $validated['server_id'],
            $this->organizationId($request)
        ));
    }

    /**
     * POST /api/radius-reconciliation/delete-user
     */
    public function deleteUser(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username'  => ['required', 'string', 'max:191'],
            'rad_id'    => ['nullable', 'string', 'max:64'],
            'server_id' => ['required', 'integer'],
        ]);

        return $this->respond($this->service->deleteFromRadius(
            $validated['username'],
            $validated['rad_id'] ?? null,
            $validated['server_id'],
            $this->organizationId($request)
        ));
    }

    /**
     * POST /api/radius-reconciliation/resolve-duplicate
     */
    public function resolveDuplicate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username'         => ['required', 'string', 'max:191'],
            'keep_server_id'   => ['required', 'integer'],
            'remove_server_id' => ['required', 'integer', 'different:keep_server_id'],
        ]);

        return $this->respond($this->service->resolveDuplicate(
            $validated['username'],
            $validated['keep_server_id'],
            $validated['remove_server_id'],
            $this->organizationId($request)
        ));
    }

    /**
     * POST /api/radius-reconciliation/bulk
     */
    public function bulk(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'operation'              => ['required', 'string', 'in:' . implode(',', RadiusReconciliationService::BULK_OPERATIONS)],
            'server_id'              => ['nullable', 'string', 'max:32'],
            'users'                  => ['required', 'array', 'min:1', 'max:2000'],
            'users.*.username'       => ['required', 'string', 'max:191'],
            'users.*.server_id'      => ['nullable', 'integer'],
            'users.*.rad_id'         => ['nullable', 'string', 'max:64'],
            'users.*.rad_group'      => ['nullable', 'string', 'max:191'],
            'users.*.target_group'   => ['nullable', 'string', 'max:191'],
            'users.*.rad_password'   => ['nullable', 'string', 'max:191'],
        ]);

        $result = $this->service->bulkAction(
            $validated['operation'],
            $validated['users'],
            $validated['server_id'] ?? null,
            $this->organizationId($request)
        );

        return response()->json([
            'success' => $result['failed'] === 0,
            'message' => sprintf(
                '%d succeeded, %d skipped, %d failed.',
                $result['success'],
                $result['skipped'],
                $result['failed']
            ),
            'data'    => $result,
        ]);
    }

    /**
     * POST /api/radius-reconciliation/undo
     */
    public function undo(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'log_id' => ['required', 'integer', 'min:1'],
        ]);

        return $this->respond($this->service->undoOperation($validated['log_id'], $this->organizationId($request)));
    }

    /**
     * GET /api/radius-reconciliation/logs
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
     * GET /api/radius-reconciliation/export
     */
    public function export(Request $request): StreamedResponse
    {
        $validated = $request->validate([
            'filter'    => ['nullable', 'string', 'max:32'],
            'server_id' => ['nullable', 'string', 'max:32'],
        ]);

        $export = $this->service->exportCsv(
            $validated['filter'] ?? 'all',
            $validated['server_id'] ?? RadiusReconciliationService::SERVER_ALL,
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
     * Turn a service outcome into the JSON shape the frontend expects.
     *
     * A skip is a success with `skipped` set — the caller asked for a state that is
     * already true, which is not an error and must not be reported as one.
     *
     * @param array<string, mixed> $outcome
     */
    private function respond(array $outcome): JsonResponse
    {
        return response()->json([
            'success' => (bool) $outcome['success'],
            'skipped' => (bool) ($outcome['skipped'] ?? false),
            'message' => $outcome['message'],
        ], $outcome['success'] ? 200 : 422);
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
