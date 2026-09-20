<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\JobOrderItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class JobOrderItemApiController extends Controller
{
    public function index(Request $request)
    {
        try {
            $query = JobOrderItem::query();
            
            if ($request->has('job_order_id')) {
                $query->where('job_order_id', $request->job_order_id);
            }
            
            $items = $query->get();
            
            return response()->json([
                'success' => true,
                'data' => $items
            ]);
        } catch (\Exception $e) {
            Log::error('JobOrderItemApiController::index - Error', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error fetching job order items: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            Log::info('JobOrderItemApiController::store - Request received', [
                'payload' => $request->all(),
                'items_count' => count($request->input('items', []))
            ]);

            $validator = Validator::make($request->all(), [
                'items' => 'required|array',
                'items.*.job_order_id' => 'required|integer',
                'items.*.item_name' => 'required|string|max:255',
                'items.*.quantity' => 'required|integer|min:1',
            ]);

            if ($validator->fails()) {
                Log::error('JobOrderItemApiController::store - Validation failed', [
                    'errors' => $validator->errors()->toArray()
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $items = $request->input('items');
            $insertedItems = [];

            Log::info('JobOrderItemApiController::store - Starting item insertion', [
                'items_to_insert' => $items
            ]);

            foreach ($items as $index => $item) {
                try {
                    $jobOrderItem = JobOrderItem::create([
                        'job_order_id' => $item['job_order_id'],
                        'item_name' => $item['item_name'],
                        'quantity' => $item['quantity']
                    ]);
                    
                    $insertedItems[] = $jobOrderItem;

                    Log::info('JobOrderItemApiController::store - Item inserted', [
                        'index' => $index,
                        'item_id' => $jobOrderItem->id,
                        'job_order_id' => $item['job_order_id'],
                        'item_name' => $item['item_name'],
                        'quantity' => $item['quantity']
                    ]);
                } catch (\Exception $itemError) {
                    Log::error('JobOrderItemApiController::store - Failed to insert item', [
                        'index' => $index,
                        'item' => $item,
                        'error' => $itemError->getMessage()
                    ]);
                    throw $itemError;
                }
            }

            Log::info('JobOrderItemApiController::store - All items inserted successfully', [
                'count' => count($insertedItems)
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Job order items created successfully',
                'data' => $insertedItems,
                'count' => count($insertedItems)
            ], 201);
        } catch (\Exception $e) {
            Log::error('JobOrderItemApiController::store - Error', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error creating job order items: ' . $e->getMessage(),
                'error_details' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $item = JobOrderItem::find($id);
            
            if (!$item) {
                return response()->json([
                    'success' => false,
                    'message' => 'Job order item not found'
                ], 404);
            }
            
            return response()->json([
                'success' => true,
                'data' => $item
            ]);
        } catch (\Exception $e) {
            Log::error('JobOrderItemApiController::show - Error', [
                'id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error fetching job order item: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $validator = Validator::make($request->all(), [
                'job_order_id' => 'sometimes|required|integer',
                'item_name' => 'sometimes|required|string|max:255',
                'quantity' => 'sometimes|required|integer|min:1',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $item = JobOrderItem::find($id);
            
            if (!$item) {
                return response()->json([
                    'success' => false,
                    'message' => 'Job order item not found'
                ], 404);
            }

            $item->update($request->only(['job_order_id', 'item_name', 'quantity']));

            return response()->json([
                'success' => true,
                'message' => 'Job order item updated successfully',
                'data' => $item->fresh()
            ]);
        } catch (\Exception $e) {
            Log::error('JobOrderItemApiController::update - Error', [
                'id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error updating job order item: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $item = JobOrderItem::find($id);
            
            if (!$item) {
                return response()->json([
                    'success' => false,
                    'message' => 'Job order item not found'
                ], 404);
            }

            $item->delete();

            return response()->json([
                'success' => true,
                'message' => 'Job order item deleted successfully'
            ]);
        } catch (\Exception $e) {
            Log::error('JobOrderItemApiController::destroy - Error', [
                'id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error deleting job order item: ' . $e->getMessage()
            ], 500);
        }
    }
}
