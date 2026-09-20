<?php

namespace App\Http\Controllers;

use App\Http\Middleware\EnsureApiTokenIsValid;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        $credentials = $request->only('username', 'password');
        
        $user = User::where('username', $credentials['username'])
                    ->orWhere('email_address', $credentials['username'])
                    ->first();

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid credentials'
            ], 401);
        }

        if (!Hash::check($credentials['password'], $user->password_hash)) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid credentials'
            ], 401);
        }

        $token = base64_encode(Str::random(40));

        // Keyed by a hash of the token, never the token itself. A cache entry
        // is readable by anything that can read the store — with the file
        // driver that is a filename on disk — and a raw token sitting there is
        // a working credential to whoever sees it.
        Cache::put(EnsureApiTokenIsValid::cacheKey($token), [
            'user_id' => $user->id,
            'username' => $user->username,
            'email' => $user->email_address
        ], now()->addHours(24));

        return response()->json([
            'success' => true,
            'message' => 'Login successful',
            'token' => $token,
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email_address,
                'name' => $user->username
            ]
        ]);
    }

    public function logout(Request $request)
    {
        $token = $request->bearerToken();
        
        if ($token) {
            Cache::forget(EnsureApiTokenIsValid::cacheKey($token));
        }

        return response()->json([
            'success' => true,
            'message' => 'Logged out successfully'
        ]);
    }

    /**
     * The signed-in user.
     *
     * The token check now happens in the auth.token middleware this route sits
     * behind, so by the time we get here the caller is authenticated and the
     * user is on the request. The hand-rolled copy of that check has gone.
     */
    public function user(Request $request)
    {
        $user = $request->user();

        return response()->json([
            'success' => true,
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email_address,
                'name' => $user->username
            ]
        ]);
    }
}
