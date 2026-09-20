<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;

/**
 * Custom Account Number Controller
 * 
 * This table is designed as a single-row configuration table without a primary key.
 * Only one record can exist at a time. Operations:
 * - CREATE: Only allowed when table is empty
 * - UPDATE: Updates the single existing row
 * - DELETE: Removes the single row
 */
class CustomAccountNumberController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $customNumber = DB::table('custom_account_number')->first();
            
            if (!$customNumber) {
                return response()->json([
                    'success' => true,
                    'data' => null,
                    'message' => 'No custom account number configured'
                ]);
            }

            return response()->json([
                'success' => true,
                'data' => $customNumber
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching custom account number', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch custom account number',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $existingCount = DB::table('custom_account_number')->count();
            if ($existingCount > 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'A custom account number already exists. Please update or delete the existing one.'
                ], 400);
            }

            $startingNumber = $request->input('starting_number');

            if ($startingNumber === '' || $startingNumber === null) {
                $validator = Validator::make($request->all(), [
                    'starting_number' => 'nullable|string',
                    'user_email' => 'nullable|email|max:255'
                ]);
            } else {
                $validator = Validator::make($request->all(), [
                    'starting_number' => [
                        'required',
                        'string',
                        'max:7',
                        'regex:/^[A-Za-z0-9]+$/'
                    ],
                    'user_email' => 'nullable|email|max:255'
                ], [
                    'starting_number.required' => 'Starting number is required',
                    'starting_number.max' => 'Starting number must not exceed 7 characters',
                    'starting_number.regex' => 'Starting number must contain only letters and numbers'
                ]);
            }

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $userEmail = $request->input('user_email', 'unknown@user.com');
            $startingNumberValue = $startingNumber === '' ? null : $startingNumber;

            Log::info('Creating custom account number', [
                'starting_number' => $startingNumberValue,
                'updated_by' => $userEmail
            ]);

            DB::table('custom_account_number')->insert([
                'starting_number' => $startingNumberValue,
                'updated_by' => $userEmail,
                'created_by' => $userEmail,
                'created_at' => now(),
                'updated_at' => now()
            ]);

            $customNumber = DB::table('custom_account_number')->first();

            return response()->json([
                'success' => true,
                'message' => 'Custom account number created successfully',
                'data' => $customNumber
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error creating custom account number', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request_data' => $request->all()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to create custom account number',
                'error' => $e->getMessage(),
                'details' => config('app.debug') ? $e->getTraceAsString() : null
            ], 500);
        }
    }

    /**
     * Update the single configuration row
     * No WHERE clause needed since table only contains one row by design
     */
    public function update(Request $request): JsonResponse
    {
        try {
            $existingRecord = DB::table('custom_account_number')->first();
            
            if (!$existingRecord) {
                return response()->json([
                    'success' => false,
                    'message' => 'Custom account number not found'
                ], 404);
            }

            $startingNumber = $request->input('starting_number');

            if ($startingNumber === '' || $startingNumber === null) {
                $validator = Validator::make($request->all(), [
                    'starting_number' => 'nullable|string',
                    'user_email' => 'nullable|email|max:255'
                ]);
            } else {
                $validator = Validator::make($request->all(), [
                    'starting_number' => [
                        'required',
                        'string',
                        'max:7',
                        'regex:/^[A-Za-z0-9]+$/'
                    ],
                    'user_email' => 'nullable|email|max:255'
                ], [
                    'starting_number.required' => 'Starting number is required',
                    'starting_number.max' => 'Starting number must not exceed 7 characters',
                    'starting_number.regex' => 'Starting number must contain only letters and numbers'
                ]);
            }

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $userEmail = $request->input('user_email', 'unknown@user.com');
            $newStartingNumberValue = $startingNumber === '' ? null : $startingNumber;

            Log::info('Updating custom account number', [
                'old_starting_number' => $existingRecord->starting_number,
                'new_starting_number' => $newStartingNumberValue,
                'updated_by' => $userEmail
            ]);

            // Update the first (and only) row - no WHERE clause needed
            DB::table('custom_account_number')
                ->update([
                    'starting_number' => $newStartingNumberValue,
                    'updated_by' => $userEmail,
                    'updated_at' => now()
                ]);

            $updatedNumber = DB::table('custom_account_number')->first();

            return response()->json([
                'success' => true,
                'message' => 'Custom account number updated successfully',
                'data' => $updatedNumber
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating custom account number', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request_data' => $request->all()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to update custom account number',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Delete the single configuration row
     * Using truncate to clear the table
     */
    public function destroy(): JsonResponse
    {
        try {
            $customNumber = DB::table('custom_account_number')->first();
            
            if (!$customNumber) {
                return response()->json([
                    'success' => false,
                    'message' => 'Custom account number not found'
                ], 404);
            }

            Log::info('Deleting custom account number', [
                'starting_number' => $customNumber->starting_number
            ]);

            DB::table('custom_account_number')->truncate();

            return response()->json([
                'success' => true,
                'message' => 'Custom account number deleted successfully',
                'data' => null
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting custom account number', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete custom account number',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
