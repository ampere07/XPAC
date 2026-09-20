<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Support\ApiPermissionMap;
use App\Support\Permissions;
use Tests\TestCase;

/**
 * The API's authorization table, checked against the routes it is supposed to
 * cover and against what each role should be able to reach.
 *
 * No database: a role is entirely described by its id, and a permission
 * decision is a pure function of the route and that id, so the whole table can
 * be exercised without a fixture. That also means this suite runs anywhere,
 * which matters for something that is meant to be run whenever a route is
 * added.
 */
class ApiPermissionCoverageTest extends TestCase
{
    /**
     * A stand-in for an authenticated user, which is all Permissions reads.
     *
     * A custom role is built at the current permissions version by default —
     * the shape Role Management writes — so its stored list is read exactly as
     * given. Pass $version 0 for a role saved before the per-action keys
     * existed, which Permissions grandfathers; see user_saved_before_actions().
     */
    private function user(int $roleId, ?array $customPermissions = null, int $version = Permissions::CURRENT_VERSION): object
    {
        return new class($roleId, $customPermissions, $version) {
            public $id = 1;
            public $role_id;
            public $role;

            public function __construct(int $roleId, ?array $permissions, int $version)
            {
                $this->role_id = $roleId;
                $this->role = $permissions === null ? null : (object) [
                    'permissions' => $permissions,
                    'permissions_version' => $version,
                ];
            }
        };
    }

    /** A custom role last saved before the per-action keys existed. */
    private function userSavedBeforeActions(int $roleId, array $customPermissions): object
    {
        return $this->user($roleId, $customPermissions, 0);
    }

    /** Every API route the application registers, as [method, path]. */
    private function apiRoutes(): array
    {
        $routes = [];

        foreach (app('router')->getRoutes() as $route) {
            $uri = $route->uri();

            if (!str_starts_with($uri, 'api/')) {
                continue;
            }

            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                $routes[] = [$method, $uri];
            }
        }

