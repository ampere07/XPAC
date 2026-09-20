<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class BarangayController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $barangays = Barangay::orderBy('barangay', 'asc')->get();
            
            return response()->json([
                'success' => true,
                'data' => $barangays,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch barangays',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function show($id): JsonResponse
    {
        try {
            $barangay = Barangay::findOrFail($id);
            
            return response()->json([
                'success' => true,
                'data' => $barangay,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Barangay not found',
                'error' => $e->getMessage(),
            ], 404);
        }
    }
    
    public function getByCity($cityId): JsonResponse
    {
        try {
            $barangays = Barangay::where('city_id', $cityId)
                ->orderBy('barangay', 'asc')
                ->get();
            
            return response()->json([
                'success' => true,
                'data' => $barangays,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch barangays by city',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}
