<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Support\AgentAccess;
use App\Support\ApiPermissionMap;
use App\Support\Permissions;
use Tests\TestCase;

/**
 * The seeded roles keep exactly what GOWISER gave them before the permission
 * table existed, and legacy custom roles keep exactly what they had.
 *
 * The page lists below are transcribed from the clients as they stood before
 * the port — the web Sidebar's allowedRoles through filterMenuByRole, the
 * mobile Sidebar's allowedRoles/allowedRoleIds and the mobile Menu's
 * Administrator block — and the action lists from the hasPermission()/role
 * checks behind each control. If one of these fails, a role lost (or gained)
 * something on deploy.
 *
 * No database: a role is described by its id, a custom role by an unsaved row.
 */
class SystemRoleCatalogTest extends TestCase
{
    /** Web Sidebar, per seeded role. */
    private const WEB_SIDEBAR = [
        Role::ADMINISTRATOR => [
            'dashboard', 'live-monitor',
            'customer', 'transaction-list', 'transactions-revert', 'prepaid-override', 'payment-portal',
            'soa', 'invoice', 'overdue', 'so-charge', 'dc-notice', 'mass-rebate', 'discounts',
            'application-management', 'job-order', 'service-order', 'work-order', 'lcp-nap-location', 'sms-blast',
            'commission', 'bonus-history', 'team-agent', 'agent-management', 'agent-payout', 'agent-invoices',
            'inventory', 'inventory-category-list',
            'monthly-payables', 'expenses', 'expenses-category',
            'disconnected-logs', 'reconnection-logs', 'sms-logs', 'email-logs', 'data-logs',
            'smartolt-tool', 'mikrotik-radius-tool', 'xendit-reconcile-tool', 'billing-reconcile-tool',
        ],
        Role::TECHNICIAN => ['job-order', 'service-order', 'lcp-nap-location'],
        Role::CUSTOMER => ['customer-dashboard', 'customer-bills', 'customer-support'],
        // The web "Dashboard" entry renders the agent dashboard for this role.
        Role::AGENT => ['agent-dashboard', 'job-order', 'work-order', 'bonus-history', 'agent-invoices'],
        Role::INVENTORY_STAFF => ['inventory', 'inventory-category-list'],
        Role::OSP => ['work-order', 'lcp-nap-location'],
        Role::HEAD_TECH => [
            'application-management', 'job-order', 'service-order', 'work-order', 'lcp-nap-location',
            'location-list', 'lcp', 'nap', 'smartolt-tool', 'mikrotik-radius-tool',
        ],
    ];

    /** Mobile Sidebar + Menu (section ids mapped to catalog keys), per seeded role. */
    private const MOBILE = [
        Role::ADMINISTRATOR => [
            'dashboard', 'application-management', 'job-order', 'service-order', 'work-order', 'lcp-nap-location',
            'overdue', 'commission', 'agent-invoices', 'inventory', 'inventory-category-list',
            'promo-list', 'plan-list', 'location-list', 'lcp', 'nap', 'usage-type', 'payment-method',
            'work-category', 'radius-config', 'smart-olt', 'sms-config', 'pppoe-setup', 'concern-config',
            'billing-config', 'sms-logs', 'email-logs', 'smart-olt-logs', 'expenses-log',
            // Menu block
            'live-monitor', 'sms-blast', 'reports', 'customer', 'transaction-list', 'transactions-revert',
            'payment-portal', 'soa', 'soa-generation', 'invoice', 'so-charge', 'dc-notice', 'mass-rebate',
            'discounts', 'staggered-payment', 'team-agent', 'agent-management', 'agent-payout',
            'group-management', 'status-remarks-list', 'router-models', 'ports', 'sms-template',
            'email-templates', 'user-management', 'tech-users', 'organization', 'roles',
            'disconnected-logs', 'reconnection-logs', 'data-logs', 'radius-logs', 'system-logs',
            'sms-blast-logs', 'settings',
        ],
        Role::TECHNICIAN => ['job-order', 'service-order', 'work-order', 'lcp-nap-location'],
        Role::CUSTOMER => ['customer-dashboard', 'customer-bills', 'customer-support'],
        // Mobile "History" is the agent's bonus history.
        Role::AGENT => ['agent-dashboard', 'job-order', 'work-order', 'bonus-history', 'agent-invoices', 'agent-application'],
        Role::INVENTORY_STAFF => ['inventory', 'inventory-category-list'],
        Role::OSP => ['work-order', 'lcp-nap-location'],
        Role::HEAD_TECH => [
            'application-management', 'job-order', 'service-order', 'work-order', 'lcp-nap-location',
            'location-list', 'lcp', 'nap',
        ],
    ];

