<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ApplicationVisit extends Model
{
    protected $table = 'application_visits';
    
    protected $primaryKey = 'id';
    public $timestamps = true;
    
    const CREATED_AT = 'created_at';
    const UPDATED_AT = 'updated_at';
    
    protected $fillable = [
        'application_id',
        'timestamp',
        'assigned_email',
        'visit_by',
        'visit_with',
        'visit_with_other',
        'visit_status',
        'visit_remarks',
        'application_status',
        'status_remarks_id',
        'status_remarks',
        'image1_url',
        'image2_url',
        'image3_url',
        'house_front_picture_url',
        'created_by_user_email',
        'updated_by_user_email'
    ];
    
    protected $casts = [
        'id' => 'integer',
        'application_id' => 'integer',
        'timestamp' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime'
    ];
    
    public function application()
    {
        return $this->belongsTo(Application::class, 'application_id', 'id');
    }
    
    public function visitByUser()
    {
        return $this->belongsTo(User::class, 'visit_by', 'email_address');
    }
}
