<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Inventory extends Model
{
    use HasFactory;
    
    protected $table = 'inventory_items';
    
    protected $primaryKey = 'id';
    public $incrementing = true;
    protected $keyType = 'int';
    
    public $timestamps = true;
    
    protected $fillable = [
        'item_name',
        'item_description',
        'category_id',
        'supplier_id',
        'quantity_alert',
        'total_quantity',
        'image_url',
        'created_by_user_id',
        'updated_by_user_id',
        'organization_id'
    ];
    
    protected $casts = [
        'quantity_alert' => 'integer',
        'total_quantity' => 'integer',
        'category_id' => 'integer',
        'supplier_id' => 'integer',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'organization_id' => 'integer'
    ];

    /**
     * Get the category that owns the inventory item
     */
    public function category()
    {
        return $this->belongsTo(InventoryCategory::class, 'category_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by_user_id', 'id');
    }

    public function updater()
    {
        return $this->belongsTo(User::class, 'updated_by_user_id', 'id');
    }
}


