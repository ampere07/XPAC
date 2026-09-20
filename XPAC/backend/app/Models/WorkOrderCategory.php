<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WorkOrderCategory extends Model
{
    protected $table = 'work_order_category';
    
    // The table only has created_at, no updated_at
    const UPDATED_AT = null;
    
    protected $fillable = [
        'category',
        'created_by',
        'organization_id'
    ];

    protected $casts = [
        'organization_id' => 'integer'
    ];
    
    public $timestamps = true;
}

