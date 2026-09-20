<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TechnicianLocation extends Model
{
    protected $table = 'technician_locations';

    protected $fillable = [
        'user_id',
        'organization_id',
        'latitude',
        'longitude',
        'accuracy',
        'speed',
        'heading',
        'status',
        'last_updated_at',
    ];

    protected $casts = [
        'user_id'         => 'integer',
        'organization_id' => 'integer',
        'latitude'        => 'float',
        'longitude'       => 'float',
        'accuracy'        => 'float',
        'speed'           => 'float',
        'heading'         => 'float',
        'last_updated_at' => 'datetime',
    ];

    public $timestamps = true;

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }
}
