<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class LCPNAPLocation extends Model
{
    use HasFactory;
    
    protected $table = 'lcpnap';
    protected $primaryKey = 'id';
    public $incrementing = true;
    protected $keyType = 'int';
    public $timestamps = false;
    
    protected $fillable = [
        'lcpnap_name',
        'reading_image_url',
        'street',
        'region',
        'city',
        'barangay',
        'location',
        'lcp',
        'nap',
        'port_total',
        'image1_url',
        'image2_url',
        'modified_by',
        'modified_date',
        'coordinates',
        'organization_id'
    ];

    protected $casts = [
        'port_total' => 'integer',
        'modified_date' => 'datetime',
        'organization_id' => 'integer'
    ];
}
