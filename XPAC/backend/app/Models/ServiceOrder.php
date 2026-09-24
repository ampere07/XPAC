<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ServiceOrder extends Model
{
    /**
     * Specify the table name directly
     */
    protected $table = 'service_orders';

    protected $fillable = [
        'ticket_id',
        'Ticket_ID',
        'Timestamp',
        'Account_Number',
        'Full_Name',
        'Contact_Address',
        'Date_Installed',
        'Contact_Number',
        'Full_Address',
        'House_Front_Picture',
        'Email_Address',
        'Plan',
        'Provider',
        'Username',
        'Connection_Type',
        'Router_Modem_SN',
        'LCP',
        'NAP',
        'PORT',
        'VLAN',
        'Concern',
        'Concern_Remarks',
        'Visit_Status',
        'Visit_By',
        'Visit_With',
        'Visit_With_Other',
        'Visit_Remarks',
        'Modified_By',
        'Modified_Date',
        'User_Email',
        'Requested_By',
        'Assigned_Email',
        'Support_Remarks',
        'Service_Charge',
        'Repair_Category',
        'Support_Status',
        'status',
        'new_modem_router_sn',
        'new_lcpnsp',
        'new_plan',
        'old_lcp',
        'old_nap',
        'old_port',
        'old_router_modem_sn',
        'old_vlan',
        'new_router_modem_sn',
        'new_lcp',
        'new_nap',
        'new_port',
        'new_vlan',
        'router_model',
        'start_time',
        'end_time',
        'proof_image_url',
        'organization_id',
        'technicians',
        'speedtest_image_url',
        'setup_image_url',
        'box_reading_image_url',
        'router_reading_image_url',
    ];

    protected $dates = [
        'Timestamp',
        'Date_Installed',
        'Modified_Date',
        'created_at',
        'updated_at',
    ];
    
    protected $casts = [
        'technicians' => 'array',
    ];

    /**
     * The primary key for the model.
     *
     * @var string
     */
    protected $primaryKey = 'id';

    /**
     * Relationship to Application
     */
    public function application()
    {
        return $this->belongsTo(Application::class , 'Account_Number', 'id');
    }
}


