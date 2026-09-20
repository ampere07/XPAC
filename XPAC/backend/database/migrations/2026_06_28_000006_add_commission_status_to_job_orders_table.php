<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds commission_status to job_orders (used to mark job orders as commission Paid).
 * Guarded for idempotency.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('job_orders', function (Blueprint $table) {
            if (!Schema::hasColumn('job_orders', 'commission_status')) {
                $table->string('commission_status', 100)->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('job_orders', function (Blueprint $table) {
            if (Schema::hasColumn('job_orders', 'commission_status')) {
                $table->dropColumn('commission_status');
            }
        });
    }
};
