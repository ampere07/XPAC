<?php

namespace App\Http\Middleware;

use App\Support\ApiPermissionMap;
use App\Support\Permissions;
use Closure;
use Illuminate\Auth\Recaller;
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
 * Why here rather than on the routes: the API has ~740 endpoints and only a
 * handful of them declare `auth:sanctum`. Annotating the rest one by one would
 * be a seven-hundred-line diff that the next endpoint added could silently opt
 * out of. A single gate cannot be forgotten.
 *
 * Rollout mode — config('permissions.api_access_control'), env API_ACCESS_CONTROL:
 *
 *   off      stands aside; the request is handled exactly as before.
 *
 *   log      (default) computes the decision and logs a would-be refusal as
 *            "API access would be denied", then lets the request through. The
 *            caller is identified PASSIVELY — from a user the web guard has
 *            already resolved, the session's stored user id, or the
 *            remember-me cookie — without logging anyone in, firing auth
 *            events, migrating the session or changing the default guard or
 *            the request's user resolver. So the only observable difference
 *            from `off` is the log line (and a primary-key lookup of the user).
 *
 *   enforce  refuses: 401 when nobody is signed in, 403 without the key. The
 *            user is the default (session) guard's, exactly as today; only
 *            when that finds nobody is a Sanctum bearer token tried, and then
 *            its owner is made the request's user. The default guard is left
 *            alone for session users, so Auth::logout()/login() keep working.
 */
class ApiAccessControl
{
    public const MODE_OFF = 'off';
    public const MODE_LOG = 'log';
    public const MODE_ENFORCE = 'enforce';

    /**
     * Requests that never carry credentials and never should be challenged.
     *
     * A CORS preflight is sent by the browser without cookies or an
     * Authorization header by definition; answering it with a 401 breaks the
     * real request that follows.
     */
    private const ALWAYS_ALLOWED_METHODS = ['OPTIONS'];

    /** The configured mode, normalised; anything unrecognised reads as `log`. */
    public static function mode(): string
    {
        $mode = strtolower(trim((string) config('permissions.api_access_control', self::MODE_LOG)));

        return in_array($mode, [self::MODE_OFF, self::MODE_LOG, self::MODE_ENFORCE], true)
            ? $mode
            : self::MODE_LOG;
    }

    public function handle(Request $request, Closure $next): Response
    {
        $mode = self::mode();

        if ($mode === self::MODE_OFF || in_array($request->method(), self::ALWAYS_ALLOWED_METHODS, true)) {
            return $next($request);
        }

        if ($mode === self::MODE_LOG) {
            // Never let the dry run break a request it was only meant to watch.
            try {
                $this->observe($request);
            } catch (\Throwable $e) {
                Log::debug('API access dry run failed', ['path' => $request->path(), 'error' => $e->getMessage()]);
            }

            return $next($request);
        }

        return $this->enforce($request, $next);
    }

