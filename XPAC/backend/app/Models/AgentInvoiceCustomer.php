<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One referred customer billed on one agent invoice.
 *
 * These rows are the record of who has already been invoiced. A unique key on
 * (owner_key, application_id) means a customer billed once for a team or agent
 * cannot be written onto a later invoice for them — the check is in the
 * database, not only in the code that builds the invoice.
 *
 * `referred_by_agent_id` keeps the individual agent attached to their own
 * referral even on a team invoice, so a team document still shows who brought
 * each customer in.
 */
class AgentInvoiceCustomer extends Model
{
    use HasFactory;

    protected $table = 'agent_invoice_customers';

    protected $fillable = [
        'agent_invoice_id',
        'application_id',
        'job_order_id',
        'owner_key',
        'customer_name',
        'referred_by_agent_id',
        'referred_by_name',
        'referred_by_raw',
        'installed_date',
        'unit_price',
        'quantity',
        'total',
    ];

    protected $casts = [
        'agent_invoice_id'     => 'integer',
        'application_id'       => 'integer',
        'job_order_id'         => 'integer',
        'referred_by_agent_id' => 'integer',
        'installed_date'       => 'date',
        'unit_price'           => 'decimal:2',
        'quantity'             => 'integer',
        'total'                => 'decimal:2',
    ];

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(AgentInvoice::class, 'agent_invoice_id');
    }

    public function referredBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'referred_by_agent_id', 'id');
    }
}
