<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CustomAccountNumber extends Model
{
    use HasFactory;

    protected $table = 'custom_account_number';

    public $incrementing = false;

    protected $primaryKey = null;

    public $timestamps = true;

    protected $fillable = [
        'starting_number',
        'updated_by',
        'created_by',
        'created_at',
        'updated_at'
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];
}
