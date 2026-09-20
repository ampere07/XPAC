<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UsageType extends Model
{
    protected $table = 'usage_type';
    
    protected $fillable = [
        'usage_name',
        'organization_id',
        'created_by_user_id',
        'updated_by_user_id'
    ];

    protected $casts = [
        'organization_id' => 'integer',
    ];
    
    public $timestamps = true;
}
