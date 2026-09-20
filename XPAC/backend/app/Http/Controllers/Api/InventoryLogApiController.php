<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\InventoryLog;
use App\Models\Inventory;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\ActivityLog;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Auth;

class InventoryLogApiController extends Controller
{
    private function getCurrentUser(Request $request)
    {
        if (auth()->check()) {
            return auth()->user()->email_address;
        }
        if ($request->has('user_email')) {
            return $request->user_email;
        }
        if ($request->has('modified_by')) {
            return $request->modified_by;
        }
        if ($request->has('modifiedBy')) {
            return $request->modifiedBy;
        }
        throw new \Exception('Unauthenticated: User email is required for this operation.');
    }

    /**
     * Get all logs
     */
    public function index()
    {
        try {
            $currentUser = Auth::user();
            $query = InventoryLog::query();
            
            if ($currentUser && $currentUser->organization_id) {
                $query->where('organization_id', $currentUser->organization_id);
            }
            
            $logs = $query->orderBy('date', 'desc')->get();
            return response()->json([
                'success' => true,
                'data' => $logs
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching logs: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Store a new log and update item quantity
     */
    public function store(Request $request)
    {
        try {
            $currentUser = Auth::user();
            $validator = Validator::make($request->all(), [
                'item_id' => 'required|exists:inventory_items,id',
                'item_quantity' => 'required|integer',
                'log_type' => 'required|string|in:Stock In,Stock Out',
                'requested_by' => 'nullable|string',
                'requested_with' => 'nullable|string',
                'requested_with_10' => 'nullable|string',
                'status' => 'nullable|string',
                'remarks' => 'nullable|string',
                'sn' => 'nullable|string',
                'account_no' => 'nullable|string'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $item = Inventory::findOrFail($request->item_id);

            // Ensure user belongs to the same organization as the item
            if ($currentUser && $currentUser->organization_id && $item->organization_id && $item->organization_id !== $currentUser->organization_id) {
                return response()->json(['success' => false, 'message' => 'Unauthorized access to this inventory item'], 403);
            }

            DB::beginTransaction();

            // Create the log
            $log = new InventoryLog();
            $log->id = (string) Str::uuid(); // Generate a UUID for the ID
            $log->date = now();
            $log->item_name = $item->item_name;
            $log->item_description = Str::limit($item->item_description, 192, ''); // Truncate to 192 chars without '...' suffix
            $log->item_id = $item->id;
            $log->item_quantity = $request->item_quantity;
            $log->log_type = $request->log_type;
            $log->requested_by = $request->requested_by;
            $log->requested_with = $request->requested_with;
            $log->requested_with_10 = $request->requested_with_10;
            $log->status = $request->status;
            $log->remarks = $request->remarks;
            $log->sn = $request->sn;
            $log->account_no = $request->account_no;
            $log->modified_by = $this->getCurrentUser($request);
            $log->modified_date = now();
            $log->user_email = $this->getCurrentUser($request);
            $log->organization_id = $currentUser->organization_id ?? null;
            $log->save();

            // Update item total quantity
            if ($request->log_type === 'Stock Out') {
                $item->total_quantity = ($item->total_quantity ?? 0) - $request->item_quantity;
            } else {
                $item->total_quantity = ($item->total_quantity ?? 0) + $request->item_quantity;
            }
            $item->save();

            // Create Activity Log
            ActivityLog::log(
                'Inventory Log Created',
                "Inventory Log created for item: {$item->item_name} ({$request->log_type} - Qty: {$request->item_quantity})",
                'info',
                [
                    'resource_type' => 'InventoryLog',
                    'resource_id' => $log->id,
                    'additional_data' => [
                        'item_id' => $item->id,
                        'item_name' => $item->item_name,
                        'log_type' => $request->log_type,
                        'quantity' => $request->item_quantity,
                        'sn' => $request->sn,
                        'requested_by' => $request->requested_by,
                        'new_total_quantity' => $item->total_quantity,
                        'organization_id' => $log->organization_id
                    ]
                ]
            );

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'Inventory log created and item quantity updated successfully',
                'data' => $log
            ], 201);

        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Inventory Log Store Error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Error storing inventory log: ' . $e->getMessage()
            ], 500);
        }
    }
}
