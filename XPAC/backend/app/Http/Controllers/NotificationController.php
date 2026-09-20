<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Application;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class NotificationController extends Controller
{
    public function getRecentApplications(Request $request)
    {
        try {
            $limit = $request->get('limit', 10);
            
            $applications = DB::table('applications')
                ->orderBy('created_at', 'desc')
                ->limit($limit)
                ->get()
                ->map(function ($app) {
                    try {
                        $createdAt = Carbon::parse($app->created_at)->setTimezone('Asia/Manila');
                        
                        $firstName = $app->first_name ?? '';
                        $middleInitial = $app->middle_initial ?? '';
                        $lastName = $app->last_name ?? '';
                        
                        $fullName = trim($firstName . ' ' . ($middleInitial ? $middleInitial . '. ' : '') . $lastName);
                        
                        if (empty($fullName)) {
                            $fullName = 'Unknown Customer';
                        }
                        
                        $planName = 'No Plan Selected';
                        if (!empty($app->desired_plan)) {
                            $planName = $app->desired_plan;
                        } elseif (!empty($app->desired_plan_id)) {
                            $plan = DB::table('plan_list')->where('id', $app->desired_plan_id)->first();
                            $planName = $plan ? $plan->plan_name : 'Unknown Plan';
                        }
                        
                        return [
                            'id' => $app->id,
                            'customer_name' => $fullName,
                            'plan_name' => $planName,
                            'status' => $app->status ?? 'Pending',
                            'created_at' => $createdAt->toIso8601String(),
                            'formatted_date' => $createdAt->diffForHumans(),
                        ];
                    } catch (\Exception $e) {
                        Log::error('Failed to process application', [
                            'application_id' => $app->id ?? 'unknown',
                            'error' => $e->getMessage(),
                            'trace' => $e->getTraceAsString()
                        ]);
                        
                        return [
                            'id' => $app->id ?? 0,
                            'customer_name' => 'Error Processing',
                            'plan_name' => 'Unknown',
                            'status' => 'Error',
                            'created_at' => now()->toIso8601String(),
                            'formatted_date' => 'Unknown',
                        ];
                    }
                });

            return response()->json([
                'success' => true,
                'data' => $applications
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to fetch notifications', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'file' => $e->getFile(),
                'line' => $e->getLine()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch notifications',
                'error' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine()
            ], 500);
        }
    }

    public function getUnreadCount(Request $request)
    {
        try {
            $oneDayAgo = Carbon::now('Asia/Manila')->subDay();
            
            $count = DB::table('applications')
                ->where('created_at', '>=', $oneDayAgo)
                ->count();

            return response()->json([
                'success' => true,
                'count' => $count
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to fetch notification count', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch notification count',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function debugTimezone(Request $request)
    {
        try {
            $now = Carbon::now('Asia/Manila');
            $utcNow = Carbon::now('UTC');
            
            $latestApp = DB::table('applications')
                ->orderBy('created_at', 'desc')
                ->first();
            
            return response()->json([
                'server_time_utc' => $utcNow->toIso8601String(),
                'server_time_manila' => $now->toIso8601String(),
                'php_timezone' => date_default_timezone_get(),
                'laravel_timezone' => config('app.timezone'),
                'database_timezone' => config('database.connections.mysql.timezone'),
                'latest_application' => $latestApp ? [
                    'id' => $latestApp->id,
                    'created_at_raw' => $latestApp->created_at,
                    'created_at_manila' => Carbon::parse($latestApp->created_at)->setTimezone('Asia/Manila')->toIso8601String(),
                    'diff_for_humans' => Carbon::parse($latestApp->created_at)->setTimezone('Asia/Manila')->diffForHumans(),
                    'raw_data' => $latestApp
                ] : null
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
