<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FormUI extends Model
{
    protected $table = 'form_ui';
    
    public $timestamps = false;
    
    protected $fillable = [
        'page_hex',
        'button_hex',
        'logo_url',
        'multi_step',
        'brand_name',
        'transparency_rgba',
        'form_hex'
    ];
}
