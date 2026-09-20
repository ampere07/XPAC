<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class SkipSanctumForWebhooks
{
    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure  $next
     * @return mixed
     */
    public function handle(Request $request, Closure $next)
    {
        // Define webhook paths that should skip Sanctum
        $webhookPaths = [
            'api/xendit-webhook',
            'api/payments/webhook',
        ];

        // Check if current path matches any webhook path
        foreach ($webhookPaths as $path) {
            if ($request->is($path)) {
                // Skip Sanctum middleware for webhooks
                return $next($request);
            }
        }

        // For non-webhook routes, continue normally
        return $next($request);
    }
}
