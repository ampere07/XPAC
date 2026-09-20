<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class RadiusConfig extends Model
{
    use HasFactory;

    protected $table = 'radius_config';

    public $timestamps = true;

    protected $fillable = [
        'ssl_type',
        'ip',
        'port',
        'username',
        'password',
        'updated_by',
        'organization_id'
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];
}
