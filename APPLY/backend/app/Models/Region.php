<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Region extends Model
{
    protected $table = 'region';
    public $timestamps = false;

    protected $fillable = [
        'region_code',
        'region_name',
    ];

    public function cities()
    {
        return $this->hasMany(City::class, 'region_code', 'region_code');
    }
}
