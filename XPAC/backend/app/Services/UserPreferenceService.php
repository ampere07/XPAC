<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;

class UserPreferenceService
{
    public function getUserPreference(string $key, $default = null)
    {
        $userId = Auth::id();
        
        if (!$userId) {
            return $default;
        }

        $preference = DB::table('user_preferences')
            ->where('user_id', $userId)
            ->where('preference_key', $key)
            ->first();

        if (!$preference) {
            return $default;
        }

        $value = $preference->preference_value;
        
        $decoded = json_decode($value, true);
        return json_last_error() === JSON_ERROR_NONE ? $decoded : $value;
    }

    public function setUserPreference(string $key, $value): bool
    {
        $userId = Auth::id();
        
        \Log::info('[UserPreferenceService] setUserPreference called', [
            'key' => $key,
            'user_id' => $userId
        ]);
        
        if (!$userId) {
            \Log::error('[UserPreferenceService] No authenticated user found');
            return false;
        }

        try {
            $valueToStore = is_array($value) || is_object($value) 
                ? json_encode($value) 
                : $value;

            // One statement, not exists()-then-insert.
            //
            // Two tabs saving the same preference at once - which is exactly what the
            // reconciliation tools' slice configuration does, since every screen writes
            // its own copy on close - both read "absent" and both insert, and the
            // second fails on the `unique_user_preference` index. updateOrInsert
            // resolves that against the same index in one round trip, so a concurrent
            // save is an update rather than a duplicate-key error the operator sees.
            DB::table('user_preferences')->updateOrInsert(
                [
                    'user_id' => $userId,
                    'preference_key' => $key,
                ],
                [
                    'preference_value' => $valueToStore,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]
            );

            \Log::info('[UserPreferenceService] Successfully saved preference');
            return true;
        } catch (\Exception $e) {
            \Log::error('[UserPreferenceService] Exception in setUserPreference', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'file' => $e->getFile(),
                'line' => $e->getLine()
            ]);
            return false;
        }
    }

    public function deleteUserPreference(string $key): bool
    {
        $userId = Auth::id();
        
        if (!$userId) {
            return false;
        }

        DB::table('user_preferences')
            ->where('user_id', $userId)
            ->where('preference_key', $key)
            ->delete();

        return true;
    }

    public function getAllUserPreferences(): array
    {
        $userId = Auth::id();
        
        if (!$userId) {
            return [];
        }

        $preferences = DB::table('user_preferences')
            ->where('user_id', $userId)
            ->get();

        $result = [];
        foreach ($preferences as $pref) {
            $value = $pref->preference_value;
            $decoded = json_decode($value, true);
            $result[$pref->preference_key] = json_last_error() === JSON_ERROR_NONE ? $decoded : $value;
        }

        return $result;
    }
}
