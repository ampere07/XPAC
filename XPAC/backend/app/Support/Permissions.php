<?php

namespace App\Support;

use App\Models\Role;

/**
 * The single source of truth for what each role may see and do.
 *
 * There are two kinds of permission key:
 *
 *   page actions   — one per navigable section, named exactly as the section id
 *                    used by the sidebar and by Dashboard's renderContent
 *                    ("job-order", "transaction-list", ...). Holding the key
 *                    means "may open this page and use its ordinary endpoints".
 *
 *   sub actions    — "<page>.<verb>" for the individual buttons that are gated
 *                    separately ("job-order.approve", "customer.transact", ...).
 *                    A sub action always implies its parent page.
 *
 * Roles 1-8 are seeded and non-editable, so their keys live in ROLE_PERMISSIONS
 * below. Any role above 8 is a custom role created from Role Management and
 * carries its own list in roles.permissions — the same key strings, ticked in
 * the Role modal.
 *
 * A custom role may also name one of the eight in roles.base_role_id, making it
 * a *hybrid*: it holds everything that seeded role holds, resolved live from
 * ROLE_PERMISSIONS on every read, plus the extra keys ticked against it. Nothing
 * is copied at save time, so a hybrid follows its base role as that role
 * changes. See Permissions::roleKeys().
 *
 * Kept deliberately in step with:
 *   ATSS2_0/frontend/src/config/permissions.ts
 *   MOBILEAPP/frontend/src/config/permissions.ts
 * Those files are the same table for the two clients. Changing a key here means
 * changing it there; PermissionsParityTest guards the pair.
 */
final class Permissions
{
    /** Held by SuperAdmin only: grants every key, present and future. */
    public const WILDCARD = '*';

    /**
     * The generation of the permission model Role Management writes.
     *
     * Stamped on `roles.permissions_version` by every save, and compared in
     * roleKeys() to decide whether a stored list is authoritative or predates
     * the per-action keys. Raise it only alongside a rule that reads it.
     */
    public const CURRENT_VERSION = 1;

    /**
     * Every page key in the system, grouped the way the sidebar groups them.
     * The Role modal renders this list, so a page missing here can never be
     * granted to a custom role.
     */
    public const PAGES = [
        // Landing pages. One per audience; a user gets exactly the one their role implies.
        'dashboard',
        'agent-dashboard',
        'customer-dashboard',
        'customer-bills',
        'customer-support',
        'agent-application',

        'live-monitor',

        // Billing
        'customer',
        'transaction-list',
        'transactions-revert',
        'payment-portal',
        'soa',
        'invoice',
        'overdue',
        'so-charge',
        'dc-notice',
        'mass-rebate',
        'staggered-payment',
        'discounts',

        // Operations
        'application-management',
        'job-order',
        'service-order',
        'work-order',
        'lcp-nap-location',
        'sms-blast',
        'reports',
        'support',

        // Agent
        'bonus-history',
        'agent-invoices',
        'agent-payout',
        'agent-management',
        'team-agent',

        // Inventory
        'inventory',
        'inventory-category-list',

        // Configuration
        'promo-list',
        'plan-list',
        'location-list',
        'lcp',
        'nap',
        'ports',
        'router-models',
        'status-remarks-list',
        'usage-type',
        'vlan-config',
        'payment-method',
        'work-category',
        'radius-config',
        'smart-olt',
        'sms-config',
        'sms-template',
        'email-templates',
        'pppoe-setup',
        'concern-config',
        'billing-config',

        // Users
        'user-management',
        'tech-users',
        'organization',
        'roles',
        'group-management',

        // Logs
        'disconnected-logs',
        'reconnection-logs',
        'sms-logs',
        'sms-blast-logs',
        'email-logs',
        'data-logs',
        'expenses-log',
        'smart-olt-logs',
        'radius-logs',
        'radius-queue',
        'system-logs',
        'modem-router-logs',

        // Tools. Each reconciles what the system believes against what a
        // downstream actually holds — SmartOLT's ONUs, the RADIUS server's
        // accounts, Xendit's settled payments, the billing run's coverage — and
        // each can write the difference back. They had sidebar entries and
        // front-end keys but no entry here, which left their endpoints falling
        // through to "any signed-in user" and made the keys unavailable to a
        // custom role, since RoleController validates against this list.
        'smartolt-tool',
        'mikrotik-radius-tool',
        'xendit-reconcile-tool',
        'billing-reconcile-tool',

        'soa-generation',
        'settings',
    ];