    /** Buttons each seeded role sees today on at least one client. */
    private const BUTTONS = [
        Role::ADMINISTRATOR => [
            'customer.so-request', 'customer.details-edit', 'customer.attachment', 'customer.transact',
            'customer.prepaid-override',
            'transaction-list.batch-approve', 'transaction-list.approve', 'transaction-list.revert-request',
            'mass-rebate.add', 'staggered-payment.add', 'discounts.add',
            'application-management.move-to-jo', 'application-management.quick-status',
            'job-order.approve', 'job-order.failed', 'job-order.admin-edit', 'job-order.attachment',
            'service-order.admin-edit', 'work-order.manage', 'reports.manage',
            'commission.create', 'bonus-history.payout', 'agent-payout.approve',
            'agent-invoices.generate', 'agent-invoices.status', 'agent-invoices.payout',
            'monthly-payables.create', 'monthly-payables.edit', 'monthly-payables.delete',
            'monthly-payables.generate', 'monthly-payables.pay',
            'expenses.create', 'expenses.edit', 'expenses.delete',
            'expenses-category.create', 'expenses-category.edit', 'expenses-category.delete',
            'plan-list.create', 'plan-list.edit', 'plan-list.delete',
            'user-management.create', 'user-management.edit', 'user-management.delete',
        ],
        Role::TECHNICIAN => ['job-order.tech-edit', 'job-order.attachment', 'service-order.tech-edit'],
        Role::CUSTOMER => [],
        Role::AGENT => [],
        Role::INVENTORY_STAFF => [],
        Role::OSP => ['work-order.manage'],
        Role::HEAD_TECH => [
            'customer.so-request', 'customer.details-edit', 'customer.attachment', 'customer.transact',
            'customer.prepaid-override',
            'application-management.move-to-jo', 'application-management.quick-status',
            'job-order.admin-edit', 'job-order.attachment', 'service-order.admin-edit', 'work-order.manage',
            'location-list.create', 'location-list.edit', 'location-list.delete',
            'lcp.create', 'lcp.edit', 'lcp.delete', 'nap.create', 'nap.edit', 'nap.delete',
        ],
    ];

    /** Keys a seeded role must NOT hold: it never had them on either client. */
    private const NEVER = [
        Role::ADMINISTRATOR => [
            'transaction-list.delete', 'transactions-revert.approve', 'prepaid-override.approve',
            'reports.delete', 'vlan-config', 'job-order.tech-edit', 'service-order.tech-edit',
        ],
        Role::TECHNICIAN => [
            'job-order.approve', 'job-order.failed', 'job-order.admin-edit', 'service-order.admin-edit',
            'work-order.manage', 'customer', 'transaction-list',
        ],
        Role::CUSTOMER => ['job-order', 'customer', 'dashboard', 'bonus-history'],
        Role::AGENT => [
            'dashboard', 'commission', 'commission.create', 'bonus-history.payout', 'agent-payout',
            'agent-payout.approve', 'agent-invoices.generate', 'agent-invoices.status',
            'agent-invoices.payout', 'work-order.manage', 'customer',
        ],
        Role::INVENTORY_STAFF => ['job-order', 'customer'],
        Role::OSP => ['job-order', 'customer'],
        // Customer actions in the pane opened from a job order, but never the Customer page.
        Role::HEAD_TECH => [
            'customer', 'job-order.approve', 'job-order.failed', 'job-order.tech-edit',
            'service-order.tech-edit', 'transaction-list', 'agent-payout.approve',
        ],
    ];

    private function seeded(int $roleId): object
    {
        return (object) ['id' => 1, 'role_id' => $roleId, 'role' => null];
    }

