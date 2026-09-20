<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WorkOrderCategory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;

class WorkOrderCategoryApiController extends Controller
{
    private function resolveUserOrgId(Request $request)
    {
        $email = $request->input('email_address') ?? $request->input('created_by') ?? $request->input('updated_by');

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
        $email = $request->input('email_address') ?? $request->input('created_by') ?? $request->input('updated_by');

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

            $query = WorkOrderCategory::query();

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
                $query->where('category', 'like', '%' . $search . '%');
            }

            $totalItems = $query->count();
            $totalPages = ceil($totalItems / $limit);

            $categories = $query->orderBy('category')
                             ->skip(($page - 1) * $limit)
                             ->take($limit)
                             ->get();

            return response()->json([
                'success' => true,
                'data' => $categories,
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
            \Log::error('WorkOrderCategory API Error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Error fetching work categories: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            $validator = Validator::make($request->all(), [
                'category' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) use ($orgId, $isGlobalAdmin) {
                        $existsQuery = WorkOrderCategory::where('category', $value);
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
                            $fail('The category has already been taken.');
                        }
                    },
                ],
                'created_by' => 'nullable|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $category = new WorkOrderCategory();
            $category->category = $request->input('category');
            $category->created_by = $request->input('email_address', 'system');
            $category->organization_id = $orgId;
            $category->save();

            // Log Activity
            ActivityLog::log(
                'Work Category Created',
                "New Work Category created: {$category->category}",
                'info',
                [
                    'resource_type' => 'WorkOrderCategory',
                    'resource_id' => $category->id,
                    'additional_data' => $category->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Work category added successfully',
                'data' => $category
            ], 201);

        } catch (\Exception $e) {
            \Log::error('WorkOrderCategory Store Error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Error adding work category: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $category = WorkOrderCategory::find($id);
            
            if (!$category) {
                return response()->json([
                    'success' => false,
                    'message' => 'Work category not found'
                ], 404);
            }
            
            return response()->json([
                'success' => true,
                'data' => $category
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching work category: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            $validator = Validator::make($request->all(), [
                'category' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) use ($id, $orgId, $isGlobalAdmin) {
                        $existsQuery = WorkOrderCategory::where('category', $value)->where('id', '!=', $id);
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
                            $fail('The category has already been taken.');
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

            $category = WorkOrderCategory::find($id);
            if (!$category) {
                return response()->json([
                    'success' => false,
                    'message' => 'Work category not found'
                ], 404);
            }

            // Authorization check
            if (!$isGlobalAdmin) {
                if ($orgId) {
                    if ($category->organization_id !== $orgId) {
                        return response()->json(['success' => false, 'message' => 'Unauthorized to update this work category'], 403);
                    }
                } else {
                    if ($category->organization_id !== null) {
                        return response()->json(['success' => false, 'message' => 'Unauthorized to update this work category'], 403);
                    }
                }
            } else {
                if ($category->organization_id !== null) {
                    return response()->json(['success' => false, 'message' => 'Unauthorized to update this work category'], 403);
                }
            }

            $category->category = $request->input('category');
            $category->save();

            // Log Activity
            ActivityLog::log(
                'Work Category Updated',
                "Work Category updated: {$category->category} (ID: {$id})",
                'info',
                [
                    'resource_type' => 'WorkOrderCategory',
                    'resource_id' => $id,
                    'additional_data' => $category->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Work category updated successfully',
                'data' => $category
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating work category: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $category = WorkOrderCategory::find($id);
            if (!$category) {
                return response()->json([
                    'success' => false,
                    'message' => 'Work category not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId(request());
            $isGlobalAdmin = $this->isGlobalAdmin(request());
            if (!$isGlobalAdmin) {
                if ($orgId) {
                    if ($category->organization_id !== $orgId) {
                        return response()->json(['success' => false, 'message' => 'Unauthorized to delete this work category'], 403);
                    }
                } else {
                    if ($category->organization_id !== null) {
                        return response()->json(['success' => false, 'message' => 'Unauthorized to delete this work category'], 403);
                    }
                }
            } else {
                if ($category->organization_id !== null) {
                    return response()->json(['success' => false, 'message' => 'Unauthorized to delete this work category'], 403);
                }
            }

            $categoryData = $category->toArray();
            $category->delete();

            // Log Activity
            ActivityLog::log(
                'Work Category Deleted',
                "Work Category deleted: {$categoryData['category']} (ID: {$id})",
                'warning',
                [
                    'resource_type' => 'WorkOrderCategory',
                    'resource_id' => $id,
                    'additional_data' => $categoryData
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Work category permanently deleted from database'
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting work category: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics(Request $request)
    {
        try {
            $query = WorkOrderCategory::query();

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

            $total = $query->count();

            return response()->json([
                'success' => true,
                'data' => [
                    'total_work_categories' => $total
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

