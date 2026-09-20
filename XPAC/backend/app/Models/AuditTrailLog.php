<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AuditTrailLog extends Model
{
    use HasFactory;

    protected $table = 'audit_trail_logs';

    protected $fillable = [
        'old_details',
        'new_details',
        'created_by_user',
        'updated_by_user',
    ];

    protected $casts = [
        'old_details' => 'array',
        'new_details' => 'array',
        'created_by_user' => 'string',
        'updated_by_user' => 'string',
    ];
}
