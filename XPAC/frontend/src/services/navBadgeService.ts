import apiClient from '../config/api';

/**
 * Attention counts behind the sidebar menu badges and the header bell.
 *
 * One request for all five, matching the single backend endpoint — the sidebar renders every
 * badge on the same paint, and five parallel polls on an interval is not worth the traffic.
 */
export interface NavBadgeCounts {
  /** Applications with status 'Pending' — awaiting review. */
  application: number;
  /** Job Orders where billing_status is In Progress AND onsite_status is Done. */
  job_order: number;
  /** Service Orders whose support_status is not yet Resolved/Failed/Cancelled. */
  service_order: number;
  /** Work Orders still Pending or In Progress. */
  work_order: number;
  /** Transactions awaiting approval or processing (Pending / QUEUED). */
  transaction: number;
  /** Sum of the five — what the header bell shows. */
  total: number;
}

export const EMPTY_NAV_BADGE_COUNTS: NavBadgeCounts = {
  application: 0,
  job_order: 0,
  service_order: 0,
  work_order: 0,
  transaction: 0,
  total: 0,
};

/**
 * Feeds the sidebar badges and the header bell.
 *
 * Swallows failures and reports zeroes, deliberately — the same reasoning as
 * getPayableAlertCount(): a badge that cannot load must never surface an error over whatever
 * page the user is actually working on. Zeroes render as no badge, which is also what the UI
 * shows before the first response lands, so a failure degrades to the pre-load state rather
 * than to anything misleading.
 */
export const getNavBadgeCounts = async (): Promise<NavBadgeCounts> => {
  try {
    const response = await apiClient.get<{ success: boolean; data: NavBadgeCounts }>(
      '/notifications/nav-badges'
    );

    if (response.data?.data) {
      // Spread over the empty shape so a partial payload from an older backend cannot leave a
      // field undefined and render "NaN" in a pill.
      return { ...EMPTY_NAV_BADGE_COUNTS, ...response.data.data };
    }
  } catch (error) {
    // Intentionally quiet.
  }

  return EMPTY_NAV_BADGE_COUNTS;
};
