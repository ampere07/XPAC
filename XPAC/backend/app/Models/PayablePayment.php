<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One credit against a monthly payable. Append-only in normal use — the parent's
 * `amount_paid` is derived by summing these rows, never edited directly.
 *
 * @property int         $id
 * @property int         $monthly_payable_id
 * @property string      $amount
 * @property string|null $payment_method
 * @property string|null $reference_no
 */
class PayablePayment extends Model
{
    use HasFactory;

    protected $table = 'payable_payments';

    protected $fillable = [
        'monthly_payable_id',
        'amount',
        'payment_date',
        'payment_method',
        'reference_no',
        'receipt_path',
        'notes',
        'recorded_by',
    ];

    protected $casts = [
        'monthly_payable_id' => 'integer',
        'amount'             => 'decimal:2',
        'payment_date'       => 'date',
        'created_at'         => 'datetime',
        'updated_at'         => 'datetime',
    ];

    public function payable(): BelongsTo
    {
        return $this->belongsTo(MonthlyPayable::class, 'monthly_payable_id', 'id');
    }
}
