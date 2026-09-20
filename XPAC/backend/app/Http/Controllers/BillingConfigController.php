<?php

namespace App\Http\Controllers;

use App\Models\BillingConfig;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class BillingConfigController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $config = BillingConfig::first();
            
            if (!$config) {
                return response()->json([
                    'success' => true,
                    'data' => null,
                    'message' => 'No billing configuration found'
                ]);
            }

            return response()->json([
                'success' => true,
                'data' => $config
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching billing config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch billing configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $existingCount = BillingConfig::count();
            if ($existingCount > 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Billing configuration already exists. Please update or delete the existing one.'
                ], 400);
            }

            $validator = Validator::make($request->all(), [
                'advance_generation_day' => 'nullable|integer|min:0',
                'due_date_day' => 'nullable|integer|min:0',
                'disconnection_day' => 'nullable|integer|min:0',
                'overdue_day' => 'nullable|integer|min:0',
                'disconnection_notice' => 'nullable|integer|min:0',
                'disconnection_fee' => 'nullable|numeric|min:0',
                'pullout_day' => 'nullable|integer|min:0',
                'user_email' => 'nullable|email|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $userEmail = $request->input('user_email', 'unknown@user.com');

            Log::info('Creating billing configuration', [
                'data' => $request->except('user_email'),
                'updated_by' => $userEmail
            ]);

            $config = BillingConfig::create([
                'advance_generation_day' => $request->input('advance_generation_day', 0),
                'due_date_day' => $request->input('due_date_day', 0),
                'disconnection_day' => $request->input('disconnection_day', 0),
                'overdue_day' => $request->input('overdue_day', 0),
                'disconnection_notice' => $request->input('disconnection_notice', 0),
                'disconnection_fee' => $request->input('disconnection_fee', 0.00),
                'pullout_day' => $request->input('pullout_day', 0),
                'updated_by' => $userEmail,
                'created_by' => $userEmail
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Billing configuration created successfully',
                'data' => $config
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error creating billing config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request_data' => $request->all()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to create billing configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request): JsonResponse
    {
        try {
            $config = BillingConfig::first();
            
            if (!$config) {
                return response()->json([
                    'success' => false,
                    'message' => 'Billing configuration not found'
                ], 404);
            }

            $validator = Validator::make($request->all(), [
                'advance_generation_day' => 'nullable|integer|min:0',
                'due_date_day' => 'nullable|integer|min:0',
                'disconnection_day' => 'nullable|integer|min:0',
                'overdue_day' => 'nullable|integer|min:0',
                'disconnection_notice' => 'nullable|integer|min:0',
                'disconnection_fee' => 'nullable|numeric|min:0',
                'pullout_day' => 'nullable|integer|min:0',
                'user_email' => 'nullable|email|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $userEmail = $request->input('user_email', 'unknown@user.com');

            Log::info('Updating billing configuration', [
                'data' => $request->except('user_email'),
                'updated_by' => $userEmail
            ]);

            $config->update([
                'advance_generation_day' => $request->input('advance_generation_day', $config->advance_generation_day),
                'due_date_day' => $request->input('due_date_day', $config->due_date_day),
                'disconnection_day' => $request->input('disconnection_day', $config->disconnection_day),
                'overdue_day' => $request->input('overdue_day', $config->overdue_day),
                'disconnection_notice' => $request->input('disconnection_notice', $config->disconnection_notice),
                'disconnection_fee' => $request->input('disconnection_fee', $config->disconnection_fee),
                'pullout_day' => $request->input('pullout_day', $config->pullout_day),
                'updated_by' => $userEmail
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Billing configuration updated successfully',
                'data' => $config->fresh()
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating billing config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request_data' => $request->all()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to update billing configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy(): JsonResponse
    {
        try {
            $config = BillingConfig::first();
            
            if (!$config) {
                return response()->json([
                    'success' => false,
                    'message' => 'Billing configuration not found'
                ], 404);
            }

            Log::info('Deleting billing configuration', [
                'id' => $config->id
            ]);

            $config->delete();

            return response()->json([
                'success' => true,
                'message' => 'Billing configuration deleted successfully',
                'data' => null
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting billing config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete billing configuration',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

