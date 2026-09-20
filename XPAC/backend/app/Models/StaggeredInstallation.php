<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StaggeredInstallation extends Model
{
    protected $table = 'staggered_installation';

    public $timestamps = false;

    protected $fillable = [
        'account_no',
        'staggered_install_no',
        'staggered_date',
        'staggered_balance',
        'months_to_pay',
        'monthly_payment',
        'modified_by',
        'modified_date',
        'created_at',
        'user_email',
        'remarks',
        'status',
        'month1',
        'month2',
        'month3',
        'month4',
        'month5',
        'month6',
        'month7',
        'month8',
        'month9',
        'month10',
        'month11',
        'month12',
        'organization_id'
    ];

    protected $casts = [
        'staggered_date' => 'date',
        'staggered_balance' => 'decimal:2',
        'months_to_pay' => 'integer',
        'monthly_payment' => 'decimal:2',
        'modified_date' => 'datetime',
        'created_at' => 'datetime',
        'month1' => 'string',
        'month2' => 'string',
        'month3' => 'string',
        'month4' => 'string',
        'month5' => 'string',
        'month6' => 'string',
        'month7' => 'string',
        'month8' => 'string',
        'month9' => 'string',
        'month10' => 'string',
        'month11' => 'string',
        'month12' => 'string'
    ];

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }
}
