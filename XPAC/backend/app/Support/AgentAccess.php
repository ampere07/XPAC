<?php

namespace App\Support;

use App\Models\Role;

/**
 * Who may do what in the agent module (payouts, bonuses, achievements, invoices).
 *
 * Every decision is a permission key from App\Support\Permissions, so a custom
 * role can be granted exactly the agent actions it needs from Role Management.
 * These checks are the controllers' own and apply whatever mode the API gate
 * (ApiAccessControl) is running in.
 *
 *   KEY_APPROVE_PAYOUT   agent-payout.approve     approve / reject a payout
 *   KEY_BONUS            bonus-history.payout     add a bonus, approve / reject
 *                                                one, claim an achievement for
 *                                                another agent
 *   KEY_RAISE_PAYOUT     agent-payout | commission.create | agent-invoices.payout
 *                                                raise a payout (Pay Out/In, the
 *                                                Agent Payout page, or from an
 *                                                agent invoice)
 *   KEY_GENERATE_INVOICES agent-invoices.generate
 *   KEY_INVOICE_STATUS   agent-invoices.status
 *
 * For the seeded roles the outcome is what it was when these checks were
 * role-based: Administrator (1) and SuperAdmin (7) hold every one of these
 * keys, and no other seeded role holds any of them.
 *
 * canReadAll() — may read every agent's records (within their organisation)
 * rather than only their own — is true for anyone holding an agent-module key
 * the Agent role (4) does not hold. Everyone else is scoped server-side to
 * their own rows, which is how an Agent reads their own history and invoices.
 *
 * Legacy custom roles (saved before per-action keys existed) were authorised by
 * role NAME here: "administrator"/"admin"/"superadmin"… counted as an
 * administrator and "billing" could read everything. That is kept for those
 * rows only — see Permissions::isLegacyRole() — so no existing role gains or
 * loses anything on deploy; once a role is saved from Role Management its ticks
 * are authoritative and its name means nothing.
 */
class AgentAccess
{
    public const KEY_APPROVE_PAYOUT = 'agent-payout.approve';
    public const KEY_BONUS = 'bonus-history.payout';
    public const KEY_RAISE_PAYOUT = ['agent-payout', 'commission.create', 'agent-invoices.payout'];
    public const KEY_GENERATE_INVOICES = 'agent-invoices.generate';
    public const KEY_INVOICE_STATUS = 'agent-invoices.status';

    /**
     * Keys that mean "works the agent module for everyone", as opposed to the
     * Agent role's own read-only view of bonus-history / agent-invoices.
     */
    private const READ_ALL_KEYS = [
        'commission',
        'agent-payout',
        'agent-management',
        'team-agent',
        'agent-payout.approve',
        'bonus-history.payout',
        'agent-invoices.generate',
        'agent-invoices.status',
        'agent-invoices.payout',
        'commission.create',
    ];

    /** Role names a legacy custom role was treated as an administrator under. */
    public const LEGACY_ADMIN_ROLE_NAMES = ['administrator', 'admin', 'superadmin', 'super admin', 'super_admin'];

    /** Extra legacy role names that could READ every agent's records, but not change them. */
    private const LEGACY_READ_ALL_ROLE_NAMES = ['billing'];

    /**
     * May this user perform the action behind $key (any one of a list)?
     *
     * @param  string|string[]  $key
     */
    public static function allows($user, string|array $key): bool
    {
        if (!$user) {
            return false;
        }

        if (Permissions::allows($user, $key)) {
            return true;
        }

        return self::isLegacyNamed($user, self::LEGACY_ADMIN_ROLE_NAMES);
    }

    /**
     * Administrator-level for the agent module: holds every money-moving key.
     *
     * Kept for callers that ask the general question; prefer allows() with the
     * specific key.
     */
    public static function isAdmin($user): bool
    {
        return self::allows($user, self::KEY_APPROVE_PAYOUT);
    }

    public static function isSuperAdmin($user): bool
    {
        return $user && (int) ($user->role_id ?? 0) === Role::SUPER_ADMIN;
    }

    public static function canReadAll($user): bool
    {
        if (!$user) {
            return false;
        }

        return Permissions::allows($user, self::READ_ALL_KEYS)
            || self::isLegacyNamed($user, array_merge(self::LEGACY_ADMIN_ROLE_NAMES, self::LEGACY_READ_ALL_ROLE_NAMES));
    }

    public static function isAgent($user): bool
    {
        return $user && (int) ($user->role_id ?? 0) === AgentReferral::AGENT_ROLE_ID;
    }

    /**
     * A 403 response for a caller who may not perform $key, or null when they may.
     *
     *     if ($denied = AgentAccess::denyUnless($user, AgentAccess::KEY_APPROVE_PAYOUT, 'approve a payout')) {
     *         return $denied;
     *     }
     *
     * @param  string|string[]  $key
     */
    public static function denyUnless($user, string|array $key, string $action = 'perform this action')
    {
        if (self::allows($user, $key)) {
            return null;
        }

        return response()->json([
            'success' => false,
            'message' => "You do not have permission to {$action}.",
        ], 403);
    }

    /** Back-compat: the administrator-level check with the old wording. */
    public static function denyUnlessAdmin($user, string $action = 'perform this action')
    {
        return self::denyUnless($user, self::KEY_APPROVE_PAYOUT, $action);
    }

    /** A legacy custom role whose name is one of $names. Never a seeded role. */
    private static function isLegacyNamed($user, array $names): bool
    {
        if (Role::isLocked($user->role_id ?? null)) {
            return false;
        }

        try {
            $role = $user->role ?? null;
        } catch (\Throwable $e) {
            return false;
        }

        if ($role === null || !Permissions::isLegacyRole($role)) {
            return false;
        }

        return in_array(strtolower(trim((string) ($role->role_name ?? ''))), $names, true);
    }
}
