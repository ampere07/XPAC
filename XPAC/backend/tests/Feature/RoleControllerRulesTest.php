<?php

namespace Tests\Feature;

use App\Http\Controllers\RoleController;
use App\Models\Role;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The rules Role Management's API enforces (manual §8), against a throwaway
 * in-memory schema holding just the two tables RoleController touches.
 *
 * Skipped unless the connection is SQLite in memory: this suite must never
 * write to a real database.
 */
class RoleControllerRulesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $connection = config('database.default');
        if (config("database.connections.$connection.driver") !== 'sqlite'
            || config("database.connections.$connection.database") !== ':memory:') {
            $this->markTestSkipped('Run with DB_CONNECTION=sqlite DB_DATABASE=:memory:.');
        }

        Schema::create('roles', function ($t) {
            $t->id();
            $t->bigInteger('organization_id')->nullable();
            $t->string('role_name')->unique();
            $t->text('description')->nullable();
            $t->unsignedBigInteger('base_role_id')->nullable();
            $t->longText('permissions')->nullable();
            $t->unsignedTinyInteger('permissions_version')->default(0);
            $t->unsignedBigInteger('created_by_user_id')->nullable();
            $t->unsignedBigInteger('updated_by_user_id')->nullable();
            $t->timestamps();
        });
        Schema::create('users', function ($t) {
            $t->id();
            $t->string('username')->nullable();
            $t->bigInteger('organization_id')->nullable();
            $t->unsignedBigInteger('role_id')->nullable();
            $t->timestamps();
        });

        foreach ([1 => 'Administrator', 2 => 'Technician', 3 => 'Customer', 4 => 'Agent',
                  5 => 'InventoryStaff', 6 => 'Osp', 7 => 'SuperAdmin', 8 => 'HeadTech'] as $id => $name) {
            DB::table('roles')->insert(['id' => $id, 'role_name' => $name]);
        }
    }

    private function actingAsAdmin(?int $orgId = 10): User
    {
        $user = new User();
        $user->id = 99;
        $user->role_id = Role::SUPER_ADMIN;
        $user->organization_id = $orgId;
        $this->actingAs($user);

        return $user;
    }

    private function controller(): RoleController
    {
        return new RoleController();
    }

    public function test_create_stamps_the_version_and_the_organisation(): void
    {
        $this->actingAsAdmin(10);

        $response = $this->controller()->store(Request::create('/api/roles', 'POST', [
            'role_name' => 'Billing Supervisor',
            'base_role_id' => Role::ADMINISTRATOR,
            'permissions' => ['plan-list', 'plan-list.create'],
            'permissions_version' => 0,
            'organization_id' => 55,
        ]));

        $this->assertSame(201, $response->getStatusCode());
        $role = Role::where('role_name', 'Billing Supervisor')->first();
        $this->assertSame(Permissions::CURRENT_VERSION, $role->permissions_version);
        $this->assertSame(10, (int) $role->organization_id);
        $this->assertSame(Role::ADMINISTRATOR, $role->base_role_id);
    }

    public function test_create_rejects_a_duplicate_name_an_unknown_key_and_a_custom_base(): void
    {
        $this->actingAsAdmin();

        $this->assertSame(422, $this->controller()->store(Request::create('/api/roles', 'POST', ['role_name' => 'Technician']))->getStatusCode());
        $this->assertSame(422, $this->controller()->store(Request::create('/api/roles', 'POST', ['role_name' => 'X', 'permissions' => ['job-order.typo']]))->getStatusCode());
        $this->assertSame(422, $this->controller()->store(Request::create('/api/roles', 'POST', ['role_name' => 'Y', 'base_role_id' => 9]))->getStatusCode());

        // Every key the legacy GOWISER modal offered is still accepted.
        $legacy = ['dashboard', 'monthly-payables', 'prepaid-override', 'team-agent', 'organization', 'roles',
                   'customer.prepaid-override', 'staggered-payment.add', 'job-order.tech-edit'];
        $this->assertSame(201, $this->controller()->store(Request::create('/api/roles', 'POST', ['role_name' => 'Z', 'permissions' => $legacy]))->getStatusCode());
    }

    public function test_system_roles_cannot_be_edited_or_deleted(): void
    {
        $this->actingAsAdmin();

        $update = $this->controller()->update(Request::create('/api/roles/2', 'PUT', ['role_name' => 'Tech']), 2);
        $this->assertSame(403, $update->getStatusCode());
        $this->assertSame('System roles cannot be edited', $update->getData(true)['message']);

        $delete = $this->controller()->destroy(8);
        $this->assertSame(403, $delete->getStatusCode());
        $this->assertSame('System roles cannot be deleted', $delete->getData(true)['message']);
    }

    public function test_update_is_org_scoped_restamps_the_version_and_ignores_organisation(): void
    {
        $this->actingAsAdmin(10);
        DB::table('roles')->insert(['id' => 20, 'role_name' => 'Ours', 'organization_id' => 10, 'permissions' => '["plan-list"]']);
        DB::table('roles')->insert(['id' => 21, 'role_name' => 'Theirs', 'organization_id' => 11]);

        $this->assertSame(403, $this->controller()->update(Request::create('/api/roles/21', 'PUT', ['description' => 'x']), 21)->getStatusCode());
        $this->assertSame(403, $this->controller()->destroy(21)->getStatusCode());

        $ok = $this->controller()->update(Request::create('/api/roles/20', 'PUT', [
            'permissions' => ['plan-list'], 'organization_id' => 11, 'permissions_version' => 0,
        ]), 20);
        $this->assertSame(200, $ok->getStatusCode());

        $role = Role::find(20);
        $this->assertSame(10, (int) $role->organization_id);
        $this->assertSame(Permissions::CURRENT_VERSION, $role->permissions_version);
    }

    public function test_a_role_with_users_cannot_be_deleted(): void
    {
        $this->actingAsAdmin(null);
        DB::table('roles')->insert(['id' => 30, 'role_name' => 'Busy']);
        DB::table('users')->insert(['id' => 1, 'role_id' => 30]);

        $response = $this->controller()->destroy(30);
        $this->assertSame(400, $response->getStatusCode());
        $this->assertSame('Cannot delete role that has assigned users', $response->getData(true)['message']);

        DB::table('roles')->insert(['id' => 31, 'role_name' => 'Idle']);
        $this->assertSame(200, $this->controller()->destroy(31)->getStatusCode());
    }

    /**
     * The fields the current clients read are still there, and a legacy row's
     * effective_permissions shows the buttons it is actually granted.
     */
    public function test_index_keeps_its_fields_and_adds_effective_permissions(): void
    {
        $this->actingAsAdmin(10);
        DB::table('roles')->insert(['id' => 40, 'role_name' => 'Legacy', 'organization_id' => 10, 'permissions' => '["plan-list"]']);
        DB::table('roles')->insert(['id' => 41, 'role_name' => 'Elsewhere', 'organization_id' => 12]);

        $data = collect($this->controller()->index()->getData(true)['data'])->keyBy('id');

        $this->assertTrue($data->has(1) && $data->has(8) && $data->has(40));
        $this->assertFalse($data->has(41), 'Another organisation\'s custom role was listed.');

        $legacy = $data[40];
        foreach (['id', 'role_name', 'description', 'permissions', 'organization_id', 'updated_at', 'users_count', 'base_role_id', 'effective_permissions'] as $field) {
            $this->assertArrayHasKey($field, $legacy);
        }
        $this->assertSame(['plan-list'], $legacy['permissions']);
        $this->assertContains('plan-list.delete', $legacy['effective_permissions']);
    }

    // ── Legacy rows (audit regressions) ─────────────────────────────────────

    /**
     * effective_permissions carries catalog keys only (retired keys expanded,
     * unknown ids dropped), and handing a legacy row's stored unknown keys back
     * on save is not a 422 — they are dropped. A NEW unknown key still is.
     */
    public function test_a_legacy_row_with_unknown_and_retired_keys_stays_editable(): void
    {
        $this->actingAsAdmin(10);
        DB::table('roles')->insert(['id' => 50, 'role_name' => 'Old', 'organization_id' => 10,
            'permissions' => '["billing","agent-group","ports.manage","job-order","job-order.approve"]']);

        $data = collect($this->controller()->index()->getData(true)['data'])->keyBy('id');
        $effective = $data[50]['effective_permissions'];
        $this->assertNotContains('billing', $effective);
        $this->assertNotContains('agent-group', $effective);
        $this->assertNotContains('ports.manage', $effective);
        $this->assertContains('ports.create', $effective);
        $this->assertContains('job-order.approve', $effective);
        foreach ($effective as $key) {
            $this->assertContains($key, Permissions::all());
        }

        // The stored list sent straight back, as an older client would.
        $ok = $this->controller()->update(Request::create('/api/roles/50', 'PUT', [
            'role_name' => 'Old',
            'permissions' => ['billing', 'agent-group', 'ports.manage', 'job-order', 'job-order.approve'],
        ]), 50);
        $this->assertSame(200, $ok->getStatusCode(), json_encode($ok->getData(true)));
        $stored = Role::find(50)->permissions;
        $this->assertNotContains('billing', $stored);
        $this->assertNotContains('ports.manage', $stored);
        $this->assertContains('ports.edit', $stored);
        $this->assertContains('job-order.approve', $stored);

        // A key that is neither in the catalog nor already stored is a typo.
        $bad = $this->controller()->update(Request::create('/api/roles/50', 'PUT', [
            'permissions' => ['job-order', 'job-order.aprove'],
        ]), 50);
        $this->assertSame(422, $bad->getStatusCode());
    }

    /** store and update answer with effective_permissions, like index and show. */
    public function test_store_and_update_return_effective_permissions(): void
    {
        $this->actingAsAdmin(10);

        $created = $this->controller()->store(Request::create('/api/roles', 'POST', [
            'role_name' => 'Planner', 'permissions' => ['plan-list.create'],
        ]))->getData(true)['data'];
        $this->assertArrayHasKey('effective_permissions', $created);
        $this->assertContains('plan-list', $created['effective_permissions']);

        $updated = $this->controller()->update(Request::create('/api/roles/' . $created['id'], 'PUT', [
            'permissions' => ['promo-list.edit'],
        ]), $created['id'])->getData(true)['data'];
        $this->assertArrayHasKey('effective_permissions', $updated);
        $this->assertSame(['promo-list.edit', 'promo-list'], $updated['effective_permissions']);
    }

    /**
     * A save that does not send `permissions` (a rename) still stamps the
     * version, so the name stops meaning anything to AgentAccess, but writes
     * what the legacy row effectively held, so nothing is lost.
     */
    public function test_a_rename_of_a_legacy_row_keeps_its_grandfathered_actions(): void
    {
        $this->actingAsAdmin(10);
        DB::table('roles')->insert(['id' => 51, 'role_name' => 'Planners', 'organization_id' => 10, 'permissions' => '["plan-list"]']);
        $before = Permissions::roleKeys(Role::find(51));

        $ok = $this->controller()->update(Request::create('/api/roles/51', 'PUT', ['role_name' => 'Administrator Two']), 51);
        $this->assertSame(200, $ok->getStatusCode());

        $role = Role::find(51);
        $this->assertSame(Permissions::CURRENT_VERSION, $role->permissions_version);
        $this->assertFalse(Permissions::isLegacyRole($role));
        $this->assertEqualsCanonicalizing($before, Permissions::roleKeys($role));
        $this->assertContains('plan-list.delete', $role->permissions);
    }

    /** Legacy duplicate names do not block editing the role's other fields. */
    public function test_an_unchanged_duplicate_name_is_not_a_422(): void
    {
        $this->actingAsAdmin(null);
        Schema::drop('roles');
        Schema::create('roles', function ($t) {
            $t->id();
            $t->bigInteger('organization_id')->nullable();
            $t->string('role_name');
            $t->text('description')->nullable();
            $t->unsignedBigInteger('base_role_id')->nullable();
            $t->longText('permissions')->nullable();
            $t->unsignedTinyInteger('permissions_version')->default(0);
            $t->unsignedBigInteger('created_by_user_id')->nullable();
            $t->unsignedBigInteger('updated_by_user_id')->nullable();
            $t->timestamps();
        });
        DB::table('roles')->insert(['id' => 60, 'role_name' => 'Billing']);
        DB::table('roles')->insert(['id' => 61, 'role_name' => 'Billing']);

        $ok = $this->controller()->update(Request::create('/api/roles/61', 'PUT', [
            'role_name' => 'Billing', 'description' => 'desk', 'permissions' => ['invoice'],
        ]), 61);
        $this->assertSame(200, $ok->getStatusCode(), json_encode($ok->getData(true)));

        // Changing TO a name another row holds is still refused.
        DB::table('roles')->insert(['id' => 62, 'role_name' => 'Cashier']);
        $this->assertSame(422, $this->controller()->update(Request::create('/api/roles/62', 'PUT', ['role_name' => 'Billing']), 62)->getStatusCode());
    }

    /** The organisation ids are compared as numbers, not by PHP type. */
    public function test_org_scope_compares_ids_as_numbers(): void
    {
        $user = $this->actingAsAdmin(10);
        $user->organization_id = '10';
        DB::table('roles')->insert(['id' => 70, 'role_name' => 'Ours', 'organization_id' => 10]);

        $this->assertSame(200, $this->controller()->update(Request::create('/api/roles/70', 'PUT', ['description' => 'x']), 70)->getStatusCode());
        $this->assertSame(200, $this->controller()->destroy(70)->getStatusCode());
    }

    /** Both halves of an exclusive pair: logged, not refused, and it resolves. */
    public function test_both_halves_of_an_exclusive_pair_are_logged_not_refused(): void
    {
        $this->actingAsAdmin(10);
        Log::spy();

        $response = $this->controller()->store(Request::create('/api/roles', 'POST', [
            'role_name' => 'Both', 'permissions' => ['job-order.tech-edit', 'job-order.admin-edit'],
        ]));
        $this->assertSame(201, $response->getStatusCode());
        $keys = Permissions::roleKeys(Role::where('role_name', 'Both')->first());
        $this->assertContains('job-order.tech-edit', $keys);
        $this->assertContains('job-order.admin-edit', $keys);
        Log::shouldHaveReceived('warning')
            ->with('Role saved holding both halves of an exclusive pair', \Mockery::any());
    }

    /** Odd stored values read as "no such key" rather than throwing. */
    public function test_malformed_stored_permissions_do_not_throw(): void
    {
        DB::table('roles')->insert(['id' => 80, 'role_name' => 'Odd', 'permissions' => '[["x"], null, true, 5, " job-order "]']);
        DB::table('roles')->insert(['id' => 81, 'role_name' => 'Garbage', 'permissions' => '{not json']);

        $this->assertSame(['job-order'], Permissions::roleKeys(Role::find(80)));
        $this->assertSame([], Permissions::roleKeys(Role::find(81)));

        $user = new User();
        $user->role_id = 80;
        $this->assertSame(['job-order'], Permissions::forUser($user));
        $this->assertFalse($user->relationLoaded('role'), 'Resolving permissions attached the role to the user.');

        // A user whose role row is gone, or who has none.
        $user->role_id = 999;
        $this->assertSame([], Permissions::forUser($user));
        $this->assertNull(Permissions::homeFor($user));
        $user->role_id = null;
        $this->assertSame([], Permissions::forUser($user));
    }
}
