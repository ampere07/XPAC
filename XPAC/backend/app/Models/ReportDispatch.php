<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Ledger of scheduled-report sends.
 *
 * One row per (report, scheduled occurrence). A UNIQUE index on that pair is
 * what stops the every-minute cron from mailing the same report repeatedly:
 * claiming an occurrence is an INSERT, so two concurrent runs cannot both win.
 */
class ReportDispatch extends Model
{
    protected $table = 'report_dispatches';

    public const STATUS_QUEUED  = 'queued';
    public const STATUS_FAILED  = 'failed';
    public const STATUS_SKIPPED = 'skipped';

    protected $fillable = [
        'report_id',
        'occurrence_key',
        'scheduled_for',
        'dispatched_at',
        'status',
        'recipient_count',
        'recipients',
        'attachment_path',
        'attachment_type',
        'attachment_bytes',
        'email_queue_ids',
        'error_message',
        'validation_issues',
    ];

    protected $casts = [
        'scheduled_for'    => 'datetime',
        'dispatched_at'    => 'datetime',
        'recipient_count'  => 'integer',
        'attachment_bytes' => 'integer',
    ];

    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }

    public function scopeQueued($query)
    {
        return $query->where('status', self::STATUS_QUEUED);
    }
}
