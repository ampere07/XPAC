<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

class RouteServiceProvider extends ServiceProvider
{
    /**
     * The path to the "home" route for your application.
     *
     * Typically, users are redirected here after authentication.
     *
     * @var string
     */
    public const HOME = '/home';

    /**
     * Define your route model bindings, pattern filters, and other route configuration.
     *
     * @return void
     */
    public function boot()
    {
        $this->configureRateLimiting();

        $this->routes(function () {
            Route::middleware('api')
                ->prefix('api')
                ->group(base_path('routes/api.php'));

            Route::middleware('web')
                ->group(base_path('routes/web.php'));
        });
    }

    /**
     * Configure the rate limiters for the application.
     *
     * @return void
     */
    protected function configureRateLimiting()
    {
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
        });

        // Per-IP ceilings for the email verification endpoints, on top of the
        // per-address cooldown and attempt limit in EmailVerificationService:
        // those stop hammering one address, these stop one client spraying many.
        RateLimiter::for('email-verification-send', function (Request $request) {
            return Limit::perHour(10)->by('evs:' . $request->ip())->response(fn () => response()->json([
                'success' => false,
                'message' => 'Too many verification emails requested. Please try again later.',
            ], 429));
        });

        RateLimiter::for('email-verification-verify', function (Request $request) {
            return Limit::perMinutes(10, 30)->by('evv:' . $request->ip())->response(fn () => response()->json([
                'success' => false,
                'message' => 'Too many verification attempts. Please try again in a few minutes.',
            ], 429));
        });
    }
}
