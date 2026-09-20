<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AgentBonusHistory extends Model
{
    use HasFactory;

    protected $table = 'agent_bonus_history';

    protected $fillable = [
        'agent_id',
        'ref_number',
        'total_amount',
        'type',
        'proof_of_payment',
        'remarks',
        'created_by',
        'updated_by',
        'approve_by',
        'organization_id',
        // Approval state, mirroring transactions: Pending / Approved / Rejected.
        // A bonus only moves the agent's balance once it reaches Approved.
        'status',
    ];

    // created_at is defaulted by the DB (CURRENT_TIMESTAMP); updated_at is set manually.
    public $timestamps = false;

    public function agent()
    {
        return $this->belongsTo(User::class, 'agent_id');
    }
}
