<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where an invoice's PDF actually lives once it is on Google Drive.
 *
 * `pdf_path` stays: it is still the path the renderer would use, and it is what
 * tells a later run whether the file on record was produced by the current
 * layout. What changes is that nothing is kept at that path any more — the
 * rendered file is uploaded and then removed, so `pdf_drive_url` is the only
 * place the document can be read from.
 *
 * Nullable because every invoice issued before this column existed has no Drive
 * copy. Those are re-rendered and uploaded the first time somebody opens them,
 * which is the same path a layout change already took.
 *
 * `pdf_drive_id` is kept beside the URL so a file can be replaced or deleted
 * later without parsing an id back out of a display link.
 *
 * Guarded so the migration is safe to run twice.
 */
return new class extends Migration
{
    private const TABLE = 'agent_invoices';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            if (!Schema::hasColumn(self::TABLE, 'pdf_drive_url')) {
                $table->string('pdf_drive_url', 500)->nullable()->after('pdf_path');
            }

            if (!Schema::hasColumn(self::TABLE, 'pdf_drive_id')) {
                $table->string('pdf_drive_id', 191)->nullable()->after('pdf_drive_url');
            }

            if (!Schema::hasColumn(self::TABLE, 'pdf_uploaded_at')) {
                $table->timestamp('pdf_uploaded_at')->nullable()->after('pdf_drive_id');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            foreach (['pdf_uploaded_at', 'pdf_drive_id', 'pdf_drive_url'] as $column) {
                if (Schema::hasColumn(self::TABLE, $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
