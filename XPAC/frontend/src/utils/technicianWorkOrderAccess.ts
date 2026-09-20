// The technician queue rule, bound to Work Orders.
//
// The algorithm itself lives in technicianQueue.ts — this file says which columns
// a work order keeps its status and date in, and adds the one thing work orders
// need that the other two do not: an assignment filter.
//
// Job orders and service orders arrive from the API already scoped to the signed-in
// technician (the list request passes assigned_email). Work orders do not — the
// index endpoint returns the whole organisation and the clients narrow it
// themselves — so the lock has to be built from the technician's OWN records or it
// would grey out other people's work. buildTechnicianLockedWorkOrderIds() takes
// the viewer's identity for exactly that reason.
//
// Kept intentionally in sync with MOBILEAPP/frontend/src/utils/technicianWorkOrderAccess.ts,
// and with WorkOrderApiController::isWorkOrderLockedForTechnician(), which enforces
// the same rule server-side.

import {
  createTechnicianQueue,
  hasTimeValue,
  queueTimeFrom,
} from './technicianQueue';

export {
  TECHNICIAN_ROLE_ID,
  TECHNICIAN_LOCKED_MESSAGE,
  isTechnicianUser,
  isTechnicianEnabled,
} from './technicianQueue';

/**
 * Work statuses that finish a work order for good.
 *
 * Nothing is left for the technician to do, so the queue skips these and they
 * are never locked and never offered for release.
 *
 * Mirrors WorkOrder::TECHNICIAN_QUEUE_CLOSED_WORK_STATUSES on the server.
 */
const CLOSED_WORK_STATUSES = [
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
 * never blocking the work orders behind it — but resuming it is not their call:
 * it locks until it is the only thing left or an administrator releases it.
 *
 * Mirrors WorkOrder::TECHNICIAN_QUEUE_DEFERRED_WORK_STATUSES on the server.
 */
const DEFERRED_WORK_STATUSES = [
  'on hold',
  'onhold',
  'on-hold',
];

const QUEUE_EXEMPT_WORK_STATUSES = [
  ...CLOSED_WORK_STATUSES,
  ...DEFERRED_WORK_STATUSES,
];

/**
 * The work a technician is actively carrying out, which leads their list.
 *
 * Mirrors WorkOrder::TECHNICIAN_IN_PROGRESS_WORK_STATUSES on the server.
 */
const IN_PROGRESS_WORK_STATUSES = ['in progress', 'inprogress', 'in-progress'];

const workStatusOf = (wo: any): string =>
  String(wo?.work_status || wo?.workStatus || wo?.Work_Status || '').toLowerCase().trim();

/** Is the technician already in the middle of this work order? */
export const isTechnicianWorkInFlight = (wo: any): boolean => {
  const started = hasTimeValue(wo?.start_time) || hasTimeValue(wo?.startTime);
  const ended = hasTimeValue(wo?.end_time) || hasTimeValue(wo?.endTime);
  return started && !ended;
};

/**
 * The instant a work order belongs to, for queue ordering.
 *
 * Work orders have no separate timestamp column — requested_date IS the model's
 * CREATED_AT — so that is the ordering key, matching the server-side guard.
 */
export const technicianQueueTime = (wo: any): number =>
  queueTimeFrom(wo?.requested_date || wo?.requestedDate || wo?.created_at);

/** Who a work order is assigned to, normalised for comparison. */
const assignedTo = (wo: any): string =>
  String(wo?.assign_to || wo?.assignTo || '').toLowerCase().trim();

export interface TechnicianIdentity {
  email?: string | null;
  fullName?: string | null;
}

/**
 * Is this work order assigned to the given technician?
 *
 * assign_to holds either the assignee's email or their full name, so both are
 * accepted — exactly the comparison both Work Order pages already make when they
 * narrow the list for OSP and agent users.
 */
export const isAssignedToTechnician = (wo: any, identity: TechnicianIdentity): boolean => {
  const target = assignedTo(wo);
  if (!target) return false;

  const email = (identity.email || '').toLowerCase().trim();
  const fullName = (identity.fullName || '').toLowerCase().trim();

  return (!!email && target === email) || (!!fullName && target === fullName);
};

const queue = createTechnicianQueue({
  statusOf: workStatusOf,
  timeOf: technicianQueueTime,
  inProgress: IN_PROGRESS_WORK_STATUSES,
  exempt: QUEUE_EXEMPT_WORK_STATUSES,
  closed: CLOSED_WORK_STATUSES,
  inFlight: isTechnicianWorkInFlight,
});

export const isExemptFromTechnicianQueue = queue.isExempt;
export const isClosedForTechnicianQueue = queue.isClosed;
export const isInProgressForTechnician = queue.isInProgress;
export const technicianQueueRank = queue.rank;
export const sortWorkOrdersForTechnician = queue.sort;

/**
 * The ids a technician may NOT open, out of the work orders they can see.
 *
 * Pass their whole accessible set — not one page and not a search-filtered view.
 * Records assigned to somebody else are dropped before the queue is built, so
 * they are never locked and never affect whose turn it is.
 *
 * Without an identity nothing is locked: a viewer we cannot place must not have
 * someone else's queue applied to them.
 */
export const buildTechnicianLockedWorkOrderIds = (
  workOrders: any[],
  identity: TechnicianIdentity
): Set<string> => {
  if (!Array.isArray(workOrders) || workOrders.length === 0) return new Set<string>();
  if (!identity?.email && !identity?.fullName) return new Set<string>();

  return queue.buildLockedIds(workOrders.filter(wo => isAssignedToTechnician(wo, identity)));
};
