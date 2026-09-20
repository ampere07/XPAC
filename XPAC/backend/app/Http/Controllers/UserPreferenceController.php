<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Services\UserPreferenceService;
use Illuminate\Support\Facades\Validator;

class UserPreferenceController extends Controller
{
    protected $preferenceService;

    public function __construct(UserPreferenceService $preferenceService)
    {
        $this->preferenceService = $preferenceService;
    }

    public function getPreference(Request $request, string $key)
    {
        $default = $request->query('default');
        $value = $this->preferenceService->getUserPreference($key, $default);

        return response()->json([
            'success' => true,
            'data' => [
                'key' => $key,
                'value' => $value
            ]
        ]);
    }

    public function setPreference(Request $request, string $key)
    {
        \Log::info('[UserPreferenceController] setPreference called', [
            'key' => $key,
            'user_id' => \Auth::id(),
            'request_data' => $request->all(),
            'method' => $request->method(),
            'url' => $request->fullUrl()
        ]);

        $validator = Validator::make($request->all(), [
            'value' => 'required'
        ]);

        if ($validator->fails()) {
            \Log::error('[UserPreferenceController] Validation failed', [
                'errors' => $validator->errors()->toArray()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        $value = $request->input('value');
        
        \Log::info('[UserPreferenceController] Calling preferenceService->setUserPreference', [
            'key' => $key,
            'value' => $value
        ]);
        
        try {
            $success = $this->preferenceService->setUserPreference($key, $value);
            
            \Log::info('[UserPreferenceController] setUserPreference result', [
                'success' => $success
            ]);

            return response()->json([
                'success' => $success,
                'message' => $success ? 'Preference saved successfully' : 'Failed to save preference',
                'data' => [
                    'key' => $key,
                    'value' => $value
                ]
            ]);
        } catch (\Exception $e) {
            \Log::error('[UserPreferenceController] Exception in setPreference', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Server error: ' . $e->getMessage()
            ], 500);
        }
    }

    public function deletePreference(string $key)
    {
        $success = $this->preferenceService->deleteUserPreference($key);

        return response()->json([
            'success' => true,
            'message' => $success ? 'Preference deleted successfully' : 'Failed to delete preference'
        ]);
    }

    public function getAllPreferences()
    {
        $preferences = $this->preferenceService->getAllUserPreferences();

        return response()->json([
            'success' => true,
            'data' => $preferences
        ]);
    }
}
