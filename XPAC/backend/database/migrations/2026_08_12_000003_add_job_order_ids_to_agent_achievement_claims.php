<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Record which referrals earned each achievement reward.
 *
 * Achievement progress is worked out from when a referral was onboarded, and
 * carried no record of which ones had already been paid for. That left one way
 * for a referral to earn the same reward twice: edit a job order's installation
 * date backwards, into a cycle that has already been claimed, and it drops into
 * the current count as though it were new work.
 *
 * Storing the ids closes that. A job order listed on a claim is skipped by every
 * later count for the same tier, whatever its date is later changed to — the
 * same protection commission payouts already have, where a paid job order is
 * stamped and never picked up again.
 *
 * Scoped per tier: a referral that earned a weekly reward can still earn a
 * monthly one, because those are separate achievements.
 *
 * Claims made before this change have no list. They cannot protect the
 * referrals they paid for, so a backdate reaching that far still slips through;
 * everything claimed from here on is covered.
 *
 * Guarded so it is safe on a hand-built table and safe to run twice.
 */
return new class extends Migration
{
    private const TABLE = 'agent_achievement_claims';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE) || Schema::hasColumn(self::TABLE, 'job_order_ids')) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $t) {
            // A JSON array of job order ids, matching how agent_commission_history
            // records the job orders a payout covered.
            $t->longText('job_order_ids')->nullable();
        });
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && Schema::hasColumn(self::TABLE, 'job_order_ids')) {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->dropColumn('job_order_ids');
            });
        }
    }
};
