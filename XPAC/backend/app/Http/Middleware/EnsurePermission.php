<?php

namespace App\Http\Middleware;

use App\Support\Permissions;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restricts a route to holders of a permission key, e.g.
 * `->middleware('permission:job-order.approve')`.
 *
 * Several keys may be listed, in which case any one of them is enough.
 *
 * ApiAccessControl already applies the table in App\Support\ApiPermissionMap to
 * every API request, so this is for the cases where a route wants to say so on
 * its own line — a new endpoint whose requirement is not obvious from its path,
 * or one that is deliberately stricter than its neighbours.
 */
class EnsurePermission
{
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();

        if ($user === null) {
            return response()->json([
                'success' => false,
                'status'  => 'error',
                'message' => 'You must be signed in to perform this action.',
            ], 401);
        }

        if (!Permissions::allows($user, $permissions)) {
            return response()->json([
                'success' => false,
                'status'  => 'error',
                'message' => 'You do not have permission to perform this action.',
            ], 403);
        }

        return $next($request);
    }
}
