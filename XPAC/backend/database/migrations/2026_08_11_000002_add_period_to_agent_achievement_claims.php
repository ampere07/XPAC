<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Move agent achievements from a single lifetime milestone to repeating
 * weekly and monthly tiers.
 *
 * The old model recorded one claim per milestone number (30, 60, 90 …) counted
 * over an agent's whole history, so a milestone could only ever be claimed
 * once. Weekly and monthly rewards repeat, so a claim now belongs to a tier AND
 * the period it was earned in:
 *
 *   period_type  'weekly' | 'monthly' | 'lifetime' (the retired model)
 *   period_key   '2026-W33' for a week, '2026-08' for a month
 *
 * Existing rows are marked 'lifetime' so the history an agent has already
 * earned stays intact and is never mistaken for a weekly or monthly claim.
 *
 * Guarded so it is safe on a hand-built table and safe to run twice.
 */
return new class extends Migration
{
    private const TABLE = 'agent_achievement_claims';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        if (!Schema::hasColumn(self::TABLE, 'period_type')) {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->string('period_type', 20)->nullable()->index();
            });
        }

        if (!Schema::hasColumn(self::TABLE, 'period_key')) {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->string('period_key', 20)->nullable()->index();
            });
        }

        // Everything claimed before this change belongs to the retired lifetime
        // milestone. Leaving it unlabelled would let it block a weekly or
        // monthly claim whose target happened to match.
        DB::table(self::TABLE)->whereNull('period_type')->update([
            'period_type' => 'lifetime',
            'period_key'  => 'lifetime',
        ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        foreach (['period_type', 'period_key'] as $column) {
            if (Schema::hasColumn(self::TABLE, $column)) {
                Schema::table(self::TABLE, function (Blueprint $t) use ($column) {
                    $t->dropColumn($column);
                });
            }
        }
    }
};
