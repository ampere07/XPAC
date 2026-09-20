<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bring `reports` up to the shape the ported reporting engine expects, and add the
 * `report_dispatches` ledger it depends on for exactly-once delivery.
 *
 * Measured 2026-08-22, the live `reports` table on both the AKM and ATSS deployments
 * lacked the weekday/month scheduling fields, the per-report enable switch, and any
 * record of what was last sent - and neither had `report_dispatches` at all, so their
 * scheduled sends had no exactly-once protection. Every column is added only if absent,
 * and this is safe to run against a deployment that already has them. The migration is
 * written against the CONTRACT rather than against an assumed shape: these schemas were
 * built from SQL dumps and hand-edited, so the same table genuinely differs between
 * deployments and a blind `$table->string(...)` would fail on the second one.
 *
 * `report_dispatches.occurrence_key` is the load-bearing part. UNIQUE
 * (report_id, occurrence_key) is what makes a scheduled send idempotent: two cron runs
 * racing the same minute both try to insert the same key, one loses on the index, and
 * the client receives one email instead of two.
 */
return new class extends Migration
{
    /** column => closure adding it, applied only when the column is absent. */
    private const REPORT_COLUMNS = [
        'report_weekday',
        'report_month',
        'is_active',
        'last_dispatched_at',
        'last_period_end',
    ];

    public function up(): void
    {
        if (Schema::hasTable('reports')) {
            $this->extendReportsTable();
        }

        if (!Schema::hasTable('report_dispatches')) {
            $this->createDispatchLedger();

            return;
        }

        $this->ensureOccurrenceUnique();
    }

    public function down(): void
    {
        Schema::dropIfExists('report_dispatches');

        if (!Schema::hasTable('reports')) {
            return;
        }

        $present = array_values(array_filter(
            self::REPORT_COLUMNS,
            static fn (string $column): bool => Schema::hasColumn('reports', $column)
        ));

        if ($present !== []) {
            Schema::table('reports', function (Blueprint $table) use ($present) {
                $table->dropColumn($present);
            });
        }
    }

    private function extendReportsTable(): void
    {
        Schema::table('reports', function (Blueprint $table) {
            // Weekly schedules store the weekday name; quarterly and yearly store the
            // month. Both are nullable because most schedules need neither.
            if (!Schema::hasColumn('reports', 'report_weekday')) {
                $table->string('report_weekday')->nullable();
            }

            if (!Schema::hasColumn('reports', 'report_month')) {
                $table->tinyInteger('report_month')->nullable();
            }

            // Per-report switch, distinct from the estate-wide auto-send master switch
            // in system_config. Defaults to enabled so reports that already existed
            // before this column keep sending exactly as they did.
            if (!Schema::hasColumn('reports', 'is_active')) {
                $table->boolean('is_active')->default(true);
            }

            if (!Schema::hasColumn('reports', 'last_dispatched_at')) {
                $table->dateTime('last_dispatched_at')->nullable();
            }

            // The end date of the last successfully sent automatic period. Without it
            // the scheduler re-sends the report's original date_range forever instead
            // of advancing - see Report::nextAutomaticWindow().
            if (!Schema::hasColumn('reports', 'last_period_end')) {
                $table->date('last_period_end')->nullable();
            }
        });
    }

    private function createDispatchLedger(): void
    {
        Schema::create('report_dispatches', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('report_id');
            /** Stable identity for one scheduled occurrence, e.g. "2026-08-22_17:40". */
            $table->string('occurrence_key');
            $table->dateTime('scheduled_for')->nullable();
            $table->dateTime('dispatched_at')->nullable();
            $table->string('status')->nullable();
            $table->smallInteger('recipient_count')->nullable();
            $table->text('recipients')->nullable();
            $table->string('attachment_path')->nullable();
            $table->string('attachment_type')->nullable();
            $table->bigInteger('attachment_bytes')->nullable();
            $table->text('email_queue_ids')->nullable();
            $table->text('error_message')->nullable();
            $table->text('validation_issues')->nullable();
            $table->timestamps();

            $table->unique(['report_id', 'occurrence_key'], 'report_dispatches_occurrence_unique');
            $table->index('report_id', 'report_dispatches_report_id_index');
        });
    }

    /**
     * Is (report_id, occurrence_key) unique under ANY index name?
     *
     * Asked of INFORMATION_SCHEMA rather than of a name: a table created by hand
     * carries whatever name its author chose, and the guarantee this engine relies on
     * is the constraint, not the label. The index must cover exactly these two columns
     * - a wider composite would satisfy a name check while leaving the pair itself
     * unconstrained, which is the difference between one email and two.
     */
    private function ensureOccurrenceUnique(): void
    {
        foreach (['report_id', 'occurrence_key'] as $column) {
            if (!Schema::hasColumn('report_dispatches', $column)) {
                // Present but not this table. Adding an index would be a guess.
                return;
            }
        }

        $existing = DB::selectOne(
            'SELECT s.INDEX_NAME
               FROM INFORMATION_SCHEMA.STATISTICS s
               JOIN (
                    SELECT INDEX_NAME, COUNT(*) AS column_count
                      FROM INFORMATION_SCHEMA.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                     GROUP BY INDEX_NAME
               ) c ON c.INDEX_NAME = s.INDEX_NAME
              WHERE s.TABLE_SCHEMA = DATABASE()
                AND s.TABLE_NAME = ?
                AND s.NON_UNIQUE = 0
                AND c.column_count = 2
                AND s.COLUMN_NAME IN (?, ?)
              GROUP BY s.INDEX_NAME
             HAVING COUNT(DISTINCT s.COLUMN_NAME) = 2
              LIMIT 1',
            ['report_dispatches', 'report_dispatches', 'report_id', 'occurrence_key']
        );

        if ($existing !== null) {
            return;
        }

        Schema::table('report_dispatches', function (Blueprint $table) {
            $table->unique(['report_id', 'occurrence_key'], 'report_dispatches_occurrence_unique');
        });
    }
};
