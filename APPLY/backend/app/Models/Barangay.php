<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Barangay extends Model
{
    protected $table = 'barangay';
    public $timestamps = false;

    protected $fillable = [
        'barangay_code',
        'barangay_name',
        'city_code',
    ];

    public function city()
    {
        return $this->belongsTo(City::class, 'city_code', 'city_code');
    }
}
