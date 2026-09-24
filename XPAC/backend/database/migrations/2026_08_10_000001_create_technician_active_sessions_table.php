<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The one live login a technician is allowed to hold, keyed by user_id.
     *
     * This table exists because there is nothing else to ask. Auth here is session-based
     * (SESSION_DRIVER=file), so there is no `sessions` table to query, and the login route
     * hands out a placeholder token string rather than a Sanctum personal access token, so
     * `personal_access_tokens` is empty too. Without a record of which session id belongs to
     * which technician there is no way to answer "is this account already signed in somewhere
     * else?", and no way to reach into the other device and end it.
     *
     * Rows are created on technician login and removed on logout or takeover — a row present
     * means a live login, so nothing has to be reconciled against an expiry clock.
     */
    public function up(): void
    {
        if (Schema::hasTable('technician_active_sessions')) {
            return;
        }

        Schema::create('technician_active_sessions', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            // Nullable: a login that arrived without a started session still needs a row, and
            // it is then treated as "somewhere else" for every later attempt.
            $table->string('session_id', 191)->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->dateTime('logged_in_at')->nullable();
            $table->timestamps();

            // Exactly one active session per technician. This is the feature's whole invariant,
            // so it is enforced by the index and not just by the code that writes here.
            $table->unique('user_id');
            $table->index('session_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('technician_active_sessions');
    }
};
