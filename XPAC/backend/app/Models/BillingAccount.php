<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BillingAccount extends Model
{
    use HasFactory;

    protected $table = 'billing_accounts';

    /**
     * Canonical generation_type ("Billing Type") values.
     *
     * These replaced the older spellings 'Pre Paid' / 'Post Paid'. Because prepaid detection
     * drives billing, renewal and auto-disconnect, every read must tolerate BOTH spellings —
     * rows written before the rename, or by an older client, must keep working. Use
     * {@see isPrepaidType()} for PHP comparisons and {@see PREPAID_ALIASES} for SQL.
     */
    public const GENERATION_PREPAID = 'Prepaid';
    public const GENERATION_POSTPAID = 'Postpaid';

    /**
     * Accepted spellings for SQL `whereIn` / `whereNotIn`.
     *
     * Only WHITESPACE variants need enumerating: the column collation is utf8mb4_unicode_ci, so
     * the comparison is already case-insensitive and 'Prepaid' matches 'PrePaid' and 'PREPAID'.
     * It is NOT whitespace-insensitive, which is why 'Pre Paid' has to be listed separately.
     * 'PrePaid' is listed too so these lists stay correct under a case-sensitive collation.
     */
    public const PREPAID_ALIASES = ['Prepaid', 'PrePaid', 'Pre Paid'];
    public const POSTPAID_ALIASES = ['Postpaid', 'PostPaid', 'Post Paid'];

    /**
     * Is this generation_type value a prepaid one, in any accepted spelling?
     *
     * Compared on a lower-cased, letters-only basis so 'Prepaid', 'Pre Paid', 'PRE-PAID' and
     * 'pre paid' all resolve the same way. NULL/unknown is treated as NOT prepaid, which matches
     * the historical default (legacy accounts with no generation_type bill as postpaid).
     */
    public static function isPrepaidType(?string $generationType): bool
    {
        return preg_replace('/[^a-z]/', '', strtolower((string) $generationType)) === 'prepaid';
    }

    protected $fillable = [
        'customer_id',
        'account_no',
        'date_installed',
        'plan_id',
        'account_balance',
        'balance_update_date',
        'billing_day',
        'billing_status_id',
        'generation_type',
        // Legacy free-text VAT mode. Superseded by the boolean vat_enabled below and kept only so
        // the customer-detail screens and older clients keep reading/writing it.
        'vat_type',
        'vat_enabled',
        'withholding_enabled',
        'withholding_percentage',
        'prepaid_expires_at',
        // Prepaid plan change queued by a payment while the current period was still running.
        // Applied (and cleared) by the prepaid:apply-pending-plans command once it falls due.
        'pending_plan_id',
        'pending_plan_effective_at',
        // The prepaid_expires_at value the lapse notice was last sent for. Stops the daily scan
        // re-notifying an expired customer every morning; resets itself when a payment moves
        // prepaid_expires_at forward.
        'prepaid_expiry_notified_for',
        // The prepaid_expires_at value the PRE-expiry warning was last sent for. Kept separate
        // from prepaid_expiry_notified_for above: both notices key off the same expiry timestamp,
        // so one shared marker would let the early warning suppress the lapse notice that follows.
        'prepaid_pre_expiry_notified_for',
        'created_by',
        'updated_by',
        'vip_expiration',
        'vip_remarks',
    ];

    protected $casts = [
        'date_installed' => 'datetime',
        'balance_update_date' => 'datetime',
        'account_balance' => 'decimal:2',
        'prepaid_expires_at' => 'datetime',
        'pending_plan_effective_at' => 'datetime',
        'prepaid_expiry_notified_for' => 'datetime',
        'prepaid_pre_expiry_notified_for' => 'datetime',
        // NULL is preserved by these casts, which is what lets the billing generator tell
        // "never configured" (fall back to vat_type) apart from an explicit false.
        'vat_enabled' => 'boolean',
        'withholding_enabled' => 'boolean',
        'withholding_percentage' => 'decimal:2',
    ];

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function technicalDetails()
    {
        return $this->hasMany(TechnicalDetail::class, 'account_id');
    }

    public function plan()
    {
        return $this->belongsTo(Plan::class);
    }

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updatedBy()
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function staggeredInstallations()
    {
        return $this->hasMany(StaggeredInstallation::class, 'account_no', 'account_no');
    }

    public function onlineStatus()
    {
        return $this->hasOne(OnlineStatus::class, 'account_id');
    }

    public function billingStatus()
    {
        return $this->belongsTo(BillingStatus::class, 'billing_status_id');
    }
}

