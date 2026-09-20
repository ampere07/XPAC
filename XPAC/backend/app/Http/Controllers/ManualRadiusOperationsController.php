<?php

namespace App\Http\Controllers;

use App\Services\ManualRadiusOperationsService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use Exception;

class ManualRadiusOperationsController extends Controller
{
    protected $radiusService;

    public function __construct(ManualRadiusOperationsService $radiusService)
    {
        $this->radiusService = $radiusService;
    }

    /**
     * Handle manual disconnect/reconnect/credential update operations
     * 
     * @param Request $request
     * @return JsonResponse
     */
    public function handleOperation(Request $request): JsonResponse
    {
        try {
            // Validate the action parameter
            $validator = Validator::make($request->all(), [
                'action' => 'required|in:disconnectUser,reconnectUser,updateCredentials,disabledUser,enabledUser,deleteAccount,updateGroup',
                'accountNumber' => 'nullable|string',
                'username' => 'required|string',
                'updatedBy' => 'nullable|string',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                    'output' => 'Error: Validation failed'
                ], 422);
            }

            $action = $request->input('action');
            $params = $request->all();

            // Scope RADIUS operations

            Log::info("Manual RADIUS Operation", [
                'action' => $action,
                'account' => $params['accountNumber'] ?? 'N/A',
                'username' => $params['username'] ?? 'N/A'
            ]);

            // Route to appropriate service method
            $result = match ($action) {
                'disconnectUser' => $this->handleDisconnect($request, $params),
                'reconnectUser' => $this->handleReconnect($request, $params),
                'updateCredentials' => $this->handleCredentialUpdate($request, $params),
                'disabledUser' => $this->handleDisabled($request, $params),
                'enabledUser' => $this->handleEnabled($request, $params),
                'deleteAccount' => $this->handleDeletion($request, $params),
                'updateGroup' => $this->handleUpdateGroup($request, $params),
                default => [
                    'status' => 'error',
                    'message' => 'Unknown action',
                    'output' => 'Error: Unknown action'
                ]
            };

            $statusCode = $result['status'] === 'success' ? 200 : 400;

            return response()->json($result, $statusCode);

        } catch (Exception $e) {
            Log::error("Manual RADIUS Operation Error", [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Handle disconnect user operation
     */
    private function handleDisconnect(Request $request, array $params): array
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string',
            'remarks' => 'nullable|string',
        ]);

        if ($validator->fails()) {
            return [
                'status' => 'error',
                'message' => 'Validation failed for disconnect operation',
                'errors' => $validator->errors(),
                'output' => 'Error: Validation failed'
            ];
        }

        return $this->radiusService->disconnectUser($params);
    }

