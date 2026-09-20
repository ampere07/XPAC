<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SettingsImageSize extends Model
{
    protected $table = 'settings_image_size';

    protected $fillable = [
        'image_size',
        'image_size_value',
        'status'
    ];

    public $timestamps = false;

    protected $casts = [
        'image_size_value' => 'integer'
    ];
}
