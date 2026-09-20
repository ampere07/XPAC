<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FormUI extends Model
{
    use HasFactory;

    protected $table = 'form_ui';

    protected $fillable = [
        'page_hex',
        'button_hex',
        'logo_url',
        'multi_step',
        'brand_name',
        'transparency_rgba',
        'form_hex',
        'proof_of_billing',
        'id_primary',
        'id_secondary',
        'house_front_',
        'secondary_number',
        'captcha',
        'terms_and_condition',
        'privacy_policy',
        'contact_information',
        'submit_modal',
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];
}

