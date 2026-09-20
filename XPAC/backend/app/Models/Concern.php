<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Concern extends Model
{
    use HasFactory;

    protected $table = 'concern';
    public $timestamps = false; // Disable if table lacks created_at/updated_at

    protected $fillable = [
        'concern_name',
        'modified_by',
        'modified_at'
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'modified_at' => 'datetime'
    ];
}
