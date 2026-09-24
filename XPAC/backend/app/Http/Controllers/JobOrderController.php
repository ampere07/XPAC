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
use App\Services\VisitTimerResetService;
use App\Models\RadiusConfig;
use App\Models\ActivityLog;
use App\Events\JobOrderViewingUpdate;

class JobOrderController extends Controller
{
    /**
     * Fallback VIP billing status id.
     *
     * Matches the hard-coded value in vip:check-expiration, CustomerDetailUpdateController and
     * EnhancedBillingGenerationServiceWithNotifications. Used only when the billing_status table
     * cannot be read or has no row named 'VIP'.
     */
    private const BILLING_STATUS_VIP_FALLBACK = 7;

    /** Resolved VIP billing status id, looked up once per request. */
    private ?int $resolvedVipStatusId = null;

    /**
     * The billing_status id that means "VIP".
     *
     * Resolved by name so a reordered status table cannot silently break VIP approval, with the
     * long-standing id as the fallback. Same resolution the rest of the app uses.
     */
    /** Is this account an agent, whose job orders are their own referrals? */
    private function isAgentUser($user): bool
    {
        return \App\Support\AgentAccess::isAgent($user)
            || strtolower(trim((string) ($user->role->role_name ?? ''))) === 'agent';
    }

    private function getVipBillingStatusId(): int
    {
        if ($this->resolvedVipStatusId !== null) {
            return $this->resolvedVipStatusId;
        }

        try {
            $configured = DB::table('billing_status')->where('status_name', 'VIP')->value('id');
        } catch (\Throwable $e) {
            $configured = null;
        }

        $this->resolvedVipStatusId = (int) ($configured ?: self::BILLING_STATUS_VIP_FALLBACK);

        return $this->resolvedVipStatusId;
    }

