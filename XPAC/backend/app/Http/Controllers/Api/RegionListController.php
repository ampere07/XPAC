<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\Region;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class RegionListController extends Controller
{
    /**
     * Display a listing of regions
     */
    public function index()
    {
        try {
            $regions = Region::all();
            return response()->json([
                'success' => true,
                'data' => $regions
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching regions: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Store a newly created region
     */
    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255|unique:region_list,name'
        ]);
        
        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }
        
        try {
            $region = new Region();
            $region->name = $request->name;
            $region->is_active = true;
            $region->save();
            
            return response()->json([
                'success' => true,
                'message' => 'Region added successfully',
                'data' => $region
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error adding region: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Display the specified region
     */
    public function show($id)
    {
        try {
            $region = Region::findOrFail($id);
            return response()->json([
                'success' => true,
                'data' => $region
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Region not found'
            ], 404);
        }
    }

    /**
     * Update the specified region
     */
    public function update(Request $request, $id)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255|unique:region_list,name,' . $id
        ]);
        
        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }
        
        try {
            $region = Region::findOrFail($id);
            $region->name = $request->name;
            
            if ($request->has('is_active')) {
                $region->is_active = (bool) $request->is_active;
            }
            
            $region->save();
            
            return response()->json([
                'success' => true,
                'message' => 'Region updated successfully',
                'data' => $region
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating region: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Remove the specified region
     */
    public function destroy($id)
    {
        try {
            // Check for dependencies
            $hasCities = DB::table('city_list')->where('region_id', $id)->exists();
            
            if ($hasCities) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete region that has cities. Delete cities first or use cascade delete.'
                ], 422);
            }
            
            $region = Region::findOrFail($id);
            $region->delete();
            
            return response()->json([
                'success' => true,
                'message' => 'Region deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting region: ' . $e->getMessage()
            ], 500);
        }
    }
}
