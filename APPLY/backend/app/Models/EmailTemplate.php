<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class EmailTemplate extends Model
{
    use HasFactory;

    protected $table = 'email_templates';

    protected $primaryKey = 'Template_Code';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = [
        'Template_Code',
        'Subject_Line',
        'cc',
        'bcc',
        'email_sender',
        'sender_name',
        'reply_to',
        'Body_HTML',
        'Description',
        'Is_Active',
        'email_body'
    ];

    protected $casts = [
        'Is_Active' => 'boolean',
        'Body_HTML' => 'string'
    ];
}

