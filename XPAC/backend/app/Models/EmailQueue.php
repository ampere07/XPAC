<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmailQueue extends Model
{
    protected $table = 'email_queue';

    protected $fillable = [
        'account_no',
        'recipient_email',
        'cc',
        'bcc',
        'subject',
        'body_html',
        'attachment_path',
        'status',
        'sent_at',
        'time_sent',
        'attempts',
        'error_message',
        'email_sender',
        'reply_to',
        'sender_name'
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'sent_at' => 'datetime',
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

    public function scopeSent($query)
    {
        return $query->where('status', 'sent');
    }

    public function scopeFailed($query)
    {
        return $query->where('status', 'failed');
    }

    public function scopeRetryable($query, int $maxAttempts = 3)
    {
        return $query->where('status', 'failed')
                     ->where('attempts', '<', $maxAttempts);
    }

    public function markAsSent(): void
    {
        $this->update([
            'status' => 'sent',
            'sent_at' => now()
        ]);
    }

    public function markAsFailed(string $errorMessage): void
    {
        $this->update([
            'status' => 'failed',
            'attempts' => $this->attempts + 1,
            'error_message' => $errorMessage
        ]);
    }

    public function resetToPending(): void
    {
        $this->update([
            'status' => 'pending',
            'error_message' => null
        ]);
    }
}

