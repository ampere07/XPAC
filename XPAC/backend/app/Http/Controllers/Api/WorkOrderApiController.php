<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WorkOrder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Events\WorkOrderUpdated;
use App\Models\ActivityLog;
use App\Models\AuditTrailLog;
use App\Models\Role;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

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

            // Same queue rule as update(): a technician cannot attach work to a
            // work order they are not allowed to open yet.
            if ($this->isWorkOrderLockedForTechnician($workOrder, $this->resolveActingUser($request))) {
                return response()->json([
                    'success' => false,
                    'message' => 'This job order is locked. Finish the job order at the top of your list first, or ask an administrator to enable this one.',
                ], 403);
            }

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
            
            // A technician works their queue from the top. Enforced here as well
            // as in the UI so the lock cannot be stepped over by calling the API
            // directly with another work order's id.
            if ($this->isWorkOrderLockedForTechnician($workOrder, $this->resolveActingUser($request))) {
                \Log::warning('Work order update blocked: locked for technician', [
                    'id' => $id,
                    'user_email' => optional($this->resolveActingUser($request))->email,
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'This job order is locked. Finish the job order at the top of your list first, or ask an administrator to enable this one.',
                ], 403);
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

    /**
     * Release a work order to its technician ahead of their queue.
     *
     * Technicians work In Progress first and oldest first within that: only the
     * record at the top of their list is actionable, everything else active is
     * greyed out. An administrator calls this to unlock one specific work order
     * early. Restricted to administrators by the `role` middleware on the route —
     * technician_enabled is not fillable, so this is the only way it can be set.
     */
    public function enableForTechnician(Request $request, $id)
    {
        try {
            $currentUser = $this->resolveActingUser($request);

            $query = WorkOrder::query();
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

            // Already released — answer successfully with the current state rather
            // than writing an audit entry for a no-op.
            if ($workOrder->technician_enabled) {
                return response()->json([
                    'success' => true,
                    'message' => 'This work order is already enabled for the technician.',
                    'data' => [
                        'id' => $workOrder->id,
                        'technician_enabled' => true,
                    ],
                ]);
            }

            $performedBy = $request->input('updated_by')
                ?? optional($currentUser)->email_address
                ?? optional($currentUser)->email
                ?? 'System';

            $workOrder->technician_enabled = true;
            $workOrder->updated_by = $performedBy;
            $workOrder->save();

            AuditTrailLog::create([
                'old_details' => [
                    'type' => 'workorders',
                    'id' => $workOrder->id,
                    'data' => ['technician_enabled' => false],
                ],
                'new_details' => [
                    'type' => 'workorders',
                    'id' => $workOrder->id,
                    'data' => ['technician_enabled' => true],
                ],
                'created_by_user' => $performedBy,
                'updated_by_user' => $performedBy,
            ]);

            ActivityLog::log(
                'Work Order Enabled For Technician',
                "Work Order #{$workOrder->id} unlocked for technician access by {$performedBy}",
                'info',
                [
                    'user_email' => $performedBy,
                    'resource_type' => 'WorkOrder',
                    'resource_id' => $workOrder->id,
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Work order enabled for technician access.',
                'data' => [
                    'id' => $workOrder->id,
                    'technician_enabled' => true,
                ],
            ]);
        } catch (\Exception $e) {
            \Log::error('Failed to enable work order for technician', [
                'work_order_id' => $id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to enable work order for technician',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * The signed-in user, however this request authenticated.
     *
     * The work-orders routes sit outside the `auth:sanctum` group, so the default
     * session guard resolves the web portal (cookie based) but NOT the mobile app,
     * which sends a bearer token. Asking Sanctum's guard covers both, and it is
     * asked only for the technician queue checks below — the rest of this
     * controller keeps using Auth::user() exactly as it did.
     */
    private function resolveActingUser(Request $request)
    {
        if ($user = $request->user()) {
            return $user;
        }

        try {
            return $request->user('sanctum');
        } catch (\Throwable $e) {
            // No sanctum guard configured — treat as unidentified.
            return null;
        }
    }

    /**
     * Every spelling of "assigned to me" a work order might carry.
     *
     * assign_to holds either the assignee's email or their full name, so both are
     * offered — the same comparison the two Work Order pages make client-side.
     */
    private function assigneeAliases($user): array
    {
        $fullName = trim(implode(' ', array_filter([
            $user->first_name ?? null,
            $user->last_name ?? null,
        ])));

        return array_values(array_unique(array_filter(array_map(
            fn ($alias) => strtolower(trim((string) $alias)),
            [$user->email ?? null, $user->email_address ?? null, $fullName ?: null]
        ))));
    }

    /**
     * Is this work order locked for the signed-in user because it is not their
     * next one in the queue?
     *
     * Only ever true for technicians. A work order is open when any of these hold:
     *   • it heads the queue of work still assigned to them — the oldest In
     *     Progress work order, or the oldest other active one when they have none
     *     in progress, or the oldest on-hold one when that is all that is left. On
     *     hold sorts last, so it reaches the head only when there is no active
     *     work in front of it;
     *   • an administrator enabled it (technician_enabled);
     *   • they have already started it and not yet closed it — work in flight must
     *     never become unreachable;
     *   • it is done, failed or cancelled: nothing is left to act on.
     *
     * An on-hold work order is deliberately NOT open on its status alone. It stays
     * out of the queue's way, so it never blocks the work behind it, but taking it
     * off hold is an administrator's call.
     *
     * A work order that is not assigned to the technician is left alone: this
     * restriction governs the order of their own work, and must not start blocking
     * records reached some other way.
     *
     * Mirrors JobOrderController::isJobOrderLockedForTechnician() and the two
     * clients' utils/technicianWorkOrderAccess.ts.
     */
    private function isWorkOrderLockedForTechnician($workOrder, $currentUser): bool
    {
        if (!$currentUser || (int) $currentUser->role_id !== Role::TECHNICIAN) {
            return false;
        }

        if ($workOrder->technician_enabled) {
            return false;
        }

        $workStatus = strtolower(trim((string) $workOrder->work_status));
        if (in_array($workStatus, WorkOrder::TECHNICIAN_QUEUE_CLOSED_WORK_STATUSES, true)) {
            return false;
        }

        // Already in flight for this technician. A zero date counts as unset, the
        // same way the two clients read these columns.
        $isTimeSet = static function ($value): bool {
            $normalised = strtolower(trim((string) $value));
            return !in_array($normalised, ['', '0000-00-00 00:00:00', 'not set', '-', 'none', 'null'], true);
        };

        if ($isTimeSet($workOrder->start_time) && !$isTimeSet($workOrder->end_time)) {
            return false;
        }

        $aliases = $this->assigneeAliases($currentUser);
        if (empty($aliases)) {
            return false;
        }

        // The technician's open queue, in the order the two clients paint their
        // list: In Progress first, then other active work, then work on hold last,
        // oldest first within each band on requested_date — which IS this model's
        // created-at column.
        //
        // Work on hold is ranked here rather than excluded with the finished work.
        // Sorting last is what keeps it from taking the slot away from active work;
        // excluding it made it neither next nor locked.
        //
        // Membership of THIS list is also what decides whether the work order is
        // one of theirs to queue at all. Testing assignment separately would mean
        // two comparisons of the same value that can disagree — and a disagreement
        // fails open, because an empty queue never blocks.
        $inProgressFirst = sprintf(
            "CASE WHEN LOWER(TRIM(COALESCE(work_status, ''))) IN ('%s') THEN 0 ELSE 1 END",
            implode("', '", WorkOrder::TECHNICIAN_IN_PROGRESS_WORK_STATUSES)
        );

        $deferredLast = sprintf(
            "CASE WHEN LOWER(TRIM(COALESCE(work_status, ''))) IN ('%s') THEN 1 ELSE 0 END",
            implode("', '", WorkOrder::TECHNICIAN_QUEUE_DEFERRED_WORK_STATUSES)
        );

        $queue = WorkOrder::query()
            ->whereIn(DB::raw("LOWER(TRIM(COALESCE(assign_to, '')))"), $aliases)
            ->whereNotIn(
                DB::raw("LOWER(TRIM(COALESCE(work_status, '')))"),
                WorkOrder::TECHNICIAN_QUEUE_CLOSED_WORK_STATUSES
            )
            ->when($currentUser->organization_id, function ($q) use ($currentUser) {
                $q->where('organization_id', $currentUser->organization_id);
            }, function ($q) {
                $q->whereNull('organization_id');
            })
            ->orderBy(DB::raw($deferredLast))
            ->orderBy(DB::raw($inProgressFirst))
            ->orderBy('requested_date')
            ->orderBy('id')
            ->pluck('id')
            ->map(fn ($id) => (int) $id);

        // Not part of their own queue — leave the existing behaviour alone.
        if (!$queue->contains((int) $workOrder->id)) {
            return false;
        }

        return $queue->first() !== (int) $workOrder->id;
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

