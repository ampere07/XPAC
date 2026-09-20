<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Ledger of Job Orders already counted toward an agent quota incentive.
 *
 * One row per processed Job Order. The unique key on job_order_id (see the
 * SQL script) makes duplicate processing impossible at the database level.
 *
 * Rows appear only once a quota has actually been COMPLETED. Job Orders part
 * way toward one are deliberately absent, which is what lets an unfinished
 * quota keep accumulating across cron runs. The `batch_number` groups the rows
 * of one completed quota, so which customers earned which incentive is
 * answerable from this table alone.
 *
 * `agent_invoice_id` names the weekly invoice that billed the quota, and is the
 * guard against the same incentive being paid on two invoices. NULL means
 * earned but not yet billed.
 */
class AgentIncentiveHistory extends Model
{
    use HasFactory;

    protected $table = 'agent_incentive_history';

    public $timestamps = true;

    protected $fillable = [
        'agent_id',
        'job_order_id',
        'quota_reached',
        'batch_number',
        'incentive_value',
        'organization_id',
        'processed_at',
        'agent_invoice_id',
        'invoiced_at',
    ];

    protected $casts = [
        'agent_id'         => 'integer',
        'job_order_id'     => 'integer',
        'quota_reached'    => 'integer',
        'batch_number'     => 'integer',
        'incentive_value'  => 'decimal:2',
        'organization_id'  => 'integer',
        'processed_at'     => 'datetime',
        'agent_invoice_id' => 'integer',
        'invoiced_at'      => 'datetime',
    ];

    /** Completed quotas that have been earned but not yet billed on an invoice. */
    public function scopeUnbilled($query)
    {
        return $query->whereNull('agent_invoice_id');
    }

    public function agent()
    {
        return $this->belongsTo(User::class, 'agent_id');
    }

    public function invoice()
    {
        return $this->belongsTo(AgentInvoice::class, 'agent_invoice_id');
    }

    public function jobOrder()
    {
        return $this->belongsTo(JobOrder::class, 'job_order_id');
    }
}
