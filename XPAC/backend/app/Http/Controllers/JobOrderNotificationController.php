<?php

namespace App\Http\Controllers;

use App\Services\JobOrderNotificationGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class JobOrderNotificationController extends Controller
{
    /**
     * How much wider than $limit this reads before suppression.
     *
     * The guard drops rows after the query returns, so reading exactly $limit
     * would hand back a short page whenever anything was withheld. Capped so a
     * backlog of pending job orders cannot turn a poll into a large scan.
     */
    private const SUPPRESSION_OVERFETCH = 3;
    private const SUPPRESSION_OVERFETCH_CAP = 150;

    public function getRecentCompletions(Request $request)
    {
        try {
            $limit = max(1, min(100, (int) $request->get('limit', 10)));

            $guard = app(JobOrderNotificationGuard::class);

            // Fetch job orders where onsite_status is 'Done'.
            //
            // 'Done' onsite is necessary but not sufficient to announce a JO
            // number: the visit still has to have been confirmed and the job
            // order still has to have been billed. Both statuses are selected
            // alongside so JobOrderNotificationGuard can rule without a second
            // query — see that class for why each one gates the notification.
            $jobOrders = DB::table('job_orders')
                ->join('applications', 'job_orders.application_id', '=', 'applications.id')
                ->where('job_orders.onsite_status', 'Done')
                // We want recent updates
                ->orderBy('job_orders.updated_at', 'desc')
                ->limit(min($limit * self::SUPPRESSION_OVERFETCH, self::SUPPRESSION_OVERFETCH_CAP))
                ->select(
                    'job_orders.id',
                    'job_orders.updated_at',
                    'job_orders.billing_status',
                    'job_orders.onsite_status',
                    'applications.first_name',
                    'applications.last_name',
                    'applications.desired_plan',
                    'applications.desired_plan_id'
                )
                ->get()
                ->filter(function ($jobOrder) use ($guard) {
                    $reason = $guard->reasonFor($jobOrder->billing_status, $jobOrder->onsite_status);

                    if ($reason === null) {
                        return true;
                    }

                    $guard->logSuppressed($jobOrder->id, $reason, [
                        'feed' => 'job_order_completions',
                        'billing_status' => $jobOrder->billing_status,
                        'onsite_status' => $jobOrder->onsite_status,
                    ]);

                    return false;
                })
                ->take($limit)
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

