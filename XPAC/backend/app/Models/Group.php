<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Group extends Model
{
    use HasFactory;

    protected $primaryKey = 'group_id';
    protected $table = 'groups';

    protected $fillable = [
        'group_name',
        'fb_page_link',
        'fb_messenger_link',
        'template',
        'company_name',
        'portal_url',
        'hotline',
        'email',
        'org_id',
        'modified_by_user_id',
        'modified_date',
    ];

    public function users()
    {
        return $this->hasMany(User::class, 'group_id', 'group_id');
    }

    public function organization()
    {
        return $this->belongsTo(Organization::class, 'org_id', 'id');
    }
}
