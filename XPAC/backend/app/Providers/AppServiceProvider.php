<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     *
     * @return void
     */
    public function register()
    {
        /*
         * One RADIUS connection layer per request, shared by every caller.
         *
         * Every RADIUS operation in this app goes through RouterosApiService::connect(),
         * which is where the transport choice, the two-transport failover and the circuit
         * breaker live. Resolving a NEW instance per call site defeated half of that: the
         * connection pool is per instance, so a single request that touched
         * ManualRadiusOperations, the resolver and the queue opened three separate
         * sessions to the same device instead of reusing one. RouterOS caps concurrent
         * API sessions at `max-sessions`, 20 by default, so that multiplies straight into
         * the ceiling under a queue run.
         *
         * Scoped, not a plain singleton: the pool holds live sockets, so it must not
         * outlive the request (or the queue job) that opened them. A scoped binding is
         * rebuilt per request and per queue job, which is exactly the socket lifetime the
         * service already assumes — its destructor closes everything it still holds.
         */
        $this->app->scoped(\App\Services\RouterosApiService::class);
    }

    /**
     * Bootstrap any application services.
     *
     * @return void
     */
    public function boot()
    {
        /*
         * Find the bearer token even where the web server did not hand it over.
         *
         * public/.htaccess now copies the Authorization header into the request
         * environment, but .htaccess is only read when the host is Apache AND
         * AllowOverride permits it — under nginx it is ignored outright, and some
         * managed hosts strip Authorization before PHP ever runs. That single
         * point of failure is what made this expensive: the token was issued
         * correctly, stored correctly and sent correctly, and still authenticated
         * nobody, so a customer who stayed signed in past the life of their
         * session cookie was left with no working credential at all.
         *
         * Three sources, in order of preference:
         *   - the standard Authorization header, when it arrives intact;
         *   - X-Auth-Token, a plain header both clients also send, which nothing
         *     between the phone and PHP has any reason to strip;
         *   - the REDIRECT_-prefixed copies Apache leaves behind when the header
         *     was rewritten across an internal redirect.
         *
         * X-Auth-Token adds no CSRF surface: no browser attaches a custom header
         * on its own, so it cannot ride along on a forged cross-site request the
         * way a cookie does.
         */
        Sanctum::getAccessTokenFromRequestUsing(function ($request) {
            $raw = $request->bearerToken()
                ?: $request->header('X-Auth-Token')
                ?: ($_SERVER['REDIRECT_HTTP_AUTHORIZATION']
                    ?? $_SERVER['REDIRECT_REDIRECT_HTTP_AUTHORIZATION']
                    ?? null);

            if (!is_string($raw) || trim($raw) === '') {
                return null;
            }

            $raw = preg_replace('/^\s*Bearer\s+/i', '', trim($raw));

            // Sanctum's own format check, which overriding this callback skips.
            // Without it every junk header becomes a database lookup, and the
            // legacy "user_token_<id>_<time>" strings some installs still hold
            // would each cost a query before failing.
            return str_contains($raw, '|') ? $raw : null;
        });

        /*
         * Audit every edit to a customer account.
         *
         * These three models are what an account is made of, and observing them
         * means the history is written by the act of saving rather than by each
         * caller remembering to write it — so a screen, an API endpoint, a cron
         * command or a service added next year is covered the moment it saves.
         *
         * See App\Observers\AccountDetailsObserver for what is recorded and why
         * a failure there can never reach the update it is describing.
         */
        \App\Models\Customer::observe(\App\Observers\AccountDetailsObserver::class);
        \App\Models\BillingAccount::observe(\App\Observers\AccountDetailsObserver::class);
        \App\Models\TechnicalDetail::observe(\App\Observers\AccountDetailsObserver::class);
    }
}
