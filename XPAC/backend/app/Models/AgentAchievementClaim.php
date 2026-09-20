<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One row per onboarded-referral milestone an agent has claimed. The reward amount is
 * fixed by CommissionController, so a claim can never be created for an arbitrary value.
 */
class AgentAchievementClaim extends Model
{
    use HasFactory;

    protected $table = 'agent_achievement_claims';

    protected $fillable = [
        'agent_id',
        'milestone',
        'amount',
        // Which tier was claimed ('weekly' / 'monthly'), and the period it was
        // earned in ('2026-W33' / '2026-08'). Together these let a repeating
        // reward be claimed once per period instead of once ever.
        'period_type',
        'period_key',
        // The span this reward was earned over. `cycle_end` is the moment of the
        // claim, which is where the next cycle starts — claiming early ends the
        // cycle there rather than leaving the agent waiting out the week.
        // Null on claims made before repeating cycles existed.
        'cycle_start',
        'cycle_end',
        // The job orders that earned this reward. Held so a referral cannot earn
        // the same tier's reward twice — if its installation date is later moved
        // back into a cycle that has already been claimed, it is skipped rather
        // than counted afresh.
        'job_order_ids',
    ];

    protected $casts = [
        'agent_id'    => 'integer',
        'milestone'   => 'integer',
        'amount'      => 'decimal:2',
        'cycle_start' => 'datetime',
        'cycle_end'   => 'datetime',
    ];

    public function agent()
    {
        return $this->belongsTo(User::class, 'agent_id');
    }
}
