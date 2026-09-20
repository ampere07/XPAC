<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Technician extends Model
{
    use HasFactory;

    protected $table = 'technicians';
    
    public $timestamps = false; // Based on the SQL provided, it has updated_at but not created_at and we might want to handle it manually or use Laravel default if we add it.

    protected $fillable = [
        'id',
        'first_name',
        'middle_initial',
        'last_name',
        'updated_at',
        'updated_by',
        'organization_id'
    ];

    protected $casts = [
        'updated_at' => 'datetime',
    ];
}
