<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ModemRouterSN extends Model
{
    protected $table = 'router_models';
    protected $primaryKey = 'id';
    public $incrementing = true;
    protected $keyType = 'int';
    
    protected $fillable = [
        'SN',
        'Model',
    ];

    public function jobOrders()
    {
        return $this->hasMany(JobOrder::class, 'Modem_Router_SN', 'SN');
    }
}
