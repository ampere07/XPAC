<?php

namespace App\Http\Controllers;

use App\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Services\ActivityLogService;

class OrganizationController extends Controller
{
    public function index()
    {
        try {
            $user = auth()->user();
            $organizationId = $user ? $user->organization_id : null;

            $query = Organization::with(['users']);

            if ($organizationId) {
                // If user has organization_id, only show organizations that belong to it
                // Or if the organization itself is the one the user belongs to?
                // Given the pattern "i added the organization_id im the organizations table",
                // we treat it as a parent-child or tenant grouping.
                $query->where('organization_id', $organizationId);
            }

            $organizations = $query->get();
            return response()->json([
                'success' => true,
                'data' => $organizations
            ]);
        } catch (\Throwable $e) {
            \Log::error('Failed to fetch organizations: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch organizations',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'organization_name' => 'required|string|max:255',
            'address' => 'nullable|string|max:500',
            'contact_number' => 'nullable|string|max:50',
            'email_address' => 'nullable|email|max:255',
            'created_by_user_id' => 'nullable|string|max:255',
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

            $organization = Organization::create([
                'organization_name' => $request->organization_name,
                'address' => $request->address,
                'contact_number' => $request->contact_number,
                'email_address' => $request->email_address,
                'created_by_user_id' => $request->created_by_user_id,
                'organization_id' => $organizationId
            ]);

            try {
                ActivityLogService::organizationCreated(
                    null,
                    $organization,
                    ['created_by' => 'system']
                );
            } catch (\Exception $logError) {
                \Log::warning('Failed to log organization creation activity: ' . $logError->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Organization created successfully',
                'data' => $organization
            ], 201);
        } catch (\Throwable $e) {
            \Log::error('Failed to create organization: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to create organization',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $user = auth()->user();
            $organizationId = $user ? $user->organization_id : null;

            $organization = Organization::with(['users'])->findOrFail($id);

            if ($organizationId && $organization->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to organization data.'
                ], 403);
            }

            return response()->json([
                'success' => true,
                'data' => $organization
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Organization not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, $id)
    {
        $validator = Validator::make($request->all(), [
            'organization_name' => 'sometimes|string|max:255',
            'address' => 'sometimes|nullable|string|max:500',
            'contact_number' => 'sometimes|nullable|string|max:50',
            'email_address' => 'sometimes|nullable|email|max:255',
            'updated_by_user_id' => 'sometimes|nullable|string|max:255',
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

            $organization = Organization::findOrFail($id);

            if ($organizationId && $organization->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only update organizations within your scope.'
                ], 403);
            }

            $oldData = $organization->toArray();
            
            // Don't allow organization_id to be changed via update
            $updateData = $request->only(['organization_name', 'address', 'contact_number', 'email_address', 'updated_by_user_id']);
            $organization->update($updateData);

            try {
                $changes = array_diff_assoc($request->only(['organization_name', 'address', 'contact_number', 'email_address']), $oldData);
                ActivityLogService::organizationUpdated(
                    null,
                    $organization,
                    $changes
                );
            } catch (\Exception $logError) {
                \Log::warning('Failed to log organization update activity: ' . $logError->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Organization updated successfully',
                'data' => $organization
            ]);
        } catch (\Throwable $e) {
            \Log::error('Failed to update organization: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update organization',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $user = auth()->user();
            $organizationId = $user ? $user->organization_id : null;

            $organization = Organization::findOrFail($id);

            if ($organizationId && $organization->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only delete organizations within your scope.'
                ], 403);
            }

            $orgName = $organization->organization_name;
            $organization->delete();

            try {
                ActivityLogService::organizationDeleted(
                    null,
                    $id,
                    $orgName
                );
            } catch (\Exception $logError) {
                \Log::warning('Failed to log organization deletion activity: ' . $logError->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Organization deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete organization',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
