<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class InventoryLog extends Model
{
    use HasFactory;

    protected $table = 'inventory_logs';

    // Disable auto-incrementing if the user provided id is varchar(50)
    // Actually, the user's CREATE TABLE shows `id` varchar(50) NOT NULL.
    // So we should handle ID generation or let the user provide it.
    public $incrementing = false;
    protected $keyType = 'string';

    public $timestamps = false; // The schema has modified_date but not created_at/updated_at

    protected $fillable = [
        'id',
        'date',
        'log_type',
        'item_name',
        'item_description',
        'account_no',
        'sn',
        'item_quantity',
        'requested_by',
        'requested_with',
        'requested_with_10',
        'status',
        'remarks',
        'modified_by',
        'modified_date',
        'user_email',
        'item_id',
        'organization_id'
    ];

    protected $casts = [
        'date' => 'datetime',
        'item_quantity' => 'integer',
        'modified_date' => 'datetime',
        'organization_id' => 'integer'
    ];

    /**
     * Get the item associated with the log
     */
    public function item()
    {
        return $this->belongsTo(Inventory::class, 'item_id');
    }
}

