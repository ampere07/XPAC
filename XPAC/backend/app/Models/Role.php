<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Role extends Model
{
    use HasFactory;

    protected $primaryKey = 'id';
    protected $table = 'roles';

    /**
     * Seeded role IDs (see RolesSeeder). Named here so authorization checks read
     * as roles rather than as bare numbers scattered across controllers.
     *
     * IDs 1-8 are the "locked" system roles: they are never editable from Role
     * Management and their access is described by App\Support\Permissions. Any
     * role above 8 is a custom role and carries its own `permissions` array.
     */
    public const ADMINISTRATOR   = 1;
    public const TECHNICIAN      = 2;
    public const CUSTOMER        = 3;
    public const AGENT           = 4;
    public const INVENTORY_STAFF = 5;
    public const OSP             = 6;
    public const SUPER_ADMIN     = 7;
    public const HEAD_TECH       = 8;

    /** The seeded roles, in ID order. Anything outside this list is a custom role. */
    public const LOCKED_ROLE_IDS = [
        self::ADMINISTRATOR,
        self::TECHNICIAN,
        self::CUSTOMER,
        self::AGENT,
        self::INVENTORY_STAFF,
        self::OSP,
        self::SUPER_ADMIN,
        self::HEAD_TECH,
    ];

    /**
     * Slugs the `role` middleware accepts, mapped onto the IDs above.
     *
     * Every seeded role is listed so `role:technician` and friends work rather
     * than silently matching nothing; the middleware also takes a numeric ID
     * directly. Spellings that appear in the wild (`super_admin` vs
     * `superadmin`, `head_tech` vs `headtech`) both resolve.
     */
    private const SLUGS = [
        'administrator'   => self::ADMINISTRATOR,
        'admin'           => self::ADMINISTRATOR,
        'technician'      => self::TECHNICIAN,
        'customer'        => self::CUSTOMER,
        'agent'           => self::AGENT,
        'inventorystaff'  => self::INVENTORY_STAFF,
        'inventory_staff' => self::INVENTORY_STAFF,
        'osp'             => self::OSP,
        'super_admin'     => self::SUPER_ADMIN,
        'superadmin'      => self::SUPER_ADMIN,
        'headtech'        => self::HEAD_TECH,
        'head_tech'       => self::HEAD_TECH,
    ];

    /** Is this one of the seeded, non-editable roles? */
    public static function isLocked(int|string|null $roleId): bool
    {
        return in_array((int) $roleId, self::LOCKED_ROLE_IDS, true);
    }

    /**
     * Resolve a middleware argument — a slug like "super_admin" or a bare ID
     * like "7" — to a role ID. Returns null when it matches neither.
     */
    public static function idForSlug(string $role): ?int
    {
        $key = strtolower(trim($role));

        if ($key === '') {
            return null;
        }

        if (isset(self::SLUGS[$key])) {
            return self::SLUGS[$key];
        }

        return ctype_digit($key) ? (int) $key : null;
    }

    /**
     * How each seeded role is written in Role Management's "Base role" picker.
     *
     * Kept here rather than read back from `roles.role_name` so the picker reads
     * the same on a deployment whose seeded rows were renamed, and so the eight
     * are always offered in one fixed order.
     */
    public const LOCKED_ROLE_NAMES = [
        self::SUPER_ADMIN     => 'SuperAdmin',
        self::ADMINISTRATOR   => 'Administrator',
        self::HEAD_TECH       => 'Head Technician',
        self::TECHNICIAN      => 'Technician',
        self::OSP             => 'OSP',
        self::INVENTORY_STAFF => 'Inventory Staff',
        self::AGENT           => 'Agent',
        self::CUSTOMER        => 'Customer',
    ];

    /**
     * The seeded role this custom role builds on, or null.
     *
     * A "hybrid" role holds everything its base role holds — resolved live from
     * App\Support\Permissions, never copied into `permissions` — plus the extra
     * keys ticked in the Role modal. Null is a standalone custom role, which is
     * what every role was before hybrids existed.
     *
     * A locked role is never itself a hybrid: its access is the table in
     * Permissions, so a base recorded against one is ignored rather than
     * quietly widening a seeded role.
     */
    public function baseRoleId(): ?int
    {
        if (self::isLocked($this->id)) {
            return null;
        }

        $base = (int) ($this->base_role_id ?? 0);

        return self::isLocked($base) ? $base : null;
    }

    /** Is this a custom role built on top of a seeded one? */
    public function isHybrid(): bool
    {
        return $this->baseRoleId() !== null;
    }

    protected $fillable = [
        'role_name',
        'description',
        // The seeded role a hybrid custom role inherits from. See baseRoleId().
        'base_role_id',
        'permissions',
        // Which generation of the permission model this row was saved under.
        // See the add_permissions_version_to_roles_table migration.
        'permissions_version',
        'created_by_user_id',
        'updated_by_user_id',
        'organization_id'
    ];

    protected $casts = [
        'permissions' => 'array',
        'base_role_id' => 'integer',
        'permissions_version' => 'integer',
    ];

    public function users()
    {
        return $this->hasMany(User::class, 'role_id', 'id');
    }
}
