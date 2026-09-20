<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppVersionConfig extends Model
{
    protected $table = 'app_version_configs';
    
    protected $fillable = [
        'config_key',
        'config_value',
        'updated_by'
    ];

    public $timestamps = true;
}
