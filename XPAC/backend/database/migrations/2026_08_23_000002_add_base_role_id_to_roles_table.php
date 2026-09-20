<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Hybrid roles: a custom role that starts from one of the eight seeded roles.
 *
 * Role Management could previously build a role only from nothing — every page
 * a "Technician who also sees Inventory" needed had to be ticked by hand, and
 * the copy then froze: a key added to Role::TECHNICIAN in
 * App\Support\Permissions never reached the roles that were meant to be
 * technicians. In practice that meant either handing out Administrator, or
 * maintaining near-duplicates of the seeded lists by hand.
 *
 * `base_role_id` is the link that fixes it. NULL is the old behaviour — a
 * standalone custom role carrying its whole list in `permissions`. Set to one
 * of the locked ids (1-8) it means "everything that role holds, resolved live
 * from Permissions::ROLE_PERMISSIONS, plus whatever this role's own
 * `permissions` adds". The inherited half is never copied into the column, so
 * changing a seeded role updates every hybrid built on it.
 *
 * No foreign key. The seeded roles are constants in code (Role::LOCKED_ROLE_IDS)
 * rather than rows this migration can depend on existing in every deployment,
 * and the value is validated against that list on write; a FK would add nothing
 * a bad id could not already be caught by, and would fail the migration on a
 * database seeded in a different order.
 *
 * Guarded so it is safe to run twice, and on a deployment where the column was
 * added by hand.
 */
return new class extends Migration
{
    private const TABLE = 'roles';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE) || Schema::hasColumn(self::TABLE, 'base_role_id')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            // NULL = a standalone custom role, which is every existing row.
            $table->unsignedBigInteger('base_role_id')->nullable()->after('description');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE) || !Schema::hasColumn(self::TABLE, 'base_role_id')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->dropColumn('base_role_id');
        });
    }
};
