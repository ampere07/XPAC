<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class HandleCorsManually
{
    public function handle(Request $request, Closure $next)
    {
        // Skip CORS for webhook endpoints (they don't need CORS)
        if ($request->is('api/xendit-webhook') || $request->is('api/payments/webhook')) {
            return $next($request);
        }
        
        // Get the origin from the request
        $origin = $request->header('Origin');
        
        // Define allowed origins
        $allowedOrigins = [
            'https://sync.gowiser.ph',
            'https://backend.gowiser.ph',
        ];

        // Handle preflight OPTIONS request
        if ($request->getMethod() === 'OPTIONS') {
            $response = response('', 200);
            
            // Set CORS headers for preflight
            if ($origin && in_array($origin, $allowedOrigins)) {
                $response->header('Access-Control-Allow-Origin', $origin);
            } else {
                // Default to the frontend portal origin
                $response->header('Access-Control-Allow-Origin', 'https://sync.gowiser.ph');
            }
            
            $response->header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
            $response->header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-XSRF-TOKEN, X-App-ID, X-Skip-Auth-Error');
            $response->header('Access-Control-Allow-Credentials', 'true');
            $response->header('Access-Control-Max-Age', '86400');
            
            return $response;
        }

        // Process the actual request
        $response = $next($request);

        // Add CORS headers to the response
        if ($origin && in_array($origin, $allowedOrigins)) {
            $response->headers->set('Access-Control-Allow-Origin', $origin);
        } else {
            // Default to the frontend portal origin
            $response->headers->set('Access-Control-Allow-Origin', 'https://sync.gowiser.ph');
        }
        
        $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-XSRF-TOKEN, X-App-ID, X-Skip-Auth-Error');
        $response->headers->set('Access-Control-Allow-Credentials', 'true');
        $response->headers->set('Access-Control-Max-Age', '86400');

        return $response;
    }
}

