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
        // technician_enabled is deliberately NOT fillable: it is the flag that
        // releases a service order to a technician out of turn, so it must never
        // be settable through the generic update endpoint a technician also
        // calls. ServiceOrderApiController::enableForTechnician() sets it
        // directly.
        //
        // service_charge_status is NOT fillable for the same reason: it records
        // whether this order's charge has already reached the customer's
        // balance, and anything able to reset it to 'pending' can have the same
        // charge posted to the customer twice. ServiceOrderApiController's
        // claimServiceCharge() is the only thing that sets it.
    ];

    /**
     * Visit statuses that take a service order out of a technician's queue.
     *
     * A service order in one of these states has moved forward as far as the
     * technician is concerned. Nothing is left for them to do, so the queue
     * steps over these and they are never locked and never offered for release.
     * "Resolved" is here because the support side uses it for a closed ticket and
     * it can reach the visit column too.
     *
     * Mirrors CLOSED_VISIT_STATUSES in the two clients'
     * utils/technicianServiceOrderAccess.ts.
     */
    public const TECHNICIAN_QUEUE_CLOSED_VISIT_STATUSES = [
        'done',
        'completed',
        'resolved',
        'failed',
        'cancelled',
    ];

    /**
     * Visit statuses that defer a service order without closing it.
     *
     * A reschedule is a return visit the technician still owes. It keeps out of
     * the queue's way — never claiming the "next one" slot, never blocking the
     * service orders behind it — but it is not theirs to pick back up on their
     * own either: it stays locked until it is the only thing left in their queue
     * or an administrator releases it.
     *
     * Mirrors DEFERRED_VISIT_STATUSES in the two clients'
     * utils/technicianServiceOrderAccess.ts.
     */
    public const TECHNICIAN_QUEUE_DEFERRED_VISIT_STATUSES = [
        'reschedule',
        'rescheduled',
        're-schedule',
    ];

    /**
     * Everything the queue steps over, closed and deferred together.
     *
     * This is what decides the ORDER of a technician's list. What decides
     * whether a record is locked is the closed list alone — see
     * ServiceOrderApiController::isServiceOrderLockedForTechnician().
     */
    public const TECHNICIAN_QUEUE_EXEMPT_VISIT_STATUSES = [
        'done',
        'completed',
        'resolved',
        'failed',
        'cancelled',
        'reschedule',
        'rescheduled',
        're-schedule',
    ];

    /**
     * The visit work a technician is actively out on, which leads their list.
     *
     * "Scheduled" and "For Visit" are deliberately absent: they are
     * booked-but-not-started, so they belong with the rest of the active work
     * rather than ahead of a visit already under way.
     *
     * Mirrors IN_PROGRESS_VISIT_STATUSES in the two clients'
     * utils/technicianServiceOrderAccess.ts.
     */
    public const TECHNICIAN_IN_PROGRESS_VISIT_STATUSES = [
        'in progress',
        'inprogress',
        'in-progress',
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
        'technician_enabled' => 'boolean',
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


