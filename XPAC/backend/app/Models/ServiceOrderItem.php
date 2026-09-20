<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ServiceOrderItem extends Model
{
    public $timestamps = false;
    
    protected $fillable = [
        'service_order_id',
        'item_name',
        'quantity',
        'is_pullout',
        'serial_number'
    ];

    public function serviceOrder()
    {
        return $this->belongsTo(ServiceOrder::class);
    }
}

