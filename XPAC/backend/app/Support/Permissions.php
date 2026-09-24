<?php

namespace App\Support;

use App\Models\Role;

/**
 * The single source of truth for what each role may see and do.
 *
 * There are two kinds of permission key:
 *
 *   page actions   — one per navigable section, named exactly as the section id
 *                    used by the web sidebar and by Dashboard's renderContent
 *                    ("job-order", "transaction-list", ...). Holding the key
 *                    means "may open this page and use its ordinary endpoints".
 *
 *   sub actions    — "<page>.<verb>" for the individual buttons that are gated
 *                    separately ("job-order.approve", "customer.transact", ...).
 *
 * Roles 1-8 are seeded and non-editable, so their keys live in ROLE_PERMISSIONS
 * below. Any role above 8 is a custom role created from Role Management and
 * carries its own list in roles.permissions — the same key strings, ticked in
 * the Role modal. For a custom role a sub action also implies its parent page
 * (ticking an action ticks its page in the modal); a seeded role's list is
 * explicit and taken as written — see forUser().
 *
 * A custom role may also name one of the eight in roles.base_role_id, making it
 * a *hybrid*: it holds everything that seeded role holds, resolved live from
 * ROLE_PERMISSIONS on every read, plus the extra keys ticked against it. Nothing
 * is copied at save time, so a hybrid follows its base role as that role
 * changes. See Permissions::roleKeys().
 *
 * Kept deliberately in step with:
 *   GOWISER/frontend/src/config/permissions.ts
 *   MOBILEAPP/frontend/src/config/permissions.ts
 * Those files are the same table for the two clients. Changing a key here means
 * changing it there; PermissionsParityTest guards the pair.
 *
 * ROLE_PERMISSIONS reproduces what each seeded role could reach before this
 * table existed, on the web app AND the mobile app — the union of the two, so
 * the server never refuses something either client already offered. Where the
 * union holds a page or button one client did not show that role, that client
 * keeps its old behaviour with its own rule (the cases are listed alongside the
 * catalog in the Roles Module notes).
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
     * granted to a custom role. Only pages that have a screen on the web or
     * the mobile app are listed.
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
        'prepaid-override',
        'payment-portal',
        'soa',
        'invoice',
        'overdue',
        'so-charge',
        'dc-notice',
        'mass-rebate',
        'staggered-payment',
        'discounts',
        'soa-generation',

        // Operations
        'application-management',
        'job-order',
        'service-order',
        'work-order',
        'lcp-nap-location',
        'sms-blast',
        'reports',

        // Agent
        'commission',
        'bonus-history',
        'agent-invoices',
        'agent-payout',
        'agent-management',
        'team-agent',

        // Inventory
        'inventory',
        'inventory-category-list',

        // Expenses
        'monthly-payables',
        'expenses',
        'expenses-category',

        // Configurations
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
        'system-logs',

        // Tools. Each reconciles what the system believes against what a
        // downstream actually holds — SmartOLT's ONUs, the RADIUS server's
        // accounts, Xendit's settled payments, the billing run's coverage — and
        // each can write the difference back.
        'smartolt-tool',
        'mikrotik-radius-tool',
        'xendit-reconcile-tool',
        'billing-reconcile-tool',

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
        ],
        'customer' => [
            'customer.so-request',
            'customer.details-edit',
            'customer.attachment',
            'customer.transact',
            // Raises a Prepaid Override request from the customer toolbar.
            // Granting the days still needs prepaid-override.approve.
            'customer.prepaid-override',
        ],
        'transaction-list' => [
            'transaction-list.batch-approve',
            'transaction-list.approve',
            'transaction-list.revert-request',
            // Deleting a pending transaction. SuperAdmin's alone today.
            'transaction-list.delete',
        ],
        // Approving (or rejecting) a revert request. SuperAdmin's alone today;
        // an Administrator reads the queue but does not decide it.
        'transactions-revert' => [
            'transactions-revert.approve',
        ],
        // Approving or rejecting a Prepaid Override request. SuperAdmin only.
        'prepaid-override' => [
            'prepaid-override.approve',
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
        'soa-generation' => [
            'soa-generation.manage',
        ],
        'application-management' => [
            'application-management.move-to-jo',
            'application-management.quick-status',
        ],
        'service-order' => [
            'service-order.tech-edit',
            'service-order.admin-edit',
        ],
        // Raising or deleting a work order, as opposed to working (editing) the
        // ones already in front of you — which holding the page allows.
        'work-order' => [
            'work-order.manage',
        ],
        // Scheduling and issuing reports, kept apart from deleting one.
        'reports' => [
            'reports.manage',
            'reports.delete',
        ],

        // ── Agent ────────────────────────────────────────────────────────────
        // Raising a payout from Pay Out/In ("New Commission Payout" / "Add
        // Record"). Approving one there reuses agent-payout.approve (payout
        // history) and bonus-history.payout (bonus history).
        'commission' => [
            'commission.create',
        ],
        // Adding, approving or rejecting a bonus.
        'bonus-history' => [
            'bonus-history.payout',
        ],
        // Approving or rejecting a payout.
        'agent-payout' => [
            'agent-payout.approve',
        ],
        // Issuing the weekly referral invoices, setting one's status, and
        // raising the payout that settles one. An agent reads their own.
        'agent-invoices' => [
            'agent-invoices.generate',
            'agent-invoices.status',
            'agent-invoices.payout',
        ],

        // ── Expenses ─────────────────────────────────────────────────────────
        'monthly-payables' => [
            'monthly-payables.create',
            'monthly-payables.edit',
            'monthly-payables.delete',
            'monthly-payables.generate',
            'monthly-payables.pay',
        ],
        'expenses' => [
            'expenses.create', 'expenses.edit', 'expenses.delete',
        ],
        'expenses-category' => [
            'expenses-category.create', 'expenses-category.edit', 'expenses-category.delete',
        ],

        // ── Configurations ───────────────────────────────────────────────────
        // Every page in this group is a list with Add, Edit and Delete
        // controls, following the standard verbs described above CRUD_VERBS.
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
     * is not one of the three keeps its own descriptive verb above.
     */
    public const CRUD_VERBS = ['create', 'edit', 'delete'];

    /**
     * Mutually exclusive pairs: a role may hold one half or the other.
     * Enforced by the Role modal; listed here so the three catalogs agree.
     */
    public const EXCLUSIVE_PAIRS = [
        ['job-order.tech-edit', 'job-order.admin-edit'],
        ['service-order.tech-edit', 'service-order.admin-edit'],
    ];

    /**
     * Pages whose buttons every holder of the page saw before this table
     * existed, so a custom role saved before then (permissions_version 0) is
     * granted every action key the page has.
     *
     * Before the port a custom role's buttons on these pages were ungated —
     * holding the page drew Add, Edit, Delete, Generate… — and its stored list
     * names only the page. Reading it strictly would take the buttons away on
     * deploy, silently.
     *
     * Deliberately NOT here, because a legacy role did not have their actions:
     *   - job-order, customer, transaction-list, mass-rebate, staggered-payment,
     *     discounts, application-management, service-order: legacy roles
     *     already stored these sub-keys, each button showed only when ticked,
     *     so the stored sub-keys stay authoritative.
     *   - transactions-revert, prepaid-override, reports, bonus-history,
     *     agent-payout, agent-invoices: their actions were role-gated to
     *     Administrator/SuperAdmin (or SuperAdmin alone), never to a custom
     *     role.
     *
     * Saving the role from Role Management stamps the current version and the
     * ticks become authoritative, which is the only way a role leaves this rule.
     *
     * @see roleKeys()
     */
    private const LEGACY_GRANT_ALL_PAGES = [
        // Configurations
        'promo-list', 'plan-list', 'location-list', 'lcp', 'nap', 'ports',
        'router-models', 'status-remarks-list', 'usage-type', 'vlan-config',
        'payment-method', 'work-category', 'radius-config', 'smart-olt',
        'sms-config', 'sms-template', 'email-templates', 'pppoe-setup',
        'concern-config', 'billing-config',
        // Users
        'user-management', 'tech-users', 'organization', 'roles', 'group-management',
        // Pay Out/In's Add controls were ungated; its approve/reject were not.
        'commission',
        // Expenses
        'monthly-payables', 'expenses', 'expenses-category',
        // Add Work Order showed for every role but the Agent.
        'work-order',
        'soa-generation',
    ];

    /**
     * Keys that no longer exist, and what they now mean. Still read, never
     * offered; a role resaved from the modal writes the new keys.
     */
    private const RETIRED_ACTIONS = [
        'ports.manage'               => ['ports.create', 'ports.edit', 'ports.delete'],
        'router-models.manage'       => ['router-models.create', 'router-models.edit', 'router-models.delete'],
        'status-remarks-list.manage' => ['status-remarks-list.create', 'status-remarks-list.edit', 'status-remarks-list.delete'],
    ];

    /**
     * What each seeded role holds.
     *
     * The union of what the web app and the mobile app gave the role before
     * this table existed — pages from the web Sidebar (filterMenuByRole) and
     * the mobile Sidebar/Menu, buttons from the hasPermission()/role checks
     * behind each control. Not a re-grant: nothing here is new to the role on
     * both clients at once.
     */
    public const ROLE_PERMISSIONS = [
        // Full system control, including everything added later.
        Role::SUPER_ADMIN => [self::WILDCARD],

        // Web: every page under the Sidebar's "administrator" entries; every
        // hasPermission() check short-circuits true for it. Mobile: the same
        // plus the Administrator Menu block, which opens the Configurations,
        // Users and Logs pages, Reports (whose page admits 1 and 7) and
        // Settings (whose panels stay SuperAdmin-only inside the page) as
        // well. The reports routes themselves still answer SuperAdmin alone
        // (`role:superadmin` in routes/api.php), as they always have. Held
        // back: vlan-config (on neither client), reports.delete, and the other
        // SuperAdmin-only buttons — transaction delete, revert approval,
        // prepaid-override approval.
        Role::ADMINISTRATOR => [
            'dashboard',
            'live-monitor',
            // Billing
            'customer',
            'customer.so-request', 'customer.details-edit', 'customer.attachment', 'customer.transact',
            'customer.prepaid-override',
            'transaction-list',
            'transaction-list.batch-approve', 'transaction-list.approve', 'transaction-list.revert-request',
            'transactions-revert',
            'prepaid-override',
            'payment-portal',
            'soa',
            'invoice',
            'overdue',
            'so-charge',
            'dc-notice',
            'mass-rebate', 'mass-rebate.add',
            'staggered-payment', 'staggered-payment.add',
            'discounts', 'discounts.add',
            'soa-generation', 'soa-generation.manage',
            // Operations
            'application-management',
            'application-management.move-to-jo', 'application-management.quick-status',
            'job-order',
            'job-order.approve', 'job-order.failed', 'job-order.admin-edit', 'job-order.attachment',
            'service-order', 'service-order.admin-edit',
            'work-order', 'work-order.manage',
            'lcp-nap-location',
            'sms-blast',
            'reports', 'reports.manage',
            // Agent
            'commission', 'commission.create',
            'bonus-history', 'bonus-history.payout',
            'agent-invoices', 'agent-invoices.generate', 'agent-invoices.status', 'agent-invoices.payout',
            'agent-payout', 'agent-payout.approve',
            'agent-management',
            'team-agent',
            // Inventory
            'inventory',
            'inventory-category-list',
            // Expenses
            'monthly-payables',
            'monthly-payables.create', 'monthly-payables.edit', 'monthly-payables.delete',
            'monthly-payables.generate', 'monthly-payables.pay',
            'expenses', 'expenses.create', 'expenses.edit', 'expenses.delete',
            'expenses-category', 'expenses-category.create', 'expenses-category.edit', 'expenses-category.delete',
            // Configurations (mobile Sidebar and Menu)
            'promo-list', 'promo-list.create', 'promo-list.edit', 'promo-list.delete',
            'plan-list', 'plan-list.create', 'plan-list.edit', 'plan-list.delete',
            'location-list', 'location-list.create', 'location-list.edit', 'location-list.delete',
            'lcp', 'lcp.create', 'lcp.edit', 'lcp.delete',
            'nap', 'nap.create', 'nap.edit', 'nap.delete',
            'ports', 'ports.create', 'ports.edit', 'ports.delete',
            'router-models', 'router-models.create', 'router-models.edit', 'router-models.delete',
            'status-remarks-list', 'status-remarks-list.create', 'status-remarks-list.edit', 'status-remarks-list.delete',
            'usage-type', 'usage-type.create', 'usage-type.edit', 'usage-type.delete',
            'payment-method', 'payment-method.create', 'payment-method.edit', 'payment-method.delete',
            'work-category', 'work-category.create', 'work-category.edit', 'work-category.delete',
            'radius-config', 'radius-config.create', 'radius-config.edit', 'radius-config.delete',
            'smart-olt', 'smart-olt.create', 'smart-olt.edit', 'smart-olt.delete',
            'sms-config', 'sms-config.create', 'sms-config.edit', 'sms-config.delete',
            'sms-template', 'sms-template.create', 'sms-template.edit', 'sms-template.delete',
            'email-templates', 'email-templates.create', 'email-templates.edit', 'email-templates.delete',
            'pppoe-setup', 'pppoe-setup.create', 'pppoe-setup.edit', 'pppoe-setup.delete',
            'concern-config', 'concern-config.create', 'concern-config.edit', 'concern-config.delete',
            'billing-config', 'billing-config.create', 'billing-config.edit', 'billing-config.delete',
            // Users (mobile Menu)
            'user-management', 'user-management.create', 'user-management.edit', 'user-management.delete',
            'tech-users', 'tech-users.create', 'tech-users.edit', 'tech-users.delete',
            'organization', 'organization.create', 'organization.edit', 'organization.delete',
            'roles', 'roles.create', 'roles.edit', 'roles.delete',
            'group-management', 'group-management.create', 'group-management.edit', 'group-management.delete',
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
            'system-logs',
            // Tools
            'smartolt-tool',
            'mikrotik-radius-tool',
            'xendit-reconcile-tool',
            'billing-reconcile-tool',
            'settings',
        ],

        // Field technician. Web: Job Order, Service Order, LCP/NAP, and no
        // sub-keys (the seeded role carried none, so every hasPermission() was
        // false). Mobile adds Work Order, and its role-based Job Order "Edit"
        // (the technician Done form), attachment upload and Service Order edit
        // — which is why the technician keys are held here: the server must
        // not refuse what the mobile app does. The web keeps those buttons
        // hidden for this role with its own rule.
        Role::TECHNICIAN => [
            'job-order',
            'job-order.tech-edit',
            'job-order.attachment',
            'service-order',
            'service-order.tech-edit',
            'work-order',
            'lcp-nap-location',
        ],

        // The customer portal. No sidebar, no admin pages.
        Role::CUSTOMER => [
            'customer-dashboard',
            'customer-bills',
            'customer-support',
        ],

        // Sales agent: their own referrals, their own payout history and
        // invoices (read-only, scoped server side), the application form.
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
        ],

        // Outside plant: work orders (web shows it Add Work Order) and the fibre map.
        Role::OSP => [
            'work-order', 'work-order.manage',
            'lcp-nap-location',
        ],

        // Head technician. Web: Application, Job Order, Service Order, Work
        // Order (with Add), LCP/NAP, the three plant Configurations pages and
        // the two network tools; every customer.* button in the customer pane
        // it opens from a job order — but NOT the Customer page itself.
        // Mobile adds the admin Done form, Edit bar and attachments on Job
        // Order, admin-mode Service Order edit, and Application's Move to JO
        // and status buttons, which the web hides from this role.
        Role::HEAD_TECH => [
            'application-management',
            'application-management.move-to-jo', 'application-management.quick-status',
            'job-order',
            'job-order.admin-edit', 'job-order.attachment',
            'service-order', 'service-order.admin-edit',
            'work-order', 'work-order.manage',
            'lcp-nap-location',
            'customer.so-request', 'customer.details-edit', 'customer.attachment', 'customer.transact',
            'customer.prepaid-override',
            'location-list', 'location-list.create', 'location-list.edit', 'location-list.delete',
            'lcp', 'lcp.create', 'lcp.edit', 'lcp.delete',
            'nap', 'nap.create', 'nap.edit', 'nap.delete',
            'smartolt-tool',
            'mikrotik-radius-tool',
        ],
    ];

    /**
     * Where each role lands after signing in (the web app's landing).
     *
     * Must be a key the role actually holds. The Agent's web landing is the
     * `dashboard` section rendered as the agent dashboard — the same screen as
     * `agent-dashboard`, which is what the mobile app lands on.
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
     * Keys that are still read but no longer offered (see RETIRED_ACTIONS).
     *
     * @return string[]
     */
    public static function retiredKeys(): array
    {
        return array_keys(self::RETIRED_ACTIONS);
    }

    /**
     * A list with every retired key replaced by the keys that took its place.
     *
     * @param  string[]  $keys
     * @return string[]
     */
    public static function replaceRetired(array $keys): array
    {
        return self::expandRetiredActions($keys);
    }

    /**
     * The keys stored on a role row, as read — no inheritance, no expansion.
     *
     * @param  \App\Models\Role|object|null  $role
     * @return string[]
     */
    public static function storedKeys($role): array
    {
        return $role === null ? [] : self::parseKeys($role->permissions ?? null);
    }

    /**
     * The keys a user effectively holds.
     *
     * A locked role reads from ROLE_PERMISSIONS, exactly as written. A custom
     * role reads its own `permissions` column, plus — if it is a hybrid —
     * everything its `base_role_id` role holds; its own keys also bring the
     * parent page of every sub action among them (see roleKeys()), so a check for "job-order"
     * succeeds for a role that was only given "job-order.approve" — which is
     * how the Role modal presents it (ticking a sub action ticks its page).
     *
     * The seeded lists are not widened that way because one of them holds a
     * page's buttons without the page: the Head Technician works the customer
     * pane opened from a job order, but has never had the Customer page.
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

        if (Role::isLocked($roleId)) {
            return self::ROLE_PERMISSIONS[$roleId] ?? [];
        }

        return self::customRoleKeys($user);
    }

    /**
     * Does this user hold the given key?
     *
     * `$permission` may be a single key or a list, in which case holding any one
     * of them is enough — used by endpoints that serve two audiences.
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
     * This is what a hybrid role inherits.
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
     * Was this custom role last saved before per-action keys existed?
     *
     * Such a row's stored list names pages (and the sub-keys the old modal
     * offered) rather than every button, so it is read through the legacy
     * rules: LEGACY_GRANT_ALL_PAGES here, and the role-name checks in
     * App\Support\AgentAccess. A missing column reads as 0.
     *
     * @param  \App\Models\Role|object|null  $role
     */
    public static function isLegacyRole($role): bool
    {
        if ($role === null || Role::isLocked($role->id ?? null)) {
            return false;
        }

        return (int) ($role->permissions_version ?? 0) < self::CURRENT_VERSION;
    }

    /**
     * Whether the user holds a legacy custom role (see isLegacyRole).
     *
     * Sent to the clients at sign-in and by GET /me/permissions so they can
     * keep what such a role could open before the permission table existed —
     * the bell's shortcuts — until the role is saved from the Roles screen.
     */
    public static function isLegacyUser($user): bool
    {
        // A seeded role never is, and needs no role lookup to say so.
        if ($user === null || Role::isLocked((int) ($user->role_id ?? 0))) {
            return false;
        }

        return self::isLegacyRole(self::roleOf($user));
    }

    /**
     * Everything a custom role holds: its base role's keys plus its own.
     *
     * The inherited half is resolved here, on every read, rather than copied
     * into `roles.permissions` when the role is saved. A base of SuperAdmin
     * inherits WILDCARD, which subsumes everything else.
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

        if (self::isLegacyRole($role)) {
            $stored = self::withLegacyActions($stored);
        }

        // The implied parent pages are added for the role's own keys only. The
        // inherited half is taken exactly as the base role holds it, so a
        // hybrid never gains a page its base does not have.
        return array_values(array_unique(array_merge(
            $inherited,
            self::withImpliedPages(self::expandRetiredActions($stored))
        )));
    }

    /**
     * Add every action of each LEGACY_GRANT_ALL_PAGES page in the list.
     *
     * Appended after the stored keys, so the list keeps its original order —
     * the web client lands a standalone custom role on its first key.
     *
     * @param  string[]  $keys
     * @return string[]
     */
    private static function withLegacyActions(array $keys): array
    {
        $result = $keys;

        foreach ($keys as $key) {
            if (in_array($key, self::LEGACY_GRANT_ALL_PAGES, true)) {
                array_push($result, ...(self::ACTIONS[$key] ?? []));
            }
        }

        return array_values(array_unique($result));
    }

    /**
     * Replace any retired key with the keys that took its place.
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
     * A seeded role has its own entry. A hybrid falls back to its base role's,
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

    /** @return string[] */
    private static function customRoleKeys($user): array
    {
        return self::roleKeys(self::roleOf($user));
    }

    /**
     * The user's role row. Prefers an already-loaded relation.
     *
     * An Eloquent user's `role` relation is read only when it is already
     * loaded; otherwise the row is fetched WITHOUT being attached to the
     * model. `isset($user->role)` would lazy-load the relation onto the user,
     * and since ApiAccessControl asks this about the request's own user on
     * every request, that would quietly add a `role` object to every place the
     * signed-in user is serialised (GET /user and friends) — a response change
     * the gate must not make in `log` mode.
     *
     * @return \App\Models\Role|object|null
     */
    private static function roleOf($user)
    {
        if ($user instanceof \Illuminate\Database\Eloquent\Model) {
            if ($user->relationLoaded('role')) {
                return $user->getRelation('role');
            }

            return empty($user->role_id) ? null : Role::find($user->role_id);
        }

        if (isset($user->role) && $user->role !== null) {
            return $user->role;
        }

        return empty($user->role_id) ? null : Role::find($user->role_id);
    }

    /**
     * Read a stored permissions value: an array (the model cast), a JSON
     * string, or a comma-separated list, for rows written before the cast.
     *
     * @return string[]
     */
    private static function parseKeys($raw): array
    {
        if (is_string($raw) && trim($raw) !== '') {
            $decoded = json_decode($raw, true);

            $raw = is_array($decoded) ? $decoded : explode(',', $raw);
        }

        if (!is_array($raw)) {
            return [];
        }

        // Only plain string entries are keys. A legacy row holding something
        // else (a nested array, null, a boolean) must read as "no such key",
        // not throw "Array to string conversion" out of sign-in or the gate.
        $keys = [];

        foreach ($raw as $entry) {
            if (is_string($entry) && ($entry = trim($entry)) !== '') {
                $keys[] = $entry;
            }
        }

        return array_values(array_unique($keys));
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
