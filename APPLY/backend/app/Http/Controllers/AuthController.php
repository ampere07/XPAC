<?php

namespace App\Http\Controllers;

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
        
        Cache::put('auth_token_' . $token, [
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
            Cache::forget('auth_token_' . $token);
        }

        return response()->json([
            'success' => true,
            'message' => 'Logged out successfully'
        ]);
    }

    public function user(Request $request)
    {
        $token = $request->bearerToken();
        
        if (!$token) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized'
            ], 401);
        }

        $userData = Cache::get('auth_token_' . $token);

        if (!$userData) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized'
            ], 401);
        }

        $user = User::find($userData['user_id']);

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized'
            ], 401);
        }

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