    /**
     * Record that a VIP is actually in service, once RADIUS has confirmed it.
     *
     * Every PPPoE account is provisioned restricted and says so in three places — the job order,
     * the technical details copied from it at approval, and the online-status row. Moving the
     * RADIUS user onto the plan group changes none of them: ManualRadiusOperationsService writes
     * the billing status and nothing else. A VIP therefore came out of a successful approval with
     * full service and the word "Restricted" on the job order list, the customer list, the details
     * panel, the invoice and the statement — every screen an operator would check to see whether
     * the VIP had worked, saying it had not.
     *
     * Called only after reconnectUser() reports success, so these columns describe what RADIUS
     * actually did. A queued/failed reconnect deliberately leaves them reading Restricted, which
     * is then the truth and the thing worth chasing.
     *
     * Best-effort: the approval is long committed and a bookkeeping write must not surface as a
     * failed approval. session_status is advisory in any case — RadiusStatusSyncService overwrites
     * it from the live session on its next pass.
     */
    private function markVipInService(JobOrder $jobOrder, TechnicalDetail $technicalDetail, BillingAccount $billingAccount): void
    {
        try {
            $jobOrder->update(['username_status' => JobOrder::USERNAME_STATUS_ACTIVE]);
            $technicalDetail->update(['username_status' => JobOrder::USERNAME_STATUS_ACTIVE]);

            OnlineStatus::where('account_id', $billingAccount->id)
                ->update(['session_status' => 'Online']);

            \Log::info('VIP marked in service after a confirmed RADIUS reconnect', [
                'job_order_id' => $jobOrder->id,
                'account_no' => $billingAccount->account_no,
                'username_status' => JobOrder::USERNAME_STATUS_ACTIVE,
            ]);
        } catch (\Throwable $e) {
            \Log::error('VIP is in service on RADIUS but its status columns could not be updated', [
                'job_order_id' => $jobOrder->id,
                'account_no' => $billingAccount->account_no,
                'error' => $e->getMessage(),
            ]);
        }
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
            
            if ($request->has('assigned_email')) {
                $assignedEmail = $request->query('assigned_email');
                \Log::info('Filtering job orders by assigned_email: ' . $assignedEmail);
                $query->where('assigned_email', $assignedEmail);
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
                    // This response is a hand-built whitelist, not the model, so every billing
                    // field the Job Order details panel renders has to be listed here explicitly
                    // — anything omitted silently renders as blank.
                    'generation_type' => $jobOrder->generation_type,
                    'vat_type' => $jobOrder->vat_type,
                    'vat_enabled' => $jobOrder->vat_enabled,
                    'withholding_enabled' => $jobOrder->withholding_enabled,
                    'withholding_percentage' => $jobOrder->withholding_percentage,
                    'vip_enabled' => $jobOrder->vip_enabled,
                    'vip_expiration' => $jobOrder->vip_expiration,
                    // job_orders has no prepaid column of its own — the expiry lives on the
                    // linked billing account, which is already eager-loaded, so no extra query.
                    // Needed by the Prepaid Expiration funnel filter on the Job Order list.
                    'prepaid_expires_at' => $jobOrder->billingAccount && $jobOrder->billingAccount->prepaid_expires_at
                        ? $jobOrder->billingAccount->prepaid_expires_at->format('Y-m-d H:i:s')
                        : null,
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
                    'Referred_By_Agent_ID' => \App\Support\AgentReferral::agentIdIfAgent(
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
    /**
     * VAT and withholding do not apply to a VIP job order. The JO Assign Form disables both
     * checkboxes when VIP is ticked; this enforces the same rule for anything posting to the API
     * directly, so a stored job order — and the billing account approval copies it to — can never
     * hold a contradictory combination.
     *
     * Only touches the payload when VIP is explicitly being turned on, so a partial update that
     * never mentions vip_enabled is left alone.
     */
    private function normalizeVipBillingFlags(array $data): array
    {
        if (empty($data['vip_enabled'])) {
            return $data;
        }

        $data['vat_enabled'] = false;
        $data['vat_type'] = 'No Vat';
        $data['withholding_enabled'] = false;
        $data['withholding_percentage'] = null;

        return $data;
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
                // 'Prepaid'/'Postpaid' are canonical. The other spellings are accepted because
                // Laravel's `in` rule is case- AND whitespace-sensitive, and production data shows
                // older builds posted 'PrePaid' and 'Pre Paid' — rejecting those would 422 a job
                // order assignment rather than just storing a non-canonical value.
                'generation_type' => 'nullable|string|in:Prepaid,Postpaid,PrePaid,PostPaid,Pre Paid,Post Paid|max:100',
                // Legacy free-text VAT mode. Still accepted (and still written by the current
                // form) so older clients and the detail/export screens keep working, but
                // vat_enabled below is what billing generation actually reads.
                'vat_type' => 'nullable|string|in:Vat Included,Excluded Vat,No Vat|max:100',
                'vat_enabled' => 'nullable|boolean',
                'withholding_enabled' => 'nullable|boolean',
                // Percentage of the VAT-inclusive subtotal, e.g. 5 / 10 / 15.
                'withholding_percentage' => 'nullable|numeric|min:0|max:100',
                // VIP is the existing billing status, captured here so approval can create the
                // account as VIP directly. Mutually exclusive with VAT and withholding — see the
                // normalisation below.
                'vip_enabled' => 'nullable|boolean',
                'vip_expiration' => 'nullable|date',
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

            // A PPPoE account starts restricted, always. Set here rather than left
            // to the caller so a client that omits the field cannot create an
            // account that is live before anyone has paid for it — see
            // JobOrder::USERNAME_STATUS_RESTRICTED for why activation belongs
            // downstream in the payment pipelines.
            if (empty($data['username_status'])) {
                $data['username_status'] = JobOrder::USERNAME_STATUS_RESTRICTED;
            }

            $data = $this->normalizeVipBillingFlags($data);

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

            // Whichever of the three branches above ran, a PPPoE account now
            // exists on this job order that did not before. It starts restricted:
            // credentials being filled in says a technician reached the form, not
            // that the customer is entitled to service. Activation happens later,
            // through the payment pipelines — see
            // JobOrder::USERNAME_STATUS_RESTRICTED.
            //
            // Only stamped when the job order has no status yet, so re-saving a JO
            // that was legitimately activated downstream does not knock it back
            // into restriction. That makes this safe to re-run, which matters
            // because the Done form saves repeatedly.
            if ($request->filled('pppoe_username') && empty($jobOrder->username_status)) {
                $request->merge([
                    'username_status' => JobOrder::USERNAME_STATUS_RESTRICTED,
                ]);

                \Log::info('PPPoE account initialised as restricted', [
                    'job_order_id' => $id,
                    'username' => $request->input('pppoe_username'),
                    'username_status' => JobOrder::USERNAME_STATUS_RESTRICTED,
                ]);
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
                // Same billing flags as store(); VIP forces the other two off on write.
                // generation_type is editable here too — the Done form sets it, and it decides
                // whether the account bills on a fixed day or a rolling prepaid period.
                'generation_type' => 'nullable|string|in:Prepaid,Postpaid,PrePaid,PostPaid,Pre Paid,Post Paid|max:100',
                'vat_enabled' => 'nullable|boolean',
                'withholding_enabled' => 'nullable|boolean',
                'withholding_percentage' => 'nullable|numeric|min:0|max:100',
                'vip_enabled' => 'nullable|boolean',
                'vip_expiration' => 'nullable|date',
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
                // Free-text rather than an `in` rule: the column also carries the
                // states the downstream RADIUS operations write (Active, Disconnected,
                // …), and constraining it here would reject a legitimate later update.
                // What matters is that a new account is never created without it —
                // that is enforced above, not by this rule.
                'username_status' => 'nullable|string|max:100',
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
            
            $data = $this->normalizeVipBillingFlags($data);

            \Log::info('JobOrder Updating with data', [
                'id' => $id,
                'data' => $data,
                'has_pppoe_password_in_data' => isset($data['pppoe_password']),
                'pppoe_password_value' => $data['pppoe_password'] ?? 'NOT SET',
                'pppoe_password_length' => isset($data['pppoe_password']) ? strlen($data['pppoe_password']) : 0
            ]);

            $oldStatus = $jobOrder->onsite_status;

            // A job order coming back from Failed or Reschedule is a NEW attempt, so the
            // timings left behind by the previous one are cleared before the fill — see
            // VisitTimerResetService for why a stale start_time is worse than none. Folded
            // into $data rather than saved separately so it lands in the same UPDATE as the
            // status change and shows up in the audit trail diff below.
            $data = app(VisitTimerResetService::class)->applyTo(
                $data,
                $oldStatus,
                $data['onsite_status'] ?? null,
                [
                    'entity' => 'job_order',
                    'id' => $jobOrder->id,
                    'actor' => $data['updated_by_user_email'] ?? null,
                ]
            );

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
                
                // Trigger RADIUS account creation
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
                    if ($jobOrder->pppoe_password) {
                        $technicalUpdateData['pppoe_password'] = $jobOrder->pppoe_password;
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

            // Precise mapping as requested by user
            if (str_contains($errorMessage, 'Failed to connect to RADIUS server') || 
                str_contains($errorMessage, 'Connection refused') || 
                str_contains($errorMessage, 'cURL error 7')) {
                return response()->json([
                    'success' => false,
                    'message' => 'Radius Offline',
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
    /** Are the agent-settlement columns present? Cached per process. */
    private static function agentSettlementSchemaReady(): bool
    {
        static $ready = null;

        if ($ready === null) {
            try {
                $ready = \Illuminate\Support\Facades\Schema::hasColumn('job_orders', 'agent_paid_at')
                    && \Illuminate\Support\Facades\Schema::hasColumn('job_orders', 'commission_value')
                    && \Illuminate\Support\Facades\Schema::hasColumn('job_orders', 'incentive_value')
                    && \Illuminate\Support\Facades\Schema::hasColumn('agent_balance', 'commission_value');
            } catch (\Throwable $e) {
                $ready = false;
            }
        }

        return $ready;
    }

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

        // GOWISER: the settlement writes job_orders.agent_paid_at/_to,
        // commission_value, incentive_value and agent_balance.commission_value,
        // all added by the 2026_08_14 agent migrations. Until those have been
        // run, settling would throw inside the approval transaction and block
        // EVERY approval of a referred job order — so it is skipped instead,
        // loudly, and the job order stays eligible (agent_paid_at NULL) for
        // when the schema catches up.
        if (!self::agentSettlementSchemaReady()) {
            \Log::error('Job Order Approval - agent settlement columns missing (run the 2026_08_14 agent migrations); approving without settling', [
                'job_order_id' => $jobOrder->getKey(),
            ]);

            return $skipped('settlement columns not migrated');
        }

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

        // GOWISER: a settlement failure must never fail or roll back the
        // approval itself (customer, billing account, user and RADIUS work are
        // all in the same transaction). settle() runs inside a nested
        // transaction — a SAVEPOINT on MySQL — so a throw rolls back only the
        // half-applied credit, and the approval carries on with the job order
        // left unsettled (agent_paid_at NULL) and eligible to be settled later.
        try {
            $outcome = DB::transaction(fn () => $service->settle($jobOrder, $actionBy));
        } catch (\Throwable $e) {
            \Log::error('Job Order Approval - agent settlement failed; approving without it', [
                'job_order_id' => $jobOrder->getKey(),
                'exception'    => get_class($e),
                'error'        => $e->getMessage(),
            ]);

            $failed = $skipped('settlement failed');
            $failed['referred_by'] = $referralText;

            return $failed;
        }

        // The referral text travels with the outcome either way, so the caller
        // can say WHY nothing settled rather than only that nothing did.
        $outcome['referred_by'] = $referralText;

        return $outcome;
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

            // Always create a dedicated Customer record for each approved onboarding/account
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
            
            // A VIP job order is approved exactly the way a postpaid one is: Active from day one,
            // with no prepaid pay-first handling at all. This flag switches off BOTH halves of
            // prepaid onboarding — the Inactive starting status here, and the initial billing plus
            // RADIUS restriction after the commit below — so a VIP customer who signed up under a
            // prepaid billing type is left in service instead of being restricted at approval.
            // Coalesced so a job order predating the vip_enabled column reads as an ordinary
            // approval instead of tripping on a missing attribute.
            $isVipApproval = (bool) ($jobOrder->vip_enabled ?? false);

            // Prepaid accounts start Inactive (pay-first): the customer must pay their initial
            // bill before service is granted. Setting the status inside the committed transaction
            // (rather than a post-commit flip) guarantees a prepaid account is durably Inactive the
            // instant approval commits — no window where a crash leaves it Active/unrestricted.
            $isPrepaidAccount = !$isVipApproval
                && \App\Models\BillingAccount::isPrepaidType($jobOrder->generation_type);

            /*
             * A VIP is created ON the VIP billing status, not on Active.
             *
             * VIP is a billing status in this system, not a flag beside one. Everything that has
             * to treat a comped account differently keys off that status and nothing else:
             *
             *   - EnhancedBillingGenerationServiceWithNotifications loads Active accounts only, so
             *     the VIP status is what stops invoices, statements and notifications being
             *     produced for an account that is never going to pay;
             *   - vip:check-expiration selects billing_status_id = VIP, so the status is also what
             *     makes vip_expiration mean anything — off it, the date is inert;
             *   - AutoDisconnectService sweeps Active accounts with an overdue balance, and
             *     radius:enforce-restricted excludes VIP by name.
             *
             * Creating the account Active therefore did not merely mislabel it. It put a comped
             * customer into the ordinary billing run, and the invoice nobody was ever going to pay
             * then aged into an overdue balance that auto-disconnect restricted — the VIP losing
             * service, a cycle after being granted it, through the front door.
             */
            $vipStatusId = $this->getVipBillingStatusId();
            $newAccountStatusId = match (true) {
                $isVipApproval => $vipStatusId,
                $isPrepaidAccount => (DB::table('billing_status')->where('status_name', 'Inactive')->value('id') ?? 4),
                default => 1,
            };

            if ($isVipApproval) {
                \Log::info('Job order approved as VIP — account created on the VIP billing status', [
                    'job_order_id' => $jobOrder->id,
                    'vip_expiration' => $jobOrder->vip_expiration,
                    'generation_type' => $jobOrder->generation_type,
                    'billing_status_id' => $newAccountStatusId,
                ]);
            }

            $billingAccount = BillingAccount::create([
                'customer_id' => $customer->id,
                'account_no' => $accountNumber,
                'date_installed' => $jobOrder->date_installed ?? now(),
                'plan_id' => $planId,
                'account_balance' => $installationFee,
                'balance_update_date' => now(),
                'billing_day' => $jobOrder->billing_day,
                'billing_status_id' => $newAccountStatusId,
                'generation_type' => $jobOrder->generation_type,
                'vat_type' => $jobOrder->vat_type,
                // Billing settings captured on the JO Assign Form are carried onto the account,
                // which is where the billing generation service reads them from. Coalesced so a
                // job order created before these columns existed lands as an explicit false
                // rather than NULL.
                'vat_enabled' => (bool) ($jobOrder->vat_enabled ?? false),
                'withholding_enabled' => (bool) ($jobOrder->withholding_enabled ?? false),
                'withholding_percentage' => $jobOrder->withholding_percentage,
                // When the comping ends. Live rather than decorative now that the account is
                // created on the VIP billing status: vip:check-expiration selects on that status
                // and restricts the account on this date, exactly as it does for a VIP set from
                // Customer Details.
                'vip_expiration' => $jobOrder->vip_enabled ? $jobOrder->vip_expiration : null,
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
                'pppoe_password' => $jobOrder->pppoe_password,
                // Carried across from the job order, falling back to restricted
                // rather than NULL. A job order created before the restricted-by-
                // default rule has no status to copy, and a blank here would read
                // as "no restriction" on the customer record — the one reading it
                // cannot tell an unset column from a live account. Only ever fills
                // an absent value; a job order already activated downstream keeps
                // whatever state it reached.
                'username_status' => $jobOrder->username_status
                    ?: JobOrder::USERNAME_STATUS_RESTRICTED,
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
                // Blank placeholder for every path, VIP included. The VIP move onto the plan group
                // happens after this transaction commits and can fail, so writing 'Online' here
                // would be a claim made before the thing it claims has been attempted — and a
                // stranded VIP would read as connected on every screen. It is written once the
                // reconnect actually succeeds; see the VIP block after the commit.
                //
                // Advisory either way: RadiusStatusSyncService owns this column and overwrites it
                // each pass from the RADIUS group plus live session — Online while a session is up,
                // Offline if the ONU is down.
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
            } else {
                // Create user with direct password hash assignment to avoid mutator
                $userData = [
                    'username' => $accountNumber,
                    'email_address' => $customer->email_address,
                    'first_name' => $customer->first_name,
                    'middle_initial' => $customer->middle_initial,
                    'last_name' => $customer->last_name,
                    'contact_number' => $customer->contact_number_primary,
                    'role_id' => $customerRoleId,
                    'status' => 'active',
                    'active' => 1,
                    'organization_id' => $organizationId,
                    'created_by_user_id' => $actionUserId,
                    'updated_by_user_id' => $actionUserId,
                ];
                
                // Directly insert into database to bypass mutator
                $userId = \DB::table('users')->insertGetId(array_merge($userData, [
                    'password_hash' => Hash::make($customer->contact_number_primary),
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


            // Prepaid onboarding: a prepaid customer must PAY before they get service. At approval
            // we (1) generate their initial bill immediately, and (2) start them Inactive +
            // RADIUS-restricted with NO prepaid period yet (prepaid_expires_at stays NULL). The
            // 30-day prepaid clock only starts once they pay (see PrepaidRenewalService, invoked
            // from the payment pipelines), at which point the existing payment reconnect flow
            // reactivates them. Postpaid customers are untouched — they stay Active as before.
            //
            // $isPrepaidAccount already excludes VIP approvals, so a comped customer gets neither
            // an initial bill nor a restriction no matter which billing type they signed up under.
            //
            // Best-effort by design: the approval transaction is already committed, so a billing
            // or RADIUS hiccup must never undo the approval. The generator's own per-cycle
            // idempotency guards mean re-running will not create duplicate invoices.
            if ($isPrepaidAccount) {
                try {
                    $billingAccount->load(['customer', 'technicalDetails']);
                    $initialBilling = app(\App\Services\EnhancedBillingGenerationServiceWithNotifications::class)
                        ->generateInitialBillingForAccount($billingAccount, $actionUserId);

                    \Log::info('Prepaid initial billing generated on approval', [
                        'job_order_id' => $id,
                        'account_no' => $accountNumber,
                        'result' => $initialBilling,
                    ]);
                } catch (\Throwable $billingEx) {
                    \Log::error('Prepaid initial billing generation failed on approval (approval itself still succeeded)', [
                        'job_order_id' => $id,
                        'account_no' => $accountNumber,
                        'error' => $billingEx->getMessage(),
                    ]);
                }

                // The account is already durably Inactive (set in the committed transaction above).
                // Best-effort RADIUS restriction on top: if the RADIUS user isn't provisioned yet
                // the call just reports an error we log — the customer is Inactive either way and
                // gets provisioned/reconnected on their first successful payment.
                try {
                    $radiusRestrict = app(\App\Services\ManualRadiusOperationsService::class)->restrictedUser([
                        'username' => $generatedUsername,
                        'accountNumber' => $accountNumber,
                        'remarks' => 'Prepaid Awaiting Initial Payment',
                        'updatedBy' => 'System',
                    ]);

                    \Log::info('Prepaid account RADIUS-restricted on approval (already Inactive in billing)', [
                        'job_order_id' => $id,
                        'account_no' => $accountNumber,
                        'radius_status' => $radiusRestrict['status'] ?? 'unknown',
                    ]);
                } catch (\Throwable $restrictEx) {
                    \Log::error('Prepaid approval RADIUS restriction failed (approval itself still succeeded)', [
                        'job_order_id' => $id,
                        'account_no' => $accountNumber,
                        'error' => $restrictEx->getMessage(),
                    ]);
                }
            }

            /*
             * VIP new install: put the customer into service.
             *
             * Skipping restrictedUser() above is NOT enough on its own. Every PPPoE account is
             * provisioned into the Restricted RADIUS group when the job order is marked Done
             * ({@see createRadiusAccountInternal()}, restricted-by-default), and the only thing
             * that has ever moved a user out of it is a payment landing. A VIP never pays, so
             * without this the account is created VIP with no bill and no restriction call — and
             * the customer still has no service, because their RADIUS user is sitting in the
             * Restricted group that nothing will ever move them out of.
             *
             * This is the one path that moves a VIP onto their plan group at approval, which is
             * what "VIP new installs are never restricted" actually requires.
             *
             * Best-effort, mirroring the prepaid block above: the approval is already committed,
             * so a RADIUS failure is queued for the ProcessRadiusQueue cron rather than being
             * allowed to undo the approval.
             */
            if ($isVipApproval) {
                /*
                 * Which plan names the target RADIUS group.
                 *
                 * The application is the usual source, but it is not the only one and it is not
                 * always filled: an approval that reuses an existing customer can carry the plan on
                 * the customer record instead, and $planId was already resolved against plan_list
                 * above. Reading only $application->desired_plan meant one blank column left a VIP
                 * sitting in the Restricted group with nothing but a log line — the exact outcome
                 * this whole block exists to prevent. Falling back costs one query and removes a
                 * class of stranded VIPs.
                 */
                $vipPlan = $application->desired_plan
                    ?: ($customer->desired_plan
                        ?: ($planId ? DB::table('plan_list')->where('id', $planId)->value('plan_name') : null));

                $vipReconnectParams = [
                    'accountNumber' => $accountNumber,
                    'username' => $generatedUsername,
                    'plan' => $vipPlan,
                    'updatedBy' => $actionUserEmail,
                    'remarks' => 'VIP New Install - Auto Reconnect',
                    // The approval transaction committed this account onto the VIP billing status
                    // deliberately; RADIUS must not be the thing that decides it. Without this,
                    // reconnectUser() writes Active — which would un-comp the account on the spot,
                    // putting it straight back into the billing run.
                    'preserveBillingStatus' => true,
                ];

                $vipReconnectError = null;

                if (empty($vipPlan)) {
                    // reconnectUser() names the target RADIUS group after the plan, so without one
                    // there is nothing to reconnect onto and no retry could ever succeed — logged
                    // rather than queued. The account is VIP in billing and needs a manual
                    // reconnect once a plan is on file.
                    \Log::error('VIP new install could not be reconnected — no plan on the application, the customer or plan_list', [
                        'job_order_id' => $id,
                        'account_no' => $accountNumber,
                        'username' => $generatedUsername,
                        'plan_id' => $planId,
                    ]);
                } else {
                    try {
                        $vipReconnect = app(\App\Services\ManualRadiusOperationsService::class)
                            ->reconnectUser($vipReconnectParams);

                        if (($vipReconnect['status'] ?? '') === 'success') {
                            \Log::info('VIP new install reconnected onto plan group at approval', [
                                'job_order_id' => $id,
                                'account_no' => $accountNumber,
                                'username' => $generatedUsername,
                                'plan' => $vipPlan,
                                'billing_status_id' => $newAccountStatusId,
                            ]);

                            $this->markVipInService($jobOrder, $technicalDetail, $billingAccount);
                        } else {
                            $vipReconnectError = $vipReconnect['message'] ?? 'RADIUS reconnect returned failure';
                        }
                    } catch (\Throwable $vipEx) {
                        $vipReconnectError = $vipEx->getMessage();
                    }
                }

                // Only a genuine RADIUS failure is worth retrying.
                if ($vipReconnectError !== null) {
                    \Log::error('VIP new install RADIUS reconnect failed (approval itself still succeeded)', [
                        'job_order_id' => $id,
                        'account_no' => $accountNumber,
                        'username' => $generatedUsername,
                        'error' => $vipReconnectError,
                    ]);

                    \Log::channel('radiusrelated')->error('[VIP APPROVAL RECONNECT FAILED - QUEUED] Account: ' . $accountNumber . ' - User: ' . $generatedUsername . ' - Error: ' . $vipReconnectError);

                    \App\Services\RadiusQueueService::queue([
                        'organization_id' => $organizationId,
                        'source_type'     => 'job_order_vip_approval',
                        'source_id'       => $jobOrder->id,
                        'account_no'      => $accountNumber,
                        'operation'       => 'reconnect_user',
                        'params'          => $vipReconnectParams,
                        'last_error'      => $vipReconnectError,
                        'created_by'      => $actionUserEmail,
                    ]);
                }
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
                        $emailBody = str_replace('{{company_name}}', 'GOWISER', $emailBody);
                        $emailBody = str_replace('{{fb_username}}', 'https://www.facebook.com/gowiserzc', $emailBody);
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
                    // Reported back so the approver can see on the spot which onboarding path ran,
                    // rather than having to open the customer to check whether a comped account
                    // was left in service.
                    'vip_enabled' => $isVipApproval,
                    'billing_status_id' => $newAccountStatusId,
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
                'signed_contract_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'setup_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'box_reading_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'router_reading_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'port_label_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'client_signature_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'client_tagging_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'speed_test_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'proof_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'house_front_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                ], 422);
            }

            $jobOrder = JobOrder::findOrFail($id);
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
            
            // The account is created into the Restricted group, NOT the customer's
            // plan group.
            //
            // This is the whole point of the restricted-by-default rule: putting a
            // brand new user straight into its plan group is what "early automatic
            // activation" means in practice — full plan bandwidth granted the
            // moment a technician saved a form, before a peso has been collected.
            // The user is provisioned so the credentials work and the session can
            // be seen, but it carries the restricted profile until the payment
            // pipelines move it. $plan is still resolved above and reported back in
            // the response, because the caller needs to know which plan the account
            // will be activated onto.
            //
            // Activation is downstream and explicit: ManualRadiusOperationsService
            // ::reconnectUser, called from PaymentWorkerService and
            // TransactionController once a payment lands, rewrites the group to the
            // plan. Nothing here should ever do it.
            $payload = [
                'name' => $pppoeUsername,
                'group' => JobOrder::USERNAME_STATUS_RESTRICTED,
                'password' => $pppoePassword
            ];

            // Try radius_config #1 up to 3 times; if it never succeeds, fall back to #2.
            $maxAttemptsPerConfig = 3;
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

                $radiusUrl = $radiusConfig->ssl_type . '://' . $radiusConfig->ip . ':' . $radiusConfig->port . '/rest/user-manage/user';
                $radiusUsername = $radiusConfig->username;
                $radiusPassword = $radiusConfig->password;

                \Log::channel('radiusrelated')->info('RADIUS server selected for JobOrder account creation', [
                    'job_order_id'     => $id,
                    'position'         => $position,
                    'radius_config_id' => $radiusConfig->id,
                    'radius_ip'        => $radiusConfig->ip,
                ]);

                for ($attempt = 1; $attempt <= $maxAttemptsPerConfig; $attempt++) {
                    try {
                        $response = Http::withOptions([
                            'verify' => false
                        ])
                        ->withBasicAuth($radiusUsername, $radiusPassword)
                        ->put($radiusUrl, $payload);

                        $statusCode = $response->status();

                        if ($statusCode === 204 || $response->successful()) {
                            $radiusSubmitted = true;
                            $radiusError = null;
                            break;
                        }

                        $radiusError = 'HTTP ' . $statusCode . ': ' . $response->body();
                        $lastFailureWasConnection = false;
                        \Log::channel('radiusrelated')->error('RADIUS API Error for JobOrder: ' . $id, [
                            'status' => $statusCode,
                            'response' => $response->body(),
                            'payload' => $payload,
                            'position' => $position,
                            'attempt' => $attempt,
                            'radius_config_id' => $radiusConfig->id,
                            'radius_ip' => $radiusConfig->ip,
                        ]);
                    } catch (\Exception $mikrotikException) {
                        $radiusError = $mikrotikException->getMessage();
                        $lastFailureWasConnection = true;
                        \Log::channel('radiusrelated')->error('RADIUS Connection Exception for JobOrder: ' . $id, [
                            'error' => $radiusError,
                            'trace' => $mikrotikException->getTraceAsString(),
                            'position' => $position,
                            'attempt' => $attempt,
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

            // Record the restriction on the job order itself, so the state is
            // visible without querying RADIUS and so approval carries it onto
            // technical_details (TechnicalDetail::create copies this column).
            //
            // Only when the account was actually provisioned in this call and the
            // job order has not since been activated: this method is re-runnable by
            // design — the Done form and the approval path can both reach it — and
            // it must never knock an account that a payment already activated back
            // into restriction.
            if ($radiusSubmitted && empty($jobOrder->username_status)) {
                $jobOrder->update([
                    'username_status' => JobOrder::USERNAME_STATUS_RESTRICTED,
                ]);

                \Log::channel('radiusrelated')->info('PPPoE account provisioned restricted', [
                    'job_order_id' => $id,
                    'username' => $pppoeUsername,
                    'radius_group' => JobOrder::USERNAME_STATUS_RESTRICTED,
                    'plan_when_activated' => $plan,
                ]);
            }

            return [
                'success' => true,
                'message' => $credentialsExist ? 'RADIUS credentials already exist' : 'RADIUS account created successfully',
                'data' => [
                    'job_order_id' => $id,
                    'username' => $pppoeUsername,
                    'password' => $pppoePassword,
                    // What the account is on now, and what it will be moved to when
                    // a payment activates it. Reported apart so the caller cannot
                    // read the plan as evidence the account is live.
                    'group' => JobOrder::USERNAME_STATUS_RESTRICTED,
                    'plan_when_activated' => $plan,
                    'username_status' => $jobOrder->username_status
                        ?: JobOrder::USERNAME_STATUS_RESTRICTED,
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
        $portalUrl = 'sync.xpacsconnect.ph';
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