        return $routes;
    }

    /**
     * No endpoint is anonymous unless the table says so in as many words.
     *
     * This is the property that actually matters: before the table existed, 624
     * of the 670 endpoints answered anyone at all.
     */
    public function test_no_route_is_public_unless_declared(): void
    {
        $public = [];

        foreach ($this->apiRoutes() as [$method, $uri]) {
            if (ApiPermissionMap::requirementFor($method, $uri) === ApiPermissionMap::PUBLIC_ACCESS) {
                $public[] = "$method $uri";
            }
        }

        // Sign-in, the sign-in screen's own branding calls, the payment
        // provider's webhook, and the image proxy that <img> tags hit without
        // a header. Anything else appearing here is a regression.
        $expected = [
            'GET api/app-version/config',
            'GET api/cors-test',
            'GET api/form-ui/config',
            'GET api/health',
            'GET api/locations-ping',
            'GET api/payments/webhook-info',
            'GET api/proxy/image',
            'GET api/settings-color-palette/active',
            'GET api/settings-image-size/active',
            'GET api/system-config/logo',
            'GET api/xendit-webhook',
            'POST api/forgot-password',
            'POST api/login',
            'POST api/payments/webhook',
            'POST api/xendit-webhook',
        ];

        sort($public);
        sort($expected);

        $this->assertSame($expected, $public, 'The set of anonymous endpoints changed.');
    }

    /**
     * Every route matches a rule.
     *
     * A route that matches nothing still requires a session, so this failing is
     * not a hole — it is a route whose requirement nobody has decided yet, which
     * is the moment to decide it.
     */
    public function test_every_route_matches_a_rule(): void
    {
        $unmatched = [];

        foreach ($this->apiRoutes() as [$method, $uri]) {
            // The catch-all OPTIONS handler exists for CORS preflight and is
            // answered before authorization runs.
            if ($method === 'OPTIONS') {
                continue;
            }

            if (!ApiPermissionMap::hasRule($uri)) {
                $unmatched[] = "$method $uri";
            }
        }

        $this->assertSame([], array_values(array_unique($unmatched)), 'Routes with no rule in ApiPermissionMap.');
    }

    /** SuperAdmin holds everything, including keys that do not exist yet. */
    public function test_super_admin_holds_every_key(): void
    {
        $superAdmin = $this->user(Role::SUPER_ADMIN);

        foreach (Permissions::all() as $key) {
            $this->assertTrue(Permissions::allows($superAdmin, $key), "SuperAdmin should hold $key");
        }

        $this->assertTrue(Permissions::allows($superAdmin, 'a-page-added-next-year'));
    }

    /**
     * Each locked role reaches what it is meant to and nothing else.
     *
     * The "denied" side is the point of the test: these are the exact requests a
     * signed-in user of that role could previously make by hand.
     */
    public function test_locked_roles_reach_only_their_own_endpoints(): void
    {
        $cases = [
            // role                    => [allowed [method, uri], ...], [denied ...]
            Role::TECHNICIAN => [
                'allow' => [
                    ['GET', 'api/job-orders'],
                    ['PUT', 'api/job-orders/5'],
                    ['GET', 'api/service-orders'],
                    ['GET', 'api/work-orders'],
                    ['POST', 'api/work-orders'],
                    ['GET', 'api/lcpnap'],
                    ['GET', 'api/plans'],
                    ['POST', 'api/technician-location'],
                ],
                'deny' => [
                    ['GET', 'api/transactions'],
                    ['POST', 'api/transactions/5/approve'],
                    // Reading the staff list is allowed — a technician's job
                    // order names the person it is assigned to — but creating
                    // an account is not.
                    ['POST', 'api/users'],
                    ['GET', 'api/reports'],
                    ['DELETE', 'api/plans/3'],
                    ['GET', 'api/commissions'],
                    ['GET', 'api/logs'],
                    ['GET', 'api/debug/users-table'],
                    ['POST', 'api/job-orders/5/approve'],
                ],
            ],
            Role::AGENT => [
                'allow' => [
                    ['GET', 'api/job-orders'],
                    ['GET', 'api/work-orders'],
                    ['GET', 'api/commissions'],
                    ['GET', 'api/agent-invoices'],
                    ['POST', 'api/applications'],
                ],
                'deny' => [
                    ['GET', 'api/customers'],
                    ['GET', 'api/transactions'],
                    ['POST', 'api/agent-invoices/generate'],
                    ['PATCH', 'api/agent-invoices/2/status'],
                    ['GET', 'api/service-orders'],
                    ['POST', 'api/users'],
                    ['GET', 'api/customer-detail/ACC-1'],
                    ['POST', 'api/work-orders'],
                    ['DELETE', 'api/work-orders/3'],
                    ['POST', 'api/commissions/history/1/approve'],
                    ['GET', 'api/reports'],
                ],
            ],
            Role::CUSTOMER => [
                'allow' => [
                    ['GET', 'api/invoices/12'],
                    ['GET', 'api/statement-of-accounts/12'],
                    ['POST', 'api/payments/create'],
                    ['GET', 'api/transactions/by-account/ACC-1'],
                ],
                'deny' => [
                    ['GET', 'api/job-orders'],
                    ['GET', 'api/work-orders'],
                    ['GET', 'api/users'],
                    ['GET', 'api/reports'],
                    ['POST', 'api/transactions/5/approve'],
                    ['GET', 'api/commissions'],
                    ['GET', 'api/data-logs'],
                    ['GET', 'api/dashboard/counts'],
                ],
            ],
            Role::INVENTORY_STAFF => [
                'allow' => [
                    ['GET', 'api/inventory'],
                    ['POST', 'api/inventory'],
                    ['GET', 'api/inventory-categories'],
                    // An inventory log records who took an item out and who
                    // brought it back, so the log form has to offer the account
                    // list. Reading it only; the writes below stay denied.
                    ['GET', 'api/users'],
                ],
                'deny' => [
                    ['GET', 'api/job-orders'],
                    ['GET', 'api/transactions'],
                    ['GET', 'api/customers'],
                    ['POST', 'api/users'],
                    ['DELETE', 'api/users/7'],
                    ['POST', 'api/sms-blast'],
                ],
            ],
            Role::OSP => [
                'allow' => [
                    ['GET', 'api/work-orders'],
                    ['PUT', 'api/work-orders/3'],
                    ['GET', 'api/lcpnap'],
                ],
                'deny' => [
                    ['GET', 'api/job-orders'],
                    ['GET', 'api/service-orders'],
                    ['GET', 'api/transactions'],
                    // Items are readable — a work order consumes them — but
                    // stock is the Inventory page's to change.
                    ['POST', 'api/inventory'],
                    ['GET', 'api/customers'],
                ],
            ],
            Role::ADMINISTRATOR => [
                'allow' => [
                    ['GET', 'api/dashboard/counts'],
                    ['GET', 'api/transactions'],
                    ['POST', 'api/transactions/batch-approve'],
                    ['GET', 'api/job-orders'],
                    ['POST', 'api/job-orders/5/approve'],
                    ['GET', 'api/reports'],
                    ['GET', 'api/inventory'],
                    ['GET', 'api/commissions'],
                    ['POST', 'api/agent-invoices/generate'],
                ],
                'deny' => [
                    // Configurations, Users and Settings are SuperAdmin's.
                    ['POST', 'api/plans'],
                    ['DELETE', 'api/promos/2'],
                    ['POST', 'api/roles'],
                    ['GET', 'api/logs'],
                    ['GET', 'api/debug/users-table'],
                    ['POST', 'api/setup/initialize'],
                    ['GET', 'api/login-debug'],
                    ['POST', 'api/radius-config'],
                ],
            ],
            Role::HEAD_TECH => [
                'allow' => [
                    ['GET', 'api/applications'],
                    ['GET', 'api/job-orders'],
                    ['POST', 'api/job-orders/5/approve'],
                    ['GET', 'api/service-orders'],
                    ['GET', 'api/work-orders'],
                    ['POST', 'api/locations'],
                ],
                'deny' => [
                    ['GET', 'api/transactions'],
                    ['POST', 'api/users'],
                    ['GET', 'api/reports'],
                    ['POST', 'api/inventory'],
                    ['POST', 'api/plans'],
                    ['GET', 'api/soa-records'],
                    ['GET', 'api/commissions'],
                ],
            ],
        ];

        foreach ($cases as $roleId => $sets) {
            $user = $this->user($roleId);

            foreach ($sets['allow'] as [$method, $uri]) {
                $this->assertTrue(
                    $this->permits($user, $method, $uri),
                    "role $roleId should be allowed $method $uri"
                );
            }

            foreach ($sets['deny'] as [$method, $uri]) {
                $this->assertFalse(
                    $this->permits($user, $method, $uri),
                    "role $roleId should be denied $method $uri"
                );
            }
        }
    }

    /** A custom role reaches exactly the pages it was ticked for. */
    public function test_custom_role_is_limited_to_its_stored_keys(): void
    {
        $user = $this->user(12, ['job-order', 'job-order.approve']);

        $this->assertTrue($this->permits($user, 'GET', 'api/job-orders'));
        $this->assertTrue($this->permits($user, 'POST', 'api/job-orders/5/approve'));

        $this->assertFalse($this->permits($user, 'GET', 'api/transactions'));
        $this->assertFalse($this->permits($user, 'GET', 'api/customers'));
        $this->assertFalse($this->permits($user, 'GET', 'api/reports'));
        $this->assertFalse($this->permits($user, 'POST', 'api/users'));
        // Ticking "Approve" does not confer the edit form.
        $this->assertFalse($this->permits($user, 'PUT', 'api/job-orders/5'));
    }

    /**
     * The per-button keys added for the pages that had none.
     *
     * Each of these was previously either ungated or gated by borrowing another
     * page's key, so the cases below are the exact requests that used to
     * succeed for the wrong people.
     */
    public function test_new_sub_actions_separate_reading_from_acting(): void
    {
        // Granted the page and nothing else: may look, may not act.
        $reader = $this->user(20, [
            'reports', 'bonus-history', 'agent-payout', 'agent-invoices',
            'ports', 'router-models', 'status-remarks-list',
        ]);

        foreach ([
            ['GET', 'api/reports'],
            ['GET', 'api/commissions'],
            ['GET', 'api/agent-invoices'],
            ['GET', 'api/ports'],
        ] as [$method, $uri]) {
            $this->assertTrue($this->permits($reader, $method, $uri), "reader should read $uri");
        }

        foreach ([
            ['PUT', 'api/reports/1'],
            ['DELETE', 'api/reports/1'],
            ['PUT', 'api/reports/settings'],
            ['POST', 'api/commissions/history'],
            ['POST', 'api/commissions/history/1/approve'],
            ['POST', 'api/agent-invoices/generate'],
            ['PATCH', 'api/agent-invoices/2/status'],
            ['POST', 'api/ports'],
            ['DELETE', 'api/ports/1'],
            ['POST', 'api/router-models'],
            ['DELETE', 'api/status-remarks/1'],
        ] as [$method, $uri]) {
            $this->assertFalse($this->permits($reader, $method, $uri), "reader should not be able to $method $uri");
        }

        // Editing a report is not deleting one.
        $editor = $this->user(21, ['reports', 'reports.manage']);
        $this->assertTrue($this->permits($editor, 'PUT', 'api/reports/1'));
        $this->assertTrue($this->permits($editor, 'PUT', 'api/reports/settings'));
        $this->assertFalse($this->permits($editor, 'DELETE', 'api/reports/1'));

        // Issuing the invoice run is not settling one.
        $issuer = $this->user(22, ['agent-invoices', 'agent-invoices.generate']);
        $this->assertTrue($this->permits($issuer, 'POST', 'api/agent-invoices/generate'));
        $this->assertFalse($this->permits($issuer, 'PATCH', 'api/agent-invoices/2/status'));
    }

    /**
     * The Configurations and Users lists gate their buttons separately.
     *
     * These pages used to carry Add, Edit and Delete with the page key, so this
     * is the split that did not exist before: holding "plan-list" now means the
     * page and nothing on it.
     */
    public function test_configuration_pages_gate_each_button(): void
    {
        $reader = $this->user(30, ['plan-list', 'user-management', 'vlan-config']);

        $this->assertTrue($this->permits($reader, 'GET', 'api/plans'));
        $this->assertFalse($this->permits($reader, 'POST', 'api/plans'));
        $this->assertFalse($this->permits($reader, 'PUT', 'api/plans/1'));
        $this->assertFalse($this->permits($reader, 'DELETE', 'api/plans/1'));
        $this->assertFalse($this->permits($reader, 'POST', 'api/users'));
        $this->assertFalse($this->permits($reader, 'DELETE', 'api/vlans/1'));

        // Add without Delete: the pair a data-entry account wants.
        $adder = $this->user(31, ['plan-list', 'plan-list.create']);
        $this->assertTrue($this->permits($adder, 'POST', 'api/plans'));
        $this->assertFalse($this->permits($adder, 'PUT', 'api/plans/1'));
        $this->assertFalse($this->permits($adder, 'DELETE', 'api/plans/1'));

        // Edit answers both PUT and PATCH; no page means the two differ.
        $editor = $this->user(32, ['plan-list', 'plan-list.edit']);
        $this->assertTrue($this->permits($editor, 'PUT', 'api/plans/1'));
        $this->assertTrue($this->permits($editor, 'PATCH', 'api/plans/1'));
        $this->assertFalse($this->permits($editor, 'DELETE', 'api/plans/1'));
    }

    /**
     * A role saved before the per-action keys keeps the buttons it had.
     *
     * Reading such a role strictly would revoke Add, Edit and Delete from every
     * custom role on deploy, silently. It is grandfathered until somebody saves
     * it from Role Management, which stamps the current version.
     */
    public function test_roles_saved_before_the_action_keys_keep_their_buttons(): void
    {
        $legacy = $this->userSavedBeforeActions(33, ['plan-list', 'ports', 'user-management']);

        $this->assertTrue($this->permits($legacy, 'GET', 'api/plans'));
        $this->assertTrue($this->permits($legacy, 'POST', 'api/plans'));
        $this->assertTrue($this->permits($legacy, 'PUT', 'api/plans/1'));
        $this->assertTrue($this->permits($legacy, 'DELETE', 'api/plans/1'));
        $this->assertTrue($this->permits($legacy, 'DELETE', 'api/users/1'));

        // The rule reproduces what each page allowed, rather than assuming the
        // usual three everywhere. Ports drew nothing without `ports.manage`, so
        // holding the bare page still draws nothing; editing a user was
        // SuperAdmin's alone, so it is not conjured up either.
        $this->assertFalse($this->permits($legacy, 'POST', 'api/ports'));
        $this->assertFalse($this->permits($legacy, 'DELETE', 'api/ports/1'));
        $this->assertFalse($this->permits($legacy, 'PUT', 'api/users/1'));
        $this->assertTrue($this->permits($legacy, 'POST', 'api/users'));

        // Only the pages it actually holds, and only the standard verbs. Writing
        // to a page it was never granted stays shut — reads of reference data
        // are open to any signed-in user by design, so the write is what tells
        // the two apart — and a descriptive verb is never conjured up.
        $this->assertFalse($this->permits($legacy, 'POST', 'api/promos'));
        $this->assertFalse($this->permits($legacy, 'DELETE', 'api/promos/1'));
        $this->assertFalse(Permissions::allows($legacy, 'job-order.approve'));
    }

    /**
     * The single `.manage` key three pages used still grants all three verbs.
     *
     * Splitting it into create/edit/delete would otherwise have revoked the
     * buttons from every role holding the old key.
     */
    public function test_the_retired_manage_key_still_grants_its_buttons(): void
    {
        $holder = $this->user(34, ['ports', 'ports.manage']);

        $this->assertTrue($this->permits($holder, 'POST', 'api/ports'));
        $this->assertTrue($this->permits($holder, 'PUT', 'api/ports/1'));
        $this->assertTrue($this->permits($holder, 'DELETE', 'api/ports/1'));
    }

    /**
     * Report deletion stays SuperAdmin's, and remains distinct from editing.
     *
     * The Administrator holds reports.manage but not reports.delete — the split
     * the `role:super_admin` middleware used to express.
     */
    public function test_only_super_admin_may_delete_a_report(): void
    {
        $administrator = $this->user(Role::ADMINISTRATOR);

        $this->assertTrue($this->permits($administrator, 'PUT', 'api/reports/1'));
        $this->assertFalse($this->permits($administrator, 'DELETE', 'api/reports/1'));
        $this->assertTrue($this->permits($this->user(Role::SUPER_ADMIN), 'DELETE', 'api/reports/1'));
    }

    /**
     * The four holes a cross-layer simulation found in the first cut of the
     * table, each of which came from listing a key too generously.
     *
     * The shape of the mistake is worth keeping in mind when adding a rule: an
     * endpoint that serves both a staff page and the customer portal is usually
     * two endpoints — a collection and a by-account one — and only the second
     * belongs to the portal.
     */
    public function test_collection_endpoints_are_not_reachable_from_the_customer_portal(): void
    {
        $customer = $this->user(Role::CUSTOMER);

        // The subscriber book and the payments ledger are staff screens. The
        // portal reads its own record and its own transactions by account.
        $this->assertFalse($this->permits($customer, 'GET', 'api/customers'));
        $this->assertFalse($this->permits($customer, 'GET', 'api/transactions'));

        $this->assertTrue($this->permits($customer, 'GET', 'api/customer-detail/ACC-1'));
        $this->assertTrue($this->permits($customer, 'GET', 'api/transactions/by-account/ACC-1'));
        $this->assertTrue($this->permits($customer, 'GET', 'api/invoices/1'));
        $this->assertTrue($this->permits($customer, 'GET', 'api/statement-of-accounts/1'));
        $this->assertTrue($this->permits($customer, 'POST', 'api/payments/create'));
    }

    /** Holding a Job Order key is not a licence to rewrite subscriber records. */
    public function test_job_order_editing_does_not_confer_customer_editing(): void
    {
        $headTech = $this->user(Role::HEAD_TECH);

        $this->assertTrue(Permissions::allows($headTech, 'job-order.admin-edit'));
        $this->assertFalse($this->permits($headTech, 'PUT', 'api/customer-detail/ACC-1'));

        // The Customer page's own key is what grants it.
        $this->assertTrue($this->permits($this->user(Role::ADMINISTRATOR), 'PUT', 'api/customer-detail/ACC-1'));
    }

    /** The live technician map belongs to Monitoring, not to every field role. */
    public function test_technician_positions_are_limited_to_monitoring(): void
    {
        $this->assertFalse($this->permits($this->user(Role::TECHNICIAN), 'GET', 'api/technician-locations'));
        $this->assertFalse($this->permits($this->user(Role::AGENT), 'GET', 'api/technician-locations'));
        $this->assertTrue($this->permits($this->user(Role::ADMINISTRATOR), 'GET', 'api/technician-locations'));

        // A technician still posts their own position.
        $this->assertTrue($this->permits($this->user(Role::TECHNICIAN), 'POST', 'api/technician-location'));
    }

    /** A sub action implies its page, the way the Role modal presents it. */
    public function test_sub_action_implies_its_page(): void
    {
        $user = $this->user(13, ['transaction-list.approve']);

        $this->assertTrue(Permissions::allows($user, 'transaction-list'));
        $this->assertTrue(Permissions::allows($user, 'transaction-list.approve'));
        $this->assertFalse(Permissions::allows($user, 'transaction-list.batch-approve'));
    }

    /** A role row with no permissions at all reaches nothing that needs a key. */
    public function test_custom_role_without_permissions_is_denied(): void
    {
        $user = $this->user(14, []);

        $this->assertFalse($this->permits($user, 'GET', 'api/job-orders'));
        $this->assertFalse($this->permits($user, 'GET', 'api/transactions'));
        // Reference data is still readable — it is what every form needs.
        $this->assertTrue($this->permits($user, 'GET', 'api/plans'));
    }

    /** An anonymous caller reaches only the declared public endpoints. */
    public function test_anonymous_is_denied_everything_not_public(): void
    {
        foreach ([
            ['GET', 'api/job-orders'],
            ['GET', 'api/customers'],
            ['GET', 'api/transactions'],
            ['GET', 'api/users'],
            ['DELETE', 'api/plans/1'],
            ['GET', 'api/reports'],
            ['GET', 'api/customer-detail/ACC-1'],
        ] as [$method, $uri]) {
            $requirement = ApiPermissionMap::requirementFor($method, $uri);

            $this->assertNotSame(
                ApiPermissionMap::PUBLIC_ACCESS,
                $requirement,
                "$method $uri must not be anonymous"
            );
            $this->assertFalse(Permissions::allows(null, $requirement ?? 'anything'));
        }
    }

    /**
     * Would the middleware let this user through?
     *
     * The same two steps ApiAccessControl takes: look the requirement up, then
     * ask whether the user holds it. `null` means any signed-in user.
     */
    private function permits(object $user, string $method, string $uri): bool
    {
        $requirement = ApiPermissionMap::requirementFor($method, $uri);

        if ($requirement === ApiPermissionMap::PUBLIC_ACCESS || $requirement === null) {
            return true;
        }

        return Permissions::allows($user, $requirement);
    }
}
