<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AgentCommissionHistory extends Model
{
    use HasFactory;

    protected $table = 'agent_commission_history';

    protected $fillable = [
        'ref_number',
        'total_amount',
        'created_by',
        'remarks',
        'proof_of_payment',
        'agent_id',
        'organization_id',
        'commission_id_list',
        'updated_by',
        'updated_at',
        // Transaction kind: commission / incentives / incentives_payout / Bonus /
        // Bonus_payout / all / achievement. Must stay fillable — the history tabs
        // and the +/- sign on the payout list are driven entirely by this column.
        'type',
        // The column is `approve_by` (no "d") — see database/db_schema.json.
        'approve_by',
        // Approval state, mirroring transactions: Pending / Approved / Rejected.
        // A payout only moves the agent's balance once it reaches Approved.
        'status',
        // The job orders this payout settles, kept so approval marks exactly
        // those as paid rather than re-deriving a possibly different set.
        'job_order_ids'
    ];
    
    public $timestamps = false; // The table has created_at but uses CURRENT_TIMESTAMP, and no updated_at

    public function agent()
    {
        return $this->belongsTo(User::class, 'agent_id');
    }
}