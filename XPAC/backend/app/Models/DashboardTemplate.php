<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DashboardTemplate extends Model
{
    use HasFactory;

    protected $table = 'dashboard_templates';

    protected $fillable = [
        'template_name',
        'layout_data',
        'style_data',
    ];

    protected $casts = [
        'layout_data' => 'array',
        'style_data' => 'array',
    ];
}
