<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the remember_token column Laravel's "remember me" needs.
 *
 * The User model already lists remember_token in $hidden, but the column was never created,
 * so Auth::login($user, true) would fail on the UPDATE inside cycleRememberToken(). Without
 * it there is no way to re-establish a session after the 2-hour session lifetime lapses, which
 * is why users were being dropped back to the login screen after a few hours.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('users', 'remember_token')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            // rememberToken() is varchar(100) nullable — the standard Laravel shape, which is
            // what Authenticatable::getRememberTokenName() and the session guard expect.
            $table->rememberToken();
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('users', 'remember_token')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('remember_token');
        });
    }
};
