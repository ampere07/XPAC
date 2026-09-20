<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BillingDetails extends Model
{
    protected $table = 'Billing_Details';
    protected $primaryKey = 'Account_No';
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'Account_No',
        'Date_Installed',
        'Full_Name',
        'Contact_Number',
        'Email_Address',
        'Address',
        'Location',
        'Plan',
        'Provider',
        'Account_Balance',
        'Balance_Update_Date',
        'Username',
        'Connection_Type',
        'Router_Modem_SN',
        'IP',
        'LCP',
        'NAP',
        'PORT',
        'VLAN',
        'LCPNAP',
        'Status',
        'Group',
        'SPLYNX_ID',
        'MIKROTIK_ID',
        'Modified_By',
        'Modified_Date',
        'User_Email',
        'Billing_Day',
        'Billing_Status',
        'Delivery_Status',
        'Router_Model',
        'Barangay',
        'City',
        'Region',
        'LCPNAPPORT',
        'Usage_Type',
        'Renter',
        'Attachment_1',
        'Attachment_2',
        'Attachment_3',
        'Referred_By',
        'Second_Contact_Number',
        'Address_Coordinates',
        'Referrers_Account_Number',
        'House_Front_Picture'
    ];

    protected $casts = [
        'Account_Balance' => 'decimal:2',
        'Billing_Day' => 'integer',
        'Barangay' => 'integer',
        'Date_Installed' => 'datetime',
        'Balance_Update_Date' => 'datetime',
        'Modified_Date' => 'datetime'
    ];
}
