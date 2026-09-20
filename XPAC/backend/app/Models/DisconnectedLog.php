<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DisconnectedLog extends Model
{
    protected $table = 'disconnected_logs';

    protected $fillable = [
        'account_id',
        'session_id',
        'username',
        'remarks',
        'created_by_user',
        'updated_by_user',
        'organization_id'
    ];

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_id');
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
