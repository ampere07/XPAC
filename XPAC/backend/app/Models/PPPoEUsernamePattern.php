<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PPPoEUsernamePattern extends Model
{
    protected $table = 'pppoe_username_patterns';

    protected $fillable = [
        'pattern_name',
        'pattern_type',
        'sequence',
        'created_by',
        'updated_by'
    ];

    protected $appends = ['has_custom_password', 'has_tech_input'];

    protected $casts = [
        'sequence' => 'array'
    ];

    public $timestamps = true;

    const CREATED_AT = 'created_at';
    const UPDATED_AT = 'updated_at';

    const TYPE_USERNAME = 'username';
    const TYPE_PASSWORD = 'password';

    public static function getAvailableTypes(): array
    {
        return [
            self::TYPE_USERNAME,
            self::TYPE_PASSWORD
        ];
    }

    public function scopeByType($query, string $type)
    {
        return $query->where('pattern_type', $type);
    }

    public static function getUsernamePattern()
    {
        return self::where('pattern_type', self::TYPE_USERNAME)->first();
    }

    public static function getPasswordPattern()
    {
        return self::where('pattern_type', self::TYPE_PASSWORD)->first();
    }

    public function getHasCustomPasswordAttribute(): bool
    {
        if (!is_array($this->sequence)) {
            return false;
        }

        foreach ($this->sequence as $item) {
            if (isset($item['type']) && $item['type'] === 'custom_password') {
                return true;
            }
        }

        return false;
    }

    public function getHasTechInputAttribute(): bool
    {
        if (!is_array($this->sequence)) {
            return false;
        }

        foreach ($this->sequence as $item) {
            if (isset($item['type']) && $item['type'] === 'tech_input') {
                return true;
            }
        }

        return false;
    }
}
