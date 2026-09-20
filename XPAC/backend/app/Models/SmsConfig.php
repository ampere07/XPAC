<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * SMS gateway (iTexMo) configuration. Backs the `sms_config` table used by
 * SmsConfigController and ItexmoSmsService. Fillable mirrors the live columns
 * (any non-column input such as `provider` is safely dropped by mass assignment).
 */
class SmsConfig extends Model
{
    protected $table = 'sms_config';

    protected $fillable = [
        'organization_id',
        'code',
        'email',
        'password',
        'sender',
        'updated_by',
        'created_by',
    ];

    protected $casts = [
        'organization_id' => 'integer',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organization_id');
    }
}
