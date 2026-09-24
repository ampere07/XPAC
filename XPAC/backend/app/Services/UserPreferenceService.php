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
            'value' => $value,
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

            \Log::info('[UserPreferenceService] Value to store', [
                'original_value' => $value,
                'stored_value' => $valueToStore,
                'is_json' => is_array($value) || is_object($value)
            ]);

            $exists = DB::table('user_preferences')
                ->where('user_id', $userId)
                ->where('preference_key', $key)
                ->exists();

            \Log::info('[UserPreferenceService] Checking if preference exists', [
                'exists' => $exists
            ]);

            if ($exists) {
                \Log::info('[UserPreferenceService] Updating existing preference');
                
                DB::table('user_preferences')
                    ->where('user_id', $userId)
                    ->where('preference_key', $key)
                    ->update([
                        'preference_value' => $valueToStore,
                        'updated_at' => now()
                    ]);
                    
                \Log::info('[UserPreferenceService] Update completed');
            } else {
                \Log::info('[UserPreferenceService] Inserting new preference');
                
                DB::table('user_preferences')->insert([
                    'user_id' => $userId,
                    'preference_key' => $key,
                    'preference_value' => $valueToStore,
                    'created_at' => now(),
                    'updated_at' => now()
                ]);
                
                \Log::info('[UserPreferenceService] Insert completed');
            }

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
