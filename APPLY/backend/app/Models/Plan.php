<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    protected $table = 'plan_list';
    public $timestamps = false;

    protected $fillable = [
        'plan_name',
        'description',
        'price',
        'group_id',
        'show_in_application',
        'modified_by_user_id',
        'modified_date',
    ];

    protected $casts = [
        'price' => 'decimal:2',
        'show_in_application' => 'boolean',
    ];

    /**
     * Plans an applicant is allowed to pick on the public form.
     *
     * Internal-only packages (VIP, work-from-home) are hidden by unticking "Show in Application"
     * on the plan in GOWISER. The column is shared with that app, which is where it is edited.
     */
    public function scopeVisibleInApplication($query)
    {
        return $query->where('show_in_application', true);
    }
}
