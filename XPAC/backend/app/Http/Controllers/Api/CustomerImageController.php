<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Services\CustomerImageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Customer Images (Billing): every image stored against a customer, across all modules.
 * See App\Support\CustomerImageSources for where they are collected from.
 */
class CustomerImageController extends Controller
{
    public function __construct(private CustomerImageService $service)
    {
    }

    /** GET /customer-images?search=&page=&per_page=&with_images=1 — customers, paginated. */
    public function index(Request $request): JsonResponse
    {
        if ($denied = $this->denyWithoutPermission()) {
            return $denied;
        }

        try {
            $perPage = min(100, max(1, (int) $request->query('per_page', 24)));
            $result = $this->service->listCustomers(
                $request->query('search'),
                max(1, (int) $request->query('page', 1)),
                $perPage,
                $this->organizationId(),
                $request->query('with_images', '1') !== '0'
            );

            return response()->json(['success' => true] + $result + ['sources' => $this->service->sourceLabels()]);
        } catch (\Throwable $e) {
            Log::error('[CUSTOMER IMAGES] List failed: ' . $e->getMessage());
            return response()->json(['success' => false, 'message' => 'Failed to load customer images.'], 500);
        }
    }

    /** GET /customer-images/{accountNo} — every image of one customer. */
    public function show(string $accountNo): JsonResponse
    {
        if ($denied = $this->denyWithoutPermission()) {
            return $denied;
        }

        try {
            $result = $this->service->customerImages($accountNo, $this->organizationId());
            if (!$result) {
                return response()->json(['success' => false, 'message' => 'Customer not found.'], 404);
            }

            return response()->json(['success' => true, 'data' => $result]);
        } catch (\Throwable $e) {
            Log::error("[CUSTOMER IMAGES] Load failed for {$accountNo}: " . $e->getMessage());
            return response()->json(['success' => false, 'message' => 'Failed to load this customer\'s images.'], 500);
        }
    }

    /**
     * Checked here, not left to ApiAccessControl, which only logs on this deployment: the page
     * shows every customer's ID photos, so it must never answer a user without the page key
     * (a customer signed into the portal, for one).
     */
    private function denyWithoutPermission(): ?JsonResponse
    {
        return \App\Support\Permissions::allows(auth()->user(), 'customer-images')
            ? null
            : response()->json(['success' => false, 'message' => 'You do not have permission to view customer images.'], 403);
    }

    /** SuperAdmin (or a user with no organisation) sees every organisation. */
    private function organizationId(): ?int
    {
        $user = auth()->user();
        if (!$user || (int) ($user->role_id ?? 0) === Role::SUPER_ADMIN || empty($user->organization_id)) {
            return null;
        }

        return (int) $user->organization_id;
    }
}
