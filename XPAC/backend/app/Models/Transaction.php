<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Transaction extends Model
{
    use HasFactory;

    protected $table = 'transactions';

    /**
     * The transaction_type vocabulary.
     *
     * Values match the database enum exactly (see the 2026_08_03_000001 migration). 'Recurring
     * Fee' is the POSTPAID recurring payment and 'Top Up' its PREPAID counterpart — they are
     * mutually exclusive by account type, which is what {@see typesForGenerationType()} enforces.
     * The remaining three mean the same thing on either account type.
     */
    public const TYPE_RECURRING_FEE = 'Recurring Fee';
    public const TYPE_TOP_UP = 'Top Up';
    public const TYPE_SERVICE_CHARGE = 'Service Charge';
    public const TYPE_INSTALLATION_FEE = 'Installation Fee';

    /**
     * RETIRED. No longer offered for new transactions on either account type.
     *
     * The constant and every rule that mentions it below are deliberately kept: the value stays
     * in the database enum and existing rows still carry it, so each read path must go on
     * treating a security deposit correctly — it never touches the account balance and never
     * settles an invoice. Removing the handling would silently reinterpret historical rows.
     *
     * Absent from SHARED_TYPES, which is what stops it being written again.
     */
    public const TYPE_SECURITY_DEPOSIT = 'Security Deposit';

    /** Valid on both account types. */
    public const SHARED_TYPES = [
        self::TYPE_SERVICE_CHARGE,
        self::TYPE_INSTALLATION_FEE,
    ];

    /**
     * Types a payment of this kind may be recorded as, given the account's generation_type.
     *
     * TransactionController validates every write against this. The transaction form mirrors the
     * same rule client-side from the account's generation_type (it already derives `isPrepaid`
     * that way for the plan picker) so the dropdown never offers an option the server rejects —
     * the two must be kept in step.
     *
     * Order matters — the first entry is the type-specific one and the form defaults to it.
     *
     * @return list<string>
     */
    public static function typesForGenerationType(?string $generationType): array
    {
        $primary = BillingAccount::isPrepaidType($generationType)
            ? self::TYPE_TOP_UP
            : self::TYPE_RECURRING_FEE;

        return array_merge([$primary], self::SHARED_TYPES);
    }

    /**
     * Does a payment of this type buy SERVICE — i.e. settle the bill for the connection itself?
     *
     * Gates the two prepaid side effects of a settling payment: extending prepaid_expires_at
     * (PrepaidRenewalService) and acting on a bought plan change (PrepaidPlanChangeService).
     *
     * Expressed as an exclusion rather than an allow-list on purpose. During the deploy window a
     * cached client can still post 'Recurring Fee' for a prepaid account, and rows written before
     * the type was mandatory carry NULL; both are service payments and both must keep granting
     * days. Only the three types that demonstrably are NOT payment for service time are excluded:
     * a security deposit is refundable collateral, an installation fee is a one-off setup charge,
     * and a service charge pays for a Service Order repair. None of them buy a day of internet.
     */
    public static function grantsService(?string $transactionType): bool
    {
        return !in_array($transactionType, [
            self::TYPE_SECURITY_DEPOSIT,
            self::TYPE_INSTALLATION_FEE,
            self::TYPE_SERVICE_CHARGE,
        ], true);
    }

    /**
     * Should a payment of this type be distributed across the account's unpaid INVOICES, or only
     * deducted from the account balance?
     *
     * 'Service Charge' is balance-only. It pays for a Service Order repair, and that charge does
     * not exist as an invoice at the time it is paid — a completed SO writes a service_charge_logs
     * row which the NEXT monthly invoice absorbs (see ServiceOrderController::
     * applyServiceOrderCharge). Distributing it would therefore settle whichever monthly invoice
     * happened to be open, marking a bill Paid with money collected for a repair, and the repair
     * would then reappear unpaid on the next invoice. The balance nets out either way; the invoice
     * statuses would not.
     *
     * Every other type keeps the existing behaviour. 'Security Deposit' is excluded even earlier —
     * it never touches the balance at all — so it is listed here only to keep the rule complete.
     */
    public static function settlesInvoices(?string $transactionType): bool
    {
        return !in_array($transactionType, [
            self::TYPE_SERVICE_CHARGE,
            self::TYPE_SECURITY_DEPOSIT,
        ], true);
    }

    protected $fillable = [
        'account_no',
        'transaction_type',
        'received_payment',
        'payment_date',
        'date_processed',
        'processed_by_user',
        'payment_method',
        'reference_no',
        'or_no',
        'remarks',
        'status',
        'image_url',
        'created_by_user',
        'updated_by_user',
        'approved_by',
        'account_balance_before',
        'organization_id',
        'updated_column',
        // Prepaid only: the plan this payment buys. Acted on at approval by
        // PrepaidPlanChangeService (queued if the period is live, applied if it has lapsed).
        'selected_plan_id',
        // Prepaid only: start the bought plan immediately, forfeiting the days remaining on the
        // current one, instead of queueing the switch for when the period lapses.
        'activate_now',
    ];

    protected $casts = [
        'payment_date' => 'datetime',
        'date_processed' => 'datetime',
        'received_payment' => 'decimal:2',
        'updated_column' => 'array',
        'activate_now' => 'boolean',
    ];

    public function account()
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }

    public function processor()
    {
        return $this->belongsTo(User::class, 'processed_by_user', 'email_address');
    }

    public function getProcessedByUserAttribute($value)
    {
        if ($this->relationLoaded('processor')) {
            return $this->processor ? $this->processor->full_name : $value;
        }
        return $value;
    }

    public function paymentMethodInfo()
    {
        return $this->belongsTo(PaymentMethod::class, 'payment_method', 'payment_method');
    }



    public function invoices()
    {
        return $this->hasMany(Invoice::class, 'transaction_id');
    }

    public function revert_request()
    {
        return $this->hasOne(\App\Models\TransactionRevert::class, 'transaction_id');
    }
}