    /**
     * Button-level keys, grouped by the page that owns them.
     *
     * job-order.tech-edit / job-order.admin-edit are mutually exclusive by
     * convention (the Role modal enforces it): one opens the technician's Done
     * form, the other the administrator's. Same for the service-order pair.
     */
    public const ACTIONS = [
        'job-order' => [
            'job-order.approve',
            'job-order.failed',
            'job-order.tech-edit',
            'job-order.admin-edit',
            'job-order.attachment',
            // Recording a pre-installation visit: what lets a referral earn
            // quota progress before the install itself is finished.
            'job-order.pre-install',
        ],
        'customer' => [
            'customer.so-request',
            'customer.details-edit',
            'customer.attachment',
            'customer.transact',
        ],
        'transaction-list' => [
            'transaction-list.batch-approve',
            'transaction-list.approve',
            'transaction-list.revert-request',
        ],
        'mass-rebate' => [
            'mass-rebate.add',
        ],
        'staggered-payment' => [
            'staggered-payment.add',
        ],
        'discounts' => [
            'discounts.add',
        ],
        'application-management' => [
            'application-management.move-to-jo',
            'application-management.quick-status',
        ],
        'service-order' => [
            'service-order.tech-edit',
            'service-order.admin-edit',
        ],
        // Raising, reassigning or deleting a work order, as opposed to working
        // the ones already assigned to you. An agent has the page but not this:
        // their view is the jobs they referred, read only.
        'work-order' => [
            'work-order.manage',
        ],

        // Scheduling and issuing reports, kept apart from deleting one: a
        // report is a scheduled job other people rely on receiving, so removing
        // it is the heavier act. Deleting was already SuperAdmin-only, but it
        // was expressed as a role check on the route and, in the UI, by
        // borrowing the Settings key — which meant granting a custom role
        // Settings silently granted it report deletion too.
        'reports' => [
            'reports.manage',
            'reports.delete',
        ],

        // Raising a payout, incentive or bonus, and signing one off. Both were
        // previously inferred from "is this user not an agent".
        'bonus-history' => [
            'bonus-history.payout',
        ],

        // Approving or rejecting on the Agent Payout page. This one had no
        // front-end check at all — the buttons were wired straight to the
        // handler for anyone who could open the page.
        'agent-payout' => [
            'agent-payout.approve',
        ],

        // Issuing the weekly referral invoices, and marking one settled. An
        // agent reads their own; neither of these is theirs.
        'agent-invoices' => [
            'agent-invoices.generate',
            'agent-invoices.status',
            // Raising the payout that settles an invoice — the money side,
            // granted apart from merely setting a status by hand.
            'agent-invoices.payout',
        ],

        'soa-generation' => [
            'soa-generation.manage',
        ],

        // ── Configurations ───────────────────────────────────────────────────
        // Every page in this group is a list with Add, Edit and Delete
        // controls, and until now holding the page granted all three. They
        // follow the standard verbs described above CRUD_VERBS.
        'promo-list' => [
            'promo-list.create', 'promo-list.edit', 'promo-list.delete',
        ],
        'plan-list' => [
            'plan-list.create', 'plan-list.edit', 'plan-list.delete',
        ],
        'location-list' => [
            'location-list.create', 'location-list.edit', 'location-list.delete',
        ],
        'lcp' => [
            'lcp.create', 'lcp.edit', 'lcp.delete',
        ],
        'nap' => [
            'nap.create', 'nap.edit', 'nap.delete',
        ],
        'ports' => [
            'ports.create', 'ports.edit', 'ports.delete',
        ],
        'router-models' => [
            'router-models.create', 'router-models.edit', 'router-models.delete',
        ],
        'status-remarks-list' => [
            'status-remarks-list.create', 'status-remarks-list.edit', 'status-remarks-list.delete',
        ],
        'usage-type' => [
            'usage-type.create', 'usage-type.edit', 'usage-type.delete',
        ],
        'vlan-config' => [
            'vlan-config.create', 'vlan-config.edit', 'vlan-config.delete',
        ],
        'payment-method' => [
            'payment-method.create', 'payment-method.edit', 'payment-method.delete',
        ],
        'work-category' => [
            'work-category.create', 'work-category.edit', 'work-category.delete',
        ],
        'radius-config' => [
            'radius-config.create', 'radius-config.edit', 'radius-config.delete',
        ],
        'smart-olt' => [
            'smart-olt.create', 'smart-olt.edit', 'smart-olt.delete',
        ],
        'sms-config' => [
            'sms-config.create', 'sms-config.edit', 'sms-config.delete',
        ],
        'sms-template' => [
            'sms-template.create', 'sms-template.edit', 'sms-template.delete',
        ],
        'email-templates' => [
            'email-templates.create', 'email-templates.edit', 'email-templates.delete',
        ],
        'pppoe-setup' => [
            'pppoe-setup.create', 'pppoe-setup.edit', 'pppoe-setup.delete',
        ],
        'concern-config' => [
            'concern-config.create', 'concern-config.edit', 'concern-config.delete',
        ],
        'billing-config' => [
            'billing-config.create', 'billing-config.edit', 'billing-config.delete',
        ],

        // ── Users ────────────────────────────────────────────────────────────
        'user-management' => [
            'user-management.create', 'user-management.edit', 'user-management.delete',
        ],
        'tech-users' => [
            'tech-users.create', 'tech-users.edit', 'tech-users.delete',
        ],
        'organization' => [
            'organization.create', 'organization.edit', 'organization.delete',
        ],
        'roles' => [
            'roles.create', 'roles.edit', 'roles.delete',
        ],
        'group-management' => [
            'group-management.create', 'group-management.edit', 'group-management.delete',
        ],
    ];

