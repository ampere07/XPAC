<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BillingConfig extends Model
{
    use HasFactory;

    protected $table = 'billing_config';

    public $timestamps = true;

    protected $fillable = [
        'advance_generation_day',
        'due_date_day',
        'disconnection_day',
        'overdue_day',
        'disconnection_notice',
        'disconnection_fee',
        'pullout_offset',
        'pullout_day',
        'updated_by',
        'created_by'
    ];

    protected $casts = [
        'advance_generation_day' => 'integer',
        'due_date_day' => 'integer',
        'disconnection_day' => 'integer',
        'overdue_day' => 'integer',
        'disconnection_notice' => 'integer',
        'disconnection_fee' => 'decimal:2',
        'pullout_offset' => 'integer',
        'pullout_day' => 'integer',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];
}

