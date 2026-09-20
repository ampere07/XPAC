<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InstallmentSchedule extends Model
{
    protected $table = 'installment_schedules';

    protected $fillable = [
        'installment_id',
        'invoice_id',
        'installment_no',
        'due_date',
        'amount',
        'status',
        'created_by',
        'updated_by'
    ];

    protected $casts = [
        'installment_no' => 'integer',
        'due_date' => 'date',
        'amount' => 'decimal:2'
    ];

    public function installment()
    {
        return $this->belongsTo(Installment::class, 'installment_id');
    }
}
