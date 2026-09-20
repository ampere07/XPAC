<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Require a valid API token.
 *
 * The token is the one AuthController issues at login: a random string handed
 * back in the response body, kept by the client and returned as
 * `Authorization: Bearer <token>`. It is checked against the cache entry the
 * login created.
 *
 * Header-based on purpose. It needs no cookie, so it works identically in a
 * desktop browser and in an in-app browser such as Messenger's, where a
 * cross-host cookie may never be returned at all.
 *
 * This check used to be copied by hand into the two controllers that bothered
 * to do it, and simply omitted everywhere else — which is how the applicant
 * list, the status endpoint and the plan writes ended up publicly callable.
 * Having it as middleware means a route is protected by being listed in the
 * protected group, rather than by whoever wrote the controller remembering.
 *
 * The authenticated user is attached to the request, so a controller can read
 * `$request->user()` without going back to the cache.
 */
class EnsureApiTokenIsValid
{
    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken();

        if (! $token) {
            return $this->unauthenticated('Authentication required');
        }

        $userData = Cache::get(self::cacheKey($token));

        if (! $userData || empty($userData['user_id'])) {
            // Covers an expired token, a revoked one, and a fabricated one
            // alike. The message is deliberately the same for all three: which
            // of them it was is not something an unauthenticated caller needs
            // to be told.
            return $this->unauthenticated('Invalid or expired token');
        }

        $user = User::find($userData['user_id']);

        if (! $user) {
            // The token outlived the account it belongs to. Drop it rather than
            // leave a credential in the cache that resolves to nobody.
            Cache::forget(self::cacheKey($token));

            return $this->unauthenticated('Invalid or expired token');
        }

        $request->setUserResolver(fn () => $user);

        return $next($request);
    }

    /**
     * Where a token's record lives in the cache.
     *
     * The token is hashed rather than used as the key directly. Cache entries
     * are readable by anything that can read the cache store — with the file
     * driver, that is a filename on disk — and a raw token in that position is
     * a working credential to anyone who sees it. A hash is not.
     *
     * Shared with AuthController so issuing, checking and revoking a token all
     * agree on where it is kept.
     */
    public static function cacheKey(string $token): string
    {
        return 'auth_token_' . hash('sha256', $token);
    }

    private function unauthenticated(string $message)
    {
        return response()->json([
            'success' => false,
            'message' => $message,
        ], 401);
    }
}
