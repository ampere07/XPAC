<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class City extends Model
{
    protected $table = 'city';
    public $timestamps = false;

    protected $fillable = [
        'city_code',
        'city_name',
        'region_code',
    ];

    public function region()
    {
        return $this->belongsTo(Region::class, 'region_code', 'region_code');
    }

    public function barangays()
    {
        return $this->hasMany(Barangay::class, 'city_code', 'city_code');
    }
}
