<?php

declare(strict_types=1);

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A single monthly obligation for one billing period.
 *
 * @property int         $id
 * @property string      $title
 * @property int         $category_id
 * @property string|null $vendor_name
 * @property string|null $account_number
 * @property string      $amount_due
 * @property string      $amount_paid
 * @property string      $billing_month
 * @property string      $status
 * @property bool        $is_recurring
 */
class MonthlyPayable extends Model
{
    use HasFactory;
    use SoftDeletes;

    protected $table = 'monthly_payables';

    public const STATUS_PENDING   = 'pending';
    public const STATUS_PARTIAL   = 'partial';
    public const STATUS_PAID      = 'paid';
    public const STATUS_OVERDUE   = 'overdue';
    public const STATUS_CANCELLED = 'cancelled';

    public const STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_PARTIAL,
        self::STATUS_PAID,
        self::STATUS_OVERDUE,
        self::STATUS_CANCELLED,
    ];

    /**
     * Statuses that still owe money. Cancelled is excluded because a cancelled bill is
     * not a debt, and paid is excluded because it is settled.
     */
    public const OPEN_STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_PARTIAL,
        self::STATUS_OVERDUE,
    ];

    /**
     * Money is stored as DECIMAL(12,2), so comparing paid against due has to tolerate the
     * float round-trip that PHP does on the way out of the driver. Half a centavo is far
     * below the smallest representable difference and far above float noise.
     */
    private const SETTLEMENT_EPSILON = 0.005;

    protected $fillable = [
        'organization_id',
        'title',
        'category_id',
        'vendor_name',
        'account_number',
        'amount_due',
        'amount_paid',
        'due_date',
        'billing_month',
        'status',
        'is_recurring',
        'notes',
        'receipt_path',
        'created_by',
        'modified_by',
    ];

    protected $casts = [
        'organization_id' => 'integer',
        'category_id'     => 'integer',
        'amount_due'      => 'decimal:2',
        'amount_paid'     => 'decimal:2',
        'due_date'        => 'date',
        'is_recurring'    => 'boolean',
        'created_at'      => 'datetime',
        'updated_at'      => 'datetime',
        'deleted_at'      => 'datetime',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(ExpensesCategory::class, 'category_id', 'id');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(PayablePayment::class, 'monthly_payable_id', 'id')
            ->orderByDesc('payment_date')
            ->orderByDesc('id');
    }

    // ---------------------------------------------------------------- scopes

    /** @param string $monthYear 'YYYY-MM' */
    public function scopeForMonth(Builder $query, string $monthYear): Builder
    {
        return $query->where('billing_month', $monthYear);
    }

    /**
     * Rows that are genuinely late: past their due date and still owing. Matches on the
     * date rather than the stored status so a row the sweep has not touched yet is still
     * counted — the status column is a cache of this predicate, not its definition.
     */
    public function scopeOverdue(Builder $query): Builder
    {
        return $query->whereIn('status', self::OPEN_STATUSES)
            ->whereDate('due_date', '<', Carbon::today());
    }

    /** Unsettled and not yet late. */
    public function scopePending(Builder $query): Builder
    {
        return $query->whereIn('status', self::OPEN_STATUSES)
            ->whereDate('due_date', '>=', Carbon::today());
    }

    /** Anything still owing money, late or not. */
    public function scopeOutstanding(Builder $query): Builder
    {
        return $query->whereIn('status', self::OPEN_STATUSES);
    }

    /**
     * The org rule used across this app: a user scoped to an organization sees that
     * organization's rows; a user with no organization sees the unscoped ones.
     */
    public function scopeForOrganization(Builder $query, $organizationId): Builder
    {
        return $organizationId
            ? $query->where('organization_id', $organizationId)
            : $query->whereNull('organization_id');
    }

    // ------------------------------------------------------------- behaviour

    public function getBalanceAttribute(): float
    {
        return round((float) $this->amount_due - (float) $this->amount_paid, 2);
    }

    public function isSettled(): bool
    {
        return (float) $this->amount_paid >= (float) $this->amount_due - self::SETTLEMENT_EPSILON;
    }

    public function isPastDue(): bool
    {
        return $this->due_date !== null
            && Carbon::parse($this->due_date)->startOfDay()->lt(Carbon::today());
    }

    /**
     * Recomputes `status` from the amounts and the due date. Settlement outranks lateness
     * on purpose: a bill that has been part-paid reads as 'partial', not 'overdue', so the
     * status column answers "how much of this is settled" and the red due-date highlight in
     * the UI answers "is it late". Cancelled is a manual terminal state and is never
     * overwritten here.
     */
    public function syncStatus(): self
    {
        if ($this->status === self::STATUS_CANCELLED) {
            return $this;
        }

        $paid = (float) $this->amount_paid;

        if ($this->isSettled()) {
            $this->status = self::STATUS_PAID;
        } elseif ($paid > 0) {
            $this->status = self::STATUS_PARTIAL;
        } elseif ($this->isPastDue()) {
            $this->status = self::STATUS_OVERDUE;
        } else {
            $this->status = self::STATUS_PENDING;
        }

        return $this;
    }

    /**
     * Rebuilds `amount_paid` from the payment ledger and re-derives the status. Called
     * after every write to `payable_payments`, so a deleted or corrected payment walks the
     * status back down as readily as a new one walks it up.
     */
    public function recalculateFromPayments(): self
    {
        $this->amount_paid = (string) round(
            (float) $this->payments()->sum('amount'),
            2
        );

        return $this->syncStatus();
    }

    /**
     * Flips still-pending rows whose due date has passed over to 'overdue'.
     *
     * A single indexed UPDATE rather than a scheduled command, so the list is correct the
     * moment it is opened even on a deployment with no cron. Only 'pending' is touched:
     * 'partial' keeps its own meaning (see syncStatus) and paid/cancelled are terminal.
     *
     * @return int rows changed
     */
    public static function refreshOverdueStatuses($organizationId): int
    {
        return static::query()
            ->forOrganization($organizationId)
            ->where('status', self::STATUS_PENDING)
            ->whereDate('due_date', '<', Carbon::today())
            ->update([
                'status'     => self::STATUS_OVERDUE,
                'updated_at' => Carbon::now(),
            ]);
    }

    /** Current billing period, 'YYYY-MM'. */
    public static function currentBillingMonth(): string
    {
        return Carbon::today()->format('Y-m');
    }
}
