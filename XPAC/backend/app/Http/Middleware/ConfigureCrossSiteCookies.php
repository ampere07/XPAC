<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * Make the session and CSRF cookies survive an in-app browser.
 *
 * The SPA (sync.atssfiber.ph) and the API (backend.atssfiber.ph) are different
 * hosts. A normal browser treats them as the same site, because they share the
 * registrable domain, so a `SameSite=Lax` cookie is sent with the SPA's API
 * calls and everything works.
 *
 * An in-app browser — Messenger's above all — does not give that guarantee. It
 * is a WebView with its own cookie policy, and the ones that restrict
 * cross-host cookies drop a Lax cookie set by a host other than the page's.
 * The result is a session cookie the server sets and the browser never returns:
 * login appears to succeed, and the next request is a 401.
 *
 * `SameSite=None; Secure` is the attribute pair that says "send this on
 * cross-site requests too", and it is what the WebViews honour. It is strictly
 * more permissive than Lax, so nothing that worked before can stop working.
 *
 * WHY A RESPONSE REWRITE RATHER THAN CONFIGURATION
 * ------------------------------------------------
 * Setting SESSION_SAME_SITE_COOKIE has no effect on API routes. Sanctum's
 * EnsureFrontendRequestsAreStateful calls configureSecureCookieSessions(),
 * which assigns `session.same_site = 'lax'` at runtime on every request,
 * overriding config and .env alike. Rewriting the cookies on the finished
 * response is the one place that cannot be overridden afterwards.
 *
 * Registered first in the global stack so its response half runs last, after
 * every cookie any middleware or route has added.
 */
class ConfigureCrossSiteCookies
{
    /**
     * Cookies the browser must return for authentication to work.
     *
     * Only these are touched. A cookie set for some other purpose keeps
     * whatever attributes its author chose.
     */
    private function authCookieNames(): array
    {
        return [
            (string) config('session.cookie'),
            'XSRF-TOKEN',
        ];
    }

    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        // `SameSite=None` is only honoured on a Secure cookie, and a Secure
        // cookie is discarded over plain http. So over http — local development
        // on localhost:3000 — the cookies are left exactly as they were, which
        // keeps the existing dev setup working unchanged.
        if (! $request->isSecure()) {
            return $response;
        }

        $names = $this->authCookieNames();
        $cookies = $response->headers->getCookies();

        foreach ($cookies as $cookie) {
            if (! in_array($cookie->getName(), $names, true)) {
                continue;
            }

            // Already correct: leave it be rather than reissuing it.
            if ($cookie->getSameSite() === Cookie::SAMESITE_NONE && $cookie->isSecure()) {
                continue;
            }

            $response->headers->setCookie(
                $cookie->withSecure(true)->withSameSite(Cookie::SAMESITE_NONE)
            );
        }

        return $response;
    }
}
