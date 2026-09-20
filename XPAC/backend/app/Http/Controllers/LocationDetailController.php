<?php

namespace App\Http\Controllers;

use App\Models\LocationDetail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\DB;

class LocationDetailController extends Controller
{
    public function index()
    {
        try {
            $locations = LocationDetail::with('barangay')->get();
            
            return response()->json([
                'success' => true,
                'data' => $locations
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
            'location_name' => 'required|string|max:255',
            'barangay_id' => 'required|integer|exists:barangay,id'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $existingLocation = LocationDetail::where(DB::raw('LOWER(location_name)'), strtolower($request->location_name))
                ->where('barangay_id', $request->barangay_id)
                ->first();

            if ($existingLocation) {
                return response()->json([
                    'success' => false,
                    'message' => 'Location already exists in this barangay'
                ], 422);
            }

            $location = LocationDetail::create([
                'location_name' => $request->location_name,
                'barangay_id' => $request->barangay_id
            ]);

            $location = LocationDetail::with('barangay')->find($location->id);

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
            $location = LocationDetail::with('barangay')->findOrFail($id);
            
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
            'location_name' => 'sometimes|string|max:255',
            'barangay_id' => 'sometimes|integer|exists:barangay,id'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $location = LocationDetail::findOrFail($id);

            if ($request->has('location_name')) {
                $existingLocation = LocationDetail::where(DB::raw('LOWER(location_name)'), strtolower($request->location_name))
                    ->where('barangay_id', $request->barangay_id ?? $location->barangay_id)
                    ->where('id', '!=', $id)
                    ->first();

                if ($existingLocation) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Location already exists in this barangay'
                    ], 422);
                }
            }

            $location->update($request->only(['location_name', 'barangay_id']));
            $location = LocationDetail::with('barangay')->find($location->id);

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
            $location = LocationDetail::findOrFail($id);
            $location->delete();

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

    public function getByBarangay($barangayId)
    {
        try {
            $locations = LocationDetail::where('barangay_id', $barangayId)->get();
            
            return response()->json([
                'success' => true,
                'data' => $locations
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch locations',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
