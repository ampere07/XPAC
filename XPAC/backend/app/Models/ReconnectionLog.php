<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReconnectionLog extends Model
{
    protected $table = 'reconnection_logs';

    protected $fillable = [
        'account_id',
        'session_id',
        'username',
        'plan_id',
        'reconnection_fee',
        'remarks',
        'created_by_user',
        'updated_by_user',
        'organization_id',
        'pro_rate_applied',
        'billing_status',
        'pro_rate_invoice_id',
        'pro_rate_billed_at'
    ];

    protected $casts = [
        'pro_rate_applied' => 'boolean',
        'pro_rate_billed_at' => 'datetime'
    ];

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class , 'account_id');
    }

    public function createdByUser()
    {
        return $this->belongsTo(User::class , 'created_by_user_id');
    }

    public function updatedByUser()
    {
        return $this->belongsTo(User::class , 'updated_by_user_id');
    }
}