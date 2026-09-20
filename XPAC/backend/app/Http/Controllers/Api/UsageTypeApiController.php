<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UsageType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;

class UsageTypeApiController extends Controller
{
    private function resolveUserId(Request $request)
    {
        $email = $request->input('email_address') ?? $request->input('created_by') ?? $request->input('updated_by') ?? $request->input('modified_by');
        
        if ($email) {
            $user = \App\Models\User::where('email_address', $email)->first();
            if ($user) {
                return $user->id;
            }
        }

        if (\Auth::check()) {
            return \Auth::id();
        }

        return null;
    }

    private function resolveUserOrgId(Request $request)
    {
        $email = $request->input('email_address') ?? $request->input('created_by') ?? $request->input('updated_by') ?? $request->input('modified_by');
        
        if ($email) {
            $user = \App\Models\User::where('email_address', $email)->first();
            if ($user) {
                return $user->organization_id;
            }
        }

        if (\Auth::check()) {
            return \Auth::user()->organization_id;
        }

        return null;
    }

    private function isGlobalAdmin(Request $request)
    {
        $email = $request->input('email_address') ?? $request->input('created_by') ?? $request->input('updated_by') ?? $request->input('modified_by');
        
        if ($email) {
            $user = \App\Models\User::where('email_address', $email)->first();
            if ($user) {
                return $user->role_id == 7 && $user->organization_id === null;
            }
        }

        if (\Auth::check()) {
            $user = \Auth::user();
            return $user->role_id == 7 && $user->organization_id === null;
        }

        return false;
    }

    public function index(Request $request)
    {
        try {
            $page = (int) $request->get('page', 1);
            $limit = min((int) $request->get('limit', 100), 100);
            $search = $request->get('search', '');
            
            $query = UsageType::query();

            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            if (!$isGlobalAdmin) {
                if ($orgId) {
                    $query->where('organization_id', $orgId);
                } else {
                    $query->whereNull('organization_id');
                }
            } else {
                $query->whereNull('organization_id');
            }
            
            if (!empty($search)) {
                $query->where('usage_name', 'like', '%' . $search . '%');
            }
            
            $totalItems = $query->count();
            $totalPages = ceil($totalItems / $limit);
            
            $usageTypes = $query->orderBy('usage_name')
                             ->skip(($page - 1) * $limit)
                             ->take($limit)
                             ->get();
            
            return response()->json([
                'success' => true,
                'data' => $usageTypes,
                'pagination' => [
                    'current_page' => $page,
                    'total_pages' => $totalPages,
                    'total_items' => $totalItems,
                    'items_per_page' => $limit,
                    'has_next' => $page < $totalPages,
                    'has_prev' => $page > 1
                ]
            ]);
            
        } catch (\Exception $e) {
            \Log::error('UsageType API Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error fetching usage types: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            $validator = Validator::make($request->all(), [
                'usage_name' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) use ($orgId, $isGlobalAdmin) {
                        $existsQuery = UsageType::where('usage_name', $value);
                        if (!$isGlobalAdmin) {
                            if ($orgId) {
                                $existsQuery->where('organization_id', $orgId);
                            } else {
                                $existsQuery->whereNull('organization_id');
                            }
                        } else {
                            $existsQuery->whereNull('organization_id');
                        }
                        
                        if ($existsQuery->exists()) {
                            $fail('The usage name has already been taken.');
                        }
                    },
                ],
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }
            
            $usageType = new UsageType();
            $usageType->usage_name = $request->input('usage_name');
            $usageType->organization_id = $orgId;
            $userId = $this->resolveUserId($request);
            $usageType->created_by_user_id = $userId;
            $usageType->updated_by_user_id = $userId;
            $usageType->save();
            
