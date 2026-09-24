<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class JobOrder extends Model
{
    protected $table = 'job_orders';

    /**
     * The state every newly created PPPoE account starts in.
     *
     * A PPPoE account exists from the moment credentials are generated, but
     * existing is not the same as being entitled to service: the customer has
     * not paid yet, and nothing about generating a username says they have.
     * Creating the RADIUS user straight into its plan group would hand out full
     * bandwidth at the moment a technician filled in a form, which is why the
     * account is created here and activated somewhere else entirely.
     *
     * Activation is downstream and deliberate — ManualRadiusOperationsService
     * ::reconnectUser, called from the payment pipelines (PaymentWorkerService
     * and TransactionController) once money has actually landed. That call is
     * what moves the RADIUS user into the plan group.
     *
     * The string matches the RADIUS profile group name and the billing status
     * vocabulary the rest of the app compares against, so the same value is
     * correct on job_orders.username_status, technical_details.username_status
     * and in the RADIUS payload.
     */
    public const USERNAME_STATUS_RESTRICTED = 'Restricted';

    /**
     * The state an account reaches once RADIUS has confirmed it is on its plan group.
     *
     * The counterpart to the constant above, and written only after the network says so —
     * a VIP approval that reconnects successfully, where nothing else would ever move the
     * account off Restricted. Left unwritten by a failed or queued reconnect, so the column
     * keeps reading Restricted for exactly as long as the customer really is.
     *
     * Deliberately 'Active' rather than the plan name. The column is displayed as a status
     * on the job order, customer and billing screens and is offered as a filter option
     * (RelatedDataController builds that list from its distinct values); writing plan names
     * into it would turn a two-value status into one option per plan.
     */
    public const USERNAME_STATUS_ACTIVE = 'Active';

    protected $fillable = [
        'application_id',
        'account_id',
        'status',
        'timestamp',
        'date_installed',
        'installation_fee',
        'billing_day',
        'billing_status',
        'generation_type',
        // Legacy free-text VAT mode, still written alongside vat_enabled so older readers of the
        // job order (details view, exports) keep working.
        'vat_type',
        'vat_enabled',
        'withholding_enabled',
        'withholding_percentage',
        // VIP captured up front on the JO Assign Form. Copied verbatim onto the billing account
        // at approval, which is also created with the VIP billing status — same VIP mechanism as
        // before, just no longer needing a manual edit after approval.
        'vip_enabled',
        'vip_expiration',
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
        // NOT fillable, deliberately: commission_value, incentive_value,
        // agent_paid_at, agent_paid_to. They record what this job order settled
        // with its referring agent and are written only by
        // JobOrderAgentPaymentService via forceFill(). JobOrderController::update()
        // fills from $request->all(), so making them fillable would let any edit
        // form clear agent_paid_at (and get the agent paid twice) or 500 on a
        // database where the 2026_08_14 migration has not run yet.
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
        'vat_enabled' => 'boolean',
        'withholding_enabled' => 'boolean',
        'withholding_percentage' => 'decimal:2',
        'vip_enabled' => 'boolean',
        'vip_expiration' => 'datetime',
        'commission_value' => 'decimal:2',
        'incentive_value' => 'decimal:2',
        'agent_paid_at' => 'datetime',
        'agent_paid_to' => 'integer',
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


