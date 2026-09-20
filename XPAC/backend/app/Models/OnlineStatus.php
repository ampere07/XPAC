<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OnlineStatus extends Model
{
    use HasFactory;

    protected $table = 'online_status';

    protected $fillable = [
        'account_id',
        'account_no',
        'username',
        'session_status',
        'session_group',
        'session_id',
        'total_download',
        'total_upload',
        'ip_address',
        'city',
        'session_mac_address',
        'created_by_user',
        'updated_by_user',
        'active_sessions',
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'total_download' => 'integer',
        'total_upload' => 'integer',
        'active_sessions' => 'integer',
    ];

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_id');
    }
}