    private function custom(array $permissions, int $version = 0, ?int $base = null, string $name = 'Custom'): object
    {
        $role = new Role();
        $role->id = 42;
        $role->role_name = $name;
        $role->base_role_id = $base;
        $role->permissions = $permissions;
        $role->permissions_version = $version;

        return (object) ['id' => 5, 'role_id' => 42, 'role' => $role];
    }

    public function test_every_seeded_role_keeps_every_page_its_web_sidebar_showed(): void
    {
        foreach (self::WEB_SIDEBAR as $roleId => $pages) {
            $held = Permissions::forUser($this->seeded($roleId));

            foreach ($pages as $page) {
                $this->assertContains($page, $held, "Role $roleId lost web page '$page'.");
            }
        }
    }

    public function test_every_seeded_role_keeps_every_page_its_mobile_menu_showed(): void
    {
        foreach (self::MOBILE as $roleId => $pages) {
            $held = Permissions::forUser($this->seeded($roleId));

            foreach ($pages as $page) {
                $this->assertContains($page, $held, "Role $roleId lost mobile page '$page'.");
            }
        }
    }

    /** No seeded role holds a page that neither client ever showed it. */
    public function test_no_seeded_role_gains_a_page_neither_client_showed(): void
    {
        foreach (self::WEB_SIDEBAR as $roleId => $web) {
            $pages = array_filter(Permissions::forUser($this->seeded($roleId)), fn ($k) => !str_contains($k, '.'));
            $extra = array_values(array_diff($pages, $web, self::MOBILE[$roleId]));

            $this->assertSame([], $extra, "Role $roleId holds pages no client showed it.");
        }
    }

    public function test_every_seeded_role_keeps_its_buttons(): void
    {
        foreach (self::BUTTONS as $roleId => $keys) {
            $user = $this->seeded($roleId);

            foreach ($keys as $key) {
                $this->assertTrue(Permissions::allows($user, $key), "Role $roleId lost '$key'.");
            }
        }
    }

    public function test_no_seeded_role_gains_what_it_never_had(): void
    {
        foreach (self::NEVER as $roleId => $keys) {
            $user = $this->seeded($roleId);

            foreach ($keys as $key) {
                $this->assertFalse(Permissions::allows($user, $key), "Role $roleId should not hold '$key'.");
            }
        }
    }

    public function test_super_admin_holds_everything_and_lands_on_the_dashboard(): void
    {
        $this->assertSame(['*'], Permissions::forUser($this->seeded(Role::SUPER_ADMIN)));
        $this->assertSame('dashboard', Permissions::homeFor($this->seeded(Role::SUPER_ADMIN)));
    }

    public function test_landing_pages_match_the_web_app(): void
    {
        $expected = [
            Role::SUPER_ADMIN => 'dashboard', Role::ADMINISTRATOR => 'dashboard',
            Role::HEAD_TECH => 'application-management', Role::TECHNICIAN => 'job-order',
            Role::OSP => 'work-order', Role::INVENTORY_STAFF => 'inventory',
            Role::AGENT => 'agent-dashboard', Role::CUSTOMER => 'customer-dashboard',
        ];

        foreach ($expected as $roleId => $home) {
            $this->assertSame($home, Permissions::homeFor($this->seeded($roleId)), "Role $roleId lands elsewhere.");
        }
    }

    public function test_the_gowiser_pages_and_keys_exist(): void
    {
        foreach (['commission', 'expenses', 'expenses-category', 'monthly-payables', 'prepaid-override'] as $page) {
            $this->assertContains($page, Permissions::PAGES);
        }

        $this->assertSame(['commission.create'], Permissions::ACTIONS['commission']);
        $this->assertSame(['expenses.create', 'expenses.edit', 'expenses.delete'], Permissions::ACTIONS['expenses']);
        $this->assertSame(['expenses-category.create', 'expenses-category.edit', 'expenses-category.delete'], Permissions::ACTIONS['expenses-category']);
        $this->assertSame(
            ['monthly-payables.create', 'monthly-payables.edit', 'monthly-payables.delete', 'monthly-payables.generate', 'monthly-payables.pay'],
            Permissions::ACTIONS['monthly-payables']
        );
        $this->assertSame(['prepaid-override.approve'], Permissions::ACTIONS['prepaid-override']);
        $this->assertContains('customer.prepaid-override', Permissions::all());

        // Pages with no GOWISER screen are not offered.
        foreach (['support', 'radius-queue', 'modem-router-logs'] as $page) {
            $this->assertNotContains($page, Permissions::all());
        }
    }

