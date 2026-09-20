<?php

namespace App\Http\Controllers;

use App\Models\Concern;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;

class ConcernController extends Controller
{
    public function index()
    {
        try {
            $concerns = Concern::orderBy('concern_name', 'asc')->get();
            return response()->json([
                'success' => true,
                'data' => $concerns
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch concerns',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'concern_name' => 'required|string|max:255|unique:concern,concern_name'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $user = auth()->user();
            $concern = Concern::create([
                'concern_name' => $request->concern_name,
                'modified_by' => $request->modified_by,
                'modified_at' => now(),
                'organization_id' => $user?->organization_id ?? null,
            ]);

            // Log Activity
            ActivityLog::log(
                'Concern Created',
                "New concern created: {$request->concern_name}",
                'info',
                [
                    'resource_type' => 'Concern',
                    'resource_id' => $concern->id,
                    'additional_data' => $concern->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Concern created successfully',
                'data' => $concern
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to create concern',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $concern = Concern::findOrFail($id);
            return response()->json([
                'success' => true,
                'data' => $concern
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Concern not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, $id)
    {
        $validator = Validator::make($request->all(), [
            'concern_name' => 'sometimes|string|max:255|unique:concern,concern_name,' . $id
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $concern = Concern::findOrFail($id);
            $concern->update([
                'concern_name' => $request->concern_name ?? $concern->concern_name,
                'modified_by' => $request->modified_by,
                'modified_at' => now(),
            ]);

            // Log Activity
            ActivityLog::log(
                'Concern Updated',
                "Concern updated: {$concern->concern_name} (ID: {$id})",
                'info',
                [
                    'resource_type' => 'Concern',
                    'resource_id' => $id,
                    'additional_data' => $concern->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Concern updated successfully',
                'data' => $concern
            ]);
        } catch (\Exception $e) {
            \Log::error('Update Concern Error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update concern',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $concern = Concern::findOrFail($id);
            $concern->delete();

            // Log Activity
            ActivityLog::log(
                'Concern Deleted',
                "Concern deleted: {$concern->concern_name} (ID: {$id})",
                'warning',
                [
                    'resource_type' => 'Concern',
                    'resource_id' => $id,
                    'additional_data' => $concern->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Concern deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete concern',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
