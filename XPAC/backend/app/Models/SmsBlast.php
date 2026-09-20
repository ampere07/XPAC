<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SmsBlast extends Model
{
    use HasFactory;

    protected $table = 'sms_blast';

    public $timestamps = true;

    protected $fillable = [
        'contact_number',
        'account_id',
        'message',
        'status',
        'created_by_user_id',
        'updated_by_user_id'
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime'
    ];

    public function account()
    {
        return $this->belongsTo(BillingAccount::class, 'account_id');
    }
}
