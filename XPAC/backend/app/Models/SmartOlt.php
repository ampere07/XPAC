<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SmartOlt extends Model
{
    use HasFactory;

    protected $table = 'smart_olt';
    
    protected $fillable = [
        'sub_domain',
        'token'
    ];
}
