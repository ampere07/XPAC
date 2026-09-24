<?php

namespace App\Http\Controllers;

use App\Models\RadiusConfig;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class RadiusConfigController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $configs = RadiusConfig::all();
            
            // Add status check and metrics for each config
            $configsWithStatus = $configs->map(function($config) {
                $isOnline = false;
                $latency = null;
                $publicIp = $config->ip;
                
                try {
                    $start = microtime(true);
                    $connection = @fsockopen($config->ip, $config->port, $errno, $errstr, 2);
                    $end = microtime(true);
                    
                    if ($connection) {
                        $isOnline = true;
                        $latency = round(($end - $start) * 1000, 2);
                        fclose($connection);
                    }
                } catch (\Exception $e) {
                    $isOnline = false;
                }
                
                $configArray = $config->toArray();
                $configArray['is_online'] = $isOnline;
                $configArray['latency'] = $latency;
                $configArray['public_ip'] = $publicIp;
                $configArray['loss'] = $isOnline ? 0 : 100;
                $configArray['anti_radi'] = 1;
                $configArray['checked_at'] = now()->format('Y-m-d H:i:s.u'); // High-precision timestamp
                
                return $configArray;
            });
            
            return response()->json([
                'success' => true,
                'data' => $configsWithStatus,
                'count' => $configs->count(),
                'message' => $configs->isEmpty() ? 'No RADIUS configurations found' : null
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching radius configs', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch RADIUS configurations',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $existingCount = RadiusConfig::count();
            if ($existingCount >= 2) {
                return response()->json([
                    'success' => false,
                    'message' => 'Maximum of 2 RADIUS configurations allowed. Please update or delete existing configurations.'
                ], 400);
            }

            $validator = Validator::make($request->all(), [
                'ssl_type' => 'required|string|in:https,http',
                'ip' => 'required|string|max:255',
                'port' => 'required|string|max:255',
                'username' => 'required|string|max:255',
                'password' => 'required|string|max:255',
                'updated_by' => 'nullable|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $updatedBy = $request->input('updated_by', 'unknown@user.com');

            Log::info('Creating RADIUS configuration', [
                'data' => $request->except(['password', 'updated_by']),
                'updated_by' => $updatedBy
            ]);

            $config = RadiusConfig::create([
                'ssl_type' => $request->input('ssl_type'),
                'ip' => $request->input('ip'),
                'port' => $request->input('port'),
                'username' => $request->input('username'),
                'password' => $request->input('password'),
                'updated_by' => $updatedBy
            ]);

            return response()->json([
                'success' => true,
                'message' => 'RADIUS configuration created successfully',
                'data' => $config
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error creating radius config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request_data' => $request->except(['password'])
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to create RADIUS configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id): JsonResponse
    {
        try {
            $config = RadiusConfig::find($id);
            
            if (!$config) {
                return response()->json([
                    'success' => false,
                    'message' => 'RADIUS configuration not found'
                ], 404);
            }

            $validator = Validator::make($request->all(), [
                'ssl_type' => 'nullable|string|in:https,http',
                'ip' => 'nullable|string|max:255',
                'port' => 'nullable|string|max:255',
                'username' => 'nullable|string|max:255',
                'password' => 'nullable|string|max:255',
                'updated_by' => 'nullable|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $updatedBy = $request->input('updated_by', 'unknown@user.com');

            Log::info('Updating RADIUS configuration', [
                'data' => $request->except(['password', 'updated_by']),
                'updated_by' => $updatedBy
            ]);

            $updateData = ['updated_by' => $updatedBy];

            if ($request->has('ssl_type')) {
                $updateData['ssl_type'] = $request->input('ssl_type');
            }
            if ($request->has('ip')) {
                $updateData['ip'] = $request->input('ip');
            }
            if ($request->has('port')) {
                $updateData['port'] = $request->input('port');
            }
            if ($request->has('username')) {
                $updateData['username'] = $request->input('username');
            }
            if ($request->has('password')) {
                $updateData['password'] = $request->input('password');
            }

            $config->update($updateData);

            return response()->json([
                'success' => true,
                'message' => 'RADIUS configuration updated successfully',
                'data' => $config->fresh()
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating radius config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request_data' => $request->except(['password'])
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to update RADIUS configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id): JsonResponse
    {
        try {
            $config = RadiusConfig::find($id);
            
            if (!$config) {
                return response()->json([
                    'success' => false,
                    'message' => 'RADIUS configuration not found'
                ], 404);
            }

            Log::info('Deleting RADIUS configuration', [
                'id' => $config->id
            ]);

            $config->delete();

            return response()->json([
                'success' => true,
                'message' => 'RADIUS configuration deleted successfully',
                'data' => null
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting radius config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete RADIUS configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

