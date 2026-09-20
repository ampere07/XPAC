<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ImageQueue extends Model
{
    use HasFactory;

    protected $table = 'images_queue';

    protected $fillable = [
        'organization_id',
        'application_id',
        'table_process',
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
}
