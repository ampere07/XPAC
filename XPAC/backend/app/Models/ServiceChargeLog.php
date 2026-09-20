<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ServiceChargeLog extends Model
{
    protected $table = 'service_charge_logs';

    protected $fillable = [
        'account_no',
        'service_charge',
        'remarks',
        'status',
        'created_by_user_id',
        'updated_by_user_id'
    ];

    protected $casts = [
        'service_charge' => 'decimal:2',
    ];

    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by_user_id');
    }

    public function scopeUnused($query)
    {
        return $query->where('status', 'Unused');
    }

    public function scopeUsed($query)
    {
        return $query->where('status', 'Used');
    }

    public function scopeByAccount($query, $accountNo)
    {
        return $query->where('account_no', $accountNo);
    }
}
