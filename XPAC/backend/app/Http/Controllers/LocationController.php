<?php

namespace App\Http\Controllers;

use App\Models\Location;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Services\ActivityLogService;

class LocationController extends Controller
{
    public function index(Request $request)
    {
        try {
            $query = Location::query();

            // Filter by type if specified
            if ($request->has('type') && $request->type !== 'all') {
                $query->where('type', $request->type);
            }

            // Filter by parent if specified
            if ($request->has('parent_id')) {
                $query->where('parent_id', $request->parent_id);
            }

            // Search functionality
            if ($request->has('search') && !empty($request->search)) {
                $search = $request->search;
                $query->where(function($q) use ($search) {
                    $q->where('name', 'like', "%{$search}%")
                      ->orWhere('description', 'like', "%{$search}%");
                });
            }

            // Order by hierarchy: region -> city -> borough -> village
            $locations = $query->orderByRaw("
                CASE type 
                    WHEN 'region' THEN 1
                    WHEN 'city' THEN 2
                    WHEN 'borough' THEN 3
                    WHEN 'village' THEN 4
                    ELSE 5
                END, name ASC
            ")->get();

            return response()->json([
                'success' => true,
                'data' => $locations,
                'total' => $locations->count()
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch locations',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'type' => 'required|in:region,city,borough,village',
            'parent_id' => 'nullable|integer|exists:locations,id',
            'description' => 'nullable|string|max:1000',
            'is_active' => 'boolean'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            // Check for duplicate names within the same parent
            $existingLocation = Location::where('name', $request->name)
                ->where('type', $request->type)
                ->where('parent_id', $request->parent_id)
                ->first();

            if ($existingLocation) {
                return response()->json([
                    'success' => false,
                    'message' => 'A location with this name already exists in the same parent location'
                ], 422);
            }

            $location = Location::create([
                'name' => $request->name,
                'type' => $request->type,
                'parent_id' => $request->parent_id,
                'description' => $request->description,
                'is_active' => $request->is_active ?? true
            ]);

            // Load parent information if exists
            $location = Location::with('parent')->find($location->id);

            // Log activity
            try {
                ActivityLogService::locationCreated(
                    null, // For now, no authenticated user
                    $location,
                    ['created_by' => 'system']
                );
            } catch (\Exception $logError) {
                \Log::warning('Failed to log location creation activity: ' . $logError->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Location created successfully',
                'data' => $location
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to create location',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $location = Location::with(['parent', 'children'])->findOrFail($id);
            
            return response()->json([
                'success' => true,
                'data' => $location
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Location not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, $id)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'sometimes|string|max:255',
            'type' => 'sometimes|in:region,city,borough,village',
            'parent_id' => 'sometimes|nullable|integer|exists:locations,id',
            'description' => 'sometimes|nullable|string|max:1000',
            'is_active' => 'sometimes|boolean'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $location = Location::findOrFail($id);
            
            // Prevent circular references
            if ($request->has('parent_id') && $request->parent_id) {
                $parentId = $request->parent_id;
                if ($this->wouldCreateCircularReference($id, $parentId)) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Cannot set parent: would create circular reference'
                    ], 422);
                }
            }

            $oldData = $location->toArray();
            $location->update($request->only(['name', 'type', 'parent_id', 'description', 'is_active']));
            
            // Load updated location with parent information
            $location = Location::with('parent')->find($location->id);

            // Log activity
            try {
                $changes = array_diff_assoc($request->only(['name', 'type', 'parent_id', 'description', 'is_active']), $oldData);
                ActivityLogService::locationUpdated(
                    null, // For now, no authenticated user
                    $location,
                    $changes
                );
            } catch (\Exception $logError) {
                \Log::warning('Failed to log location update activity: ' . $logError->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Location updated successfully',
                'data' => $location
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to update location',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $location = Location::findOrFail($id);
            
            // Check if location has children
            $childrenCount = Location::where('parent_id', $id)->count();
            if ($childrenCount > 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete location: it has child locations'
                ], 422);
            }

            $locationName = $location->name;
            $location->delete();

            // Log activity
            try {
                ActivityLogService::locationDeleted(
                    null, // For now, no authenticated user
                    $id,
                    $locationName
                );
            } catch (\Exception $logError) {
                \Log::warning('Failed to log location deletion activity: ' . $logError->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Location deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete location',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getByType($type)
    {
        try {
            $locations = Location::where('type', $type)
                ->where('is_active', true)
                ->orderBy('name')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $locations
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch locations by type',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getChildren($parentId)
    {
        try {
            $locations = Location::where('parent_id', $parentId)
                ->where('is_active', true)
                ->orderBy('name')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $locations
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch child locations',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function toggleStatus($id)
    {
        try {
            $location = Location::findOrFail($id);
            $location->is_active = !$location->is_active;
            $location->save();

            return response()->json([
                'success' => true,
                'message' => 'Location status updated successfully',
                'data' => $location
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to toggle location status',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getStats()
    {
        try {
            $stats = [
                'total_locations' => Location::count(),
                'active_locations' => Location::where('is_active', true)->count(),
                'inactive_locations' => Location::where('is_active', false)->count(),
                'by_type' => [
                    'region' => Location::where('type', 'region')->count(),
                    'city' => Location::where('type', 'city')->count(),
                    'borough' => Location::where('type', 'borough')->count(),
                    'village' => Location::where('type', 'village')->count(),
                ]
            ];

            return response()->json([
                'success' => true,
                'data' => $stats
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch location statistics',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    private function wouldCreateCircularReference($locationId, $parentId)
    {
        if ($locationId == $parentId) {
            return true;
        }

        $parent = Location::find($parentId);
        while ($parent) {
            if ($parent->id == $locationId) {
                return true;
            }
            $parent = $parent->parent;
        }

        return false;
    }
}
