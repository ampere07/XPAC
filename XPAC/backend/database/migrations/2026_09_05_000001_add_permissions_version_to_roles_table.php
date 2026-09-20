<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which generation of the permission model a custom role was saved under.
 *
 * Until now a page key carried its buttons with it: holding "plan-list" meant
 * Add, Edit and Delete on the plan list, because those controls had no keys of
 * their own. They do now — "plan-list.create" and friends — and reading an
 * existing role strictly would revoke buttons from every role that has always
 * had them, on deploy, with nothing on screen to explain it.
 *
 * 0 — the row predates the per-action keys. App\Support\Permissions implies the
 *     standard verbs for any page in its GRANDFATHERED_PAGES list that the role
 *     holds, so nothing changes for it.
 * 1 — the row was saved from Role Management with the per-action checkboxes on
 *     screen, so its stored list is exactly what an administrator chose and is
 *     read as written.
 *
 * Existing rows default to 0. RoleController stamps 1 on every create and
 * update, so a role leaves the grandfathered set the first time somebody saves
 * it — which is also the first moment anyone has seen the new checkboxes.
 *
 * Guarded so it is safe to run twice, and on a deployment where the column was
 * added by hand.
 */
return new class extends Migration
{
    private const TABLE = 'roles';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE) || Schema::hasColumn(self::TABLE, 'permissions_version')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            // 0 = grandfathered, which is every row that already exists.
            $table->unsignedTinyInteger('permissions_version')->default(0)->after('permissions');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE) || !Schema::hasColumn(self::TABLE, 'permissions_version')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->dropColumn('permissions_version');
        });
    }
};