    /** Every key the API table asks for is one a role can actually hold. */
    public function test_the_api_table_only_names_known_keys(): void
    {
        $rules = (new \ReflectionClass(ApiPermissionMap::class))->getConstant('RULES');
        $known = Permissions::all();
        $unknown = [];

        $collect = function ($req) use (&$collect, &$unknown, $known) {
            foreach ((array) $req as $key) {
                if ($key !== null && $key !== ApiPermissionMap::PUBLIC_ACCESS && !in_array($key, $known, true)) {
                    $unknown[] = $key;
                }
            }
        };

        foreach ($rules as $rule) {
            $collect($rule[1]);
            $collect($rule[2]);

            if (isset($rule[3])) {
                if (is_string($rule[3])) {
                    $collect(array_map(fn ($v) => "{$rule[3]}.$v", Permissions::CRUD_VERBS));
                } else {
                    foreach ($rule[3] as $req) {
                        $collect($req);
                    }
                }
            }
        }

        $this->assertSame([], array_values(array_unique($unknown)));
    }

    // ── Legacy custom roles ──────────────────────────────────────────────────

    public function test_a_legacy_role_gets_every_action_of_its_ungated_pages(): void
    {
        $user = $this->custom(['plan-list', 'user-management', 'commission', 'monthly-payables', 'expenses', 'expenses-category', 'work-order']);

        foreach ([
            'plan-list.create', 'plan-list.edit', 'plan-list.delete',
            'user-management.create', 'user-management.edit', 'user-management.delete',
            'commission.create',
            'monthly-payables.create', 'monthly-payables.generate', 'monthly-payables.pay',
            'expenses.delete', 'expenses-category.edit', 'work-order.manage',
        ] as $key) {
            $this->assertTrue(Permissions::allows($user, $key), "Legacy role lost '$key'.");
        }

        // Its stored order is kept: the web lands a custom role on its first key.
        $this->assertSame('plan-list', Permissions::forUser($user)[0]);
    }

    public function test_the_clients_are_told_which_custom_roles_are_legacy(): void
    {
        $this->assertTrue(Permissions::isLegacyUser($this->custom(['customer'])));
        $this->assertFalse(Permissions::isLegacyUser($this->custom(['customer'], Permissions::CURRENT_VERSION)));

        foreach (range(1, 8) as $roleId) {
            $this->assertFalse(Permissions::isLegacyUser($this->seeded($roleId)), "Seeded role $roleId reported as legacy.");
        }

        $this->assertFalse(Permissions::isLegacyUser(null));
    }

    public function test_a_legacy_role_keeps_its_stored_sub_keys_and_nothing_more(): void
    {
        $user = $this->custom([
            'job-order', 'job-order.tech-edit', 'customer', 'customer.transact',
            'transaction-list', 'service-order', 'application-management',
        ]);

        $this->assertTrue(Permissions::allows($user, 'job-order.tech-edit'));
        $this->assertTrue(Permissions::allows($user, 'customer.transact'));

        foreach ([
            'job-order.approve', 'job-order.failed', 'job-order.admin-edit', 'job-order.attachment',
            'customer.details-edit', 'customer.prepaid-override', 'transaction-list.approve',
            'service-order.tech-edit', 'service-order.admin-edit', 'application-management.move-to-jo',
        ] as $key) {
            $this->assertFalse(Permissions::allows($user, $key), "Legacy role gained '$key'.");
        }
    }

