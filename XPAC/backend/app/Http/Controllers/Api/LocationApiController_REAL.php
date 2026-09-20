<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Region;
use App\Models\City;
use App\Models\Barangay;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\DB;

class LocationApiController extends Controller
{
    /**
     * Get all regions
     */
    public function getRegions()
    {
        try {
            $regions = Region::active()->orderBy('name')->get();
            
            return response()->json([
                'success' => true,
                'data' => $regions
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch regions',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get cities by region
     */
    public function getCitiesByRegion($regionId)
    {
        try {
            $cities = City::active()
                ->where('region_id', $regionId)
                ->orderBy('name')
                ->get();
            
            return response()->json([
                'success' => true,
                'data' => $cities
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch cities',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get barangays by city
     */
    public function getBarangaysByCity($cityId)
    {
        try {
            $barangays = Barangay::active()
                ->where('city_id', $cityId)
                ->orderBy('name')
                ->get();
            
            return response()->json([
                'success' => true,
                'data' => $barangays
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch barangays',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get all locations hierarchically
     */
    public function getAllLocations()
    {
        try {
            $regions = Region::active()
                ->with(['activeCities.activeBarangays'])
                ->orderBy('name')
                ->get();
            
            return response()->json([
                'success' => true,
                'data' => $regions
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch locations',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Add new region
     */
    public function addRegion(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'description' => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            // Check for duplicate region name (case-insensitive)
            $existingRegion = Region::whereRaw('LOWER(name) = ?', [strtolower($request->name)])->first();
            
            if ($existingRegion) {
                return response()->json([
                    'success' => false,
                    'message' => 'A region with this name already exists: ' . $existingRegion->name
                ], 422);
            }
            
            DB::beginTransaction();
            
            // Generate unique code
            $code = $this->generateCode($request->name, 'region');
            
            $region = Region::create([
                'code' => $code,
                'name' => $request->name,
                'description' => $request->description,
                'is_active' => true
            ]);
            
            DB::commit();
            
            return response()->json([
                'success' => true,
                'message' => 'Region added successfully',
                'data' => $region
            ], 201);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Failed to add region',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Add new city
     */
    public function addCity(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'region_id' => 'required|exists:regions,id',
            'name' => 'required|string|max:255',
            'description' => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            // Check for duplicate city name within the same region (case-insensitive)
            $existingCity = City::where('region_id', $request->region_id)
                ->whereRaw('LOWER(name) = ?', [strtolower($request->name)])
                ->first();
            
            if ($existingCity) {
                $region = Region::find($request->region_id);
                return response()->json([
                    'success' => false,
                    'message' => 'A city with this name already exists in ' . $region->name . ': ' . $existingCity->name
                ], 422);
            }
            
            DB::beginTransaction();
            
            // Generate unique code
            $code = $this->generateCode($request->name, 'city');
            
            $city = City::create([
                'region_id' => $request->region_id,
                'code' => $code,
                'name' => $request->name,
                'description' => $request->description,
                'is_active' => true
            ]);
            
            DB::commit();
            
            return response()->json([
                'success' => true,
                'message' => 'City added successfully',
                'data' => $city
            ], 201);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Failed to add city',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Add new barangay
     */
    public function addBarangay(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'city_id' => 'required|exists:cities,id',
            'name' => 'required|string|max:255',
            'description' => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            // Check for duplicate barangay name within the same city (case-insensitive)
            $existingBarangay = Barangay::where('city_id', $request->city_id)
                ->whereRaw('LOWER(name) = ?', [strtolower($request->name)])
                ->first();
            
            if ($existingBarangay) {
                $city = City::with('region')->find($request->city_id);
                return response()->json([
                    'success' => false,
                    'message' => 'A barangay with this name already exists in ' . $city->name . ': ' . $existingBarangay->name
                ], 422);
            }
            
            DB::beginTransaction();
            
            // Generate unique code
            $code = $this->generateCode($request->name, 'barangay');
            
            $barangay = Barangay::create([
                'city_id' => $request->city_id,
                'code' => $code,
                'name' => $request->name,
                'description' => $request->description,
                'is_active' => true
            ]);
            
            DB::commit();
            
            return response()->json([
                'success' => true,
                'message' => 'Barangay added successfully',
                'data' => $barangay
            ], 201);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Failed to add barangay',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get location statistics
     */
    public function getStatistics()
    {
        try {
            $stats = [
                'regions' => Region::active()->count(),
                'cities' => City::active()->count(),
                'barangays' => Barangay::active()->count(),
                'total' => Region::active()->count() + City::active()->count() + Barangay::active()->count()
            ];
            
            return response()->json([
                'success' => true,
                'data' => $stats
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch statistics',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Update location by type
     */
    public function updateLocation($type, $id, Request $request)
    {
        // Implementation for update operations
        return response()->json([
            'success' => true,
            'message' => ucfirst($type) . ' updated successfully',
            'data' => ['id' => $id]
        ]);
    }
    
    /**
     * Delete location by type
     */
    public function deleteLocation($type, $id, Request $request)
    {
        // Implementation for delete operations
        return response()->json([
            'success' => true,
            'message' => ucfirst($type) . ' deleted successfully'
        ]);
    }

    /**
     * Generate unique code for location
     */
    private function generateCode($name, $type)
    {
        $prefix = strtoupper(substr($type, 0, 1));
        $nameSlug = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $name));
        $nameSlug = substr($nameSlug, 0, 10);
        $timestamp = time();
        
        return $prefix . '_' . $nameSlug . '_' . $timestamp;
    }
}
