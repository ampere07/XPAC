<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class BillingStatusApiController extends Controller
{
    public function index()
    {
        try {
            $statuses = DB::table('billing_status')
                ->orderBy('id', 'asc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $statuses
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching billing statuses: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch billing statuses',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $validated = $request->validate([
                'status_name' => 'required|string|max:255|unique:billing_status,status_name'
            ]);

            $id = DB::table('billing_status')->insertGetId([
                'status_name' => $validated['status_name'],
                'created_at' => now(),
                'created_by_user_id' => auth()->id(),
                'updated_at' => now(),
                'updated_by_user_id' => auth()->id()
            ]);

            $status = DB::table('billing_status')->where('id', $id)->first();

            return response()->json([
                'success' => true,
                'message' => 'Billing status created successfully',
                'data' => $status
            ], 201);
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            Log::error('Error creating billing status: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to create billing status',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $status = DB::table('billing_status')
                ->where('id', $id)
                ->first();

            if (!$status) {
                return response()->json([
                    'success' => false,
                    'message' => 'Billing status not found'
                ], 404);
            }

            return response()->json([
                'success' => true,
                'data' => $status
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching billing status: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch billing status',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $status = DB::table('billing_status')
                ->where('id', $id)
                ->first();

            if (!$status) {
                return response()->json([
                    'success' => false,
                    'message' => 'Billing status not found'
                ], 404);
            }

            $validated = $request->validate([
                'status_name' => 'required|string|max:255|unique:billing_status,status_name,' . $id
            ]);

            DB::table('billing_status')
                ->where('id', $id)
                ->update([
                    'status_name' => $validated['status_name'],
                    'updated_at' => now(),
                    'updated_by_user_id' => auth()->id()
                ]);

            $updatedStatus = DB::table('billing_status')
                ->where('id', $id)
                ->first();

            return response()->json([
                'success' => true,
                'message' => 'Billing status updated successfully',
                'data' => $updatedStatus
            ]);
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            Log::error('Error updating billing status: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to update billing status',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $status = DB::table('billing_status')
                ->where('id', $id)
                ->first();

            if (!$status) {
                return response()->json([
                    'success' => false,
                    'message' => 'Billing status not found'
                ], 404);
            }

            $usageCount = DB::table('job_orders')
                ->where('billing_status_id', $id)
                ->count();

            if ($usageCount > 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete billing status as it is being used by ' . $usageCount . ' job order(s)'
                ], 400);
            }

            DB::table('billing_status')
                ->where('id', $id)
                ->delete();

            return response()->json([
                'success' => true,
                'message' => 'Billing status deleted successfully'
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting billing status: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete billing status',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
