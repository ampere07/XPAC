<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Application extends Model
{
    use HasFactory;
    protected $table = 'applications';
    
    protected $primaryKey = 'id';
    public $timestamps = true;
    
    const CREATED_AT = 'created_at';
    const UPDATED_AT = 'updated_at';
    
    protected $fillable = [
        'timestamp',
        'email_address',
        'first_name',
        'middle_initial',
        'last_name',
        'mobile_number',
        'secondary_mobile_number',
        'installation_address',
        'landmark',
        'region',
        'city',
        'barangay',
        'location',
        'desired_plan',
        'promo',
        'referrer_account_id',
        'referred_by',
        'proof_of_billing_url',
        'government_valid_id_url',
        'secondary_government_valid_id_url',
        'house_front_picture_url',
        'promo_url',
        'nearest_landmark1_url',
        'nearest_landmark2_url',
        'document_attachment_url',
        'other_isp_bill_url',
        'terms_agreed',
        'status',
        'remarks',
        'pppoe_username',
        'pppoe_password',
        'created_by_user_id',
        'updated_by',
        'long_lat',
        'organization_id'
    ];
    
    protected $casts = [
        'id' => 'integer',
        'timestamp' => 'datetime:Y-m-d H:i:s',
        'terms_agreed' => 'boolean',
        'referrer_account_id' => 'integer',
        'created_by_user_id' => 'integer',
        'updated_by' => 'string',
        'created_at' => 'datetime:Y-m-d H:i:s',
        'updated_at' => 'datetime:Y-m-d H:i:s',
        'organization_id' => 'integer'
    ];

    protected $dateFormat = 'Y-m-d H:i:s';

    public function getDateFormat()
    {
        return 'Y-m-d H:i:s';
    }
    
    public function getFullNameAttribute()
    {
        return trim(
            $this->first_name . ' ' . 
            ($this->middle_initial ? $this->middle_initial . ' ' : '') . 
            $this->last_name
        );
    }
    
    public function getFormattedTimestampAttribute()
    {
        if (!$this->timestamp) {
            return null;
        }
        
        return $this->timestamp->format('m/d/Y H:i:s');
    }
}

