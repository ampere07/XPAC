<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('invoices', 'vat')) {
            return;
        }
        Schema::table('invoices', function (Blueprint $table) {
            $table->decimal('vat', 10, 2)->nullable();
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('invoices', 'vat')) {
            return;
        }
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn('vat');
        });
    }
};
