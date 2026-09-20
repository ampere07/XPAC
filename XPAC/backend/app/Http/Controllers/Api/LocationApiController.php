<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Region;
use App\Models\City;
use App\Models\Barangay;
use App\Models\LocationDetail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;
use App\Models\Application;
use App\Models\Customer;
use App\Models\JobOrder;

class LocationApiController extends Controller
{
    /**
     * Get current user email
     */
    private function getCurrentUser(Request $request)
    {
        if ($request->has('user_email')) {
            return $request->user_email;
        }
        if ($request->has('modified_by')) {
            return $request->modified_by;
        }
        if ($request->has('modifiedBy')) {
            return $request->modifiedBy;
        }
        if (auth()->check()) {
            return auth()->user()->email;
        }
        throw new \Exception('Unauthenticated: User email is required for this operation.');
    }

    private function resolveUserEmail(Request $request)
    {
        return $this->getCurrentUser($request);
    }
    /**
     * Get all locations with hierarchical structure
     */
    public function getAllLocations(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }

            $query = Region::with(['cities.barangays']);

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        $query->where('organization_id', $user->organization_id);
                    } else {
                        $query->whereNull('organization_id');
                    }
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $regions = $query->orderBy('region')
                ->get();
            
            $result = $regions->map(function($region) {
                return [
                    'id' => $region->id,
                    'name' => $region->region,
                    'active_cities' => $region->cities->map(function($city) {
                        return [
                            'id' => $city->id,
                            'name' => $city->city,
                            'region_id' => $city->region_id,
                            'active_barangays' => $city->barangays->map(function($barangay) {
                                return [
                                    'id' => $barangay->id,
                                    'name' => $barangay->barangay,
                                    'city_id' => $barangay->city_id,
                                    'active_locations' => $barangay->locations->map(function($location) {
                                        return [
                                            'id' => $location->id,
                                            'name' => $location->location_name,
                                            'barangay_id' => $location->barangay_id,
                                            'modified_by' => $location->modified_by ?? 'N/A',
                                            'modified_at' => $location->modified_at
                                        ];
                                    }),
                                    'modified_by' => $barangay->modified_by ?? 'N/A',
                                    'modified_at' => $barangay->modified_at
                                ];
                            }),
                            'modified_by' => $city->modified_by ?? 'N/A',
                            'modified_at' => $city->modified_at
                        ];
                    }),
                    'modified_by' => $region->modified_by ?? 'N/A',
                    'modified_at' => $region->modified_at
                ];
            });
            
            return response()->json([
                'success' => true,
                'data' => $result
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching locations: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get all regions
     */
    public function getRegions(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }

            $query = Region::query();

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        $query->where('organization_id', $user->organization_id);
                    } else {
                        $query->whereNull('organization_id');
                    }
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $regions = $query->orderBy('region')->get();
            
            // Transform to match frontend expectations
            $transformedRegions = $regions->map(function($region) {
                return [
                    'id' => $region->id,
                    'name' => $region->region,
                    'region' => $region->region,
                    'modified_by' => $region->modified_by,
                    'modified_at' => $region->modified_at
                ];
            });
            
            return response()->json([
                'success' => true,
                'data' => $transformedRegions
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching regions: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get cities by region
     */
    public function getCitiesByRegion($regionId, Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }

            $query = City::where('region_id', $regionId);

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        $query->where('organization_id', $user->organization_id);
                    } else {
                        $query->whereNull('organization_id');
                    }
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $cities = $query->orderBy('city')
                ->get();
            
            // Transform to match frontend expectations
            $transformedCities = $cities->map(function($city) {
                return [
                    'id' => $city->id,
                    'name' => $city->city,
                    'city' => $city->city,
                    'region_id' => $city->region_id,
                    'modified_by' => $city->modified_by,
                    'modified_at' => $city->modified_at
                ];
            });
            
            return response()->json([
                'success' => true,
                'data' => $transformedCities
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching cities: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get all cities
     */
    public function getAllCities(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }

            $query = City::query();

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        $query->where('organization_id', $user->organization_id);
                    } else {
                        $query->whereNull('organization_id');
                    }
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $cities = $query->orderBy('city')->get();
            
            // Transform to match frontend expectations
            $transformedCities = $cities->map(function($city) {
                return [
                    'id' => $city->id,
                    'name' => $city->city,
                    'city' => $city->city,
                    'region_id' => $city->region_id,
                    'modified_by' => $city->modified_by,
                    'modified_at' => $city->modified_at
                ];
            });
            
            return response()->json([
                'success' => true,
                'data' => $transformedCities
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching cities: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get barangays by city
     */
    public function getBarangaysByCity($cityId, Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }

            $query = Barangay::where('city_id', $cityId);

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        $query->where('organization_id', $user->organization_id);
                    } else {
                        $query->whereNull('organization_id');
                    }
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $barangays = $query->orderBy('barangay')
                ->get();
            
            // Transform to match frontend expectations
            $transformedBarangays = $barangays->map(function($barangay) {
                return [
                    'id' => $barangay->id,
                    'name' => $barangay->barangay,
                    'barangay' => $barangay->barangay,
                    'city_id' => $barangay->city_id,
                    'modified_by' => $barangay->modified_by,
                    'modified_at' => $barangay->modified_at
                ];
            });

            return response()->json([
                'success' => true,
                'data' => $transformedBarangays
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching barangays: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get all barangays
     */
    public function getAllBarangays(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }

            $query = Barangay::query();

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        $query->where('organization_id', $user->organization_id);
                    } else {
                        $query->whereNull('organization_id');
                    }
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $barangays = $query->orderBy('barangay')->get();
            
            // Transform to match frontend expectations
            $transformedBarangays = $barangays->map(function($barangay) {
                return [
                    'id' => $barangay->id,
                    'name' => $barangay->barangay,
                    'barangay' => $barangay->barangay,
                    'city_id' => $barangay->city_id,
                    'modified_by' => $barangay->modified_by,
                    'modified_at' => $barangay->modified_at
                ];
            });

            return response()->json([
                'success' => true,
                'data' => $transformedBarangays
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching barangays: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get locations by barangay
     */
    public function getLocationsByBarangay($barangayId)
    {
        try {
            $locations = LocationDetail::where('barangay_id', $barangayId)
                ->orderBy('location_name')
                ->get();
            
            // Transform to match frontend expectations
            $transformedLocations = $locations->map(function($location) {
                return [
                    'id' => $location->id,
                    'name' => $location->location_name,
                    'location_name' => $location->location_name,
                    'barangay_id' => $location->barangay_id,
                    'borough_id' => $location->barangay_id,  // Frontend uses borough_id
                    'modified_by' => $location->modified_by,
                    'modified_at' => $location->modified_at
                ];
            });
            
            return response()->json([
                'success' => true,
                'data' => $transformedLocations
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching locations: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get all locations
     */
    public function getAllDetails(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }

            $query = LocationDetail::query();

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        $query->whereHas('barangay', function($q) use ($user) {
                            $q->where('organization_id', $user->organization_id);
                        });
                    } else {
                        $query->whereHas('barangay', function($q) {
                            $q->whereNull('organization_id');
                        });
                    }
                } else {
                    $query->whereHas('barangay', function($q) {
                        $q->whereNull('organization_id');
                    });
                }
            }

            $locations = $query->orderBy('location_name')->get();
            
            // Transform to match frontend expectations
            $transformedLocations = $locations->map(function($location) {
                return [
                    'id' => $location->id,
                    'name' => $location->location_name,
                    'location_name' => $location->location_name,
                    'barangay_id' => $location->barangay_id,
                    'borough_id' => $location->barangay_id,  // Frontend uses borough_id
                    'modified_by' => $location->modified_by,
                    'modified_at' => $location->modified_at
                ];
            });
            
            return response()->json([
                'success' => true,
                'data' => $transformedLocations
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching locations: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Add new region
     */
    public function addRegion(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'name' => 'required|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $name = $request->input('name');
            
            $existing = Region::whereRaw('LOWER(region) = ?', [strtolower($name)])->first();
            if ($existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'A region with this name already exists'
                ], 422);
            }
            
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }
            $organizationId = $user ? $user->organization_id : null;

            $region = Region::create([
                'region' => $name,
                'organization_id' => $organizationId,
                'modified_by' => $this->resolveUserEmail($request),
                'modified_at' => now()
            ]);
            
            // Log Activity
            ActivityLog::log(
                'Location Created',
                "New Region created: {$name}",
                'info',
                [
                    'resource_type' => 'Region',
                    'resource_id' => $region->id,
                    'additional_data' => $region->toArray()
                ]
            );

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
     * Add new city
     */
    public function addCity(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'region_id' => 'required|integer|exists:region,id',
                'name' => 'required|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $regionId = $request->input('region_id');
            $name = $request->input('name');
            
            $existing = City::where('region_id', $regionId)
                ->whereRaw('LOWER(city) = ?', [strtolower($name)])
                ->first();
                
            if ($existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'A city with this name already exists in this region'
                ], 422);
            }
            
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }
            $organizationId = $user ? $user->organization_id : null;

            $city = City::create([
                'region_id' => $regionId,
                'city' => $name,
                'organization_id' => $organizationId,
                'modified_by' => $this->resolveUserEmail($request),
                'modified_at' => now()
            ]);
            
            // Log Activity
            ActivityLog::log(
                'Location Created',
                "New City created: {$name} in Region ID: {$regionId}",
                'info',
                [
                    'resource_type' => 'City',
                    'resource_id' => $city->id,
                    'additional_data' => $city->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'City added successfully',
                'data' => $city
            ], 201);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error adding city: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Add new barangay
     */
    public function addBarangay(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'city_id' => 'required|integer|exists:city,id',
                'name' => 'required|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $cityId = $request->input('city_id');
            $name = $request->input('name');

            $existing = Barangay::where('city_id', $cityId)
                ->whereRaw('LOWER(barangay) = ?', [strtolower($name)])
                ->first();
                
            if ($existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'A barangay with this name already exists in this city'
                ], 422);
            }
            
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }
            $organizationId = $user ? $user->organization_id : null;

            $barangay = Barangay::create([
                'city_id' => $cityId,
                'barangay' => $name,
                'organization_id' => $organizationId,
                'modified_by' => $this->resolveUserEmail($request),
                'modified_at' => now()
            ]);
            
            // Log Activity
            ActivityLog::log(
                'Location Created',
                "New Barangay created: {$name} in City ID: {$cityId}",
                'info',
                [
                    'resource_type' => 'Barangay',
                    'resource_id' => $barangay->id,
                    'additional_data' => $barangay->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Barangay added successfully',
                'data' => $barangay
            ], 201);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error adding barangay: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Add new location
     */
    public function addLocation(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'barangay_id' => 'nullable|integer|exists:barangay,id',
                'name' => 'required|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $barangayId = $request->input('barangay_id');
            $name = $request->input('name');
            
            // Check for duplicate location name in same barangay
            $query = LocationDetail::whereRaw('LOWER(location_name) = ?', [strtolower($name)]);
            if ($barangayId) {
                $query->where('barangay_id', $barangayId);
            }
            $existing = $query->first();
                
            if ($existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'A location with this name already exists in this barangay'
                ], 422);
            }
            
            $location = LocationDetail::create([
                'barangay_id' => $barangayId,
                'location_name' => $name,
                'modified_by' => $this->resolveUserEmail($request),
                'modified_at' => now()
            ]);
            
            // Log Activity
            ActivityLog::log(
                'Location Created',
                "New Location created: {$name}" . ($barangayId ? " in Barangay ID: {$barangayId}" : ""),
                'info',
                [
                    'resource_type' => 'LocationDetail',
                    'resource_id' => $location->id,
                    'additional_data' => $location->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Location added successfully',
                'data' => $location
            ], 201);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error adding location: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Update location
     */
    public function updateLocation($type, $id, Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'name' => 'required|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $name = $request->input('name');
            
            $validTypes = ['region', 'city', 'barangay', 'location'];
            if (!in_array($type, $validTypes)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Invalid location type'
                ], 400);
            }

            // Get current user and organization for authorization
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }
            $isGlobalAdmin = $user && ($user->role_id == 7 && $user->organization_id === null);
            $userOrgId = $user ? $user->organization_id : null;

            switch ($type) {
                case 'region':
                    $location = Region::find($id);
                    if (!$location) {
                        return response()->json([
                            'success' => false,
                            'message' => 'Region not found'
                        ], 404);
                    }

                    // Authorization
                    if (!$isGlobalAdmin) {
                        if ($userOrgId) {
                            if ($location->organization_id !== $userOrgId) {
                                return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update regions within your organization.'], 403);
                            }
                        } else {
                            if ($location->organization_id !== null) {
                                return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update regions without an organization.'], 403);
                            }
                        }
                    }
                    
                    $existing = Region::where('id', '!=', $id)
                        ->whereRaw('LOWER(region) = ?', [strtolower($name)])
                        ->first();
                    if ($existing) {
                        return response()->json([
                            'success' => false,
                            'message' => 'A region with this name already exists'
                        ], 422);
                    }
                    
                    $location->region = $name;
                    $location->modified_by = $this->resolveUserEmail($request);
                    $location->modified_at = now();
                    $location->save();
                    break;
                    
                case 'city':
                    $location = City::find($id);
                    if (!$location) {
                        return response()->json([
                            'success' => false,
                            'message' => 'City not found'
                        ], 404);
                    }

                    // Authorization
                    if (!$isGlobalAdmin) {
                        if ($userOrgId) {
                            if ($location->organization_id !== $userOrgId) {
                                return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update cities within your organization.'], 403);
                            }
                        } else {
                            if ($location->organization_id !== null) {
                                return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update cities without an organization.'], 403);
                            }
                        }
                    }
                    
                    $existing = City::where('id', '!=', $id)
                        ->where('region_id', $location->region_id)
                        ->whereRaw('LOWER(city) = ?', [strtolower($name)])
                        ->first();
                    if ($existing) {
                        return response()->json([
                            'success' => false,
                            'message' => 'A city with this name already exists in this region'
                        ], 422);
                    }
                    
                    $location->city = $name;
                    $location->modified_by = $this->resolveUserEmail($request);
                    $location->modified_at = now();
                    $location->save();
                    break;
                    
                case 'barangay':
                    $location = Barangay::find($id);
                    if (!$location) {
                        return response()->json([
                            'success' => false,
                            'message' => 'Barangay not found'
                        ], 404);
                    }

                    // Authorization
                    if (!$isGlobalAdmin) {
                        if ($userOrgId) {
                            if ($location->organization_id !== $userOrgId) {
                                return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update barangays within your organization.'], 403);
                            }
                        } else {
                            if ($location->organization_id !== null) {
                                return response()->json(['success' => false, 'message' => 'Unauthorized. You can only update barangays without an organization.'], 403);
                            }
                        }
                    }
                    
                    $existing = Barangay::where('id', '!=', $id)
                        ->where('city_id', $location->city_id)
                        ->whereRaw('LOWER(barangay) = ?', [strtolower($name)])
                        ->first();
                    if ($existing) {
                        return response()->json([
                            'success' => false,
                            'message' => 'A barangay with this name already exists in this city'
                        ], 422);
                    }
                    
                    $location->barangay = $name;
                    $location->modified_by = $this->resolveUserEmail($request);
                    $location->modified_at = now();
                    $location->save();
                    break;

                case 'location':
                    $location = LocationDetail::find($id);
                    if (!$location) {
                        return response()->json([
                            'success' => false,
                            'message' => 'Location not found'
                        ], 404);
                    }
                    
                    $existing = LocationDetail::where('id', '!=', $id)
                        ->where('barangay_id', $location->barangay_id)
                        ->whereRaw('LOWER(location_name) = ?', [strtolower($name)])
                        ->first();
                    if ($existing) {
                        return response()->json([
                            'success' => false,
                            'message' => 'A location with this name already exists in this barangay'
                        ], 422);
                    }
                    
                    $location->location_name = $name;
                    $location->modified_by = $this->resolveUserEmail($request);
                    $location->modified_at = now();
                    $location->save();
                    break;
            }
            
            // Log Activity
            ActivityLog::log(
                'Location Updated',
                ucfirst($type) . " updated: {$name} (ID: {$id})",
                'info',
                [
                    'resource_type' => ucfirst($type),
                    'resource_id' => $id,
                    'additional_data' => $location->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => ucfirst($type) . ' updated successfully',
                'data' => $location
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => "Error updating {$type}: " . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Delete location with cascade support
     */
    public function deleteLocation($type, $id, Request $request)
    {
        try {
            $validTypes = ['region', 'city', 'barangay', 'location'];
            if (!in_array($type, $validTypes)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Invalid location type'
                ], 400);
            }
            
            $cascade = $request->query('cascade', false);
            
            // Get current user and organization
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }
            $isGlobalAdmin = $user && ($user->role_id == 7 && $user->organization_id === null);
            $userOrgId = $user ? $user->organization_id : null;

            DB::beginTransaction();
            
            try {
                switch ($type) {
                    case 'region':
                        $region = Region::find($id);
                        if (!$region) {
                            DB::rollBack();
                            return response()->json([
                                'success' => false,
                                'message' => 'Region not found'
                            ], 404);
                        }

                        // Authorization
                        if (!$isGlobalAdmin) {
                            if ($userOrgId) {
                                if ($region->organization_id !== $userOrgId) {
                                    DB::rollBack();
                                    return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete regions within your organization.'], 403);
                                }
                            } else {
                                if ($region->organization_id !== null) {
                                    DB::rollBack();
                                    return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete regions without an organization.'], 403);
                                }
                            }
                        }
                        
                        $cities = City::where('region_id', $id)->get();
                        
                        if ($cities->count() > 0 && !$cascade) {
                            $barangayCount = 0;
                            foreach ($cities as $city) {
                                $barangayCount += Barangay::where('city_id', $city->id)->count();
                            }
                            
                            DB::rollBack();
                            return response()->json([
                                'success' => false,
                                'message' => 'Cannot delete region: contains cities and barangays',
                                'data' => [
                                    'can_cascade' => true,
                                    'type' => 'region',
                                    'name' => $region->region,
                                    'city_count' => $cities->count(),
                                    'barangay_count' => $barangayCount
                                ]
                            ], 422);
                        }
                        
                        if ($cascade) {
                            foreach ($cities as $city) {
                                $barangays = Barangay::where('city_id', $city->id)->get();
                                foreach ($barangays as $barangay) {
                                    LocationDetail::where('barangay_id', $barangay->id)->delete();
                                }
                                Barangay::where('city_id', $city->id)->delete();
                            }
                            City::where('region_id', $id)->delete();
                        }
                        
                        $region->delete();
                        break;
                        
                    case 'city':
                        $city = City::find($id);
                        if (!$city) {
                            DB::rollBack();
                            return response()->json([
                                'success' => false,
                                'message' => 'City not found'
                            ], 404);
                         }

                        // Authorization
                        if (!$isGlobalAdmin) {
                            if ($userOrgId) {
                                if ($city->organization_id !== $userOrgId) {
                                    DB::rollBack();
                                    return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete cities within your organization.'], 403);
                                }
                            } else {
                                if ($city->organization_id !== null) {
                                    DB::rollBack();
                                    return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete cities without an organization.'], 403);
                                }
                            }
                        }
                        
                        $barangays = Barangay::where('city_id', $id)->get();
                        
                        if ($barangays->count() > 0 && !$cascade) {
                            DB::rollBack();
                            return response()->json([
                                'success' => false,
                                'message' => 'Cannot delete city: contains barangays',
                                'data' => [
                                    'can_cascade' => true,
                                    'type' => 'city',
                                    'name' => $city->city,
                                    'barangay_count' => $barangays->count()
                                ]
                            ], 422);
                        }
                        
                        if ($cascade) {
                            foreach ($barangays as $barangay) {
                                LocationDetail::where('barangay_id', $barangay->id)->delete();
                            }
                            Barangay::where('city_id', $id)->delete();
                        }
                        
                        $city->delete();
                        break;
                        
                    case 'barangay':
                        $barangay = Barangay::find($id);
                        if (!$barangay) {
                            DB::rollBack();
                            return response()->json([
                                'success' => false,
                                'message' => 'Barangay not found'
                            ], 404);
                        }

                        // Authorization
                        if (!$isGlobalAdmin) {
                            if ($userOrgId) {
                                if ($barangay->organization_id !== $userOrgId) {
                                    DB::rollBack();
                                    return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete barangays within your organization.'], 403);
                                }
                            } else {
                                if ($barangay->organization_id !== null) {
                                    DB::rollBack();
                                    return response()->json(['success' => false, 'message' => 'Unauthorized. You can only delete barangays without an organization.'], 403);
                                }
                            }
                        }
                        
                        $locationDetails = LocationDetail::where('barangay_id', $id)->get();
                        
                        if ($locationDetails->count() > 0 && !$cascade) {
                            DB::rollBack();
                            return response()->json([
                                'success' => false,
                                'message' => 'Cannot delete barangay: contains locations',
                                'data' => [
                                    'can_cascade' => true,
                                    'type' => 'barangay',
                                    'name' => $barangay->barangay,
                                    'location_count' => $locationDetails->count()
                                ]
                            ], 422);
                        }
                        
                        if ($cascade) {
                            LocationDetail::where('barangay_id', $id)->delete();
                        }
                        
                        $barangay->delete();
                        break;
                        
                    case 'location':
                        $location = LocationDetail::find($id);
                        if (!$location) {
                            DB::rollBack();
                            return response()->json([
                                'success' => false,
                                'message' => 'Location not found'
                            ], 404);
                        }
                        
                        $location->delete();
                        break;
                }
                
                // Log Activity
                ActivityLog::log(
                    'Location Deleted',
                    ucfirst($type) . " deleted: ID: {$id}" . ($cascade ? " (with all dependent locations)" : ""),
                    'warning',
                    [
                        'resource_type' => ucfirst($type),
                        'resource_id' => $id,
                        'cascade' => $cascade
                    ]
                );

                DB::commit();
                
                $message = ucfirst($type) . ' deleted successfully';
                if ($cascade) {
                    $message .= ' (with all dependent locations)';
                }
                
                return response()->json([
                    'success' => true,
                    'message' => $message
                ]);
                
            } catch (\Exception $e) {
                DB::rollBack();
                throw $e;
            }
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => "Error deleting {$type}: " . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get statistics
     */
    public function getStatistics(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user && $request->has('user_email')) {
                $user = User::where('email_address', $request->user_email)->first();
            }

            $regionQuery = Region::query();
            $cityQuery = City::query();
            $barangayQuery = Barangay::query();
            $locationQuery = LocationDetail::query();

            if ($user) {
                $isGlobalAdmin = ($user->role_id == 7 && $user->organization_id === null);
                if (!$isGlobalAdmin) {
                    if ($user->organization_id) {
                        $regionQuery->where('organization_id', $user->organization_id);
                        $cityQuery->where('organization_id', $user->organization_id);
                        $barangayQuery->where('organization_id', $user->organization_id);
                        // location table might not have organization_id yet, but let's filter by its parent
                        $locationQuery->whereHas('barangay', function($q) use ($user) {
                            $q->where('organization_id', $user->organization_id);
                        });
                    } else {
                        $regionQuery->whereNull('organization_id');
                        $cityQuery->whereNull('organization_id');
                        $barangayQuery->whereNull('organization_id');
                        $locationQuery->whereHas('barangay', function($q) {
                            $q->whereNull('organization_id');
                        });
                    }
                } else {
                    $regionQuery->whereNull('organization_id');
                    $cityQuery->whereNull('organization_id');
                    $barangayQuery->whereNull('organization_id');
                    $locationQuery->whereHas('barangay', function($q) {
                        $q->whereNull('organization_id');
                    });
                }
            }

            $regions = $regionQuery->count();
            $cities = $cityQuery->count();  
            $barangays = $barangayQuery->count();
            $locations = $locationQuery->count();
            
            return response()->json([
                'success' => true,
                'data' => [
                    'regions' => $regions,
                    'cities' => $cities,
                    'barangays' => $barangays,
                    'villages' => $locations, // Keep key name for API compatibility
                    'total' => $regions + $cities + $barangays + $locations
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error getting statistics: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get related data (applications, job orders, customers) for a location
     */
    public function getRelatedData($type, $id)
    {
        try {
            $column = '';
            $locationName = '';
            
            switch($type) {
                case 'region':
                    $region = Region::find($id);
                    if (!$region) return response()->json(['success' => false, 'message' => 'Region not found'], 404);
                    $column = 'region';
                    $locationName = $region->region;
                    break;
                case 'city':
                    $city = City::find($id);
                    if (!$city) return response()->json(['success' => false, 'message' => 'City not found'], 404);
                    $column = 'city';
                    $locationName = $city->city;
                    break;
                case 'barangay':
                case 'borough':
                    $barangay = Barangay::find($id);
                    if (!$barangay) return response()->json(['success' => false, 'message' => 'Barangay not found'], 404);
                    $column = 'barangay';
                    $locationName = $barangay->barangay;
                    break;
                case 'location':
                    $location = LocationDetail::find($id);
                    if (!$location) return response()->json(['success' => false, 'message' => 'Location not found'], 404);
                    $column = 'location';
                    $locationName = $location->location_name;
                    break;
                default:
                    return response()->json(['success' => false, 'message' => 'Invalid location type'], 400);
            }

            // Fetch related data
            // Since data might be stored as either name or ID, we filter by both if possible
            $applications = Application::where($column, $locationName)
                ->orWhere($column, $id)
                ->orderBy('created_at', 'desc')
                ->get();
                
            $customers = Customer::where($column, $locationName)
                ->orWhere($column, $id)
                ->orderBy('created_at', 'desc')
                ->get();
                
            $applicationIds = $applications->pluck('id');
            $jobOrders = JobOrder::with('application')
                ->whereIn('application_id', $applicationIds)
                ->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => [
                    'applications' => $applications,
                    'customers' => $customers,
                    'jobOrders' => $jobOrders
                ]
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching related data: ' . $e->getMessage()
            ], 500);
        }
    }
}

