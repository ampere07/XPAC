<?php

namespace App\Support;

use Illuminate\Support\Facades\Auth;

/**
 * The account a customer-portal caller is confined to.
 *
 * Several endpoints serve two audiences: staff reading the whole table from an
 * admin page, and a customer reading their own row from the portal. Granting
 * the portal key on such an endpoint is only safe if the query is then pinned
 * to the caller's own account — the `account_no` these pages send is a query
 * parameter, and a query parameter is a filter, not an authorization boundary.
 *
 * A caller is confined when they hold one of the portal keys and none of the
 * staff keys that endpoint accepts. That is a permission test rather than a
 * role id, so a custom role built on top of customer is confined the same way,
 * and a staff role that happens to also hold a portal key is not.
 *
 * A customer's account number is their username; the users table has no
 * separate account_no column.
 */
final class CustomerScope
{
    /** The customer portal's own pages. */
    private const PORTAL_KEYS = [
        'customer-dashboard',
        'customer-bills',
        'customer-support',
    ];

    /**
     * @param  string|array  $staffKeys  the key(s) that mean "may see everyone's"
     * @return string|null  the account to pin to, or null if the caller is not confined
     */
    public static function accountNo(string|array $staffKeys): ?string
    {
        $user = Auth::user();

        if ($user === null) {
            return null;
        }

        // Staff for this resource — not confined.
        if (Permissions::allows($user, $staffKeys)) {
            return null;
        }

        if (!Permissions::allows($user, self::PORTAL_KEYS)) {
            return null;
        }

        return $user->username ?: null;
    }
}
