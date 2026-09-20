<?php

namespace App\Http\Controllers;

use App\Models\Application;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class DashboardController extends Controller
{
    public function stats(Request $request)
    {
        // Authentication is the auth.token middleware's job now — see
        // routes/api.php. The hand-rolled copy that used to sit here read the
        // cache under the raw token, which no longer matches how a token is
        // stored, and duplicating the check is what let every other endpoint
        // in this API be written without one.

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
        // Authentication is the auth.token middleware's job now — see
        // routes/api.php. The hand-rolled copy that used to sit here read the
        // cache under the raw token, which no longer matches how a token is
        // stored, and duplicating the check is what let every other endpoint
        // in this API be written without one.

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

}

