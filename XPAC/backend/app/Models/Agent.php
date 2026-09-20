<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Agent extends Model
{
    use HasFactory;

    protected $table = 'agents';
    
    public $timestamps = false; // We use created_at from SQL default

    protected $fillable = [
        'id',
        'team_name',
        'created_by',
        'created_at',
        'organization_id'
    ];

    protected $casts = [
        'created_at' => 'datetime',
    ];
}
