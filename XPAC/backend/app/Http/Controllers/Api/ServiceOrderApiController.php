<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;
use App\Models\BillingAccount;
use App\Services\PppoeUsernameService;
use App\Services\ManualRadiusOperationsService;
use App\Services\RadiusQueueService;
use App\Models\RadiusConfig;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Auth;
use App\Models\ActivityLog;
use App\Models\AuditTrailLog;
use App\Models\Role;
use App\Models\ServiceOrder;
use App\Support\CustomerScope;

class ServiceOrderApiController extends Controller
{
    /**
     * `service_orders.service_charge_status`: whether this order's service
     * charge has reached the customer's account balance.
     *
     * 'pending' — nothing posted. 'added' — the charge is on the balance, and
     * must not be posted again however many times the ticket is saved.
     */
    private const CHARGE_PENDING = 'pending';
    private const CHARGE_ADDED   = 'added';

    /**
     * How a reactivation is spelled, in `concern` and in `repair_category`.
     *
     * Support files it as a concern, the technician picks it as a repair
     * category, and the two fields disagree about the word — the category list
     * says "Reactivate" while older rows and the migration branch say
     * "Reactivation". Both spellings are read everywhere, from one list, so a
     * reactivation is never missed because of which field it was filed in or
     * which word was used.
     */
    private const REACTIVATE_CATEGORIES = ['reactivate', 'reactivation'];

    /**
     * The technical_details columns a PPPoE username is built out of.
     *
     * PppoeUsernameService encodes the LCP, the NAP and the port into the name,
     * so a change to any one of them is what makes the stored username describe
     * a line the customer is no longer on. Nothing else on the record has that
     * property, which is why the reactivation re-sync watches these three and
     * not the whole row.
     */
    private const LINE_IDENTITY_COLUMNS = ['lcp', 'nap', 'port'];

    /**
     * The online_status readings that mean the RADIUS account is not cut off.
     *
     * RadiusStatusSyncService writes one of Online, Offline, Restricted,
     * Disconnected or Not Found. Only the first two say the account sits in a
     * normal plan group: "Offline" is a customer whose router is unplugged, not
     * a customer who has been cut off, and reconnecting them would achieve
     * nothing except dropping whatever session they do have.
     *
     * Restricted and Disconnected are the opposite — the account is in a cut-off
     * group and a reactivation has to move it back whatever billing says.
     */
    private const RADIUS_CONNECTED_STATUSES = ['online', 'offline'];

    /**
     * How old an online_status reading may be and still be trusted to SKIP a
     * reconnection.
     *
     * The sync runs every minute but works in batches of a few hundred accounts,
     * so on a large base a given account's row is refreshed every several
     * minutes rather than every minute. Fifteen leaves room for that without
     * trusting a reading from an hour ago.
     *
     * Only the skip direction is gated on this. Acting on a stale "Restricted"
     * costs a redundant reconnection; acting on a stale "Online" would leave a
     * customer cut off after a reactivation that reported success, which is the
     * failure worth being asymmetric about.
     */
    private const RADIUS_STATUS_TRUSTED_FOR_MINUTES = 15;

    /**
     * What `users.status` reads for a live portal account.
     *
     * Lowercase, matching the value JobOrderController writes when it creates a
     * customer's login. `active` is the column the sign-in actually gates on;
     * this one is the human-readable state beside it, and the two are written
     * together so a row can never say "active" while being locked out.
     */
    private const PORTAL_STATUS_ACTIVE = 'active';

    /** True when at least one failed RADIUS operation was successfully queued for retry. */
    private bool $radiusQueued = false;

    /** True when a RADIUS operation failed AND the fallback queue insert also failed. */
    private bool $radiusQueueFailed = false;

    /** Tracks step-by-step RADIUS operation progress for frontend loading feedback. */
    private array $radiusSteps = [];

    /**
     * Queue a failed RADIUS operation and track whether the insert succeeded.
     * Wraps RadiusQueueService::queue so the controller can tell the client the
     * operation was safely queued (or, in the rare case the insert fails too, warn).
     */
    private function trackRadiusQueue(array $data): ?int
    {
        $id = RadiusQueueService::queue($data);

        if ($id) {
            $this->radiusQueued = true;
        } else {
            $this->radiusQueueFailed = true;
            Log::channel('radiusrelated')->error('[SERVICE ORDER] RADIUS operation failed AND queue insert failed', [
                'operation'  => $data['operation'] ?? null,
                'account_no' => $data['account_no'] ?? null,
            ]);
        }

        return $id;
    }

