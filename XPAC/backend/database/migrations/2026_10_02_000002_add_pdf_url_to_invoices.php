<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * invoices.pdf_url: the Google Drive link of the paid invoice PDF (PaidInvoicePdfService).
 * Guarded, because the column was added on live by hand before this migration existed.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('invoices')) {
            return;
        }

        Schema::table('invoices', function (Blueprint $table) {
            if (!Schema::hasColumn('invoices', 'pdf_url')) {
                $table->string('pdf_url', 255)->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('invoices')) {
            return;
        }

        Schema::table('invoices', function (Blueprint $table) {
            if (Schema::hasColumn('invoices', 'pdf_url')) {
                $table->dropColumn('pdf_url');
            }
        });
    }
};
