<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\RadiusReconnectionService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Exception;

class RadiusManualController extends Controller
{
    private $radiusService;

    public function __construct(RadiusReconnectionService $radiusService)
    {
        $this->radiusService = $radiusService;
    }

    /**
     * Manual reconnection endpoint
     * POST /api/radius/reconnect
     */
    public function reconnect(Request $request)
    {
        try {
            $validated = $request->validate([
                'account_no' => 'required|string',
                'username' => 'required|string',
                'plan' => 'required|string',
                'updated_by' => 'nullable|string'
            ]);

            $accountNo = $validated['account_no'];
            $username = $validated['username'];
            $plan = $validated['plan'];
            $updatedBy = $validated['updated_by'] ?? 'Admin';

            Log::info('Manual reconnection request', [
                'account_no' => $accountNo,
                'username' => $username,
                'plan' => $plan,
                'updated_by' => $updatedBy
            ]);

            $result = $this->radiusService->manualReconnect(
                $accountNo,
                $username,
                $plan,
                $updatedBy
            );

            if ($result['success']) {
                return response()->json([
                    'status' => 'success',
                    'message' => 'User reconnected successfully',
                    'output' => $result['message']
                ]);
            } else {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Reconnection failed',
                    'output' => $result['message']
                ], 400);
            }

        } catch (Exception $e) {
            Log::error('Manual reconnection failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'An error occurred during reconnection',
                'output' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Manual disconnection endpoint
     * POST /api/radius/disconnect
     */
    public function disconnect(Request $request)
    {
        try {
            $validated = $request->validate([
                'account_no' => 'required|string',
                'username' => 'required|string',
                'remarks' => 'nullable|string',
                'updated_by' => 'nullable|string'
            ]);

            $accountNo = $validated['account_no'];
            $username = $validated['username'];
            $remarks = $validated['remarks'] ?? '';
            $updatedBy = $validated['updated_by'] ?? 'Admin';

            Log::info('Manual disconnection request', [
                'account_no' => $accountNo,
                'username' => $username,
                'remarks' => $remarks,
                'updated_by' => $updatedBy
            ]);

            $result = $this->radiusService->manualDisconnect(
                $accountNo,
                $username,
                $remarks,
                $updatedBy
            );

            if ($result['success']) {
                return response()->json([
                    'status' => 'success',
                    'message' => 'User disconnected successfully',
                    'output' => $result['message']
                ]);
            } else {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Disconnection failed',
                    'output' => $result['message']
                ], 400);
            }

        } catch (Exception $e) {
            Log::error('Manual disconnection failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'An error occurred during disconnection',
                'output' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Check RADIUS connection status
     * GET /api/radius/status
     */
    public function checkStatus(Request $request)
    {
        try {
            $validated = $request->validate([
                'account_no' => 'required|string'
            ]);

            // This would query RADIUS to check if user is connected
            // For now, return basic info
            
            return response()->json([
                'status' => 'success',
                'message' => 'Status check not yet implemented',
                'data' => [
                    'account_no' => $validated['account_no'],
                    'connected' => null
                ]
            ]);

        } catch (Exception $e) {
            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage()
            ], 500);
        }
    }
}
