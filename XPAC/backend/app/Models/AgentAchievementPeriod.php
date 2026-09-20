<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * The closing record of one achievement period for one agent.
 *
 * Achievement progress is not a stored counter that gets zeroed — it is counted
 * from the referrals that fall inside the current week or month, so a new period
 * starts at zero because nothing inside it has been onboarded yet. That is
 * reliable, but it leaves nothing behind to inspect afterwards: once the week
 * turns, there is no record of what the count reached before it did.
 *
 * A row here is written once, when a period ends, capturing the final count and
 * whether the reward was claimed. It is the evidence that the count stopped
 * there and did not follow the agent into the next period.
 *
 * One row per agent per tier per period, enforced by a unique key, so closing
 * the same period twice cannot produce a second record or a second audit entry.
 */
class AgentAchievementPeriod extends Model
{
    use HasFactory;

    protected $table = 'agent_achievement_periods';

    protected $fillable = [
        'agent_id',
        // Which tier closed ('weekly' / 'monthly') and which period ('2026-W33').
        'period_type',
        'period_key',
        'period_start',
        'period_end',
        // What the tier asked for, and what the agent actually reached.
        'target',
        'onboarded',
        'reached',
        // Whether the reward was taken before the period ended, and its record.
        'claimed',
        'claim_id',
        'reward_paid',
        // Always zero. Stored rather than implied so the ledger states outright
        // that nothing was carried into the following period.
        'carried_over',
        'closed_at',
        'closed_by',
        // 'period_ended' when the cycle ran its course, 'claimed_early' when the
        // agent took the reward and started the next one straight away. Without
        // it a short cycle in the ledger is indistinguishable from a fault.
        'closed_reason',
        'organization_id',
    ];

    protected $casts = [
        'agent_id'     => 'integer',
        'target'       => 'integer',
        'onboarded'    => 'integer',
        'reached'      => 'boolean',
        'claimed'      => 'boolean',
        'claim_id'     => 'integer',
        'reward_paid'  => 'decimal:2',
        'carried_over' => 'integer',
        'closed_at'    => 'datetime',
    ];

    public function agent()
    {
        return $this->belongsTo(User::class, 'agent_id');
    }

    public function claim()
    {
        return $this->belongsTo(AgentAchievementClaim::class, 'claim_id');
    }
}
