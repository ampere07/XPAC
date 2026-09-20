<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SettingsColorPalette extends Model
{
    protected $table = 'settings_color_palette';

    protected $fillable = [
        'palette_name',
        'primary',
        'secondary',
        'accent',
        'status',
        'created_at',
        'updated_at',
        'updated_by'
    ];

    public $timestamps = true;
}
