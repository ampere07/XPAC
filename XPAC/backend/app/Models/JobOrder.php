<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class JobOrder extends Model
{
    protected $table = 'job_orders';

    protected $fillable = [
        'application_id',
        'account_id',
        'status',
        'timestamp',
        'date_installed',
        'installation_fee',
        'billing_day',
        'billing_status',
        'modem_router_sn',
        'router_model',
        'group_name',
        'lcpnap',
        'port',
        'vlan',
        'username',
        'ip_address',
        'connection_type',
        'usage_type',
        'username_status',
        'visit_by',
        'visit_with',
        'visit_with_other',
        'onsite_status',
        'assigned_email',
        'status_remarks',
        // The written record of what happened on site. A job order has this one
        // remarks column and no other — visit notes belong here too. Service
        // Orders are the ones that carry a separate Visit_Remarks.
        'onsite_remarks',
        'status_remarks_id',
        'address_coordinates',
        'contract_link',
        'client_signature_url',
        'setup_image_url',
        'speedtest_image_url',
        'signed_contract_image_url',
        'box_reading_image_url',
        'router_reading_image_url',
        'port_label_image_url',
        'house_front_picture_url',
        'installation_landmark',
        'pppoe_username',
        'pppoe_password',
        'created_by_user_email',
        'updated_by_user_email',
        'start_time',
        'end_time',
        'proof_image_url',
        'client_tagging_url',
        'organization_id',
        'technicians',
        'commission_status',
        // What this job order settled with its referring agent, and the rates
        // it settled at. Snapshots: an administrator changing either setting
        // later must not restate a job order already paid.
        'commission_value',
        'incentive_value',
        'agent_paid_at',
        'agent_paid_to',
        // Pre-installation visit: the marker, the note taken at the time, and
        // when it was recorded. Kept apart from onsite_status/onsite_remarks
        // because a pre-install happens BEFORE the install proper, and writing
        // it into those would overwrite the record of the install itself.
        'pre_installed',
        'pre_remarks',
        'pre_installed_datetime',
        // Who recorded it, by email. Stamped by the controller from the signed-in
        // user, never taken from the request — see JobOrderController::update().
        'preinstalled_updated_by',
        // technician_enabled is deliberately NOT fillable: it is the flag that
        // releases a job order to a technician out of turn, so it must never be
        // settable through the generic update endpoint a technician also calls.
        // JobOrderController::enableForTechnician() assigns it directly.
    ];

    protected $dates = [
        'timestamp',
        'date_installed',
        'created_at',
        'updated_at',
    ];

    protected $casts = [
        'installation_fee' => 'decimal:2',
        'billing_day' => 'integer',
        'timestamp' => 'datetime',
        'date_installed' => 'datetime',
        'organization_id' => 'integer',
        'technicians' => 'array',
        'commission_value' => 'decimal:2',
        'incentive_value' => 'decimal:2',
        'agent_paid_at' => 'datetime',
        'agent_paid_to' => 'integer',
        'technician_enabled' => 'boolean',
        'pre_installed_datetime' => 'datetime',
    ];

    /**
     * Onsite statuses that finish a job order for good.
     *
     * Nothing is left for the technician to do, so the queue steps over these
     * and they are never locked and never offered for release.
     *
     * Mirrors CLOSED_ONSITE_STATUSES in the two clients'
     * utils/technicianJobOrderAccess.ts.
     */
    public const TECHNICIAN_QUEUE_CLOSED_ONSITE_STATUSES = [
        'done',
        'completed',
        'failed',
        'cancelled',
    ];

    /**
     * Onsite statuses that defer a job order without closing it.
     *
     * A reschedule is work the technician still owes, waiting on a return visit.
     * It keeps out of the queue's way — it never claims the "next one" slot and
     * never blocks the job orders behind it — but it is not theirs to pick back
     * up on their own either: it stays locked until it is the only thing left in
     * their queue or an administrator releases it.
     *
     * Mirrors DEFERRED_ONSITE_STATUSES in the two clients'
     * utils/technicianJobOrderAccess.ts.
     */
    public const TECHNICIAN_QUEUE_DEFERRED_ONSITE_STATUSES = [
        'reschedule',
        'rescheduled',
        're-schedule',
    ];

    /**
     * Everything the queue steps over, closed and deferred together.
     *
     * This is what decides the ORDER of a technician's list. What decides
     * whether a record is locked is the closed list alone — see
     * JobOrderController::isJobOrderLockedForTechnician().
     */
    public const TECHNICIAN_QUEUE_EXEMPT_ONSITE_STATUSES = [
        'done',
        'completed',
        'failed',
        'cancelled',
        'reschedule',
        'rescheduled',
        're-schedule',
    ];

    /**
     * The work a technician is actively out on, which leads their list.
     *
     * Mirrors IN_PROGRESS_ONSITE_STATUSES in the two clients'
     * utils/technicianJobOrderAccess.ts.
     */
    public const TECHNICIAN_IN_PROGRESS_ONSITE_STATUSES = [
        'in progress',
        'inprogress',
        'in-progress',
    ];

    public function application()
    {
        return $this->belongsTo(Application::class , 'application_id', 'id');
    }

    public function items()
    {
        return $this->hasMany(JobOrderItem::class , 'job_order_id', 'id');
    }

    public function lcpnapLocation()
    {
        return $this->belongsTo(LCPNAPLocation::class , 'lcpnap', 'lcpnap_name');
    }

    public function billingAccount()
    {
        return $this->belongsTo(BillingAccount::class, 'account_id', 'id');
    }
}


