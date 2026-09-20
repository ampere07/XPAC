<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WorkOrder extends Model
{
    protected $table = 'work_order';

    const CREATED_AT = 'requested_date';
    const UPDATED_AT = 'updated_date';

    protected $fillable = [
        'instructions',
        'report_to',
        'assign_to',
        'remarks',
        'work_status',
        'work_category',
        'image_1',
        'image_2',
        'image_3',
        'signature',
        'requested_by',
        'updated_by',
        'start_time',
        'end_time',
        'organization_id'
        // technician_enabled is deliberately NOT fillable: it is the flag that
        // releases a work order to a technician out of turn, so it must never be
        // settable through the generic update endpoint a technician also calls.
        // WorkOrderApiController::enableForTechnician() sets it directly.
    ];

    protected $casts = [
        'organization_id' => 'integer',
        'technician_enabled' => 'boolean'
    ];

    /**
     * Work statuses that finish a work order for good.
     *
     * Nothing is left for the technician to do, so the queue steps over these
     * and they are never locked and never offered for release.
     *
     * Mirrors CLOSED_WORK_STATUSES in the two clients'
     * utils/technicianWorkOrderAccess.ts.
     */
    public const TECHNICIAN_QUEUE_CLOSED_WORK_STATUSES = [
        'done',
        'completed',
        'failed',
        'cancelled',
    ];

    /**
     * Work statuses that defer a work order without closing it.
     *
     * "On Hold" is work the technician still owes, paused on something other than
     * them. It keeps out of the queue's way — never claiming the "next one" slot,
     * never blocking the work orders behind it — but resuming it is not their
     * call: it stays locked until it is the only thing left in their queue or an
     * administrator releases it.
     *
     * Mirrors DEFERRED_WORK_STATUSES in the two clients'
     * utils/technicianWorkOrderAccess.ts.
     */
    public const TECHNICIAN_QUEUE_DEFERRED_WORK_STATUSES = [
        'on hold',
        'onhold',
        'on-hold',
    ];

    /**
     * Everything the queue steps over, closed and deferred together.
     *
     * This is what decides the ORDER of a technician's list. What decides
     * whether a record is locked is the closed list alone — see
     * WorkOrderApiController::isWorkOrderLockedForTechnician().
     */
    public const TECHNICIAN_QUEUE_EXEMPT_WORK_STATUSES = [
        'done',
        'completed',
        'failed',
        'cancelled',
        'on hold',
        'onhold',
        'on-hold',
    ];

    /**
     * The work a technician is actively carrying out, which leads their list.
     *
     * Mirrors IN_PROGRESS_WORK_STATUSES in the two clients'
     * utils/technicianWorkOrderAccess.ts.
     */
    public const TECHNICIAN_IN_PROGRESS_WORK_STATUSES = [
        'in progress',
        'inprogress',
        'in-progress',
    ];
}
