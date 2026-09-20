<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Let an achievement cycle end early, when the agent claims its reward.
 *
 * Until now a tier always ran to the end of the calendar week or month. An
 * agent who reached the target on Tuesday had nothing to do until Monday: the
 * count stayed where it was and the reward could not be earned again. Claiming
 * now ends that cycle on the spot and starts a fresh one of the same length, so
 * the agent carries straight on instead of waiting out the rest of the week.
 *
 *   cycle_start / cycle_end   the span the claim was earned over. `cycle_end`
 *                             is the moment of the claim, which is also where
 *                             the following cycle begins — it is the anchor the
 *                             rest of the schedule is measured from.
 *
 * Both are nullable. A claim made before this change has neither, which marks
 * it as belonging to a plain calendar period and leaves that agent's schedule
 * exactly as it was.
 *
 *   closed_reason             why a period closed: because its time ran out, or
 *                             because the reward was claimed early. Without it
 *                             a short cycle in the ledger looks like a bug.
 *
 * Guarded so it is safe on a hand-built table and safe to run twice.
 */
return new class extends Migration
{
    private const CLAIMS  = 'agent_achievement_claims';
    private const PERIODS = 'agent_achievement_periods';

    public function up(): void
    {
        if (Schema::hasTable(self::CLAIMS)) {
            foreach (['cycle_start', 'cycle_end'] as $column) {
                if (!Schema::hasColumn(self::CLAIMS, $column)) {
                    Schema::table(self::CLAIMS, function (Blueprint $t) use ($column) {
                        $t->timestamp($column)->nullable();
                    });
                }
            }

            // Looked up on every dashboard load to find the agent's anchor.
            if (Schema::hasColumn(self::CLAIMS, 'cycle_end')) {
                try {
                    Schema::table(self::CLAIMS, function (Blueprint $t) {
                        $t->index(['agent_id', 'period_type', 'cycle_end'], 'claim_anchor_index');
                    });
                } catch (\Throwable $e) {
                    // The index is already there.
                }
            }
        }

        if (Schema::hasTable(self::PERIODS) && !Schema::hasColumn(self::PERIODS, 'closed_reason')) {
            Schema::table(self::PERIODS, function (Blueprint $t) {
                // 'period_ended' | 'claimed_early'
                $t->string('closed_reason', 20)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::CLAIMS)) {
            try {
                Schema::table(self::CLAIMS, function (Blueprint $t) {
                    $t->dropIndex('claim_anchor_index');
                });
            } catch (\Throwable $e) {
                // Never existed.
            }

            foreach (['cycle_start', 'cycle_end'] as $column) {
                if (Schema::hasColumn(self::CLAIMS, $column)) {
                    Schema::table(self::CLAIMS, function (Blueprint $t) use ($column) {
                        $t->dropColumn($column);
                    });
                }
            }
        }

        if (Schema::hasTable(self::PERIODS) && Schema::hasColumn(self::PERIODS, 'closed_reason')) {
            Schema::table(self::PERIODS, function (Blueprint $t) {
                $t->dropColumn('closed_reason');
            });
        }
    }
};
