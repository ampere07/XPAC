<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ServiceOrderItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class ServiceOrderItemApiController extends Controller
{
    public function index(Request $request)
    {
        try {
            $query = ServiceOrderItem::query();
            
            if ($request->has('service_order_id')) {
                $query->where('service_order_id', $request->service_order_id);
            }
            
            $items = $query->get();
            
            return response()->json([
                'success' => true,
                'data' => $items
            ]);
        } catch (\Exception $e) {
            Log::error('ServiceOrderItemApiController::index - Error', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error fetching service order items: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            Log::info('ServiceOrderItemApiController::store - Request received', [
                'payload' => $request->all(),
                'items_count' => count($request->input('items', []))
            ]);

            $validator = Validator::make($request->all(), [
                'items' => 'required|array',
                'items.*.service_order_id' => 'required|integer',
                'items.*.item_name' => 'required|string|max:255',
                'items.*.quantity' => 'required|integer|min:1',
                'items.*.is_pullout' => 'nullable|boolean',
                'items.*.serial_number' => 'nullable|string|max:255',
            ]);

            if ($validator->fails()) {
                Log::error('ServiceOrderItemApiController::store - Validation failed', [
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
            
            // Check table structure once outside the loop
            $hasIsPullout = \Illuminate\Support\Facades\Schema::hasColumn('service_order_items', 'is_pullout');
            $hasSerialNumber = \Illuminate\Support\Facades\Schema::hasColumn('service_order_items', 'serial_number');
            $hasItemName = \Illuminate\Support\Facades\Schema::hasColumn('service_order_items', 'item_name');
            $hasItemId = \Illuminate\Support\Facades\Schema::hasColumn('service_order_items', 'item_id');

            foreach ($items as $index => $item) {
                try {
                    $insertData = [
                        'service_order_id' => $item['service_order_id'],
                        'quantity' => $item['quantity'],
                    ];
                    
                    if ($hasItemName) {
                        $insertData['item_name'] = $item['item_name'];
                    }
                    
                    if ($hasItemId && isset($item['item_id'])) {
                        $insertData['item_id'] = $item['item_id'];
                    }
                    
                    if ($hasIsPullout) {
                        $insertData['is_pullout'] = $item['is_pullout'] ?? false;
                    }
                    
                    if ($hasSerialNumber) {
                        $insertData['serial_number'] = $item['serial_number'] ?? null;
                    }

                    $serviceOrderItem = ServiceOrderItem::create($insertData);
                    
                    $insertedItems[] = $serviceOrderItem;

                    Log::info('ServiceOrderItemApiController::store - Item inserted', [
                        'index' => $index,
                        'item_id' => $serviceOrderItem->id,
                        'service_order_id' => $item['service_order_id'],
                        'item_name' => $item['item_name'] ?? ($item['item_id'] ?? 'N/A'),
                        'quantity' => $item['quantity']
                    ]);
                } catch (\Exception $itemError) {
                    Log::error('ServiceOrderItemApiController::store - Failed to insert item', [
                        'index' => $index,
                        'item' => $item,
                        'error' => $itemError->getMessage()
                    ]);
                    throw $itemError;
                }
            }

            return response()->json([
                'success' => true,
                'message' => 'Service order items created successfully',
                'data' => $insertedItems,
                'count' => count($insertedItems)
            ], 201);
        } catch (\Exception $e) {
            Log::error('ServiceOrderItemApiController::store - Error', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error creating service order items: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $item = ServiceOrderItem::find($id);
            
            if (!$item) {
                return response()->json([
                    'success' => false,
                    'message' => 'Service order item not found'
                ], 404);
            }
            
            return response()->json([
                'success' => true,
                'data' => $item
            ]);
        } catch (\Exception $e) {
            Log::error('ServiceOrderItemApiController::show - Error', [
                'id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error fetching service order item: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $validator = Validator::make($request->all(), [
                'service_order_id' => 'sometimes|required|integer',
                'item_name' => 'sometimes|required|string|max:255',
                'quantity' => 'sometimes|required|integer|min:1',
                'is_pullout' => 'nullable|boolean',
                'serial_number' => 'nullable|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $item = ServiceOrderItem::find($id);
            
            if (!$item) {
                return response()->json([
                    'success' => false,
                    'message' => 'Service order item not found'
                ], 404);
            }

            // Filter out fields that don't exist in the table
            $updateData = $request->only(['service_order_id', 'item_name', 'quantity', 'is_pullout', 'serial_number', 'item_id']);
            $finalUpdateData = [];
            foreach ($updateData as $key => $value) {
                if (\Illuminate\Support\Facades\Schema::hasColumn('service_order_items', $key)) {
                    $finalUpdateData[$key] = $value;
                }
            }

            $item->update($finalUpdateData);

            return response()->json([
                'success' => true,
                'message' => 'Service order item updated successfully',
                'data' => $item->fresh()
            ]);
        } catch (\Exception $e) {
            Log::error('ServiceOrderItemApiController::update - Error', [
                'id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error updating service order item: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $item = ServiceOrderItem::find($id);
            
            if (!$item) {
                return response()->json([
                    'success' => false,
                    'message' => 'Service order item not found'
                ], 404);
            }

            $item->delete();

            return response()->json([
                'success' => true,
                'message' => 'Service order item deleted successfully'
            ]);
        } catch (\Exception $e) {
            Log::error('ServiceOrderItemApiController::destroy - Error', [
                'id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error deleting service order item: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getByServiceOrderId($serviceOrderId)
    {
        try {
            $items = ServiceOrderItem::where('service_order_id', $serviceOrderId)->get();
            
            return response()->json([
                'success' => true,
                'data' => $items
            ]);
        } catch (\Exception $e) {
            Log::error('ServiceOrderItemApiController::getByServiceOrderId - Error', [
                'service_order_id' => $serviceOrderId,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error fetching service order items: ' . $e->getMessage(),
                'data' => []
            ], 500);
        }
    }

    public function updateByServiceOrderId(Request $request, $serviceOrderId)
    {
        try {
            Log::info('ServiceOrderItemApiController::updateByServiceOrderId - Request received', [
                'service_order_id' => $serviceOrderId,
                'payload' => $request->all()
            ]);

            $validator = Validator::make($request->all(), [
                'items' => 'required|array',
                'items.*.item_name' => 'required|string|max:255',
                'items.*.quantity' => 'required|integer|min:1',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $items = $request->input('items');
            
            // Delete existing items for this service order to sync
            ServiceOrderItem::where('service_order_id', $serviceOrderId)->delete();
            
            $insertedItems = [];
            foreach ($items as $item) {
                $itemData = [
                    'service_order_id' => $serviceOrderId,
                    'item_name' => $item['item_name'],
                    'quantity' => $item['quantity'],
                    'is_pullout' => $item['is_pullout'] ?? false,
                    'serial_number' => $item['serial_number'] ?? null,
                ];
                
                // Add optional item_id if present
                if (isset($item['item_id'])) {
                    $itemData['item_id'] = $item['item_id'];
                }

                $insertedItems[] = ServiceOrderItem::create($itemData);
            }

            return response()->json([
                'success' => true,
                'message' => 'Service order items updated successfully',
                'data' => $insertedItems,
                'count' => count($insertedItems)
            ]);
        } catch (\Exception $e) {
            Log::error('ServiceOrderItemApiController::updateByServiceOrderId - Error', [
                'service_order_id' => $serviceOrderId,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Error updating service order items: ' . $e->getMessage()
            ], 500);
        }
    }
}

