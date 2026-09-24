<?php

namespace App\Http\Controllers;

use App\Models\SmsLog;
use App\Services\ItexmoSmsService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class SmsController extends Controller
{
    protected ItexmoSmsService $smsService;

    public function __construct(ItexmoSmsService $smsService)
    {
        $this->smsService = $smsService;
    }

    public function sendSms(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'contact_no' => 'required|string',
                'message' => 'required|string|max:1000'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $result = $this->smsService->send($request->all());

            return response()->json($result, $result['success'] ? 200 : 500);

        } catch (\Exception $e) {
            Log::error('SMS sending failed', [
                'error' => $e->getMessage(),
                'request_data' => $request->except(['password'])
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to send SMS',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * List logged SMS messages (sms_logs table).
     */
    public function smsLogs(Request $request): JsonResponse
    {
        try {
            $query = SmsLog::query();

            if ($request->filled('status')) {
                $query->where('status', $request->status);
            }

            if ($request->filled('provider')) {
                $query->where('provider', $request->provider);
            }

            if ($request->filled('account_no')) {
                $query->where('account_no', $request->account_no);
            }

            if ($request->filled('search')) {
                $search = $request->search;
                $query->where(function ($q) use ($search) {
                    $q->where('contact_no', 'like', "%{$search}%")
                      ->orWhere('account_no', 'like', "%{$search}%")
                      ->orWhere('sender_id', 'like', "%{$search}%")
                      ->orWhere('message', 'like', "%{$search}%");
                });
            }

            $logs = $query->orderBy('created_at', 'desc')
                ->paginate($request->get('per_page', 50));

            return response()->json($logs);

        } catch (\Exception $e) {
            Log::error('Failed to fetch SMS logs', ['error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch SMS logs',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function sendBlast(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'filterType' => 'required|string|in:Barangay,LCP,LCPNAP,Location',
                'filterValue' => 'required|string',
                'message' => 'required|string|max:1000'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $result = $this->smsService->sendBlast($request->all());

            return response()->json($result, $result['success'] ? 200 : 500);

        } catch (\Exception $e) {
            Log::error('SMS blast failed', [
                'error' => $e->getMessage(),
                'request_data' => $request->all()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to send SMS blast',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
