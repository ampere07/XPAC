<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            if (!Schema::hasColumn('invoices', 'pro_rate')) {
                // Reconnection pro-rate amount included in invoice_balance / total_amount.
                // Stored separately for transparency on the billing document.
                $table->decimal('pro_rate', 10, 2)->default(0)->after('others_and_basic_charges');
            }
            if (!Schema::hasColumn('invoices', 'pro_rate_start')) {
                // Reconnection date the pro-rate coverage period begins on.
                $table->date('pro_rate_start')->nullable()->after('pro_rate');
            }
        });

        Schema::table('statement_of_accounts', function (Blueprint $table) {
            if (!Schema::hasColumn('statement_of_accounts', 'pro_rate')) {
                $table->decimal('pro_rate', 10, 2)->default(0)->after('others_and_basic_charges');
            }
            if (!Schema::hasColumn('statement_of_accounts', 'pro_rate_start')) {
                $table->date('pro_rate_start')->nullable()->after('pro_rate');
            }
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            foreach (['pro_rate', 'pro_rate_start'] as $column) {
                if (Schema::hasColumn('invoices', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        Schema::table('statement_of_accounts', function (Blueprint $table) {
            foreach (['pro_rate', 'pro_rate_start'] as $column) {
                if (Schema::hasColumn('statement_of_accounts', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
