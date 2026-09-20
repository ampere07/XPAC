<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PlanChangeLog extends Model
{
    use HasFactory;

    protected $table = 'plan_change_logs';

    protected $fillable = [
        'account_id',
        'old_plan_id',
        'new_plan_id',
        'status',
        'date_changed',
        'date_used',
        'remarks',
        'created_by_user',
        'updated_by_user'
    ];
}
