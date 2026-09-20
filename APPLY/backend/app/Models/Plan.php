<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    protected $table = 'plan_list';
    public $timestamps = false;

    protected $fillable = [
        'plan_name',
        'description',
        'price',
        'group_id',
        'modified_by_user_id',
        'modified_date',
    ];

    protected $casts = [
        'price' => 'decimal:2',
    ];
}
