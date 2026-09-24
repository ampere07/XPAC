<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * SMS gateway configuration (iTexMo or Semaphore). Backs the `sms_config` table
 * used by SmsConfigController and ItexmoSmsService.
 *
 * `provider` became a real column in 2026_06_14_000000_add_provider_to_sms_config_table,
 * but stayed out of $fillable — so SmsConfigController, which writes it through
 * SmsConfig::create() and $config->update(), had it silently dropped on every save and
 * the gateway could not actually be switched from the UI.
 */
class SmsConfig extends Model
{
    protected $table = 'sms_config';

    protected $fillable = [
        'organization_id',
        'provider',
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
