<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Discount extends Model
{
    protected $table = 'discounts';

    protected $fillable = [
        'account_no',
        'discount_amount',
        'status',
        'remaining',
        'remarks',
        'invoice_used_id',
        'used_date',
        'processed_date',
        'processed_by_user_id',
        'approved_by_user_id',
        'created_by_user_id',
        'updated_by_user_id',
        'organization_id'
    ];

    protected $casts = [
        'discount_amount' => 'decimal:2',
        'remaining' => 'integer',
        'used_date' => 'datetime',
        'processed_date' => 'datetime'
    ];

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }

    public function processedByUser()
    {
        return $this->belongsTo(User::class, 'processed_by_user_id');
    }

    public function approvedByUser()
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }

    public function createdByUser()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function updatedByUser()
    {
        return $this->belongsTo(User::class, 'updated_by_user_id');
    }
}
