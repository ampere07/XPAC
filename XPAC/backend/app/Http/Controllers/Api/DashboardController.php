<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class DashboardController extends Controller
{
    public function getCounts(Request $request)
    {
        try {
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
            
            // Note: SuperAdmin bypass is removed per user request for strict isolation.
            // Everyone sees data matching their organization_id scope (including null).

            $now = Carbon::now();
            $todayStr = $now->toDateString();
            $year = $now->year;
            $month = $now->month;

            $dateField = DB::raw('COALESCE(service_orders.updated_at, service_orders.created_at)');

            // Base queries for multi-table counts
            $onlineStatusQuery = DB::table('online_status');
            // Join with billing_accounts and customers to get organization_id for online_status
            $onlineStatusQuery->join('billing_accounts', 'online_status.account_id', '=', 'billing_accounts.id')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('customers.organization_id', $organizationId);

            $serviceOrderQuery = DB::table('service_orders')
                ->where('service_orders.organization_id', $organizationId);

            $jobOrderQuery = DB::table('job_orders')
                ->where('job_orders.organization_id', $organizationId);

            $applicationQuery = DB::table('applications')
                ->where('applications.organization_id', $organizationId);

            // Fetch service connection statuses from live check of the RADIUS config (to match RadiusConfig.tsx)
            $radiusIsOnline = false;
            $radiusOfflineMessage = null;
            $radiusConfig = DB::table('radius_config')->first();

            if ($radiusConfig) {
                try {
                    $connection = @fsockopen($radiusConfig->ip, $radiusConfig->port, $errno, $errstr, 2);
                    if ($connection) {
                        $radiusIsOnline = true;
                        fclose($connection);
                    } else {
                        $radiusOfflineMessage = "Failed to connect to RADIUS API port {$radiusConfig->port} on {$radiusConfig->ip}: {$errstr} ({$errno})";
                    }
                } catch (\Exception $e) {
                    $radiusOfflineMessage = $e->getMessage();
                }
            } else {
                $radiusOfflineMessage = 'No RADIUS configuration found';
            }

            $smartOltStatus = DB::table('system_config')->where('config_key', 'smart_olt_status')->first();
            $smartOltError = null;
            if ($smartOltStatus && $smartOltStatus->config_value === 'offline') {
                $smartOltErrorRecord = DB::table('system_config')->where('config_key', 'smart_olt_last_error')->first();
                $smartOltError = $smartOltErrorRecord ? $smartOltErrorRecord->config_value : 'Failed to connect to SmartOLT API';
            }
            $smartOltOnline = ($smartOltStatus ? $smartOltStatus->config_value : 'online') === 'online';

            $counts = [
                // Radius Stats (Overall)
                'radius_online' => (clone $onlineStatusQuery)->where('online_status.session_status', 'Online')->count(),
                'radius_offline' => (clone $onlineStatusQuery)->where('online_status.session_status', 'Offline')->count(),
                'radius_disconnected' => (clone $onlineStatusQuery)->where('online_status.session_status', 'Disconnected')->count(),
                'radius_restricted' => (clone $onlineStatusQuery)->where('online_status.session_status', 'Restricted')->count(),

                // Support Status Today
                'support_status_in_progress' => (clone $serviceOrderQuery)->where('service_orders.support_status', 'In Progress')->whereDate('service_orders.timestamp', $todayStr)->count(),
                'support_status_for_visit' => (clone $serviceOrderQuery)->where('service_orders.support_status', 'For Visit')->whereDate('service_orders.timestamp', $todayStr)->count(),
                'support_status_resolved' => (clone $serviceOrderQuery)->where('service_orders.support_status', 'Resolved')->whereDate('service_orders.timestamp', $todayStr)->count(),
                'support_status_failed' => (clone $serviceOrderQuery)->where('service_orders.support_status', 'Failed')->whereDate('service_orders.timestamp', $todayStr)->count(),

                // Visit Status Today
                'visit_status_in_progress' => (clone $serviceOrderQuery)->where('service_orders.visit_status', 'In Progress')->whereDate('service_orders.timestamp', $todayStr)->count(),
                'visit_status_done' => (clone $serviceOrderQuery)->where('service_orders.visit_status', 'Done')->whereDate('service_orders.timestamp', $todayStr)->count(),
                'visit_status_rescheduled' => (clone $serviceOrderQuery)->where('service_orders.visit_status', 'Reschedule')->whereDate('service_orders.timestamp', $todayStr)->count(),
                'visit_status_failed' => (clone $serviceOrderQuery)->where('service_orders.visit_status', 'Failed')->whereDate('service_orders.timestamp', $todayStr)->count(),

                // Monthly Summary Data
                'monthly_support_concerns' => (clone $serviceOrderQuery)
                    ->whereYear($dateField, $year)->whereMonth($dateField, $month)
                    ->where('service_orders.concern', '<>', '')->whereNotNull('service_orders.concern')
                    ->select('service_orders.concern as label', DB::raw('count(*) as count'))
                    ->groupBy('service_orders.concern')->orderByRaw('count(*) desc')->limit(10)->get(),

                'monthly_repair_categories' => (clone $serviceOrderQuery)
                    ->whereYear($dateField, $year)->whereMonth($dateField, $month)
                    ->where('service_orders.repair_category', '<>', '')->whereNotNull('service_orders.repair_category')
                    ->select('service_orders.repair_category as label', DB::raw('count(*) as count'))
                    ->groupBy('service_orders.repair_category')->orderByRaw('count(*) desc')->limit(10)->get(),

                // Job Orders Status Today
                'jo_status_pending' => (clone $jobOrderQuery)->where('job_orders.onsite_status', 'Pending')->whereDate('job_orders.timestamp', $todayStr)->count(),
                'jo_status_in_progress' => (clone $jobOrderQuery)->where('job_orders.onsite_status', 'In Progress')->whereDate('job_orders.timestamp', $todayStr)->count(),
                'jo_status_done' => (clone $jobOrderQuery)->where('job_orders.onsite_status', 'Done')->whereDate('job_orders.timestamp', $todayStr)->count(),
                'jo_status_failed' => (clone $jobOrderQuery)->where('job_orders.onsite_status', 'Failed')->whereDate('job_orders.timestamp', $todayStr)->count(),

                // Applications Status Today
                'app_status_scheduled' => (clone $applicationQuery)->where('applications.status', 'Scheduled')->whereDate('applications.timestamp', $todayStr)->count(),
                'app_status_in_progress' => (clone $applicationQuery)->where('applications.status', 'In Progress')->whereDate('applications.timestamp', $todayStr)->count(),
                'app_status_no_facility' => (clone $applicationQuery)->where('applications.status', 'No Facility')->whereDate('applications.timestamp', $todayStr)->count(),
                'app_status_cancelled' => (clone $applicationQuery)->where('applications.status', 'Cancelled')->whereDate('applications.timestamp', $todayStr)->count(),
                'app_status_no_slot' => (clone $applicationQuery)->where('applications.status', 'No Slot')->whereDate('applications.timestamp', $todayStr)->count(),
                'app_status_duplicate' => (clone $applicationQuery)->where('applications.status', 'Duplicate')->whereDate('applications.timestamp', $todayStr)->count(),

                // Legacy counts
                'so_support_in_progress' => (clone $serviceOrderQuery)->where('service_orders.support_status', 'In Progress')->whereDate($dateField, $todayStr)->count(),
                'so_visit_in_progress' => (clone $serviceOrderQuery)->where('service_orders.visit_status', 'In Progress')->whereDate($dateField, $todayStr)->count(),
                'app_pending' => (clone $applicationQuery)->where('applications.status', 'Pending')->count(),
                'jo_in_progress' => (clone $jobOrderQuery)->where('job_orders.onsite_status', 'In Progress')->count(),

                // Service Statuses
                'services' => [
                    'radius' => [
                        'status' => $radiusIsOnline ? 'online' : 'offline',
                        'message' => $radiusOfflineMessage,
                        'updated_at' => $radiusConfig ? Carbon::parse($radiusConfig->updated_at)->toIso8601String() : null
                    ],
                    'smartolt' => [
                        'status' => $smartOltOnline ? 'online' : 'offline',
                        'message' => $smartOltError,
                        'updated_at' => $smartOltStatus ? Carbon::parse($smartOltStatus->updated_at)->toIso8601String() : null
                    ]
                ]
            ];

            return response()->json([
                'status' => 'success',
                'data' => $counts,
                'debug' => [
                    'organization_id' => $organizationId,
                    'role_id' => $roleId
                ]
            ]);
        } catch (\Exception $e) {
            \Log::error('Dashboard Error: ' . $e->getMessage(), [
                'user_id' => auth()->id(),
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage()
            ], 500);
        }
    }
}