    /**
     * The standard verbs, in the order the Role modal shows them.
     *
     * A page whose controls are the ordinary "Add / Edit / Delete" three
     * declares exactly these, named `<page>.<verb>`. Anything a page does that
     * is not one of the three — approving, reverting, moving to a job order —
     * keeps its own descriptive verb above, because a permission that reads
     * `job-order.approve` says what it grants and `job-order.action3` does not.
     *
     * Adding a button to a page is therefore: add its key to ACTIONS here and to
     * the two client catalogs, give it a label, gate the button with `can()`,
     * and give the endpoint a rule in ApiPermissionMap. No part of the system
     * has to learn about the key beyond those tables — the Role modal renders
     * whatever ACTIONS holds, and both `allows()` and the middleware are
     * agnostic about which keys exist.
     */
    public const CRUD_VERBS = ['create', 'edit', 'delete'];

    /**
     * What holding a page key used to carry with it, page by page.
     *
     * Before the verbs above existed, most of these pages drew their Add, Edit
     * and Delete controls for anyone who could open them. A custom role saved in
     * those days lists only the page, so reading it strictly would take those
     * buttons away from roles that have always had them — silently, on deploy,
     * with nothing in the UI to explain it. A role saved before the change
     * (permissions_version 0) therefore still gets the verbs listed here for any
     * of these pages it holds.
     *
     * This is a map rather than a list of pages because it has to reproduce what
     * each page actually allowed, not what the common case allowed. Three
     * entries differ, and granting them the full three would be widening access
     * under cover of a compatibility rule:
     *
     *   status-remarks-list  Add was open to the page; Edit and Delete were
     *                        already behind `status-remarks-list.manage`.
     *   user-management      Add and Delete were open to the page; Edit was
     *                        SuperAdmin's alone, checked in UserDetails.
     *   ports, router-models Every control was already behind `.manage`, so the
     *                        page on its own carried nothing. Roles holding the
     *                        old key are served by RETIRED_ACTIONS instead.
     *
     * Saving the role from Role Management stamps the current version and the
     * ticks become authoritative, which is the only way a role leaves this rule.
     *
     * @see roleKeys()
     */
    private const GRANDFATHERED_ACTIONS = [
        'promo-list'          => self::CRUD_VERBS,
        'plan-list'           => self::CRUD_VERBS,
        'location-list'       => self::CRUD_VERBS,
        'lcp'                 => self::CRUD_VERBS,
        'nap'                 => self::CRUD_VERBS,
        'usage-type'          => self::CRUD_VERBS,
        'vlan-config'         => self::CRUD_VERBS,
        'payment-method'      => self::CRUD_VERBS,
        'work-category'       => self::CRUD_VERBS,
        'radius-config'       => self::CRUD_VERBS,
        'smart-olt'           => self::CRUD_VERBS,
        'sms-config'          => self::CRUD_VERBS,
        'sms-template'        => self::CRUD_VERBS,
        'email-templates'     => self::CRUD_VERBS,
        'pppoe-setup'         => self::CRUD_VERBS,
        'concern-config'      => self::CRUD_VERBS,
        'billing-config'      => self::CRUD_VERBS,
        'tech-users'          => self::CRUD_VERBS,
        'organization'        => self::CRUD_VERBS,
        'roles'               => self::CRUD_VERBS,
        'group-management'    => self::CRUD_VERBS,

        // The three that were already narrower than their page. See above.
        'status-remarks-list' => ['create'],
        'user-management'     => ['create', 'delete'],
    ];

