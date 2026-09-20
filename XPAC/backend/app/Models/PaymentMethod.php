<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PaymentMethod extends Model
{
    use HasFactory;

    protected $table = 'payment_methods';

    protected $fillable = [
        'payment_method',
        'organization_id',
        'created_by_user_id',
        'updated_by_user_id',
    ];

    protected $casts = [
        'organization_id' => 'integer',
    ];

    /**
     * Relationship with user who created the record
     */
    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    /**
     * Relationship with user who updated the record
     */
    public function updater()
    {
        return $this->belongsTo(User::class, 'updated_by_user_id');
    }
}
