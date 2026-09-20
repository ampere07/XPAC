<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * CORS for the SPA.
 *
 * This replaces Laravel's own HandleCors in the global stack, so it is the only
 * thing emitting CORS headers. The allow-list lives in config/cors.php rather
 * than here, so there is one place to change it.
 *
 * Two rules it must never break:
 *
 *   1. An origin that is not on the list gets NO CORS headers at all. Sending
 *      headers for some other origin does not make the browser more permissive,
 *      it just replaces a clear "origin not allowed" with a confusing mismatch,
 *      and with credentials in play the request fails either way.
 *
 *   2. Every response carries `Vary: Origin`. The header we emit depends on the
 *      request's Origin, so without it any shared cache — a CDN, a proxy, or an
 *      in-app browser's own cache — can serve the headers computed for one
 *      origin to a request from another, which then fails CORS for no visible
 *      reason.
 */
class HandleCorsManually
{
    /** Endpoints called server-to-server, which have no Origin and need no CORS. */
    private const EXEMPT_PATHS = [
        'api/xendit-webhook',
        'api/payments/webhook',
    ];

    public function handle(Request $request, Closure $next)
    {
        foreach (self::EXEMPT_PATHS as $path) {
            if ($request->is($path)) {
                return $next($request);
            }
        }

        $origin = $request->header('Origin');
        $allowed = $this->isAllowedOrigin($origin);

        // Preflight is answered here and never reaches the route.
        if ($request->getMethod() === 'OPTIONS') {
            $response = response('', $allowed ? 204 : 403);

            if ($allowed) {
                $this->applyCorsHeaders($response, $origin, $request);
            }

            // Set even on a refusal, so a refusal is not cached and replayed
            // against an origin that would have been allowed.
            $response->headers->set('Vary', 'Origin');

            return $response;
        }

        $response = $next($request);

        if ($allowed) {
            $this->applyCorsHeaders($response, $origin, null);
        }

        $this->appendVary($response, 'Origin');

        return $response;
    }

    /**
     * Is this origin allowed to talk to the API?
     *
     * A request with no Origin header is not a browser cross-origin request at
     * all (curl, a webhook, a same-origin navigation), so there is nothing to
     * authorise and nothing to emit.
     */
    private function isAllowedOrigin(?string $origin): bool
    {
        if ($origin === null || $origin === '') {
            return false;
        }

        $allowedOrigins = (array) config('cors.allowed_origins', []);

        if (in_array('*', $allowedOrigins, true) || in_array($origin, $allowedOrigins, true)) {
            return true;
        }

        foreach ((array) config('cors.allowed_origins_patterns', []) as $pattern) {
            if (@preg_match($pattern, $origin) === 1) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  Request|null  $preflightRequest  the request when this is a
     *        preflight, which needs the method/header/max-age negotiation;
     *        null for an actual response, which does not.
     */
    private function applyCorsHeaders($response, string $origin, ?Request $preflightRequest): void
    {
        // The exact origin, never "*": a wildcard is invalid alongside
        // credentials, and every request from the SPA carries the session.
        $response->headers->set('Access-Control-Allow-Origin', $origin);
        $response->headers->set('Access-Control-Allow-Credentials', 'true');

        $exposed = (array) config('cors.exposed_headers', []);
        if ($exposed !== []) {
            $response->headers->set('Access-Control-Expose-Headers', implode(', ', $exposed));
        }

        if ($preflightRequest === null) {
            return;
        }

        $response->headers->set(
            'Access-Control-Allow-Methods',
            'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        );

        // Requested headers are echoed back when the browser asks for them, so
        // a header added on the client — Authorization, for one — does not
        // need a change here to be permitted.
        $requested = $preflightRequest->header('Access-Control-Request-Headers');

        $response->headers->set(
            'Access-Control-Allow-Headers',
            $requested ?: 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-XSRF-TOKEN, X-CSRF-TOKEN, X-App-ID, X-Skip-Auth-Error, X-Auth-Token, X-Device-Id'
        );

        $response->headers->set('Access-Control-Max-Age', (string) config('cors.max_age', 86400));
    }

    /** Add to Vary without discarding a value the response already carries. */
    private function appendVary($response, string $value): void
    {
        $existing = $response->headers->get('Vary');

        if (! $existing) {
            $response->headers->set('Vary', $value);
            return;
        }

        $parts = array_map('trim', explode(',', $existing));

        if (! in_array($value, $parts, true)) {
            $parts[] = $value;
            $response->headers->set('Vary', implode(', ', $parts));
        }
    }
}
