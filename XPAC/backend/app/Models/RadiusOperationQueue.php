<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class RadiusOperationQueue extends Model
{
    use HasFactory;

    protected $table = 'radius_operation_queue';

    protected $fillable = [
        'organization_id',
        'source_type',
        'source_id',
        'account_no',
        'operation',
        'params',
        'status',
        'attempts',
        'max_attempts',
        'last_error',
        'next_retry_at',
        'completed_at',
        'created_by'
    ];

    protected $casts = [
        'params' => 'array',
        'next_retry_at' => 'datetime',
        'completed_at' => 'datetime',
        'attempts' => 'integer',
        'max_attempts' => 'integer'
    ];
}
