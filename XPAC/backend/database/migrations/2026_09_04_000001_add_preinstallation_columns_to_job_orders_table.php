<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The pre-installation columns on job_orders.
 *
 * These four have existed in production for some time, added to that database
 * by hand, and are relied on by code that is committed:
 *
 *   • AgentIncentiveService counts a referral toward an agent's quota when
 *     `pre_installed` carries the marker and the job order has not since been
 *     abandoned — the rule that lets an agent earn quota progress once the site
 *     is prepared, without waiting for the technician to close the install.
 *   • AgentInvoicePdfService prints the pre-installation detail on the invoice.
 *   • JobOrderController writes all four, and JobOrder declares them fillable.
 *
 * With no migration behind them, a database built from this repository has none
 * of them, and every incentive run fails outright with
 * "Unknown column 'pre_installed' in 'field list'" — so a new environment, a
 * staging rebuild or a restored test box silently cannot pay agents at all.
 * This closes that gap; production already has the columns and is unaffected.
 *
 * Every column is guarded individually, so the migration is safe on a database
 * that has some of them already and safe to run twice.
 *
 * Types match what production carries:
 *   pre_installed            varchar(255)  the marker, compared as 'preinstalled'
 *   pre_installed_datetime   datetime      when the site was prepared
 *   pre_remarks              text          the technician's note
 *   preinstalled_updated_by  varchar(255)  the author's email, never blank
 */
return new class extends Migration
{
    private const TABLE = 'job_orders';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            if (!Schema::hasColumn(self::TABLE, 'pre_installed')) {
                $table->string('pre_installed')->nullable();
            }

            if (!Schema::hasColumn(self::TABLE, 'pre_installed_datetime')) {
                $table->dateTime('pre_installed_datetime')->nullable();
            }

            if (!Schema::hasColumn(self::TABLE, 'pre_remarks')) {
                $table->text('pre_remarks')->nullable();
            }

            if (!Schema::hasColumn(self::TABLE, 'preinstalled_updated_by')) {
                $table->string('preinstalled_updated_by')->nullable();
            }
        });

        // The incentive cron filters on this column for every agent on every
        // run, so it is worth an index rather than a scan of job_orders.
        if (!$this->hasIndex('job_orders_pre_installed_index')) {
            Schema::table(self::TABLE, function (Blueprint $table) {
                $table->index('pre_installed', 'job_orders_pre_installed_index');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        if ($this->hasIndex('job_orders_pre_installed_index')) {
            Schema::table(self::TABLE, function (Blueprint $table) {
                $table->dropIndex('job_orders_pre_installed_index');
            });
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            foreach ([
                'pre_installed', 'pre_installed_datetime',
                'pre_remarks', 'preinstalled_updated_by',
            ] as $column) {
                if (Schema::hasColumn(self::TABLE, $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }

    /** Does this index already exist on the table? */
    private function hasIndex(string $name): bool
    {
        return collect(Schema::getConnection()
            ->select('SHOW INDEX FROM ' . self::TABLE))
            ->contains(fn ($row) => $row->Key_name === $name);
    }
};
