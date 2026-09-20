<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The claim a background driver holds while it is stepping a tool job.
 *
 * Until now a job was advanced only by the browser that started it, so no two
 * callers could ever be inside the same job at once. `cron:tool-jobs-drain` now
 * advances jobs unattended, which puts a second driver in the picture: without a
 * claim, an open tab and the scheduler could each run stepDelete() on the same
 * queue index and unprovision two ONUs where the operator queued one.
 *
 * `locked_by` names the holder and `locked_at` dates the claim so a driver killed
 * mid-slice cannot strand the job — SmartOltReconciliationService::claimJob treats
 * a claim older than CLAIM_TTL_MINUTES as expired and takes it over.
 *
 * Additive: both columns are nullable, so a row written before this migration is
 * simply an unclaimed job.
 */
return new class extends Migration
{
    private const TABLE = 'tool_jobs';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table): void {
            if (!Schema::hasColumn(self::TABLE, 'locked_by')) {
                $table->string('locked_by', 64)->nullable()->after('organization_id');
            }

            if (!Schema::hasColumn(self::TABLE, 'locked_at')) {
                $table->dateTime('locked_at')->nullable()->after('locked_by');
            }
        });

        // The drain sweep asks for live jobs whose claim is free or expired.
        if (!$this->indexExists('tool_jobs_status_locked_at_index')) {
            Schema::table(self::TABLE, function (Blueprint $table): void {
                $table->index(['status', 'locked_at'], 'tool_jobs_status_locked_at_index');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $table): void {
            if ($this->indexExists('tool_jobs_status_locked_at_index')) {
                $table->dropIndex('tool_jobs_status_locked_at_index');
            }

            foreach (['locked_at', 'locked_by'] as $column) {
                if (Schema::hasColumn(self::TABLE, $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }

    /**
     * Laravel 9 has no portable "does this index exist"; ask the schema manager.
     */
    private function indexExists(string $name): bool
    {
        try {
            return Schema::getConnection()
                ->getDoctrineSchemaManager()
                ->listTableDetails(self::TABLE)
                ->hasIndex($name);
        } catch (\Throwable $e) {
            return false;
        }
    }
};
