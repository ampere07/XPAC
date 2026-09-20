<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Promo;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use App\Models\ActivityLog;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class PromoApiController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $user = auth()->user();
            if (!$user && request()->input('email_address')) {
                $user = User::where('email_address', request()->input('email_address'))->first();
            }

            $query = Promo::leftJoin('users as creators', 'promo_list.created_by_user_id', '=', 'creators.id')
                ->leftJoin('users as updaters', 'promo_list.updated_by_user_id', '=', 'updaters.id')
                ->select(
                    'promo_list.*',
                    'creators.email_address as creator_email',
                    'updaters.email_address as updater_email'
                );

            if ($user) {
                $roleId = $user->role_id;
                $organizationId = $user->organization_id;

                // A Global Admin has role_id 7 AND no organization_id
                $isGlobalAdmin = ($roleId == 7 && $organizationId === null);

                if (!$isGlobalAdmin) {
                    if ($organizationId) {
                        $query->where('promo_list.organization_id', $organizationId);
                    } else {
                        $query->whereNull('promo_list.organization_id');
                    }
                } else {
                    // Global admin can only see promos with no organization
                    $query->whereNull('promo_list.organization_id');
                }
            }

            $promos = $query->orderBy('promo_list.name', 'asc')->get();

            $formattedPromos = $promos->map(function ($promo) {
                return [
                    'id' => $promo->id,
                    'promo_name' => $promo->name,
                    'name' => $promo->name,
                    'description' => $promo->status,
                    'status' => $promo->status,
                    'organization_id' => $promo->organization_id,
                    'created_at' => $promo->created_at ? $promo->created_at->format('Y-m-d H:i:s') : null,
                    'updated_at' => $promo->updated_at ? $promo->updated_at->format('Y-m-d H:i:s') : null,
                    'creator_email' => $promo->creator_email,
                    'updater_email' => $promo->updater_email,
                ];
            });

            return response()->json([
                'success' => true,
                'data' => $formattedPromos,
            ]);
        } catch (\Exception $e) {
            Log::error('PromoApiController index error: ' . $e->getMessage());
            Log::error('Trace: ' . $e->getTraceAsString());

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch promos',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'name' => 'required|string|max:255',
                'status' => 'nullable|string|max:100',
            ]);

            $userEmail = $request->input('email_address');
            $user = auth()->user();
            $userId = $user ? $user->id : null;
            $organizationId = $user ? $user->organization_id : null;

            if (!$userId && $userEmail) {
                $user = User::where('email_address', $userEmail)->first();
                if ($user) {
                    $userId = $user->id;
                    $organizationId = $user->organization_id;
                }
            }

            $validated['created_by_user_id'] = $userId;
            $validated['updated_by_user_id'] = $userId;
            $validated['organization_id'] = $organizationId;

            $promo = Promo::create($validated);

            // Create Activity Log
            ActivityLog::log(
                'Promo Created',
                "New Promo created: {$validated['name']} (Status: " . ($validated['status'] ?? 'N/A') . ")",
                'info',
                [
                    'resource_type' => 'Promo',
                    'resource_id' => $promo->id,
                    'additional_data' => [
                        'name' => $validated['name'],
                        'status' => $validated['status']
                    ]
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Promo created successfully',
                'data' => [
                    'id' => $promo->id,
                    'promo_name' => $promo->name,
                    'name' => $promo->name,
                    'description' => $promo->status,
                    'status' => $promo->status,
                ],
            ], 201);
        } catch (\Exception $e) {
            Log::error('PromoApiController store error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to create promo',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function show($id): JsonResponse
    {
        try {
            $promo = Promo::findOrFail($id);

            return response()->json([
                'success' => true,
                'data' => [
                    'id' => $promo->id,
                    'promo_name' => $promo->name,
                    'name' => $promo->name,
                    'description' => $promo->status,
                    'status' => $promo->status,
                ],
            ]);
        } catch (\Exception $e) {
            Log::error('PromoApiController show error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Promo not found',
                'error' => $e->getMessage(),
            ], 404);
        }
    }

    public function update(Request $request, $id): JsonResponse
    {
        try {
            $promo = Promo::findOrFail($id);

            $validated = $request->validate([
                'name' => 'sometimes|required|string|max:255',
                'status' => 'nullable|string|max:100',
            ]);

            $userEmail = $request->input('email_address');
            $user = auth()->user();
            $userId = $user ? $user->id : null;
            $userOrgId = $user ? $user->organization_id : null;

            if (!$userId && $userEmail) {
                $authUser = User::where('email_address', $userEmail)->first();
                if ($authUser) {
                    $userId = $authUser->id;
                    $userOrgId = $authUser->organization_id;
                }
            }

            // Authorization check
            $isGlobalAdmin = (auth()->user() && auth()->user()->role_id == 7 && auth()->user()->organization_id === null);
            if (!$isGlobalAdmin) {
                if ($userOrgId) {
                    if ($promo->organization_id !== $userOrgId) {
                        return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update promos within your organization.'], 403);
                    }
                } else {
                    if ($promo->organization_id !== null) {
                        return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update promos without an organization.'], 403);
                    }
                }
            }

            $validated['updated_by_user_id'] = $userId;

            $promo->update($validated);

            // Create Activity Log
            ActivityLog::log(
                'Promo Updated',
                "Promo #{$id} updated: " . ($validated['name'] ?? $promo->name) . " (Status: " . ($validated['status'] ?? $promo->status) . ")",
                'info',
                [
                    'resource_type' => 'Promo',
                    'resource_id' => $id,
                    'additional_data' => $validated
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Promo updated successfully',
                'data' => [
                    'id' => $promo->id,
                    'promo_name' => $promo->name,
                    'name' => $promo->name,
                    'description' => $promo->status,
                    'status' => $promo->status,
                ],
            ]);
        } catch (\Exception $e) {
            Log::error('PromoApiController update error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to update promo',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function destroy($id): JsonResponse
    {
        try {
            $promo = Promo::findOrFail($id);

            // Authorization check
            $user = auth()->user();
            if (!$user && request()->input('email_address')) {
                $user = User::where('email_address', request()->input('email_address'))->first();
            }

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        if ($promo->organization_id !== $user->organization_id) {
                            return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete promos within your organization.'], 403);
                        }
                    } else {
                        if ($promo->organization_id !== null) {
                            return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete promos without an organization.'], 403);
                        }
                    }
                }
            }

            $promoName = $promo->name;
            $promo->delete();

            // Create Activity Log
            ActivityLog::log(
                'Promo Deleted',
                "Promo #{$id} deleted: {$promoName}",
                'warning',
                [
                    'resource_type' => 'Promo',
                    'resource_id' => $id,
                    'additional_data' => [
                        'name' => $promoName
                    ]
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Promo deleted successfully',
            ]);
        } catch (\Exception $e) {
            Log::error('PromoApiController destroy error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to delete promo',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}