    /** `enforce`: the gate proper. */
    private function enforce(Request $request, Closure $next): Response
    {
        $requirement = ApiPermissionMap::requirementFor($request->method(), $request->path());

        if ($requirement === ApiPermissionMap::PUBLIC_ACCESS) {
            return $next($request);
        }

        $user = $this->resolveUser($request);

        if ($user === null) {
            return $this->deny($request, 'You must be signed in to perform this action.', 401, $this->credentialContext($request));
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

    /** `log`: the same decision as enforce(), recorded rather than applied. */
    private function observe(Request $request): void
    {
        $requirement = ApiPermissionMap::requirementFor($request->method(), $request->path());

        if ($requirement === ApiPermissionMap::PUBLIC_ACCESS) {
            return;
        }

        $user = $this->peekUser($request);

        if ($user === null) {
            $this->logWouldDeny($request, 401, $this->credentialContext($request));
            return;
        }

        if ($requirement === null || Permissions::allows($user, $requirement)) {
            return;
        }

        $this->logWouldDeny($request, 403, [
            'required' => $requirement,
            'user_id'  => $user->id ?? null,
            'role_id'  => $user->role_id ?? null,
        ]);
    }

    /**
     * Resolve the caller and make them the request's user (enforce mode only).
     *
     * Sanctum's guard reads a bearer token and, failing that, the session that
     * `EnsureFrontendRequestsAreStateful` has already started for a first-party
     * request. Binding the resolver means a later `auth:sanctum` on an
     * individual route does not have to repeat the work.
     */
    private function resolveUser(Request $request)
    {
        // The session first, through the default guard — exactly what
        // `$request->user()` and the `throttle:api` limiter above already
        // resolve. When that is who is calling, nothing about the request is
        // changed: switching the default guard to sanctum's RequestGuard would
        // break every later `Auth::logout()` / `Auth::login()` (RequestGuard
        // has neither), which is how POST /logout would 500 under enforce.
        $default = Auth::guard(config('auth.defaults.guard', 'web'));
        $user = $default->user();

        if ($user !== null) {
            // A request built outside the HTTP kernel has no resolver of its
            // own; give it one. On a real request the resolver already answers
            // this same user, so nothing changes.
            if ($request->user() === null) {
                $request->setUserResolver(static fn () => $user);
            }

            return $user;
        }

        // Otherwise a bearer token, if Sanctum can resolve one. Only then does
        // the request's user become the token's owner. The clients send a
        // placeholder "user_token_…" bearer that is not a Sanctum token; looking
        // it up must end in a 401, never a 500 (e.g. no personal_access_tokens
        // table on this deployment).
        try {
            $user = Auth::guard('sanctum')->user();
        } catch (\Throwable $e) {
            Log::debug('API access: bearer token lookup failed', ['error' => $e->getMessage()]);
            $user = null;
        }

        if ($user === null) {
            return null;
        }

        Auth::shouldUse('sanctum');
        $request->setUserResolver(static fn () => $user);

        return $user;
    }

    /**
     * Who is calling, without changing anything about the request (log mode).
     *
     * SessionGuard::user() is deliberately not called: on a lapsed session it
     * logs the user back in from the remember-me cookie, which migrates the
     * session id and fires Login events — behaviour today's requests only get
     * when a controller asks for the user. Reading the same three sources
     * directly gives the same answer with none of those effects.
     */
    private function peekUser(Request $request)
    {
        $guard = Auth::guard(config('auth.defaults.guard', 'web'));

        if (method_exists($guard, 'hasUser') && $guard->hasUser()) {
            return $guard->user();
        }

        if (!method_exists($guard, 'getProvider') || !method_exists($guard, 'getName')) {
            return null;
        }

        $provider = $guard->getProvider();

        if ($request->hasSession()) {
            $id = $request->session()->get($guard->getName());

            if ($id !== null && ($user = $provider->retrieveById($id)) !== null) {
                return $user;
            }
        }

        if (method_exists($guard, 'getRecallerName')) {
            $cookie = $request->cookies->get($guard->getRecallerName());

            if (is_string($cookie) && $cookie !== '') {
                $recaller = new Recaller($cookie);

                if ($recaller->valid()) {
                    return $provider->retrieveByToken($recaller->id(), $recaller->token());
                }
            }
        }

        return null;
    }

    /** Which credential was missing, not just that one was. */
    private function credentialContext(Request $request): array
    {
        return [
            'had_authorization_header' => $request->hasHeader('Authorization'),
            'had_session_cookie'       => $request->hasCookie(config('session.cookie')),
        ];
    }

    private function logWouldDeny(Request $request, int $status, array $context): void
    {
        Log::warning('API access would be denied', array_merge([
            'mode'   => self::MODE_LOG,
            'status' => $status,
            'method' => $request->method(),
            'path'   => $request->path(),
            'ip'     => $request->ip(),
        ], $context));
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
