<?php

namespace App\Http\Controllers;

use App\Models\City;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class CityController extends Controller
{
    /**
     * Display a listing of cities.
     */
    public function index(): JsonResponse
    {
        try {
            $cities = City::orderBy('city', 'asc')->get();
            
            return response()->json([
                'success' => true,
                'data' => $cities,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('CityController index error: ' . $e->getMessage());
            \Illuminate\Support\Facades\Log::error('Trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch cities',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Display the specified city.
     */
    public function show($id): JsonResponse
    {
        try {
            $city = City::findOrFail($id);
            
            return response()->json([
                'success' => true,
                'data' => $city,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'City not found',
                'error' => $e->getMessage(),
            ], 404);
        }
    }
    
    /**
     * Get cities by region.
     */
    public function getByRegion($regionId): JsonResponse
    {
        try {
            \Illuminate\Support\Facades\Log::info('CityController getByRegion called', [
                'region_id' => $regionId
            ]);
            
            $cities = City::where('region_id', $regionId)
                ->orderBy('city', 'asc')
                ->get();
            
            \Illuminate\Support\Facades\Log::info('Cities found', [
                'count' => $cities->count(),
                'region_id' => $regionId
            ]);
            
            return response()->json([
                'success' => true,
                'data' => $cities,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('CityController getByRegion error: ' . $e->getMessage());
            \Illuminate\Support\Facades\Log::error('Trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch cities by region',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}