            // Log Activity
            ActivityLog::log(
                'Usage Type Created',
                "New Usage Type created: {$usageType->usage_name} by " . (auth()->user()->email ?? 'System'),
                'info',
                [
                    'resource_type' => 'UsageType',
                    'resource_id' => $usageType->id,
                    'additional_data' => $usageType->toArray()
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'Usage type added successfully',
                'data' => $usageType
            ], 201);
            
        } catch (\Exception $e) {
            \Log::error('UsageType Store Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error adding usage type: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $usageType = UsageType::find($id);
            
            if (!$usageType) {
                return response()->json([
                    'success' => false,
                    'message' => 'Usage type not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId(request());
            $isGlobalAdmin = $this->isGlobalAdmin(request());
            if (!$isGlobalAdmin) {
                if ($usageType->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized access to usage type'
                    ], 403);
                }
            } else {
                if ($usageType->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized access to usage type'
                    ], 403);
                }
            }
            
            return response()->json([
                'success' => true,
                'data' => $usageType
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching usage type: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            $validator = Validator::make($request->all(), [
                'usage_name' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) use ($id, $orgId, $isGlobalAdmin) {
                        $existsQuery = UsageType::where('usage_name', $value)->where('id', '!=', $id);
                        if (!$isGlobalAdmin) {
                            if ($orgId) {
                                $existsQuery->where('organization_id', $orgId);
                            } else {
                                $existsQuery->whereNull('organization_id');
                            }
                        } else {
                            $existsQuery->whereNull('organization_id');
                        }
                        
                        if ($existsQuery->exists()) {
                            $fail('The usage name has already been taken.');
                        }
                    },
                ],
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $usageType = UsageType::find($id);
            if (!$usageType) {
                return response()->json([
                    'success' => false,
                    'message' => 'Usage type not found'
                ], 404);
            }

            // Authorization check
            if (!$isGlobalAdmin) {
                if ($usageType->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to update this usage type'
                    ], 403);
                }
            } else {
                if ($usageType->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to update this usage type'
                    ], 403);
                }
            }
            
            $usageType->usage_name = $request->input('usage_name');
            $usageType->updated_by_user_id = $this->resolveUserId($request);
            $usageType->save();
            
            // Log Activity
            ActivityLog::log(
                'Usage Type Updated',
                "Usage Type updated: {$usageType->usage_name} (ID: {$id}) by " . (auth()->user()->email ?? 'System'),
                'info',
                [
                    'resource_type' => 'UsageType',
                    'resource_id' => $id,
                    'additional_data' => $usageType->toArray()
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'Usage type updated successfully',
                'data' => $usageType
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating usage type: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $usageType = UsageType::find($id);
            if (!$usageType) {
                return response()->json([
                    'success' => false,
                    'message' => 'Usage type not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId(request());
            $isGlobalAdmin = $this->isGlobalAdmin(request());
            if (!$isGlobalAdmin) {
                if ($usageType->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to delete this usage type'
                    ], 403);
                }
            } else {
                if ($usageType->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to delete this usage type'
                    ], 403);
                }
            }
            
            $usageTypeData = $usageType->toArray();
            $usageType->delete();
            
            // Log Activity
            ActivityLog::log(
                'Usage Type Deleted',
                "Usage Type deleted: {$usageTypeData['usage_name']} (ID: {$id}) by " . (auth()->user()->email ?? 'System'),
                'warning',
                [
                    'resource_type' => 'UsageType',
                    'resource_id' => $id,
                    'additional_data' => $usageTypeData
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'Usage type permanently deleted from database'
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting usage type: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics(Request $request)
    {
        try {
            $query = UsageType::query();
            
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            if (!$isGlobalAdmin) {
                if ($orgId) {
                    $query->where('organization_id', $orgId);
                } else {
                    $query->whereNull('organization_id');
                }
            } else {
                $query->whereNull('organization_id');
            }

            $totalUsageTypes = $query->count();
            
            return response()->json([
                'success' => true,
                'data' => [
                    'total_usage_types' => $totalUsageTypes
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error getting statistics: ' . $e->getMessage()
            ], 500);
        }
    }
}
