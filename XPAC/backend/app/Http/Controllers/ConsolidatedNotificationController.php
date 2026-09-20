<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class ConsolidatedNotificationController extends Controller
{
    public function index(Request $request)
    {
        try {
            $limit = $request->get('limit', 15);
            $latest = collect();

            // 1. Fetch Applications (Pending)
            $applications = DB::table('applications')
                ->where('status', 'Pending')
                ->orderBy('created_at', 'desc')
                ->limit($limit)
                ->get()
                ->map(function ($app) {
                    $createdAt = Carbon::parse($app->created_at);
                    return [
                        'id' => $app->id,
                        'type' => 'application',
                        'customer_name' => trim(($app->first_name ?? '') . ' ' . ($app->last_name ?? '')),
                        'plan_name' => $app->desired_plan ?? 'Unknown Plan',
                        'title' => 'New Application',
                        'message' => 'New application received',
                        'timestamp' => $createdAt->timestamp,
                        'formatted_date' => $createdAt->format('Y-m-d h:i:s A'), // e.g. 2026-02-11 05:53:42 PM
                        'raw_date' => $createdAt->toIso8601String()
                    ];
                });

            // 2. Fetch Job Orders (Done)
            $jobCompeltions = DB::table('job_orders')
                ->join('applications', 'job_orders.application_id', '=', 'applications.id')
                ->where('job_orders.onsite_status', 'Done')
                ->orderBy('job_orders.updated_at', 'desc')
                ->limit($limit)
                ->select(
                    'job_orders.id',
                    'job_orders.updated_at',
                    'applications.first_name',
                    'applications.last_name',
                    'applications.desired_plan'
                )
                ->get()
                ->map(function ($job) {
                    $updatedAt = Carbon::parse($job->updated_at);
                    return [
                        'id' => $job->id,
                        'type' => 'job_order_done',
                        'customer_name' => trim(($job->first_name ?? '') . ' ' . ($job->last_name ?? '')),
                        'plan_name' => $job->desired_plan ?? 'Unknown Plan',
                        'title' => 'Job Order Completed',
                        'message' => 'Onsite status marked as Done',
                        'timestamp' => $updatedAt->timestamp,
                        'formatted_date' => $updatedAt->format('Y-m-d h:i:s A'), // e.g. 2026-02-11 05:53:42 PM
                        'raw_date' => $updatedAt->toIso8601String()
                    ];
                });

            // Merge and Sort
            $all = $applications->concat($jobCompeltions)
                ->sortByDesc('timestamp')
                ->take($limit)
                ->values();

            return response()->json([
                'success' => true,
                'data' => $all
            ]);

        } catch (\Exception $e) {
            Log::error('Failed to fetch consolidated notifications', [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch notifications',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}


