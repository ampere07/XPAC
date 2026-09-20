<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ContractTemplate extends Model
{
    protected $table = 'contract_templates';
    protected $primaryKey = 'Template_Name';
    public $incrementing = false;
    protected $keyType = 'string';
    
    protected $fillable = [
        'Template_Name',
        'Description',
    ];

    public function jobOrders()
    {
        return $this->hasMany(JobOrder::class, 'Contract_Template', 'Template_Name');
    }
}
