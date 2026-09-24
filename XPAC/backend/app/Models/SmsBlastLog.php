<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SmsBlastLog extends Model
{
    use HasFactory;

    protected $table = 'sms_blast_logs';

    public $timestamps = true;

    protected $fillable = [
        'message',
        'barangay_id',
        'billing_day',
        'lcpnap_id',
        'lcp_id',
        'message_count',
        'timestamp',
        'credit_used',
        'created_at',
        'created_by_user_id',
        'updated_at',
        'updated_by_user_id',
        'organization_id'
    ];

    protected $casts = [
        'timestamp' => 'datetime',
        'credit_used' => 'decimal:2',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'organization_id' => 'integer'
    ];
}
