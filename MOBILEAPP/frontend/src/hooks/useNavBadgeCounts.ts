import { useMemo } from 'react';
import { useJobOrderContext } from '../contexts/JobOrderContext';
import { useServiceOrderContext } from '../contexts/ServiceOrderContext';
import { getOnsiteStatus } from '../utils/agentReferral';

/**
 * Counts for the bottom-bar badges: outstanding work in each section.
 *
 * Read from the same contexts the Job Order and Service Order pages render from,
 * rather than counted with their own request. Those contexts already scope to the
 * signed-in technician's assigned_email and already auto-fetch, so the badge
 * cannot disagree with the list behind the tab, costs no extra network call, and
 * updates the moment either list refreshes.
 *
 * "Outstanding" rather than "every row": a badge is a prompt to act, and jobs
 * finished days ago are not. The Job Order page hides completed work from
 * technicians for the same reason, so counting it would put a number on the tab
 * that the list does not account for.
 */
export interface NavBadgeCounts {
  'job-order': number;
  'service-order': number;
}

/** Onsite/visit states that mean the work is finished and needs no prompting. */
const CLOSED_STATES = new Set([
  'done', 'completed', 'complete', 'failed', 'cancelled', 'canceled',
]);

const isOutstanding = (status: string): boolean => {
  const normalised = (status || '').toLowerCase().trim().replace(/[\s_-]/g, '');
  if (!normalised) return true;   // Not yet touched — still outstanding.
  return !CLOSED_STATES.has(normalised);
};

/**
 * @param enabled Whether to count at all. False for roles whose sections are not
 *                a personal work queue — an administrator's tabs list every record
 *                in the system, where a badge in the thousands means nothing.
 */
export const useNavBadgeCounts = (enabled: boolean): NavBadgeCounts => {
  const { jobOrders } = useJobOrderContext();
  const { serviceOrders } = useServiceOrderContext();

  return useMemo(() => {
    if (!enabled) return { 'job-order': 0, 'service-order': 0 };

    const jobOrderCount = (Array.isArray(jobOrders) ? jobOrders : [])
      .filter(order => isOutstanding(getOnsiteStatus(order))).length;

    const serviceOrderCount = (Array.isArray(serviceOrders) ? serviceOrders : [])
      .filter((order: any) => isOutstanding(order?.visitStatus ?? order?.visit_status ?? '')).length;

    return { 'job-order': jobOrderCount, 'service-order': serviceOrderCount };
  }, [enabled, jobOrders, serviceOrders]);
};

export default useNavBadgeCounts;
