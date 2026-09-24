<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MonitorController extends Controller
{
    public function handle(Request $request)
    {
        $authUser = auth()->user();
        if (!$authUser) {
            return response()->json(['status' => 'error', 'message' => 'Unauthorized'], 401);
        }

        $organizationId = $authUser->organization_id;

        // Allow SuperAdmins (null org) to filter by a specific organization if provided in request
        if ($organizationId === null && $request->has('organization_id')) {
            $reqOrgId = $request->input('organization_id');
            if ($reqOrgId !== '' && $reqOrgId !== 'null' && $reqOrgId !== 'All') {
                $organizationId = $reqOrgId;
            }
        }

        $roleId = $authUser->role_id;

        $action = $request->query('action', $request->input('action', ''));
        $param = $request->query('param', '');
        $year = $request->query('year', date('Y'));

        // scope: overall | today | custom
        $scope = $request->query('scope', 'overall');
        $start = $request->query('start', '');
        $end = $request->query('end', '');

        // barangay filter (uses applications.barangay / customers.barangay where available)
        $bgy = $request->query('bgy', 'All');

        $response = [
            'status' => 'empty',
            'data' => [],
        ];

        try {
            // -------------------------
            // Helpers
            // -------------------------
            $applyScope = function ($qb, string $col) use ($scope, $start, $end) {
                $now = \Carbon\Carbon::now('Asia/Manila');

                if ($scope === 'today') {
                    // Start of literal today
                    return $qb->where($col, '>=', $now->copy()->startOfDay());
                }

                if ($scope === 'weekly') {
                    // Start of current week
                    return $qb->where($col, '>=', $now->copy()->startOfWeek());
                }

                if ($scope === '3weeks') {
                    // Start of 3 weeks ago
                    return $qb->where($col, '>=', $now->copy()->subWeeks(3)->startOfDay());
                }

                if ($scope === 'monthly') {
                    // Start of current month
                    return $qb->where($col, '>=', $now->copy()->startOfMonth());
                }

                if ($scope === '3months') {
                    // Start of 3 months ago
                    return $qb->where($col, '>=', $now->copy()->subMonths(3)->startOfMonth());
                }

                if ($scope === 'yearly') {
                    // Start of current year
                    return $qb->where($col, '>=', $now->copy()->startOfYear());
                }

                if ($scope === 'custom' && $start && $end) {
                    // If you pass date only (YYYY-MM-DD), it still works.
                    return $qb->whereBetween($col, [$start, $end]);
                }

                return $qb; // overall
            };

            $applyBarangayOnApplications = function ($qb, string $col = 'applications.barangay') use ($bgy) {
                if (!$bgy || $bgy === 'All')
                    return $qb;
                return $qb->where($col, $bgy);
            };

            $applyOrg = function ($qb, string $table) use ($organizationId) {
                return $qb->where($table . '.organization_id', $organizationId);
            };

            // -------------------------
            // Barangay list (from barangay table)
            // Only fetch for actions that actually use barangay filtering.
            // Skipping this on yearly-chart actions saves a redundant query per request.
            // -------------------------
            $barangayActions = ['billing_status', 'app_status', 'so_status', 'jo_status', 'queue_mon', 'app_map'];
            if (in_array($action, $barangayActions, true)) {
                $barangays = DB::table('barangay')
                    ->select(DB::raw('TRIM(barangay) as Name'))
                    ->where('barangay', '!=', '')
                    ->orderBy('barangay')
                    ->get();
                $response['barangays'] = $barangays;
            } else {
                $response['barangays'] = [];
            }

            // -------------------------
            // TEMPLATE MANAGEMENT
            // dashboard_templates: id, template_name, layout_data, style_data
            // -------------------------
            // -------------------------
            // TEMPLATE MANAGEMENT
            // Uses App\Models\DashboardTemplate
            // -------------------------
            if ($action === 'save_template') {
                $name = $request->input('name', 'Untitled');
                $layout = $request->input('layout', '[]');
                $styles = $request->input('styles', '{}');

                if (is_string($layout)) {
                    $decoded = json_decode($layout, true);
                    if (json_last_error() === JSON_ERROR_NONE)
                        $layout = $decoded;
                }

                if (is_string($styles)) {
                    $decoded = json_decode($styles, true);
                    if (json_last_error() === JSON_ERROR_NONE)
                        $styles = $decoded;
                }

                $template = \App\Models\DashboardTemplate::create([
                    'template_name' => $name,
                    'layout_data' => $layout,
                    'style_data' => $styles,
                ]);

                return response()->json([
                    'status' => 'success',
                    'id' => $template->id,
                    'message' => 'Template saved successfully',
                ]);
            }

            if ($action === 'update_template') {
                $id = $request->input('id');
                $layout = $request->input('layout', '[]');
                $styles = $request->input('styles', '{}');

                if (is_string($layout)) {
                    $decoded = json_decode($layout, true);
                    if (json_last_error() === JSON_ERROR_NONE)
                        $layout = $decoded;
                }

                if (is_string($styles)) {
                    $decoded = json_decode($styles, true);
                    if (json_last_error() === JSON_ERROR_NONE)
                        $styles = $decoded;
                }

                $template = \App\Models\DashboardTemplate::find($id);
                if ($template) {
                    $template->update([
                        'layout_data' => $layout,
                        'style_data' => $styles,
                    ]);
                    return response()->json(['status' => 'success', 'message' => 'Template updated successfully']);
                }
                return response()->json(['status' => 'error', 'message' => 'Template not found'], 404);
            }

            if ($action === 'list_templates') {
                $data = \App\Models\DashboardTemplate::select('id', 'template_name', 'created_at')
                    ->orderByDesc('created_at')
                    ->get();

                return response()->json(['status' => 'success', 'data' => $data]);
            }

            if ($action === 'load_template') {
                $id = $request->query('id', 0);
                $template = \App\Models\DashboardTemplate::find($id);

                if ($template)
                    return response()->json(['status' => 'success', 'data' => $template]);
                return response()->json(['status' => 'error', 'message' => 'Template not found'], 404);
            }

            if ($action === 'delete_template') {
                $id = $request->input('id', 0);
                \App\Models\DashboardTemplate::destroy($id);
                return response()->json(['status' => 'success']);
            }

            // -------------------------
            // DATA ACTIONS (based on your SQL dump tables)
            // -------------------------

            // 1) BILLING STATUS (based on billing_accounts + billing_status)
            // NOTE: billing_accounts.billing_status_id -> billing_status.id
            if ($action === 'billing_status') {
                $qb = DB::table('billing_accounts')
                    ->leftJoin('billing_status', 'billing_accounts.billing_status_id', '=', 'billing_status.id')
                    ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                    ->where('customers.organization_id', $organizationId)
                    ->select(
                        DB::raw("COALESCE(billing_status.status_name, 'Regular') as label"),
                        DB::raw('COUNT(*) as value')
                    )
                    ->groupBy('billing_status.status_name');

                if ($bgy && $bgy !== 'All') {
                    $qb->where('customers.barangay', $bgy);
                }

                $response['data'] = $qb->get();
                $response['status'] = 'success';
                return response()->json($response);
            }

            // 2) ONLINE STATUS (online_status.session_status or session_status?)
            if ($action === 'online_status') {
                $qb = DB::table('online_status')
                    ->join('billing_accounts', 'online_status.account_id', '=', 'billing_accounts.id')
                    ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                    ->where('customers.organization_id', $organizationId)
                    ->select(
                        DB::raw("COALESCE(online_status.session_status, 'Unknown') as label"),
                        DB::raw('COUNT(*) as value')
                    )
                    ->groupBy('online_status.session_status');

                $response['data'] = $qb->get();
                $response['status'] = 'success';
                return response()->json($response);
            }

            // 3) APPLICATION STATUS (applications.status)
            if ($action === 'app_status') {
                $qb = DB::table('applications');
                $applyOrg($qb, 'applications');
                $qb->select(
                        DB::raw("COALESCE(status, 'Pending') as label"),
                        DB::raw('COUNT(*) as value')
                    );

                $applyScope($qb, 'applications.timestamp');
                $applyBarangayOnApplications($qb, 'applications.barangay');

                $qb->groupBy(DB::raw("COALESCE(status, 'Pending')"));

                $response['data'] = $qb->get();
                $response['status'] = 'success';
                return response()->json($response);
            }

            // 4) SO/JO STATUS
            // - job_orders: onsite_status / visit_status is in service_orders (visit_status)
            if ($action === 'jo_status') {
                // param: onsite | billing (you had more in old file; your table has onsite_status)
                $col = ($param === 'onsite') ? 'job_orders.onsite_status' : 'job_orders.onsite_status';

                $qb = DB::table('job_orders');
                $applyOrg($qb, 'job_orders');
                $qb->select(
                        DB::raw("COALESCE($col, 'Unknown') as label"),
                        DB::raw('COUNT(*) as value')
                    );

                $applyScope($qb, 'job_orders.timestamp');

                // optional barangay filter via applications (job_orders.application_id)
                $qb->leftJoin('applications', 'job_orders.application_id', '=', 'applications.id');
                $applyBarangayOnApplications($qb, 'applications.barangay');

                $qb->whereNotNull($col)->where($col, '!=', '');
                $qb->groupBy(DB::raw($col));

                $response['data'] = $qb->get();
                $response['status'] = 'success';
                return response()->json($response);
            }

            if ($action === 'so_status') {
                // param: visit | support (your table has support_status + visit_status)
                $col = ($param === 'support') ? 'service_orders.support_status' : 'service_orders.visit_status';

                $qb = DB::table('service_orders');
                $applyOrg($qb, 'service_orders');
                $qb->select(
                        DB::raw("COALESCE($col, 'Unknown') as label"),
                        DB::raw('COUNT(*) as value')
                    );

                $applyScope($qb, 'service_orders.timestamp');

                // optional barangay filter via billing_accounts->customers
                $qb->leftJoin('billing_accounts', 'service_orders.account_no', '=', 'billing_accounts.account_no')
                    ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id');

                if ($bgy && $bgy !== 'All') {
                    $qb->where('customers.barangay', $bgy);
                }

                $qb->whereNotNull($col)->where($col, '!=', '');
                $qb->groupBy(DB::raw($col));

                $response['data'] = $qb->get();
                $response['status'] = 'success';
                return response()->json($response);
            }

            // 5) QUEUE MONITOR (In Progress per assigned_email)
            if ($action === 'queue_mon') {
                $isJo = ($param === 'jo');

                if ($isJo) {
                    $qb = DB::table('job_orders');
                    $applyOrg($qb, 'job_orders');
                    $qb->select('assigned_email as raw_email', DB::raw('COUNT(*) as value'))
                        ->where('onsite_status', 'In Progress')
                        ->whereNotNull('assigned_email')
                        ->where('assigned_email', '!=', '');

                    $applyScope($qb, 'job_orders.timestamp');
                    $qb->groupBy('assigned_email');

                    // optional barangay filter via applications
                    $qb->leftJoin('applications', 'job_orders.application_id', '=', 'applications.id');
                    $applyBarangayOnApplications($qb, 'applications.barangay');
                } else {
                    $qb = DB::table('service_orders');
                    $applyOrg($qb, 'service_orders');
                    $qb->select('assigned_email as raw_email', DB::raw('COUNT(*) as value'))
                        ->where('visit_status', 'In Progress')
                        ->whereNotNull('assigned_email')
                        ->where('assigned_email', '!=', '');

                    $applyScope($qb, 'service_orders.timestamp');
                    $qb->groupBy('assigned_email');

                    // optional barangay filter via billing_accounts->customers
                    $qb->leftJoin('billing_accounts', 'service_orders.account_no', '=', 'billing_accounts.account_no')
                        ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id');

                    if ($bgy && $bgy !== 'All') {
                        $qb->where('customers.barangay', $bgy);
                    }
                }

                $raw = $qb->get();

                $data = [];
                foreach ($raw as $row) {
                    $email = $row->raw_email ?? '';
                    $beforeAt = explode('@', $email)[0] ?? $email;
                    $name = ucwords(str_replace(['.', '_'], ' ', $beforeAt));
                    $data[] = ['label' => $name, 'value' => (int) $row->value];
                }

                return response()->json(['status' => 'success', 'data' => $data, 'barangays' => $response['barangays']]);
            }

            // 6) TECH PERFORMANCE (Done/Reschedule/Failed)
            // job_orders: visit_by, visit_with, visit_with_other + onsite_status
            // service_orders: visit_by_user, visit_with + visit_status
            if ($action === 'tech_mon_jo') {
                // Query 1: visit_by
                $qb1 = DB::table('job_orders');
                $applyOrg($qb1, 'job_orders');
                $qb1->select(
                        DB::raw("UPPER(TRIM(visit_by)) as tech"),
                        DB::raw("onsite_status as status"),
                        DB::raw("COUNT(*) as count")
                    )
                    ->whereIn('onsite_status', ['Done', 'Reschedule', 'Failed'])
                    ->whereNotNull('visit_by')->where('visit_by', '!=', '');

                $applyScope($qb1, 'job_orders.updated_at');
                $rows1 = $qb1->groupBy(DB::raw("UPPER(TRIM(visit_by))"), 'onsite_status')->get();

                // Query 2: visit_with
                $qb2 = DB::table('job_orders');
                $applyOrg($qb2, 'job_orders');
                $qb2->select(DB::raw("UPPER(TRIM(visit_with)) as tech"), DB::raw("onsite_status as status"), DB::raw("COUNT(*) as count"))
                    ->whereIn('onsite_status', ['Done', 'Reschedule', 'Failed'])
                    ->whereNotNull('visit_with')->where('visit_with', '!=', '');

                $applyScope($qb2, 'job_orders.updated_at');
                $rows2 = $qb2->groupBy(DB::raw("UPPER(TRIM(visit_with))"), 'onsite_status')->get();

                // Query 3: visit_with_other
                $qb3 = DB::table('job_orders');
                $applyOrg($qb3, 'job_orders');
                $qb3->select(DB::raw("UPPER(TRIM(visit_with_other)) as tech"), DB::raw("onsite_status as status"), DB::raw("COUNT(*) as count"))
                    ->whereIn('onsite_status', ['Done', 'Reschedule', 'Failed'])
                    ->whereNotNull('visit_with_other')->where('visit_with_other', '!=', '');

                $applyScope($qb3, 'job_orders.updated_at');
                $rows3 = $qb3->groupBy(DB::raw("UPPER(TRIM(visit_with_other))"), 'onsite_status')->get();

                $all = $rows1->concat($rows2)->concat($rows3);

                $structured = [];
                foreach ($all as $r) {
                    $tech = ucwords(strtolower($r->tech ?? ''));
                    if ($tech === '')
                        continue;
                    if (!isset($structured[$tech]))
                        $structured[$tech] = ['label' => $tech, 'series' => []];
                    $structured[$tech]['series'][$r->status] = ($structured[$tech]['series'][$r->status] ?? 0) + (int) $r->count;
                }

                return response()->json(['status' => 'success', 'data' => array_values($structured), 'barangays' => $response['barangays']]);
            }

            if ($action === 'tech_mon_so') {
                // Query 1: visit_by_user
                $qb1 = DB::table('service_orders');
                $applyOrg($qb1, 'service_orders');
                $qb1->select(DB::raw("UPPER(TRIM(visit_by_user)) as tech"), DB::raw("visit_status as status"), DB::raw("COUNT(*) as count"))
                    ->whereIn('visit_status', ['Done', 'Reschedule', 'Failed'])
                    ->whereNotNull('visit_by_user')->where('visit_by_user', '!=', '');

                $applyScope($qb1, 'service_orders.updated_at');
                $rows1 = $qb1->groupBy(DB::raw("UPPER(TRIM(visit_by_user))"), 'visit_status')->get();

                // Query 2: visit_with
                $qb2 = DB::table('service_orders');
                $applyOrg($qb2, 'service_orders');
                $qb2->select(DB::raw("UPPER(TRIM(visit_with)) as tech"), DB::raw("visit_status as status"), DB::raw("COUNT(*) as count"))
                    ->whereIn('visit_status', ['Done', 'Reschedule', 'Failed'])
                    ->whereNotNull('visit_with')->where('visit_with', '!=', '');

                $applyScope($qb2, 'service_orders.updated_at');
                $rows2 = $qb2->groupBy(DB::raw("UPPER(TRIM(visit_with))"), 'visit_status')->get();

                $all = $rows1->concat($rows2);

                $structured = [];
                foreach ($all as $r) {
                    $tech = ucwords(strtolower($r->tech ?? ''));
                    if ($tech === '')
                        continue;
                    if (!isset($structured[$tech]))
                        $structured[$tech] = ['label' => $tech, 'series' => []];
                    $structured[$tech]['series'][$r->status] = ($structured[$tech]['series'][$r->status] ?? 0) + (int) $r->count;
                }

                return response()->json(['status' => 'success', 'data' => array_values($structured), 'barangays' => $response['barangays']]);
            }

            // 7) INVOICE/TRANSACTIONS/PORTAL yearly chart
            // Shows count of each status (Paid, Unpaid, etc.) for the selected year
            // X-axis: Status values (Paid, Unpaid, Pending, etc.), Y-axis: Count or Amount
            if (in_array($action, ['invoice_mon', 'transactions_mon', 'portal_mon'], true)) {
                // Use a date range instead of YEAR() function so MySQL can use an index on the date column
                $yearStart = $year . '-01-01';
                $yearEnd   = $year . '-12-31';

                $months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                $result = [];
                foreach ($months as $m) {
                    $result[$m] = ['label' => $m, 'series' => []];
                }

                if ($action === 'invoice_mon') {
                    $qb = DB::table('invoices');
                    $applyOrg($qb, 'invoices');
                    $qb->select(
                            DB::raw("MONTH(invoice_date) as month_num"),
                            DB::raw("MONTHNAME(invoice_date) as month_name"),
                            DB::raw("IFNULL(status, 'Unknown') as status_value"),
                            $param === 'amount'
                            ? DB::raw("SUM(IFNULL(total_amount, 0)) as value")
                            : DB::raw("COUNT(*) as value")
                        )
                        ->whereBetween('invoice_date', [$yearStart, $yearEnd])
                        ->whereNotNull('invoice_date')
                        ->groupBy(DB::raw("MONTH(invoice_date)"), DB::raw("MONTHNAME(invoice_date)"), DB::raw("IFNULL(status, 'Unknown')"))
                        ->orderBy(DB::raw("MONTH(invoice_date)"));

                    foreach ($qb->get() as $row) {
                        if (isset($result[$row->month_name])) {
                            $result[$row->month_name]['series'][$row->status_value] = (float) $row->value;
                        }
                    }
                } elseif ($action === 'transactions_mon') {
                    $qb = DB::table('transactions');
                    $applyOrg($qb, 'transactions');
                    $qb->select(
                            DB::raw("MONTH(date_processed) as month_num"),
                            DB::raw("MONTHNAME(date_processed) as month_name"),
                            DB::raw("IFNULL(status, 'Unknown') as status_value"),
                            $param === 'amount'
                            ? DB::raw("SUM(IFNULL(received_payment, 0)) as value")
                            : DB::raw("COUNT(*) as value")
                        )
                        ->whereBetween('date_processed', [$yearStart, $yearEnd])
                        ->whereNotNull('date_processed')
                        ->groupBy(DB::raw("MONTH(date_processed)"), DB::raw("MONTHNAME(date_processed)"), DB::raw("IFNULL(status, 'Unknown')"))
                        ->orderBy(DB::raw("MONTH(date_processed)"));

                    foreach ($qb->get() as $row) {
                        if (isset($result[$row->month_name])) {
                            $result[$row->month_name]['series'][$row->status_value] = (float) $row->value;
                        }
                    }
                } else {
                    // portal_mon
                    $qb = DB::table('payment_portal_logs');
                    $applyOrg($qb, 'payment_portal_logs');
                    $qb->select(
                            DB::raw("MONTH(date_time) as month_num"),
                            DB::raw("MONTHNAME(date_time) as month_name"),
                            DB::raw("IFNULL(status, 'Unknown') as status_value"),
                            $param === 'amount'
                            ? DB::raw("SUM(IFNULL(total_amount, 0)) as value")
                            : DB::raw("COUNT(*) as value")
                        )
                        ->whereBetween('date_time', [$yearStart, $yearEnd])
                        ->whereNotNull('date_time')
                        ->groupBy(DB::raw("MONTH(date_time)"), DB::raw("MONTHNAME(date_time)"), DB::raw("IFNULL(status, 'Unknown')"))
                        ->orderBy(DB::raw("MONTH(date_time)"));

                    foreach ($qb->get() as $row) {
                        if (isset($result[$row->month_name])) {
                            $result[$row->month_name]['series'][$row->status_value] = (float) $row->value;
                        }
                    }
                }

                return response()->json([
                    'status' => 'success',
                    'data' => array_values($result),
                    'barangays' => $response['barangays']
                ]);
            }

            // 8) EXPENSES — table is `expenses_logs` (plural) and the date column is
            // `date`. This block previously read `expenses_log`.`expense_date`, neither
            // of which exists, so the action always errored. category_id is real as of
            // the Expenses module migration.
            if ($action === 'expenses_mon') {
                $qb = DB::table('expenses_logs');
                $applyOrg($qb, 'expenses_logs');
                $qb->leftJoin('expenses_category', 'expenses_logs.category_id', '=', 'expenses_category.id')
                    ->select(
                        // Rows predating categories carry only the free-text `category`
                        // string; without that middle fallback they would all collapse
                        // into a single "Unknown" slice.
                        DB::raw("COALESCE(expenses_category.category_name, NULLIF(expenses_logs.category, ''), 'Unknown') as label"),
                        DB::raw("SUM(COALESCE(expenses_logs.amount,0)) as value")
                    );

                // Raw query builder, so the model's SoftDeletes scope does not apply here.
                $qb->whereNull('expenses_logs.deleted_at');

                $applyScope($qb, 'expenses_logs.date');
                // Grouped by the alias, not by category_name: the label expression reads
                // expenses_logs.category too, which ONLY_FULL_GROUP_BY would otherwise reject.
                $qb->groupBy('label')
                    ->orderByDesc('value');

                return response()->json(['status' => 'success', 'data' => $qb->get(), 'barangays' => $response['barangays']]);
            }

            // 9) PAYMENT METHODS (transactions.payment_method)
            if ($action === 'pay_method_mon') {
                $qb = DB::table('transactions');
                $applyOrg($qb, 'transactions');
                $qb->select(
                        DB::raw("COALESCE(payment_method, 'Unknown') as label"),
                        DB::raw("SUM(COALESCE(received_payment,0)) as value")
                    )
                    ->whereNotNull('payment_method')
                    ->where('payment_method', '!=', '');

                $applyScope($qb, 'transactions.date_processed');
                $qb->groupBy('payment_method')
                    ->orderByDesc('value');

                return response()->json(['status' => 'success', 'data' => $qb->get(), 'barangays' => $response['barangays']]);
            }

            // 10) MAP (applications.long_lat or applications.location? you have long_lat varchar(255))
            if ($action === 'app_map') {
                $qb = DB::table('applications');
                $applyOrg($qb, 'applications');
                $qb->select('first_name', 'middle_initial', 'last_name', 'long_lat', 'desired_plan', 'barangay')
                    ->whereNotNull('long_lat')
                    ->where('long_lat', '!=', '');

                $applyScope($qb, 'applications.timestamp');
                $applyBarangayOnApplications($qb, 'applications.barangay');

                $raw = $qb->get();
                $data = [];
                foreach ($raw as $row) {
                    $data[] = [
                        'name' => trim(($row->first_name ?? '') . ' ' . ($row->last_name ?? '')),
                        'coords' => $row->long_lat,
                        'plan' => $row->desired_plan,
                        'bgy' => $row->barangay,
                    ];
                }

                return response()->json(['status' => 'success', 'data' => $data, 'barangays' => $response['barangays']]);
            }

            // 11) REFER RANK (applications.referred_by via job_orders.application_id)
            if ($action === 'jo_refer_rank') {
                $qb = DB::table('job_orders')
                    ->join('applications', 'job_orders.application_id', '=', 'applications.id');
                
                $applyOrg($qb, 'job_orders');

                $qb->select(
                        DB::raw("COALESCE(applications.referred_by, 'Unknown') as label"),
                        DB::raw("COUNT(*) as value")
                    )
                    ->where('job_orders.onsite_status', 'Done')
                    ->whereNotNull('applications.referred_by')
                    ->where('applications.referred_by', '!=', '');

                $applyScope($qb, 'job_orders.timestamp');

                $qb->groupBy('applications.referred_by')
                    ->orderByDesc('value')
                    ->limit(20);

                // Grouped on the stored value so the counts stay exact, then
                // relabelled: a referral made through the agent picker holds
                // the agent's user id, and the chart names the agent.
                $ranked = $qb->get();
                \App\Support\AgentReferral::prime($ranked->pluck('label'));
                $ranked = $ranked->map(function ($row) {
                    $row->label = \App\Support\AgentReferral::displayName($row->label);
                    return $row;
                })
                    // An agent referred both by id (picker) and by their typed
                    // name would otherwise appear as two bars with one label.
                    ->groupBy('label')
                    ->map(fn ($rows, $label) => (object) ['label' => $label, 'value' => (int) $rows->sum('value')])
                    ->sortByDesc('value')
                    ->values();

                return response()->json(['status' => 'success', 'data' => $ranked, 'barangays' => $response['barangays']]);
            }

            // 12) INVOICE OVERALL (invoices.status)
            if ($action === 'invoice_overall') {
                $qb = DB::table('invoices');
                $applyOrg($qb, 'invoices');
                $qb->select(
                        DB::raw("COALESCE(status, 'Unknown') as label"),
                        DB::raw("COUNT(*) as value")
                    )
                    ->groupBy('status');

                return response()->json(['status' => 'success', 'data' => $qb->get(), 'barangays' => $response['barangays']]);
            }

            // 12.1) DASHBOARD COUNTS (New)
            if ($action === 'dashboard_counts') {
                $counts = [
                    'so_support_in_progress' => DB::table('service_orders')->where('organization_id', $organizationId)->where('support_status', 'In Progress')->count(),
                    'so_visit_in_progress' => DB::table('service_orders')->where('organization_id', $organizationId)->where('visit_status', 'In Progress')->count(),
                    'so_visit_pullout_in_progress' => DB::table('service_orders')
                        ->leftJoin('support_concern', 'service_orders.concern_id', '=', 'support_concern.id')
                        ->where('service_orders.organization_id', $organizationId)
                        ->where('service_orders.visit_status', 'In Progress')
                        ->where(function ($q) {
                            $q->where('support_concern.concern_name', 'LIKE', '%Pullout%')
                                ->orWhere('service_orders.concern_remarks', 'LIKE', '%Pullout%');
                        })
                        ->count(),
                    'app_pending' => DB::table('applications')->where('organization_id', $organizationId)->where('status', 'Pending')->count(),
                    'jo_in_progress' => DB::table('job_orders')->where('organization_id', $organizationId)->where('onsite_status', 'In Progress')->count(),
                    'radius_online' => DB::table('online_status')
                        ->join('billing_accounts', 'online_status.account_id', '=', 'billing_accounts.id')
                        ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                        ->where('customers.organization_id', $organizationId)
                        ->where('online_status.session_status', 'Online')->count(),
                    'radius_offline' => DB::table('online_status')
                        ->join('billing_accounts', 'online_status.account_id', '=', 'billing_accounts.id')
                        ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                        ->where('customers.organization_id', $organizationId)
                        ->where('online_status.session_status', 'Offline')->count(),
                    'radius_restricted' => DB::table('online_status')
                        ->join('billing_accounts', 'online_status.account_id', '=', 'billing_accounts.id')
                        ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                        ->where('customers.organization_id', $organizationId)
                        ->where('online_status.session_status', 'Restricted')->count(),
                    'radius_disconnected' => DB::table('online_status')
                        ->join('billing_accounts', 'online_status.account_id', '=', 'billing_accounts.id')
                        ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                        ->where('customers.organization_id', $organizationId)
                        ->where('online_status.session_status', 'Disconnected')->count(),
                ];

                return response()->json(['status' => 'success', 'data' => $counts]);
            }


            // 13) TECHNICIAN AVAILABILITY
            if ($action === 'tech_live_location') {
                if (!in_array((int) $roleId, [1, 7, 8], true)) {
                    return response()->json(['status' => 'error', 'message' => 'Forbidden'], 403);
                }
                $response['data'] = \App\Http\Controllers\Api\TechnicianLocationController::fetchLocations($authUser, $request);
                $response['status'] = 'success';
                return response()->json($response);
            }

            if ($action === 'technician_availability') {
                $customStartTime = $request->query('custom_start_time');
                $techs = DB::table('users')
                    ->where('users.role_id', 2)
                    ->where('users.organization_id', $organizationId)
                    ->leftJoin('tech_in_out', 'users.id', '=', 'tech_in_out.tech_id')
                    ->select('users.id as tech_id', 'users.username', 'users.email_address', 'users.first_name', 'users.last_name', 'users.created_at', 'tech_in_out.status as tech_status', 'tech_in_out.time_in', 'tech_in_out.time_out', 'tech_in_out.last_updated')
                    ->get();

                $data = [];
                $now = \Carbon\Carbon::now('Asia/Manila');
                $viewStart = $now->copy()->startOfDay();

                // Apply custom start time if provided (format HH:mm)
                $applyCustomStart = function($baseDate) use ($customStartTime) {
                    if ($customStartTime && preg_match('/^([01][0-9]|2[0-3]):([0-5][0-9])$/', $customStartTime)) {
                        try {
                            return \Carbon\Carbon::createFromFormat('Y-m-d H:i', $baseDate->toDateString() . ' ' . $customStartTime, 'Asia/Manila');
                        } catch (\Exception $e) {
                            return $baseDate->startOfDay();
                        }
                    }
                    return $baseDate->startOfDay();
                };

                switch ($scope) {
                    case 'today':
                        $viewStart = $applyCustomStart($now->copy());
                        break;
                    case 'weekly':
                        $viewStart = $now->copy()->startOfWeek();
                        break;
                    case '3weeks':
                        $viewStart = $now->copy()->subWeeks(3)->startOfDay();
                        break;
                    case 'monthly':
                        $viewStart = $now->copy()->startOfMonth();
                        break;
                    case '3months':
                        $viewStart = $now->copy()->subMonths(3)->startOfMonth();
                        break;
                    case 'yearly':
                        $viewStart = $now->copy()->startOfYear();
                        break;
                    case 'custom':
                        $viewStart = $start ? \Carbon\Carbon::parse($start, 'Asia/Manila') : $now->copy()->startOfDay();
                        break;
                    case 'overall':
                    default:
                        $viewStart = $applyCustomStart($now->copy());
                        break;
                }

                $viewStartStr = $viewStart->toDateTimeString();

                foreach ($techs as $tech) {
                    $email = $tech->email_address;
                    $name = trim(($tech->first_name ?? '') . ' ' . ($tech->last_name ?? ''));
                    if (!$name) $name = $tech->username;

                    // 1. Fetch ALL tasks (JO/SO) strictly where start_time is Today onwards
                    $dailyJOs = DB::table('job_orders')
                        ->where('organization_id', $organizationId)
                        ->where('assigned_email', $email)
                        ->where(function($q) use ($viewStartStr) {
                            $q->where('start_time', '>=', $viewStartStr)
                              ->orWhere('end_time', '>=', $viewStartStr)
                              ->orWhereNull('end_time');
                        })
                        ->select('id', 'start_time', 'end_time', 'onsite_status as status', 'technicians', DB::raw("'jo' as task_type"))
                        ->get();

                    $dailySOs = DB::table('service_orders')
                        ->where('organization_id', $organizationId)
                        ->where('assigned_email', $email)
                        ->where(function($q) use ($viewStartStr) {
                            $q->where('start_time', '>=', $viewStartStr)
                              ->orWhere('end_time', '>=', $viewStartStr)
                              ->orWhereNull('end_time');
                        })
                        ->select('id', 'start_time', 'end_time', 'visit_status as status', 'technicians', DB::raw("'so' as task_type"), 'concern')
                        ->get();

                    $dailyWOs = DB::table('work_order')
                        ->where('organization_id', $organizationId)
                        ->where('assign_to', $email)
                        ->where(function($q) use ($viewStartStr) {
                            $q->where('start_time', '>=', $viewStartStr)
                              ->orWhere('end_time', '>=', $viewStartStr)
                              ->orWhereNull('end_time');
                        })
                        ->select('id', 'start_time', 'end_time', 'work_status as status', DB::raw("NULL as technicians"), DB::raw("'wo' as task_type"), 'work_category as concern')
                        ->get();

                    $allTasks = $dailyJOs->concat($dailySOs)->concat($dailyWOs)
                        ->filter(function($t) {
                            return strtolower(trim($t->status ?? '')) !== 'failed';
                        })
                        ->sortBy('start_time');

                    // 2. Timeline Calculation: Flattened to avoid double-counting overlapping tasks
                    $totalWorkingSeconds = 0;
                    $totalAvailableSeconds = 0;
                    
                    $isOffline = (strtolower($tech->tech_status ?? '') === 'offline');
                    $timeBound = $now->copy();

                    if ($isOffline) {
                        if (!empty($tech->time_out)) {
                            $timeBound = \Carbon\Carbon::parse($tech->time_out, 'Asia/Manila');
                        } elseif (!empty($tech->last_updated)) {
                            $timeBound = \Carbon\Carbon::parse($tech->last_updated, 'Asia/Manila');
                        }
                    }

                    // 2b. Daily JO/SO counts for the widget.
                    //
                    // Counted on OVERLAP with the view window: a task that began yesterday and was
                    // finished today belongs to today, so start_time alone is not enough to place
                    // it. Re-filtered against the window rather than just counting $allTasks,
                    // because the queries above deliberately pull in ANY task with a NULL end_time
                    // regardless of date (the timeline needs those to spot work in progress) — so
                    // counting $allTasks directly would let an abandoned task from weeks ago
                    // inflate today's figure. Tasks with no start_time are excluded: they are
                    // assigned but never begun, so nothing was done.
                    $completedTaskStatuses = ['done', 'completed', 'resolved'];
                    $tasksInWindow = $allTasks->filter(function ($t) use ($viewStart, $timeBound, $completedTaskStatuses) {
                        if (empty($t->start_time)) {
                            return false;
                        }
                        try {
                            $taskStart = \Carbon\Carbon::parse($t->start_time, 'Asia/Manila');
                            $isCompleted = in_array(strtolower(trim($t->status ?? '')), $completedTaskStatuses, true);
                            $taskEnd = $t->end_time
                                ? \Carbon\Carbon::parse($t->end_time, 'Asia/Manila')
                                : ($isCompleted ? $taskStart->copy() : $timeBound->copy());
                        } catch (\Throwable $ex) {
                            return false;
                        }
                        return $taskStart->lte($timeBound) && $taskEnd->gte($viewStart);
                    });

                    // Finished work only. A task the technician is still on is genuine work in
                    // progress and the timeline below still bills its time, but it is not
                    // something they completed, and the board reads these badges as a completed
                    // tally. So an in-progress task deliberately shows working time against
                    // "JO: 0" — that mismatch is the intended reading, not a bug to reconcile.
                    //
                    // JO carries the outcome on onsite_status and SO on visit_status, both aliased
                    // to `status` by the queries above. 'resolved' and 'completed' are accepted
                    // next to 'done' so a status written in either vocabulary still counts.
                    // 'failed' never reaches here — $allTasks drops it.
                    $completedInWindow = $tasksInWindow->filter(function ($t) use ($completedTaskStatuses) {
                        return in_array(strtolower(trim($t->status ?? '')), $completedTaskStatuses, true);
                    });

                    $joCount = $completedInWindow->where('task_type', 'jo')->count();
                    $soCount = $completedInWindow->where('task_type', 'so')->count();

                    // Define effective start for availability (either view start or time_in)
                    $effectiveStart = $viewStart->copy();
                    if (!empty($tech->time_in)) {
                        $tIn = \Carbon\Carbon::parse($tech->time_in, 'Asia/Manila');
                        // Only bound by time_in if it was today; if it was from a previous day, use viewStart
                        if ($tIn->isToday() && $tIn->gt($effectiveStart)) {
                            $effectiveStart = $tIn->copy();
                        }
                    } else if (!$isOffline && strtolower($tech->tech_status ?? '') !== 'online') {
                        // If they haven't timed in yet and aren't online, their availability hasn't started
                        $effectiveStart = $timeBound->copy();
                    }

                    // Ensure working time is counted if they have tasks, even if they haven't timed in
                    $firstTaskStart = $allTasks->whereNotNull('start_time')->min('start_time');
                    if ($firstTaskStart) {
                        $fTS = \Carbon\Carbon::parse($firstTaskStart, 'Asia/Manila');
                        if ($fTS->lt($effectiveStart)) {
                            // If they are working, they must have started their day at least when the task started
                            // But we clamp it to viewStart to keep it "Daily" and avoid pulling from previous days
                            $effectiveStart = $fTS->lt($viewStart) ? $viewStart->copy() : $fTS->copy();
                        }
                    }

                    $currentTime = $effectiveStart->copy();
                    $sortedTasks = $allTasks->sortBy('start_time');

                    foreach ($sortedTasks as $task) {
                        if (empty($task->start_time)) continue; // Skip pending for time calculation
                        
                        $tStart = \Carbon\Carbon::parse($task->start_time, 'Asia/Manila');
                        $tEnd = $task->end_time ? \Carbon\Carbon::parse($task->end_time, 'Asia/Manila') : $timeBound->copy();

                        // Bound tasks by our current view window
                        if ($tStart->gt($timeBound)) $tStart = $timeBound->copy();
                        if ($tEnd->gt($timeBound)) $tEnd = $timeBound->copy();
                        
                        // Ensure tStart is at least at currentTime to prevent counting time before effectiveStart
                        if ($tStart->lt($currentTime)) $tStart = $currentTime->copy();
                        if ($tEnd->lt($currentTime)) $tEnd = $currentTime->copy();

                        // Add idle time before this task (only if task starts after effectiveStart)
                        if ($tStart->gt($currentTime)) {
                            $totalAvailableSeconds += $currentTime->diffInSeconds($tStart);
                            $currentTime = $tStart->copy();
                        }

                        // Add working time (bounded by currentTime to avoid double-counting overlaps)
                        if ($tEnd->gt($currentTime)) {
                            $totalWorkingSeconds += $currentTime->diffInSeconds($tEnd);
                            $currentTime = $tEnd->copy();
                        }
                    }

                    // Add final idle time until timeBound
                    if ($currentTime->lt($timeBound)) {
                        $totalAvailableSeconds += $currentTime->diffInSeconds($timeBound);
                    }

                    // Format Times
                    $wHours = floor($totalWorkingSeconds / 3600);
                    $wMins = floor(($totalWorkingSeconds % 3600) / 60);
                    $workingTimeStr = "{$wHours}h {$wMins}m";

                    $aHours = floor($totalAvailableSeconds / 3600);
                    $aMins = floor(($totalAvailableSeconds % 3600) / 60);
                    $availableTimeStr = "{$aHours}h {$aMins}m";

                    // 3. Status Logic
                    $workingTask = $allTasks->filter(function($t) use ($completedTaskStatuses) {
                        $isCompleted = in_array(strtolower(trim($t->status ?? '')), $completedTaskStatuses, true);
                        return !empty($t->start_time) && empty($t->end_time) && !$isCompleted;
                    })->last();
                    $isPullout = false;
                    if ($workingTask) {
                        $status = 'Working';
                        $details = ($workingTask->task_type === 'jo' ? 'Job Order' : ($workingTask->task_type === 'so' ? 'Service Order' : 'Work Order')) . ' #' . $workingTask->id;
                        
                        // Add concern for SO or WO
                        if (in_array($workingTask->task_type, ['so', 'wo']) && !empty($workingTask->concern)) {
                            if (stripos($workingTask->concern, 'Pullout') !== false) {
                                $isPullout = true;
                            } else {
                                $details .= ' - ' . $workingTask->concern;
                            }
                        }
                        
                        $since = $workingTask->start_time;
                        // Set primaryTimeDisp to null so it counts the current task duration live in the frontend
                        $primaryTimeDisp = null; 
                    } else {
                        $status = 'Available';
                        $lastFinished = $allTasks->filter(function($t) { return !empty($t->start_time) && !empty($t->end_time); })->sortBy('end_time')->last();
                        
                        if ($lastFinished) {
                            $details = ($lastFinished->task_type === 'jo' ? 'Job Order' : ($lastFinished->task_type === 'so' ? 'Service Order' : 'Work Order')) . ' (' . ($lastFinished->status ?? 'Done') . ')';
                            $since = $lastFinished->end_time;
                        } else {
                            $pendingCount = $allTasks->filter(function($t) { return empty($t->start_time) && empty($t->end_time); })->count();
                            if ($pendingCount > 0) {
                                $details = "Assigned: {$pendingCount} Pending Task(s)";
                            } else {
                                $details = 'Ready to Accept';
                            }
                            $since = $viewStartStr;
                        }
                        // Set primaryTimeDisp to null so it counts the current availability duration live in the frontend
                        $primaryTimeDisp = null;
                    }

                    if ($isOffline) {
                        $status = 'Offline';
                        $details = 'Technician is offline';
                        $since = clone $timeBound;
                        $primaryTimeDisp = $workingTimeStr;
                    }


                    if ($since) {
                        try {
                            $sinceCarbon = \Carbon\Carbon::parse($since, 'Asia/Manila');
                            if ($sinceCarbon->lt($viewStart)) {
                                $sinceCarbon = $viewStart->copy();
                            }
                            $since = $sinceCarbon->toIso8601String();
                        } catch (\Exception $e) {}
                    }

                    // 4. Extract Technicians List
                    $techList = [];
                    $relevantTask = $workingTask ?: $lastFinished;
                    if ($relevantTask && !empty($relevantTask->technicians)) {
                        $decoded = json_decode($relevantTask->technicians, true);
                        if (is_array($decoded)) {
                            $techList = array_values(array_filter($decoded, function($t) {
                                return !empty($t) && strtolower($t) !== 'none';
                            }));
                        }
                    }

                    $data[] = [
                        'label' => $name,
                        'value' => $totalWorkingSeconds,
                        'meta' => [
                            'tech_id' => $tech->tech_id,
                            'email' => $email,
                            'status' => $status,
                            'details' => $details,
                            'since' => $since,
                            'primary_time_str' => $primaryTimeDisp,
                            'total_working_str' => $workingTimeStr,
                            'total_available_str' => $availableTimeStr,
                            // Tasks worked on within the view window (see 1b above).
                            'jo_count' => $joCount,
                            'so_count' => $soCount,
                            'is_pullout' => $isPullout,
                            'time_in' => $tech->time_in,
                            'time_out' => $tech->time_out,
                            'technicians' => $techList
                        ]
                    ];
                }

                return response()->json(['status' => 'success', 'data' => $data]);
            }


            // 14) TEAM DETAILED QUEUE (For Technicians)
            if ($action === 'team_detailed_queue') {
                $twentyMinsAgo = \Carbon\Carbon::now('Asia/Manila')->subMinutes(20)->toDateTimeString();

                // 1) Job Orders
                $jobs = DB::table('job_orders')
                    ->where('job_orders.organization_id', $organizationId)
                    ->leftJoin('users', 'job_orders.assigned_email', '=', 'users.email_address')
                    ->join('applications', 'job_orders.application_id', '=', 'applications.id')
                    ->select(
                        DB::raw("COALESCE(users.username, job_orders.assigned_email) as team_name"),
                        DB::raw("'Installation (Joborder)' as type"),
                        DB::raw("CONCAT(applications.first_name, ' ', applications.last_name) as customer"),
                        DB::raw("CONCAT(
                            COALESCE(applications.installation_address, ''), ' ', 
                            COALESCE(applications.landmark, ''), ' ', 
                            COALESCE(applications.location, ''), ' ', 
                            COALESCE(applications.barangay, ''), ' ', 
                            COALESCE(applications.city, ''), ' ', 
                            COALESCE(applications.region, '')
                        ) as address"),
                        DB::raw("CAST(job_orders.start_time AS CHAR) as start_time_str"),
                        DB::raw("CAST(job_orders.end_time AS CHAR) as end_time_str"),
                        'job_orders.onsite_status as status',
                        'job_orders.technicians'
                    )
                    ->whereRaw("(job_orders.onsite_status NOT IN ('Done', 'Failed') OR job_orders.end_time >= ?)", [$twentyMinsAgo])
                    ->whereNotNull('job_orders.assigned_email')
                    ->where('job_orders.assigned_email', '!=', '');

                // Scoped on updated_at, not on timestamp. `timestamp` is when the job order was
                // RAISED; a JO raised last month and worked on today would fall outside a
                // 'today' scope and never reach the board, while one raised today and untouched
                // since would sit on it all day. This queue reports on ACTIVITY, so the window
                // has to be the last time the row actually moved — the same column the tech
                // performance widgets above already scope on.
                $jobs = $applyScope($jobs, 'job_orders.updated_at');

                // 2) Service Orders
                $services = DB::table('service_orders')
                    ->where('service_orders.organization_id', $organizationId)
                    ->leftJoin('users', 'service_orders.assigned_email', '=', 'users.email_address')
                    ->join('billing_accounts', 'service_orders.account_no', '=', 'billing_accounts.account_no')
                    ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                    ->select(
                        DB::raw("COALESCE(users.username, service_orders.assigned_email) as team_name"),
                        DB::raw("CONCAT(COALESCE(service_orders.repair_category, service_orders.concern, 'Repair'), ' (Service Order)') as type"),
                        DB::raw("CONCAT(customers.first_name, ' ', customers.last_name) as customer"),
                        DB::raw("CONCAT(
                            COALESCE(customers.address, ''), ' ', 
                            COALESCE(customers.location, ''), ' ', 
                            COALESCE(customers.barangay, ''), ' ', 
                            COALESCE(customers.city, ''), ' ', 
                            COALESCE(customers.region, '')
                        ) as address"),
                        DB::raw("CAST(service_orders.start_time AS CHAR) as start_time_str"),
                        DB::raw("CAST(service_orders.end_time AS CHAR) as end_time_str"),
                        'service_orders.visit_status as status',
                        'service_orders.technicians'
                    )
                    ->whereRaw("(service_orders.visit_status NOT IN ('Resolved', 'Done', 'Failed') OR service_orders.end_time >= ?)", [$twentyMinsAgo])
                    ->whereNotNull('service_orders.assigned_email')
                    ->where('service_orders.assigned_email', '!=', '');

                // updated_at for the same reason as the job orders above — an SO raised days
                // ago and visited today belongs on today's board.
                $services = $applyScope($services, 'service_orders.updated_at');

                $all = $jobs->union($services)->get();


                // Calculate duration in PHP
                $data = $all->map(function ($item) {
                    $startStr = $item->start_time_str ?? null;
                    $endStr = $item->end_time_str ?? null;
                    $start = $startStr ? \Carbon\Carbon::parse($startStr) : null;
                    $end = $endStr ? \Carbon\Carbon::parse($endStr) : null;

                    if (!$start) {
                        return [
                            'team_name' => $item->team_name,
                            'type' => $item->type,
                            'customer' => $item->customer,
                            'address' => trim($item->address),
                            'status' => $item->status,
                            'technicians' => (function() use ($item) {
                                if (empty($item->technicians)) return [];
                                $decoded = json_decode($item->technicians, true);
                                if (!is_array($decoded)) return [];
                                return array_values(array_filter($decoded, function($t) {
                                    return !empty($t) && strtolower(trim($t)) !== 'none';
                                }));
                            })(),
                            'start' => '-',
                            'duration' => '-'
                        ];
                    }

                    $endTime = $end ?: \Carbon\Carbon::now('Asia/Manila');

                    // Duration string
                    $diff = $start->diff($endTime);
                    $duration = "";
                    if ($diff->d > 0)
                        $duration .= $diff->d . "d ";
                    if ($diff->h > 0)
                        $duration .= $diff->h . "h ";
                    $duration .= $diff->i . "m ";
                    $duration .= $diff->s . "s";

                    // Parse and filter technicians
                    $techs = [];
                    if (!empty($item->technicians)) {
                        $decoded = json_decode($item->technicians, true);
                        if (is_array($decoded)) {
                            $techs = array_values(array_filter($decoded, function($t) {
                                return !empty($t) && strtolower(trim($t)) !== 'none';
                            }));
                        }
                    }

                    return [
                        'team_name' => $item->team_name,
                        'type' => $item->type,
                        'customer' => $item->customer,
                        'address' => trim($item->address),
                        'status' => $item->status,
                        'technicians' => $techs,
                        'start' => $start->format('M d, Y h:i A'),
                        'end' => $end ? $end->format('M d, Y h:i A') : '',
                        'start_time' => $start->toIso8601String(),
                        'end_time' => $end ? $end->toIso8601String() : null,
                        'duration' => $duration
                    ];
                });

                return response()->json(['status' => 'success', 'data' => $data]);
            }

            // 15) AGENT DETAILED QUEUE
            if ($action === 'agent_detailed_queue') {
                // 1) Job Orders
                $jobs = DB::table('job_orders')
                    ->where('job_orders.organization_id', $organizationId)
                    ->join('applications', 'job_orders.application_id', '=', 'applications.id')
                    ->select(
                        'applications.referred_by as team_name',
                        DB::raw("'Installation (Joborder)' as type"),
                        DB::raw("CONCAT(applications.first_name, ' ', applications.last_name) as customer"),
                        DB::raw("CONCAT(
                            COALESCE(applications.installation_address, ''), ' ', 
                            COALESCE(applications.landmark, ''), ' ', 
                            COALESCE(applications.location, ''), ' ', 
                            COALESCE(applications.barangay, ''), ' ', 
                            COALESCE(applications.city, ''), ' ', 
                            COALESCE(applications.region, '')
                        ) as address"),
                        DB::raw("CAST(job_orders.start_time AS CHAR) as start_time_str"),
                        DB::raw("CAST(job_orders.end_time AS CHAR) as end_time_str"),
                        'job_orders.onsite_status as status',
                        'job_orders.technicians'
                    )
                    ->where('job_orders.onsite_status', '!=', 'Done')
                    ->whereNotNull('applications.referred_by')
                    ->where('applications.referred_by', '!=', '');

                $jobs = $applyScope($jobs, 'job_orders.timestamp');

                // 2) Service Orders
                $services = DB::table('service_orders')
                    ->where('service_orders.organization_id', $organizationId)
                    ->join('billing_accounts', 'service_orders.account_no', '=', 'billing_accounts.account_no')
                    ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                    ->select(
                        'customers.referred_by as team_name',
                        DB::raw("CONCAT(COALESCE(service_orders.repair_category, service_orders.concern, 'Repair'), ' (Service Order)') as type"),
                        DB::raw("CONCAT(customers.first_name, ' ', customers.last_name) as customer"),
                        DB::raw("CONCAT(
                            COALESCE(customers.address, ''), ' ', 
                            COALESCE(customers.location, ''), ' ', 
                            COALESCE(customers.barangay, ''), ' ', 
                            COALESCE(customers.city, ''), ' ', 
                            COALESCE(customers.region, '')
                        ) as address"),
                        DB::raw("CAST(service_orders.start_time AS CHAR) as start_time_str"),
                        DB::raw("CAST(service_orders.end_time AS CHAR) as end_time_str"),
                        'service_orders.visit_status as status',
                        'service_orders.technicians'
                    )
                    ->where('service_orders.visit_status', '!=', 'Resolved')
                    ->where('service_orders.visit_status', '!=', 'Done')
                    ->whereNotNull('customers.referred_by')
                    ->where('customers.referred_by', '!=', '');

                $services = $applyScope($services, 'service_orders.timestamp');

                $all = $jobs->union($services)->get();

                // Referrals made through the agent picker hold a user id; the
                // queue is grouped and read by team name, so resolve the whole
                // page in one query before mapping over it.
                \App\Support\AgentReferral::prime($all->pluck('team_name'));

                $data = $all->map(function ($item) {
                    $startStr = $item->start_time_str ?? null;
                    $endStr = $item->end_time_str ?? null;
                    $start = $startStr ? \Carbon\Carbon::parse($startStr) : null;
                    $end = $endStr ? \Carbon\Carbon::parse($endStr) : null;

                    if (!$start) {
                        return [
                            'team_name' => \App\Support\AgentReferral::displayName($item->team_name),
                            'type' => $item->type,
                            'customer' => $item->customer,
                            'address' => trim($item->address),
                            'status' => $item->status,
                            'technicians' => (function() use ($item) {
                                if (empty($item->technicians)) return [];
                                $decoded = json_decode($item->technicians, true);
                                if (!is_array($decoded)) return [];
                                return array_values(array_filter($decoded, function($t) {
                                    return !empty($t) && strtolower(trim($t)) !== 'none';
                                }));
                            })(),
                            'start' => '-',
                            'duration' => '-'
                        ];
                    }

                    $endTime = $end ?: \Carbon\Carbon::now('Asia/Manila');
                    $diff = $start->diff($endTime);
                    $duration = "";
                    if ($diff->d > 0)
                        $duration .= $diff->d . "d ";
                    if ($diff->h > 0)
                        $duration .= $diff->h . "h ";
                    $duration .= $diff->i . "m ";
                    $duration .= $diff->s . "s";

                    return [
                        'team_name' => \App\Support\AgentReferral::displayName($item->team_name),
                        'type' => $item->type,
                        'customer' => $item->customer,
                        'address' => trim($item->address),
                        'status' => $item->status,
                        'technicians' => (function() use ($item) {
                            if (empty($item->technicians)) return [];
                            $decoded = json_decode($item->technicians, true);
                            if (!is_array($decoded)) return [];
                            return array_values(array_filter($decoded, function($t) {
                                return !empty($t) && strtolower(trim($t)) !== 'none';
                            }));
                        })(),
                        'start' => $start->format('M d, Y h:i A'),
                        'end' => $end ? $end->format('M d, Y h:i A') : '',
                        'start_time' => $start->toIso8601String(),
                        'end_time' => $end ? $end->toIso8601String() : null,
                        'duration' => $duration
                    ];
                });

                return response()->json(['status' => 'success', 'data' => $data]);
            }

            return response()->json([
                'status' => 'error',
                'message' => "Unknown action: $action",
                'barangays' => $response['barangays'],
            ], 400);

        } catch (\Throwable $e) {
            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
            ], 500);
        }
    }
}