    /**
     * Keys that no longer exist, and what they now mean.
     *
     * Three pages already gated their controls behind a single `.manage` key.
     * Splitting that into the standard three would have revoked the buttons
     * from every role holding the old key, so the old key is still read — it
     * simply grants all three — while only the new ones are offered in the Role
     * modal. A role resaved from the modal writes the new keys and stops
     * relying on this.
     */
    private const RETIRED_ACTIONS = [
        'ports.manage'               => ['ports.create', 'ports.edit', 'ports.delete'],
        'router-models.manage'       => ['router-models.create', 'router-models.edit', 'router-models.delete'],
        'status-remarks-list.manage' => ['status-remarks-list.create', 'status-remarks-list.edit', 'status-remarks-list.delete'],
    ];

    /**
     * What each seeded role holds.
     *
     * These lists reproduce the access the eight locked roles already had in the
     * sidebar's allowedRoles tables — this is a consolidation of that behaviour,
     * not a re-grant. Two deliberate additions are called out inline: the
     * technician and head technician edit keys, which the old code never granted
     * to anyone but an administrator, leaving the technician Done button inert.
     */
    public const ROLE_PERMISSIONS = [
        // Full system control, including everything added later.
        Role::SUPER_ADMIN => [self::WILDCARD],

        Role::ADMINISTRATOR => [
            'dashboard',
            'live-monitor',
            // Billing
            'customer',
            'customer.so-request', 'customer.details-edit', 'customer.attachment', 'customer.transact',
            'transaction-list',
            'transaction-list.batch-approve', 'transaction-list.approve', 'transaction-list.revert-request',
            'transactions-revert',
            'payment-portal',
            'soa',
            'invoice',
            'overdue',
            'so-charge',
            'dc-notice',
            'mass-rebate', 'mass-rebate.add',
            'staggered-payment', 'staggered-payment.add',
            'discounts', 'discounts.add',
            // Operations
            'application-management',
            'application-management.move-to-jo', 'application-management.quick-status',
            'job-order',
            'job-order.approve', 'job-order.failed', 'job-order.admin-edit', 'job-order.attachment',
            'job-order.pre-install',
            'service-order', 'service-order.admin-edit',
            'work-order', 'work-order.manage',
            'lcp-nap-location',
            'sms-blast',
            'reports', 'reports.manage',
            'support',
            // Agent
            'bonus-history', 'bonus-history.payout',
            'team-agent',
            'agent-management',
            'agent-payout', 'agent-payout.approve',
            'agent-invoices', 'agent-invoices.generate', 'agent-invoices.status',
            'agent-invoices.payout',
            // Inventory
            'inventory',
            'inventory-category-list',
            // Logs
            'disconnected-logs',
            'reconnection-logs',
            'sms-logs',
            'sms-blast-logs',
            'email-logs',
            'data-logs',
            'expenses-log',
            'modem-router-logs',
            // The RADIUS retry queue. Read-only, and an operational screen
            // rather than a configuration one, so it sits with the roles that
            // chase failed disconnects rather than with Settings.
            'radius-queue',
            // Tools suite. Every one of these mutates live state — subscriber
            // ONUs, RADIUS accounts, posted payments — so they are granted
            // deliberately rather than inherited from a group. Billing
            // Reconcile is not here: it decides whether a subscriber is
            // invoiced at all, and stays with SuperAdmin.
            'smartolt-tool',
            'mikrotik-radius-tool',
            'xendit-reconcile-tool',
        ],

        // Field technician: their own job orders and service orders, plus the
        // LCP/NAP map they need on site.
        //
        // The two edit keys are new. Sub-permissions were only ever read from a
        // custom role's array, which a locked role does not have, so a
        // technician's Done button resolved to "no permission" and did nothing.
        // Granting them here restores the button the role has always been meant
        // to have; the technician-only Done form is unchanged.
        Role::TECHNICIAN => [
            'job-order',
            'job-order.tech-edit',
            'job-order.attachment',
            // The pre-installation visit is site work.
            'job-order.pre-install',
            'service-order',
            'service-order.tech-edit',
            // Work orders are a technician's work too. The web sidebar never
            // listed the page for them, but the page itself has always had
            // technician-specific behaviour — the queue ordering and the lock
            // in technicianWorkOrderAccess.ts, enforced server side by
            // WorkOrderApiController::isWorkOrderLockedForTechnician(). The
            // mobile app did list it. The omission was the sidebar's.
            'work-order', 'work-order.manage',
            'lcp-nap-location',
        ],

        // The customer portal. No sidebar, no admin pages.
        Role::CUSTOMER => [
            'customer-dashboard',
            'customer-bills',
            'customer-support',
        ],

        // Sales agent: their own referrals, their own payout history.
        Role::AGENT => [
            'agent-dashboard',
            'agent-application',
            'job-order',
            'work-order',
            'bonus-history',
            'agent-invoices',
        ],

        Role::INVENTORY_STAFF => [
            'inventory',
            'inventory-category-list',
            'modem-router-logs',
        ],

        // Outside plant: work orders and the fibre map.
        Role::OSP => [
            'work-order', 'work-order.manage',
            'lcp-nap-location',
        ],

        // Head technician: supervises the field roles and the parts of
        // Configurations that describe the plant.
        //
        // As with the technician, the edit keys are new — the role could open
        // the pages but no button was ever enabled for it.
        Role::HEAD_TECH => [
            'application-management',
            'application-management.move-to-jo', 'application-management.quick-status',
            'job-order',
            'job-order.approve', 'job-order.failed', 'job-order.admin-edit', 'job-order.attachment',
            'job-order.pre-install',
            'service-order', 'service-order.admin-edit',
            'work-order', 'work-order.manage',
            'lcp-nap-location',
            // The head technician maintains the outside-plant records, so the
            // three verbs are spelled out rather than left to the
            // grandfathering rule, which only covers stored custom roles.
            'location-list', 'location-list.create', 'location-list.edit', 'location-list.delete',
            'lcp', 'lcp.create', 'lcp.edit', 'lcp.delete',
            'nap', 'nap.create', 'nap.edit', 'nap.delete',
            // The two network tools. Xendit Reconciliation is deliberately NOT
            // here: it settles real money against real accounts, which is an
            // Administrator and SuperAdmin concern rather than a
            // field-operations one.
            'smartolt-tool',
            'mikrotik-radius-tool',
            'modem-router-logs',
        ],
    ];

