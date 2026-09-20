<?php

namespace App\Http\Middleware;

use App\Models\Role;
use App\Support\Permissions;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restricts a route to one or more roles, e.g. ->middleware('role:super_admin').
 *
 * Arguments are slugs (see Role::SLUGS) or bare role IDs.
 *
 * A hybrid custom role satisfies its base role's name: a role built on
 * Administrator holds everything an Administrator holds, so a route open to
 * Administrator is open to it too. Without that, "Administrator plus a couple
 * of extra pages" would be strictly weaker than Administrator on the handful of
 * routes guarded this way, which is the opposite of what the base means.
 *
 * Most report routes sit outside the `auth:sanctum` group, so an unauthenticated
 * caller reaches the controller with a null user rather than being rejected up
 * front. That is why the null case is answered with 401 here instead of being
 * assumed away: several existing Api controllers treat "no user" as a global
 * admin, and a delete endpoint must never inherit that.
 */
class EnsureUserHasRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if ($user === null) {
            return response()->json([
                'success' => false,
                'message' => 'You must be signed in to perform this action.',
            ], 401);
        }

        $allowed = array_filter(array_map([Role::class, 'idForSlug'], $roles), 'is_int');

        // The role itself, or — for a hybrid — the seeded role it inherits.
        // baseRoleIdFor() is null for every role that is not a hybrid, so this
        // widens nothing that existed before hybrids did.
        $held = array_filter([
            (int) $user->role_id,
            Permissions::baseRoleIdFor($user),
        ], 'is_int');

        if (empty(array_intersect($held, $allowed))) {
            return response()->json([
                'success' => false,
                'message' => 'You do not have permission to perform this action.',
            ], 403);
        }

        return $next($request);
    }
}
