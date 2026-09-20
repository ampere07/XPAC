<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\User;

class UserSettingsController extends Controller
{
    public function updateDarkMode(Request $request)
    {
        try {
            $validated = $request->validate([
                'user_id' => 'required|exists:users,id',
                'darkmode' => 'required|in:active,inactive'
            ]);

            $user = User::findOrFail($validated['user_id']);
            
            \Log::info('Updating dark mode', [
                'user_id' => $user->id,
                'old_darkmode' => $user->darkmode,
                'new_darkmode' => $validated['darkmode']
            ]);
            
            $user->update([
                'darkmode' => $validated['darkmode']
            ]);

            \Log::info('Dark mode updated successfully', [
                'user_id' => $user->id,
                'darkmode' => $user->fresh()->darkmode
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Dark mode preference updated successfully',
                'data' => [
                    'darkmode' => $user->fresh()->darkmode
                ]
            ]);
        } catch (\Illuminate\Validation\ValidationException $e) {
            \Log::error('Validation error updating dark mode', [
                'errors' => $e->errors(),
                'request' => $request->all()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            \Log::error('Error updating dark mode', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request' => $request->all()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Failed to update dark mode preference',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getDarkMode(Request $request, $userId)
    {
        try {
            $user = User::findOrFail($userId);

            return response()->json([
                'success' => true,
                'data' => [
                    'darkmode' => $user->darkmode ?? 'active'
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch dark mode preference',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
