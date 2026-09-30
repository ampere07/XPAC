<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Requires the bearer token AuthController::login issues (kept in the cache as
 * auth_token_{token}) — the same check DashboardController makes inline.
 *
 * Guards the admin application endpoints, which return applicants' personal
 * details and ID document links and must never be reachable anonymously.
 */
class RequireApplyToken
{
    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken();

        if (!$token || Cache::get('auth_token_' . $token) === null) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized',
            ], 401);
        }

        return $next($request);
    }
}
