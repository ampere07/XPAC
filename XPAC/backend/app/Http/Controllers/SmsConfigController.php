<?php

namespace App\Http\Controllers;

use App\Models\SmsConfig;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class SmsConfigController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $configs = SmsConfig::all();
            
            return response()->json([
                'success' => true,
                'data' => $configs,
                'count' => $configs->count(),
                'message' => $configs->isEmpty() ? 'No SMS configurations found' : null
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching SMS configs', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch SMS configurations',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $existingCount = SmsConfig::count();
            if ($existingCount >= 2) {
                return response()->json([
                    'success' => false,
                    'message' => 'Maximum of 2 SMS configurations allowed. Please update or delete existing configurations.'
                ], 400);
            }

            $validator = Validator::make($request->all(), [
                'provider' => 'nullable|string|in:itexmo,semaphore',
                'code' => 'required|string|max:255',
                'email' => 'required_if:provider,itexmo|nullable|email|max:255',
                'password' => 'required_if:provider,itexmo|nullable|string|max:255',
                'sender' => 'required|string|max:255',
                'updated_by' => 'nullable|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $updatedBy = $request->input('updated_by');

            Log::info('Creating SMS configuration', [
                'data' => $request->except(['password', 'updated_by']),
                'updated_by' => $updatedBy
            ]);

            $config = SmsConfig::create([
                'provider' => $request->input('provider', 'itexmo'),
                'code' => $request->input('code'),
                'email' => $request->input('email'),
                'password' => $request->input('password'),
                'sender' => $request->input('sender'),
                'updated_by' => $updatedBy,
                'created_by' => $updatedBy
            ]);

            return response()->json([
                'success' => true,
                'message' => 'SMS configuration created successfully',
                'data' => $config
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error creating SMS config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request_data' => $request->except(['password'])
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to create SMS configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id): JsonResponse
    {
        try {
            $config = SmsConfig::find($id);
            
            if (!$config) {
                return response()->json([
                    'success' => false,
                    'message' => 'SMS configuration not found'
                ], 404);
            }

            $validator = Validator::make($request->all(), [
                'provider' => 'nullable|string|in:itexmo,semaphore',
                'code' => 'nullable|string|max:255',
                'email' => 'nullable|email|max:255',
                'password' => 'nullable|string|max:255',
                'sender' => 'nullable|string|max:255',
                'updated_by' => 'nullable|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $updatedBy = $request->input('updated_by');

            Log::info('Updating SMS configuration', [
                'data' => $request->except(['password', 'updated_by']),
                'updated_by' => $updatedBy
            ]);

            $updateData = ['updated_by' => $updatedBy];

            if ($request->has('provider')) {
                $updateData['provider'] = $request->input('provider');
            }
            if ($request->has('code')) {
                $updateData['code'] = $request->input('code');
            }
            if ($request->has('email')) {
                $updateData['email'] = $request->input('email');
            }
            if ($request->has('password')) {
                $updateData['password'] = $request->input('password');
            }
            if ($request->has('sender')) {
                $updateData['sender'] = $request->input('sender');
            }

            $config->update($updateData);

            return response()->json([
                'success' => true,
                'message' => 'SMS configuration updated successfully',
                'data' => $config->fresh()
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating SMS config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request_data' => $request->except(['password'])
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to update SMS configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id): JsonResponse
    {
        try {
            $config = SmsConfig::find($id);
            
            if (!$config) {
                return response()->json([
                    'success' => false,
                    'message' => 'SMS configuration not found'
                ], 404);
            }

            Log::info('Deleting SMS configuration', [
                'id' => $config->id
            ]);

            $config->delete();

            return response()->json([
                'success' => true,
                'message' => 'SMS configuration deleted successfully',
                'data' => null
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting SMS config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete SMS configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
