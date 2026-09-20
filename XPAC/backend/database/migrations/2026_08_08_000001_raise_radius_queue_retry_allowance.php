<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Raise the RADIUS queue retry allowance to the configured maximum.
 *
 * The queue previously stopped after 5 attempts, retried with no delay between
 * them, and stored that limit on every row. The retry schedule now lives in
 * config/radius.php, and this brings the stored values into line so existing
 * queued work is governed by the same policy as anything queued from now on:
 *
 *   - the column default is raised, so new rows carry the new allowance;
 *   - rows still in flight are topped up, so a job part-way through its retries
 *     gets the additional attempts rather than being cut short at the old limit;
 *   - rows that already finished (success or failed) are left exactly as they
 *     are, so history is not rewritten and nothing that finished is reopened.
 *
 * Guarded throughout: safe to run on a deployment whose table was created by
 * hand, and safe to run more than once.
 */
return new class extends Migration
{
    private const TABLE = 'radius_operation_queue';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE) || !Schema::hasColumn(self::TABLE, 'max_attempts')) {
            return;
        }

        $maxAttempts = (int) config('radius.queue.max_attempts', 10);
        if ($maxAttempts < 1) {
            $maxAttempts = 10;
        }

        // Raise the column default. Done in raw SQL because changing a column
        // default with the schema builder requires doctrine/dbal, which this
        // application does not install.
        try {
            DB::statement(
                'ALTER TABLE `' . self::TABLE . '` MODIFY `max_attempts` INT UNSIGNED NOT NULL DEFAULT ' . $maxAttempts
            );
        } catch (\Throwable $e) {
            // A column type we do not recognise, or insufficient privileges. The
            // service falls back to the configured maximum whenever a row does
            // not carry a usable one, so the queue still honours the new policy.
        }

        // Top up work that has not finished yet. Rows already at or above the
        // new allowance are left alone, so a deliberately higher per-row limit
        // is never reduced.
        DB::table(self::TABLE)
            ->whereIn('status', ['pending', 'processing'])
            ->where(function ($q) use ($maxAttempts) {
                $q->whereNull('max_attempts')
                  ->orWhere('max_attempts', '<', $maxAttempts);
            })
            ->update([
                'max_attempts' => $maxAttempts,
                'updated_at'   => now(),
            ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE) || !Schema::hasColumn(self::TABLE, 'max_attempts')) {
            return;
        }

        try {
            DB::statement(
                'ALTER TABLE `' . self::TABLE . '` MODIFY `max_attempts` INT UNSIGNED NOT NULL DEFAULT 5'
            );
        } catch (\Throwable $e) {
            // Nothing further to undo — see up().
        }
    }
};
