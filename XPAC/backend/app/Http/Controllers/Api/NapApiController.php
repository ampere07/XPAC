<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;

class NapApiController extends Controller
{
    /**
     * Get current user email from session/auth (fallback for now)
     */
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

    /**
     * Get all NAP items from app_nap table with pagination and search
     */
    public function index(Request $request)
    {
        try {
            // First check if table exists
            $tableExists = DB::select("SHOW TABLES LIKE 'nap'");
            if (empty($tableExists)) {
                return response()->json([
                    'success' => false,
                    'message' => 'nap table does not exist'
                ], 500);
            }

            // Get pagination parameters
            $page = (int) $request->get('page', 1);
            $limit = min((int) $request->get('limit', 10), 1000); // Max 1000 items per page
            $search = $request->get('search', '');
            
            $offset = ($page - 1) * $limit;

            // Build the base query
            $whereClause = 'WHERE 1=1';
            $params = [];

            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            if (!$isGlobalAdmin) {
                if ($orgId) {
                    $whereClause .= ' AND organization_id = ?';
                    $params[] = $orgId;
                } else {
                    $whereClause .= ' AND organization_id IS NULL';
                }
            } else {
                $whereClause .= ' AND organization_id IS NULL';
            }
            
            if (!empty($search)) {
                $whereClause .= ' AND nap_name LIKE ?';
                $params[] = '%' . $search . '%';
            }

            // Get total count
            $countQuery = "SELECT COUNT(*) as total FROM nap $whereClause";
            $totalResult = DB::select($countQuery, $params);
            $totalItems = $totalResult[0]->total ?? 0;
            
            // Calculate pagination
            $totalPages = ceil($totalItems / $limit);
            
            // Get paginated data
            $dataQuery = "SELECT id, nap_name, organization_id, created_at, updated_at 
                         FROM nap $whereClause 
                         ORDER BY nap_name 
                         LIMIT ? OFFSET ?";
            $dataParams = array_merge($params, [$limit, $offset]);
            
            $napItems = DB::select($dataQuery, $dataParams);
            
            return response()->json([
                'success' => true,
                'data' => $napItems,
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
            \Log::error('NAP API Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error fetching NAP items: ' . $e->getMessage(),
                'error_details' => [
                    'file' => $e->getFile(),
                    'line' => $e->getLine()
                ]
            ], 500);
        }
    }

    /**
     * Store a new NAP item in app_nap table
     */
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
            
            // Automatically set modified date and user
            $userId = $this->resolveUserId($request);
            $now = now();
            
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            // Check for duplicate NAP name in nap table within the same organization context
            $existingQuery = 'SELECT id FROM nap WHERE LOWER(nap_name) = LOWER(?)';
            $existingParams = [$name];

            if (!$isGlobalAdmin) {
                if ($orgId) {
                    $existingQuery .= ' AND organization_id = ?';
                    $existingParams[] = $orgId;
                } else {
                    $existingQuery .= ' AND organization_id IS NULL';
                }
            } else {
                $existingQuery .= ' AND organization_id IS NULL';
            }

            $existing = DB::select($existingQuery, $existingParams);
            if (!empty($existing)) {
                return response()->json([
                    'success' => false,
                    'message' => 'A NAP with this name already exists'
                ], 422);
            }
            
            // Insert new NAP
            $insertData = [
                'nap_name' => $name,
                'organization_id' => $orgId,
                'created_by_user_id' => $userId,
                'updated_by_user_id' => $userId,
                'created_at' => $now,
                'updated_at' => $now
            ];
            
            $id = DB::table('nap')->insertGetId($insertData);
            
            // Get the inserted record
            $nap = DB::select('SELECT id, nap_name, organization_id, created_at, updated_at FROM nap WHERE id = ?', [$id])[0];
            
            // Log Activity
            ActivityLog::log(
                'NAP Created',
                "New NAP created: {$name}",
                'info',
                [
                    'resource_type' => 'NAP',
                    'resource_id' => $id,
                    'additional_data' => $insertData
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'NAP added successfully',
                'data' => $nap
            ], 201);
            
        } catch (\Exception $e) {
            \Log::error('NAP Store Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error adding NAP: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Display the specified NAP from app_nap table
     */
    public function show($id)
    {
        try {
            $nap = DB::select('SELECT id, nap_name, organization_id, created_at, updated_at FROM nap WHERE id = ?', [$id]);
            
            if (empty($nap)) {
                return response()->json([
                    'success' => false,
                    'message' => 'NAP not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId(request());
            $isGlobalAdmin = $this->isGlobalAdmin(request());
            if (!$isGlobalAdmin) {
                if ($nap[0]->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized access to NAP'
                    ], 403);
                }
            } else {
                if ($nap[0]->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized access to NAP'
                    ], 403);
                }
            }
            
            return response()->json([
                'success' => true,
                'data' => $nap[0]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching NAP: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Update the specified NAP in app_nap table
     */
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

            // Check if NAP exists in nap table
            $existing = DB::select('SELECT * FROM nap WHERE id = ?', [$id]);
            if (empty($existing)) {
                return response()->json([
                    'success' => false,
                    'message' => 'NAP not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);
            if (!$isGlobalAdmin) {
                if ($existing[0]->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to update this NAP'
                    ], 403);
                }
            } else {
                if ($existing[0]->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to update this NAP'
                    ], 403);
                }
            }
            
            $name = $request->input('name');
            
            // Automatically set modified date and user
            $userId = $this->resolveUserId($request);
            $now = now();
            
            // Check for duplicate name (excluding current NAP)
            $dupQuery = 'SELECT id FROM nap WHERE LOWER(nap_name) = LOWER(?) AND id != ?';
            $dupParams = [$name, $id];

            if (!$isGlobalAdmin) {
                if ($orgId) {
                    $dupQuery .= ' AND organization_id = ?';
                    $dupParams[] = $orgId;
                } else {
                    $dupQuery .= ' AND organization_id IS NULL';
                }
            } else {
                $dupQuery .= ' AND organization_id IS NULL';
            }

            $duplicates = DB::select($dupQuery, $dupParams);
            if (!empty($duplicates)) {
                return response()->json([
                    'success' => false,
                    'message' => 'A NAP with this name already exists'
                ], 422);
            }
            
            // Update NAP
            $updateData = [
                'nap_name' => $name,
                'updated_at' => $now,
                'updated_by_user_id' => $userId
            ];
            
            DB::table('nap')->where('id', $id)->update($updateData);
            
            // Get updated record
            $nap = DB::select('SELECT id, nap_name, organization_id, created_at, updated_at FROM nap WHERE id = ?', [$id])[0];
            
            // Log Activity
            ActivityLog::log(
                'NAP Updated',
                "NAP updated: {$name} (ID: {$id})",
                'info',
                [
                    'resource_type' => 'NAP',
                    'resource_id' => $id,
                    'additional_data' => $updateData
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'NAP updated successfully',
                'data' => $nap
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating NAP: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * HARD DELETE - Permanently remove the specified NAP from app_nap table
     */
    public function destroy($id)
    {
        try {
            // Check if NAP exists
            $existing = DB::select('SELECT * FROM nap WHERE id = ?', [$id]);
            if (empty($existing)) {
                return response()->json([
                    'success' => false,
                    'message' => 'NAP not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId(request());
            $isGlobalAdmin = $this->isGlobalAdmin(request());
            if (!$isGlobalAdmin) {
                if ($existing[0]->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to delete this NAP'
                    ], 403);
                }
            } else {
                if ($existing[0]->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to delete this NAP'
                    ], 403);
                }
            }
            
            // HARD DELETE - permanently remove from database
            $deleted = DB::table('nap')->where('id', $id)->delete();
            
            if ($deleted) {
                // Log Activity
                ActivityLog::log(
                    'NAP Deleted',
                    "NAP deleted: {$existing[0]->nap_name} (ID: {$id})",
                    'warning',
                    [
                        'resource_type' => 'NAP',
                        'resource_id' => $id,
                        'additional_data' => (array)$existing[0]
                    ]
                );

                return response()->json([
                    'success' => true,
                    'message' => 'NAP permanently deleted from database'
                ]);
            } else {
                return response()->json([
                    'success' => false,
                    'message' => 'Failed to delete NAP from database'
                ], 500);
            }
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting NAP: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get NAP statistics from app_nap table
     */
    public function getStatistics(Request $request)
    {
        try {
            $whereClause = 'WHERE 1=1';
            $params = [];

            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            if (!$isGlobalAdmin) {
                if ($orgId) {
                    $whereClause .= ' AND organization_id = ?';
                    $params[] = $orgId;
                } else {
                    $whereClause .= ' AND organization_id IS NULL';
                }
            } else {
                $whereClause .= ' AND organization_id IS NULL';
            }

            $totalNap = DB::select("SELECT COUNT(*) as count FROM nap $whereClause", $params)[0]->count ?? 0;
            
            return response()->json([
                'success' => true,
                'data' => [
                    'total_nap' => (int) $totalNap
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

