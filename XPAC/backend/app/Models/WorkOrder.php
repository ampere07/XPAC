<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WorkOrder extends Model
{
    protected $table = 'work_order';

    const CREATED_AT = 'requested_date';
    const UPDATED_AT = 'updated_date';

    protected $fillable = [
        'instructions',
        'report_to',
        'assign_to',
        'remarks',
        'work_status',
        'work_category',
        'image_1',
        'image_2',
        'image_3',
        'signature',
        'requested_by',
        'updated_by',
        'start_time',
        'end_time',
        'organization_id'
    ];

    protected $casts = [
        'organization_id' => 'integer'
    ];
}