    /**
     * Handle reconnect user operation
     */
    private function handleReconnect(Request $request, array $params): array
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string',
            'plan' => 'required|string',
        ]);

        if ($validator->fails()) {
            return [
                'status' => 'error',
                'message' => 'Validation failed for reconnect operation',
                'errors' => $validator->errors(),
                'output' => 'Error: Validation failed'
            ];
        }

        return $this->radiusService->reconnectUser($params);
    }

    /**
     * Handle update group operation
     */
    private function handleUpdateGroup(Request $request, array $params): array
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string',
            'plan' => 'required|string',
        ]);

        if ($validator->fails()) {
            return [
                'status' => 'error',
                'message' => 'Validation failed for update group operation',
                'errors' => $validator->errors(),
                'output' => 'Error: Validation failed'
            ];
        }

        return $this->radiusService->updateGroup($params);
    }

    /**
     * Handle credential update operation
     */
    private function handleCredentialUpdate(Request $request, array $params): array
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string',
            'newUsername' => 'required|string|different:username',
            'newPassword' => 'required|string|min:6',
        ]);

        if ($validator->fails()) {
            return [
                'status' => 'error',
                'message' => 'Validation failed for credential update',
                'errors' => $validator->errors(),
                'output' => 'Error: Validation failed'
            ];
        }

        return $this->radiusService->updateCredentials($params);
    }

    /**
     * Handle disabled user operation
     */
    private function handleDisabled(Request $request, array $params): array
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string',
        ]);

        if ($validator->fails()) {
            return [
                'status' => 'error',
                'message' => 'Validation failed for disabled operation',
                'errors' => $validator->errors(),
                'output' => 'Error: Validation failed'
            ];
        }

        return $this->radiusService->disabledUser($params);
    }

    /**
     * Handle enabled user operation
     */
    private function handleEnabled(Request $request, array $params): array
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string',
        ]);

        if ($validator->fails()) {
            return [
                'status' => 'error',
                'message' => 'Validation failed for enabled operation',
                'errors' => $validator->errors(),
                'output' => 'Error: Validation failed'
            ];
        }

        return $this->radiusService->enabledUser($params);
    }

    /**
     * Disconnect user (dedicated endpoint)
     */
    public function disconnectUser(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'accountNumber' => 'nullable|string',
                'username' => 'required|string',
                'remarks' => 'nullable|string',
                'updatedBy' => 'nullable|string',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                    'output' => 'Error: Validation failed'
                ], 422);
            }

            $result = $this->radiusService->disconnectUser($request->all());
            $statusCode = $result['status'] === 'success' ? 200 : 400;

            return response()->json($result, $statusCode);

        } catch (Exception $e) {
            Log::error("Disconnect User Error", [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Reconnect user (dedicated endpoint)
     */
    public function reconnectUser(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'accountNumber' => 'nullable|string',
                'username' => 'required|string',
                'plan' => 'required|string',
                'updatedBy' => 'nullable|string',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                    'output' => 'Error: Validation failed'
                ], 422);
            }

            $result = $this->radiusService->reconnectUser($request->all());
            $statusCode = $result['status'] === 'success' ? 200 : 400;

            return response()->json($result, $statusCode);

        } catch (Exception $e) {
            Log::error("Reconnect User Error", [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Update user group (dedicated endpoint)
     */
    public function updateGroup(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'accountNumber' => 'nullable|string',
                'username' => 'required|string',
                'plan' => 'required|string',
                'updatedBy' => 'nullable|string',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                    'output' => 'Error: Validation failed'
                ], 422);
            }

            $result = $this->radiusService->updateGroup($request->all());
            $statusCode = $result['status'] === 'success' ? 200 : 400;

            return response()->json($result, $statusCode);

        } catch (Exception $e) {
            Log::error("Update Group Error", [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Update credentials (dedicated endpoint)
     */
    public function updateCredentials(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'accountNumber' => 'nullable|string',
                'username' => 'required|string',
                'newUsername' => 'required|string|different:username',
                'newPassword' => 'required|string|min:6',
                'updatedBy' => 'nullable|string',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                    'output' => 'Error: Validation failed'
                ], 422);
            }

            $result = $this->radiusService->updateCredentials($request->all());
            $statusCode = $result['status'] === 'success' ? 200 : 400;

            return response()->json($result, $statusCode);

        } catch (Exception $e) {
            Log::error("Update Credentials Error", [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Disable user (dedicated endpoint)
     */
    public function disabledUser(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'accountNumber' => 'nullable|string',
                'username' => 'required|string',
                'updatedBy' => 'nullable|string',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                    'output' => 'Error: Validation failed'
                ], 422);
            }

            $result = $this->radiusService->disabledUser($request->all());
            $statusCode = $result['status'] === 'success' ? 200 : 400;

            return response()->json($result, $statusCode);

        } catch (Exception $e) {
            Log::error("Disable User Error", [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Enable user (dedicated endpoint)
     */
    public function enabledUser(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'accountNumber' => 'nullable|string',
                'username' => 'required|string',
                'updatedBy' => 'nullable|string',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Validation failed',
                    'errors' => $validator->errors(),
                    'output' => 'Error: Validation failed'
                ], 422);
            }

            $result = $this->radiusService->enabledUser($request->all());
            $statusCode = $result['status'] === 'success' ? 200 : 400;

            return response()->json($result, $statusCode);

        } catch (Exception $e) {
            Log::error("Enable User Error", [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
                'output' => 'Error: ' . $e->getMessage()
            ], 500);
        }
    }
    /**
     * Handle delete user operation
     */
    private function handleDeletion(Request $request, array $params): array
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string',
        ]);

        if ($validator->fails()) {
            return [
                'status' => 'error',
                'message' => 'Username is required',
                'output' => 'Error: Username is required'
            ];
        }

        return $this->radiusService->deleteAccount($params['username']);
    }
}

