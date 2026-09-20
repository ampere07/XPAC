<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LCPNAPLocation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Exception;
use Illuminate\Support\Facades\Auth;

class LCPNAPApiController extends Controller
{
    public function index(Request $request)
    {
        try {
            $page = $request->input('page', 1);
            $limit = $request->input('limit', 100);
            $search = $request->input('search', '');

            $query = LCPNAPLocation::query();

            // Apply organization filter
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            if ($search) {
                $query->where('lcpnap_name', 'LIKE', "%{$search}%");
            }

            $total = $query->count();
            
            $locations = $query->skip(($page - 1) * $limit)
                ->take($limit)
                ->get();

            return response()->json([
                'success' => true,
                'data' => $locations,
                'pagination' => [
                    'current_page' => (int) $page,
                    'total_pages' => (int) ceil($total / $limit),
                    'total_items' => $total,
                    'per_page' => (int) $limit,
                    'from' => (($page - 1) * $limit) + 1,
                    'to' => min($page * $limit, $total)
                ]
            ]);

        } catch (Exception $e) {
            Log::error('LCP/NAP API error', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch LCP/NAP records',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $query = LCPNAPLocation::query();
            
            // Apply organization filter
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            $location = $query->findOrFail($id);

            return response()->json([
                'success' => true,
                'data' => $location
            ]);

        } catch (Exception $e) {
            Log::error('LCP/NAP show error', [
                'id' => $id,
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'LCP/NAP record not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function store(Request $request)
    {
        try {
            $validated = $request->validate([
                'lcpnap_name' => 'required|string|max:255',
                'organization_id' => 'nullable|integer'
            ]);

            // Auto-assign organization_id from current user if not provided
            if (!isset($validated['organization_id']) && Auth::user()?->organization_id) {
                $validated['organization_id'] = Auth::user()->organization_id;
            }

            $location = LCPNAPLocation::create($validated);

            return response()->json([
                'success' => true,
                'message' => 'LCP/NAP record created successfully',
                'data' => $location
            ], 201);

        } catch (Exception $e) {
            Log::error('LCP/NAP create error', [
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to create LCP/NAP record',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $query = LCPNAPLocation::query();
            
            // Apply organization filter
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            $location = $query->findOrFail($id);

            $validated = $request->validate([
                'lcpnap_name' => 'sometimes|required|string|max:255',
                'organization_id' => 'nullable|integer'
            ]);

            $location->update($validated);

            return response()->json([
                'success' => true,
                'message' => 'LCP/NAP record updated successfully',
                'data' => $location
            ]);

        } catch (Exception $e) {
            Log::error('LCP/NAP update error', [
                'id' => $id,
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to update LCP/NAP record',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $query = LCPNAPLocation::query();
            
            // Apply organization filter
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            $location = $query->findOrFail($id);
            $location->delete();

            return response()->json([
                'success' => true,
                'message' => 'LCP/NAP record deleted successfully'
            ]);

        } catch (Exception $e) {
            Log::error('LCP/NAP delete error', [
                'id' => $id,
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to delete LCP/NAP record',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics()
    {
        try {
            $query = LCPNAPLocation::query();
            
            // Apply organization filter
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $total = $query->count();

            return response()->json([
                'success' => true,
                'data' => [
                    'total_locations' => $total,
                ]
            ]);

        } catch (Exception $e) {
            Log::error('LCP/NAP statistics error', [
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch statistics',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getLookupData()
    {
        try {
            $query = LCPNAPLocation::query();
            
            // Apply organization filter
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            $lcpnaps = $query->select('id', 'lcpnap_name')->get();

            return response()->json([
                'success' => true,
                'data' => $lcpnaps
            ]);

        } catch (Exception $e) {
            Log::error('LCP/NAP lookup error', [
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch lookup data',
                'error' => $e->getMessage()
            ], 500);
        }
    }
    public function getMostUsedLCPNAPs()
    {
        try {
            $currentUser = Auth::user();
            
            $mostUsedQuery = \Illuminate\Support\Facades\DB::table('job_orders')
                ->select('lcpnap', \Illuminate\Support\Facades\DB::raw('count(*) as count'))
                ->whereNotNull('lcpnap')
                ->where('lcpnap', '!=', '');
            
            // Filter job orders by organization if applicable
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $mostUsedQuery->where('organization_id', $currentUser->organization_id);
                } else {
                    $mostUsedQuery->whereNull('organization_id');
                }
            }
            
            $mostUsed = $mostUsedQuery->groupBy('lcpnap')
                ->orderBy('count', 'desc')
                ->take(5)
                ->get();

            $names = $mostUsed->pluck('lcpnap')->toArray();
            
            $locationQuery = LCPNAPLocation::whereIn('lcpnap_name', $names);
            
            // Apply organization filter to LCPNAPLocation as well
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $locationQuery->where('organization_id', $currentUser->organization_id);
                } else {
                    $locationQuery->whereNull('organization_id');
                }
            }
            
            $locations = $locationQuery->get()
                ->sortBy(function($location) use ($names) {
                    return array_search($location->lcpnap_name, $names);
                })
                ->values();

            return response()->json([
                'success' => true,
                'data' => $locations
            ]);
        } catch (Exception $e) {
            Log::error('Most used LCP/NAP error', [
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch most used LCP/NAP records',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