    public function test_a_legacy_role_is_never_granted_the_role_gated_actions(): void
    {
        $user = $this->custom([
            'prepaid-override', 'transactions-revert', 'reports', 'bonus-history', 'agent-payout', 'agent-invoices',
        ]);

        foreach ([
            'prepaid-override.approve', 'transactions-revert.approve', 'reports.manage', 'reports.delete',
            'bonus-history.payout', 'agent-payout.approve', 'agent-invoices.generate',
            'agent-invoices.status', 'agent-invoices.payout',
        ] as $key) {
            $this->assertFalse(Permissions::allows($user, $key), "Legacy role gained '$key'.");
        }
    }

    public function test_a_saved_role_is_read_exactly_as_ticked(): void
    {
        $user = $this->custom(['plan-list', 'plan-list.create'], Permissions::CURRENT_VERSION);

        $this->assertTrue(Permissions::allows($user, 'plan-list.create'));
        $this->assertFalse(Permissions::allows($user, 'plan-list.delete'));
    }

    public function test_a_hybrid_does_not_gain_pages_its_base_lacks(): void
    {
        $user = $this->custom([], Permissions::CURRENT_VERSION, Role::HEAD_TECH);

        $this->assertTrue(Permissions::allows($user, 'customer.details-edit'));
        $this->assertFalse(Permissions::allows($user, 'customer'));

        // Its own ticks still imply their page.
        $own = $this->custom(['customer.transact'], Permissions::CURRENT_VERSION, Role::HEAD_TECH);
        $this->assertTrue(Permissions::allows($own, 'customer'));
    }

    // ── AgentAccess ──────────────────────────────────────────────────────────

    /** Before the port only Administrator and SuperAdmin passed these checks. */
    public function test_agent_access_outcomes_for_seeded_roles_are_unchanged(): void
    {
        $keys = [
            AgentAccess::KEY_APPROVE_PAYOUT, AgentAccess::KEY_BONUS, AgentAccess::KEY_RAISE_PAYOUT,
            AgentAccess::KEY_GENERATE_INVOICES, AgentAccess::KEY_INVOICE_STATUS,
        ];

        foreach (Role::LOCKED_ROLE_IDS as $roleId) {
            $user = $this->seeded($roleId);
            $admin = in_array($roleId, [Role::ADMINISTRATOR, Role::SUPER_ADMIN], true);

            foreach ($keys as $key) {
                $this->assertSame($admin, AgentAccess::allows($user, $key), "Role $roleId, " . json_encode($key));
            }

            $this->assertSame($admin, AgentAccess::isAdmin($user), "Role $roleId isAdmin");
            $this->assertSame($admin, AgentAccess::canReadAll($user), "Role $roleId canReadAll");
            $this->assertSame($admin ? null : 403, optional(AgentAccess::denyUnless($user, AgentAccess::KEY_APPROVE_PAYOUT))->getStatusCode());
        }
    }

    public function test_agent_access_follows_a_custom_roles_keys(): void
    {
        $approver = $this->custom(['agent-payout', 'agent-payout.approve'], Permissions::CURRENT_VERSION);
        $this->assertTrue(AgentAccess::allows($approver, AgentAccess::KEY_APPROVE_PAYOUT));
        $this->assertFalse(AgentAccess::allows($approver, AgentAccess::KEY_GENERATE_INVOICES));
        $this->assertTrue(AgentAccess::canReadAll($approver));

        $reader = $this->custom(['bonus-history', 'agent-invoices'], Permissions::CURRENT_VERSION);
        $this->assertFalse(AgentAccess::canReadAll($reader), 'The Agent view of these pages is own-rows only.');
    }

    /** Legacy rows keep the old name-based answer; a saved row does not. */
    public function test_agent_access_keeps_the_legacy_role_name_rule(): void
    {
        $this->assertTrue(AgentAccess::allows($this->custom([], 0, null, 'Administrator'), AgentAccess::KEY_APPROVE_PAYOUT));
        $this->assertTrue(AgentAccess::canReadAll($this->custom([], 0, null, 'Billing')));
        $this->assertFalse(AgentAccess::allows($this->custom([], 0, null, 'Billing'), AgentAccess::KEY_APPROVE_PAYOUT));

        $this->assertFalse(AgentAccess::allows($this->custom([], Permissions::CURRENT_VERSION, null, 'Administrator'), AgentAccess::KEY_APPROVE_PAYOUT));
    }
}
