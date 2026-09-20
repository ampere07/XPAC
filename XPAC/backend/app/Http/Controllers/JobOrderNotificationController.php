<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class JobOrderNotificationController extends Controller
{
    public function getRecentCompletions(Request $request)
    {
        try {
            $limit = $request->get('limit', 10);
            
            // Fetch job orders where onsite_status is 'Done'
            $jobOrders = DB::table('job_orders')
                ->join('applications', 'job_orders.application_id', '=', 'applications.id')
                ->where('job_orders.onsite_status', 'Done')
                // We want recent updates
                ->orderBy('job_orders.updated_at', 'desc')
                ->limit($limit)
                ->select(
                    'job_orders.id',
                    'job_orders.updated_at',
                    'applications.first_name',
                    'applications.last_name',
                    'applications.desired_plan',
                    'applications.desired_plan_id'
                )
                ->get()
                ->map(function ($jobOrder) {
                    try {
                        $updatedAt = Carbon::parse($jobOrder->updated_at)->setTimezone('Asia/Manila');
                        
                        $firstName = $jobOrder->first_name ?? '';
                        $lastName = $jobOrder->last_name ?? '';
                        $fullName = trim($firstName . ' ' . $lastName);
                        
                        if (empty($fullName)) {
                            $fullName = 'Unknown Customer';
                        }
                        
                        $planName = $jobOrder->desired_plan ?? 'Unknown Plan';
                        // Keep simple logic for plan name if desired_plan is directly stored
                        
                        return [
                            'id' => $jobOrder->id,
                            'customer_name' => $fullName,
                            'plan_name' => $planName,
                            'status' => 'Done',
                            'type' => 'job_order_completion', // distinguish from application
                            'created_at' => $updatedAt->toIso8601String(),
                            'formatted_date' => $updatedAt->diffForHumans(),
                            'message' => "Job Order #{$jobOrder->id} is now Done"
                        ];
                    } catch (\Exception $e) {
                         Log::error('Failed to process job order notification item', [
                            'id' => $jobOrder->id,
                            'error' => $e->getMessage()
                        ]);
                        return null;
                    }
                })
                ->filter() // Remove nulls
                ->values(); // Reset keys

            return response()->json([
                'success' => true,
                'data' => $jobOrders
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to fetch job order completion notifications', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch notifications',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

