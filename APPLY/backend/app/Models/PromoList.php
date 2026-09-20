<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PromoList extends Model
{
    use HasFactory;

    protected $table = 'promo_list';

    protected $fillable = [
        'name',
        'status',
        'created_by_user_id',
        'updated_by_user_id',
    ];
}
