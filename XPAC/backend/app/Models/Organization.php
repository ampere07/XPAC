<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Organization extends Model
{
    use HasFactory;

    protected $primaryKey = 'id';
    protected $table = 'organizations';
    public $timestamps = true;


    protected $fillable = [
        'organization_name',
        'address',
        'contact_number',
        'email_address',
        'created_by_user_id',
        'updated_by_user_id',
        'organization_id',
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function users()
    {
        return $this->hasMany(User::class, 'organization_id', 'id');
    }
}
