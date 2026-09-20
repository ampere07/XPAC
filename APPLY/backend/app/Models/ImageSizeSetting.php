<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ImageSizeSetting extends Model
{
    use HasFactory;

    protected $table = 'settings_image_size';

    protected $fillable = [
        'image_size',
        'image_size_value',
        'status'
    ];

    public static function getActiveSetting()
    {
        return self::where('status', 'active')->first();
    }

    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }
}
