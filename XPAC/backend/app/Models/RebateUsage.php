<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RebateUsage extends Model
{
    protected $table = 'rebates_usage';

    protected $fillable = [
        'rebates_id',
        'account_no',
        'status',
        'month'
    ];

    public $timestamps = false;

    const STATUS_UNUSED = 'Unused';
    const STATUS_USED = 'Used';

    public function rebate()
    {
        return $this->belongsTo(MassRebate::class, 'rebates_id');
    }

    public function scopeUnused($query)
    {
        return $query->where('status', self::STATUS_UNUSED);
    }

    public function scopeUsed($query)
    {
        return $query->where('status', self::STATUS_USED);
    }

    public function markAsUsed()
    {
        $this->status = self::STATUS_USED;
        return $this->save();
    }
}
