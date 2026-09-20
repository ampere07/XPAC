<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class TechInOut extends Model
{
    use HasFactory;

    protected $table = 'tech_in_out';
    public $timestamps = false;

    protected $fillable = [
        'tech_id',
        'time_in',
        'time_out',
        'status',
        'last_updated'
    ];

    protected $casts = [
        'time_in' => 'datetime',
        'time_out' => 'datetime',
        'last_updated' => 'datetime'
    ];
}
