<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;

class GeographicController extends Controller
{
    public function getRegions()
    {
        try {
            Log::info('=== GeographicController getRegions START ===');
            
            Log::info('Querying region table');
            $regions = DB::table('region')
                ->select('id', 'region')
                ->orderBy('region', 'asc')
                ->get();

            Log::info('Regions fetched', ['count' => $regions->count()]);

            $mappedRegions = $regions->map(function ($region) {
                return [
                    'id' => $region->id,
                    'region_code' => (string)$region->id,
                    'region_name' => $region->region
                ];
            });

            Log::info('=== GeographicController getRegions SUCCESS ===');
            return response()->json([
                'regions' => $mappedRegions
            ]);
        } catch (\Exception $e) {
            Log::error('=== GeographicController getRegions ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());
            Log::error('Stack trace: ' . $e->getTraceAsString());

            return response()->json([
                'message' => 'Failed to retrieve regions',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getCities(Request $request)
    {
        try {
            Log::info('=== GeographicController getCities START ===');
            
            $regionCode = $request->query('region_code');
            Log::info('Region code requested', ['region_code' => $regionCode]);

            if (!$regionCode) {
                Log::warning('Region code not provided');
                return response()->json([
                    'message' => 'Region code is required'
                ], 400);
            }

            Log::info('Querying city table');
            $cities = DB::table('city')
                ->select('id', 'city')
                ->where('region_id', $regionCode)
                ->orderBy('city', 'asc')
                ->get();

            Log::info('Cities fetched', ['count' => $cities->count()]);

            $mappedCities = $cities->map(function ($city) {
                return [
                    'id' => $city->id,
                    'city_code' => (string)$city->id,
                    'city_name' => $city->city
                ];
            });

            Log::info('=== GeographicController getCities SUCCESS ===');
            return response()->json([
                'cities' => $mappedCities
            ]);
        } catch (\Exception $e) {
            Log::error('=== GeographicController getCities ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());
            Log::error('Stack trace: ' . $e->getTraceAsString());

            return response()->json([
                'message' => 'Failed to retrieve cities',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getBarangays(Request $request)
    {
        try {
            Log::info('=== GeographicController getBarangays START ===');
            
            $cityCode = $request->query('city_code');
            Log::info('City code requested', ['city_code' => $cityCode]);

            if (!$cityCode) {
                Log::warning('City code not provided');
                return response()->json([
                    'message' => 'City code is required'
                ], 400);
            }

            Log::info('Querying barangay table');
            $barangays = DB::table('barangay')
                ->select('id', 'barangay')
                ->where('city_id', $cityCode)
                ->orderBy('barangay', 'asc')
                ->get();

            Log::info('Barangays fetched', ['count' => $barangays->count()]);

            $mappedBarangays = $barangays->map(function ($barangay) {
                return [
                    'id' => $barangay->id,
                    'barangay_code' => (string)$barangay->id,
                    'barangay_name' => $barangay->barangay
                ];
            });

            Log::info('=== GeographicController getBarangays SUCCESS ===');
            return response()->json([
                'barangays' => $mappedBarangays
            ]);
        } catch (\Exception $e) {
            Log::error('=== GeographicController getBarangays ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());
            Log::error('Stack trace: ' . $e->getTraceAsString());

            return response()->json([
                'message' => 'Failed to retrieve barangays',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getVillages(Request $request)
    {
        try {
            Log::info('=== GeographicController getVillages START ===');
            
            $barangayCode = $request->query('barangay_code');
            Log::info('Barangay code requested', ['barangay_code' => $barangayCode]);

            if (!$barangayCode) {
                Log::warning('Barangay code not provided');
                return response()->json([
                    'message' => 'Barangay code is required'
                ], 400);
            }

            Log::info('Querying location table');
            $locations = DB::table('location')
                ->select('id', 'location_name')
                ->where('barangay_id', $barangayCode)
                ->orderBy('location_name', 'asc')
                ->get();

            Log::info('Villages fetched', ['count' => $locations->count()]);

            $mappedVillages = $locations->map(function ($location) {
                return [
                    'id' => $location->id,
                    'village_code' => (string)$location->id,
                    'village_name' => $location->location_name
                ];
            });

            Log::info('=== GeographicController getVillages SUCCESS ===');
            return response()->json([
                'villages' => $mappedVillages
            ]);
        } catch (\Exception $e) {
            Log::error('=== GeographicController getVillages ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());
            Log::error('Stack trace: ' . $e->getTraceAsString());

            return response()->json([
                'message' => 'Failed to retrieve villages',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getReferrers()
    {
        try {
            Log::info('=== GeographicController getReferrers START ===');
            
            $referrers = DB::table('users')
                ->where('role_id', 4)
                ->select('id', 'first_name', 'last_name')
                ->get()
                ->map(function ($user) {
                    return [
                        'id' => $user->id,
                        'name' => trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''))
                    ];
                })
                ->filter(function ($user) {
                    return !empty($user['name']);
                })
                ->values();

            Log::info('Referrers fetched', ['count' => $referrers->count()]);

            return response()->json([
                'success' => true,
                'referrers' => $referrers
            ]);
        } catch (\Exception $e) {
            Log::error('=== GeographicController getReferrers ERROR ===');
            Log::error($e->getMessage());
            return response()->json(['success' => false, 'error' => $e->getMessage()], 500);
        }
    }
}

