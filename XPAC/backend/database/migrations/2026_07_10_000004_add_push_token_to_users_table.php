<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds `push_token` to users for mobile push notifications (added directly to
 * the DB ahead of this migration). Guarded so it is idempotent and safe on
 * deployments where the column already exists.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        if (!Schema::hasColumn('users', 'push_token')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('push_token')->nullable()->after('active');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'push_token')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('push_token');
            });
        }
    }
};
