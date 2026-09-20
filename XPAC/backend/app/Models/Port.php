<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Port extends Model
{
    protected $table = 'ports';
    protected $primaryKey = 'id';
    public $incrementing = true;
    protected $keyType = 'int';
    
    protected $fillable = [
        'port_id',
        'label',
    ];

    // Override toArray to map lowercase to uppercase
    public function toArray()
    {
        $array = parent::toArray();
        
        // Map lowercase database columns to uppercase for API
        if (isset($array['port_id'])) {
            $array['PORT_ID'] = $array['port_id'];
            unset($array['port_id']);
        }
        
        if (isset($array['label'])) {
            $array['Label'] = $array['label'];
            unset($array['label']);
        }
        
        return $array;
    }

    public function jobOrders()
    {
        return $this->hasMany(JobOrder::class, 'PORT', 'port_id');
    }
}
