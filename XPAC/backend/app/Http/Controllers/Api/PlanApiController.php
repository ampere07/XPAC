<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;
use App\Models\RadiusConfig;
use App\Models\User;
use App\Services\RadiusServerResolver;
use App\Services\RouterosApiService;
use Throwable;

class PlanApiController extends Controller
{
    private function resolveUserId(Request $request)
    {
        $userEmail = $request->input('email_address');
        $userId = auth()->id();

        if (!$userId && $userEmail) {
            $user = User::where('email_address', $userEmail)->first();
            if ($user) {
                $userId = $user->id;
            }
        }

        return $userId;
    }

    /**
     * The RADIUS device a plan for this organization is validated against.
     *
     * Plan names are the User Manager group names the router authenticates against, so
     * the first configured device for the organization is the authority on which names
     * are usable. No device configured means nothing to validate against.
     */
    private function activeRadiusConfig(?int $organizationId): ?RadiusConfig
    {
        return app(RadiusServerResolver::class)->orderedConfigs($organizationId)->first();
    }

    /**
     * Refuse a plan name that is not a User Manager group on the router.
     *
     * A plan whose name has no matching group cannot authenticate a subscriber, so it is
     * caught here rather than at the next disconnect. Returns the 422 body to send, or
     * null when the name is acceptable.
     *
     * Fails OPEN on an unreachable device: an outage must not stop an operator from
     * maintaining plans, and RadiusReconciliationService reports the mismatch afterwards.
     *
     * @return array<string, mixed>|null
     */
    private function planGroupValidationError(?string $planName, ?int $organizationId): ?array
    {
        $planName = trim((string) $planName);

        if ($planName === '') {
            return null;
        }

        try {
            $config = $this->activeRadiusConfig($organizationId);

            if (!$config) {
                return null;
            }

            $api = app(RouterosApiService::class);

            if ($api->groupExists($config, $planName)) {
                return null;
            }

            if ($api->getLastError() !== '') {
                Log::channel('radiusrelated')->warning(
                    '[Plan_API] Could not verify plan name against the router; allowing the change.',
                    [
                        'plan_name'        => $planName,
                        'radius_config_id' => $config->id,
                        'error'            => $api->getLastError(),
                    ]
                );

                return null;
            }
        } catch (Throwable $e) {
            Log::channel('radiusrelated')->warning(
                '[Plan_API] Plan name verification threw; allowing the change.',
                ['plan_name' => $planName, 'error' => $e->getMessage()]
            );

            return null;
        }

        return [
            'success' => false,
            'message' => 'Validation failed',
            'errors' => [
                'name' => [
                    "The plan name '" . $planName . "' does not exist as a User Manager group on the MikroTik router. Please create the group in MikroTik User Manager first."
                ]
            ]
        ];
    }

