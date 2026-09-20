<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The closing record of each achievement period, per agent per tier.
 *
 * Weekly and monthly progress is counted from the referrals inside the current
 * period rather than held in a running total, so a new period begins at zero on
 * its own. Nothing is left behind when it does, which makes the reset invisible
 * afterwards: there is no way to look back and see what the count reached, or
 * to show that it stopped there.
 *
 * A row is written here once, as a period ends, recording the final count, the
 * target, and whether the reward was claimed. `carried_over` is stored as zero
 * rather than left implied, so the ledger says outright that nothing moved into
 * the next period. Each closure also writes an audit trail entry.
 *
 * The unique key is what makes closing safe to attempt repeatedly — from a
 * dashboard load, from the scheduled command, or from both at once. Only the
 * first attempt records the period; the rest are turned away by the database.
 *
 * Guarded so it is safe to run twice.
 */
return new class extends Migration
{
    private const TABLE = 'agent_achievement_periods';

    public function up(): void
    {
        if (Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::create(self::TABLE, function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('agent_id')->index();

            // 'weekly' / 'monthly', and the period itself: '2026-W33' / '2026-08'.
            $t->string('period_type', 20);
            $t->string('period_key', 20);
            $t->date('period_start')->nullable();
            $t->date('period_end')->nullable();

            // What the tier asked for, and what the agent reached before it closed.
            $t->integer('target')->default(0);
            $t->integer('onboarded')->default(0);
            $t->boolean('reached')->default(false);

            // Whether the reward was taken while the period was open.
            $t->boolean('claimed')->default(false);
            $t->unsignedBigInteger('claim_id')->nullable();
            $t->decimal('reward_paid', 12, 2)->default(0);

            // Always zero: progress does not follow the agent into the next
            // period. Recorded explicitly so the ledger states it rather than
            // leaving it to be inferred from the absence of a figure.
            $t->integer('carried_over')->default(0);

            $t->timestamp('closed_at')->nullable();
            $t->string('closed_by')->nullable();
            $t->unsignedBigInteger('organization_id')->nullable()->index();
            $t->timestamps();

            // One closure per agent per tier per period.
            $t->unique(['agent_id', 'period_type', 'period_key'], 'agent_period_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists(self::TABLE);
    }
};
