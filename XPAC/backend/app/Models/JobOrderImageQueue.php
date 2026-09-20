<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class JobOrderImageQueue extends Model
{
    use HasFactory;

    protected $table = 'job_order_images_queue';

    protected $fillable = [
        'organization_id',
        'job_order_id',
        'field_name',
        'local_path',
        'original_filename',
        'gdrive_url',
        'status',
        'error_message',
        'retry_count',
        'processed_at',
    ];

    protected $casts = [
        'processed_at' => 'datetime',
    ];

    public function jobOrder()
    {
        return $this->belongsTo(JobOrder::class, 'job_order_id');
    }

    public function markAsProcessing()
    {
        $this->update(['status' => 'processing']);
    }

    public function markAsCompleted(string $gdriveUrl)
    {
        $this->update([
            'status' => 'completed',
            'gdrive_url' => $gdriveUrl,
            'processed_at' => now(),
            'error_message' => null,
        ]);
    }

    public function markAsFailed(string $errorMessage)
    {
        $this->update([
            'status' => 'failed',
            'error_message' => $errorMessage,
            'retry_count' => $this->retry_count + 1,
        ]);
    }

    public function canRetry(int $maxRetries = 3): bool
    {
        return $this->status === 'failed' && $this->retry_count < $maxRetries;
    }

    public function resetForRetry()
    {
        $this->update([
            'status' => 'pending',
            'error_message' => null,
        ]);
    }
}
