// The technician queue rule, bound to Service Orders.
//
// The algorithm itself lives in technicianQueue.ts — this file only says which
// columns a service order keeps its status and date in. See that file for what
// the queue actually does.
//
// Kept intentionally in sync with ATSS2_0/frontend/src/utils/technicianServiceOrderAccess.ts,
// and with ServiceOrderApiController::isServiceOrderLockedForTechnician(), which
// enforces the same rule server-side.

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
 * Visit statuses that finish a service order for good.
 *
 * Nothing is left for the technician to do, so the queue skips these and they
 * are never locked and never offered for release. "Resolved" appears because the
 * support side uses it for a closed ticket and it can reach the visit column too.
 *
 * Mirrors ServiceOrder::TECHNICIAN_QUEUE_CLOSED_VISIT_STATUSES on the server.
 */
const CLOSED_VISIT_STATUSES = [
  'done',
  'completed',
  'resolved',
  'failed',
  'cancelled',
];

/**
 * Visit statuses that defer a service order without closing it.
 *
 * A reschedule is a return visit the technician still owes. It keeps out of the
 * queue's way — never claiming the "next one" slot, never blocking the service
 * orders behind it — but it is not theirs to pick back up on their own: it locks
 * until it is the only thing left or an administrator releases it.
 *
 * Mirrors ServiceOrder::TECHNICIAN_QUEUE_DEFERRED_VISIT_STATUSES on the server.
 */
const DEFERRED_VISIT_STATUSES = [
  'reschedule',
  'rescheduled',
  're-schedule',
];

const QUEUE_EXEMPT_VISIT_STATUSES = [
  ...CLOSED_VISIT_STATUSES,
  ...DEFERRED_VISIT_STATUSES,
];

/**
 * The work a technician is actively out on, which leads their list.
 *
 * "Scheduled" and "For Visit" deliberately sit OUTSIDE this list: they are
 * booked-but-not-started, so they belong with the rest of the active work rather
 * than ahead of a visit already under way. The server treats them the same way
 * (see the assigned_email branch of ServiceOrderApiController::index).
 *
 * Mirrors ServiceOrder::TECHNICIAN_IN_PROGRESS_VISIT_STATUSES on the server.
 */
const IN_PROGRESS_VISIT_STATUSES = ['in progress', 'inprogress', 'in-progress'];

const visitStatusOf = (so: any): string =>
  String(so?.visitStatus || so?.visit_status || so?.Visit_Status || '').toLowerCase().trim();

/** Is the technician already in the middle of this service order? */
export const isTechnicianWorkInFlight = (so: any): boolean => {
  const started = hasTimeValue(so?.start_time) || hasTimeValue(so?.startTime);
  const ended = hasTimeValue(so?.end_time) || hasTimeValue(so?.endTime);
  return started && !ended;
};

/**
 * The instant a service order belongs to, for queue ordering.
 *
 * The ticket's own timestamp — when it was raised — falling back to when the row
 * was created, matching COALESCE(timestamp, created_at) in the server-side
 * guard and the existing list sort on both clients.
 */
export const technicianQueueTime = (so: any): number =>
  queueTimeFrom(so?.timestamp || so?.Timestamp || so?.createdAt || so?.created_at);

const queue = createTechnicianQueue({
  statusOf: visitStatusOf,
  timeOf: technicianQueueTime,
  inProgress: IN_PROGRESS_VISIT_STATUSES,
  exempt: QUEUE_EXEMPT_VISIT_STATUSES,
  closed: CLOSED_VISIT_STATUSES,
  inFlight: isTechnicianWorkInFlight,
});

export const isExemptFromTechnicianQueue = queue.isExempt;
export const isClosedForTechnicianQueue = queue.isClosed;
export const isInProgressForTechnician = queue.isInProgress;
export const technicianQueueRank = queue.rank;
export const sortServiceOrdersForTechnician = queue.sort;
export const buildTechnicianLockedServiceOrderIds = queue.buildLockedIds;
