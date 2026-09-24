<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LCP;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;

class LcpApiController extends Controller
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
            $limit = min((int) $request->get('limit', 10), 1000);
            $search = $request->get('search', '');
            
            $query = LCP::query();

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
                $query->where('lcp_name', 'like', '%' . $search . '%');
            }
            
            $totalItems = $query->count();
            $totalPages = ceil($totalItems / $limit);
            
            $lcpItems = $query->orderBy('lcp_name')
                             ->skip(($page - 1) * $limit)
                             ->take($limit)
                             ->get();
            
            return response()->json([
                'success' => true,
                'data' => $lcpItems,
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
            \Log::error('LCP API Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error fetching LCP items: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'name' => 'required|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $name = $request->input('name');
            
            $existing = LCP::where('lcp_name', $name)->first();
            if ($existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'A LCP with this name already exists'
                ], 422);
            }
            
            $lcp = new LCP();
            $lcp->lcp_name = $name;
            $userId = $this->resolveUserId($request);
            $lcp->organization_id = $this->resolveUserOrgId($request);
            $lcp->created_by_user_id = $userId;
            $lcp->updated_by_user_id = $userId;
            $lcp->save();

            // Log Activity
            ActivityLog::log(
                'LCP Created',
                "New LCP created: {$name}",
                'info',
                [
                    'resource_type' => 'LCP',
                    'resource_id' => $lcp->id,
                    'additional_data' => $lcp->toArray()
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'LCP added successfully',
                'data' => $lcp
            ], 201);
            
        } catch (\Exception $e) {
            \Log::error('LCP Store Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error adding LCP: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $lcp = LCP::find($id);
            
            if (!$lcp) {
                return response()->json([
                    'success' => false,
                    'message' => 'LCP not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId(request());
            $isGlobalAdmin = $this->isGlobalAdmin(request());
            if (!$isGlobalAdmin) {
                if ($lcp->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized access to LCP'
                    ], 403);
                }
            } else {
                if ($lcp->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized access to LCP'
                    ], 403);
                }
            }
            
            return response()->json([
                'success' => true,
                'data' => $lcp
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching LCP: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $validator = Validator::make($request->all(), [
                'name' => 'required|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $lcp = LCP::find($id);
            if (!$lcp) {
                return response()->json([
                    'success' => false,
                    'message' => 'LCP not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);
            if (!$isGlobalAdmin) {
                if ($lcp->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to update this LCP'
                    ], 403);
                }
            } else {
                if ($lcp->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to update this LCP'
                    ], 403);
                }
            }
            
            $name = $request->input('name');
            
            $duplicate = LCP::where('lcp_name', $name)->where('id', '!=', $id)->first();
            if ($duplicate) {
                return response()->json([
                    'success' => false,
                    'message' => 'A LCP with this name already exists'
                ], 422);
            }
            
            $lcp->lcp_name = $name;
            $lcp->updated_by_user_id = $this->resolveUserId($request);
            $lcp->save();

            // Log Activity
            ActivityLog::log(
                'LCP Updated',
                "LCP updated: {$name} (ID: {$id})",
                'info',
                [
                    'resource_type' => 'LCP',
                    'resource_id' => $id,
                    'additional_data' => $lcp->toArray()
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'LCP updated successfully',
                'data' => $lcp
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating LCP: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $lcp = LCP::find($id);
            if (!$lcp) {
                return response()->json([
                    'success' => false,
                    'message' => 'LCP not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId(request());
            $isGlobalAdmin = $this->isGlobalAdmin(request());
            if (!$isGlobalAdmin) {
                if ($lcp->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to delete this LCP'
                    ], 403);
                }
            } else {
                if ($lcp->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to delete this LCP'
                    ], 403);
                }
            }
            
            $lcp->delete();
            
            // Log Activity
            ActivityLog::log(
                'LCP Deleted',
                "LCP deleted: {$lcp->lcp_name} (ID: {$id})",
                'warning',
                [
                    'resource_type' => 'LCP',
                    'resource_id' => $id,
                    'additional_data' => $lcp->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'LCP permanently deleted from database'
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting LCP: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics(Request $request)
    {
        try {
            $query = LCP::query();
            
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

            $totalLcp = $query->count();
            
            return response()->json([
                'success' => true,
                'data' => [
                    'total_lcp' => $totalLcp
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


