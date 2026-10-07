<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

class Discount extends Model
{
    public const STATUSES = ['Pending', 'Unused', 'Used', 'Permanent', 'Monthly'];

    protected $table = 'discounts';

    protected $fillable = [
        'account_no',
        'discount_amount',
        'status',
        'remaining',
        'remarks',
        'invoice_used_id',
        'used_date',
        'processed_date',
        'processed_by_user_id',
        'approved_by_user_id',
        'created_by_user_id',
        'updated_by_user_id',
        'organization_id'
    ];

    protected $casts = [
        'discount_amount' => 'decimal:2',
        'remaining' => 'integer',
        'used_date' => 'datetime',
        'processed_date' => 'datetime'
    ];

    public static function canonicalStatus(?string $stored): ?string
    {
        if ($stored === null) {
            return null;
        }

        $trimmed = trim($stored);
        foreach (self::STATUSES as $status) {
            if (strcasecmp($trimmed, $status) === 0) {
                return $status;
            }
        }

        return $trimmed;
    }

    protected function status(): Attribute
    {
        return Attribute::make(get: fn (?string $value) => self::canonicalStatus($value));
    }

    public function scopeWithStatus(Builder $query, array $statuses): Builder
    {
        return $query->whereIn(DB::raw('TRIM(status)'), $statuses);
    }

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }

    public function processedByUser()
    {
        return $this->belongsTo(User::class, 'processed_by_user_id');
    }

    public function approvedByUser()
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }

    public function createdByUser()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function updatedByUser()
    {
        return $this->belongsTo(User::class, 'updated_by_user_id');
    }
}
