<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reconnection_logs', function (Blueprint $table) {
            if (!Schema::hasColumn('reconnection_logs', 'pro_rate_applied')) {
                // Flag set once a reconnection has been billed a pro-rate so it is
                // never double-charged on subsequent billing cycles.
                $table->boolean('pro_rate_applied')->default(false)->after('remarks');
            }
            if (!Schema::hasColumn('reconnection_logs', 'billing_status')) {
                // Human-readable status: null (not yet evaluated) -> 'Billed'.
                $table->string('billing_status')->nullable()->after('pro_rate_applied');
            }
            if (!Schema::hasColumn('reconnection_logs', 'pro_rate_invoice_id')) {
                // Invoice the reconnection pro-rate was attached to (for traceability).
                $table->string('pro_rate_invoice_id')->nullable()->after('billing_status');
            }
            if (!Schema::hasColumn('reconnection_logs', 'pro_rate_billed_at')) {
                $table->timestamp('pro_rate_billed_at')->nullable()->after('pro_rate_invoice_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('reconnection_logs', function (Blueprint $table) {
            foreach (['pro_rate_applied', 'billing_status', 'pro_rate_invoice_id', 'pro_rate_billed_at'] as $column) {
                if (Schema::hasColumn('reconnection_logs', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
