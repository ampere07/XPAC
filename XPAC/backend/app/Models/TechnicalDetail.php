<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class TechnicalDetail extends Model
{
    use HasFactory;

    protected $table = 'technical_details';

    protected $fillable = [
        'account_id',
        'account_no',
        'username',
        'username_status',
        'connection_type',
        'router_model',
        'router_modem_sn',
        'ip_address',
        'lcp',
        'nap',
        'port',
        'vlan',
        'lcpnap',
        'usage_type',
        'organization_id',
        'created_by',
        'updated_by',
    ];

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_id');
    }

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updatedBy()
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
