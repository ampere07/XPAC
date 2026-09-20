<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DisconnectionNotice extends Model
{
    protected $table = 'disconnection_notice';

    protected $fillable = [
        'account_no',
        'invoice_id',
        'overdue_date',
        'print_link',
        'created_by_user_id',
        'updated_by_user_id'
    ];

    protected $casts = [
        'overdue_date' => 'date',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    /**
     * Get the invoice associated with this disconnection notice
     */
    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class, 'invoice_id');
    }

    /**
     * Get the billing account associated with this disconnection notice
     */
    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }

    /**
     * Get the user who created this record
     */
    public function createdByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    /**
     * Get the user who last updated this record
     */
    public function updatedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by_user_id');
    }

    /**
     * Scope to get records for a specific account
     */
    public function scopeByAccount($query, $accountNo)
    {
        return $query->where('account_no', $accountNo);
    }

    /**
     * Scope to get records for a specific date range
     */
    public function scopeByDateRange($query, $startDate, $endDate)
    {
        return $query->whereBetween('overdue_date', [$startDate, $endDate]);
    }

    /**
     * Scope to get recent records
     */
    public function scopeRecent($query, $limit = 10)
    {
        return $query->orderBy('created_at', 'desc')->limit($limit);
    }

    /**
     * Scope to get records created today
     */
    public function scopeToday($query)
    {
        return $query->whereDate('created_at', today());
    }

    /**
     * Get the number of days overdue
     */
    public function getDaysOverdueAttribute()
    {
        return now()->diffInDays($this->overdue_date);
    }

    /**
     * Get formatted overdue date
     */
    public function getFormattedOverdueDateAttribute()
    {
        return $this->overdue_date->format('F d, Y');
    }
}
