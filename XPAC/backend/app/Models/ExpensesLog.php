<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class ExpensesLog extends Model
{
    use HasFactory, SoftDeletes;

    protected $table = 'expenses_logs';

    /**
     * `id` is varchar(50), not an auto-increment int — same shape as inventory_logs and
     * the other legacy varchar-PK tables here. Controllers assign a UUID on create.
     */
    public $incrementing = false;
    protected $keyType = 'string';

    /**
     * The table tracks edits through `modified_date`, not Eloquent's updated_at, and it
     * has no updated_at column at all. `created_at` is written by hand on insert.
     */
    public $timestamps = false;

    /**
     * What kind of spending this is — the axis MONITOR's executive dashboard
     * splits on.
     *
     *   OPEX   consumed in the period. Netting it against that period's income
     *          is correct.
     *   CAPEX  buys an asset that outlives the period, so netting it against one
     *          month is not.
     *
     * Aligned with App\Support\ExpenseClassifier and with MONITOR's classifier of
     * the same name, which is what reads these rows for the dashboard.
     */
    public const TYPE_OPEX = 'OPEX';
    public const TYPE_CAPEX = 'CAPEX';

    public const TYPES = [self::TYPE_OPEX, self::TYPE_CAPEX];

    /**
     * How often the spending recurs.
     *
     * Orthogonal to the type above, and previously conflated with it: this column
     * holds what `expense_type` used to hold. A leased vehicle is Monthly OPEX, a
     * fibre reel is Daily (one-off) CAPEX — one column could not say both.
     *
     * A bucket tag, not a schedule: it decides which summary card an expense
     * lands in. It does not accrue, recur, or generate rows.
     */
    public const FREQUENCY_DAILY = 'Daily';
    public const FREQUENCY_MONTHLY = 'Monthly';

    public const FREQUENCIES = [self::FREQUENCY_DAILY, self::FREQUENCY_MONTHLY];

    protected $fillable = [
        'id',
        'organization_id',
        'date',
        'provider',
        'description',
        'amount',
        'photo',
        'processed_by',
        'modified_by',
        'modified_date',
        'user_email',
        'location',
        'payee',
        'category',
        'category_id',
        'expense_type',
        'frequency',
        'invoice_no',
        'reference_no',
        'received_date',
        'supplier',
        'barangay',
        'city',
        'created_at',
    ];

    protected $casts = [
        'date' => 'date',
        'received_date' => 'date',
        'modified_date' => 'datetime',
        'created_at' => 'datetime',
        'deleted_at' => 'datetime',
        'amount' => 'decimal:2',
        'organization_id' => 'integer',
        'category_id' => 'integer',
    ];

    public function category()
    {
        return $this->belongsTo(ExpensesCategory::class, 'category_id', 'id');
    }

    /**
     * Frequency scopes.
     *
     * These read `frequency`, not `expense_type` — the daily/monthly meaning
     * moved columns in the MONITOR alignment. The method names are unchanged
     * because their meaning is unchanged: callers asking for "the daily ones"
     * still get the daily ones.
     */
    public function scopeDaily($query)
    {
        return $query->where('frequency', self::FREQUENCY_DAILY);
    }

    public function scopeMonthly($query)
    {
        return $query->where('frequency', self::FREQUENCY_MONTHLY);
    }

    /** Nature scopes — the OpEx/CapEx split the executive dashboard reports. */
    public function scopeOpex($query)
    {
        return $query->where('expense_type', self::TYPE_OPEX);
    }

    public function scopeCapex($query)
    {
        return $query->where('expense_type', self::TYPE_CAPEX);
    }

    /**
     * Matches the org rule the rest of the app uses: a user scoped to an organization
     * sees that organization's rows, a user with no organization sees the unscoped ones.
     */
    public function scopeForOrganization($query, $organizationId)
    {
        return $organizationId
            ? $query->where('organization_id', $organizationId)
            : $query->whereNull('organization_id');
    }
}
