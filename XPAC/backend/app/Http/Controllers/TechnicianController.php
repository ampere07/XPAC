<?php

namespace App\Http\Controllers;

use App\Models\Technician;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class TechnicianController extends Controller
{
    public function index()
    {
        try {
            $user = auth()->user();
            $organizationId = $user ? $user->organization_id : null;

            $query = Technician::query();

            if ($organizationId) {
                $query->where('organization_id', $organizationId);
            }

            $technicians = $query->get();
            return response()->json([
                'success' => true,
                'data' => $technicians
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch technicians',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'first_name' => 'required|string|max:255',
            'middle_initial' => 'nullable|string|max:1',
            'last_name' => 'required|string|max:255',
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
            $organizationId = $user ? $user->organization_id : null;

            $technician = Technician::create([
                'first_name' => $request->first_name,
                'middle_initial' => $request->middle_initial,
                'last_name' => $request->last_name,
                'updated_at' => now(),
                'updated_by' => $request->updated_by ?? ($user->email_address ?? 'system'),
                'organization_id' => $organizationId
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Technician added successfully',
                'data' => $technician
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to add technician',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        $validator = Validator::make($request->all(), [
            'first_name' => 'sometimes|string|max:255',
            'middle_initial' => 'sometimes|nullable|string|max:1',
            'last_name' => 'sometimes|string|max:255',
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
            $organizationId = $user ? $user->organization_id : null;

            $technician = Technician::findOrFail($id);

            // Check if user belongs to an organization and if it matches the technician's organization
            if ($organizationId && $technician->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only update technicians within your organization.'
                ], 403);
            }

            // Don't allow organization_id to be changed via update
            $updateData = $request->except('organization_id');

            $technician->update($updateData + [
                'updated_at' => now(),
                'updated_by' => $request->updated_by ?? ($user->email_address ?? 'system')
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Technician updated successfully',
                'data' => $technician
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to update technician',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $user = auth()->user();
            $organizationId = $user ? $user->organization_id : null;

            $technician = Technician::findOrFail($id);

            // Check if user belongs to an organization and if it matches the technician's organization
            if ($organizationId && $technician->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only delete technicians within your organization.'
                ], 403);
            }

            $technician->delete();

            return response()->json([
                'success' => true,
                'message' => 'Technician deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete technician',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
