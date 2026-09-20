<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\VLAN;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class VlanApiController extends Controller
{
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

    private function applyOrgScope($query, $orgId, $isGlobalAdmin)
    {
        if (!$isGlobalAdmin) {
            if ($orgId) {
                $query->where('organization_id', $orgId);
            } else {
                $query->whereNull('organization_id');
            }
        } else {
            $query->whereNull('organization_id');
        }

        return $query;
    }

    public function index(Request $request)
    {
        try {
            $page = (int) $request->get('page', 1);
            $limit = min((int) $request->get('limit', 100), 100);
            $search = $request->get('search', '');

            $query = VLAN::query();

            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);
            $this->applyOrgScope($query, $orgId, $isGlobalAdmin);

            if (!empty($search)) {
                $query->where('value', 'like', '%' . $search . '%');
            }

            $totalItems = $query->count();
            $totalPages = $limit > 0 ? ceil($totalItems / $limit) : 1;

            $vlanItems = $query->orderBy('value')
                             ->skip(($page - 1) * $limit)
                             ->take($limit)
                             ->get();

            return response()->json([
                'success' => true,
                'data' => $vlanItems,
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
            \Log::error('VLAN API Error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Error fetching VLAN items: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            $validator = Validator::make($request->all(), [
                'value' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) use ($orgId, $isGlobalAdmin) {
                        $existsQuery = VLAN::where('value', $value);
                        $this->applyOrgScope($existsQuery, $orgId, $isGlobalAdmin);
                        if ($existsQuery->exists()) {
                            $fail('This VLAN already exists.');
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

            $vlan = new VLAN();
            $vlan->value = $request->input('value');
            $vlan->organization_id = $orgId;
            $vlan->save();

            return response()->json([
                'success' => true,
                'message' => 'VLAN added successfully',
                'data' => $vlan
            ], 201);

        } catch (\Exception $e) {
            \Log::error('VLAN Store Error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Error adding VLAN: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show(Request $request, $id)
    {
        try {
            $vlan = VLAN::find($id);

            if (!$vlan) {
                return response()->json([
                    'success' => false,
                    'message' => 'VLAN not found'
                ], 404);
            }

            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);
            if (!$isGlobalAdmin ? ($vlan->organization_id != $orgId) : ($vlan->organization_id !== null)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to VLAN'
                ], 403);
            }

            return response()->json([
                'success' => true,
                'data' => $vlan
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching VLAN: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            $validator = Validator::make($request->all(), [
                'value' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) use ($id, $orgId, $isGlobalAdmin) {
                        $existsQuery = VLAN::where('value', $value)->where('id', '!=', $id);
                        $this->applyOrgScope($existsQuery, $orgId, $isGlobalAdmin);
                        if ($existsQuery->exists()) {
                            $fail('This VLAN already exists.');
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

            $vlan = VLAN::find($id);
            if (!$vlan) {
                return response()->json([
                    'success' => false,
                    'message' => 'VLAN not found'
                ], 404);
            }

            if (!$isGlobalAdmin ? ($vlan->organization_id != $orgId) : ($vlan->organization_id !== null)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized to update this VLAN'
                ], 403);
            }

            $vlan->value = $request->input('value');
            $vlan->save();

            return response()->json([
                'success' => true,
                'message' => 'VLAN updated successfully',
                'data' => $vlan
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating VLAN: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy(Request $request, $id)
    {
        try {
            $vlan = VLAN::find($id);
            if (!$vlan) {
                return response()->json([
                    'success' => false,
                    'message' => 'VLAN not found'
                ], 404);
            }

            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);
            if (!$isGlobalAdmin ? ($vlan->organization_id != $orgId) : ($vlan->organization_id !== null)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized to delete this VLAN'
                ], 403);
            }

            $vlan->delete();

            return response()->json([
                'success' => true,
                'message' => 'VLAN permanently deleted from database'
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting VLAN: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics(Request $request)
    {
        try {
            $query = VLAN::query();
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);
            $this->applyOrgScope($query, $orgId, $isGlobalAdmin);

            return response()->json([
                'success' => true,
                'data' => [
                    'total_vlan' => $query->count()
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
