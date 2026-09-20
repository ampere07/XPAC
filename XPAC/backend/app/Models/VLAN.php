<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VLAN extends Model
{
    protected $table = 'vlans';

    protected $fillable = [
        'value',
        'organization_id',
    ];

    protected $casts = [
        'organization_id' => 'integer',
    ];

    public $timestamps = true;
}
