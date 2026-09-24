<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A request to add or deduct days on a prepaid customer's service period.
 *
 * Direct editing of billing_accounts.prepaid_expires_at is disabled; this is the only path that
 * moves it outside of a payment. See {@see \App\Services\PrepaidOverrideService} for the approval
 * workflow and {@see \App\Http\Controllers\PrepaidOverrideRequestController} for the API surface.
 */
class PrepaidOverrideRequest extends Model
{
    use HasFactory;

    protected $table = 'prepaid_override_requests';

    /** Awaiting a decision. The only status from which a transition is allowed. */
    public const STATUS_PENDING = 'pending';

    /**
     * Approved AND applied — prepaid_expires_at has been moved.
     *
     * There is no lasting 'approved but not yet applied' state: the expiry update happens in the
     * same transaction as the decision, so a row that says 'processed' is a row whose adjustment is
     * durable. 'approved' is still ACCEPTED from clients (see {@see isApprovalStatus()}) because it
     * is the natural word for the button, but it is never what gets stored.
     */
    public const STATUS_PROCESSED = 'processed';

    /** Client-facing synonym for {@see STATUS_PROCESSED}. Never stored. */
    public const STATUS_APPROVED = 'approved';

    public const STATUS_REJECTED = 'rejected';

    /** Every value the status column may legitimately hold. */
    public const STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_APPROVED,
        self::STATUS_PROCESSED,
        self::STATUS_REJECTED,
    ];

    /**
     * Bounds on a single adjustment, in days.
     *
     * A cap exists because the field is free-typed and a slipped keystroke ("300" for "30") would
     * otherwise hand out most of a year of free service. 365 is deliberately generous — it is a
     * guard against typos, not a policy limit.
     */
    public const MAX_DAYS_ADJUSTMENT = 365;

    protected $fillable = [
        'organization_id',
        'account_no',
        'billing_account_id',
        'days_adjustment',
        'reason',
        'remarks',
        'status',
        'expiry_before',
        'expiry_after',
        'processed_at',
        'requested_by',
        'updated_by',
    ];

    protected $casts = [
        'days_adjustment' => 'integer',
        'expiry_before' => 'datetime',
        'expiry_after' => 'datetime',
        'processed_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    /**
     * Does this incoming status mean "approve and apply"?
     *
     * Accepts both spellings so a client sending either 'approved' or 'processed' lands on the same
     * code path — the alternative is two ways to say one thing that behave differently.
     */
    public static function isApprovalStatus(?string $status): bool
    {
        return in_array(strtolower(trim((string) $status)), [self::STATUS_APPROVED, self::STATUS_PROCESSED], true);
    }

    public function isPending(): bool
    {
        return strtolower(trim((string) $this->status)) === self::STATUS_PENDING;
    }

    /**
     * The billing account this adjustment targets.
     *
     * Joined on account_no rather than the id so requests raised against an account that was later
     * re-keyed still resolve, matching how staggeredInstallations() relates on BillingAccount.
     */
    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }

    public function requester()
    {
        return $this->belongsTo(User::class, 'requested_by', 'id');
    }

    public function updater()
    {
        return $this->belongsTo(User::class, 'updated_by', 'id');
    }
}