    public function index(Request $request): JsonResponse
    {
        try {
            $page = $request->input('page', 1);
            $limit = $request->input('limit', 50); // Default 50 for faster response
            $search = $request->input('search', '');
            // Fast mode variable kept for compatibility but new logic is inherently faster
            $fastMode = $request->input('fast', false);

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            // Base query on service_orders
            $query = DB::table('service_orders as so')
                ->select('so.*', 'so.id as ticket_id');

            // A customer has no organization_id, which would otherwise send them
            // down the super-admin branch and hand them the whole table. Pin them
            // to their own account before any request filter is applied — the
            // account_no filter below is client-supplied and cannot be trusted to
            // do this job.
            $customerAccountNo = CustomerScope::accountNo('service-order');

            if ($customerAccountNo !== null) {
                $isSuperAdmin = false;
                $query->where('so.account_no', $customerAccountNo);
            }
            elseif (!$isSuperAdmin && $organizationId) {
                $query->where('so.organization_id', $organizationId);
            }

            $query->orderBy('so.timestamp', 'desc');

            // Apply filters
            if ($request->has('assigned_email')) {
                $query->where('so.assigned_email', $request->input('assigned_email'));

                // Exclude records where support_status is Resolved or Failed — technician should not see these
                $query->whereRaw("LOWER(so.support_status) NOT IN ('resolved', 'failed')");

                // Technician specific filtering rules based on user request:
                // 1. visit status in progress or reschedule -> no date filtering
                // 2. visit status done or failed -> only 1 day
                $query->where(function ($q) {
                    $q->whereIn(DB::raw('LOWER(so.visit_status)'), ['in progress', 'in-progress', 'reschedule', 'scheduled', 'for visit'])
                      ->orWhere(function ($q2) {
                          $q2->whereIn(DB::raw('LOWER(so.visit_status)'), ['done', 'completed', 'failed'])
                             ->whereRaw("DATE(COALESCE(so.updated_at, so.end_time, so.created_at)) >= DATE(DATE_SUB(NOW(), INTERVAL 1 DAY))");
                      })
                      ->orWhereNull('so.visit_status');
                });
            }

            if ($request->has('account_no')) {
                $query->where('so.account_no', 'LIKE', "%" . $request->input('account_no') . "%");
            }

            if ($request->has('support_status')) {
                $query->where('so.support_status', $request->input('support_status'));
            }

            if ($request->has('has_charge')) {
                $query->where('so.service_charge', '>', 0);
            }

            if ($request->has('updated_since')) {
                $query->where('so.updated_at', '>', $request->input('updated_since'));
                // When fetching only updates, we typically want everything since the last sync
                // instead of paged chunks, if limit isn't explicitly set low.
                $limit = $request->input('limit', 1000);
            }

            $userRole = strtolower($request->query('user_role', ''));
            $userEmail = $request->query('user_email', '');

            if ($userRole === 'agent' && $userEmail) {
                $user = DB::table('users')->where('email_address', $userEmail)->first();
                if ($user) {
                    $agentName = trim($user->first_name . ' ' . ($user->middle_initial ? $user->middle_initial . ' ' : '') . $user->last_name);

                    // A referral made through the agent picker is stored as the
                    // agent's user id, which holds none of their name — matched
                    // alongside the name so both forms reach the same agent.
                    $tagged = \App\Support\AgentReferral::encode($user->id ?? null);

                    $query->where(function ($q) use ($agentName, $tagged) {
                        $q->where('so.referred_by', 'LIKE', '%' . $agentName . '%');
                        if ($tagged !== null) {
                            $q->orWhere('so.referred_by', $tagged);
                        }
                    });

                    \Log::info('Filtering service orders for agent role using referred_by column', [
                        'agent_name' => $agentName,
                        'agent_email' => $userEmail
                    ]);
                }
            }

            // Handle Search
            if ($search) {
                // Only join when strictly necessary for search
                $query->leftJoin('billing_accounts as ba', 'so.account_no', '=', 'ba.account_no')
                    ->leftJoin('customers as c', 'ba.customer_id', '=', 'c.id');

                $query->where(function ($q) use ($search) {
                    $q->where('so.account_no', 'LIKE', "%{$search}%")
                        ->orWhere('so.id', 'LIKE', "%{$search}%")
                        ->orWhere('c.first_name', 'LIKE', "%{$search}%")
                        ->orWhere('c.last_name', 'LIKE', "%{$search}%");
                });
            }

            // Get total count of filtered records before pagination
            $totalCount = $query->count();

            // Fetch one extra record to check if there are more pages
            $serviceOrders = $query->skip(($page - 1) * $limit)
                ->take($limit)
                ->get();

            // Check if there are more pages
            $hasMore = ($page * $limit) < $totalCount;

            // Extract Account Numbers for eager loading
            $accountNos = $serviceOrders->pluck('account_no')->filter()->unique()->values();

            // Eager load related data efficiently
            if ($accountNos->isNotEmpty()) {
                $billingAccounts = \App\Models\BillingAccount::with('customer')
                    ->whereIn('account_no', $accountNos)
                    ->get()
                    ->keyBy('account_no');

                $technicalDetails = \App\Models\TechnicalDetail::whereIn('account_no', $accountNos)
                    ->get()
                    ->keyBy('account_no');
            }
            else {
                $billingAccounts = collect();
                $technicalDetails = collect();
            }

            // Map related data to service orders
            // Resolve every referral on the page in one query rather than one
            // per row: a referral made through the agent picker holds the
            // agent's user id, and every screen shows their name.
            \App\Support\AgentReferral::prime($serviceOrders->pluck('referred_by'));

            $mappedOrders = $serviceOrders->map(function ($so) use ($billingAccounts, $technicalDetails) {
                $ba = $billingAccounts->get($so->account_no);
                $c = $ba ? $ba->customer : null;
                $td = $technicalDetails->get($so->account_no);

                // Shown as a name, with the id beside it so an edit form writes
                // the same referral back rather than turning it into a name.
                $so->referred_by_agent_id = \App\Support\AgentReferral::agentIdIfAgent($so->referred_by);
                $so->referred_by = \App\Support\AgentReferral::displayName($so->referred_by);

                // Manually populate fields that were previously joined
                $so->account_id = $ba ? $ba->id : null;
                $so->date_installed = $ba ? $ba->date_installed : null;

                // Customer details
                $so->full_name = $c ? trim(($c->first_name ?? '') . ' ' . ($c->middle_initial ?? '') . ' ' . ($c->last_name ?? '')) : null;
                $so->contact_number = $c ? $c->contact_number_primary : null;
                $so->full_address = $c ? trim(($c->address ?? '') . ', ' . ($c->barangay ?? '') . ', ' . ($c->city ?? '') . ', ' . ($c->region ?? '')) : null;
                $so->contact_address = $c ? $c->address : null;
                // Address parts returned separately so the Relocation concern can edit them individually
                $so->barangay = $c ? $c->barangay : null;
                $so->city = $c ? $c->city : null;
                $so->region = $c ? $c->region : null;
                $so->email_address = $c ? $c->email_address : null;
                $so->house_front_picture_url = $c ? $c->house_front_picture_url : null;
                $so->plan = $c ? $c->desired_plan : null;

                // Technical details
                $so->username = $td ? $td->username : null;
                $so->connection_type = $td ? $td->connection_type : null;
                $so->router_modem_sn = $td ? $td->router_modem_sn : null;
                $so->lcp = $td ? $td->lcp : null;
                $so->nap = $td ? $td->nap : null;
                $so->port = $td ? $td->port : null;
                $so->vlan = $td ? $td->vlan : null;
                $so->technicians = isset($so->technicians) ? json_decode($so->technicians) : null;

                return $so;
            });

            return response()->json([
                'success' => true,
                'data' => $mappedOrders->values(),
                'pagination' => [
                    'current_page' => (int)$page,
                    'per_page' => (int)$limit,
                    'has_more' => $hasMore,
                    'count' => $mappedOrders->count(),
                    'total_count' => $totalCount
                ]
            ]);
        }
        catch (\Exception $e) {
            Log::error('Error fetching service orders: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch service orders',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            Log::info('Service order creation request', ['data' => $request->all()]);

            $validated = $request->validate([
                'account_no' => 'required|string|max:255',
                'timestamp' => 'nullable|date',
                'support_status' => 'nullable|string|max:100',
                'concern' => 'required|string|max:255',
                'concern_remarks' => 'nullable|string',
                'priority_level' => 'nullable|string|max:50',
                'requested_by' => 'nullable|string|max:255',
                'assigned_email' => 'nullable|string|max:255',
                'visit_status' => 'nullable|string|max:100',
                'visit_by_user' => 'nullable|string|max:255',
                'visit_with' => 'nullable|string|max:255',
                'visit_remarks' => 'nullable|string',
                'repair_category' => 'nullable|string|max:255',
                'support_remarks' => 'nullable|string',
                'service_charge' => 'nullable|numeric',
                'new_router_modem_sn' => 'nullable|string|max:255',
                'new_lcpnap' => 'nullable|string|max:255',
                'new_plan' => 'nullable|string|max:255',
                'status' => 'nullable|string|max:50',
                'start_time' => 'nullable|date',
                'end_time' => 'nullable|date',
                'created_by_user' => 'nullable|string|max:255',
                'updated_by_user' => 'nullable|string|max:255',
                'proof_image_url' => 'nullable|string|max:255',
                'image4' => 'sometimes|nullable|string|max:255'
            ]);

            // Rate limit and cooldown logic has been removed as per request to allow unlimited ticket submissions.

            $ticketId = $this->generateTicketId();
            Log::info('Generated ticket_id: ' . $ticketId);

            $timestamp = null;
            if (isset($validated['timestamp'])) {
                try {
                    $timestamp = \Carbon\Carbon::parse($validated['timestamp'], 'Asia/Manila')->format('Y-m-d H:i:s');
                }
                catch (\Exception $e) {
                    Log::warning('Invalid timestamp format, using current time', ['timestamp' => $validated['timestamp']]);
                    $timestamp = now('Asia/Manila')->format('Y-m-d H:i:s');
                }

            }
            else {
                $timestamp = now('Asia/Manila')->format('Y-m-d H:i:s');
            }

            // A customer may only file under their own account, whatever the
            // payload says.
            $customerAccountNo = CustomerScope::accountNo('service-order');
            $accountNo = $customerAccountNo ?? $validated['account_no'];

            $data = [
                'ticket_id' => $ticketId,
                'account_no' => $accountNo,
                'timestamp' => $timestamp,
                'support_status' => $validated['support_status'] ?? 'In Progress',
                'concern' => $validated['concern'],
                'concern_remarks' => $validated['concern_remarks'] ?? null,
                'priority_level' => $validated['priority_level'] ?? 'Medium',
                'requested_by' => $validated['requested_by'] ?? null,
                'assigned_email' => $validated['assigned_email'] ?? null,
                'visit_status' => $validated['visit_status'] ?? null,
                'visit_by_user' => $validated['visit_by_user'] ?? null,
                'visit_with' => $validated['visit_with'] ?? null,
                'visit_remarks' => $validated['visit_remarks'] ?? null,
                'repair_category' => $validated['repair_category'] ?? null,
                'support_remarks' => $validated['support_remarks'] ?? null,
                'service_charge' => $validated['service_charge'] ?? null,
                'new_router_modem_sn' => $validated['new_router_modem_sn'] ?? null,
                'new_lcpnap' => $validated['new_lcpnap'] ?? null,
                'new_plan' => $validated['new_plan'] ?? null,
                'status' => $validated['status'] ?? 'unused',
                'start_time' => $validated['start_time'] ?? null,
                'end_time' => $validated['end_time'] ?? null,
                'created_by_user' => $validated['created_by_user'] ?? null,
                'updated_by_user' => $validated['updated_by_user'] ?? null,
                'proof_image_url' => $request->input('proof_image_url'),
                'image4' => $request->input('image4') ?? ($validated['image4'] ?? null),
                'organization_id' => auth()->user() ? auth()->user()->organization_id : null,
                'created_at' => now(),
                'updated_at' => now()
            ];

            Log::info('Insert data: ', $data);

            $id = DB::table('service_orders')->insertGetId($data);

            $serviceOrder = DB::table('service_orders')->where('id', $id)->first();

            Log::info('Service order created successfully', [
                'id' => $id,
                'ticket_id' => $ticketId,
                'inserted_data' => (array)$serviceOrder
            ]);

            // Trigger Reconnection if concern is 'Reconnect'
            $currentConcern = trim($request->input('concern'));
            $supportStatus = strtolower(trim($request->input('support_status') ?? ''));

            \Log::info('Reconnection check (store) debug:', [
                'current_concern' => $currentConcern,
                'request_support_status' => $supportStatus
            ]);

            $reconnectStatus = null;
            if ($currentConcern && strtolower($currentConcern) === 'reconnect' && $supportStatus === 'resolved') {
                $billingAccount = BillingAccount::where('account_no', $accountNo)->first();
                if ($billingAccount) {
                    Log::info('Triggering auto-reconnect for NEW Service Order with Reconnect concern', [
                        'account_no' => $accountNo
                    ]);
                    $serviceOrderUpdatedByUser = $request->input('updated_by_user') ?: ($request->input('updated_by') ?: (Auth::user()->name ?? 'System'));
                    $reconnectStatus = $this->attemptReconnection($billingAccount, $id, $serviceOrderUpdatedByUser);
                }
            }

            if (!empty($data['assigned_email'])) {
                try {
                    $pushService = app(\App\Services\PushNotificationService::class);
                    $pushService->sendToUserByEmail(
                        $data['assigned_email'],
                        'New Service Order Assigned',
                        "You have been assigned to Service Order #{$ticketId}.",
                        [],
                        'SO'
                    );
                } catch (\Exception $pushEx) {
                    Log::error('Failed to send push notification on ServiceOrder store: ' . $pushEx->getMessage());
                }
            }

            return response()->json([
                'success' => true,
                'message' => 'Service order created successfully',
                'data' => $serviceOrder,
                'reconnect_status' => $reconnectStatus,
                'radius_queued' => $this->radiusQueued,
                'radius_queue_failed' => $this->radiusQueueFailed
            ], 201);
        }
        catch (\Illuminate\Validation\ValidationException $e) {
            Log::error('Validation error creating service order', [
                'errors' => $e->errors(),
                'input' => $request->all()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        }
        catch (\Exception $e) {
            Log::error('Error creating service order', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to create service order',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    private function generateTicketId(): string
    {
        $currentYear = date('Y');

        $lastTicket = DB::selectOne(
            "SELECT ticket_id FROM service_orders WHERE ticket_id LIKE ? ORDER BY ticket_id DESC LIMIT 1",
        [$currentYear . '%']
        );

        if ($lastTicket && $lastTicket->ticket_id) {
            $lastNumber = (int)substr($lastTicket->ticket_id, 4);
            $newNumber = $lastNumber + 1;
        }
        else {
            $newNumber = 1;
        }

        $ticketId = $currentYear . str_pad($newNumber, 6, '0', STR_PAD_LEFT);

        Log::info('Generated ticket ID: ' . $ticketId);

        return $ticketId;
    }

    public function show($id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $query = DB::table('service_orders as so')
                ->leftJoin('billing_accounts as ba', 'so.account_no', '=', 'ba.account_no')
                ->leftJoin('customers as c', 'ba.customer_id', '=', 'c.id')
                ->leftJoin('technical_details as td', 'so.account_no', '=', 'td.account_no')
                ->select(
                    'so.*',
                    'so.id as ticket_id',
                    'ba.id as account_id',
                    'ba.date_installed',
                    DB::raw("CONCAT(IFNULL(c.first_name, ''), ' ', IFNULL(c.middle_initial, ''), ' ', IFNULL(c.last_name, '')) as full_name"),
                    'c.contact_number_primary as contact_number',
                    DB::raw("CONCAT(IFNULL(c.address, ''), ', ', IFNULL(c.barangay, ''), ', ', IFNULL(c.city, ''), ', ', IFNULL(c.region, '')) as full_address"),
                    'c.address as contact_address',
                    // Address parts selected separately so the Relocation concern can edit them individually
                    'c.barangay',
                    'c.city',
                    'c.region',
                    'c.email_address',
                    'c.house_front_picture_url',
                    'c.desired_plan as plan',
                    'td.username',
                    'td.connection_type',
                    'td.router_modem_sn',
                    'td.lcp',
                    'td.nap',
                    'td.port',
                    'td.vlan'
                )
                ->where('so.id', $id);

            if (!$isSuperAdmin && $organizationId) {
                $query->where('so.organization_id', $organizationId);
            }

            $serviceOrder = $query->first();

            if (!$serviceOrder) {
                return response()->json([
                    'success' => false,
                    'message' => 'Service order not found or unauthorized access'
                ], 404);
            }

            if (!$serviceOrder) {
                return response()->json([
                    'success' => false,
                    'message' => 'Service order not found'
                ], 404);
            }

            if ($serviceOrder) {
                $serviceOrder->technicians = isset($serviceOrder->technicians) ? json_decode($serviceOrder->technicians) : null;

                // Shown as a name, with the id beside it so an edit form writes
                // the same referral back rather than turning it into a name.
                $serviceOrder->referred_by_agent_id = \App\Support\AgentReferral::agentIdIfAgent($serviceOrder->referred_by);
                $serviceOrder->referred_by = \App\Support\AgentReferral::displayName($serviceOrder->referred_by);
            }

            return response()->json([
                'success' => true,
                'data' => $serviceOrder
            ]);
        }
        catch (\Exception $e) {
            Log::error('Error fetching service order details: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch service order',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id): JsonResponse
    {
        try {
            Log::info('Service order update request', [
                'id' => $id,
                'data' => $request->all()
            ]);

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $serviceOrder = DB::table('service_orders')->where('id', $id)->first();

            if (!$serviceOrder) {
                return response()->json([
                    'success' => false,
                    'message' => 'Service order not found'
                ], 404);
            }

            if (!$isSuperAdmin && $organizationId && $serviceOrder->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to service order'
                ], 403);
            }

            // A technician works their queue from the top. Enforced here as well
            // as in the UI so the lock cannot be stepped over by calling the API
            // directly with another service order's id.
            if ($this->isServiceOrderLockedForTechnician($serviceOrder, $this->resolveActingUser($request))) {
                Log::warning('Service order update blocked: locked for technician', [
                    'id' => $id,
                    'user_email' => optional($this->resolveActingUser($request))->email,
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'This job order is locked. Finish the job order at the top of your list first, or ask an administrator to enable this one.',
                ], 403);
            }

            $updatedByUser = $request->input('updated_by_user') ?: ($request->input('updated_by') ?: (Auth::user()->name ?? 'System'));

            $accountRef = $serviceOrder->account_no;
            // Fetch old records for change logging
            $oldCustomer = DB::selectOne("SELECT * FROM customers WHERE account_no = ?", [$accountRef]);
            $oldBilling = DB::selectOne("SELECT * FROM billing_accounts WHERE account_no = ?", [$accountRef]);
            $oldTechnical = DB::selectOne("SELECT * FROM technical_details WHERE account_no = ?", [$accountRef]);

            // `service_charge_status` is deliberately absent: it is the server's
            // record of whether this order's charge has reached a balance, and a
            // client that could set it could reset it to 'pending' — which is
            // precisely how the same charge gets posted to a customer twice.
            $allowedFields = [
                'account_no',
                'timestamp',
                'support_status',
                'concern',
                'concern_remarks',
                'priority_level',
                'requested_by',
                'assigned_email',
                'visit_status',
                'visit_by_user',
                'visit_with',
                'visit_with_other',
                'visit_remarks',
                'repair_category',
                'support_remarks',
                'service_charge',
                'new_router_modem_sn',
                'new_lcp',
                'new_nap',
                'new_port',
                'new_vlan',
                'router_model',
                'old_lcp',
                'old_nap',
                'old_port',
                'old_vlan',
                'old_router_modem_sn',
                'old_lcpnap',
                'old_plan',
                'new_lcpnap',
                'new_plan',
                'client_signature_url',
                'image1_url',
                'image2_url',
                'image3_url',
                'image4',
                'proof_image_url',
                'status',
                'start_time',
                'end_time',
                'technicians',
                'updated_by_user',
                'speedtest_image_url',
                'setup_image_url',
                'box_reading_image_url',
                'router_reading_image_url'
            ];

            $data = [];
            foreach ($allowedFields as $field) {
                if ($request->has($field)) {
                    $value = $request->input($field);
                    if ($field === 'technicians' && is_array($value)) {
                        $value = json_encode($value);
                    }
                    $data[$field] = $value;
                }
            }

            // The day a technician moved the visit status.
            //
            // Derived here rather than read from the request: it is a claim
            // about who acted and on what day, and neither the acting role nor
            // the device's clock is the client's to assert. `visit_status_date`
            // is deliberately absent from $allowedFields above, so a request
            // naming it is ignored rather than trusted.
            //
            // Written only when the status actually moves. Re-saving a ticket
            // without touching the dropdown — which both clients do on every
            // save, since visit_status is sent whenever the ticket is For Visit
            // — leaves the original date standing.
            if (array_key_exists('visit_status', $data)
                && $this->isTechnician($this->resolveActingUser($request))
                && $this->visitStatusChanged($serviceOrder->visit_status ?? null, $data['visit_status'])
            ) {
                $data['visit_status_date'] = now()->toDateString();

                Log::info('Visit status moved by a technician', [
                    'id' => $id,
                    'from' => $serviceOrder->visit_status ?? null,
                    'to' => $data['visit_status'],
                    'visit_status_date' => $data['visit_status_date'],
                ]);
            }

            $data['updated_at'] = now();

            Log::info('Filtered data for update', ['data' => $data]);

            // Handle technical details update if new values are provided
            $hasNewTechnicalDetails =
                $request->filled('new_lcp') ||
                $request->filled('new_nap') ||
                $request->filled('new_lcpnap') ||
                $request->filled('new_port') ||
                $request->filled('new_vlan') ||
                $request->filled('new_router_modem_sn');

            // Captured where the swap is detected, applied only after the writes
            // below have landed: SmartOLT is an external HTTP API and must never be
            // called with a database write still in flight.
            $smartOltSync = null;

            if ($hasNewTechnicalDetails) {
                Log::info('New technical details detected, updating technical_details table');

                // Get current technical details
                $technicalDetails = DB::table('technical_details')
                    ->where('account_no', $serviceOrder->account_no)
                    ->first();

                if ($technicalDetails) {
                    // Store old values in service_orders
                    $data['old_lcp'] = $technicalDetails->lcp;
                    $data['old_nap'] = $technicalDetails->nap;
                    $data['old_port'] = $technicalDetails->port;
                    $data['old_vlan'] = $technicalDetails->vlan;
                    $data['old_router_modem_sn'] = $technicalDetails->router_modem_sn;
                    $data['old_lcpnap'] = $technicalDetails->lcpnap;

                    // Prepare updates for technical_details
                    $newLcp = $request->input('new_lcp');
                    $newNap = $request->input('new_nap');

                    if ($request->filled('new_lcpnap')) {
                        $lcpnapValue = $request->input('new_lcpnap');
                        $parts = explode(' - ', $lcpnapValue);
                        if (count($parts) === 2) {
                            $newLcp = $parts[0];
                            $newNap = $parts[1];
                        }
                        else {
                            $parts = explode('-', $lcpnapValue);
                            if (count($parts) === 2) {
                                $newLcp = $parts[0];
                                $newNap = $parts[1];
                            }
                        }
                    }

                    if (!$newLcp)
                        $newLcp = $technicalDetails->lcp;
                    if (!$newNap)
                        $newNap = $technicalDetails->nap;

                    $repairCategory = $request->input('repair_category') ?: ($serviceOrder->repair_category ?? '');
                    $isMigration = in_array(strtolower(trim($repairCategory)), ['migrate', 'reactivation']);

                    $newPort = $request->filled('new_port') ? $request->input('new_port') : $technicalDetails->port;
                    $newVlan = $request->filled('new_vlan') ? $request->input('new_vlan') : $technicalDetails->vlan;
                    $newSN = $request->filled('new_router_modem_sn') ? $request->input('new_router_modem_sn') : $technicalDetails->router_modem_sn;

                    // Calculate LCPNAP (LCP + NAP)
                    $newLcpNap = trim(($newLcp ?? '') . ' ' . ($newNap ?? ''), ' ');

                    // Add new values to $data for service_orders
                    $data['new_lcp'] = $newLcp;
                    $data['new_nap'] = $newNap;
                    $data['new_port'] = $newPort;
                    $data['new_vlan'] = $newVlan;
                    $data['new_router_modem_sn'] = $newSN;
                    $data['new_lcpnap'] = $newLcpNap;

                    // Prepare update array for technical_details.
                    //
                    // router_modem_sn is deliberately NOT written here. The serial
                    // only becomes the account's active router once the visit is
                    // Done — see the deferred write further down, which lands it at
                    // the same moment SmartOLT is told about the swap so the two
                    // never disagree about which router is live.
                    //
                    // Holding it back also keeps old_router_modem_sn above honest:
                    // it is read straight off technical_details, so writing the new
                    // serial now would make a re-save record the new router as the
                    // one that came out.
                    $techUpdateData = [
                        'lcp' => $newLcp,
                        'nap' => $newNap,
                        'port' => $newPort,
                        'vlan' => $newVlan,
                        'lcpnap' => $newLcpNap,
                        'updated_at' => now(),
                        'updated_by' => $updatedByUser
                    ];

                    // If it's a migration, ensure connection_type is set to Fiber
                    if ($isMigration) {
                        $techUpdateData['connection_type'] = 'Fiber';
                    }

                    // Update technical_details table
                    DB::table('technical_details')
                        ->where('account_no', $serviceOrder->account_no)
                        ->update($techUpdateData);

                    // Also update job_orders table to keep lcpnap/port/vlan in sync
                    $billingAccountForJobOrder = DB::table('billing_accounts')
                        ->where('account_no', $serviceOrder->account_no)
                        ->first();

                    if ($billingAccountForJobOrder) {
                        $jobOrderSyncData = array_filter([
                            'lcpnap' => $newLcpNap ?: null,
                            'port' => $newPort ?: null,
                            'vlan' => $newVlan ?: null,
                            'updated_at' => now(),
                        ], fn($v) => !is_null($v));

                        $joAffected = DB::table('job_orders')
                            ->where('account_id', $billingAccountForJobOrder->id)
                            ->update($jobOrderSyncData);

                        Log::info('[API SERVICE ORDER] Synced job_orders lcpnap/port/vlan for account_id ' . $billingAccountForJobOrder->id, [
                            'rows_affected' => $joAffected,
                            'lcpnap' => $newLcpNap,
                            'port' => $newPort,
                            'vlan' => $newVlan,
                        ]);
                    }

                    // A replaced router is the SN actually changing. Comparing the
                    // stored SN against the new one is what keeps a re-saved order
                    // from unbinding an ONU that is already correctly assigned.
                    $smartOltSync = [
                        'old_sn' => trim((string) $technicalDetails->router_modem_sn),
                        'new_sn' => trim((string) $newSN),
                    ];
                }
            }

            // Handle plan update if provided
            if ($request->filled('new_plan')) {
                $billingAccount = DB::table('billing_accounts')
                    ->where('account_no', $serviceOrder->account_no)
                    ->first();

                if ($billingAccount) {
                    $oldPlan = DB::table('customers')
                        ->where('id', $billingAccount->customer_id)
                        ->value('desired_plan');

                    $data['old_plan'] = $oldPlan;

                    DB::table('customers')
                        ->where('id', $billingAccount->customer_id)
                        ->update([
                        'desired_plan' => $request->input('new_plan'),
                        'updated_at' => now()
                    ]);
                    Log::info('Updated customer desired_plan to ' . $request->input('new_plan'), [
                        'account_no' => $serviceOrder->account_no,
                        'customer_id' => $billingAccount->customer_id
                    ]);
                }
            }

            // Relocation address fields (customers table). Optional: only the fields actually
            // sent are written, so an untouched field is never overwritten. Restricted to
            // Administrator (role 1) and SuperAdmin (role 7) so a technician cannot change a
            // customer address by posting these directly. The unauthenticated fallback matches
            // the $isSuperAdmin convention above (these routes carry no auth middleware).
            // Old/new values are captured by the customers diff logged at the end of update().
            $canEditCustomerAddress = !$authUser || in_array((int) $roleId, [1, 7], true);
            $addressFields = ['address', 'barangay', 'city', 'region'];

            if ($canEditCustomerAddress) {
                $addressUpdate = [];
                foreach ($addressFields as $addressField) {
                    if ($request->has($addressField)) {
                        $addressUpdate[$addressField] = $request->input($addressField);
                    }
                }

                if (!empty($addressUpdate)) {
                    $addressUpdate['updated_at'] = now();
                    DB::table('customers')
                        ->where('account_no', $serviceOrder->account_no)
                        ->update($addressUpdate);

                    Log::info('Updated customer address from service order', [
                        'account_no' => $serviceOrder->account_no,
                        'fields' => array_keys($addressUpdate)
                    ]);
                }
            } elseif (count(array_intersect($addressFields, array_keys($request->all()))) > 0) {
                Log::warning('Blocked customer address update from service order: role not permitted', [
                    'account_no' => $serviceOrder->account_no,
                    'role_id' => $roleId
                ]);
            }

            // ── Service charge → account balance ───────────────────────────────
            // The charge is posted once the ticket is finished (support Resolved,
            // or the visit marked Done). It is keyed to the service order rather
            // than to the moment the status flips, so a charge entered — or
            // corrected — on a ticket that is *already* Resolved still reaches the
            // balance.
            //
            // A ticket finishes twice, though: the technician marks the visit
            // Done, and support marks it Resolved. Both mean "bill this job", so
            // both reach here, and the charge must land once across the two.
            //
            // Two things stop it landing twice, because they fail in different
            // ways. `service_charge_logs` records every amount posted for this
            // order, so a later save applies only the difference — that handles
            // the saves arriving one after the other, and handles a charge
            // corrected after the fact. It does not handle the two saves
            // overlapping: both read the same empty ledger and both conclude the
            // whole charge is owing. `service_charge_status` handles that one —
            // the first posting has to win a conditional UPDATE off 'pending'
            // before it may touch the balance, and only one request can.
            $effectiveSupportStatus = strtolower(trim((string) ($request->has('support_status')
                ? $request->input('support_status')
                : ($serviceOrder->support_status ?? ''))));
            $effectiveVisitStatus = strtolower(trim((string) ($request->has('visit_status')
                ? $request->input('visit_status')
                : ($serviceOrder->visit_status ?? ''))));

            $chargeIsDue = $effectiveSupportStatus === 'resolved'
                || in_array($effectiveVisitStatus, ['done', 'completed'], true);

            $serviceChargeTotal = round(floatval($request->has('service_charge')
                ? $request->input('service_charge')
                : ($serviceOrder->service_charge ?? 0)), 2);

            if ($chargeIsDue) {
                $alreadyAdded = strtolower(trim((string) ($serviceOrder->service_charge_status ?? '')))
                    === self::CHARGE_ADDED;

                $chargeLogs = DB::table('service_charge_logs')
                    ->where('service_order_id', $serviceOrder->id)
                    ->get();

                // What has already been posted for this order. Charges applied
                // before they were logged left only status = 'used' behind — and,
                // on a ticket the backfill marked, only service_charge_status —
                // so for those the stored charge stands in as the amount already
                // posted. Without that, an old ticket's first save under this
                // code would read an empty ledger and post its charge again.
                if ($chargeLogs->isNotEmpty()) {
                    $postedSoFar = round((float) $chargeLogs->sum('service_charge'), 2);
                } elseif ($alreadyAdded || strtolower(trim((string) ($serviceOrder->status ?? ''))) === 'used') {
                    $postedSoFar = round(floatval($serviceOrder->service_charge ?? 0), 2);
                } else {
                    $postedSoFar = 0.0;
                }

                $chargeDelta = round($serviceChargeTotal - $postedSoFar, 2);

                // The first posting has to claim the order before it may move the
                // balance. Two saves racing — the visit marked Done and the ticket
                // marked Resolved, arriving together — both get this far with the
                // same delta; only one wins the UPDATE, and the other stops here.
                //
                // A correction on an order already marked 'added' skips the claim:
                // there is nothing left to win, and the ledger delta above is what
                // keeps it honest.
                if (abs($chargeDelta) >= 0.01 && !$alreadyAdded && !$this->claimServiceCharge($serviceOrder->id)) {
                    Log::info('Service charge already posted by a concurrent save; skipping', [
                        'service_order_id' => $serviceOrder->id,
                        'account_no'       => $serviceOrder->account_no,
                        'charge'           => $serviceChargeTotal,
                    ]);

                    $chargeDelta = 0.0;
                }

                if (abs($chargeDelta) >= 0.01) {
                    $billingAccount = DB::table('billing_accounts')
                        ->where('account_no', $serviceOrder->account_no)
                        ->first();

                    if ($billingAccount) {
                        $currentBalance = floatval($billingAccount->account_balance);
                        $newBalance = round($currentBalance + $chargeDelta, 2);

                        DB::table('billing_accounts')
                            ->where('account_no', $serviceOrder->account_no)
                            ->update([
                            'account_balance' => $newBalance,
                            'balance_update_date' => now(),
                            'updated_at' => now()
                        ]);

                        // Logged as already applied ('Used'): the balance was moved
                        // here, so billing generation — which bills 'Unused' rows —
                        // must not charge it a second time. The row is also what the
                        // next save reads back to work out the delta.
                        DB::table('service_charge_logs')->insert([
                            'organization_id'     => $serviceOrder->organization_id ?? null,
                            'account_no'          => $serviceOrder->account_no,
                            'service_order_id'    => $serviceOrder->id,
                            'service_charge'      => $chargeDelta,
                            'service_charge_type' => 'Service Order Charge',
                            'status'              => 'Used',
                            'date_used'           => now(),
                            'remarks'             => "Posted to account balance from service order #{$serviceOrder->id}",
                            'created_by'          => $updatedByUser,
                            'updated_by'          => $updatedByUser,
                            'created_at'          => now(),
                            'updated_at'          => now(),
                        ]);

                        try {
                            event(new \App\Events\CustomerUpdated([
                                'account_no' => $serviceOrder->account_no,
                                'type' => 'customer_updated',
                                'edit_type' => 'billing_details',
                                'title' => 'Customer Updated',
                                'message' => "Customer balance updated for account {$serviceOrder->account_no}",
                                'timestamp' => now()->timestamp,
                                'formatted_date' => now()->format('Y-m-d h:i:s A')
                            ]));
                        } catch (\Exception $e) {
                            Log::warning('Failed to broadcast customer update via Soketi from ServiceOrderApiController', [
                                'account_no' => $serviceOrder->account_no,
                                'error' => $e->getMessage()
                            ]);
                        }

                        $data['status'] = $serviceChargeTotal > 0 ? 'used' : 'unused';

                        // A charge corrected back down to nothing has been taken
                        // off the balance again, so the order is owed a posting
                        // once more if a charge is entered later. Written through
                        // $data, which is applied below, so it takes effect after
                        // the claim rather than fighting it.
                        $data['service_charge_status'] = $serviceChargeTotal > 0
                            ? self::CHARGE_ADDED
                            : self::CHARGE_PENDING;

                        Log::info("Updated account balance from {$currentBalance} to {$newBalance} (service order #{$serviceOrder->id} charge: {$serviceChargeTotal}, already posted: {$postedSoFar}, applied now: {$chargeDelta}).");
                    }
                    else {
                        // The claim was taken above but nothing reached a balance,
                        // because there is no billing account to reach. Give it
                        // back: left at 'added' the order would be treated as paid
                        // for ever after and the charge would never be posted.
                        $data['service_charge_status'] = self::CHARGE_PENDING;

                        Log::warning('Billing account not found for account_no: ' . $serviceOrder->account_no);
                    }
                }
            }

            // ── Technician availability guard ─────────────────────────────────
            // Keep start_time/end_time consistent so a technician is never left
            // flagged as "busy" on a job that has effectively ended.
            //   • Reassigning the order (assigned_email changed) resets both timers
            //     — the new technician starts fresh.
            //   • Once a STARTED job leaves the "In Progress" state (support_status
            //     Failed, or any visit_status other than In Progress) it must carry
            //     an end_time.
            // start_time/end_time are stored as Asia/Manila wall-clock to match the
            // mobile timer, so we stamp Manila time here — bare now() is UTC here.
            $assignedEmailChanged = array_key_exists('assigned_email', $data)
                && (string) $data['assigned_email'] !== (string) ($serviceOrder->assigned_email ?? '');

            if ($assignedEmailChanged) {
                $data['start_time'] = null;
                $data['end_time']   = null;
            } else {
                $effectiveSupport = strtolower(trim((string) ($request->has('support_status')
                    ? $request->input('support_status')
                    : ($serviceOrder->support_status ?? ''))));
                $effectiveVisit = strtolower(trim((string) ($request->has('visit_status')
                    ? $request->input('visit_status')
                    : ($serviceOrder->visit_status ?? ''))));

                $visitInProgress = in_array($effectiveVisit, ['in progress', 'in-progress', 'inprogress'], true);
                $leftInProgress  = ($effectiveSupport === 'failed')
                    || ($effectiveVisit !== '' && !$visitInProgress);

                $startTimePresent = array_key_exists('start_time', $data)
                    ? !empty($data['start_time'])
                    : !empty($serviceOrder->start_time);
                // A payload that mentions end_time (a real timestamp OR an explicit
                // null to (re)open the timer, as the mobile start/restart does) is
                // authoritative — never override it.
                $callerManagesEndTime = array_key_exists('end_time', $data);

                if ($leftInProgress && $startTimePresent && !$callerManagesEndTime && empty($serviceOrder->end_time)) {
                    $data['end_time'] = \Carbon\Carbon::now('Asia/Manila')->format('Y-m-d H:i:s');
                }
            }
            // ──────────────────────────────────────────────────────────────────

            DB::table('service_orders')->where('id', $id)->update($data);

            // The SmartOLT handover used to fire here, on any save that carried a new
            // SN. It now waits until the ticket says the replacement visit is
            // finished — see the "Replace Router" block further down, next to the
            // pullout and migration triggers it belongs with.

            if (isset($data['assigned_email']) && $data['assigned_email'] !== ($serviceOrder->assigned_email ?? null)) {
                try {
                    $pushService = app(\App\Services\PushNotificationService::class);
                    $pushService->sendToUserByEmail(
                        $data['assigned_email'],
                        'Service Order Assignment Updated',
                        "You have been assigned to Service Order #{$serviceOrder->ticket_id}.",
                        [],
                        'SO'
                    );
                } catch (\Exception $pushEx) {
                    Log::error('Failed to send push notification on ServiceOrder update: ' . $pushEx->getMessage());
                }
            }

            // --- START CHANGE LOGGING ---
            try {
                $newServiceOrder = DB::table('service_orders')->where('id', $id)->first();
                // Resolve billing account for logging (may be null for orphaned service orders)
                $billingAccountForLog = DB::table('billing_accounts')->where('account_no', $serviceOrder->account_no)->first();

                if ($newServiceOrder) {
                    $changedOld = [];
                    $changedNew = [];

                    // We only log fields that were actually in the request and changed
                    foreach ($data as $key => $newValue) {
                        if ($key === 'updated_at') continue;

                        $oldValue = $serviceOrder->$key ?? null;

                        // Compare values (handling potential type differences)
                        if ((string)$oldValue !== (string)$newValue) {
                            $changedOld[$key] = $oldValue;
                            $changedNew[$key] = $newValue;
                        }
                    }

                    if (!empty($changedOld) || !empty($changedNew)) {
                        $logUserId = null;
                        if ($authUser) {
                            $logUserId = $authUser->id;
                        } else {
                            // Fallback: try to find user by email/name if provided in updated_by_user
                            $user = DB::table('users')
                                ->where('email_address', $updatedByUser)
                                ->orWhere('username', $updatedByUser)
                                ->first();
                            if ($user) $logUserId = $user->id;
                        }

                        DB::table('details_update_logs')->insert([
                            'account_id'          => $billingAccountForLog->id ?? null,
                            'old_details'         => json_encode(['type' => 'service_order_details', 'service_order_id' => $id, 'account_no' => $serviceOrder->account_no, 'data' => $changedOld]),
                            'new_details'         => json_encode(['type' => 'service_order_details', 'service_order_id' => $id, 'account_no' => $serviceOrder->account_no, 'data' => $changedNew]),
                            'created_at'          => now(),
                            'created_by_user_id'  => $logUserId,
                            'updated_at'          => now(),
                            'updated_by_user_id'  => $logUserId,
                        ]);
                    }
                }
            } catch (\Exception $logEx) {
                Log::warning('Failed to log service order changes: ' . $logEx->getMessage());
            }
            // --- END CHANGE LOGGING ---

            $updatedByUser = $request->input('updated_by_user') ?: ($request->input('updated_by') ?: (Auth::user()->name ?? 'System'));

            // Trigger Reconnection if concern is 'Reconnect'
            $currentConcern = trim($request->input('concern'));
            if (!$currentConcern && isset($serviceOrder->concern)) {
                $currentConcern = trim($serviceOrder->concern);
            }

            $supportStatus = strtolower(trim($request->input('support_status') ?? ''));
            if (empty($supportStatus) && isset($serviceOrder->support_status)) {
                $supportStatus = strtolower(trim($serviceOrder->support_status));
            }

            \Log::info('Reconnection check debug:', [
                'current_concern' => $currentConcern,
                'request_support_status' => $supportStatus
            ]);

            // Check if triggers were already executed in the original service order
            $originalConcern = trim($serviceOrder->concern ?? '');
            $originalSupportStatus = strtolower(trim($serviceOrder->support_status ?? ''));
            $originalVisitStatus = strtolower(trim($serviceOrder->visit_status ?? ''));
            $originalRepairCategory = strtolower(trim($serviceOrder->repair_category ?? ''));

            $isAlreadyResolvedReconnect = (($originalConcern === 'Reconnect' || $originalConcern === 'Upgrade/Downgrade Plan') && $originalSupportStatus === 'resolved');
            $isAlreadyResolvedRestrict = (($originalConcern === 'Restrict' || $originalConcern === 'Disconnect') && $originalSupportStatus === 'resolved');
            // Mirrors the trigger below, by asking the same object the same
            // question against the row as it was BEFORE this write. Its job is to
            // stop a re-save of a finished pullout from running it a second time,
            // so it has to agree with the trigger or it will suppress a pullout
            // that has not happened yet.
            $isAlreadyPulloutDone = \App\Support\PulloutCategory::deactivatesPortalLogin(
                $originalRepairCategory,
                $originalVisitStatus
            );
            $isAlreadyMigrationDone = (in_array($originalRepairCategory, ['migrate', 'relocate', 'relocate router', 'transfer lcp/nap/port']) && $originalVisitStatus === 'done');
            // Was the ONU handover already earned before this write? If so this save
            // is a re-save of a finished replacement and must not run it again.
            $isAlreadyReplaceRouterDone = ($originalRepairCategory === \App\Services\SmartOltService::REPLACE_ROUTER_CATEGORY
                && $originalVisitStatus === \App\Services\SmartOltService::VISIT_STATUS_DONE);

            $reconnectStatus = null;
            $normalizedConcern = $currentConcern ? strtolower(trim($currentConcern)) : '';
            if ($normalizedConcern && ($normalizedConcern === 'reconnect' || $normalizedConcern === 'upgrade/downgrade plan') && $supportStatus === 'resolved' && !$isAlreadyResolvedReconnect) {
                $billingAccount = BillingAccount::where('account_no', $serviceOrder->account_no)->first();
                if ($billingAccount) {
                    \Log::info("Triggering auto-reconnect for Service Order with {$currentConcern} concern", [
                        'account_no' => $serviceOrder->account_no
                    ]);
                    $reconnectStatus = $this->attemptReconnection($billingAccount, $id, $updatedByUser, $organizationId);

                    if ($reconnectStatus === 'success' && $normalizedConcern === 'upgrade/downgrade plan') {
                        try {
                            $oldPlanString = $data['old_plan'] ?? $serviceOrder->old_plan ?? null;
                            $newPlanString = $data['new_plan'] ?? $serviceOrder->new_plan ?? null;

                            $oldPlanName = trim(explode(' - ', (string)$oldPlanString)[0] ?: (string)$oldPlanString);
                            $newPlanName = trim(explode(' - ', (string)$newPlanString)[0] ?: (string)$newPlanString);

                            $oldPlanId = DB::table('plan_list')->where('plan_name', 'LIKE', $oldPlanName)->value('id');
                            $newPlanId = DB::table('plan_list')->where('plan_name', 'LIKE', $newPlanName)->value('id');

                            \App\Models\PlanChangeLog::create([
                                'account_id' => $billingAccount->id,
                                'old_plan_id' => $oldPlanId,
                                'new_plan_id' => $newPlanId,
                                'status' => 'success',
                                'date_changed' => now(),
                                'date_used' => now(),
                                'remarks' => $data['concern_remarks'] ?? $serviceOrder->concern_remarks ?? 'Upgraded/Downgraded via Service Order',
                                'created_by_user' => $updatedByUser,
                                'updated_by_user' => $updatedByUser,
                            ]);
                            \Log::info("PlanChangeLog created successfully for account {$billingAccount->account_no}");
                        }
                        catch (\Exception $e) {
                            \Log::error("Failed to create PlanChangeLog: " . $e->getMessage());
                        }
                    }
                }
            }



            // Trigger Reactivation if concern is 'Reactivate' — set the account back to Active
            // and re-apply the customer's plan in RADIUS (reuses the reconnection routine).
            $reactivateStatus = null;
            // Compared case-insensitively — the old `=== 'Reactivate'` check missed
            // any other casing. 'reactivation' is accepted too because the
            // repair-category lookup spells it that way and the two get mixed up.
            $reactivateConcerns = self::REACTIVATE_CATEGORIES;

            // Read from the repair category as well as the concern.
            //
            // A reactivation gets recorded in either field depending on who files
            // it — support sets the concern, the technician picks the repair
            // category — and the pullout trigger further down already reads
            // repair_category for exactly that reason. Matching only `concern`
            // here meant a resolved Reactivation ticket could leave the account
            // pulled out with no way back, because this branch is the ONLY place
            // in the codebase that sets users.active to 1.
            $reactivateRepairCategory = strtolower(trim($request->input('repair_category') ?? ''));
            if ($reactivateRepairCategory === '' && isset($serviceOrder->repair_category)) {
                $reactivateRepairCategory = strtolower(trim($serviceOrder->repair_category));
            }

            $isReactivateRequest = in_array($normalizedConcern, $reactivateConcerns, true)
                || in_array($reactivateRepairCategory, $reactivateConcerns, true);

            $isAlreadyResolvedReactivate = (
                    in_array(strtolower(trim($originalConcern)), $reactivateConcerns, true)
                    || in_array(strtolower(trim($originalRepairCategory)), $reactivateConcerns, true)
                )
                && $originalSupportStatus === 'resolved';

            if ($isReactivateRequest && $supportStatus === 'resolved') {
                // Forced, and deliberately outside the billing check below.
                // Gating this on "billing is not already Active" is exactly what
                // kept users.active at 0: four other paths restore
                // billing_status_id without touching the portal login, so by the
                // time the reactivation ticket was resolved the account usually
                // looked Active already and the write was skipped. Re-running it
                // is harmless and repairs any account left stuck that way.
                try {
                    // Both columns, together. `active` is what the sign-in checks;
                    // `status` is the state shown beside the account and is what a
                    // new portal login is created holding. Writing only the first
                    // left a reactivated customer able to sign in while every
                    // screen still described them as inactive.
                    $activated = \App\Models\User::where('username', $serviceOrder->account_no)
                        ->update([
                            'active' => 1,
                            'status' => self::PORTAL_STATUS_ACTIVE,
                        ]);

                    if ($activated === 0) {
                        // Not the same as success: no portal login exists for this
                        // account number. The previous version logged success either way.
                        \Log::warning('[REACTIVATE] No users row with username = account_no; nothing to activate.', [
                            'account_no' => $serviceOrder->account_no
                        ]);
                    } else {
                        \Log::info('[REACTIVATE] users.active set to 1 and users.status set to active', [
                            'account_no' => $serviceOrder->account_no,
                            'rows' => $activated
                        ]);
                    }
                } catch (\Exception $e) {
                    \Log::error('[REACTIVATE] Failed to activate the portal login: ' . $e->getMessage(), [
                        'account_no' => $serviceOrder->account_no
                    ]);
                }

                // Reconnect, unless the line is already up.
                //
                // "Already up" used to mean billing_status_id == 1 and nothing
                // else, which was wrong in both directions. An account can carry
                // Active billing while its RADIUS account still sits in the
                // Restricted or Disconnected group — several paths set the
                // billing column without touching RADIUS — and that reactivation
                // reported success while leaving the customer cut off. The
                // reverse costs less but is still churn: an account already in
                // its plan group gets its session dropped and re-applied for
                // nothing.
                //
                // So RADIUS is asked first and billing is the fallback for when
                // there is no usable reading. See radiusSaysConnected().
                if (!$isAlreadyResolvedReactivate) {
                    $billingAccount = BillingAccount::where('account_no', $serviceOrder->account_no)->first();

                    if (!$billingAccount) {
                        $reactivateStatus = 'no_account';
                        \Log::warning('[REACTIVATE] No billing account; reconnection skipped', [
                            'account_no' => $serviceOrder->account_no,
                        ]);
                    } else {
                        $radiusConnected = $this->radiusSaysConnected($serviceOrder->account_no);
                        $billingActive = (int) $billingAccount->billing_status_id === 1;

                        // A reading beats the billing column either way; billing
                        // only decides when RADIUS has nothing fresh to say.
                        $alreadyUp = $radiusConnected ?? $billingActive;

                        if ($alreadyUp) {
                            $reactivateStatus = $radiusConnected === true ? 'already_online' : 'already_active';
                            \Log::info('[REACTIVATE] Account is already connected; RADIUS step skipped', [
                                'account_no'                => $serviceOrder->account_no,
                                'radius_says_connected'     => $radiusConnected,
                                'billing_status_id'         => $billingAccount->billing_status_id,
                            ]);
                        } else {
                            \Log::info('Triggering reactivation for Service Order with Reactivate concern', [
                                'account_no' => $serviceOrder->account_no,
                                'current_billing_status_id' => $billingAccount->billing_status_id,
                                'radius_says_connected' => $radiusConnected,
                            ]);
                            // attemptReconnection sets billing_status_id to 1 (Active) and re-applies the plan in RADIUS
                            $reactivateStatus = $this->attemptReconnection($billingAccount, $id, $updatedByUser, $organizationId);
                        }
                    }
                }
            }

            // Trigger Restriction/Disconnection based on concern and support status
            $restrictedStatus = null;
            if ($currentConcern && $supportStatus === 'resolved' && !$isAlreadyResolvedRestrict) {
                $lowerConcern = strtolower($currentConcern);
                if ($lowerConcern === 'restrict' || $lowerConcern === 'disconnect') {
                    $billingAccount = BillingAccount::where('account_no', $serviceOrder->account_no)->first();
                    if ($billingAccount) {
                        \Log::info("Triggering auto-restriction for Service Order with {$currentConcern} concern", [
                            'account_no' => $serviceOrder->account_no
                        ]);
                        $restrictedStatus = $this->attemptRestriction($billingAccount, $updatedByUser, $organizationId);
                    }
                }
            }



            // Trigger Pullout if repair category is 'Pullout' and visit status is 'Done'
            $pulloutStatus = null;

            $visitStatus = strtolower(trim($request->input('visit_status') ?? ''));
            if (empty($visitStatus) && isset($serviceOrder->visit_status)) {
                $visitStatus = strtolower(trim($serviceOrder->visit_status));
            }

            $repairCategory = strtolower(trim($request->input('repair_category') ?? ''));
            if (empty($repairCategory) && isset($serviceOrder->repair_category)) {
                $repairCategory = strtolower(trim($serviceOrder->repair_category));
            }


            // The pullout itself is decided on what the ticket says AFTER this
            // request's write, not on $request and not on the pre-update copy above.
            //
            // This is the write that disables the customer's portal login, so the
            // request-or-stored fallbacks are too loose for it in both directions:
            //   • a request that only sets the category to Pullout would inherit a
            //     'Done' left behind by an earlier, unrelated visit, and disable the
            //     login without any pullout visit having been completed;
            //   • a request that merely claims visit_status=Done would be trusted
            //     even if that value never reached the row.
            // Reading the row back closes both: no completed pullout visit on the
            // record, no deactivation.
            $pulloutRow = DB::table('service_orders')->where('id', $id)->first();
            $pulloutVisitStatus = strtolower(trim((string) ($pulloutRow->visit_status ?? '')));
            $pulloutRepairCategory = strtolower(trim((string) ($pulloutRow->repair_category ?? '')));

            // The REPAIR CATEGORY decides this, and nothing else. Every spelling
            // of it — "Pullout", "Pull Out", "for pullout" — is one instruction;
            // see App\Support\PulloutCategory, which holds the whole rule.
            //
            // Consequence worth knowing: AutoDisconnectService::createPulloutRequest
            // raises its tickets with concern = 'for pullout' and no category, so
            // closing one of those disables the login only if the technician picks
            // Pullout as the Repair Category. The modal requires a category when
            // the visit is Done and Pullout is in the list, so it is available —
            // but it is a choice now rather than an inference.
            $isPulloutVisitDone = \App\Support\PulloutCategory::deactivatesPortalLogin(
                $pulloutRepairCategory,
                $pulloutVisitStatus
            );

            if ($isPulloutVisitDone && !$isAlreadyPulloutDone) {
                $billingAccount = BillingAccount::where('account_no', $serviceOrder->account_no)->first();
                if ($billingAccount) {
                    \Log::info('Triggering auto-pullout for Service Order with Pullout repair category', [
                        'account_no' => $serviceOrder->account_no
                    ]);
                    $pulloutStatus = $this->attemptPullout($billingAccount, $updatedByUser, $organizationId, (int) ($pulloutRow->id ?? $id));
                }
            }

            // The new serial becomes the account's active router only now, once the
            // ticket says the visit is Done. Held back from the technical_details
            // write earlier in this method so a repair still in progress does not
            // move the customer onto a router that has not been installed yet.
            //
            // Read from the stored row, not the request: the serial may have been
            // entered on an earlier save and the visit completed by a later one that
            // carries no SN at all.
            \App\Support\ReplacementRouterSn::applyIfVisitDone($pulloutRow, $updatedByUser, '[API SERVICE ORDER REPLACE ROUTER]');

            // Trigger the SmartOLT router handover when repair category is
            // 'Replace Router' AND visit status is 'Done'.
            //
            // Decided on $pulloutRow — the ticket as stored AFTER this request's
            // write — for the same reason the pullout above is: neither the request
            // body nor the pre-update copy can be trusted to say the visit is
            // finished. A replacement still in progress therefore never reaches
            // SmartOLT, however the payload is spelled.
            //
            // Best-effort by design: a SmartOLT outage must never fail a visit the
            // technician already saved, so the service logs every outcome to the
            // smartoltrelated channel and returns rather than throwing.
            $replaceRouterStatus = app(\App\Services\SmartOltService::class)
                ->syncOnuForCompletedRouterReplacement(
                    $pulloutRow,
                    $isAlreadyReplaceRouterDone,
                    $smartOltSync,
                    '[API SERVICE ORDER REPLACE ROUTER]'
                );

            // Trigger Migration if repair category is 'Migrate', 'Relocate', or 'Transfer LCP/NAP/PORT' and visit status is 'Done'
            $migrationStatus = null;
            $relocateCategories = ['migrate', 'relocate', 'relocate router', 'transfer lcp/nap/port'];
            if (in_array($repairCategory, $relocateCategories) && $visitStatus === 'done' && !$isAlreadyMigrationDone) {
                $billingAccount = BillingAccount::where('account_no', $serviceOrder->account_no)->first();
                if ($billingAccount) {
                    \Log::info('Triggering auto-migration for Service Order', [
                        'account_no' => $serviceOrder->account_no
                    ]);
                    $migrationStatus = $this->attemptMigration($billingAccount, $repairCategory, $updatedByUser, $organizationId);

                    // Update job_orders table with new LCPNAP, port, and vlan for relocation categories
                    $newLcpnap = $request->input('new_lcpnap');
                    $newPort = $request->input('new_port');
                    $newVlan = $request->input('new_vlan');

                    if ($newLcpnap || $newPort || $newVlan) {
                        $jobOrderUpdateData = array_filter([
                            'lcpnap' => $newLcpnap ?: null,
                            'port' => $newPort ?: null,
                            'vlan' => $newVlan ?: null,
                            'updated_at' => now(),
                        ], fn($v) => !is_null($v));

                        $affected = DB::table('job_orders')
                            ->where('account_id', $billingAccount->id)
                            ->update($jobOrderUpdateData);

                        \Log::info('[API SERVICE ORDER RELOCATE] Updated job_orders for account_id ' . $billingAccount->id, [
                            'rows_affected' => $affected,
                            'new_lcpnap' => $newLcpnap,
                            'new_port' => $newPort,
                            'new_vlan' => $newVlan,
                        ]);
                    }
                }
            }

            // Re-point a reactivated account's RADIUS account at the line it came
            // back on.
            //
            // A reactivation is not a relocation, so it is not in the list above
            // and must not be: most reactivations put the customer back on the
            // port they left on, and renaming their PPPoE account for that would
            // churn a working credential for nothing. But some come back on a
            // different LCP, NAP or port, and those three are exactly what
            // PppoeUsernameService encodes into the username — so when one of
            // them moves, the stored credential starts describing a line the
            // customer is no longer on, and RADIUS has to be told.
            //
            // The change is read off the row rather than off the request: the
            // technical_details write further up has already landed by here, so
            // comparing it against the copy taken before the write answers "did
            // this save move the line" for any route into it, and cannot be
            // claimed by a client that did not actually change anything.
            //
            // No `already done` guard, unlike the migration trigger beside it.
            // This one is self-limiting — a re-save of an unchanged ticket
            // produces no diff and does nothing — and adding one would block the
            // legitimate case of a second move on a ticket that is already Done.
            $reactivateRadiusStatus = null;

            if (in_array($repairCategory, self::REACTIVATE_CATEGORIES, true) && $visitStatus === 'done') {
                $technicalAfterUpdate = DB::selectOne(
                    "SELECT * FROM technical_details WHERE account_no = ?",
                    [$accountRef]
                );

                $movedColumns = $this->changedLineIdentity($oldTechnical, $technicalAfterUpdate);

                if (empty($movedColumns)) {
                    $reactivateRadiusStatus = 'no_change';
                    \Log::info('[API SERVICE ORDER REACTIVATE RADIUS SKIP] LCP/NAP/Port unchanged', [
                        'account_no' => $serviceOrder->account_no,
                    ]);
                } else {
                    $billingAccount = BillingAccount::where('account_no', $serviceOrder->account_no)->first();

                    if (!$billingAccount) {
                        $reactivateRadiusStatus = 'no_account';
                        \Log::warning('[API SERVICE ORDER REACTIVATE RADIUS SKIP] No billing account', [
                            'account_no' => $serviceOrder->account_no,
                        ]);
                    } else {
                        \Log::info('[API SERVICE ORDER REACTIVATE RADIUS] Line moved, re-syncing RADIUS', [
                            'account_no' => $serviceOrder->account_no,
                            'changed'    => $movedColumns,
                        ]);

                        $reactivateRadiusStatus = $this->attemptReactivationRadiusSync(
                            $billingAccount,
                            $id,
                            $updatedByUser,
                            $organizationId
                        );
                    }
                }
            }

            $updatedServiceOrder = DB::table('service_orders')->where('id', $id)->first();

            // Compare and log changes to customers, billing_accounts, and technical_details
            $newCustomer = DB::selectOne("SELECT * FROM customers WHERE account_no = ?", [$accountRef]);
            $newBilling = DB::selectOne("SELECT * FROM billing_accounts WHERE account_no = ?", [$accountRef]);
            $newTechnical = DB::selectOne("SELECT * FROM technical_details WHERE account_no = ?", [$accountRef]);

            $oldDataToLog = [];
            $newDataToLog = [];

            $tablesToCompare = [
                ['name' => 'customers', 'old' => $oldCustomer, 'new' => $newCustomer],
                ['name' => 'billing_accounts', 'old' => $oldBilling, 'new' => $newBilling],
                ['name' => 'technical_details', 'old' => $oldTechnical, 'new' => $newTechnical],
            ];

            foreach ($tablesToCompare as $table) {
                if ($table['old'] && $table['new']) {
                    foreach ((array)$table['old'] as $key => $oldVal) {
                        // Skip internal and timestamp fields
                        if (in_array($key, ['id', 'created_at', 'updated_at', 'balance_update_date'])) continue;
                        
                        $newVal = $table['new']->$key ?? null;
                        if ($oldVal != $newVal) {
                            $oldDataToLog[$table['name']][$key] = $oldVal;
                            $newDataToLog[$table['name']][$key] = $newVal;
                        }
                    }
                }
            }

            if (!empty($oldDataToLog)) {
                $currentUserId = Auth::id() ?? null;
                // Resolve account_id from billing account for this log entry
                $logAccountId = $oldBilling->id ?? ($newBilling->id ?? null);
                DB::table('details_update_logs')->insert([
                    'account_id'         => $logAccountId,
                    'old_details'        => json_encode(['type' => 'service_order_related_tables', 'service_order_id' => $id, 'account_no' => $accountRef, 'data' => $oldDataToLog]),
                    'new_details'        => json_encode(['type' => 'service_order_related_tables', 'service_order_id' => $id, 'account_no' => $accountRef, 'data' => $newDataToLog]),
                    'created_at'         => now(),
                    'updated_at'         => now(),
                    'created_by_user_id' => $currentUserId,
                    'updated_by_user_id' => $currentUserId,
                ]);
                Log::info("Logged details update (API) for account_no: {$accountRef}");
            }

            return response()->json([
                'success' => true,
                'message' => 'Service order updated successfully',
                'data' => $updatedServiceOrder,
                'reconnect_status' => $reconnectStatus,
                'reactivate_status' => $reactivateStatus,
                // The RADIUS rename a reactivation onto a different LCP/NAP/port
                // triggers. Separate from reactivate_status, which is the billing
                // and portal side: one can succeed while the other is queued, and
                // the technician needs to be told which.
                'reactivate_radius_status' => $reactivateRadiusStatus,
                'restricted_status' => $restrictedStatus,
                'pullout_status' => $pulloutStatus,
                'migration_status' => $migrationStatus,
                'radius_queued' => $this->radiusQueued,
                'radius_queue_failed' => $this->radiusQueueFailed,
                'radius_steps' => $this->radiusSteps
            ]);
        }
        catch (\Exception $e) {
            Log::error('Failed to update service order', [
                'id' => $id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            $errorMessage = $e->getMessage();

            // Precise mapping for technicians
            if (str_contains($errorMessage, 'Failed to connect to RADIUS server') || 
                str_contains($errorMessage, 'Connection refused') || 
                str_contains($errorMessage, 'cURL error 7')) {
                return response()->json([
                    'success' => false,
                    'message' => 'Radius Offline',
                    'error' => $errorMessage
                ], 400);
            }

            if (str_contains($errorMessage, 'HTTP 400') && (str_contains($errorMessage, 'already exists') || str_contains($errorMessage, 'Duplicate') || str_contains($errorMessage, 'exists'))) {
                return response()->json([
                    'success' => false,
                    'message' => 'Radius Duplicate',
                    'error' => $errorMessage
                ], 400);
            }

            if (str_contains($errorMessage, 'Duplicate entry') && str_contains($errorMessage, 'technical_details')) {
                return response()->json([
                    'success' => false,
                    'message' => 'it has a duplicate on onboarded customer',
                    'error' => $errorMessage
                ], 409);
            }

            return response()->json([
                'success' => false,
                'message' => 'Failed to update service order',
                'error' => $errorMessage
            ], 500);
        }
    }

    /**
     * Record a details_update_logs entry when a blocked technician reassignment is attempted.
     *
     * Fired by the front-end Service Order Edit modal when an admin tries to reassign the
     * technician after the job has already been started (start_time is set).
     */
    public function logBlockedTransfer(Request $request, $id): JsonResponse
    {
        try {
            $performedBy = $request->input('performed_by')
                ?? optional($request->user())->email_address
                ?? optional($request->user())->email
                ?? 'System';

            $originalTechName = $request->input('original_technician_name');
            $newTechName      = $request->input('new_technician_name');
            $startTime        = $request->input('start_time');

            // Resolve account context for the log entry
            $serviceOrder = DB::table('service_orders')->where('id', $id)->first();
            $accountNo = $serviceOrder->account_no ?? $request->input('account_no');
            $billingAccount = $accountNo
                ? DB::table('billing_accounts')->where('account_no', $accountNo)->first()
                : null;

            $logUserId = optional($request->user())->id;
            if (!$logUserId && $performedBy) {
                $user = DB::table('users')
                    ->where('email_address', $performedBy)
                    ->orWhere('username', $performedBy)
                    ->first();
                if ($user) $logUserId = $user->id;
            }

            $description = $request->input('description')
                ?? "Save blocked — Technician reassignment attempted on Service Order #{$id} by {$performedBy}. "
                 . "The original technician " . ($originalTechName ?: 'Unknown')
                 . " has already started the job (start_time: " . ($startTime ?: 'N/A') . "). Transfer not allowed.";

            $payload = [
                'type'             => 'service_order_technician_block',
                'service_order_id' => $id,
                'reference_id'     => $id,
                'account_no'       => $accountNo,
                'action'           => 'technician_reassignment_blocked',
                'description'      => $description,
                'performed_by'     => $performedBy,
                'start_time'       => $startTime,
                'data'             => [
                    'assigned_technician' => $originalTechName,
                ],
            ];

            $newPayload = $payload;
            $newPayload['data'] = [
                'assigned_technician' => $newTechName,
            ];

            DB::table('details_update_logs')->insert([
                'account_id'         => $billingAccount->id ?? null,
                'old_details'        => json_encode(array_merge($payload, ['old_value' => $originalTechName, 'new_value' => $newTechName])),
                'new_details'        => json_encode(array_merge($newPayload, ['old_value' => $originalTechName, 'new_value' => $newTechName])),
                'created_at'         => now(),
                'updated_at'         => now(),
                'created_by_user_id' => $logUserId,
                'updated_by_user_id' => $logUserId,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Blocked transfer logged'
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to log blocked technician transfer for service order', [
                'service_order_id' => $id,
                'error'            => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to log blocked transfer',
                'error'   => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Release a service order to its technician ahead of their queue.
     *
     * Technicians work In Progress first and oldest first within that: only the
     * record at the top of their list is actionable, everything else active is
     * greyed out. An administrator calls this to unlock one specific service
     * order early. Restricted to administrators by the `role` middleware on the
     * route — technician_enabled is not fillable, so this is the only way it can
     * be set.
     */
    public function enableForTechnician(Request $request, $id): JsonResponse
    {
        try {
            $currentUser = $this->resolveActingUser($request);
            $organizationId = $currentUser ? $currentUser->organization_id : null;
            $isSuperAdmin = !$currentUser || (int) $currentUser->role_id === Role::SUPER_ADMIN || !$organizationId;

            $serviceOrder = DB::table('service_orders')->where('id', $id)->first();

            if (!$serviceOrder) {
                return response()->json([
                    'success' => false,
                    'message' => 'Service order not found'
                ], 404);
            }

            if (!$isSuperAdmin && $organizationId && $serviceOrder->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to service order'
                ], 403);
            }

            // Already released — answer successfully with the current state rather
            // than writing an audit entry for a no-op.
            if (!empty($serviceOrder->technician_enabled)) {
                return response()->json([
                    'success' => true,
                    'message' => 'This service order is already enabled for the technician.',
                    'data' => [
                        'id' => $serviceOrder->id,
                        'technician_enabled' => true,
                    ],
                ]);
            }

            $performedBy = $request->input('updated_by_user')
                ?? optional($currentUser)->email_address
                ?? optional($currentUser)->email
                ?? 'System';

            DB::table('service_orders')->where('id', $id)->update([
                'technician_enabled' => 1,
                'updated_by_user' => $performedBy,
                'updated_at' => Carbon::now(),
            ]);

            AuditTrailLog::create([
                'old_details' => [
                    'type' => 'serviceorders',
                    'id' => $serviceOrder->id,
                    'data' => ['technician_enabled' => false],
                ],
                'new_details' => [
                    'type' => 'serviceorders',
                    'id' => $serviceOrder->id,
                    'data' => ['technician_enabled' => true],
                ],
                'created_by_user' => $performedBy,
                'updated_by_user' => $performedBy,
            ]);

            ActivityLog::log(
                'Service Order Enabled For Technician',
                "Service Order #{$serviceOrder->id} unlocked for technician access by {$performedBy}",
                'info',
                [
                    'user_email' => $performedBy,
                    'resource_type' => 'ServiceOrder',
                    'resource_id' => $serviceOrder->id,
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Service order enabled for technician access.',
                'data' => [
                    'id' => $serviceOrder->id,
                    'technician_enabled' => true,
                ],
            ]);
        }
        catch (\Exception $e) {
            Log::error('Failed to enable service order for technician', [
                'service_order_id' => $id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to enable service order for technician',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * The signed-in user, however this request authenticated.
     *
     * The service-orders routes sit outside the `auth:sanctum` group, so the
     * default session guard resolves the web portal (cookie based) but NOT the
     * mobile app, which sends a bearer token. Asking Sanctum's guard covers both,
     * and it is asked only for the technician queue checks below — the rest of
     * this controller keeps using auth()->user() exactly as it did.
     */
    private function resolveActingUser(Request $request)
    {
        if ($user = $request->user()) {
            return $user;
        }

        try {
            return $request->user('sanctum');
        }
        catch (\Throwable $e) {
            // No sanctum guard configured — treat as unidentified.
            return null;
        }
    }

    /**
     * Is the signed-in user a technician?
     *
     * Read strictly off role_id, the way isServiceOrderLockedForTechnician()
     * below and JobOrderController do. A hybrid custom role that merely builds
     * on Technician is deliberately not counted: it does not get the queue lock
     * either, and visit_status_date records that a technician was on site, not
     * that somebody held a technician-derived permission set.
     *
     * An unidentified caller is not a technician, so a request that fails to
     * authenticate leaves the column alone rather than stamping today onto it.
     */
    private function isTechnician($currentUser): bool
    {
        return $currentUser !== null && (int) $currentUser->role_id === Role::TECHNICIAN;
    }

    /**
     * Claim the right to post this order's service charge to a balance.
     *
     * True when the caller may post it, false when someone else already has.
     *
     * The UPDATE is the lock. A ticket finishes twice — the visit marked Done
     * and support marking it Resolved — and when those two saves overlap, both
     * read a service order that has not been charged yet and both work out the
     * full charge as owing. Reading the column and then writing it would not
     * help: both would read 'pending' before either wrote.
     *
     * Writing it conditionally does. MySQL takes a row lock for the UPDATE, so
     * the two run one after the other whatever order they arrived in, and the
     * WHERE clause is then false for the second — it matches no rows, gets 0
     * back, and posts nothing. No transaction is needed for this, because the
     * single statement is the whole of the critical section.
     *
     * Matched loosely — null, '', 'pending', any casing — so a row that predates
     * the column, or one a hand-run UPDATE left empty, is claimable rather than
     * silently stuck. Only the exact string 'added' blocks a claim.
     */
    private function claimServiceCharge(int $serviceOrderId): bool
    {
        $claimed = DB::table('service_orders')
            ->where('id', $serviceOrderId)
            ->whereRaw(
                "LOWER(TRIM(COALESCE(service_charge_status, ''))) <> ?",
                [self::CHARGE_ADDED]
            )
            ->update([
                'service_charge_status' => self::CHARGE_ADDED,
                'updated_at'            => now(),
            ]);

        return $claimed > 0;
    }

    /**
     * Did the visit status actually move?
     *
     * Compared on the trimmed, case-folded strings. Both clients normalise the
     * dropdown before sending it, but they do so from their own lists and the
     * stored value may predate either — the show() query hands back whatever is
     * in the column. A difference in casing or padding alone is not a
     * technician moving anything, so it must not restamp the date.
     *
     * A null and an empty string are the same absence of a status, so clearing
     * an already-empty field does not count as a move either.
     */
    private function visitStatusChanged($previous, $next): bool
    {
        $normalise = static fn ($value): string => strtolower(trim((string) ($value ?? '')));

        return $normalise($previous) !== $normalise($next);
    }

    /**
     * Is this service order locked for the signed-in user because it is not their
     * next one in the queue?
     *
     * Only ever true for technicians. A service order is open when any of these
     * hold:
     *   • it heads the queue of work still assigned to them — the oldest In
     *     Progress visit, or the oldest other active one when they have none in
     *     progress, or the oldest rescheduled one when that is all that is left.
     *     A reschedule sorts last, so it reaches the head only when there is no
     *     active work in front of it;
     *   • an administrator enabled it (technician_enabled);
     *   • they have already started it and not yet closed it — a visit in flight
     *     must never become unreachable;
     *   • it is done, resolved, failed or cancelled: nothing is left to act on.
     *
     * A rescheduled service order is deliberately NOT open on its status alone.
     * It stays out of the queue's way, so it never blocks the work behind it, but
     * booking the return visit back in is an administrator's call.
     *
     * A service order that is not part of the technician's own assigned queue is
     * left alone: this restriction governs the order of their own work, and must
     * not start blocking records reached some other way.
     *
     * Mirrors JobOrderController::isJobOrderLockedForTechnician() and the two
     * clients' utils/technicianServiceOrderAccess.ts.
     */
    private function isServiceOrderLockedForTechnician($serviceOrder, $currentUser): bool
    {
        if (!$currentUser || (int) $currentUser->role_id !== Role::TECHNICIAN) {
            return false;
        }

        if (!empty($serviceOrder->technician_enabled)) {
            return false;
        }

        $visitStatus = strtolower(trim((string) ($serviceOrder->visit_status ?? '')));
        if (in_array($visitStatus, ServiceOrder::TECHNICIAN_QUEUE_CLOSED_VISIT_STATUSES, true)) {
            return false;
        }

        // Already in flight for this technician. A zero date counts as unset, the
        // same way the two clients read these columns.
        $isTimeSet = static function ($value): bool {
            $normalised = strtolower(trim((string) $value));
            return !in_array($normalised, ['', '0000-00-00 00:00:00', 'not set', '-', 'none', 'null'], true);
        };

        if ($isTimeSet($serviceOrder->start_time ?? null) && !$isTimeSet($serviceOrder->end_time ?? null)) {
            return false;
        }

        $technicianEmail = $currentUser->email ?? $currentUser->email_address ?? null;
        if (!$technicianEmail) {
            return false;
        }

        // The technician's open queue, in the order the two clients paint their
        // list: In Progress first, then other active work, then deferred work
        // last, oldest first within each band on the ticket's own timestamp
        // falling back to the row's creation date. So the head of this list is the
        // record that appears at the top of the technician's screen.
        //
        // Deferred work is ranked here rather than excluded with the finished
        // work. Sorting last is what keeps it from taking the slot away from
        // active work; excluding it made it neither next nor locked.
        //
        // Membership of THIS list is also what decides whether the service order
        // is one of theirs to queue at all. Testing ownership separately would
        // mean two comparisons of the same email that can disagree — and a
        // disagreement fails open, because an empty queue never blocks.
        $inProgressFirst = sprintf(
            "CASE WHEN LOWER(TRIM(COALESCE(visit_status, ''))) IN ('%s') THEN 0 ELSE 1 END",
            implode("', '", ServiceOrder::TECHNICIAN_IN_PROGRESS_VISIT_STATUSES)
        );

        $deferredLast = sprintf(
            "CASE WHEN LOWER(TRIM(COALESCE(visit_status, ''))) IN ('%s') THEN 1 ELSE 0 END",
            implode("', '", ServiceOrder::TECHNICIAN_QUEUE_DEFERRED_VISIT_STATUSES)
        );

        $queue = DB::table('service_orders')
            ->where('assigned_email', $technicianEmail)
            ->whereNotIn(
                DB::raw("LOWER(TRIM(COALESCE(visit_status, '')))"),
                ServiceOrder::TECHNICIAN_QUEUE_CLOSED_VISIT_STATUSES
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
        if (!$queue->contains((int) $serviceOrder->id)) {
            return false;
        }

        return $queue->first() !== (int) $serviceOrder->id;
    }

    public function destroy($id): JsonResponse
    {
        try {
            $serviceOrder = DB::table('service_orders')->where('id', $id)->first();

            if (!$serviceOrder) {
                return response()->json([
                    'success' => false,
                    'message' => 'Service order not found'
                ], 404);
            }

            DB::table('service_orders')->where('id', $id)->delete();

            return response()->json([
                'success' => true,
                'message' => 'Service order deleted successfully'
            ]);
        }
        catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete service order',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    private function attemptReconnection($billingAccount, $serviceOrderId = null, $updatedByUser = 'System', ?int $organizationId = null): string
    {
        try {
            // Reload billing account
            $billingAccount = BillingAccount::find($billingAccount->id);
            $accountNo = $billingAccount->account_no;

            \Log::info('[API SERVICE ORDER RECONNECT] Force starting for account: ' . $accountNo);

            // Step 2: Get account details (PPPoE Username and Plan)
            $accountInfo = DB::table('billing_accounts')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('billing_accounts.id', $billingAccount->id)
                ->select('technical_details.username as pppoe_username', 'customers.desired_plan')
                ->first();

            $username = $accountInfo->pppoe_username ?? null;
            $plan = $accountInfo->desired_plan ?? null;

            // If there's a new_plan in the service order (e.g. Upgrade/Downgrade), use that instead
            if ($serviceOrderId) {
                $soPlan = DB::table('service_orders')->where('id', $serviceOrderId)->value('new_plan');
                if ($soPlan && trim($soPlan) !== '') {
                    $plan = $soPlan;
                    \Log::info('[API SERVICE ORDER RECONNECT] Using new_plan from Service Order: ' . $plan);
                }
            }

            if (empty($username)) {
                \Log::info('[API SERVICE ORDER RECONNECT SKIP] No PPPoE username found for ' . $accountNo);
                return 'no_username';
            }

            if (empty($plan)) {
                \Log::info('[API SERVICE ORDER RECONNECT SKIP] No plan found for ' . $accountNo);
                return 'no_plan';
            }

            // Step 3: Trigger RADIUS Reconnection (retry 3 times, then queue)
            $radiusParams = [
                'accountNumber' => $accountNo,
                'username' => $username,
                'plan' => $plan,
                'serviceOrderId' => $serviceOrderId,
                'remarks' => 'Reconnected via Service Order API',
                'updatedBy' => $updatedByUser
            ];
            $radiusSuccess = false;
            $lastRadiusError = '';
            for ($attempt = 1; $attempt <= 2; $attempt++) {
                $this->radiusSteps[] = ['step' => 'attempt_' . $attempt, 'operation' => 'reconnect', 'status' => 'trying'];
                try {
                    $manualRadiusService = app(\App\Services\ManualRadiusOperationsService::class);
                    $radiusResult = $manualRadiusService->reconnectUser($radiusParams);
                    if (($radiusResult['status'] ?? '') === 'success') {
                        $radiusSuccess = true;
                        $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = 'success';
                        \Log::channel('radiusrelated')->info("[API SERVICE ORDER RECONNECT RADIUS] Success on attempt {$attempt}");
                        break;
                    }
                    $lastRadiusError = $radiusResult['message'] ?? 'Operation returned failure';
                    $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = 'failed';
                    \Log::channel('radiusrelated')->warning("[API SERVICE ORDER RECONNECT RADIUS] Attempt {$attempt}/2 failed: {$lastRadiusError}");
                } catch (\Exception $radEx) {
                    $lastRadiusError = $radEx->getMessage();
                    $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = 'failed';
                    \Log::channel('radiusrelated')->warning("[API SERVICE ORDER RECONNECT RADIUS] Attempt {$attempt}/2 exception: {$lastRadiusError}");
                }
                if ($attempt < 2) sleep(1);
            }
            if (!$radiusSuccess) {
                \Log::channel('radiusrelated')->error('[API SERVICE ORDER RECONNECT RADIUS] All attempts failed. Queuing for retry.');
                $this->radiusSteps[] = ['step' => 'queued', 'operation' => 'reconnect', 'status' => 'trying'];
                $this->trackRadiusQueue([
                    'organization_id' => $organizationId ?? null,
                    'source_type' => 'service_order',
                    'source_id' => $serviceOrderId ?? 0,
                    'account_no' => $accountNo,
                    'operation' => 'reconnect_user',
                    'params' => $radiusParams,
                    'last_error' => $lastRadiusError,
                    'created_by' => $updatedByUser,
                ]);
                $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = $this->radiusQueued ? 'success' : 'failed';
            }

            \Log::info('[API SERVICE ORDER RECONNECT PROCEED] Reconnecting user for account: ' . $accountNo);

            $isAlreadyActive = ($billingAccount->billing_status_id == 1);

            // Step 4: Update billing_status_id to 1 (Active) BEFORE reconnecting
            $billingAccount->billing_status_id = 1;
            $billingAccount->updated_at = now();
            $billingAccount->updated_by = Auth::id();
            $billingAccount->save();

            \Log::info('[API SERVICE ORDER RECONNECT DB] Updated billing_status_id to 1 for Account: ' . $accountNo);

            \Log::info('[API SERVICE ORDER RECONNECT SUCCESS] Reconnection (Local Status) completed successfully');

            // Fetch customer details for notifications
            $customerInfo = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                    'customers.contact_number_primary',
                    'customers.email_address',
                    'customers.desired_plan as plan_name',
                    DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as full_name")
                )
                ->first();

            // Send SMS Notification
            if (!$isAlreadyActive) {
                try {
                    $smsTemplate = DB::table('sms_templates')
                        ->where('template_type', 'Reconnect')
                        ->where('is_active', 1)
                        ->first();

                    if ($smsTemplate && $customerInfo && !empty($customerInfo->contact_number_primary)) {
                        $message = $smsTemplate->message_content;
                        $planNameFormatted = str_replace('₱', 'P', $customerInfo->plan_name ?? '');
                        $customerName = preg_replace('/\s+/', ' ', trim($customerInfo->full_name));
                        $message = str_replace('{{customer_name}}', $customerName, $message);
                        $message = str_replace('{{account_no}}', $accountNo, $message);
                        $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                        $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);

                        $smsService = new \App\Services\ItexmoSmsService();
                        $smsResult = $smsService->send([
                            'contact_no' => $customerInfo->contact_number_primary,
                            'message' => $message
                        ]);

                        if ($smsResult['success']) {
                            \Log::info('[API SERVICE ORDER RECONNECT SMS] SMS sent');
                        }
                    }
                }
                catch (\Exception $e) {
                    \Log::error('[API SERVICE ORDER RECONNECT SMS EXCEPTION] ' . $e->getMessage());
                }
            }

            // Email Notification
            if (!$isAlreadyActive) {
                try {
                    $emailTemplate = \App\Models\EmailTemplate::where('Template_Code', 'RECONNECT')->first();

                    if (!empty($emailTemplate) && $customerInfo && !empty($customerInfo->email_address)) {
                        $emailService = app(\App\Services\EmailQueueService::class);
                        $emailData = [
                            'customer_name' => $customerInfo->full_name,
                            'account_no' => $accountNo,
                            'plan_name' => $customerInfo->plan_name,
                            'recipient_email' => $customerInfo->email_address,
                        ];
                        $emailService->queueFromTemplate('RECONNECT', $emailData);
                        \Log::info('[API SERVICE ORDER RECONNECT EMAIL] Email queued');
                    }
                }
                catch (\Exception $e) {
                    \Log::error('[API SERVICE ORDER RECONNECT EMAIL EXCEPTION] ' . $e->getMessage());
                }
            }

            return 'success';

        }
        catch (\Exception $e) {
            \Log::error('[API SERVICE ORDER RECONNECT EXCEPTION] ' . $e->getMessage());
            return 'exception';
        }
    }

    private function attemptRestriction($billingAccount, $updatedByUser = 'System', ?int $organizationId = null): string
    {
        try {
            // Reload billing account
            $billingAccount = BillingAccount::find($billingAccount->id);
            $accountNo = $billingAccount->account_no;

            \Log::info('[API SERVICE ORDER RESTRICT] Force starting for account: ' . $accountNo);

            // Get account details (PPPoE Username)
            $accountInfo = DB::table('billing_accounts')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('billing_accounts.id', $billingAccount->id)
                ->select('technical_details.username as pppoe_username')
                ->first();

            $username = $accountInfo->pppoe_username ?? null;

            if (empty($username)) {
                \Log::info('[API SERVICE ORDER RESTRICT SKIP] No PPPoE username found');
                return 'no_username';
            }

            // Step 2: Trigger RADIUS Restriction (retry 3 times, then queue)
            $radiusRestrictParams = [
                'accountNumber' => $accountNo,
                'username' => $username,
                'remarks' => 'Restricted via Service Order API',
                'updatedBy' => $updatedByUser
            ];
            $radiusSuccess = false;
            $lastRadiusError = '';
            for ($attempt = 1; $attempt <= 2; $attempt++) {
                $this->radiusSteps[] = ['step' => 'attempt_' . $attempt, 'operation' => 'restrict', 'status' => 'trying'];
                try {
                    $radiusOps = app(\App\Services\ManualRadiusOperationsService::class);
                    $result = $radiusOps->restrictedUser($radiusRestrictParams);
                    if (($result['status'] ?? '') === 'success') {
                        $radiusSuccess = true;
                        $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = 'success';
                        \Log::channel('radiusrelated')->info("[API SERVICE ORDER RESTRICT RADIUS] Success on attempt {$attempt}");
                        break;
                    }
                    $lastRadiusError = $result['message'] ?? 'Operation returned failure';
                    $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = 'failed';
                    \Log::channel('radiusrelated')->warning("[API SERVICE ORDER RESTRICT RADIUS] Attempt {$attempt}/3 failed: {$lastRadiusError}");
                } catch (\Exception $radEx) {
                    $lastRadiusError = $radEx->getMessage();
                    $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = 'failed';
                    \Log::channel('radiusrelated')->warning("[API SERVICE ORDER RESTRICT RADIUS] Attempt {$attempt}/3 exception: {$lastRadiusError}");
                }
                if ($attempt < 2) sleep(1);
            }
            if (!$radiusSuccess) {
                \Log::channel('radiusrelated')->error('[API SERVICE ORDER RESTRICT RADIUS] All 3 attempts failed. Queuing for retry.');
                $this->radiusSteps[] = ['step' => 'queued', 'operation' => 'restrict', 'status' => 'trying'];
                $this->trackRadiusQueue([
                    'organization_id' => $organizationId ?? null,
                    'source_type' => 'service_order',
                    'source_id' => 0,
                    'account_no' => $accountNo,
                    'operation' => 'restricted_user',
                    'params' => $radiusRestrictParams,
                    'last_error' => $lastRadiusError,
                    'created_by' => $updatedByUser,
                ]);
                $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = $this->radiusQueued ? 'success' : 'failed';
            }

            // Update billing_status_id to 4 (Inactive)
            $statusId = DB::table('billing_status')->where('status_name', 'Inactive')->value('id');
            if (!$statusId) {
                $statusId = 4; // Fallback
            }

            $billingAccount->billing_status_id = $statusId;
            $billingAccount->updated_at = now();
            // Use current user if authenticated
            $billingAccount->updated_by = Auth::id() ?: 1;
            $billingAccount->save();

            \Log::info("[API SERVICE ORDER RESTRICT DB] Updated billing_status_id to {$statusId} (Inactive) for Account: {$accountNo}");

            // Fetch customer info for notifications
            $customerInfo = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                    'customers.contact_number_primary',
                    'customers.email_address',
                    'customers.desired_plan as plan_name',
                    DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as full_name"),
                    'billing_accounts.account_balance'
                )
                ->first();

            // Send SMS Notification
            try {
                $smsTemplate = DB::table('sms_templates')
                    ->where('template_type', 'Disconnected')
                    ->where('is_active', 1)
                    ->first();

                if ($smsTemplate && $customerInfo && !empty($customerInfo->contact_number_primary)) {
                    $message = $smsTemplate->message_content;
                    $planNameFormatted = str_replace('₱', 'P', $customerInfo->plan_name ?? '');
                    $customerName = preg_replace('/\s+/', ' ', trim($customerInfo->full_name));
                    $message = str_replace('{{customer_name}}', $customerName, $message);
                    $message = str_replace('{{account_no}}', $accountNo, $message);
                    $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                    $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
                    $message = str_replace('{{amount_due}}', number_format($customerInfo->account_balance, 2), $message);
                    $message = str_replace('{{balance}}', number_format($customerInfo->account_balance, 2), $message);

                    $smsService = new \App\Services\ItexmoSmsService();
                    $smsResult = $smsService->send([
                        'contact_no' => $customerInfo->contact_number_primary,
                        'message' => $message
                    ]);

                    if ($smsResult['success']) {
                        \Log::info('[API SERVICE ORDER RESTRICT SMS] SMS sent to: ' . $customerInfo->contact_number_primary);
                    } else {
                        \Log::warning('[API SERVICE ORDER RESTRICT SMS] SMS send failed', $smsResult);
                    }
                }
            } catch (\Exception $smsEx) {
                \Log::error('[API SERVICE ORDER RESTRICT SMS EXCEPTION] ' . $smsEx->getMessage());
            }

            // Send Email Notification
            try {
                $emailTemplate = \App\Models\EmailTemplate::where('Template_Code', 'DISCONNECTED')->first();

                if (!empty($emailTemplate) && $customerInfo && !empty($customerInfo->email_address)) {
                    $emailService = app(\App\Services\EmailQueueService::class);
                    $emailData = [
                        'customer_name' => preg_replace('/\s+/', ' ', trim($customerInfo->full_name)),
                        'account_no' => $accountNo,
                        'plan_name' => $customerInfo->plan_name,
                        'amount_due' => number_format($customerInfo->account_balance, 2),
                        'balance' => number_format($customerInfo->account_balance, 2),
                        'recipient_email' => $customerInfo->email_address,
                    ];
                    $emailService->queueFromTemplate('DISCONNECTED', $emailData);
                    \Log::info('[API SERVICE ORDER RESTRICT EMAIL] Email queued for: ' . $customerInfo->email_address);
                }
            } catch (\Exception $emailEx) {
                \Log::error('[API SERVICE ORDER RESTRICT EMAIL EXCEPTION] ' . $emailEx->getMessage());
            }

            return 'success';
        } catch (\Exception $e) {
            \Log::error('[API SERVICE ORDER RESTRICT EXCEPTION] ' . $e->getMessage());
            return 'exception';
        }
    }

    private function attemptDisconnection($billingAccount, $updatedByUser = 'System'): string
    {
        try {
            // Reload billing account
            $billingAccount = BillingAccount::find($billingAccount->id);
            $accountNo = $billingAccount->account_no;

            \Log::info('[API SERVICE ORDER DISCONNECT] Force starting for account: ' . $accountNo);

            // Get account details (PPPoE Username)
            $accountInfo = DB::table('billing_accounts')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('billing_accounts.id', $billingAccount->id)
                ->select('technical_details.username as pppoe_username')
                ->first();

            $username = $accountInfo->pppoe_username ?? null;

            if (empty($username)) {
                \Log::info('[API SERVICE ORDER DISCONNECT SKIP] No PPPoE username found in technical_details');
                return 'no_username';
            }

            \Log::info('[API SERVICE ORDER DISCONNECT PROCEED] Disconnecting user for account: ' . $accountNo);
            // Step 2: Trigger RADIUS Disconnection (retry 3 times, then queue)
            $radiusDcParams = [
                'accountNumber' => $accountNo,
                'username' => $username,
                'remarks' => 'Disconnected via Service Order API',
                'updatedBy' => $updatedByUser
            ];
            $radiusSuccess = false;
            $lastRadiusError = '';
            for ($attempt = 1; $attempt <= 2; $attempt++) {
                try {
                    $radiusOps = app(\App\Services\ManualRadiusOperationsService::class);
                    $result = $radiusOps->disconnectUser($radiusDcParams);
                    if (($result['status'] ?? '') === 'success') {
                        $radiusSuccess = true;
                        \Log::channel('radiusrelated')->info("[API SERVICE ORDER DISCONNECT RADIUS] Success on attempt {$attempt}");
                        break;
                    }
                    $lastRadiusError = $result['message'] ?? 'Operation returned failure';
                    \Log::channel('radiusrelated')->warning("[API SERVICE ORDER DISCONNECT RADIUS] Attempt {$attempt}/3 failed: {$lastRadiusError}");
                } catch (\Exception $radEx) {
                    $lastRadiusError = $radEx->getMessage();
                    \Log::channel('radiusrelated')->warning("[API SERVICE ORDER DISCONNECT RADIUS] Attempt {$attempt}/3 exception: {$lastRadiusError}");
                }
                if ($attempt < 2) sleep(1);
            }
            if (!$radiusSuccess) {
                \Log::channel('radiusrelated')->error('[API SERVICE ORDER DISCONNECT RADIUS] All 3 attempts failed. Queuing for retry.');
                $this->trackRadiusQueue([
                    'source_type' => 'service_order',
                    'source_id' => 0,
                    'account_no' => $accountNo,
                    'operation' => 'disconnect_user',
                    'params' => $radiusDcParams,
                    'last_error' => $lastRadiusError,
                    'created_by' => $updatedByUser,
                ]);
            }

            // Step 3: Update local database status (ID 4 = Disconnected)
            $billingAccount->billing_status_id = 4;
            $billingAccount->updated_at = now();
            $billingAccount->updated_by = Auth::id() ?: 1;
            $billingAccount->save();

            \Log::info('[API SERVICE ORDER DISCONNECT DB] Updated billing_status_id to 4 (Disconnected) for Account: ' . $accountNo);

            // Send SMS Notification
            try {
                $smsTemplate = DB::table('sms_templates')
                    ->where('template_type', 'Disconnected')
                    ->where('is_active', 1)
                    ->first();

                if ($smsTemplate) {
                    $customerInfo = DB::table('billing_accounts')
                        ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                        ->where('billing_accounts.account_no', $accountNo)
                        ->select(
                        'customers.contact_number_primary',
                        'customers.email_address',
                        'customers.desired_plan as plan_name',
                        DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as full_name"),
                        'billing_accounts.account_balance'
                    )
                        ->first();

                    if ($customerInfo && !empty($customerInfo->contact_number_primary)) {
                        $message = $smsTemplate->message_content;
                        $planNameFormatted = str_replace('₱', 'P', $customerInfo->plan_name ?? '');
                        $customerName = preg_replace('/\s+/', ' ', trim($customerInfo->full_name));
                        $message = str_replace('{{customer_name}}', $customerName, $message);
                        $message = str_replace('{{account_no}}', $accountNo, $message);
                        $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                        $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
                        $message = str_replace('{{amount_due}}', number_format($customerInfo->account_balance, 2), $message);
                        $message = str_replace('{{balance}}', number_format($customerInfo->account_balance, 2), $message);

                        $smsService = new \App\Services\ItexmoSmsService();
                        $smsResult = $smsService->send([
                            'contact_no' => $customerInfo->contact_number_primary,
                            'message' => $message
                        ]);

                        if ($smsResult['success']) {
                            \Log::info('[API SERVICE ORDER DISCONNECT SMS] SMS sent');
                        }
                    }
                }
            }
            catch (\Exception $e) {
                \Log::error('[API SERVICE ORDER DISCONNECT SMS EXCEPTION] ' . $e->getMessage());
            }

            // Send Email Notification
            try {
                $emailTemplate = \App\Models\EmailTemplate::where('Template_Code', 'DISCONNECTED')->first();

                if (!empty($emailTemplate) && !empty($customerInfo->email_address)) {
                    $emailService = app(\App\Services\EmailQueueService::class);
                    $emailData = [
                        'customer_name' => $customerInfo->full_name,
                        'account_no' => $accountNo,
                        'amount_due' => number_format($customerInfo->account_balance, 2),
                        'balance' => number_format($customerInfo->account_balance, 2),
                        'recipient_email' => $customerInfo->email_address,
                    ];
                    $emailService->queueFromTemplate('DISCONNECTED', $emailData);
                    \Log::info('[API SERVICE ORDER DISCONNECT EMAIL] Email queued');
                }
            }
            catch (\Exception $e) {
                \Log::error('[API SERVICE ORDER DISCONNECT EMAIL EXCEPTION] ' . $e->getMessage());
            }

            return 'success';

        }
        catch (\Exception $e) {
            \Log::error('[API SERVICE ORDER DISCONNECT EXCEPTION] ' . $e->getMessage());
            return 'exception';
        }
    }

    private function attemptPullout($billingAccount, $updatedByUser = 'System', ?int $organizationId = null, ?int $serviceOrderId = null): string
    {
        try {
            // Reload billing account
            $billingAccount = BillingAccount::find($billingAccount->id);
            $accountNo = $billingAccount->account_no;

            \Log::info('[API SERVICE ORDER PULLOUT] Force starting for account: ' . $accountNo);

            // Get account details (PPPoE Username)
            $accountInfo = DB::table('billing_accounts')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('billing_accounts.id', $billingAccount->id)
                ->select('technical_details.username as pppoe_username', 'technical_details.router_modem_sn as router_modem_sn')
                ->first();

            $username = $accountInfo->pppoe_username ?? null;
            $routerModemSn = $accountInfo->router_modem_sn ?? null;

            \Log::info('[API SERVICE ORDER PULLOUT PROCEED] Executing pullout for account: ' . $accountNo);

            if (empty($username)) {
                \Log::info('[API SERVICE ORDER PULLOUT SKIP RADIUS] No PPPoE username found, skipping RADIUS disconnect but proceeding with local DB updates');
            } else {
                // Step 2: Trigger RADIUS Disconnection/Pullout (retry 3 times, then queue)
                $radiusPulloutParams = [
                    'accountNumber' => $accountNo,
                    'username' => $username,
                    'remarks' => 'Pullout',
                    'updatedBy' => $updatedByUser
                ];
                $radiusSuccess = false;
                $lastRadiusError = '';
                for ($attempt = 1; $attempt <= 2; $attempt++) {
                    try {
                        $radiusOps = app(\App\Services\ManualRadiusOperationsService::class);
                        $result = $radiusOps->disconnectUser($radiusPulloutParams);
                        if (($result['status'] ?? '') === 'success') {
                            $radiusSuccess = true;
                            \Log::channel('radiusrelated')->info("[API SERVICE ORDER PULLOUT RADIUS] Success on attempt {$attempt}");
                            break;
                        }
                        $lastRadiusError = $result['message'] ?? 'Operation returned failure';
                        \Log::channel('radiusrelated')->warning("[API SERVICE ORDER PULLOUT RADIUS] Attempt {$attempt}/3 failed: {$lastRadiusError}");
                    } catch (\Exception $radEx) {
                        $lastRadiusError = $radEx->getMessage();
                        \Log::channel('radiusrelated')->warning("[API SERVICE ORDER PULLOUT RADIUS] Attempt {$attempt}/3 exception: {$lastRadiusError}");
                    }
                    if ($attempt < 2) sleep(1);
                }
                if (!$radiusSuccess) {
                    \Log::channel('radiusrelated')->error('[API SERVICE ORDER PULLOUT RADIUS] All 3 attempts failed. Queuing for retry.');
                    $this->trackRadiusQueue([
                        'organization_id' => $organizationId ?? null,
                        'source_type' => 'service_order',
                        'source_id' => 0,
                        'account_no' => $accountNo,
                        'operation' => 'disconnect_user',
                        'params' => $radiusPulloutParams,
                        'last_error' => $lastRadiusError,
                        'created_by' => $updatedByUser,
                    ]);
                }
                \Log::info('[API SERVICE ORDER PULLOUT SUCCESS] Disconnection (Local Status) completed successfully');
            }

            // Update billing_status_id to 5 (Pullout)
            $billingAccount->billing_status_id = 5;
            $billingAccount->updated_at = now();
            $billingAccount->updated_by = Auth::id();
            $billingAccount->save();

            \Log::info('[API SERVICE ORDER PULLOUT DB] Updated billing_status_id to 5 (Pullout) for Account: ' . $accountNo);

            // Preserve the hardware serial on the pullout service order before clearing technical_details
            // so downstream reconciliation (SmartOLT unprovisioning after 2 weeks) can identify the device.
            if (!empty($routerModemSn)) {
                $soUpdateQuery = DB::table('service_orders')
                    ->where('account_no', $accountNo)
                    ->where(function ($q) {
                        $q->whereNull('old_router_modem_sn')->orWhere('old_router_modem_sn', '');
                    });

                if ($serviceOrderId) {
                    $soUpdateQuery->where('id', $serviceOrderId);
                } else {
                    $soUpdateQuery->where(function ($q) {
                        $q->whereIn(DB::raw("LOWER(TRIM(COALESCE(concern, '')))"), ['pullout', 'for pullout'])
                          ->orWhere(DB::raw("LOWER(TRIM(COALESCE(repair_category, '')))"), '=', 'pullout');
                    });
                }

                $soUpdateQuery->update([
                    'old_router_modem_sn' => $routerModemSn,
                    'updated_at' => now(),
                ]);
            }

            // Do NOT delete or modify the ONU on SmartOLT during Service Order pullout.
            // ONU unprovisioning is deferred for 2 weeks (14 days) and handled by cron:smartolt-daily-automation.

            // Clear technical details
            DB::table('technical_details')
                ->where('account_no', $accountNo)
                ->update([
                'connection_type' => null,
                'router_model' => null,
                'router_modem_sn' => null,
                'ip_address' => null,
                'lcp' => null,
                'nap' => null,
                'port' => null,
                'vlan' => null,
                'lcpnap' => null,
                'usage_type' => null,
                'updated_at' => now()
            ]);

            \Log::info('[API SERVICE ORDER PULLOUT DB] Cleared technical details for Account: ' . $accountNo);

            // Clear port in job_orders table using account_id (referencing billing_accounts id)
            DB::table('job_orders')
                ->where('account_id', $billingAccount->id)
                ->update([
                'port' => null,
                'updated_at' => now()
            ]);

            \Log::info('[API SERVICE ORDER PULLOUT DB] Cleared port in job_orders for Account ID: ' . $billingAccount->id);

            // Send SMS Notification
            try {
                $smsTemplate = DB::table('sms_templates')
                    ->where('template_type', 'Disconnected')
                    ->where('is_active', 1)
                    ->first();

                if ($smsTemplate) {
                    $customerInfo = DB::table('billing_accounts')
                        ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                        ->where('billing_accounts.account_no', $accountNo)
                        ->select(
                        'customers.contact_number_primary',
                        'customers.email_address',
                        'customers.desired_plan as plan_name',
                        DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as full_name"),
                        'billing_accounts.account_balance'
                    )
                        ->first();

                    if ($customerInfo && !empty($customerInfo->contact_number_primary)) {
                        $message = $smsTemplate->message_content;
                        $planNameFormatted = str_replace('₱', 'P', $customerInfo->plan_name ?? '');
                        $customerName = preg_replace('/\s+/', ' ', trim($customerInfo->full_name));
                        $message = str_replace('{{customer_name}}', $customerName, $message);
                        $message = str_replace('{{account_no}}', $accountNo, $message);
                        $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                        $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
                        $message = str_replace('{{amount_due}}', number_format($customerInfo->account_balance, 2), $message);
                        $message = str_replace('{{balance}}', number_format($customerInfo->account_balance, 2), $message);

                        $smsService = new \App\Services\ItexmoSmsService();
                        $smsResult = $smsService->send([
                            'contact_no' => $customerInfo->contact_number_primary,
                            'message' => $message
                        ]);

                        if ($smsResult['success']) {
                            \Log::info('[API SERVICE ORDER PULLOUT SMS] SMS sent');
                        }
                    }
                }
            }
            catch (\Exception $e) {
                \Log::error('[API SERVICE ORDER PULLOUT SMS EXCEPTION] ' . $e->getMessage());
            }

            // Send Email Notification
            try {
                $emailTemplate = \App\Models\EmailTemplate::where('Template_Code', 'DISCONNECTED')->first();

                if (!empty($emailTemplate) && !empty($customerInfo->email_address)) {
                    $emailService = app(\App\Services\EmailQueueService::class);
                    $emailData = [
                        'customer_name' => $customerInfo->full_name,
                        'account_no' => $accountNo,
                        'amount_due' => number_format($customerInfo->account_balance, 2),
                        'balance' => number_format($customerInfo->account_balance, 2),
                        'recipient_email' => $customerInfo->email_address,
                    ];
                    $emailService->queueFromTemplate('DISCONNECTED', $emailData);
                    \Log::info('[API SERVICE ORDER PULLOUT EMAIL] Email queued');
                }
            }
            catch (\Exception $e) {
                \Log::error('[API SERVICE ORDER PULLOUT EMAIL EXCEPTION] ' . $e->getMessage());
            }

            // Update customer's user account to inactive
            try {
                \App\Models\User::where('username', $accountNo)->update(['active' => 0]);
                \Log::info('[API SERVICE ORDER PULLOUT DB] Updated user active status to 0 for Account: ' . $accountNo);
            } catch (\Exception $e) {
                \Log::error('[API SERVICE ORDER PULLOUT DB USER EXCEPTION] ' . $e->getMessage());
            }

            return 'success';

        }
        catch (\Exception $e) {
            \Log::error('[API SERVICE ORDER PULLOUT EXCEPTION] ' . $e->getMessage());
            return 'exception';
        }
    }

    /**
     * Does RADIUS currently have this account in a normal plan group?
     *
     * Read from online_status, which the every-minute sync keeps in step with
     * the RADIUS servers — the controller does not call RADIUS itself for this,
     * because a reachability round trip on the save path would make a slow or
     * unreachable server slow down every reactivation, and the answer is already
     * being collected.
     *
     * Three answers, and the third is the point of returning a nullable:
     *
     *   true   the account is in its plan group (Online, or Offline with the
     *          router unplugged). Nothing to reconnect.
     *   false  the account is Restricted, Disconnected or absent from RADIUS.
     *          It is cut off and a reactivation has to bring it back.
     *   null   no row, or one too old to trust. The caller falls back to the
     *          billing column rather than guessing — and the fallback errs
     *          towards reconnecting, because a redundant reconnection costs a
     *          dropped session and a missed one costs a customer still cut off
     *          after being told they were restored.
     */
    private function radiusSaysConnected(?string $accountNo): ?bool
    {
        if (empty($accountNo)) {
            return null;
        }

        try {
            $reading = DB::table('online_status')
                ->where('account_no', $accountNo)
                ->select('session_status', 'updated_at')
                ->first();

            if (!$reading || $reading->session_status === null) {
                return null;
            }

            $status = strtolower(trim((string) $reading->session_status));

            if ($status === '') {
                return null;
            }

            $connected = in_array($status, self::RADIUS_CONNECTED_STATUSES, true);

            // Staleness is only allowed to veto the skip. A stale reading that
            // says "cut off" still sends us down the reconnect path, which is
            // the safe direction to be wrong in.
            if ($connected) {
                $updatedAt = $reading->updated_at ? Carbon::parse($reading->updated_at) : null;

                if (!$updatedAt || $updatedAt->lt(now()->subMinutes(self::RADIUS_STATUS_TRUSTED_FOR_MINUTES))) {
                    \Log::info('[REACTIVATE] online_status says connected but the reading is stale; ignoring it', [
                        'account_no'     => $accountNo,
                        'session_status' => $reading->session_status,
                        'updated_at'     => $reading->updated_at,
                    ]);

                    return null;
                }
            }

            return $connected;
        } catch (\Exception $e) {
            // online_status is an optimisation, not a dependency: a deployment
            // without the table, or a failed read, must not stop a reactivation.
            \Log::warning('[REACTIVATE] Could not read online_status: ' . $e->getMessage(), [
                'account_no' => $accountNo,
            ]);

            return null;
        }
    }

    /**
     * Which of the LCP/NAP/port columns this save actually moved.
     *
     * Compared trimmed and case-folded so a cosmetic difference — "lcp-008" in
     * one field and "LCP-008" in the other, or a stray trailing space picked up
     * from a paste — is not read as a move and does not rename a working PPPoE
     * account. A missing row on either side means there is nothing to compare
     * and therefore nothing moved.
     *
     * @param  object|null  $before  technical_details as it was before the write.
     * @param  object|null  $after   technical_details as it is now.
     * @return string[]  The column names that differ, in LINE_IDENTITY_COLUMNS order.
     */
    private function changedLineIdentity($before, $after): array
    {
        if (!$before || !$after) {
            return [];
        }

        $normalize = static fn ($value) => strtolower(trim((string) ($value ?? '')));

        $changed = [];

        foreach (self::LINE_IDENTITY_COLUMNS as $column) {
            if ($normalize($before->$column ?? null) !== $normalize($after->$column ?? null)) {
                $changed[] = $column;
            }
        }

        return $changed;
    }

    /**
     * Rename a reactivated account's RADIUS account to match the line it is on.
     *
     * Called only when the save moved the LCP, NAP or port — see the caller.
     * Everything here reads the record as it stands AFTER that write, so the
     * name is generated from the line the customer is actually on rather than
     * from what the request happened to carry.
     *
     * The rename itself goes through ManualRadiusOperationsService::
     * updateCredentials, the same call Migrate and Transfer LCP/NAP/PORT use.
     * That is deliberate rather than convenient: it writes technical_details and
     * job_orders first and only then renames on the device, and on a device
     * failure it throws so the caller can queue the rename — which is what makes
     * a half-completed rename recoverable instead of a silent split between the
     * two. Nothing here writes the username itself; doing so would put a second
     * writer on the same column and the two would disagree the first time one of
     * them failed.
     *
     * Return values, all surfaced to the client:
     *   no_username   the account has no PPPoE credential to rename
     *   no_change     the generated name already matches what is stored
     *   success       renamed in the database and on the device
     *   radius_failed the database holds the new name; the device rename is queued
     *   exception     nothing was attempted
     */
    private function attemptReactivationRadiusSync(
        $billingAccount,
        $serviceOrderId = null,
        $updatedByUser = 'System',
        ?int $organizationId = null
    ): string {
        try {
            $accountNo = $billingAccount->account_no;

            \Log::info('[API SERVICE ORDER REACTIVATE RADIUS] Starting for account: ' . $accountNo);

            // The same projection attemptMigration builds its name from, so the
            // two produce identical usernames for identical lines.
            $fullInfo = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                    'customers.first_name',
                    'customers.middle_initial',
                    'customers.last_name',
                    'customers.contact_number_primary as mobile_number',
                    'customers.desired_plan',
                    'technical_details.lcp',
                    'technical_details.nap',
                    'technical_details.port',
                    'technical_details.username as pppoe_username'
                )
                ->first();

            $oldUsername = $fullInfo->pppoe_username ?? null;

            if (empty($oldUsername)) {
                \Log::info('[API SERVICE ORDER REACTIVATE RADIUS SKIP] No PPPoE username on the account');
                return 'no_username';
            }

            $pppoeService = new PppoeUsernameService();
            $newUsername = $pppoeService->generateUniqueUsername((array) $fullInfo);

            // The line moved but the name did not — a pattern that does not
            // encode the port, say. Renaming to the name already in use would be
            // a no-op on the device and a pointless session drop for the
            // customer, so stop here.
            if ($oldUsername === $newUsername) {
                \Log::info('[API SERVICE ORDER REACTIVATE RADIUS SKIP] Username unchanged', [
                    'account_no' => $accountNo,
                    'username'   => $oldUsername,
                ]);
                return 'no_change';
            }

            \Log::info("[API SERVICE ORDER REACTIVATE RADIUS] Renaming '{$oldUsername}' -> '{$newUsername}'");

            $credParams = [
                'accountNumber' => $accountNo,
                'username'      => $oldUsername,
                'newUsername'   => $newUsername,
                // Reactivation restores an account; it does not re-issue it. The
                // customer's router is still configured with the old password and
                // keeping it is what lets them come back up without a re-config.
                'newPassword'   => null,
                'updatedBy'     => $updatedByUser,
            ];

            $radiusSuccess = false;
            $lastRadiusError = '';

            for ($attempt = 1; $attempt <= 2; $attempt++) {
                $this->radiusSteps[] = ['step' => 'attempt_' . $attempt, 'operation' => 'reactivate', 'status' => 'trying'];

                try {
                    $radiusOps = app(ManualRadiusOperationsService::class);
                    $credResult = $radiusOps->updateCredentials($credParams);

                    if (($credResult['status'] ?? '') === 'success') {
                        $radiusSuccess = true;
                        $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = 'success';
                        \Log::channel('radiusrelated')->info("[API SERVICE ORDER REACTIVATE RADIUS] Renamed on attempt {$attempt}");
                        break;
                    }

                    $lastRadiusError = $credResult['message'] ?? 'Operation returned failure';
                    $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = 'failed';
                    \Log::channel('radiusrelated')->warning("[API SERVICE ORDER REACTIVATE RADIUS] Attempt {$attempt}/2 failed: {$lastRadiusError}");
                } catch (\Exception $radEx) {
                    $lastRadiusError = $radEx->getMessage();
                    $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = 'failed';
                    \Log::channel('radiusrelated')->warning("[API SERVICE ORDER REACTIVATE RADIUS] Attempt {$attempt}/2 exception: {$lastRadiusError}");
                }

                if ($attempt < 2) {
                    sleep(1);
                }
            }

            if ($radiusSuccess) {
                return 'success';
            }

            // updateCredentials renames the database before it touches the
            // device, so by here the account already holds the new name and the
            // device does not. Queuing the same call is what closes that gap —
            // the worker replays it until the device agrees. Losing it would
            // leave the customer unable to authenticate with either name.
            \Log::channel('radiusrelated')->error('[API SERVICE ORDER REACTIVATE RADIUS] All attempts failed. Queuing for retry.');
            $this->radiusSteps[] = ['step' => 'queued', 'operation' => 'reactivate', 'status' => 'trying'];

            $this->trackRadiusQueue([
                'organization_id' => $organizationId ?? null,
                'source_type'     => 'service_order',
                'source_id'       => $serviceOrderId ?? 0,
                'account_no'      => $accountNo,
                'operation'       => 'update_credentials',
                'params'          => $credParams,
                'last_error'      => $lastRadiusError,
                'created_by'      => $updatedByUser,
            ]);

            $this->radiusSteps[count($this->radiusSteps) - 1]['status'] = $this->radiusQueued ? 'success' : 'failed';

            return 'radius_failed';
        } catch (\Exception $e) {
            \Log::error('[API SERVICE ORDER REACTIVATE RADIUS EXCEPTION] ' . $e->getMessage());
            return 'exception';
        }
    }

    private function attemptMigration($billingAccount, $repairCategory = null, $updatedByUser = 'System', ?int $organizationId = null): string
    {
        try {
            $accountNo = $billingAccount->account_no;

            \Log::info('[API SERVICE ORDER MIGRATION] Force starting for account: ' . $accountNo);

            // Get data for username generation
            $fullInfo = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                'customers.first_name',
                'customers.middle_initial',
                'customers.last_name',
                'customers.contact_number_primary as mobile_number',
                'customers.desired_plan',
                'technical_details.lcp',
                'technical_details.nap',
                'technical_details.port',
                'technical_details.username as pppoe_username'
            )
                ->first();

            $oldUsername = $fullInfo->pppoe_username ?? null;

            if (empty($oldUsername)) {
                \Log::info('[API SERVICE ORDER MIGRATION SKIP] No PPPoE username found');
                return 'no_username';
            }

            \Log::info('[API SERVICE ORDER MIGRATION] Found old username: ' . $oldUsername);

            // SPECIAL CASE: Transfer LCP/NAP/PORT, Migrate & Reactivation
            $normalizedCategory = $repairCategory ? strtolower(trim($repairCategory)) : '';
            if ($normalizedCategory === 'transfer lcp/nap/port' || $normalizedCategory === 'migrate') {
                \Log::info("[API SERVICE ORDER] Handling {$repairCategory} via updateCredentials (rename in place)");

                // 1. Generate new username (keep existing password)
                $pppoeService = new PppoeUsernameService();
                $customerData = (array)$fullInfo;
                $newUsername = $pppoeService->generateUniqueUsername($customerData);

                \Log::info("[API SERVICE ORDER] Renaming username: '{$oldUsername}' -> '{$newUsername}'");

                // 2. Update Credentials with retry (3 attempts, then queue)
                $credParams = [
                    'accountNumber' => $accountNo,
                    'username' => $oldUsername,
                    'newUsername' => $newUsername,
                    'newPassword' => null,
                    'updatedBy' => $updatedByUser
                ];
                $radiusSuccess = false;
                $lastRadiusError = '';
                for ($attempt = 1; $attempt <= 2; $attempt++) {
                    try {
                        $radiusOps = app(ManualRadiusOperationsService::class);
                        $credResult = $radiusOps->updateCredentials($credParams);
                        if (($credResult['status'] ?? '') === 'success') {
                            $radiusSuccess = true;
                            \Log::info("[API SERVICE ORDER] Username renamed successfully on attempt {$attempt}");
                            break;
                        }
                        $lastRadiusError = $credResult['message'] ?? 'Operation returned failure';
                        \Log::channel('radiusrelated')->warning("[API SERVICE ORDER MIGRATION RADIUS] Attempt {$attempt}/3 failed: {$lastRadiusError}");
                    } catch (\Exception $radEx) {
                        $lastRadiusError = $radEx->getMessage();
                        \Log::channel('radiusrelated')->warning("[API SERVICE ORDER MIGRATION RADIUS] Attempt {$attempt}/3 exception: {$lastRadiusError}");
                    }
                    if ($attempt < 2) sleep(1);
                }
                if ($radiusSuccess) {
                    return 'success';
                }
                \Log::channel('radiusrelated')->error('[API SERVICE ORDER MIGRATION RADIUS] All 3 attempts failed. Queuing for retry.');
                $this->trackRadiusQueue([
                    'organization_id' => $organizationId ?? null,
                    'source_type' => 'service_order',
                    'source_id' => 0,
                    'account_no' => $accountNo,
                    'operation' => 'update_credentials',
                    'params' => $credParams,
                    'last_error' => $lastRadiusError,
                    'created_by' => $updatedByUser,
                ]);
                return 'radius_failed';
            }

            // Generate new username using the same logic as JobOrderController
            $pppoeService = new PppoeUsernameService();
            $customerData = (array)$fullInfo;
            $newUsername = $pppoeService->generateUniqueUsername($customerData);

            \Log::info('[API SERVICE ORDER MIGRATION] Generated new username', [
                'old' => $oldUsername,
                'new' => $newUsername
            ]);

            if ($oldUsername === $newUsername) {
                \Log::info('[API SERVICE ORDER MIGRATION SKIP] Username did not change');
                return 'no_change';
            }

            // RADIUS RENAME LOGIC — same approach as Transfer LCP/NAP/PORT:
            // updateCredentials does disable → kill session → PATCH name → re-enable in place.
            // No delete + recreate — that was wiping the user and breaking the connection.
            $targetCategories = ['relocate', 'relocate router', 'transfer lcp nap vlan'];

            if (in_array($normalizedCategory, $targetCategories)) {
                \Log::info("[API SERVICE ORDER] Handling {$normalizedCategory} via updateCredentials (rename in place)");

                $credParams = [
                    'accountNumber' => $accountNo,
                    'username' => $oldUsername,
                    'newUsername' => $newUsername,
                    'newPassword' => null,
                    'updatedBy' => $updatedByUser
                ];
                $radiusSuccess = false;
                $lastRadiusError = '';
                for ($attempt = 1; $attempt <= 2; $attempt++) {
                    try {
                        $radiusOps = app(ManualRadiusOperationsService::class);
                        $credResult = $radiusOps->updateCredentials($credParams);
                        if (($credResult['status'] ?? '') === 'success') {
                            $radiusSuccess = true;
                            \Log::info("[API SERVICE ORDER MIGRATION] Username renamed on attempt {$attempt}");
                            break;
                        }
                        $lastRadiusError = $credResult['message'] ?? 'Operation returned failure';
                        \Log::channel('radiusrelated')->warning("[API SERVICE ORDER MIGRATION RADIUS] Attempt {$attempt}/3 failed: {$lastRadiusError}");
                    } catch (\Exception $radEx) {
                        $lastRadiusError = $radEx->getMessage();
                        \Log::channel('radiusrelated')->warning("[API SERVICE ORDER MIGRATION RADIUS] Attempt {$attempt}/3 exception: {$lastRadiusError}");
                    }
                    if ($attempt < 2) sleep(1);
                }
                if ($radiusSuccess) {
                    return 'success';
                }
                \Log::channel('radiusrelated')->error('[API SERVICE ORDER MIGRATION RADIUS] All 3 attempts failed. Queuing for retry.');
                $this->trackRadiusQueue([
                    'organization_id' => $organizationId ?? null,
                    'source_type' => 'service_order',
                    'source_id' => 0,
                    'account_no' => $accountNo,
                    'operation' => 'update_credentials',
                    'params' => $credParams,
                    'last_error' => $lastRadiusError,
                    'created_by' => $updatedByUser,
                ]);
                return 'radius_failed';
            }
            else {
                // For other categories, DB-only update (no RADIUS change needed)
                \Log::info('[API SERVICE ORDER MIGRATION PROCEED] Updating database credentials (DB ONLY) for ' . $oldUsername);

                DB::table('technical_details')
                    ->where('account_id', $billingAccount->id)
                    ->update([
                    'username' => $newUsername,
                    'updated_at' => now(),
                    'updated_by' => $updatedByUser
                ]);

                DB::table('job_orders')
                    ->where('account_id', $billingAccount->id)
                    ->update([
                    'pppoe_username' => $newUsername,
                    'username' => $newUsername,
                    'updated_at' => now()
                ]);

                \Log::info('[API SERVICE ORDER MIGRATION SUCCESS] DB Only migration completed');
                return 'success';
            }


        }
        catch (\Exception $e) {
            \Log::error('[API SERVICE ORDER MIGRATION EXCEPTION] ' . $e->getMessage());
            return 'exception';
        }
    }

    public function broadcastViewing(Request $request)
    {
        try {
            $serviceOrderId = $request->input('service_order_id');
            $action = $request->input('action', 'started_viewing');
            $username = auth()->user()->username ?? 'Guest';

            event(new \App\Events\ServiceOrderViewingUpdate($serviceOrderId, $username, $action));

            return response()->json([
                'success' => true,
                'message' => 'Viewing update broadcasted'
            ]);
        } catch (\Throwable $e) {
            \Log::error('[Presence] service order broadcastViewing error: ' . $e->getMessage(), [
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