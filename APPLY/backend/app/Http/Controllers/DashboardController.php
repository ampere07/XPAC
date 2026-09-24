<?php

namespace App\Http\Controllers;

use App\Models\Application;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class DashboardController extends Controller
{
    public function stats(Request $request)
    {
        $token = $request->bearerToken();
        
        if (!$this->validateToken($token)) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized'
            ], 401);
        }

        $totalApplications = Application::count();
        $pendingApplications = Application::where('status', 'pending')->count();
        $approvedApplications = Application::where('status', 'approved')->count();
        $rejectedApplications = Application::where('status', 'rejected')->count();

        return response()->json([
            'total_applications' => $totalApplications,
            'pending_applications' => $pendingApplications,
            'approved_applications' => $approvedApplications,
            'rejected_applications' => $rejectedApplications
        ]);
    }

    public function recentApplications(Request $request)
    {
        $token = $request->bearerToken();
        
        if (!$this->validateToken($token)) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized'
            ], 401);
        }

        $limit = $request->get('limit', 10);

        $applications = Application::orderBy('created_at', 'desc')
            ->limit($limit)
            ->get()
            ->map(function ($application) {
                return [
                    'id' => $application->id,
                    'application_id' => $application->id,
                    'first_name' => $application->first_name,
                    'last_name' => $application->last_name,
                    'email' => $application->email_address,
                    'mobile' => $application->mobile_number,
                    'region' => $application->region,
                    'city' => $application->city,
                    'plan' => $application->desired_plan,
                    'status' => $application->status ?? 'pending',
                    'created_at' => $application->created_at->timezone('Asia/Manila')->toDateTimeString()
                ];
            });

        return response()->json([
            'success' => true,
            'data' => $applications
        ]);
    }

    private function validateToken($token)
    {
        if (!$token) {
            return false;
        }

        $userData = Cache::get('auth_token_' . $token);

        return $userData !== null;
    }
}