    /**
     * The User Manager group names available on the organization's RADIUS device.
     *
     * Backs the plan form so an operator picks an existing group instead of typing a
     * name the router will reject.
     */
    public function getMikrotikGroups(Request $request)
    {
        try {
            $user = User::find($this->resolveUserId($request));
            $organizationId = $user ? $user->organization_id : null;

            $config = $this->activeRadiusConfig($organizationId);

            if (!$config) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'message' => 'No RADIUS server is configured, so no User Manager groups could be read.'
                ]);
            }

            $api = app(RouterosApiService::class);
            $groups = $api->getGroups($config);

            $response = [
                'success' => true,
                'data' => $groups
            ];

            if ($groups === [] && $api->getLastError() !== '') {
                $response['message'] = 'The RADIUS server could not be reached: ' . $api->getLastError();
            }

            return response()->json($response);

        } catch (\Exception $e) {
            Log::channel('radiusrelated')->error('[Plan_API] Failed to read User Manager groups: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Error fetching MikroTik user groups: ' . $e->getMessage()
            ], 500);
        }
    }

    public function index(Request $request)
    {
        try {
            $userId = $this->resolveUserId($request);
            $user = User::find($userId);

            $query = DB::table('plan_list')
                ->leftJoin('users', 'plan_list.modified_by_user', '=', 'users.id')
                ->select(
                    'plan_list.id',
                    'plan_list.plan_name as name',
                    'plan_list.description',
                    'plan_list.price',
                    'plan_list.organization_id',
                    'plan_list.modified_date',
                    'users.email_address as modified_by'
                );

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        $query->where('plan_list.organization_id', $user->organization_id);
                    } else {
                        $query->whereNull('plan_list.organization_id');
                    }
                } else {
                    $query->whereNull('plan_list.organization_id');
                }
            }

            $plans = $query->orderBy('plan_list.plan_name')->get();
            
            return response()->json([
                'success' => true,
                'data' => $plans
            ]);
            
        } catch (\Exception $e) {
            \Log::error('Plan API Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error fetching plans: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'name' => 'required|string|max:255|unique:plan_list,plan_name',
                'description' => 'nullable|string',
                'price' => 'required|numeric|min:0'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $currentUserId = $this->resolveUserId($request);
            $user = User::find($currentUserId);
            $organizationId = $user ? $user->organization_id : null;

            // The plan name IS the RADIUS group a subscriber is authenticated into, so a
            // name with no matching User Manager group is rejected before it is stored.
            $groupError = $this->planGroupValidationError($request->input('name'), $organizationId);
            if ($groupError !== null) {
                return response()->json($groupError, 422);
            }

            $now = now();

            $planId = DB::table('plan_list')->insertGetId([
                'plan_name' => $request->input('name'),
                'description' => $request->input('description', ''),
                'price' => $request->input('price'),
                'organization_id' => $organizationId,
                'modified_date' => $now,
                'modified_by_user' => $currentUserId
            ]);
            
            $plan = DB::table('plan_list')
                ->leftJoin('users', 'plan_list.modified_by_user', '=', 'users.id')
                ->select(
                    'plan_list.id',
                    'plan_list.plan_name as name',
                    'plan_list.description',
                    'plan_list.price',
                    'plan_list.organization_id',
                    'plan_list.modified_date',
                    'users.email_address as modified_by'
                )
                ->where('plan_list.id', $planId)
                ->first();

            // Create Activity Log
            ActivityLog::log(
                'Plan Created',
                "New Plan created: {$plan->name} (₱{$plan->price})",
                'info',
                [
                    'resource_type' => 'Plan',
                    'resource_id' => $plan->id,
                    'additional_data' => (array) $plan
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'Plan added successfully',
                'data' => $plan
            ], 201);
            
        } catch (\Exception $e) {
            \Log::error('Plan Store Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error adding plan: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $plan = DB::table('plan_list')
                ->leftJoin('users', 'plan_list.modified_by_user', '=', 'users.id')
                ->select(
                    'plan_list.id',
                    'plan_list.plan_name as name',
                    'plan_list.description',
                    'plan_list.price',
                    'plan_list.modified_date',
                    'users.email_address as modified_by'
                )
                ->where('plan_list.id', $id)
                ->first();
            
            if (!$plan) {
                return response()->json([
                    'success' => false,
                    'message' => 'Plan not found'
                ], 404);
            }
            
            return response()->json([
                'success' => true,
                'data' => $plan
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching plan: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $validator = Validator::make($request->all(), [
                'name' => 'required|string|max:255',
                'description' => 'nullable|string',
                'price' => 'required|numeric|min:0'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $existing = DB::table('plan_list')->where('id', $id)->first();
            if (!$existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'Plan not found'
                ], 404);
            }

            // Authorization check
            $currentUserId = $this->resolveUserId($request);
            $user = User::find($currentUserId);
            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        if ($existing->organization_id !== $user->organization_id) {
                            return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update plans within your organization.'], 403);
                        }
                    } else {
                        if ($existing->organization_id !== null) {
                            return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update plans without an organization.'], 403);
                        }
                    }
                }
            }
            
            $duplicate = DB::table('plan_list')
                ->where('plan_name', $request->input('name'))
                ->where('id', '!=', $id)
                ->first();
                
            if ($duplicate) {
                return response()->json([
                    'success' => false,
                    'message' => 'A plan with this name already exists'
                ], 422);
            }

            // Validated against the estate the PLAN belongs to, not the operator's, so a
            // global admin editing an organization's plan is checked on that organization's
            // router.
            $planOrganizationId = $existing->organization_id !== null
                ? (int) $existing->organization_id
                : ($user ? $user->organization_id : null);

            $groupError = $this->planGroupValidationError($request->input('name'), $planOrganizationId);
            if ($groupError !== null) {
                return response()->json($groupError, 422);
            }

            $currentUserId = $this->resolveUserId($request);
            $now = now();

            DB::table('plan_list')
                ->where('id', $id)
                ->update([
                    'plan_name' => $request->input('name'),
                    'description' => $request->input('description', ''),
                    'price' => $request->input('price'),
                    'modified_date' => $now,
                    'modified_by_user' => $currentUserId
                ]);
            
            $plan = DB::table('plan_list')
                ->leftJoin('users', 'plan_list.modified_by_user', '=', 'users.id')
                ->select(
                    'plan_list.id',
                    'plan_list.plan_name as name',
                    'plan_list.description',
                    'plan_list.price',
                    'plan_list.modified_date',
                    'users.email_address as modified_by'
                )
                ->where('plan_list.id', $id)
                ->first();

            // Create Activity Log
            ActivityLog::log(
                'Plan Updated',
                "Plan updated: {$plan->name} (₱{$plan->price})",
                'info',
                [
                    'resource_type' => 'Plan',
                    'resource_id' => $id,
                    'additional_data' => (array) $plan
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'Plan updated successfully',
                'data' => $plan
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating plan: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $existing = DB::table('plan_list')->where('id', $id)->first();
            if (!$existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'Plan not found'
                ], 404);
            }

            // Authorization check
            $userId = $this->resolveUserId(request());
            $user = User::find($userId);
            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        if ($existing->organization_id !== $user->organization_id) {
                            return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete plans within your organization.'], 403);
                        }
                    } else {
                        if ($existing->organization_id !== null) {
                            return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete plans without an organization.'], 403);
                        }
                    }
                }
            }
            
            $planData = (array) $existing;
            DB::table('plan_list')->where('id', $id)->delete();

            // Create Activity Log
            ActivityLog::log(
                'Plan Deleted',
                "Plan deleted: {$planData['plan_name']} (ID: {$id})",
                'warning',
                [
                    'resource_type' => 'Plan',
                    'resource_id' => $id,
                    'additional_data' => $planData
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'Plan permanently deleted from database'
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting plan: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics()
    {
        try {
            $totalPlans = DB::table('plan_list')->count();
            $avgPrice = DB::table('plan_list')->avg('price') ?? 0;
            $minPrice = DB::table('plan_list')->min('price') ?? 0;
            $maxPrice = DB::table('plan_list')->max('price') ?? 0;
            
            return response()->json([
                'success' => true,
                'data' => [
                    'total_plans' => $totalPlans,
                    'average_price' => round($avgPrice, 2),
                    'min_price' => $minPrice,
                    'max_price' => $maxPrice
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error getting statistics: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getAllPlans()
    {
        return $this->index();
    }

    public function restore($id)
    {
        return response()->json([
            'success' => false,
            'message' => 'Restore not implemented - using hard deletes'
        ], 501);
    }

    public function forceDelete($id)
    {
        return $this->destroy($id);
    }
}

