<?php

namespace App\Http\Controllers;

use App\Models\JobOrder;
use App\Models\Customer;
use App\Models\TechnicalDetail;
use App\Models\BillingAccount;
use App\Models\Application;
use App\Models\ModemRouterSN;
use App\Models\ContractTemplate;
use App\Models\Port;
use App\Models\VLAN;
use App\Models\LCPNAPLocation;
use App\Models\Plan;
use App\Models\AuditTrailLog;
use App\Models\User;
use App\Models\Role;
use App\Models\OnlineStatus;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Hash;

use App\Services\GoogleDriveService;
use App\Services\PppoeUsernameService;
use App\Services\RadiusServerResolver;
use App\Services\RouterosApiService;
use App\Models\RadiusConfig;
use App\Models\ActivityLog;
use App\Events\JobOrderViewingUpdate;

class JobOrderController extends Controller
{
    /** Is this account an agent, whose job orders are their own referrals? */
    private function isAgentUser($user): bool
    {
        if ((int) ($user->role_id ?? 0) === \App\Models\Role::AGENT) {
            return true;
        }

        return strtolower(trim((string) ($user->role->role_name ?? ''))) === 'agent';
    }

    public function index(Request $request): JsonResponse
    {
        try {
            $page = $request->input('page', 1);
            $limit = $request->input('limit', 50); // Default 50 for faster response
            $search = $request->input('search', '');
            $fastMode = $request->input('fast', false); // Fast mode: skip heavy processing

            \Log::info('JobOrderController: Starting to fetch job orders', [
                'page' => $page,
                'limit' => $limit,
                'search' => $search,
                'fast_mode' => $fastMode
            ]);

            $query = JobOrder::with(['application', 'items', 'billingAccount.customer'])->orderBy('id', 'desc');

            // Apply organization filter
            $currentUser = auth()->user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            if ($request->has('assigned_email')) {
                $assignedEmail = $request->query('assigned_email');
                \Log::info('Filtering job orders by assigned_email: ' . $assignedEmail);
                $query->where('assigned_email', $assignedEmail);
            }

            // An agent asks for their own referrals, so the page is narrowed to
            // them here rather than after the fact.
            //
            // The list is ordered newest first and taken a page at a time, so a
            // client that filters by ownership afterwards only ever sees the
            // newest N rows of the whole organisation. An agent's completed
            // referrals are their oldest, so those were the ones falling outside
            // that window — the reason done work appeared to be missing while
            // work in progress showed up fine.
            //
            // referred_by holds either the agent's id or older free text, so this
            // narrows rather than decides: it returns a superset, and the exact
            // match in AgentProgramme::referralBelongsToAgent — which the clients
            // carry as agentReferral.ts — still settles which rows are the
            // agent's. Both forms are covered by AgentReferral::narrow.
            if ($currentUser && $this->isAgentUser($currentUser)) {
                $first = trim((string) ($currentUser->first_name ?? ''));
                $last  = trim((string) ($currentUser->last_name ?? ''));
                $email = trim((string) ($currentUser->email_address ?? $currentUser->email ?? ''));

                // A referral made through the picker is stored as this agent's
                // user id, so the id is part of the narrowing too — it carries
                // none of their name, and the LIKEs alone would hide every
                // referral they have made since the picker started writing ids.
                $agentId = $currentUser->id ?? null;

                $referralMatch = function ($q) use ($agentId, $first, $last, $email) {
                    \App\Support\AgentReferral::narrow($q, 'referred_by', $agentId, $first, $last, $email);
                };

                if ($first !== '' || $last !== '' || $email !== '' || $agentId !== null) {
                    // Both sources: a job order carries its referral on the
                    // application, or on the billing account's customer where
                    // there is no application behind it.
                    $query->where(function ($outer) use ($referralMatch) {
                        $outer->whereHas('application', $referralMatch)
                              ->orWhereHas('billingAccount.customer', $referralMatch);
                    });
                }
            }
            
            if ($request->has('user_role') && strtolower($request->query('user_role')) === 'technician') {
                $sevenDaysAgo = now()->subDays(7);
                $query->where('updated_at', '>=', $sevenDaysAgo);
                \Log::info('Filtering job orders for technician role: only showing records from last 7 days', [
                    'cutoff_date' => $sevenDaysAgo->toDateTimeString()
                ]);
            }

            if ($request->has('updated_since')) {
                $query->where('updated_at', '>', $request->input('updated_since'));
                // Increase limit for updates to ensure we get all recent changes
                $limit = $request->input('limit', 1000);
            }

            // Apply search filter
            if ($search) {
                $query->where(function ($q) use ($search) {
                    $q->where('assigned_email', 'LIKE', "%{$search}%")
                      ->orWhere('onsite_status', 'LIKE', "%{$search}%")
                      ->orWhere('username', 'LIKE', "%{$search}%")
                      ->orWhere('modem_router_sn', 'LIKE', "%{$search}%")
                      ->orWhereHas('application', function ($appQuery) use ($search) {
                          $appQuery->where('first_name', 'LIKE', "%{$search}%")
                                   ->orWhere('last_name', 'LIKE', "%{$search}%")
                                   ->orWhere('city', 'LIKE', "%{$search}%");
                      });
                });
            }

            // Fetch total count for pagination awareness on frontend
            $totalCount = $query->count();

            // Fetch one extra record to check if there are more pages
            $jobOrders = $query->skip(($page - 1) * $limit)
                ->take($limit + 1)
                ->get();

            // Check if there are more pages
            $hasMore = $jobOrders->count() > $limit;

            // Remove the extra record if it exists
            if ($hasMore) {
                $jobOrders = $jobOrders->slice(0, $limit);
            }

            \Log::info('JobOrderController: Fetched ' . $jobOrders->count() . ' job orders');

            // Fast mode: Return minimal data immediately
            if ($fastMode) {
                $formattedJobOrders = $jobOrders->map(function ($jobOrder) {
                    $application = $jobOrder->application;
                    $customer = $jobOrder->billingAccount ? $jobOrder->billingAccount->customer : null;
                    
                    return [
                        'id' => $jobOrder->id,
                        'JobOrder_ID' => $jobOrder->id,
                        'application_id' => $jobOrder->application_id,
                        'Timestamp' => $jobOrder->timestamp ? $jobOrder->timestamp->format('Y-m-d H:i:s') : null,
                        'Onsite_Status' => $jobOrder->onsite_status,
                        'Assigned_Email' => $jobOrder->assigned_email,
                        'Username' => $jobOrder->username,
                        'First_Name' => $application ? $application->first_name : ($customer ? $customer->first_name : null),
                        'Last_Name' => $application ? $application->last_name : ($customer ? $customer->last_name : null),
                        'Status' => $jobOrder->status,
                        'status' => $jobOrder->status,
                        'commission_status' => $jobOrder->commission_status,
                        'Created_By' => $jobOrder->created_by_user_email,
                        'Created_At' => $jobOrder->created_at ? $jobOrder->created_at->format('Y-m-d H:i:s') : null,
                        'Updated_By' => $jobOrder->updated_by_user_email,
                        'Updated_At' => $jobOrder->updated_at ? $jobOrder->updated_at->format('Y-m-d H:i:s') : null,
                        'updated_at' => $jobOrder->updated_at ? $jobOrder->updated_at->format('Y-m-d H:i:s') : null,
                        'created_at' => $jobOrder->created_at ? $jobOrder->created_at->format('Y-m-d H:i:s') : null,
                        'start_time' => $jobOrder->start_time,
                        'end_time' => $jobOrder->end_time,
                        'technicians' => $jobOrder->technicians,
                        'technician_enabled' => (bool) $jobOrder->technician_enabled,
                    ];
                });

                return response()->json([
                    'success' => true,
                    'data' => $formattedJobOrders->values(),
                    'pagination' => [
                        'current_page' => (int) $page,
                        'per_page' => (int) $limit,
                        'total_count' => (int) $totalCount,
                        'has_more' => $hasMore
                    ]
                ]);
            }

            // Normal mode: Return full data
            //
            // Resolve every referral on the page in one query rather than one
            // per row: a referral made through the agent picker holds the
            // agent's user id, and the list shows their name.
            \App\Support\AgentReferral::prime(
                $jobOrders->flatMap(fn ($jo) => [
                    optional($jo->application)->referred_by,
                    optional(optional($jo->billingAccount)->customer)->referred_by,
                ])
            );

            $formattedJobOrders = $jobOrders->map(function ($jobOrder) {
                $application = $jobOrder->application;
                $customer = $jobOrder->billingAccount ? $jobOrder->billingAccount->customer : null;
                
                return [
                    'id' => $jobOrder->id,
                    'JobOrder_ID' => $jobOrder->id,
                    'application_id' => $jobOrder->application_id,
                    'Timestamp' => $jobOrder->timestamp ? $jobOrder->timestamp->format('Y-m-d H:i:s') : null,
                    'Installation_Fee' => $jobOrder->installation_fee,
                    'Billing_Day' => $jobOrder->billing_day,
                    'Onsite_Status' => $jobOrder->onsite_status,
                    'Status' => $jobOrder->status,
                    'status' => $jobOrder->status,
                    'billing_status' => $jobOrder->billing_status,
                    'Status_Remarks' => $jobOrder->status_remarks,
                    'Assigned_Email' => $jobOrder->assigned_email,
                    'Contract_Template' => $jobOrder->contract_link,
                    'contract_link' => $jobOrder->contract_link,
                    'Created_By' => $jobOrder->created_by_user_email,
                    'Created_At' => $jobOrder->created_at ? $jobOrder->created_at->format('Y-m-d H:i:s') : null,
                    'Updated_By' => $jobOrder->updated_by_user_email,
                    'Updated_At' => $jobOrder->updated_at ? $jobOrder->updated_at->format('Y-m-d H:i:s') : null,
                    'Modified_By' => $jobOrder->created_by_user_email, // Keep for compatibility
                    'Modified_Date' => $jobOrder->updated_at ? $jobOrder->updated_at->format('Y-m-d H:i:s') : null, // Keep for compatibility
                    'Username' => $jobOrder->username,
                    'group_name' => $jobOrder->group_name,
                    'pppoe_username' => $jobOrder->pppoe_username,
                    'pppoe_password' => $jobOrder->pppoe_password,
                    
                    'date_installed' => $jobOrder->date_installed,
                    'start_time' => $jobOrder->start_time,
                    'end_time' => $jobOrder->end_time,
                    'technicians' => $jobOrder->technicians,
                    // Drives the technician queue lock on both clients: the list
                    // greys out newer job orders unless this says otherwise.
                    'technician_enabled' => (bool) $jobOrder->technician_enabled,
                    'usage_type' => $jobOrder->usage_type,
                    'connection_type' => $jobOrder->connection_type,
                    'router_model' => $jobOrder->router_model,
                    'modem_router_sn' => $jobOrder->modem_router_sn,
                    'Modem_SN' => $jobOrder->modem_router_sn,
                    'modem_sn' => $jobOrder->modem_router_sn,
                    'lcpnap' => $jobOrder->lcpnap,
                    'port' => $jobOrder->port,
                    'vlan' => $jobOrder->vlan,
                    'visit_by' => $jobOrder->visit_by,
                    'visit_with' => $jobOrder->visit_with,
                    'visit_with_other' => $jobOrder->visit_with_other,
                    'ip_address' => $jobOrder->ip_address,
                    'address_coordinates' => $jobOrder->address_coordinates,
                    'onsite_remarks' => $jobOrder->onsite_remarks,
                    'username_status' => $jobOrder->username_status,
                    
                    'client_signature_url' => $jobOrder->client_signature_url,
                    'setup_image_url' => $jobOrder->setup_image_url,
                    'speedtest_image_url' => $jobOrder->speedtest_image_url,
                    'signed_contract_image_url' => $jobOrder->signed_contract_image_url,
                    'box_reading_image_url' => $jobOrder->box_reading_image_url,
                    'router_reading_image_url' => $jobOrder->router_reading_image_url,
                    'port_label_image_url' => $jobOrder->port_label_image_url,
                    'house_front_picture_url' => $jobOrder->house_front_picture_url,
                    'client_tagging_url' => $jobOrder->client_tagging_url,
                    'proof_image_url' => $jobOrder->proof_image_url,
                    'installation_landmark' => $jobOrder->installation_landmark,
                    
                    'created_at' => $jobOrder->created_at ? $jobOrder->created_at->format('Y-m-d H:i:s') : null,
                    'updated_at' => $jobOrder->updated_at ? $jobOrder->updated_at->format('Y-m-d H:i:s') : null,
                    'created_by_user_email' => $jobOrder->created_by_user_email,
                    'updated_by_user_email' => $jobOrder->updated_by_user_email,
                    
                    'First_Name' => $application ? $application->first_name : ($customer ? $customer->first_name : null),
                    'Middle_Initial' => $application ? $application->middle_initial : ($customer ? $customer->middle_initial : null),
                    'Last_Name' => $application ? $application->last_name : ($customer ? $customer->last_name : null),
                    'Address' => ($application && !empty(trim($application->installation_address ?? ''))) 
                        ? $application->installation_address 
                        : ($customer ? $customer->address : null),
                    'Installation_Address' => ($application && !empty(trim($application->installation_address ?? ''))) 
                        ? $application->installation_address 
                        : ($customer ? $customer->address : null),
                    'Location' => ($application && !empty(trim($application->location ?? ''))) 
                        ? $application->location 
                        : ($customer ? $customer->location : null),
                    'City' => ($application && !empty(trim($application->city ?? ''))) 
                        ? $application->city 
                        : ($customer ? $customer->city : null),
                    'Region' => ($application && !empty(trim($application->region ?? ''))) 
                        ? $application->region 
                        : ($customer ? $customer->region : null),
                    'Barangay' => ($application && !empty(trim($application->barangay ?? ''))) 
                        ? $application->barangay 
                        : ($customer ? $customer->barangay : null),
                    'Email_Address' => $application ? $application->email_address : ($customer ? $customer->email_address : null),
                    'Mobile_Number' => $application ? $application->mobile_number : ($customer ? $customer->contact_number_primary : null),
                    'Secondary_Mobile_Number' => $application ? $application->secondary_mobile_number : ($customer ? $customer->contact_number_secondary : null),
                    'Desired_Plan' => $application ? $application->desired_plan : ($customer ? $customer->desired_plan : null),
                    // The stored value and how to show it, side by side. Every
                    // list, export and detail pane reads Referred_By and keeps
                    // showing a name; the edit forms read the id so that saving
                    // an untouched record writes the same referral back rather
                    // than turning it into a name again.
                    'Referred_By' => \App\Support\AgentReferral::displayName(
                        $application ? $application->referred_by : ($customer ? $customer->referred_by : null)
                    ),
                    'Referred_By_Raw' => $application ? $application->referred_by : ($customer ? $customer->referred_by : null),
                    'Referred_By_Agent_ID' => \App\Support\AgentReferral::agentId(
                        $application ? $application->referred_by : ($customer ? $customer->referred_by : null)
                    ),
                    'Billing_Status' => $jobOrder->billing_status,
                    'commission_status' => $jobOrder->commission_status,
                    'job_order_items' => $jobOrder->items,
                ];
            });

            return response()->json([
                'success' => true,
                'data' => $formattedJobOrders->values(),
                'pagination' => [
                    'current_page' => (int) $page,
                    'per_page' => (int) $limit,
                    'total_count' => (int) $totalCount,
                    'has_more' => $hasMore
                ]
            ]);
        } catch (\Exception $e) {
            \Log::error('Error fetching job orders: ' . $e->getMessage());
            \Log::error('Stack trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch job orders',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
    public function store(Request $request): JsonResponse
    {
        try {
            \Log::info('JobOrder Store Request', [
                'request_data' => $request->all()
            ]);

            $validator = Validator::make($request->all(), [
                'application_id' => 'required|integer|exists:applications,id',
                'status' => 'nullable|string|max:100',
                'timestamp' => 'nullable|date',
                'installation_fee' => 'nullable|numeric|min:0',
                'billing_day' => 'nullable|integer|min:0|max:31',
                'billing_status' => 'nullable|string|max:255',
                'onsite_status' => 'nullable|string|max:255',
                'assigned_email' => 'nullable|email|max:255',
                'onsite_remarks' => 'nullable|string',
                'status_remarks' => 'nullable|string|max:255',
                'modem_router_sn' => 'nullable|string|max:255',
                'username' => 'nullable|string|max:255',
                'group_name' => 'nullable|string|max:255',
                'installation_landmark' => 'nullable|string|max:255',
                'created_by_user_email' => 'nullable|email|max:255',
                'updated_by_user_email' => 'nullable|email|max:255',
                'contract_link' => 'nullable|string|max:500',
                'client_tagging_url' => 'nullable|string|max:500',
                'organization_id' => 'nullable|integer',
            ]);

            if ($validator->fails()) {
                \Log::error('JobOrder Store Validation Failed', [
                    'errors' => $validator->errors()->toArray()
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                ], 422);
            }

            $data = $request->all();

            // Sync pppoe_username to username if present
            if (isset($data['pppoe_username']) && !empty($data['pppoe_username'])) {
                $data['username'] = $data['pppoe_username'];
            }

            // Ensure timestamp is in Asia/Manila
            if (isset($data['timestamp'])) {
                try {
                    $data['timestamp'] = \Carbon\Carbon::parse($data['timestamp'], 'Asia/Manila')->format('Y-m-d H:i:s');
                } catch (\Exception $e) {
                    $data['timestamp'] = now('Asia/Manila')->format('Y-m-d H:i:s');
                }
            } else {
                $data['timestamp'] = now('Asia/Manila')->format('Y-m-d H:i:s');
            }

            
            // Set default values if not provided
            if (!isset($data['billing_status'])) {
                $data['billing_status'] = 'Pending';
            }
            
            // Auto-assign organization_id from current user if not provided
            if (!isset($data['organization_id']) && auth()->user()?->organization_id) {
                $data['organization_id'] = auth()->user()->organization_id;
            }
            if (!isset($data['billing_status'])) {
                $data['billing_status'] = 'Pending';
            }
            
            if (!isset($data['onsite_status'])) {
                $data['onsite_status'] = 'Pending';
            }
            
            \Log::info('JobOrder Creating with data', [
                'data' => $data
            ]);
            
            $jobOrder = JobOrder::create($data);
            $jobOrder->load('application');

            // Audit Trail Log
            AuditTrailLog::create([
                'old_details' => null,
                'new_details' => [
                    'type' => 'joborders',
                    'id' => $jobOrder->id,
                    'data' => $jobOrder->fresh()->toArray()
                ],
                'created_by_user' => $data['created_by_user_email'] ?? 'System',
                'updated_by_user' => $data['created_by_user_email'] ?? 'System'
            ]);

            // Create Activity Log using helper
            $customerName = trim(($jobOrder->application->first_name ?? '') . ' ' . ($jobOrder->application->last_name ?? ''));
            ActivityLog::log(
                'Job Order Assigned',
                "New Job Order assigned for {$customerName} (Application #{$jobOrder->application_id}). Assigned to: " . ($jobOrder->assigned_email ?? 'Nobody'),
                'info',
                [
                    'user_email' => $data['created_by_user_email'] ?? null,
                    'target_user_email' => $jobOrder->assigned_email,
                    'resource_type' => 'JobOrder',
                    'resource_id' => $jobOrder->id,
                    'additional_data' => [
                        'customer_name' => $customerName,
                        'application_id' => $jobOrder->application_id,
                        'assigned_email' => $jobOrder->assigned_email,
                        'installation_fee' => $jobOrder->installation_fee,
                        'onsite_status' => $jobOrder->onsite_status
                    ]
                ]
            );

            $jobOrder->load('application');

            \Log::info('JobOrder Created Successfully', [
                'id' => $jobOrder->id,
                'application_id' => $jobOrder->application_id
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Job order created successfully',
                'data' => $jobOrder,
            ], 201);
        } catch (\Exception $e) {
            \Log::error('JobOrder Store Failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to create job order',
                'error' => $e->getMessage(),
            ], 500);
        }
    }


    public function show($id): JsonResponse
    {
        try {
            $query = JobOrder::query();
            $currentUser = auth()->user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            $jobOrder = $query->with(['application', 'items', 'billingAccount.customer'])->findOrFail($id);

            return response()->json([
                'success' => true,
                'data' => $jobOrder,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Job order not found',
                'error' => $e->getMessage(),
            ], 404);
        }
    }

    public function update(Request $request, $id): JsonResponse
    {
        DB::beginTransaction();
        try {
            \Log::info('JobOrder Update Request', [
                'id' => $id,
                'request_data' => $request->all()
            ]);

            $query = JobOrder::query();
            $currentUser = auth()->user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $jobOrder = $query->with('lcpnapLocation')->findOrFail($id);

            // A technician works their queue oldest first. Enforced here as well
            // as in the UI so the lock cannot be stepped over by calling the API
            // directly with a newer job order's id.
            if ($this->isJobOrderLockedForTechnician($jobOrder, $currentUser)) {
                DB::rollBack();

                \Log::warning('JobOrder Update blocked: locked for technician', [
                    'id' => $id,
                    'user_email' => $currentUser->email ?? null,
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'This job order is locked. Finish the job order at the top of your list first, or ask an administrator to enable this one.',
                ], 403);
            }

            $generateCredentials = $request->input('generate_credentials', false);
            
            // Auto-generate credentials if pppoe_username is provided but pppoe_password is empty
            $hasUsername = $request->has('pppoe_username') && !empty($request->input('pppoe_username'));
            $hasPassword = $request->has('pppoe_password') && !empty($request->input('pppoe_password'));
            
            if ($hasUsername && !$hasPassword) {
                // Case 1: Username provided, password missing - generate password
                $application = $jobOrder->application;
                
                if ($application) {
                    $pppoeService = new PppoeUsernameService();
                    
                    $lcpnapValue = $request->input('lcpnap', $jobOrder->lcpnap);
                    $portValue = $request->input('port', $jobOrder->port);
                    $lcpnapData = null;
                    
                    if ($lcpnapValue) {
                        $lcpnapData = LCPNAPLocation::where('lcpnap_name', trim($lcpnapValue))
                                                 ->orWhere('id', trim($lcpnapValue))
                                                 ->first();
                    }
                    
                    $customerData = [
                        'first_name' => $application->first_name ?? '',
                        'middle_initial' => $application->middle_initial ?? '',
                        'last_name' => $application->last_name ?? '',
                        'mobile_number' => $application->mobile_number ?? '',
                        'lcp' => trim($lcpnapData->lcp ?? ''),
                        'nap' => trim($lcpnapData->nap ?? ''),
                        'port' => trim($portValue ?? ''),
                        'date_installed' => $jobOrder->date_installed ?? now(),
                        'tech_input_username' => $request->input('pppoe_username'),
                        'custom_password' => $request->input('custom_password'),
                    ];
                    
                    $password = $pppoeService->generatePassword($customerData);
                    
                    $request->merge([
                        'pppoe_password' => $password,
                    ]);
                    
                    \Log::info('Auto-generated PPPoE password for provided username', [
                        'job_order_id' => $id,
                        'username' => $request->input('pppoe_username'),
                        'password_length' => strlen($password),
                        'password_merged' => $request->has('pppoe_password'),
                        'password_in_request' => $request->input('pppoe_password') ? 'YES' : 'NO',
                        'lcp_value' => $jobOrder->lcpnapLocation->lcp ?? 'NOT SET',
                        'nap_value' => $jobOrder->lcpnapLocation->nap ?? 'NOT SET'
                    ]);
                }
            } elseif (!$hasUsername && $hasPassword) {
                // Case 2: Password provided (from RADIUS), username missing - generate username
                $application = $jobOrder->application;
                
                if ($application) {
                    $pppoeService = new PppoeUsernameService();
                    
                    $lcpnapValue = $request->input('lcpnap', $jobOrder->lcpnap);
                    $portValue = $request->input('port', $jobOrder->port);
                    $lcpnapData = null;
                    
                    if ($lcpnapValue) {
                        $lcpnapData = LCPNAPLocation::where('lcpnap_name', trim($lcpnapValue))
                                                 ->orWhere('id', trim($lcpnapValue))
                                                 ->first();
                    }
                    
                    $customerData = [
                        'first_name' => $application->first_name ?? '',
                        'middle_initial' => $application->middle_initial ?? '',
                        'last_name' => $application->last_name ?? '',
                        'mobile_number' => $application->mobile_number ?? '',
                        'lcp' => trim($lcpnapData->lcp ?? ''),
                        'nap' => trim($lcpnapData->nap ?? ''),
                        'port' => trim($portValue ?? ''),
                        'date_installed' => $jobOrder->date_installed ?? now(),
                        'tech_input_username' => $request->input('tech_input_username'),
                        'custom_password' => $request->input('custom_password'),
                    ];
                    
                    $username = $pppoeService->generateUniqueUsername($customerData, $id);
                    
                    $request->merge([
                        'pppoe_username' => $username,
                    ]);
                    
                    \Log::info('Auto-generated PPPoE username for provided password', [
                        'job_order_id' => $id,
                        'username' => $username,
                        'username_length' => strlen($username),
                        'password_from_radius' => true,
                        'lcp_value' => $jobOrder->lcpnapLocation->lcp ?? 'NOT SET',
                        'nap_value' => $jobOrder->lcpnapLocation->nap ?? 'NOT SET'
                    ]);
                }
            } elseif ($generateCredentials && empty($jobOrder->pppoe_username)) {
                // Case 3: No credentials provided - generate both
                $application = $jobOrder->application;
                
                if ($application) {
                    $pppoeService = new PppoeUsernameService();
                    
                    $lcpnapValue = $request->input('lcpnap', $jobOrder->lcpnap);
                    $portValue = $request->input('port', $jobOrder->port);
                    $lcpnapData = null;
                    
                    if ($lcpnapValue) {
                        $lcpnapData = LCPNAPLocation::where('lcpnap_name', trim($lcpnapValue))
                                                 ->orWhere('id', trim($lcpnapValue))
                                                 ->first();
                    }
                    
                    $customerData = [
                        'first_name' => $application->first_name ?? '',
                        'middle_initial' => $application->middle_initial ?? '',
                        'last_name' => $application->last_name ?? '',
                        'mobile_number' => $application->mobile_number ?? '',
                        'lcp' => trim($lcpnapData->lcp ?? ''),
                        'nap' => trim($lcpnapData->nap ?? ''),
                        'port' => trim($portValue ?? ''),
                        'date_installed' => $jobOrder->date_installed ?? now(),
                        'tech_input_username' => $request->input('tech_input_username'),
                        'custom_password' => $request->input('custom_password'),
                    ];
                    
                    $username = $pppoeService->generateUniqueUsername($customerData, $id);
                    $password = $pppoeService->generatePassword($customerData);
                    
                    $request->merge([
                        'pppoe_username' => $username,
                        'pppoe_password' => $password,
                    ]);
                    
                    \Log::info('Auto-generated PPPoE credentials', [
                        'job_order_id' => $id,
                        'username' => $username,
                        'username_length' => strlen($username),
                        'password_length' => strlen($password),
                        'lcp_value' => $jobOrder->lcpnapLocation->lcp ?? 'NOT SET',
                        'nap_value' => $jobOrder->lcpnapLocation->nap ?? 'NOT SET'
                    ]);
                }
            }

            $validator = Validator::make($request->all(), [
                'application_id' => 'nullable|integer|exists:applications,id',
                'status' => 'nullable|string|max:100',
                'timestamp' => 'nullable|date',
                'date_installed' => 'nullable|date',
                'installation_fee' => 'nullable|numeric|min:0',
                'billing_day' => 'nullable|integer|min:0',
                'onsite_status' => 'nullable|string|max:100',
                'billing_status' => 'nullable|string|max:255',
                'assigned_email' => 'nullable|email|max:255',
                'onsite_remarks' => 'nullable|string',
                'status_remarks' => 'nullable|string|max:255',
                'modem_router_sn' => 'nullable|string|max:255',
                'router_model' => 'nullable|string|max:255',
                'connection_type' => 'nullable|string|max:100',
                'usage_type' => 'nullable|string|max:255',
                'ip_address' => 'nullable|string|max:45',
                'lcpnap' => 'nullable|string|max:255',
                'port' => 'nullable|string|max:255',
                'vlan' => 'nullable|string|max:255',
                'visit_by' => 'nullable|string|max:255',
                'visit_with' => 'nullable|string|max:255',
                'visit_with_other' => 'nullable|string|max:255',
                'address_coordinates' => 'nullable|string|max:255',
                'username' => 'nullable|string|max:255',
                'group_name' => 'nullable|string|max:255',
                'installation_landmark' => 'nullable|string|max:255',
                'pppoe_username' => 'nullable|string|max:255',
                'pppoe_password' => 'nullable|string|max:255',
                'custom_password' => 'nullable|string|max:255',
                'created_by_user_email' => 'nullable|email|max:255',
                'updated_by_user_email' => 'nullable|email|max:255',
                'start_time' => 'nullable|date',
                'end_time' => 'nullable|date',
                'organization_id' => 'nullable|integer',
                'client_signature_url' => 'nullable|string|max:500',
                'setup_image_url' => 'nullable|string|max:500',
                'speedtest_image_url' => 'nullable|string|max:500',
                'signed_contract_image_url' => 'nullable|string|max:500',
                'box_reading_image_url' => 'nullable|string|max:500',
                'router_reading_image_url' => 'nullable|string|max:500',
                'port_label_image_url' => 'nullable|string|max:500',
                'house_front_picture_url' => 'nullable|string|max:500',
                'proof_image_url' => 'nullable|string|max:500',
                'client_tagging_url' => 'nullable|string|max:500',
                'technicians' => 'nullable|array',
            ]);

            if ($validator->fails()) {
                \Log::error('JobOrder Update Validation Failed', [
                    'id' => $id,
                    'errors' => $validator->errors()->toArray()
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                ], 422);
            }

            $data = $request->all();

            // Sync pppoe_username to username if present
            if (isset($data['pppoe_username']) && !empty($data['pppoe_username'])) {
                $data['username'] = $data['pppoe_username'];
            }

            // Who recorded the pre-installation visit.
            //
            // Read from the signed-in user and assigned over whatever the request
            // carried, so the email on the record is the account that actually
            // made the change and cannot be set to someone else by editing the
            // payload. Stamped only when the pre-install fields are part of this
            // request, so an unrelated update leaves the existing value alone.
            //
            // There is no fallback. A pre-install whose author cannot be
            // established is refused outright rather than written with a blank
            // or stand-in name — the column exists to answer "who did this?",
            // and a row that cannot answer it is worse than no row.
            if ($request->has('pre_installed')) {
                $recordedBy = $currentUser
                    ? trim((string) ($currentUser->email ?? $currentUser->email_address ?? ''))
                    : '';

                if ($recordedBy === '') {
                    DB::rollBack();

                    \Log::warning('JobOrder Update blocked: pre-install author has no email address', [
                        'id'      => $id,
                        'user_id' => $currentUser->id ?? null,
                    ]);

                    return response()->json([
                        'success' => false,
                        'message' => 'Could not record the pre-installation: your account has no email address on file. '
                            . 'Ask an administrator to add one, then try again.',
                    ], 422);
                }

                $data['preinstalled_updated_by'] = $recordedBy;
            }

            \Log::info('JobOrder Updating with data', [
                'id' => $id,
                'data' => $data,
                'has_pppoe_password_in_data' => isset($data['pppoe_password']),
                'pppoe_password_value' => $data['pppoe_password'] ?? 'NOT SET',
                'pppoe_password_length' => isset($data['pppoe_password']) ? strlen($data['pppoe_password']) : 0
            ]);

            $oldStatus = $jobOrder->onsite_status;

            // ── Technician availability guard (mirrors Api\ServiceOrderApiController) ──
            // onsite_status is the Job Order equivalent of the Service Order
            // visit_status.
            //   • Reassigning the order (assigned_email changed) resets both timers
            //     so the new technician starts fresh.
            //   • Once a STARTED job leaves the "In Progress" state (any onsite_status
            //     other than In Progress — Failed, Done, Reschedule, …) it must carry
            //     an end_time, so the technician is not left flagged as busy.
            // start_time/end_time are stored as Asia/Manila wall-clock to match the
            // mobile timer, so we stamp Manila time here — bare now() is UTC here.
            $assignedEmailChanged = array_key_exists('assigned_email', $data)
                && (string) $data['assigned_email'] !== (string) ($jobOrder->assigned_email ?? '');

            if ($assignedEmailChanged) {
                $data['start_time'] = null;
                $data['end_time']   = null;
            } else {
                $effectiveOnsite = strtolower(trim((string) (array_key_exists('onsite_status', $data)
                    ? $data['onsite_status']
                    : ($jobOrder->onsite_status ?? ''))));

                $onsiteInProgress = in_array($effectiveOnsite, ['in progress', 'in-progress', 'inprogress'], true);
                $leftInProgress   = ($effectiveOnsite !== '' && !$onsiteInProgress);

                $startTimePresent = array_key_exists('start_time', $data)
                    ? !empty($data['start_time'])
                    : !empty($jobOrder->start_time);
                // A payload that mentions end_time (a real timestamp OR an explicit
                // null to (re)open the timer) is authoritative — never override it.
                $callerManagesEndTime = array_key_exists('end_time', $data);

                if ($leftInProgress && $startTimePresent && !$callerManagesEndTime && empty($jobOrder->end_time)) {
                    $data['end_time'] = \Carbon\Carbon::now('Asia/Manila')->format('Y-m-d H:i:s');
                }
            }
            // ──────────────────────────────────────────────────────────────────────

            $jobOrder->fill($data);
            $dirtyAttributes = $jobOrder->getDirty();
            
            $realChanges = array_filter(array_keys($dirtyAttributes), function($key) {
                return !in_array($key, ['updated_by_user_email', 'updated_at']);
            });
            
            if (!empty($realChanges)) {
                $oldData = [];
                $newData = [];
                
                foreach ($dirtyAttributes as $key => $newValue) {
                    if ($key === 'updated_at') continue;
                    $oldData[$key] = $jobOrder->getOriginal($key);
                    $newData[$key] = $newValue;
                }
                
                $jobOrder->save();
 
                if (!empty($newData)) {
                    AuditTrailLog::create([
                        'old_details' => [
                            'type' => 'joborders',
                            'id' => $jobOrder->id,
                            'data' => $oldData
                        ],
                        'new_details' => [
                            'type' => 'joborders',
                            'id' => $jobOrder->id,
                            'data' => $newData
                        ],
                        'created_by_user' => $data['updated_by_user_email'] ?? 'System',
                        'updated_by_user' => $data['updated_by_user_email'] ?? 'System'
                    ]);
                }

                // Create Activity Log using helper
                ActivityLog::log(
                    'Job Order Updated',
                    "Job Order #{$id} updated by " . ($data['updated_by_user_email'] ?? 'Technician') . " (Status: {$jobOrder->onsite_status})",
                    'info',
                    [
                        'user_email' => $data['updated_by_user_email'] ?? null,
                        'resource_type' => 'JobOrder',
                        'resource_id' => $jobOrder->id,
                        'additional_data' => [
                            'onsite_status' => $jobOrder->onsite_status,
                            'assigned_email' => $jobOrder->assigned_email,
                            'updated_by' => $data['updated_by_user_email'] ?? null
                        ]
                    ]
                );
            } else {
                $jobOrder->refresh();
            }
            
            // Whether this update is what turned the job order Done. The agent
            // is told after the commit rather than here: RADIUS below can still
            // fail the whole update, and a referral that did not finish saving
            // must not announce itself as installed.
            $becameDone = false;

            if (($data['onsite_status'] ?? null) === 'Done' && $oldStatus !== 'Done') {
                $this->broadcastJobOrderDone($jobOrder);

                // Trigger RADIUS account creation.
                //
                // Deliberately synchronous: the subscriber has to be able to
                // authenticate the moment the visit is saved, so a Done that did not
                // reach RADIUS is not a Done. Once every attempt is spent the update
                // fails, and the technician is shown what actually went wrong.
                $radiusResult = $this->createRadiusAccountInternal($jobOrder);
                if (!$radiusResult['success']) {
                    $detailedError = $radiusResult['error'] ?? $radiusResult['message'] ?? 'radius api error occured contact support';
                    \Log::channel('radiusrelated')->error('RADIUS Account Creation Failed during JobOrder Done', [
                        'job_order_id' => $id,
                        'radius_error' => $detailedError
                    ]);
                    throw new \Exception($detailedError);
                }

                $becameDone = true;
            }
            
            \Log::info('JobOrder After Update', [
                'id' => $id,
                'pppoe_password_in_model' => $jobOrder->pppoe_password ?? 'NULL',
                'pppoe_password_length' => $jobOrder->pppoe_password ? strlen($jobOrder->pppoe_password) : 0,
                'pppoe_username_in_model' => $jobOrder->pppoe_username ?? 'NULL'
            ]);

            // Update technical_details if account_id exists
            if ($jobOrder->account_id) {
                $technicalDetail = TechnicalDetail::where('account_id', $jobOrder->account_id)->first();
                
                if ($technicalDetail) {
                    $technicalUpdateData = [];
                    
                    if (isset($data['usage_type'])) {
                        $technicalUpdateData['usage_type'] = $data['usage_type'];
                    }
                    if (isset($data['connection_type'])) {
                        $technicalUpdateData['connection_type'] = $data['connection_type'];
                    }
                    if (isset($data['router_model'])) {
                        $technicalUpdateData['router_model'] = $data['router_model'];
                    }
                    if (isset($data['modem_router_sn'])) {
                        $technicalUpdateData['router_modem_sn'] = $data['modem_router_sn'];
                    }
                    if (isset($data['ip_address'])) {
                        $technicalUpdateData['ip_address'] = $data['ip_address'];
                    }
                    if (isset($data['lcpnap'])) {
                        $technicalUpdateData['lcpnap'] = $data['lcpnap'];
                        
                        $lcpnapValue = $data['lcpnap'];
                        $loc = LCPNAPLocation::where('lcpnap_name', trim($lcpnapValue))
                                           ->orWhere('id', trim($lcpnapValue))
                                           ->first();
                        
                        if ($loc) {
                            $technicalUpdateData['lcp'] = $loc->lcp;
                            $technicalUpdateData['nap'] = $loc->nap;
                        } else {
                            // Fallback if not found in lookup, but try to keep behavior safe
                             $technicalUpdateData['lcp'] = null;
                             $technicalUpdateData['nap'] = null;
                        }
                    }
                    if (isset($data['port'])) {
                        $technicalUpdateData['port'] = $data['port'];
                    }
                    if (isset($data['vlan'])) {
                        $technicalUpdateData['vlan'] = $data['vlan'];
                    }
                    if ($jobOrder->pppoe_username) {
                        $technicalUpdateData['username'] = $jobOrder->pppoe_username;
                    }
                    
                    if (!empty($technicalUpdateData)) {
                        $technicalDetail->update($technicalUpdateData);
                        
                        \Log::info('TechnicalDetail Updated', [
                            'account_id' => $jobOrder->account_id,
                            'updated_fields' => array_keys($technicalUpdateData)
                        ]);
                    }
                }
            }

            \Log::info('JobOrder Updated Successfully', [
                'id' => $id,
                'updated_fields' => array_keys($data)
            ]);

            $jobOrder->load('application');

            DB::commit();

            if ($becameDone) {
                $this->notifyReferringAgentOfCompletion($jobOrder);
            }

            return response()->json([
                'success' => true,
                'message' => 'Job order updated successfully',
                'data' => $jobOrder,
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            $errorMessage = $e->getMessage();
            
            \Log::error('JobOrder Update Failed', [
                'id' => $id,
                'error' => $errorMessage,
                'trace' => $e->getTraceAsString()
            ]);

            // Precise mapping as requested by user.
            // cURL 7 is a refused connection, 28 a timeout, 6/35 a DNS or TLS
            // failure — all of them mean the same thing to a technician: the
            // server could not be reached. Only 7 was matched before, so a
            // timeout fell through and showed the raw cURL string instead.
            if (str_contains($errorMessage, 'Failed to connect to RADIUS server') ||
                str_contains($errorMessage, 'Connection refused') ||
                str_contains($errorMessage, 'Timeout was reached') ||
                str_contains($errorMessage, 'cURL error 6') ||
                str_contains($errorMessage, 'cURL error 7') ||
                str_contains($errorMessage, 'cURL error 28') ||
                str_contains($errorMessage, 'cURL error 35')) {
                return response()->json([
                    'success' => false,
                    // Name the actual failure rather than just "Radius Offline" —
                    // a timeout, a refused port and a TLS failure need different
                    // people to fix them, and the technician on site is the one
                    // who has to relay it.
                    'message' => 'Failed to connect to RADIUS server: ' . $this->describeConnectionFailure($errorMessage),
                    'error' => $errorMessage
                ], 400);
            }

            // Check for Radius duplicate (usually HTTP 400 with "already exists" or similar)
            if (str_contains($errorMessage, 'HTTP 400') && (str_contains($errorMessage, 'already exists') || str_contains($errorMessage, 'Duplicate') || str_contains($errorMessage, 'exists'))) {
                return response()->json([
                    'success' => false,
                    'message' => 'Radius Duplicate',
                    'error' => $errorMessage
                ], 400);
            }

            // Check for Technical Details duplicate
            if (str_contains($errorMessage, 'Duplicate entry') && str_contains($errorMessage, 'technical_details')) {
                return response()->json([
                    'success' => false,
                    'message' => 'it has a duplicate on onboarded customer',
                    'error' => $errorMessage
                ], 409);
            }

            // Fallback for other RADIUS related errors
            if (str_contains($errorMessage, 'radius') || str_contains($errorMessage, 'RADIUS') || str_contains($errorMessage, 'HTTP')) {
                return response()->json([
                    'success' => false,
                    'message' => $errorMessage,
                ], 400);
            }

            return response()->json([
                'success' => false,
                'message' => 'Failed to update job order',
                'error' => $errorMessage,
            ], 500);
        }
    }

    /**
     * Turn a raw cURL failure into the one line that says what to go and fix.
     *
     * The underlying message is still returned in the 'error' field; this is the
     * part a technician can read off the screen and pass on.
     */
    private function describeConnectionFailure(string $errorMessage): string
    {
        if (str_contains($errorMessage, 'cURL error 28') || str_contains($errorMessage, 'Timeout was reached')) {
            return 'no response before the timeout. The server is offline, or a firewall is dropping the connection.';
        }

        if (str_contains($errorMessage, 'cURL error 7') || str_contains($errorMessage, 'Connection refused')) {
            return 'the connection was refused. The server is reachable but nothing is listening on that port.';
        }

        if (str_contains($errorMessage, 'cURL error 6')) {
            return 'the host name could not be resolved. Check the IP or host in the RADIUS config.';
        }

        if (str_contains($errorMessage, 'cURL error 35')) {
            return 'the secure connection failed. Check whether the RADIUS config should be http instead of https.';
        }

        return 'the server could not be reached.';
    }

    /**
     * Tell the agent who referred this customer that the visit is done.
     *
     * Reaches them as a push notification, so it arrives whether or not the app
     * is open — an agent finds out their referral is installed without having to
     * go looking for it.
     *
     * Who the referral belongs to is resolved by
     * JobOrderAgentPaymentService::referringAgent, which applies the shared rule
     * the incentives, achievements and invoices all use. An agent is therefore
     * only ever told about a customer the rest of the system also counts as
     * theirs, and a referral naming a team rather than a person matches nobody
     * and quietly notifies no one.
     *
     * Called after the update commits and never inside it. Failing to send must
     * not fail the visit: the work is saved and the technician is finished
     * either way, so everything here is swallowed and logged.
     */
    private function notifyReferringAgentOfCompletion(JobOrder $jobOrder): void
    {
        try {
            $agent = app(\App\Services\JobOrderAgentPaymentService::class)->referringAgent($jobOrder);

            if (!$agent) {
                return;
            }

            $email = trim((string) ($agent->email_address ?? $agent->email ?? ''));
            if ($email === '') {
                return;
            }

            $application = $jobOrder->application;
            $customer = trim(($application->first_name ?? '') . ' ' . ($application->last_name ?? ''));

            app(\App\Services\PushNotificationService::class)->sendToUserByEmail(
                $email,
                'Referral Installed',
                $customer !== ''
                    ? "{$customer} is now installed. Job Order #{$jobOrder->id} is marked Done."
                    : "Your referral is now installed. Job Order #{$jobOrder->id} is marked Done.",
                [
                    'type' => 'job_order_done',
                    'job_order_id' => $jobOrder->id,
                ],
                'JO'
            );
        } catch (\Throwable $e) {
            \Log::warning('[JobOrder] Could not notify the referring agent that a job order was completed', [
                'job_order_id' => $jobOrder->id ?? null,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function broadcastJobOrderDone($jobOrder)
    {
        try {
            $application = $jobOrder->application;
            $data = [
                'id' => $jobOrder->id,
                'type' => 'job_order_done',
                'customer_name' => trim(($application->first_name ?? '') . ' ' . ($application->last_name ?? '')),
                'plan_name' => $application->desired_plan ?? 'Unknown Plan',
                'title' => 'Job Order Completed',
                'message' => 'Onsite status marked as Done',
                'timestamp' => now()->timestamp,
                'formatted_date' => now()->format('Y-m-d h:i:s A'),
                'organization_id' => $jobOrder->organization_id
            ];

            event(new \App\Events\JobOrderDone($data));
            \Log::info('Real-time broadcast sent for Job Order Done', ['id' => $jobOrder->id]);
        } catch (\Exception $e) {
            \Log::warning('Failed to broadcast Job Order Done via Soketi', [
                'error' => $e->getMessage()
            ]);
        }
    }

    public function destroy($id): JsonResponse
    {
        try {
            $jobOrder = JobOrder::findOrFail($id);
            $jobOrderData = $jobOrder->toArray();
            $jobOrder->delete();

            $userEmail = request()->input('updated_by_user_email') ?? auth()->user()?->email ?? 'System';

            // Audit Trail Log
            AuditTrailLog::create([
                'old_details' => [
                    'type' => 'joborders',
                    'id' => $id,
                    'data' => $jobOrderData
                ],
                'new_details' => null,
                'created_by_user' => $userEmail,
                'updated_by_user' => $userEmail
            ]);

            // Create Activity Log
            ActivityLog::log(
                'Job Order Deleted',
                "Job Order #{$id} deleted by " . (auth()->user()->email ?? 'System'),
                'warning',
                [
                    'resource_type' => 'JobOrder',
                    'resource_id' => $id,
                    'additional_data' => [
                        'job_order_data' => $jobOrderData
                    ]
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Job order deleted successfully',
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete job order',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Settle the referring agent for a job order being approved, if there is one
     * and if the settlement service is available.
     *
     * Three outcomes, deliberately treated differently:
     *
     *   • No referral recorded — a job order nobody referred is a perfectly
     *     ordinary approval (walk-ins and direct sign-ups). Skipped without
     *     reaching for the service at all.
     *   • The service cannot be resolved — that means the class is missing from
     *     THIS deployment, not that anything is wrong with the job order. Nothing
     *     has been written at that point, so the approval carries on and the gap
     *     is logged as an error for whoever deploys. The row keeps a null
     *     agent_paid_at, so it stays eligible to be settled once the deployment
     *     catches up; blocking every approval instead would be far worse.
     *   • A failure INSIDE settle() stays fatal on purpose: it runs in the
     *     approval's transaction, and a half-applied credit must roll back with
     *     it rather than leave an agent's balance wrong.
     *
     * A fourth outcome is possible and is the one that catches people out: a
     * referral IS recorded, but no agent matches it, so settle() writes nothing
     * and the approval succeeds looking entirely normal. The job order's
     * commission_status, commission_value, incentive_value, agent_paid_at and
     * agent_paid_to all stay NULL — indistinguishable from the feature not
     * being deployed. approve() logs that case as a WARNING with the referral
     * text, because it is the only way to tell the two apart.
     *
     * @return array{paid: bool, reason: string, agent_id: ?int,
     *               commission: float, incentive_value: float,
     *               referred_by?: string}
     */
    private function settleReferringAgent(JobOrder $jobOrder, ?string $actionBy): array
    {
        $skipped = static fn (string $reason): array => [
            'paid'            => false,
            'reason'          => $reason,
            'agent_id'        => null,
            'commission'      => 0.0,
            'incentive_value' => 0.0,
        ];

        // Resolved exactly the way JobOrderAgentPaymentService::referringAgent()
        // does, including the fallback read, so this pre-check cannot disagree
        // with the service about whether a referral exists.
        $referredBy = optional($jobOrder->application)->referred_by;
        if (!$referredBy && $jobOrder->application_id) {
            $referredBy = DB::table('applications')->where('id', $jobOrder->application_id)->value('referred_by');
        }

        if (trim((string) $referredBy) === '') {
            return $skipped('no referred_by on the application');
        }

        // Carried into the outcome so a skip can be read without going back to
        // the database to ask what the referral actually said. The commonest
        // cause of a skip is a referral naming a TEAM rather than an agent —
        // see agents:export-team-referrals — and the value is what shows that
        // at a glance.
        $referralText = trim((string) $referredBy);

        try {
            $service = app(\App\Services\JobOrderAgentPaymentService::class);
        } catch (\Throwable $e) {
            \Log::error('Job Order Approval - agent settlement unavailable, approving without it', [
                'job_order_id' => $jobOrder->getKey(),
                'exception'    => get_class($e),
                'error'        => $e->getMessage(),
            ]);

            return $skipped('settlement service unavailable');
        }

        $outcome = $service->settle($jobOrder, $actionBy);

        // The referral text travels with the outcome either way, so the caller
        // can say WHY nothing settled rather than only that nothing did.
        $outcome['referred_by'] = $referralText;

        return $outcome;
    }

    public function approve($id): JsonResponse
    {
        try {
            DB::beginTransaction();

            $query = JobOrder::query();
            $currentUser = auth()->user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $jobOrder = $query->with(['application', 'lcpnapLocation'])->lockForUpdate()->findOrFail($id);
            
            if (!$jobOrder->application) {
                throw new \Exception('Job order must have an associated application');
            }

            $application = $jobOrder->application;
            $actionUserEmail = request()->input('updated_by_user_email') ?? auth()->user()?->email_address ?? auth()->user()?->email ?? 'admin@amperecloud.com';
            $actionUserId = auth()->id() ?? 1;
            $organizationId = auth()->user()?->organization_id ?? null;

            \Log::info('Job Order Approval - Application Data', [
                'application_id' => $application->id,
                'mobile_number' => $application->mobile_number,
                'secondary_mobile_number' => $application->secondary_mobile_number,
                'first_name' => $application->first_name,
                'last_name' => $application->last_name,
            ]);

            if (empty($application->secondary_mobile_number)) {
                \Log::warning('Secondary mobile number is empty in application', [
                    'application_id' => $application->id,
                    'job_order_id' => $id
                ]);
            }

            if ($jobOrder->billing_status === 'Done' || $jobOrder->account_id) {
                throw new \Exception('Job order has already been approved and has an associated billing account.');
            }

            // Always a NEW customer row. Never matched against an existing one.
            //
            // One person legitimately holds several accounts under the same name,
            // email and mobile number — a second line at the same address, a unit
            // for a relative, a separate business connection. Matching on those
            // details attached the new account to the older person's row, and the
            // account_no sync further down then overwrote that row's account_no
            // with the new one, so the EARLIER account was left pointing at a
            // customer record that now described the later account.
            //
            // Each approval therefore owns its customer record outright: one
            // approved job order, one customer row, one billing account. The
            // account_no written below lands on this new row and disturbs nothing
            // that came before it.
            $customer = Customer::create([
                'first_name' => $application->first_name,
                'middle_initial' => $application->middle_initial,
                'last_name' => $application->last_name,
                'email_address' => $application->email_address,
                'contact_number_primary' => $application->mobile_number,
                'contact_number_secondary' => $application->secondary_mobile_number,
                'address' => $application->installation_address,
                'location' => $application->location,
                'barangay' => $application->barangay,
                'city' => $application->city,
                'region' => $application->region,
                'address_coordinates' => $jobOrder->address_coordinates,
                'housing_status' => $application->housing_status,
                'referred_by' => $application->referred_by,
                'desired_plan' => $application->desired_plan,
                'house_front_picture_url' => $jobOrder->house_front_picture_url ?? $application->house_front_picture_url,
                'proof_of_billing_url' => $application->proof_of_billing_url,
                'government_valid_id_url' => $application->government_valid_id_url,
                'second_government_valid_id_url' => $application->secondary_government_valid_id_url,
                'document_attachment_url' => $application->document_attachment_url,
                'other_isp_bill_url' => $application->other_isp_bill_url,
                'organization_id' => $organizationId,
                'created_by' => $actionUserEmail,
                'updated_by' => $actionUserEmail,
            ]);

            \Log::info('Created a new customer for approval', [
                'customer_id'  => $customer->id,
                'job_order_id' => $id,
            ]);

            \Log::info('Customer Ready with Contact Numbers', [
                'customer_id' => $customer->id,
                'contact_number_primary' => $customer->contact_number_primary,
                'contact_number_secondary' => $customer->contact_number_secondary,
                'from_application_secondary' => $application->secondary_mobile_number,
            ]);

            $accountNumber = $this->generateAccountNumber();
            
            // Final safety check for 1-to-1 account_no uniqueness
            if (BillingAccount::where('account_no', $accountNumber)->exists()) {
                throw new \Exception('Billing account already exists with this account number.');
            }

            \Log::info('Generated account number', [
                'generated_account_no' => $accountNumber
            ]);
            
            // Sync generated account number to customer
            $customer->update(['account_no' => $accountNumber]);

            $installationFee = $jobOrder->installation_fee ?? 0;
            
            $planId = null;
            if ($application->desired_plan) {
                $desiredPlan = $application->desired_plan;
                
                \Log::info('Parsing desired_plan', [
                    'desired_plan' => $desiredPlan
                ]);
                
                if (strpos($desiredPlan, ' - P') !== false) {
                    $parts = explode(' - P', $desiredPlan);
                    $planName = trim($parts[0]);
                    $priceString = trim($parts[1]);
                    $price = (float) str_replace(',', '', $priceString);
                    
                    \Log::info('Parsed plan components', [
                        'plan_name' => $planName,
                        'price' => $price
                    ]);
                    
                    $plan = Plan::where('plan_name', $planName)
                                ->where('price', $price)
                                ->first();
                    
                    if ($plan) {
                        $planId = $plan->id;
                        \Log::info('Plan found successfully', [
                            'plan_name' => $planName,
                            'price' => $price,
                            'plan_id' => $planId
                        ]);
                    } else {
                        \Log::warning('Plan not found with exact match', [
                            'plan_name' => $planName,
                            'price' => $price
                        ]);
                    }
                } else {
                    \Log::warning('desired_plan format unexpected', [
                        'desired_plan' => $desiredPlan,
                        'expected_format' => 'PLAN_NAME - PPRICE'
                    ]);
                }
            }
            
            $billingAccount = BillingAccount::create([
                'customer_id' => $customer->id,
                'account_no' => $accountNumber,
                'date_installed' => $jobOrder->date_installed ?? now(),
                'plan_id' => $planId,
                'account_balance' => $installationFee,
                'balance_update_date' => now(),
                'billing_day' => $jobOrder->billing_day,
                'billing_status_id' => 1,
                'organization_id' => $organizationId,
                'created_by' => $actionUserEmail,
                'updated_by' => $actionUserEmail,
            ]);
            
            \Log::info('BillingAccount created', [
                'billing_account_id' => $billingAccount->id,
                'plan_id_stored' => $billingAccount->plan_id
            ]);

            // Use username from job order if exists, otherwise fallback to account number
            $usernameValue = $jobOrder->pppoe_username ?: ($jobOrder->username ?: $accountNumber);
            $usernameForTechnical = $usernameValue;

            $modemSN = $jobOrder->modem_router_sn;
            if ($modemSN) {
                // Check if technical detail already exists for this modem SN
                if (TechnicalDetail::where('router_modem_sn', $modemSN)->exists()) {
                    throw new \Exception('Technical details already exist with this modem serial number.');
                }
            }

            // Check for technical details with same account number to ensure 1-to-1
            if (TechnicalDetail::where('account_no', $accountNumber)->exists()) {
                throw new \Exception('Technical details already exist for this account number.');
            }
            // Manual lookup for LCPNAP Location to ensure trimming
            $lcpnapValue = trim($jobOrder->lcpnap);
            $lcpnapData = LCPNAPLocation::where('lcpnap_name', $lcpnapValue)
                                      ->orWhere('id', $lcpnapValue)
                                      ->first();

            $lcpValue = trim($lcpnapData->lcp ?? '');
            $napValue = trim($lcpnapData->nap ?? '');
            $portValue = $jobOrder->port ?? '';

            $technicalDetail = TechnicalDetail::create([
                'account_id' => $billingAccount->id,
                'account_no' => $accountNumber,
                'username' => $usernameForTechnical,
                'username_status' => $jobOrder->username_status,
                'connection_type' => $jobOrder->connection_type,
                'router_model' => $jobOrder->router_model,
                'router_modem_sn' => $modemSN,
                'ip_address' => $jobOrder->ip_address,
                'lcp' => $lcpValue,
                'nap' => $napValue,
                'port' => $portValue,
                'vlan' => $jobOrder->vlan,
                'lcpnap' => $jobOrder->lcpnap,
                'usage_type' => $jobOrder->usage_type,
                'organization_id' => $organizationId,
                'created_by' => $actionUserEmail,
                'updated_by' => $actionUserEmail,
            ]);



            // Use the calculated username and contact number for credentials
            $generatedUsername = $usernameValue;
            $generatedPassword = $jobOrder->pppoe_password ?: $customer->contact_number_primary;

            // Check if online status already exists for this username
            if (OnlineStatus::where('username', $generatedUsername)->exists()) {
                throw new \Exception('there\'s already data in database');
            }

            OnlineStatus::create([
                'account_id' => $billingAccount->id,
                'account_no' => $accountNumber,
                'username' => $generatedUsername,
                'session_status' => '',
            ]);
            
            $jobOrder->update([
                'billing_status' => 'Done',
                'account_id' => $billingAccount->id,
                'pppoe_username' => $generatedUsername,
                'pppoe_password' => $generatedPassword,
                'updated_by_user_email' => request()->input('updated_by_user_email') ?? auth()->user()?->email_address ?? auth()->user()?->email ?? $jobOrder->created_by_user_email ?? 'System'
            ]);
            
            \Log::info('Credentials saved to job_orders table', [
                'job_order_id' => $id,
                'table' => 'job_orders',
                'columns_updated' => ['username', 'password', 'billing_status', 'account_id'],
                'username_saved' => $generatedUsername
            ]);

            $customerRoleId = 3;

            $existingUser = User::where('username', $accountNumber)->first();
            if ($existingUser) {
                \Log::warning('User with account number already exists', [
                    'account_number' => $accountNumber,
                    'existing_user_id' => $existingUser->id,
                ]);

                // Approving onto an account that already has a portal user left
                // that user holding whatever password it was created with, while
                // the customer is told their password is their mobile number.
                // Point it at the number, but only for a customer-role account
                // whose hash has drifted — never overwrite a staff password.
                if (\App\Support\PortalPassword::isCustomer($existingUser)
                    && !\App\Support\PortalPassword::hashIsCurrent($customer->contact_number_primary, $existingUser->password_hash)) {
                    $existingUser->contact_number = trim((string) $customer->contact_number_primary);
                    $existingUser->password_hash = \App\Support\PortalPassword::normalize($customer->contact_number_primary);
                    $existingUser->save();

                    \Log::info('Existing customer user repointed at current contact number', [
                        'user_id' => $existingUser->id,
                        'account_number' => $accountNumber,
                    ]);
                }

                // An approved job order means a working service, so the portal
                // login has to be open — the branch below creates new users with
                // active = 1 and this one left the flag wherever it happened to
                // be. The account that reaches here is usually one that was
                // pulled out (active = 0) and has now been re-installed: the
                // approval reported the portal account ready while the customer
                // was still refused at sign-in.
                //
                // Only for a customer-role account. A staff user whose username
                // collides with an account number must not be re-enabled by an
                // installation, which is the same reason the password repoint
                // above carries this guard.
                //
                // Both columns, so the row cannot read 'active' while being
                // locked out or the reverse. `active` is what sign-in checks.
                if (\App\Support\PortalPassword::isCustomer($existingUser)) {
                    $wasSuspended = !$existingUser->active;

                    $existingUser->active = 1;
                    $existingUser->status = 'active';
                    $existingUser->updated_by_user_id = $actionUserId;
                    $existingUser->save();

                    if ($wasSuspended) {
                        \Log::info('Existing customer portal login re-enabled by job order approval', [
                            'user_id' => $existingUser->id,
                            'account_number' => $accountNumber,
                            'job_order_id' => $id,
                        ]);
                    }
                } else {
                    \Log::warning('Account number matches a non-customer user; portal login left untouched', [
                        'user_id' => $existingUser->id,
                        'account_number' => $accountNumber,
                        'role_id' => $existingUser->role_id,
                    ]);
                }
            } else {
                // Create user with direct password hash assignment to avoid mutator
                $userData = [
                    'username' => $accountNumber,
                    'email_address' => $customer->email_address,
                    'first_name' => $customer->first_name,
                    'middle_initial' => $customer->middle_initial,
                    'last_name' => $customer->last_name,
                    'contact_number' => trim((string) $customer->contact_number_primary),
                    'role_id' => $customerRoleId,
                    'status' => 'active',
                    'active' => 1,
                    'organization_id' => $organizationId,
                    'created_by_user_id' => $actionUserId,
                    'updated_by_user_id' => $actionUserId,
                ];
                
                // Directly insert into database to bypass mutator
                $userId = \DB::table('users')->insertGetId(array_merge($userData, [
                    // Canonical spelling, so the number verifies however the
                    // customer types it at the login screen — "0917…", "917…",
                    // "+63 917…" all reach the same hash. Hashing the raw column
                    // value meant only its exact spelling ever worked.
                    'password_hash' => \App\Support\PortalPassword::hash($customer->contact_number_primary),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]));
                
                $user = User::find($userId);

                \Log::info('Customer user account created', [
                    'user_id' => $user->id,
                    'username' => $accountNumber,
                    'email_address' => $customer->email_address,
                    'role_id' => $customerRoleId,
                ]);
            }

            // Settle the referring agent: mark the job order Paid, credit the
            // commission, and record the rates it was settled at so a later
            // change to either setting cannot restate it.
            //
            // Inside the transaction deliberately — if anything after this
            // fails, the credit rolls back with the approval rather than
            // leaving an agent paid for a job order that was never approved.
            // A job order already carrying agent_paid_at is left alone, so
            // approving twice cannot pay twice.
            $agentPayment = $this->settleReferringAgent($jobOrder, $actionUserEmail);

            DB::commit();

            if ($agentPayment['paid']) {
                \Log::info('Job Order Approval - agent settled', [
                    'job_order_id'    => $id,
                    'agent_id'        => $agentPayment['agent_id'],
                    'commission'      => $agentPayment['commission'],
                    'incentive_value' => $agentPayment['incentive_value'],
                ]);
            } elseif ($agentPayment['reason'] === 'no referred_by on the application') {
                // Genuinely ordinary: walk-ins and direct sign-ups have no
                // referrer, so there is nothing to settle and nothing to see.
                \Log::info('Job Order Approval - agent not settled', [
                    'job_order_id' => $id,
                    'reason'       => $agentPayment['reason'],
                ]);
            } elseif ($agentPayment['reason'] !== '' && $agentPayment['reason'] !== 'already_paid') {
                // A referral WAS recorded and still nothing settled. The
                // approval is valid, but the agent has silently not been paid
                // and the job order's commission_status, commission_value,
                // incentive_value, agent_paid_at and agent_paid_to all stay
                // NULL — which looks identical to the feature not running.
                //
                // A warning, not info, because this needs somebody to look:
                //   • "no matching agent" almost always means referred_by names
                //     a TEAM, not an agent (agents:export-team-referrals lists
                //     them), or the name on the account does not match what was
                //     typed into the referral.
                //   • "agent has no balance record" means the agent exists but
                //     holds no agent_balance row, which is what defines an
                //     agent everywhere in this module — add one and the next
                //     approval settles.
                \Log::warning('Job Order Approval - referral recorded but agent NOT settled', [
                    'job_order_id' => $id,
                    'reason'       => $agentPayment['reason'],
                    // Both forms: the stored value is what to go and fix, and the
                    // name is what makes the line readable when the referral is an
                    // agent id rather than the text somebody typed.
                    'referred_by'  => \App\Support\AgentReferral::displayName($agentPayment['referred_by'] ?? null),
                    'referred_by_stored' => $agentPayment['referred_by'] ?? null,
                    'agent_id'     => $agentPayment['agent_id'],
                    'effect'       => 'commission_status/commission_value/incentive_value/agent_paid_at/agent_paid_to left NULL on this job order',
                ]);
            }

            // Create Activity Log using helper
            ActivityLog::log(
                'Job Order Approved',
                "Job Order #{$id} approved. Created Billing Account: {$accountNumber} for {$application->first_name} {$application->last_name}",
                'info',
                [
                    'resource_type' => 'JobOrder',
                    'resource_id' => $id,
                    'additional_data' => [
                        'account_number' => $accountNumber,
                        'customer_id' => $customer->id,
                        'application_id' => $application->id,
                        'plan' => $application->desired_plan
                    ]
                ]
            );

            // Provision the ONU label on SmartOLT.
            //
            // Runs on the backend rather than being left to the caller. The web UI
            // used to fire this itself, which meant an operator closing the tab — or
            // an approval arriving through the mobile API, which never called it at
            // all — left the ONU unlabelled and the subscriber unidentifiable in
            // SmartOLT. Doing it here covers every approval path.
            //
            // Post-commit and best-effort by design: the billing account, technical
            // record and RADIUS credentials are already durable, and an unreachable
            // OLT must not fail an approval that otherwise succeeded.
            $this->syncSmartOltOnApproval($jobOrder, $technicalDetail, $customer, $accountNumber);

            // Send Welcome SMS
            $this->sendWelcomeSms($customer, $accountNumber, $generatedUsername, $generatedPassword, $application->desired_plan);


            // Send Welcome Email
            try {
                if (!empty($customer->email_address)) {
                    $welcomeEmailTemplate = \App\Models\EmailTemplate::where('Template_Code', 'WELCOME')
                        ->where('Is_Active', true)
                        ->first();

                    if ($welcomeEmailTemplate) {
                        $emailBody = $welcomeEmailTemplate->email_body;

                        // Replace variables in email body
                        $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name));
                        $emailBody = str_replace('{{customer_name}}', $customerName, $emailBody);
                        $emailBody = str_replace('{{customer_tag}}', $customerName, $emailBody);
                        $emailBody = str_replace('{{company_name}}', 'ATSS Fiber', $emailBody);
                        $emailBody = str_replace('{{fb_username}}', 'https://www.facebook.com/atssfiber', $emailBody);
                        $emailBody = str_replace('{{account_no}}', $accountNumber, $emailBody);
                        $emailBody = str_replace('{{username}}', $generatedUsername, $emailBody);
                        $emailBody = str_replace('{{password}}', $generatedPassword, $emailBody);

                        $displayPlan = $application->desired_plan ?? 'N/A';
                        if (strpos($displayPlan, ' - P') !== false) {
                            $displayPlan = trim(explode(' - P', $displayPlan)[0]);
                        }
                        $displayPlan = str_replace('₱', 'P', $displayPlan);
                        $emailBody = str_replace('{{plan_name}}', $displayPlan, $emailBody);

                         if (!empty($emailBody)) {
                             $emailService = app(\App\Services\EmailQueueService::class);
                             
                             $emailService->queueEmail([
                                 'account_no' => $accountNumber,
                                 'recipient_email' => $customer->email_address,
                                 'subject' => $welcomeEmailTemplate->Subject_Line ?? 'Welcome to Ampere', 
                                 'body_html' => nl2br($emailBody), 
                                 'attachment_path' => null,
                                 'email_sender' => $welcomeEmailTemplate->email_sender,
                                 'reply_to' => $welcomeEmailTemplate->reply_to,
                                 'sender_name' => $welcomeEmailTemplate->sender_name
                             ]);
                             
                             \Log::info('Welcome Email queued successfully', [
                                  'customer_id' => $customer->id,
                                  'email' => $customer->email_address
                             ]);
                         } else {
                             \Log::warning('Welcome Email Body is empty');
                         }
                    } else {
                        \Log::warning('Welcome Email template not found or inactive');
                    }
                }
            } catch (\Exception $e) {
                 \Log::error('Failed to send Welcome Email: ' . $e->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Job order approved successfully',
                'data' => [
                    'customer_id' => $customer->id,
                    'billing_account_id' => $billingAccount->id,
                    'technical_detail_id' => $technicalDetail->id,
                    'account_number' => $accountNumber,
                    'plan_id' => $planId,
                    'desired_plan' => $application->desired_plan,
                    'installation_fee' => $installationFee,
                    'account_balance' => $installationFee,
                    'contact_number_primary' => $customer->contact_number_primary,
                    'contact_number_secondary' => $customer->contact_number_secondary,
                    'user_created' => !isset($existingUser),
                    'user_username' => $accountNumber,
                    'username' => $generatedUsername,
                    'password' => $generatedPassword,
                ]
            ]);

        } catch (\Exception $e) {
            DB::rollBack();
            
            \Log::error('Error approving job order: ' . $e->getMessage());
            \Log::error('Stack trace: ' . $e->getTraceAsString());
            
            // Map common error messages to user-friendly "duplicate" message
            $duplicateMessages = [
                'there\'s already data in database',
                'Duplicate entry',
                'Integrity constraint violation',
                'Billing account already exists',
                'Technical details already exist',
                'already been approved'
            ];
            
            $isDuplicate = false;
            foreach ($duplicateMessages as $msg) {
                if (strpos($e->getMessage(), $msg) !== false) {
                    $isDuplicate = true;
                    break;
                }
            }
            
            if ($isDuplicate) {
                return response()->json([
                    'success' => false,
                    'message' => 'there\'s already data in database',
                    'error' => $e->getMessage(),
                ], 409); // Conflict
            }
            
            return response()->json([
                'success' => false,
                'message' => $e->getMessage() ?: 'Failed to approve job order',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    private function generateAccountNumber(): string
    {
        DB::table('billing_accounts')->lockForUpdate()->get();
        
        $customAccountNumber = DB::table('custom_account_number')->first();
        
        if (!$customAccountNumber) {
            \Log::info('No custom_account_number record found, using default generation');
            return $this->generateDefaultAccountNumber();
        }
        
        $prefix = $customAccountNumber->starting_number;
        
        if ($prefix === null) {
            $prefix = '';
        } else {
            $prefix = (string)$prefix;
        }
        
        \Log::info('Custom account number config', [
            'prefix' => $prefix,
            'prefix_length' => strlen($prefix)
        ]);
        
        $prefixLength = strlen($prefix);
        $minIncrementLength = 4;
        
        $pattern = '^' . preg_quote($prefix, '/') . '\d+$';
        
        $latestAccount = BillingAccount::where('account_no', 'REGEXP', $pattern)
            ->where('account_no', 'LIKE', $prefix . '%')
            ->orderByRaw('LENGTH(account_no) DESC, account_no DESC')
            ->lockForUpdate()
            ->first();
        
        \Log::info('Latest account search', [
            'prefix' => $prefix,
            'pattern' => $pattern,
            'found' => $latestAccount ? $latestAccount->account_no : 'none'
        ]);
        
        if ($latestAccount) {
            $numericPart = substr($latestAccount->account_no, $prefixLength);
            $lastIncrement = (int)$numericPart;
            $lastIncrementLength = strlen($numericPart);
            $nextIncrement = $lastIncrement + 1;
            
            $nextIncrementLength = max($lastIncrementLength, strlen((string)$nextIncrement));
            
            \Log::info('Incrementing from existing account', [
                'last_account' => $latestAccount->account_no,
                'last_increment' => $lastIncrement,
                'last_increment_length' => $lastIncrementLength,
                'next_increment' => $nextIncrement,
                'next_increment_length' => $nextIncrementLength
            ]);
        } else {
            $nextIncrement = 1;
            $nextIncrementLength = $minIncrementLength;
            
            \Log::info('No existing account found, starting from 1', [
                'next_increment' => $nextIncrement,
                'next_increment_length' => $nextIncrementLength
            ]);
        }
        
        $newAccountNumber = $prefix . str_pad($nextIncrement, $nextIncrementLength, '0', STR_PAD_LEFT);
        
        \Log::info('Generated account number', [
            'account_number' => $newAccountNumber,
            'prefix' => $prefix,
            'increment' => $nextIncrement,
            'increment_length' => $nextIncrementLength
        ]);
        
        return $newAccountNumber;
    }

    private function generateDefaultAccountNumber(): string
    {
        $latestAccount = BillingAccount::orderBy('account_no', 'desc')
            ->lockForUpdate()
            ->first();
        
        if ($latestAccount && is_numeric($latestAccount->account_no)) {
            $nextNumber = (int) $latestAccount->account_no + 1;
            return str_pad($nextNumber, 4, '0', STR_PAD_LEFT);
        }
        
        return '0001';
    }

    public function getModemRouterSNs(): JsonResponse
    {
        try {
            $modems = ModemRouterSN::all();
            return response()->json([
                'success' => true,
                'data' => $modems,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch modem router SNs',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function getContractTemplates(): JsonResponse
    {
        try {
            $templates = ContractTemplate::all();
            return response()->json([
                'success' => true,
                'data' => $templates,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch contract templates',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function getPorts(): JsonResponse
    {
        try {
            $ports = Port::all();
            return response()->json([
                'success' => true,
                'data' => $ports,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch ports',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function getVLANs(): JsonResponse
    {
        try {
            $vlans = VLAN::all();
            return response()->json([
                'success' => true,
                'data' => $vlans,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch VLANs',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function getLCPNAPs(): JsonResponse
    {
        try {
            $lcpnaps = LCPNAPLocation::all();
            return response()->json([
                'success' => true,
                'data' => $lcpnaps,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch LCPNAPs',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function uploadImages(Request $request, $id): JsonResponse
    {
        try {
            Log::info('[BACKEND] Upload images request received', [
                'job_order_id' => $id,
                'folder_name' => $request->input('folder_name'),
                'has_signed_contract' => $request->hasFile('signed_contract_image'),
                'has_setup' => $request->hasFile('setup_image'),
                'has_box_reading' => $request->hasFile('box_reading_image'),
                'has_router_reading' => $request->hasFile('router_reading_image'),
                'has_port_label' => $request->hasFile('port_label_image'),
                'has_client_signature' => $request->hasFile('client_signature_image'),
                'has_client_tagging' => $request->hasFile('client_tagging_image'),
                'has_speed_test' => $request->hasFile('speed_test_image'),
                'has_proof_image' => $request->hasFile('proof_image'),
            ]);

            $validator = Validator::make($request->all(), [
                'folder_name' => 'required|string|max:255',
                'signed_contract_image' => 'nullable|image|max:10240',
                'setup_image' => 'nullable|image|max:10240',
                'box_reading_image' => 'nullable|image|max:10240',
                'router_reading_image' => 'nullable|image|max:10240',
                'port_label_image' => 'nullable|image|max:10240',
                'client_signature_image' => 'nullable|image|max:10240',
                'client_tagging_image' => 'nullable|image|max:10240',
                'speed_test_image' => 'nullable|image|max:10240',
                'proof_image' => 'nullable|image|max:10240',
                'house_front_image' => 'nullable|image|max:10240',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                ], 422);
            }

            $jobOrder = JobOrder::findOrFail($id);

            // Same oldest-first queue rule as update(): a technician cannot attach
            // work to a job order they are not allowed to open yet.
            if ($this->isJobOrderLockedForTechnician($jobOrder, auth()->user())) {
                return response()->json([
                    'success' => false,
                    'message' => 'This job order is locked. Finish the job order at the top of your list first, or ask an administrator to enable this one.',
                ], 403);
            }

            $applicationId = $jobOrder->application_id ?? $jobOrder->Application_ID;

            if (!$applicationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Job Order does not have an associated application_id'
                ], 400);
            }

            $imageFields = [
                'signed_contract_image',
                'setup_image',
                'box_reading_image',
                'router_reading_image',
                'port_label_image',
                'client_signature_image',
                'client_tagging_image',
                'speed_test_image',
                'proof_image',
                'house_front_image'
            ];

            $queuedCount = 0;
            $oldData = [];
            $newData = [];
            $dbColumnMap = [
                'signed_contract_image' => 'signed_contract_image_url',
                'setup_image' => 'setup_image_url',
                'box_reading_image' => 'box_reading_image_url',
                'router_reading_image' => 'router_reading_image_url',
                'port_label_image' => 'port_label_image_url',
                'client_signature_image' => 'client_signature_url',
                'client_tagging_image' => 'client_tagging_url',
                'speed_test_image' => 'speedtest_image_url',
                'proof_image' => 'proof_image_url',
                'house_front_image' => 'house_front_picture_url',
            ];

            foreach ($imageFields as $field) {
                if ($request->hasFile($field)) {
                    $file = $request->file($field);
                    $fileSizeKB = round($file->getSize() / 1024, 2);
                    Log::info("[BACKEND] $field received", [
                        'size_kb' => $fileSizeKB,
                        'mime_type' => $file->getMimeType(),
                    ]);

                    $fileName = $field . '_' . time() . '.' . $file->getClientOriginalExtension();
                    $localPath = $file->storeAs('images_queue', $fileName, 'public');

                    \App\Models\JobOrderImageQueue::create([
                        'job_order_id' => $id,
                        'field_name' => $field,
                        'local_path' => $localPath,
                        'original_filename' => $file->getClientOriginalName(),
                        'status' => 'pending',
                    ]);

                    $dbColumn = $dbColumnMap[$field] ?? $field;
                    $oldData[$dbColumn] = $jobOrder->$dbColumn;
                    $newData[$dbColumn] = 'Queueing upload: ' . $file->getClientOriginalName();

                    $queuedCount++;
                }
            }

            if ($queuedCount > 0) {
                $userEmail = auth()->user()?->email ?? 'System';
                AuditTrailLog::create([
                    'old_details' => [
                        'type' => 'joborders',
                        'id' => $jobOrder->id,
                        'data' => $oldData
                    ],
                    'new_details' => [
                        'type' => 'joborders',
                        'id' => $jobOrder->id,
                        'data' => $newData
                    ],
                    'created_by_user' => $userEmail,
                    'updated_by_user' => $userEmail
                ]);
            }

            Log::info('Job order images queued successfully', [
                'job_order_id' => $id,
                'image_count' => $queuedCount,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Images queued successfully for background upload',
                'data' => [],
            ]);

        } catch (\Exception $e) {
            Log::error('Error uploading job order images', [
                'job_order_id' => $id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to upload images to Google Drive',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function createRadiusAccount($id): JsonResponse
    {
        $jobOrder = JobOrder::with(['application', 'lcpnapLocation'])->findOrFail($id);
        $result = $this->createRadiusAccountInternal($jobOrder);
        
        if ($result['success']) {
            return response()->json($result);
        } else {
            return response()->json($result, 500);
        }
    }

    private function createRadiusAccountInternal(JobOrder $jobOrder): array
    {
        $id = $jobOrder->id;
        try {
            \Log::channel('radiusrelated')->info('=== CREATE RADIUS ACCOUNT INTERNAL ===', [
                'job_order_id' => $id
            ]);

            $organizationId = $jobOrder->organization_id ?? auth()->user()?->organization_id ?? null;

            // Server placement no longer depends on the barangay. We use the first
            // radius_config (#1) and, only if it fails 3 times, fall back to the
            // second radius_config (#2). The account is created on whichever succeeds.
            $configs = app(RadiusServerResolver::class)->orderedConfigs($organizationId);

            if ($configs->isEmpty()) {
                \Log::channel('radiusrelated')->error('No RADIUS configuration available for JobOrder: ' . $id, [
                    'job_order_id'    => $id,
                    'organization_id' => $organizationId,
                ]);
                return [
                    'success' => false,
                    'message' => 'No RADIUS server is configured. Please add a RADIUS Config before creating the account.',
                ];
            }

            if (!$jobOrder->application) {
                throw new \Exception('Job order must have an associated application');
            }

            $application = $jobOrder->application;

            $credentialsExist = !empty($jobOrder->pppoe_username) && !empty($jobOrder->pppoe_password);
            $pppoeUsername = $jobOrder->pppoe_username;
            $pppoePassword = $jobOrder->pppoe_password;
            $radiusSubmitted = false;
            $radiusError = null;

            // Fetch LCP/NAP details regardless of whether credentials exist
            $lcpnapValue = trim($jobOrder->lcpnap);
            $lcpnapData = LCPNAPLocation::where('lcpnap_name', $lcpnapValue)
                                      ->orWhere('id', $lcpnapValue)
                                      ->first();

            $lcpValue = trim($lcpnapData->lcp ?? '');
            $napValue = trim($lcpnapData->nap ?? '');
            $portValue = $jobOrder->port ?? '';

            if (!$credentialsExist) {
                $pppoeService = new PppoeUsernameService();
                
                $customerData = [
                    'first_name' => $application->first_name ?? '',
                    'middle_initial' => $application->middle_initial ?? '',
                    'last_name' => $application->last_name ?? '',
                    'mobile_number' => $application->mobile_number ?? '',
                    'lcp' => $lcpValue,
                    'nap' => $napValue,
                    'port' => $portValue,
                    'date_installed' => $jobOrder->date_installed ?? now(),
                ];

                $pppoeUsername = $pppoeService->generateUniqueUsername($customerData, $id);
                $pppoePassword = $pppoeService->generatePassword($customerData);
                
                if (empty($pppoeUsername) || empty($pppoePassword)) {
                    throw new \Exception('Failed to generate PPPoE credentials');
                }
                
                $jobOrder->update([
                    'pppoe_username' => $pppoeUsername,
                    'pppoe_password' => $pppoePassword,
                    'updated_by_user_email' => request()->input('updated_by_user_email') ?? auth()->user()?->email_address ?? auth()->user()?->email ?? $jobOrder->created_by_user_email ?? 'System'
                ]);
                
                $jobOrder->refresh();
            }

            $desiredPlan = $application->desired_plan;
            $plan = $desiredPlan;
            
            if ($desiredPlan) {
                // Remove price suffix (e.g., "SWIFT 1000", "STARTER - P799.00", "FLASH 1999")
                // Strips everything after a hyphen, or space followed by digits/currency
                $plan = preg_replace('/\s*-\s*(?:P|₱)?\d+.*/i', '', $desiredPlan);
                $plan = preg_replace('/\s+(?:P|₱)?\d+.*/i', '', $plan);
                $plan = trim($plan);
            }
            
            $payload = [
                'name' => $pppoeUsername,
                'group' => $plan,
                'password' => $pppoePassword
            ];

            // Try radius_config #1 up to 5 times; if it never succeeds, fall back to #2.
            //
            // The attempts are spaced out rather than fired back to back, so a
            // server that is rebooting or briefly saturated gets a chance to answer
            // instead of having all five attempts spent inside the same second.
            // The gaps grow (1s, 2s, 3s, 4s) and are only taken between attempts,
            // never after the last one.
            //
            // The whole loop has to finish inside the request, so the budget is
            // bounded: 5 attempts x 4s connect + 10s of waiting is ~30s per config,
            // ~60s if both are tried. RouterosApiService applies its own connect and
            // read timeouts, so the loop cannot inherit an unbounded socket wait.
            $maxAttemptsPerConfig = 5;
            $retryWaitSeconds = [1, 2, 3, 4];
            $positionsToTry = [1];
            if ($configs->count() >= 2) {
                $positionsToTry[] = 2;
            }

            $lastFailureWasConnection = false;

            foreach ($positionsToTry as $position) {
                $radiusConfig = $configs->get($position - 1);
                if (!$radiusConfig) {
                    continue;
                }

                \Log::channel('radiusrelated')->info('RADIUS server selected for JobOrder account creation', [
                    'job_order_id'     => $id,
                    'position'         => $position,
                    'radius_config_id' => $radiusConfig->id,
                    'radius_ip'        => $radiusConfig->ip,
                ]);

                for ($attempt = 1; $attempt <= $maxAttemptsPerConfig; $attempt++) {
                    // Wait before every attempt except the first.
                    if ($attempt > 1) {
                        $wait = $retryWaitSeconds[$attempt - 2] ?? end($retryWaitSeconds);
                        \Log::channel('radiusrelated')->info('Waiting before RADIUS retry for JobOrder: ' . $id, [
                            'job_order_id'  => $id,
                            'position'      => $position,
                            'next_attempt'  => $attempt,
                            'wait_seconds'  => $wait,
                        ]);
                        sleep($wait);
                    }

                    try {
                        $api = app(RouterosApiService::class);

                        // Connect first so an unreachable device is told apart from a
                        // device that answered and refused the account. connect()
                        // walks both transports for this config — the saved one, then
                        // the alternate — so reaching here means neither answered.
                        if (!$api->connect($radiusConfig)) {
                            $radiusError = $api->getLastError() !== ''
                                ? $api->getLastError()
                                : 'No RADIUS endpoint responded.';
                            $lastFailureWasConnection = true;
                            \Log::channel('radiusrelated')->error('RADIUS Connection Exception for JobOrder: ' . $id, [
                                'error' => $radiusError,
                                'position' => $position,
                                'attempt' => $attempt . '/' . $maxAttemptsPerConfig,
                                'radius_config_id' => $radiusConfig->id,
                                'radius_ip' => $radiusConfig->ip,
                                'transports' => $api->endpointStates($radiusConfig),
                            ]);

                            // Both transports are already in cool-off: retrying here
                            // only sleeps. Hand over to the next config now.
                            if ($api->lastConnectAllEndpointsDown()) {
                                \Log::channel('radiusrelated')->warning('Every transport for this RADIUS config is down; moving to the next config', [
                                    'job_order_id'     => $id,
                                    'position'         => $position,
                                    'radius_config_id' => $radiusConfig->id,
                                    'radius_ip'        => $radiusConfig->ip,
                                ]);
                                break;
                            }

                            continue;
                        }

                        \Log::channel('radiusrelated')->info('RADIUS transport in use for JobOrder: ' . $id, [
                            'job_order_id'     => $id,
                            'position'         => $position,
                            'radius_config_id' => $radiusConfig->id,
                            'endpoint'         => $api->activeEndpoint(),
                        ]);

                        // addUser() is idempotent: an account that is already on the
                        // device is reported as success rather than duplicated, so a
                        // retry after a half-completed attempt is safe.
                        if ($api->addUser($radiusConfig, $payload['name'], $payload['password'], $payload['group'])) {
                            $radiusSubmitted = true;
                            $radiusError = null;
                            break;
                        }

                        $radiusError = $api->getLastError() !== ''
                            ? $api->getLastError()
                            : 'The RADIUS device rejected the account.';
                        $lastFailureWasConnection = false;
                        \Log::channel('radiusrelated')->error('RADIUS API Error for JobOrder: ' . $id, [
                            'error' => $radiusError,
                            'payload' => $payload,
                            'position' => $position,
                            'attempt' => $attempt,
                            'radius_config_id' => $radiusConfig->id,
                            'radius_ip' => $radiusConfig->ip,
                        ]);

                        // The device answered and refused this exact sentence (unknown
                        // group, bad value). Re-sending it produces the same !trap, so
                        // move on to the next server instead of burning the retries.
                        break;
                    } catch (\Exception $mikrotikException) {
                        $radiusError = $mikrotikException->getMessage();
                        $lastFailureWasConnection = true;
                        \Log::channel('radiusrelated')->error('RADIUS Connection Exception for JobOrder: ' . $id, [
                            'error' => $radiusError,
                            'position' => $position,
                            'attempt' => $attempt . '/' . $maxAttemptsPerConfig,
                            'radius_config_id' => $radiusConfig->id,
                            'radius_ip' => $radiusConfig->ip,
                        ]);
                    }
                }

                if ($radiusSubmitted) {
                    break;
                }
            }

            if (!$radiusSubmitted && !$credentialsExist) {
                return [
                    'success' => false,
                    'message' => $lastFailureWasConnection
                        ? 'Failed to connect to RADIUS server'
                        : 'Failed to create RADIUS account',
                    'error' => $radiusError,
                ];
            }

            return [
                'success' => true,
                'message' => $credentialsExist ? 'RADIUS credentials already exist' : 'RADIUS account created successfully',
                'data' => [
                    'job_order_id' => $id,
                    'username' => $pppoeUsername,
                    'password' => $pppoePassword,
                    'group' => $plan,
                    'credentials_exist' => $credentialsExist,
                    'radius_response' => [
                        'submitted' => $radiusSubmitted,
                        'status' => $radiusSubmitted ? 'success' : 'failed',
                        'error' => $radiusError
                    ]
                ]
            ];

        } catch (\Exception $e) {
            \Log::channel('radiusrelated')->error('=== RADIUS ACCOUNT CREATION INTERNAL FAILED ===', [
                'job_order_id' => $id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return [
                'success' => false,
                'message' => 'Failed to create RADIUS account',
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Send Welcome SMS notification just like in TransactionController
     */
    /**
     * Label the subscriber's ONU in SmartOLT once an approval has committed.
     *
     * The name written is the PPPoE username, which is the identifier the SmartOLT
     * reconciliation tool, the MAC-alignment pass and the field technicians all match
     * on — so a freshly approved account is recognisable in SmartOLT immediately
     * rather than at the next nightly automation run.
     *
     * Best-effort and never fatal. By the time this runs the billing account,
     * technical record, RADIUS credentials and agent settlement are all committed;
     * SmartOLT is a downstream label and an unreachable OLT must not turn a
     * successful approval into an error for the operator. Every failure is logged to
     * the SmartOLT channel, and `cron:smartolt-daily-automation` re-aligns anything
     * that did not land.
     *
     * Idempotent: setOnuNameBySn() is a plain assignment, so approving-then-retrying
     * writes the same name again rather than creating anything.
     */
    private function syncSmartOltOnApproval($jobOrder, $technicalDetail, $customer, string $accountNumber): void
    {
        try {
            $sn = trim((string) ($jobOrder->modem_router_sn ?: ($technicalDetail->router_modem_sn ?? '')));
            $pppoeUser = trim((string) ($technicalDetail->username ?? $jobOrder->pppoe_username ?? ''));

            if ($sn === '' || $pppoeUser === '') {
                \Log::channel('smartoltrelated')->info('[SMARTOLT JOB ORDER APPROVE] Skipped — no serial or username', [
                    'job_order_id' => $jobOrder->id,
                    'account_no'   => $accountNumber,
                    'has_serial'   => $sn !== '',
                    'has_username' => $pppoeUser !== '',
                ]);
                return;
            }

            $address = $customer === null ? '' : implode(', ', array_filter([
                trim((string) ($customer->address ?? '')),
                trim((string) ($customer->barangay ?? '')),
                trim((string) ($customer->city ?? '')),
            ], static fn (string $part): bool => $part !== ''));

            $outcome = app(\App\Services\SmartOltService::class)->setOnuNameBySn(
                $sn,
                $pppoeUser,
                $address !== '' ? $address : null,
                $customer->contact_number_primary ?? null
            );

            \Log::channel('smartoltrelated')->info('[SMARTOLT JOB ORDER APPROVE] ' . $outcome, [
                'job_order_id' => $jobOrder->id,
                'account_no'   => $accountNumber,
                'sn'           => $sn,
                'name'         => $pppoeUser,
            ]);
        } catch (\Exception $e) {
            \Log::channel('smartoltrelated')->error('[SMARTOLT JOB ORDER APPROVE] Sync failed', [
                'job_order_id' => $jobOrder->id ?? null,
                'account_no'   => $accountNumber,
                'error'        => $e->getMessage(),
            ]);
        }
    }

    private function sendWelcomeSms($customer, $accountNumber, $pppoeUsername, $pppoePassword, $planName)
    {
        try {
            if ($customer && !empty($customer->contact_number_primary)) {
                $welcomeTemplate = DB::table('sms_templates')
                    ->where('template_type', 'Welcome')
                    ->where('is_active', 1)
                    ->first();
                    
                if ($welcomeTemplate) {
                    $smsService = new \App\Services\ItexmoSmsService();
                    $message = $welcomeTemplate->message_content;
                    
                    // Replace variables
                    $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name));
                    $message = str_replace('{{customer_name}}', $customerName, $message);
                    $message = str_replace('{{customer_tag}}', $customerName, $message);
                    $message = str_replace('{{account_no}}', $accountNumber, $message);
                    $message = str_replace('{{username}}', $pppoeUsername, $message);
                    $message = str_replace('{{password}}', $pppoePassword, $message);
                    
                    $displayPlan = $planName ?? 'N/A';
                    if (strpos($displayPlan, ' - P') !== false) {
                        $displayPlan = trim(explode(' - P', $displayPlan)[0]);
                    }
                    $displayPlan = str_replace('₱', 'P', $displayPlan);
                    $message = str_replace('{{plan_name}}', $displayPlan, $message);
                    
                    // Support more variables like in TransactionController
                    $currentDate = date('Y-m-d');
                    $message = str_replace('{{date}}', $currentDate, $message);
                    $message = str_replace('{{payment_date}}', $currentDate, $message);
                    
                    $message = $this->replaceGlobalVariables($message);
                    
                    $result = $smsService->send([
                        'contact_no' => $customer->contact_number_primary,
                        'message' => $message
                    ]);
                    
                    if ($result['success']) {
                        \Log::info('Welcome SMS sent successfully', [
                             'customer_id' => $customer->id,
                             'account_no' => $accountNumber
                        ]);
                    } else {
                        \Log::error('Welcome SMS failed to send: ' . ($result['error'] ?? 'Unknown error'));
                    }
                } else {
                    \Log::warning('Welcome SMS template not found or inactive');
                }
            }
        } catch (\Exception $e) {
            \Log::error('Failed to send Welcome SMS: ' . $e->getMessage());
        }
    }

    /**
     * Replace global placeholders in SMS messages
     */
    private function replaceGlobalVariables(string $message): string
    {
        $portalUrl = 'sync.atssfiber.ph';
        $brandName = DB::table('form_ui')->value('brand_name') ?? 'Your ISP';

        $message = str_replace('{{portal_url}}', $portalUrl, $message);
        $message = str_replace('{{company_name}}', $brandName, $message);

        return $message;
    }

    /**
     * Record an audit trail entry when a blocked technician reassignment is attempted.
     *
     * Fired by the front-end Job Order Done form when an admin tries to reassign the
     * technician after the job has already been started (start_time is set).
     */
    public function logBlockedTransfer(Request $request, $id): JsonResponse
    {
        try {
            $performedBy = $request->input('performed_by')
                ?? optional($request->user())->email_address
                ?? optional($request->user())->email
                ?? 'System';

            $originalTechName  = $request->input('original_technician_name');
            $originalTechEmail = $request->input('original_technician_email');
            $newTechName       = $request->input('new_technician_name');
            $newTechEmail      = $request->input('new_technician_email');
            $startTime         = $request->input('start_time');

            $description = $request->input('description')
                ?? "Save blocked — Technician reassignment attempted on Job Order #{$id} by {$performedBy}. "
                 . "The original technician " . ($originalTechName ?: $originalTechEmail ?: 'Unknown')
                 . " has already started the job (start_time: " . ($startTime ?: 'N/A') . "). Transfer not allowed.";

            AuditTrailLog::create([
                'old_details' => null,
                'new_details' => [
                    'type'                   => 'joborders',
                    'id'                     => $id,
                    'action'                 => 'technician_reassignment_blocked',
                    'module'                 => 'Job Orders',
                    'description'            => $description,
                    'performed_by'           => $performedBy,
                    'job_order_id'           => $id,
                    'start_time'             => $startTime,
                    'original_technician'    => [
                        'name'  => $originalTechName,
                        'email' => $originalTechEmail,
                    ],
                    'attempted_technician'   => [
                        'name'  => $newTechName,
                        'email' => $newTechEmail,
                    ],
                ],
                'created_by_user' => $performedBy,
                'updated_by_user' => $performedBy,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Blocked transfer logged'
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to log blocked technician transfer', [
                'job_order_id' => $id,
                'error'        => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to log blocked transfer',
                'error'   => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Release a job order to its technician ahead of their queue.
     *
     * Technicians work oldest first: only the oldest job order still open to them
     * is actionable, everything newer is greyed out. An administrator calls this
     * to unlock one specific job order early. Restricted to administrators by the
     * `role` middleware on the route — the flag is not fillable, so this is the
     * only way it can be set.
     */
    public function enableForTechnician(Request $request, $id): JsonResponse
    {
        try {
            $query = JobOrder::query();
            $currentUser = auth()->user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $jobOrder = $query->findOrFail($id);

            // Already released — answer successfully with the current state rather
            // than writing an audit entry for a no-op.
            if ($jobOrder->technician_enabled) {
                return response()->json([
                    'success' => true,
                    'message' => 'This job order is already enabled for the technician.',
                    'data' => [
                        'id' => $jobOrder->id,
                        'technician_enabled' => true,
                    ],
                ]);
            }

            $performedBy = $request->input('updated_by_user_email')
                ?? optional($currentUser)->email_address
                ?? optional($currentUser)->email
                ?? 'System';

            $jobOrder->technician_enabled = true;
            $jobOrder->updated_by_user_email = $performedBy;
            $jobOrder->save();

            AuditTrailLog::create([
                'old_details' => [
                    'type' => 'joborders',
                    'id' => $jobOrder->id,
                    'data' => ['technician_enabled' => false],
                ],
                'new_details' => [
                    'type' => 'joborders',
                    'id' => $jobOrder->id,
                    'data' => ['technician_enabled' => true],
                ],
                'created_by_user' => $performedBy,
                'updated_by_user' => $performedBy,
            ]);

            ActivityLog::log(
                'Job Order Enabled For Technician',
                "Job Order #{$jobOrder->id} unlocked for technician access by {$performedBy}",
                'info',
                [
                    'user_email' => $performedBy,
                    'resource_type' => 'JobOrder',
                    'resource_id' => $jobOrder->id,
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Job order enabled for technician access.',
                'data' => [
                    'id' => $jobOrder->id,
                    'technician_enabled' => true,
                ],
            ]);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Job order not found',
            ], 404);
        } catch (\Exception $e) {
            \Log::error('Failed to enable job order for technician', [
                'job_order_id' => $id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to enable job order for technician',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Is this job order locked for the signed-in user because it is not their
     * next one in the queue?
     *
     * Only ever true for technicians. A job order is open when any of these hold:
     *   • it heads the queue of work still assigned to them — the oldest In
     *     Progress job order, or the oldest other active one when they have none
     *     in progress, or the oldest rescheduled one when that is all that is
     *     left. A reschedule sorts last, so it reaches the head only when there
     *     is no active work in front of it;
     *   • an administrator enabled it (technician_enabled);
     *   • they have already started it and not yet closed it — a job in flight
     *     must never become unreachable;
     *   • it is finished, failed or cancelled: nothing is left to act on.
     *
     * A rescheduled job order is deliberately NOT open on its status alone. It
     * stays out of the queue's way, so it never blocks the work behind it, but
     * picking it back up is an administrator's call — otherwise a reschedule
     * would be the one status a technician could always act on, whatever else
     * they had waiting, which is how a rescheduled job order came to be editable
     * while its own Start button was still locked.
     *
     * A job order that is not part of the technician's own assigned queue is left
     * alone: this restriction governs the order of their own work, and must not
     * start blocking records reached some other way.
     */
    private function isJobOrderLockedForTechnician(JobOrder $jobOrder, $currentUser): bool
    {
        if (!$currentUser || (int) $currentUser->role_id !== Role::TECHNICIAN) {
            return false;
        }

        if ($jobOrder->technician_enabled) {
            return false;
        }

        $onsiteStatus = strtolower(trim((string) $jobOrder->onsite_status));
        if (in_array($onsiteStatus, JobOrder::TECHNICIAN_QUEUE_CLOSED_ONSITE_STATUSES, true)) {
            return false;
        }

        // Already in flight for this technician. A zero date counts as unset, the
        // same way the two clients read these columns.
        $isTimeSet = static function ($value): bool {
            $normalised = strtolower(trim((string) $value));
            return !in_array($normalised, ['', '0000-00-00 00:00:00', 'not set', '-', 'none', 'null'], true);
        };

        if ($isTimeSet($jobOrder->start_time) && !$isTimeSet($jobOrder->end_time)) {
            return false;
        }

        $technicianEmail = $currentUser->email ?? $currentUser->email_address ?? null;
        if (!$technicianEmail) {
            return false;
        }

        // The technician's open queue, in the order the two clients paint their
        // list: In Progress first, then other active work, then deferred work
        // last, oldest first within each band on the job order's own timestamp
        // falling back to the row's creation date. So the head of this list is
        // the row that appears at the top of the technician's screen.
        //
        // Deferred work is ranked here rather than excluded with the finished
        // work. Sorting last is what keeps it from taking the slot away from
        // active work; excluding it made it neither next nor locked.
        //
        // Membership of THIS list is also what decides whether the job order is
        // one of theirs to queue at all. Testing ownership separately would mean
        // two comparisons of the same email that can disagree — and a
        // disagreement fails open, because an empty queue never blocks.
        $inProgressFirst = sprintf(
            "CASE WHEN LOWER(TRIM(COALESCE(onsite_status, ''))) IN ('%s') THEN 0 ELSE 1 END",
            implode("', '", JobOrder::TECHNICIAN_IN_PROGRESS_ONSITE_STATUSES)
        );

        $deferredLast = sprintf(
            "CASE WHEN LOWER(TRIM(COALESCE(onsite_status, ''))) IN ('%s') THEN 1 ELSE 0 END",
            implode("', '", JobOrder::TECHNICIAN_QUEUE_DEFERRED_ONSITE_STATUSES)
        );

        $queue = JobOrder::where('assigned_email', $technicianEmail)
            ->whereNotIn(
                DB::raw("LOWER(TRIM(COALESCE(onsite_status, '')))"),
                JobOrder::TECHNICIAN_QUEUE_CLOSED_ONSITE_STATUSES
            )
            ->when($currentUser->organization_id, function ($q) use ($currentUser) {
                $q->where('organization_id', $currentUser->organization_id);
            }, function ($q) {
                $q->whereNull('organization_id');
            })
            ->orderBy(DB::raw($deferredLast))
            ->orderBy(DB::raw($inProgressFirst))
            ->orderBy(DB::raw('COALESCE(`timestamp`, `created_at`)'))
            ->orderBy('id')
            ->pluck('id')
            ->map(fn ($id) => (int) $id);

        // Not part of their own queue — leave the existing behaviour alone.
        if (!$queue->contains((int) $jobOrder->id)) {
            return false;
        }

        return $queue->first() !== (int) $jobOrder->id;
    }

    /**
     * Validate Modem Router SN for duplicates
     */
    public function validateModemRouterSN(Request $request): JsonResponse
    {
        try {
            $sn = $request->query('sn');
            $excludeId = $request->query('exclude_id');

            if (!$sn) {
                return response()->json([
                    'success' => false,
                    'message' => 'SN is required'
                ], 422);
            }

            // Check job_orders table
            $existsInJobOrders = JobOrder::where('modem_router_sn', $sn)
                ->when($excludeId, function ($query) use ($excludeId) {
                    return $query->where('id', '!=', $excludeId);
                })
                ->exists();

            if ($existsInJobOrders) {
                return response()->json([
                    'success' => false,
                    'is_duplicate' => true,
                    'source' => 'job_orders',
                    'message' => 'Please check on Customer Details. SN Duplicate Detected in Job Orders.'
                ]);
            }

            // Check technical_details table (modem_router_sn field mapping might be router_modem_sn or ip_address etc)
            // Let's check common field names for SN in technical_details
            $existsInTechnicalDetails = TechnicalDetail::where('router_modem_sn', $sn)->exists();

            if ($existsInTechnicalDetails) {
                return response()->json([
                    'success' => false,
                    'is_duplicate' => true,
                    'source' => 'technical_details',
                    'message' => 'Please check on Customer Details. SN Duplicate Detected in Technical Details.'
                ]);
            }

            return response()->json([
                'success' => true,
                'is_duplicate' => false,
                'message' => 'SN is available'
            ]);
        } catch (\Exception $e) {
            \Log::error('Modem SN Validation Error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Error validating SN'
            ], 500);
        }
    }

    public function broadcastViewing(Request $request)
    {
        try {
            $jobOrderId = $request->input('job_order_id');
            $action = $request->input('action', 'started_viewing');
            $username = auth()->user()->username ?? 'Guest';

            event(new JobOrderViewingUpdate($jobOrderId, $username, $action));

            return response()->json([
                'success' => true,
                'message' => 'Viewing update broadcasted'
            ]);
        } catch (\Throwable $e) {
            \Log::error('[Presence] broadcastViewing error: ' . $e->getMessage(), [
                'exception' => get_class($e),
                'file' => $e->getFile(),
                'line' => $e->getLine()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Failed to broadcast viewing update',
                'error' => $e->getMessage(),
                'type' => get_class($e)
            ], 500);
        }
    }
}
