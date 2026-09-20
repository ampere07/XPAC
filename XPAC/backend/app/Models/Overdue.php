<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Overdue extends Model
{
    protected $table = 'overdue';

    protected $fillable = [
        'account_no',
        'invoice_id',
        'overdue_date',
        'print_link',
        'created_by_user_id',
        'updated_by_user_id',
        'organization_id'
    ];

    protected $casts = [
        'overdue_date' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function account()
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
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


