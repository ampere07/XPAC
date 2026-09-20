<?php

namespace App\Models;

use App\Support\TextNormalizer;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Application extends Model
{
    use HasFactory;

    protected $table = 'applications';
    
    public $timestamps = true;

    protected $fillable = [
        'timestamp',
        'email_address',
        'first_name',
        'middle_initial',
        'last_name',
        'mobile_number',
        'secondary_mobile_number',
        'installation_address',
        'long_lat',
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
        'second_government_valid_id_url',
        'house_front_picture_url',
        'document_attachment_url',
        'other_isp_bill_url',
        'promo_url',
        'terms_agreed',
        'status',
        'created_by_user_id',
        'updated_by_user_id',
    ];

    protected $casts = [
        'terms_agreed' => 'boolean',
        'timestamp' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => 'pending',
        'terms_agreed' => false,
        'promo' => 'None',
    ];

    /**
     * Attributes exempt from text normalization. These hold generated
     * file paths and Google Drive links rather than anything an applicant
     * typed, so they are stored exactly as produced.
     *
     * @var array<int, string>
     */
    protected const RAW_ATTRIBUTES = [
        'proof_of_billing_url',
        'government_valid_id_url',
        'second_government_valid_id_url',
        'house_front_picture_url',
        'document_attachment_url',
        'other_isp_bill_url',
        'promo_url',
    ];

    /**
     * Applicants fill this form on their phones, and a styled keyboard turns
     * plain letters into Mathematical Alphanumeric look-alikes. The request
     * middleware already folds those back, but the model is the last gate
     * before the row is written, so anything arriving from a console command,
     * an import or a seeder is normalized here too.
     *
     * @param  string  $key
     * @param  mixed  $value
     * @return mixed
     */
    public function setAttribute($key, $value)
    {
        if (is_string($value) && !in_array($key, static::RAW_ATTRIBUTES, true)) {
            $value = TextNormalizer::normalize($value);
        }

        return parent::setAttribute($key, $value);
    }

    /**
     * Generate a unique 7-digit application ID
     */
    public static function generateUniqueApplicationId()
    {
        do {
            $applicationId = rand(1000000, 9999999);
        } while (self::where('id', $applicationId)->exists());
        
        return $applicationId;
    }

    public function scopeByStatus($query, $status)
    {
        return $query->where('status', $status);
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeApproved($query)
    {
        return $query->where('status', 'approved');
    }

    public function scopeRejected($query)
    {
        return $query->where('status', 'rejected');
    }
}
