<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MassRebate extends Model
{
    protected $table = 'rebates';

    protected $fillable = [
        'number_of_dates',
        'rebate_type',
        'selected_rebate',
        'month',
        'status',
        'created_by',
        'modified_by',
        'modified_date',
        'organization_id'
    ];

    protected $casts = [
        'number_of_dates' => 'integer'
    ];

    public $timestamps = false;

    const STATUS_UNUSED = 'Unused';
    const STATUS_USED = 'Used';

    const TYPE_LCPNAP = 'lcpnap';
    const TYPE_LCP = 'lcp';
    const TYPE_LOCATION = 'location';

    protected static function boot()
    {
        parent::boot();

        static::creating(function ($model) {
            $model->modified_date = now()->format('Y-m-d H:i:s');
        });

        static::updating(function ($model) {
            $model->modified_date = now()->format('Y-m-d H:i:s');
        });
    }

    public function scopeUnused($query)
    {
        return $query->where('status', self::STATUS_UNUSED);
    }

    public function scopeUsed($query)
    {
        return $query->where('status', self::STATUS_USED);
    }

    public function scopeByType($query, $type)
    {
        return $query->where('rebate_type', $type);
    }

    public function scopeByRebate($query, $rebateName)
    {
        return $query->where('selected_rebate', 'like', "%{$rebateName}%");
    }

    public function markAsUsed()
    {
        $this->status = self::STATUS_USED;
        return $this->save();
    }

    public function isUsed()
    {
        return $this->status === self::STATUS_USED;
    }

    public function isUnused()
    {
        return $this->status === self::STATUS_UNUSED;
    }

    public function usages()
    {
        return $this->hasMany(RebateUsage::class, 'rebates_id');
    }
}
