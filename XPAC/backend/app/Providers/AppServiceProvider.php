<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

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
        //
    }
}
