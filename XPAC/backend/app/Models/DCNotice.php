<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DCNotice extends Model
{
    protected $table = 'dc_notice';

    protected $fillable = [
        'account_id',
        'invoice_id',
        'dc_notice_date',
        'print_link',
        'created_by_user_id',
        'updated_by_user_id',
        'organization_id'
    ];

    protected $casts = [
        'dc_notice_date' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function account()
    {
        return $this->belongsTo(BillingAccount::class, 'account_id');
    }

    public function invoice()
    {
        return $this->belongsTo(Invoice::class, 'invoice_id');
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
