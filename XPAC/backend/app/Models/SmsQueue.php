<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SmsQueue extends Model
{
    protected $table = 'sms_queue';

    protected $fillable = [
        'account_no',
        'contact_no',
        'message',
        // Idempotency key for scheduled notifications, UNIQUE. NULL for ad-hoc sends, which stay
        // repeatable. Built by SmsQueueService::dedupeKeyFor().
        'dedupe_key',
        'status',
        'sent_at',
        'time_sent',
        'attempts',
        'error_message'
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'sent_at' => 'datetime',
        'time_sent' => 'datetime',
        'attempts' => 'integer'
    ];

    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }

    public function scopePending($query)
    {
        $now = \Carbon\Carbon::now('Asia/Manila');
        return $query->where('status', 'pending')
                     ->where(function($q) use ($now) {
                         $q->whereNull('time_sent')
                           ->orWhere('time_sent', '<=', $now->format('Y-m-d H:i:s'));
                     });
    }

    public function markAsSent(): void
    {
        $this->update([
            'status' => 'sent',
            'sent_at' => now()
        ]);
    }

    /**
     * Attempts are NOT incremented here.
     *
     * SmsQueueService claims the row — incrementing `attempts` under a conditional update — before
     * it calls the provider, which is what stops two workers sending the same message. Counting the
     * attempt again on failure would double it and retire the row after half the allowed tries.
     */
    public function markAsFailed(string $errorMessage): void
    {
        $this->update([
            'status' => 'failed',
            'error_message' => $errorMessage
        ]);
    }
}