    /**
     * Where each role lands after signing in.
     *
     * Must be a key the role actually holds — Dashboard falls back to the first
     * permission it finds when it is not, but that ordering is arbitrary and
     * makes for a poor landing page.
     */
    public const ROLE_HOME = [
        Role::SUPER_ADMIN     => 'dashboard',
        Role::ADMINISTRATOR   => 'dashboard',
        Role::TECHNICIAN      => 'job-order',
        Role::CUSTOMER        => 'customer-dashboard',
        Role::AGENT           => 'agent-dashboard',
        Role::INVENTORY_STAFF => 'inventory',
        Role::OSP             => 'work-order',
        Role::HEAD_TECH       => 'application-management',
    ];

    /** Every valid key: pages plus sub actions. */
    public static function all(): array
    {
        static $all = null;

        if ($all === null) {
            $all = array_values(array_unique(array_merge(
                self::PAGES,
                array_merge(...array_values(self::ACTIONS))
            )));
        }

        return $all;
    }

    /**
     * The keys a user effectively holds.
     *
     * A locked role reads from ROLE_PERMISSIONS; a custom role reads its own
     * `permissions` column, plus — if it is a hybrid — everything its
     * `base_role_id` role holds. Either way the result also contains the parent
     * page of every sub action it holds, so a check for "job-order" succeeds for
     * a role that was only given "job-order.approve" — which is how the Role
     * modal presents it (ticking a sub action ticks its page).
     *
     * @param  \App\Models\User|object|null  $user
     * @return string[]
     */
    public static function forUser($user): array
    {
        if ($user === null) {
            return [];
        }

        $roleId = (int) ($user->role_id ?? 0);

        if ($roleId === Role::SUPER_ADMIN) {
            return [self::WILDCARD];
        }

        $keys = Role::isLocked($roleId)
            ? (self::ROLE_PERMISSIONS[$roleId] ?? [])
            : self::customRoleKeys($user);

        return self::withImpliedPages($keys);
    }

