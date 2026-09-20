<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\TableCheckService;
use Illuminate\Support\Facades\Log;

class EnsureTablesExist
{
    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure(\Illuminate\Http\Request): (\Illuminate\Http\Response|\Illuminate\Http\RedirectResponse)  $next
     * @return \Illuminate\Http\Response|\Illuminate\Http\RedirectResponse
     */
    public function handle(Request $request, Closure $next)
    {
        // Check for tables on any route that might need them
        if ($request->is('api/applications*') || $request->is('api/application*') || $request->is('api/documents*')) {
            // Check all required tables
            $tableResults = TableCheckService::ensureAllRequiredTablesExist();
            
            // Check for any failures
            $allTablesExist = !in_array(false, $tableResults, true);
            
            if (!$allTablesExist) {
                Log::error('One or more database tables missing and could not be created');
                
                // For API routes, return JSON error
                if ($request->expectsJson()) {
                    return response()->json([
                        'error' => 'Database setup issue. Please contact support.'
                    ], 500);
                }
                
                // For web routes, you could redirect to an error page
                return redirect()->route('database.error');
            }
        }
        
        return $next($request);
    }
}
