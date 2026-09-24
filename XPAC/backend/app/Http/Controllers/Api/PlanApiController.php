<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;
use App\Models\User;

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
                    'plan_list.show_in_application',
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
                'price' => 'required|numeric|min:0',
                'show_in_application' => 'nullable|boolean'
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
            $now = now();
            
            $planId = DB::table('plan_list')->insertGetId([
                'plan_name' => $request->input('name'),
                'description' => $request->input('description', ''),
                'price' => $request->input('price'),
                // Defaults to visible when the client omits it — a plan is offered on the
                // application form unless someone deliberately hides it. boolean() rather than
                // input() so the JSON false, "0" and "false" all land as a real false.
                'show_in_application' => $request->boolean('show_in_application', true),
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
                    'plan_list.show_in_application',
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
                    'plan_list.show_in_application',
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
                'price' => 'required|numeric|min:0',
                'show_in_application' => 'nullable|boolean'
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
            
            $currentUserId = $this->resolveUserId($request);
            $now = now();
            
            $updates = [
                'plan_name' => $request->input('name'),
                'description' => $request->input('description', ''),
                'price' => $request->input('price'),
                'modified_date' => $now,
                'modified_by_user' => $currentUserId
            ];

            // Only written when the client actually sent it, so a partial update from an older
            // client cannot silently flip a deliberately hidden plan back into the form.
            if ($request->has('show_in_application')) {
                $updates['show_in_application'] = $request->boolean('show_in_application');
            }

            DB::table('plan_list')
                ->where('id', $id)
                ->update($updates);
            
            $plan = DB::table('plan_list')
                ->leftJoin('users', 'plan_list.modified_by_user', '=', 'users.id')
                ->select(
                    'plan_list.id',
                    'plan_list.plan_name as name',
                    'plan_list.description',
                    'plan_list.price',
                    'plan_list.show_in_application',
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

