<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SMSTemplate extends Model
{
    protected $table = 'sms_templates';

    protected $fillable = [
        'template_name',
        'template_type',
        'message_content',
        'variables',
        'is_active'
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'variables' => 'array'
    ];
}
