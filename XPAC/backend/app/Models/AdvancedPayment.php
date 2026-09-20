<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AdvancedPayment extends Model
{
    protected $table = 'advanced_payments';

    protected $fillable = [
        'account_no',
        'payment_amount',
        'payment_month',
        'payment_date',
        'status',
        'invoice_used_id',
        'remarks',
        'created_by_user_id',
        'updated_by_user_id'
    ];

    protected $casts = [
        'payment_amount' => 'decimal:2',
        'payment_date' => 'date'
    ];

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }
}
