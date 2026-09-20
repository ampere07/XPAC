<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Auth;

class InventoryRelatedDataController extends Controller
{
    /**
     * Get related inventory logs by item ID
     */
    public function getInventoryLogsByItem(string $itemId): JsonResponse
    {
        try {
            $query = DB::table('inventory_logs')
                ->where('item_id', $itemId);

            $user = Auth::user();
            if ($user && $user->organization_id) {
                $query->where('organization_id', $user->organization_id);
            }

            $logs = $query->orderBy('date', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching inventory logs for item: ' . $itemId, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch inventory logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related borrowed logs by item ID
     */
    public function getBorrowedLogsByItem(string $itemId): JsonResponse
    {
        try {
            $query = DB::table('borrowed_logs')
                ->where('item_id', $itemId);

            $user = Auth::user();
            if ($user && $user->organization_id) {
                $query->where('organization_id', $user->organization_id);
            }

            $logs = $query->orderBy('date', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching borrowed logs for item: ' . $itemId, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch borrowed logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related defective logs by item ID
     * Note: defective_logs table does not have Item ID column
     */
    public function getDefectiveLogsByItem(string $itemId): JsonResponse
    {
        try {
            // defective_logs table doesn't have Item ID field
            // We can only match by item name, so we need to get the item name first
            $item = DB::table('inventory_items')->where('id', $itemId)->first();
            
            if (!$item) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0,
                    'message' => 'Item not found'
                ]);
            }

            $query = DB::table('defective_logs')
                ->where('item_name', $item->item_name);

            $user = Auth::user();
            if ($user && $user->organization_id) {
                $query->where('organization_id', $user->organization_id);
            }

            $logs = $query->orderBy('date', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching defective logs for item: ' . $itemId, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch defective logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related job orders by item ID
     * Note: job_order_items table only has item_name, not item_id
     */
    public function getJobOrdersByItem(string $itemId): JsonResponse
    {
        try {
            // job_order_items table doesn't have item_id field, only item_name
            // We need to get the item name first
            $item = DB::table('inventory_items')->where('id', $itemId)->first();
            
            if (!$item) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0,
                    'message' => 'Item not found'
                ]);
            }

            // Get job_order_id from job_order_items by matching item_name
            $itemsQuery = DB::table('job_order_items')
                ->where('item_name', $item->item_name);
            
            $user = Auth::user();
            if ($user && $user->organization_id) {
                $itemsQuery->where('organization_id', $user->organization_id);
            }
            
            $jobOrderIds = $itemsQuery->pluck('job_order_id');

            // Then get job orders
            $ordersQuery = DB::table('job_orders')
                ->whereIn('id', $jobOrderIds);
            
            if ($user && $user->organization_id) {
                $ordersQuery->where('organization_id', $user->organization_id);
            }
            
            $jobOrders = $ordersQuery->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $jobOrders,
                'count' => $jobOrders->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching job orders for item: ' . $itemId, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch job orders',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related service orders by item ID
     * Note: service_order_items table only has item_name, not item_id
     */
    public function getServiceOrdersByItem(string $itemId): JsonResponse
    {
        try {
            // service_order_items table doesn't have item_id field, only item_name
            // We need to get the item name first
            $item = DB::table('inventory_items')->where('id', $itemId)->first();
            
            if (!$item) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0,
                    'message' => 'Item not found'
                ]);
            }

            // Get service_order_id from service_order_items by matching item_name
            $itemsQuery = DB::table('service_order_items')
                ->where('item_name', $item->item_name);
            
            $user = Auth::user();
            if ($user && $user->organization_id) {
                $itemsQuery->where('organization_id', $user->organization_id);
            }
            
            $serviceOrderIds = $itemsQuery->pluck('service_order_id');

            // Then get service orders
            $ordersQuery = DB::table('service_orders')
                ->whereIn('id', $serviceOrderIds);
            
            if ($user && $user->organization_id) {
                $ordersQuery->where('organization_id', $user->organization_id);
            }
            
            $serviceOrders = $ordersQuery->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $serviceOrders,
                'count' => $serviceOrders->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching service orders for item: ' . $itemId, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch service orders',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }
}