    /**
     * Does this user hold the given key?
     *
     * `$permission` may be a single key or a list, in which case holding any one
     * of them is enough — used by endpoints that serve two audiences, e.g. an
     * invoice readable both from the admin Invoice page and from the customer's
     * own Bills page.
     *
     * @param  \App\Models\User|object|null  $user
     * @param  string|string[]  $permission
     */
    public static function allows($user, string|array $permission): bool
    {
        if ($user === null) {
            return false;
        }

        $held = self::forUser($user);

        if (in_array(self::WILDCARD, $held, true)) {
            return true;
        }

        foreach ((array) $permission as $wanted) {
            if (in_array($wanted, $held, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The keys a seeded role holds, or [] for anything that is not one.
     *
     * This is what a hybrid role inherits. Read through here rather than from
     * ROLE_PERMISSIONS directly so the "not a locked id" case has one answer.
     *
     * @return string[]
     */
    public static function inheritedKeys(int|string|null $baseRoleId): array
    {
        return Role::isLocked($baseRoleId)
            ? (self::ROLE_PERMISSIONS[(int) $baseRoleId] ?? [])
            : [];
    }

    /**
     * Everything a custom role holds: its base role's keys plus its own.
     *
     * The inherited half is resolved here, on every read, rather than copied
     * into `roles.permissions` when the role is saved. That is the whole point
     * of a hybrid: a key added to Role::TECHNICIAN reaches every role built on
     * the technician, and one removed from it leaves them, without anybody
     * reopening the Role modal.
     *
     * A base of SuperAdmin inherits WILDCARD, which subsumes everything else —
     * returned on its own so callers do not have to reason about a list that
     * both contains "*" and enumerates keys.
     *
     * @param  \App\Models\Role|object|null  $role
     * @return string[]
     */
    public static function roleKeys($role): array
    {
        if ($role === null) {
            return [];
        }

        // A locked role's access is the table above; its own columns are not
        // consulted, so a base or a stored list recorded against one is ignored.
        if (Role::isLocked($role->id ?? null)) {
            return self::ROLE_PERMISSIONS[(int) $role->id] ?? [];
        }

        $base = (int) ($role->base_role_id ?? 0);
        $inherited = self::inheritedKeys($base);

        if (in_array(self::WILDCARD, $inherited, true)) {
            return [self::WILDCARD];
        }

        $stored = self::parseKeys($role->permissions ?? null);

        // A role last saved before the per-action keys existed listed only its
        // pages, so its buttons are implied rather than ticked. Version 1 and
        // above means the list is what the administrator actually chose.
        if ((int) ($role->permissions_version ?? 0) < 1) {
            $stored = self::withGrandfatheredActions($stored);
        }

        return array_values(array_unique(array_merge(
            $inherited,
            self::expandRetiredActions($stored)
        )));
    }

    /**
     * Add the verbs each page used to carry, for every page in the list.
     *
     * @param  string[]  $keys
     * @return string[]
     */
    private static function withGrandfatheredActions(array $keys): array
    {
        $result = $keys;

        foreach ($keys as $key) {
            foreach (self::GRANDFATHERED_ACTIONS[$key] ?? [] as $verb) {
                $result[] = "$key.$verb";
            }
        }

        return $result;
    }

    /**
     * Replace any retired key with the keys that took its place.
     *
     * The retired key itself is dropped: it is not in `all()` any more, so
     * leaving it would put a value in the effective list that no check, on
     * either side, ever asks for.
     *
     * @param  string[]  $keys
     * @return string[]
     */
    private static function expandRetiredActions(array $keys): array
    {
        $result = [];

        foreach ($keys as $key) {
            if (isset(self::RETIRED_ACTIONS[$key])) {
                array_push($result, ...self::RETIRED_ACTIONS[$key]);
                continue;
            }

            $result[] = $key;
        }

        return $result;
    }

    /**
     * The seeded role this user's role is built on, or null.
     *
     * Null for a seeded role (its access is the table above, not an
     * inheritance) and for a standalone custom role.
     *
     * @param  \App\Models\User|object|null  $user
     */
    public static function baseRoleIdFor($user): ?int
    {
        if ($user === null || Role::isLocked($user->role_id ?? null)) {
            return null;
        }

        $role = self::roleOf($user);

        if ($role === null) {
            return null;
        }

        $base = (int) ($role->base_role_id ?? 0);

        return Role::isLocked($base) ? $base : null;
    }

    /**
     * Where a user lands after signing in.
     *
     * A seeded role has its own entry. A hybrid falls back to its base role's —
     * a "Technician who also does Inventory" should still land on Job Order —
     * and a standalone custom role has none, leaving the client to pick the
     * first page it was granted.
     *
     * @param  \App\Models\User|object|null  $user
     */
    public static function homeFor($user): ?string
    {
        if ($user === null) {
            return null;
        }

        $roleId = (int) ($user->role_id ?? 0);

        if (isset(self::ROLE_HOME[$roleId])) {
            return self::ROLE_HOME[$roleId];
        }

        $base = self::baseRoleIdFor($user);

        return $base === null ? null : (self::ROLE_HOME[$base] ?? null);
    }

    /**
     * Read a custom role's effective permission list.
     *
     * @return string[]
     */
    private static function customRoleKeys($user): array
    {
        return self::roleKeys(self::roleOf($user));
    }

    /**
     * The user's role row.
     *
     * Prefers an already-loaded relation so this does not fire a query per
     * request; falls back to a lookup when the caller did not eager-load it.
     *
     * @return \App\Models\Role|object|null
     */
    private static function roleOf($user)
    {
        if (isset($user->role) && $user->role !== null) {
            return $user->role;
        }

        return empty($user->role_id) ? null : Role::find($user->role_id);
    }

    /**
     * Read a stored permissions value.
     *
     * The column is cast to an array by the Role model, but rows written before
     * that cast existed hold a JSON string or a comma-separated list, so all
     * three shapes are accepted — the frontend parses it the same three ways.
     *
     * @return string[]
     */
    private static function parseKeys($raw): array
    {
        if (is_array($raw)) {
            return array_values(array_filter(array_map('strval', $raw), 'strlen'));
        }

        if (is_string($raw) && trim($raw) !== '') {
            $decoded = json_decode($raw, true);

            if (is_array($decoded)) {
                return array_values(array_filter(array_map('strval', $decoded), 'strlen'));
            }

            return array_values(array_filter(array_map('trim', explode(',', $raw)), 'strlen'));
        }

        return [];
    }

    /**
     * Add the parent page of every "page.verb" key present.
     *
     * @param  string[]  $keys
     * @return string[]
     */
    private static function withImpliedPages(array $keys): array
    {
        $result = $keys;

        foreach ($keys as $key) {
            if (str_contains($key, '.')) {
                $parent = strstr($key, '.', true);

                if ($parent !== false && !in_array($parent, $result, true)) {
                    $result[] = $parent;
                }
            }
        }

        return array_values(array_unique($result));
    }
}
