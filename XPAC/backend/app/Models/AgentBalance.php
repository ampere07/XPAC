<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AgentBalance extends Model
{
    use HasFactory;

    protected $table = 'agent_balance';

    protected $fillable = [
        'agent_id',
        'balance',
        // The RATE one referral pays — a setting, not a total.
        'commission',
        // What the agent has EARNED in commission from approved job orders.
        'commission_value',
        'incentives',
        'Bonus',
        'bonus',
        'quota',
        'incentives_value',
        'remarks',
        // Credited when an agent claims an onboarded-referral milestone.
        'achievement',
        'organization_id',
    ];

    public function agent()
    {
        return $this->belongsTo(User::class, 'agent_id');
    }
}

