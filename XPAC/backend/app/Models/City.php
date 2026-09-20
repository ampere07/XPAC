<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class City extends Model
{
    use HasFactory;

    protected $table = 'city';
    
    public $timestamps = false;
    
    protected $fillable = [
        'city',
        'region_id',
        'organization_id',
        'modified_by',
        'modified_at'
    ];

    protected $casts = [
        'organization_id' => 'integer',
        'modified_at' => 'datetime'
    ];

    public function region()
    {
        return $this->belongsTo(Region::class, 'region_id');
    }

    public function barangays()
    {
        return $this->hasMany(Barangay::class, 'city_id');
    }
}
