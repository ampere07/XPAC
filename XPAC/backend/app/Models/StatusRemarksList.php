<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class StatusRemarksList extends Model
{
    use HasFactory;

    protected $table = 'status_remarks_list';

    protected $fillable = [
        'status_remarks',
        'created_at',
        'created_by_user',
        'updated_at',
        'updated_by_user'
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public $timestamps = true;
}
