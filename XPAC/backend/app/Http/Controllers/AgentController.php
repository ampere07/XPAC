<?php

namespace App\Http\Controllers;

use App\Models\Agent;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class AgentController extends Controller
{
    public function index()
    {
        try {
            $user = auth()->user();
            $organizationId = $user->organization_id;

            $query = Agent::query();

            if ($organizationId) {
                $query->where('organization_id', $organizationId);
            }

            $agents = $query->get();
            return response()->json([
                'success' => true,
                'data' => $agents
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch agents',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'team_name' => 'required|string|max:255',
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
            $organizationId = $user->organization_id;

            $agent = Agent::create([
                'team_name' => $request->team_name,
                'created_at' => now(),
                'created_by' => $request->created_by ?? ($user->email_address ?? 'system'),
                'organization_id' => $organizationId
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Agent added successfully',
                'data' => $agent
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to add agent',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        $validator = Validator::make($request->all(), [
            'team_name' => 'sometimes|string|max:255',
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
            $organizationId = $user->organization_id;

            $agent = Agent::findOrFail($id);

            // Check if user belongs to an organization and if it matches the agent's organization
            if ($organizationId && $agent->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only update agents within your organization.'
                ], 403);
            }

            // Don't allow organization_id to be changed via update
            $updateData = $request->except('organization_id');
            $agent->update($updateData);

            return response()->json([
                'success' => true,
                'message' => 'Agent updated successfully',
                'data' => $agent
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to update agent',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $user = auth()->user();
            $organizationId = $user->organization_id;

            $agent = Agent::findOrFail($id);

            // Check if user belongs to an organization and if it matches the agent's organization
            if ($organizationId && $agent->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only delete agents within your organization.'
                ], 403);
            }

            $agent->delete();

            return response()->json([
                'success' => true,
                'message' => 'Agent deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete agent',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
