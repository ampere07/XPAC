<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BillingStatus extends Model
{
    use HasFactory;

    protected $table = 'billing_status';

    protected $fillable = [
        'status_name',
        'created_by_user_id',
        'updated_by_user_id',
    ];

    public function billingAccounts()
    {
        return $this->hasMany(BillingAccount::class, 'billing_status_id');
    }

    public function jobOrders()
    {
        return $this->hasMany(JobOrder::class, 'billing_status_id');
    }
}

