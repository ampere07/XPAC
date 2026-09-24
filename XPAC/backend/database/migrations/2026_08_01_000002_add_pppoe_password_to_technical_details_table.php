<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Gives the PPPoE password a home next to the username it belongs to.
     *
     * It used to live only on job_orders, where the technician sets it when completing the
     * install, so every reader had to reach across to the account's newest job order to find
     * it. technical_details is the account's current-state record — username, LCP/NAP, port,
     * VLAN — and the password belongs with it.
     *
     * Nullable and not backfilled: accounts installed before this column exists still carry
     * their password only on the job order, so readers keep the job-order lookup as a fallback.
     */
    public function up(): void
    {
        Schema::table('technical_details', function (Blueprint $table) {
            if (!Schema::hasColumn('technical_details', 'pppoe_password')) {
                $table->string('pppoe_password')->nullable()->after('username');
            }
        });
    }

    public function down(): void
    {
        Schema::table('technical_details', function (Blueprint $table) {
            if (Schema::hasColumn('technical_details', 'pppoe_password')) {
                $table->dropColumn('pppoe_password');
            }
        });
    }
};
