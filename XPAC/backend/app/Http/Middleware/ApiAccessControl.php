<?php

namespace App\Http\Middleware;

use App\Support\ApiPermissionMap;
use App\Support\Permissions;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authorization for the whole API, applied once in the `api` middleware group.
 *
 * Every request is looked up in App\Support\ApiPermissionMap, which answers one
 * of three things: anonymous is fine, any signed-in user is fine, or a specific
 * permission key is needed. Anything the map has no rule for still has to be
 * signed in.
 *
 * Why here rather than on the routes: the API had ~670 endpoints and 46 of them
 * required a session. Annotating the rest one by one would have been a
 * six-hundred-line diff that the next endpoint added could silently opt out of.
 * A single gate cannot be forgotten.
 *
 * The user is resolved through the `sanctum` guard explicitly, which accepts
 * either credential the clients hold: the session cookie (the normal case) or
 * the personal access token issued alongside it at sign-in (the fallback for a
 * WebView that drops cross-site cookies). Once resolved it is set as the
 * default user for the request, so `$request->user()` and `Auth::user()` behave
 * downstream exactly as they do inside an `auth:sanctum` group — controllers
 * that already read either keep working untouched.
 */
class ApiAccessControl
{
    /**
     * Requests that never carry credentials and never should be challenged.
     *
     * A CORS preflight is sent by the browser without cookies or an
     * Authorization header by definition; answering it with a 401 breaks the
     * real request that follows.
     */
    private const ALWAYS_ALLOWED_METHODS = ['OPTIONS'];

    public function handle(Request $request, Closure $next): Response
    {
        if (in_array($request->method(), self::ALWAYS_ALLOWED_METHODS, true)) {
            return $next($request);
        }

        $requirement = ApiPermissionMap::requirementFor($request->method(), $request->path());

        if ($requirement === ApiPermissionMap::PUBLIC_ACCESS) {
            return $next($request);
        }

        $user = $this->resolveUser($request);

        if ($user === null) {
            // Which credential was missing, not just that one was.
            //
            // This log said only "denied", so a customer reporting a dashboard
            // that would not load could not be told apart from a token the server
            // never received, a token row that had been deleted, or a session that
            // had simply lapsed — three different faults with three different
            // fixes. Naming them is what makes the next occurrence answerable from
            // the log instead of from a rebuild of the whole auth path.
            return $this->deny($request, 'You must be signed in to perform this action.', 401, [
                'had_authorization_header' => $request->hasHeader('Authorization'),
                'had_auth_token_header'    => $request->hasHeader('X-Auth-Token'),
                'had_session_cookie'       => $request->hasCookie(config('session.cookie')),
                'device_id'                => substr((string) $request->header('X-Device-Id', ''), 0, 64) ?: null,
            ]);
        }

        // null means "signed in is enough" — reference data, lookups, the
        // user's own preferences.
        if ($requirement === null) {
            return $next($request);
        }

        if (!Permissions::allows($user, $requirement)) {
            return $this->deny(
                $request,
                'You do not have permission to perform this action.',
                403,
                ['required' => $requirement, 'user_id' => $user->id ?? null, 'role_id' => $user->role_id ?? null]
            );
        }

        return $next($request);
    }

    /**
     * Resolve the caller and make them the request's user.
     *
     * Sanctum's guard reads the bearer token and, failing that, the session
     * that `EnsureFrontendRequestsAreStateful` has already started for a
     * first-party request. Binding the resolver means a later `auth:sanctum`
     * on an individual route — several are still declared, and they stay — does
     * not have to repeat the work.
     */
    private function resolveUser(Request $request)
    {
        $user = Auth::guard('sanctum')->user();

        if ($user === null) {
            return null;
        }

        Auth::shouldUse('sanctum');
        $request->setUserResolver(static fn () => $user);

        // Which credential actually carried the request. A TransientToken means the
        // session cookie won; anything else means the personal access token did.
        // Recorded because the two fail on completely different timescales, and
        // knowing which one clients are really running on is the difference between
        // guessing at this and measuring it.
        $request->attributes->set(
            'auth_credential',
            $user->currentAccessToken() instanceof \Laravel\Sanctum\TransientToken ? 'session' : 'token'
        );

        return $user;
    }

    /**
     * Refuse, as JSON.
     *
     * The clients read `success` and `message`; nothing about the failure that
     * would help someone probing the API is returned, and the detail goes to
     * the log instead.
     */
    private function deny(Request $request, string $message, int $status, array $context = []): Response
    {
        Log::warning('API access denied', array_merge([
            'status' => $status,
            'method' => $request->method(),
            'path'   => $request->path(),
            'ip'     => $request->ip(),
        ], $context));

        return response()->json([
            'success' => false,
            'status'  => 'error',
            'message' => $message,
        ], $status);
    }
}
