<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ModemRouterLogService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ModemRouterLogsController extends Controller
{
    private const SUPERADMIN_ROLE_ID = 7;

    public function __construct(private ModemRouterLogService $service)
    {
    }

    /**
     * GET /api/modem-router-logs
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'search'     => ['nullable', 'string', 'max:255'],
            'sn'         => ['nullable', 'string', 'max:255'],
            'event_type' => ['nullable', 'string', 'max:50'],
            'date_from'  => ['nullable', 'date'],
            'date_to'    => ['nullable', 'date'],
            'per_page'   => ['nullable', 'integer', 'min:1', 'max:100'],
            'page'       => ['nullable', 'integer', 'min:1'],
        ]);

        $perPage = (int) ($validated['per_page'] ?? 50);
        $page    = (int) ($validated['page'] ?? 1);

        $result = $this->service->getLogs(
            $validated,
            $perPage,
            $page,
            $this->organizationId($request)
        );

        return response()->json([
            'success' => true,
            'data'    => $result['data'],
            'meta'    => [
                'current_page' => $result['current_page'],
                'per_page'     => $result['per_page'],
                'total'        => $result['total'],
                'last_page'    => $result['last_page'],
            ],
        ]);
    }

    /**
     * GET /api/modem-router-logs/sn/{sn}
     */
    public function getBySn(Request $request, string $sn): JsonResponse
    {
        $timeline = $this->service->getTimelineBySn($sn, $this->organizationId($request));

        return response()->json([
            'success' => true,
            'sn'      => $sn,
            'data'    => $timeline,
        ]);
    }

    /**
     * GET /api/modem-router-logs/summary
     */
    public function summary(Request $request): JsonResponse
    {
        $summary = $this->service->getSummary($this->organizationId($request));

        return response()->json([
            'success' => true,
            'data'    => $summary,
        ]);
    }

    private function organizationId(Request $request): ?int
    {
        $user = $request->user();
        if ($user === null || (int) $user->role_id === self::SUPERADMIN_ROLE_ID) {
            return null;
        }

        return $user->organization_id !== null ? (int) $user->organization_id : null;
    }
}
