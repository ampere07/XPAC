<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WorkOrder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Events\WorkOrderUpdated;
use App\Models\ActivityLog;
use Illuminate\Support\Facades\Auth;

class WorkOrderApiController extends Controller
{
    public function index(Request $request)
    {
        try {
            $page = (int) $request->get('page', 1);
            $limit = min((int) $request->get('limit', 50), 100);
            $search = $request->get('search', '');
            $status = $request->get('status', '');
            
            $query = WorkOrder::query();

            // Apply organization filter
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            if (!empty($search)) {
                $query->where(function($q) use ($search) {
                    $q->where('instructions', 'like', '%' . $search . '%')
                      ->orWhere('report_to', 'like', '%' . $search . '%')
                      ->orWhere('assign_to', 'like', '%' . $search . '%')
                      ->orWhere('requested_by', 'like', '%' . $search . '%');
                });
            }
            
            if (!empty($status) && strtolower($status) !== 'all') {
                $query->where('work_status', $status);
            }

            if ($request->has('updated_since')) {
                $query->where('updated_date', '>', $request->input('updated_since'));
                // increase limit for updates
                $limit = $request->input('limit', 1000);
            }
            
            $totalItems = $query->count();
            $totalPages = ceil($totalItems / $limit);
            
            $workOrders = $query->orderBy('requested_date', 'desc')
                             ->skip(($page - 1) * $limit)
                             ->take($limit)
                             ->get();
            
            return response()->json([
                'success' => true,
                'data' => $workOrders,
                'pagination' => [
                    'current_page' => $page,
                    'total_pages' => max(1, $totalPages),
                    'total_items' => $totalItems,
                    'items_per_page' => $limit,
                    'has_next' => $page < $totalPages,
                    'has_prev' => $page > 1
                ]
            ]);
            
        } catch (\Exception $e) {
            \Log::error('WorkOrder API Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error fetching work orders: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'instructions' => 'required|string',
                'report_to' => 'required|string|max:255',
                'assign_to' => 'nullable|string|max:255',
                'remarks' => 'nullable|string',
                'work_status' => 'nullable|string|max:100',
                'work_category' => 'nullable|string|max:255',
                'requested_by' => 'required|string|max:255',
                'updated_by' => 'nullable|string|max:255',
                'start_time' => 'nullable|string',
                'end_time' => 'nullable|string',
                'organization_id' => 'nullable|integer'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }
            
            $workOrder = new WorkOrder();
            
            $data = $request->except(['image_1', 'image_2', 'image_3', 'signature']);
            $workOrder->fill($data);
            
            if (!$request->has('work_status')) {
                $workOrder->work_status = 'Pending';
            }

            // Auto-assign organization_id from current user if not provided
            if (!$workOrder->organization_id && Auth::user()?->organization_id) {
                $workOrder->organization_id = Auth::user()->organization_id;
            }

            $workOrder->save();

            // Handle file uploads to Google Drive
            $driveService = new \App\Services\GoogleDriveService();
            
            // 1. Ensure "Work Order" root folder exists
            $rootFolderName = 'Work Order';
            $rootFolderId = $driveService->createFolder($rootFolderName);
            
            // 2. Create individual folder for this Work Order inside the root
            $orderFolderName = 'WorkOrder_' . $workOrder->id;
            $orderFolderId = $driveService->createFolder($orderFolderName, $rootFolderId);
            
            $images = ['image_1', 'image_2', 'image_3', 'signature'];

            foreach ($images as $imgField) {
                if ($request->hasFile($imgField)) {
                    \Log::info("WorkOrder Store: Found file for $imgField");
                    $file = $request->file($imgField);
                    $fileName = 'workorder_' . $workOrder->id . '_' . time() . '_' . $file->getClientOriginalName();
                    
                    $mimeType = $file->getMimeType();
                    if ($imgField === 'signature') {
                        $mimeType = 'image/png';
                    }

                    $imageUrl = $driveService->uploadFile(
                        $file,
                        $orderFolderId,
                        $fileName,
                        $mimeType
                    );
                    
                    \Log::info("WorkOrder Store: Uploaded $imgField, URL: $imageUrl");
                    
                    if (strpos($imageUrl, 'drive.google.com') !== false && strpos($imageUrl, '/view') === false) {
                         if (!preg_match('/\/view$/', $imageUrl) && !preg_match('/\/view\?/', $imageUrl)) {
                             $imageUrl = rtrim($imageUrl, '/') . '/view';
                         }
                    }
                    $workOrder->$imgField = $imageUrl;
                    \Log::info("WorkOrder Store: Assigned $imgField to model");
                }
            }

            $workOrder->save();
            
            ActivityLog::log(
                'Work Order Created',
                "Work Order #{$workOrder->id} created. Category: {$workOrder->work_category}",
                'info',
                ['resource_type' => 'WorkOrder', 'resource_id' => $workOrder->id]
            );

            if (!empty($workOrder->assign_to)) {
                try {
                    $pushService = app(\App\Services\PushNotificationService::class);
                    $pushService->sendToUserByEmail(
                        $workOrder->assign_to,
                        'New Work Order Assigned',
                        "You have been assigned to Work Order #{$workOrder->id}.",
                        [],
                        'WO'
                    );
                } catch (\Exception $pushEx) {
                    \Log::error('Failed to send push notification on WorkOrder store: ' . $pushEx->getMessage());
                }
            }

            event(new WorkOrderUpdated(['action' => 'created', 'work_order_id' => $workOrder->id]));

            return response()->json([
                'success' => true,
                'message' => 'Work order created successfully',
                'data' => $workOrder
            ], 201);
            
        } catch (\Exception $e) {
            \Log::error('WorkOrder Store Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error adding work order: ' . $e->getMessage()
            ], 500);
        }
    }

    public function uploadImages(Request $request, $id)
    {
        try {
            \Log::info('[BACKEND] WorkOrder Upload images request received', [
                'work_order_id' => $id,
                'folder_name' => $request->input('folder_name'),
                'has_image_1' => $request->hasFile('image_1'),
                'has_image_2' => $request->hasFile('image_2'),
                'has_image_3' => $request->hasFile('image_3'),
                'has_signature' => $request->hasFile('signature'),
            ]);

            $filesInfo = [];
            foreach (['image_1', 'image_2', 'image_3', 'signature'] as $field) {
                if ($request->hasFile($field)) {
                    $file = $request->file($field);
                    $filesInfo[$field] = [
                        'original_name' => $file->getClientOriginalName(),
                        'mime_type' => $file->getMimeType(),
                        'size' => $file->getSize()
                    ];
                }
            }

            \Log::info('[BACKEND] WorkOrder Upload files info', $filesInfo);

            $validator = \Validator::make($request->all(), [
                'folder_name' => 'required|string|max:255',
                'image_1' => 'nullable|file|max:10240',
                'image_2' => 'nullable|file|max:10240',
                'image_3' => 'nullable|file|max:10240',
                'signature' => 'nullable|file|max:10240',
            ]);

            if ($validator->fails()) {
                \Log::warning('[BACKEND] WorkOrder Upload validation failed', [
                   'errors' => $validator->errors()->toArray(),
                   'request_all' => $request->all() // Warning: might be large if binary is dumped as string
                ]);
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $query = WorkOrder::query();
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            $workOrder = $query->findOrFail($id);
            $folderName = $request->input('folder_name');

            $driveService = new \App\Services\GoogleDriveService();
            
            // 1. Ensure "Work Order" root folder exists
            $rootFolderName = 'Work Order';
            $rootFolderId = $driveService->createFolder($rootFolderName);
            
            // 2. Create individual folder for this Work Order inside the root
            $orderFolderId = $driveService->createFolder($folderName, $rootFolderId);

            $imageUrls = [];
            $fields = ['image_1', 'image_2', 'image_3', 'signature'];

            foreach ($fields as $field) {
                if ($request->hasFile($field)) {
                    $file = $request->file($field);
                    $fileName = 'workorder_' . $workOrder->id . '_' . $field . '_' . time() . '.' . $file->getClientOriginalExtension();
                    
                    $mimeType = $field === 'signature' ? 'image/png' : $file->getMimeType();

                    $url = $driveService->uploadFile(
                        $file,
                        $orderFolderId,
                        $fileName,
                        $mimeType
                    );

                    // Ensure the URL is viewable
                    if (strpos($url, 'drive.google.com') !== false && strpos($url, '/view') === false) {
                         if (!preg_match('/\/view$/', $url) && !preg_match('/\/view\?/', $url)) {
                             $url = rtrim($url, '/') . '/view';
                         }
                    }

                    $imageUrls[$field . '_url'] = $url;
                    
                    // Also update the work order record
                    $workOrder->$field = $url;
                }
            }

            $workOrder->save();

            event(new WorkOrderUpdated(['action' => 'images_uploaded', 'work_order_id' => $workOrder->id]));

            return response()->json([
                'success' => true,
                'message' => 'Images uploaded successfully',
                'data' => $imageUrls,
                'work_order' => $workOrder
            ]);

        } catch (\Exception $e) {
            \Log::error('WorkOrder Upload Error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Error uploading images: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $query = WorkOrder::query();
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            $workOrder = $query->find($id);
            
            if (!$workOrder) {
                return response()->json([
                    'success' => false,
                    'message' => 'Work order not found'
                ], 404);
            }
            
            return response()->json([
                'success' => true,
                'data' => $workOrder
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching work order: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $validator = Validator::make($request->all(), [
                'instructions' => 'nullable|string',
                'report_to' => 'nullable|string|max:255',
                'assign_to' => 'nullable|string|max:255',
                'remarks' => 'nullable|string',
                'work_status' => 'nullable|string|max:100',
                'work_category' => 'nullable|string|max:255',
                'updated_by' => 'nullable|string|max:255',
                'start_time' => 'nullable|string',
                'end_time' => 'nullable|string',
                'organization_id' => 'nullable|integer'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $query = WorkOrder::query();
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            $workOrder = $query->find($id);
            if (!$workOrder) {
                return response()->json([
                    'success' => false,
                    'message' => 'Work order not found'
                ], 404);
            }
            
            $data = $request->only([
                'instructions', 'report_to', 'assign_to', 'remarks', 
                'work_status', 'work_category', 'updated_by', 'start_time', 'end_time', 'organization_id'
            ]);
            
            $workOrder->fill($data);

            $driveService = new \App\Services\GoogleDriveService();
            
            // 1. Ensure "Work Order" root folder exists
            $rootFolderName = 'Work Order';
            $rootFolderId = $driveService->createFolder($rootFolderName);
            
            // 2. Create/Get individual folder for this Work Order inside the root
            $orderFolderName = 'WorkOrder_' . $workOrder->id;
            $orderFolderId = $driveService->createFolder($orderFolderName, $rootFolderId);
            
            $images = ['image_1', 'image_2', 'image_3', 'signature'];

            foreach ($images as $imgField) {
                if ($request->hasFile($imgField)) {
                    \Log::info("WorkOrder Update: Found file for $imgField");
                    $file = $request->file($imgField);
                    $fileName = 'workorder_' . $workOrder->id . '_' . time() . '_' . $file->getClientOriginalName();
                    
                    $mimeType = $file->getMimeType();
                    if ($imgField === 'signature') {
                        $mimeType = 'image/png';
                    }

                    $imageUrl = $driveService->uploadFile(
                        $file,
                        $orderFolderId,
                        $fileName,
                        $mimeType
                    );
                    
                    \Log::info("WorkOrder Update: Uploaded $imgField, URL: $imageUrl");
                    
                    if (strpos($imageUrl, 'drive.google.com') !== false && strpos($imageUrl, '/view') === false) {
                         if (!preg_match('/\/view$/', $imageUrl) && !preg_match('/\/view\?/', $imageUrl)) {
                             $imageUrl = rtrim($imageUrl, '/') . '/view';
                         }
                    }
                    $workOrder->$imgField = $imageUrl;
                    \Log::info("WorkOrder Update: Assigned $imgField to model");
                }
            }

            $workOrder->save();
            
            ActivityLog::log(
                'Work Order Updated',
                "Work Order #{$workOrder->id} updated. Status: {$workOrder->work_status}",
                'info',
                ['resource_type' => 'WorkOrder', 'resource_id' => $workOrder->id]
            );

            if (!empty($data['assign_to'])) {
                try {
                    $pushService = app(\App\Services\PushNotificationService::class);
                    $pushService->sendToUserByEmail(
                        $data['assign_to'],
                        'Work Order Assigned',
                        "You have been assigned to Work Order #{$workOrder->id}.",
                        [],
                        'WO'
                    );
                } catch (\Exception $pushEx) {
                    \Log::error('Failed to send push notification on WorkOrder update: ' . $pushEx->getMessage());
                }
            }

            event(new WorkOrderUpdated(['action' => 'updated', 'work_order_id' => $workOrder->id]));

            return response()->json([
                'success' => true,
                'message' => 'Work order updated successfully',
                'data' => $workOrder
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating work order: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $query = WorkOrder::query();
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            $workOrder = $query->find($id);
            if (!$workOrder) {
                return response()->json([
                    'success' => false,
                    'message' => 'Work order not found'
                ], 404);
            }
            
            $workOrder->delete();

            ActivityLog::log(
                'Work Order Deleted',
                "Work Order #{$id} deleted.",
                'warning',
                ['resource_type' => 'WorkOrder', 'resource_id' => $id]
            );

            event(new WorkOrderUpdated(['action' => 'deleted', 'work_order_id' => $id]));
            
            return response()->json([
                'success' => true,
                'message' => 'Work order permanently deleted from database'
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting work order: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics()
    {
        try {
            $query = WorkOrder::query();
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $total = (clone $query)->count();
            $pending = (clone $query)->where('work_status', 'Pending')->count();
            $completed = (clone $query)->where('work_status', 'Completed')->count();
            
            return response()->json([
                'success' => true,
                'data' => [
                    'total_work_orders' => $total,
                    'pending' => $pending,
                    'completed' => $completed
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error getting statistics: ' . $e->getMessage()
            ], 500);
        }
    }
}

