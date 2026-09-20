// The technician queue rule, bound to Job Orders.
//
// The algorithm itself lives in technicianQueue.ts — this file only says which
// columns a job order keeps its status and date in. See that file for what the
// queue actually does.
//
// Kept intentionally in sync with ATSS2_0/frontend/src/utils/technicianJobOrderAccess.ts,
// and with JobOrderController::isJobOrderLockedForTechnician(), which enforces
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
 * Onsite statuses that finish a job order for good.
 *
 * Nothing is left for the technician to do, so the queue skips these and they
 * are never locked and never offered for release.
 *
 * Cancelled travels with failed, the way the rest of the app already groups the
 * two (see the Job Order sidebar's status buckets).
 *
 * Mirrors JobOrder::TECHNICIAN_QUEUE_CLOSED_ONSITE_STATUSES on the server.
 */
const CLOSED_ONSITE_STATUSES = [
  'done',
  'completed',
  'failed',
  'cancelled',
];

/**
 * Onsite statuses that defer a job order without closing it.
 *
 * A reschedule is work the technician still owes, waiting on a return visit. It
 * keeps out of the queue's way — it never claims the "next one" slot and never
 * blocks the job orders behind it — but it is not theirs to pick back up on
 * their own: it locks until it is the only thing left or an administrator
 * releases it.
 *
 * Mirrors JobOrder::TECHNICIAN_QUEUE_DEFERRED_ONSITE_STATUSES on the server.
 */
const DEFERRED_ONSITE_STATUSES = [
  'reschedule',
  'rescheduled',
  're-schedule',
];

const QUEUE_EXEMPT_ONSITE_STATUSES = [
  ...CLOSED_ONSITE_STATUSES,
  ...DEFERRED_ONSITE_STATUSES,
];

/**
 * The work a technician is actively out on, which leads their list.
 *
 * Mirrors JobOrder::TECHNICIAN_IN_PROGRESS_ONSITE_STATUSES on the server.
 */
const IN_PROGRESS_ONSITE_STATUSES = ['in progress', 'inprogress', 'in-progress'];

const onsiteStatusOf = (jo: any): string =>
  String(jo?.Onsite_Status || jo?.onsite_status || '').toLowerCase().trim();

/** Is the technician already in the middle of this job order? */
export const isTechnicianWorkInFlight = (jo: any): boolean => {
  const started = hasTimeValue(jo?.start_time) || hasTimeValue(jo?.StartTimeStamp) || hasTimeValue(jo?.start_timestamp);
  const ended = hasTimeValue(jo?.end_time) || hasTimeValue(jo?.EndTimeStamp) || hasTimeValue(jo?.end_timestamp);
  return started && !ended;
};

/**
 * The instant a job order belongs to, for queue ordering.
 *
 * The job order's own timestamp — when the record was raised — falling back to
 * when the row was created, matching COALESCE(timestamp, created_at) in the
 * server-side guard.
 */
export const technicianQueueTime = (jo: any): number =>
  queueTimeFrom(jo?.Timestamp || jo?.timestamp || jo?.created_at || jo?.Created_At);

const queue = createTechnicianQueue({
  statusOf: onsiteStatusOf,
  timeOf: technicianQueueTime,
  inProgress: IN_PROGRESS_ONSITE_STATUSES,
  exempt: QUEUE_EXEMPT_ONSITE_STATUSES,
  closed: CLOSED_ONSITE_STATUSES,
  inFlight: isTechnicianWorkInFlight,
});

export const isExemptFromTechnicianQueue = queue.isExempt;
export const isClosedForTechnicianQueue = queue.isClosed;
export const isInProgressForTechnician = queue.isInProgress;
export const technicianQueueRank = queue.rank;
export const sortJobOrdersForTechnician = queue.sort;
export const buildTechnicianLockedJobOrderIds = queue.buildLockedIds;
