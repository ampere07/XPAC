<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class NAP extends Model
{
    protected $table = 'nap';
    protected $primaryKey = 'id';
    public $incrementing = true;
    protected $keyType = 'int';
    
    protected $fillable = [
        'nap_name',
        'organization_id',
        'created_by_user_id',
        'updated_by_user_id',
    ];

    protected $casts = [
        'organization_id' => 'integer',
    ];

    public function lcpnaps()
    {
        return $this->hasMany(LCPNAP::class, 'nap_id');
    }

    public function jobOrders()
    {
        return $this->hasMany(JobOrder::class, 'NAP', 'id');
    }
}
