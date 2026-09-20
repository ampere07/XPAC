<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Support\Permissions;
use Tests\TestCase;

/**
 * Hybrid roles: a custom role that starts from one of the eight seeded roles.
 *
 * The behaviour worth pinning down is that inheritance is resolved on read
 * rather than copied at save time — a hybrid must follow its base role as that
 * role changes, which is the whole reason it exists — and that a base can only
 * ever be one of the eight.
 *
 * No database: every role here is an unsaved model and every user a stand-in
 * with the `role` relation already set, which is the shape Permissions reads.
 */
class HybridRolePermissionsTest extends TestCase
{
    /** A role row that is not one of the seeded eight. */
    private function customRole(?int $baseRoleId, array $permissions = []): Role
    {
        $role = new Role();
        $role->base_role_id = $baseRoleId;
        $role->permissions = $permissions;

        return $role;
    }

    /** A user holding the given custom role, with the relation pre-loaded. */
    private function userWith(Role $role, int $roleId = 9): object
    {
        return new class($role, $roleId) {
            public $id = 1;
            public $role_id;
            public $role;

            public function __construct($role, $roleId)
            {
                $this->role = $role;
                $this->role_id = $roleId;
            }
        };
    }

    /** A standalone custom role still holds exactly what it was given. */
    public function test_a_role_without_a_base_holds_only_its_own_keys(): void
    {
        $keys = Permissions::roleKeys($this->customRole(null, ['inventory']));

        $this->assertSame(['inventory'], $keys);
    }

    /** The point of the feature: base role's keys, plus the extras. */
    public function test_a_hybrid_holds_its_base_role_keys_and_its_own(): void
    {
        $role = $this->customRole(Role::TECHNICIAN, ['inventory']);
        $keys = Permissions::roleKeys($role);

        foreach (Permissions::ROLE_PERMISSIONS[Role::TECHNICIAN] as $inherited) {
            $this->assertContains($inherited, $keys, "A technician hybrid is missing '$inherited'.");
        }

        $this->assertContains('inventory', $keys);
    }

    /**
     * Inheritance is live, not a copy.
     *
     * `permissions` holds the extras alone, so a key removed from the base role
     * leaves the hybrid rather than lingering in a snapshot.
     */
    public function test_a_hybrid_does_not_store_its_inherited_keys(): void
    {
        $role = $this->customRole(Role::TECHNICIAN, ['inventory']);

        $this->assertSame(['inventory'], $role->permissions);
    }

    /** A SuperAdmin base is the wildcard, and subsumes anything else ticked. */
    public function test_a_hybrid_on_super_admin_holds_the_wildcard(): void
    {
        $keys = Permissions::roleKeys($this->customRole(Role::SUPER_ADMIN, ['inventory']));

        $this->assertSame([Permissions::WILDCARD], $keys);
    }

    /** Only the seeded eight can be inherited; anything else grants nothing. */
    public function test_a_base_that_is_not_a_seeded_role_is_ignored(): void
    {
        $this->assertSame([], Permissions::inheritedKeys(99));
        $this->assertSame([], Permissions::inheritedKeys(null));
        $this->assertSame(['inventory'], Permissions::roleKeys($this->customRole(99, ['inventory'])));
    }

    /** The keys reach the user, with the parent page of every sub action. */
    public function test_a_user_on_a_hybrid_holds_the_merged_keys(): void
    {
        $user = $this->userWith($this->customRole(Role::TECHNICIAN, ['inventory']));

        $this->assertTrue(Permissions::allows($user, 'inventory'), 'The extra key was not granted.');
        $this->assertTrue(Permissions::allows($user, 'job-order'), 'The inherited page was not granted.');
        $this->assertTrue(Permissions::allows($user, 'job-order.tech-edit'), 'The inherited sub action was not granted.');
        $this->assertFalse(Permissions::allows($user, 'customer'), 'A key from neither half was granted.');
    }

    /** A hybrid lands where its base role lands. */
    public function test_a_hybrid_lands_on_its_base_roles_home(): void
    {
        $user = $this->userWith($this->customRole(Role::TECHNICIAN));

        $this->assertSame(Permissions::ROLE_HOME[Role::TECHNICIAN], Permissions::homeFor($user));
    }

    /** A standalone custom role has no home of its own; the client picks one. */
    public function test_a_standalone_custom_role_has_no_home(): void
    {
        $this->assertNull(Permissions::homeFor($this->userWith($this->customRole(null, ['inventory']))));
    }

    /** A seeded role is never treated as a hybrid, whatever its columns say. */
    public function test_a_seeded_role_ignores_a_base(): void
    {
        $user = $this->userWith($this->customRole(Role::SUPER_ADMIN), Role::TECHNICIAN);

        $this->assertNull(Permissions::baseRoleIdFor($user));
        $this->assertFalse(
            Permissions::allows($user, 'settings'),
            'A base recorded against a seeded role widened it.'
        );
    }
}
