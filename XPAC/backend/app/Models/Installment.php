<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Installment extends Model
{
    protected $table = 'installments';

    protected $fillable = [
        'account_id',
        'invoice_id',
        'start_date',
        'total_balance',
        'months_to_pay',
        'monthly_payment',
        'status',
        'remarks',
        'created_by',
        'updated_by'
    ];

    protected $casts = [
        'start_date' => 'date',
        'total_balance' => 'decimal:2',
        'months_to_pay' => 'integer',
        'monthly_payment' => 'decimal:2'
    ];

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_id');
    }

    public function invoice()
    {
        return $this->belongsTo(Invoice::class, 'invoice_id');
    }

    public function schedules()
    {
        return $this->hasMany(InstallmentSchedule::class, 'installment_id');
    }
}
