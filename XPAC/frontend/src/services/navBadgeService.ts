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
  /** Prepaid Override requests still Pending a decision. */
  prepaid_override: number;
  /** Sum of all of the above — what the header bell shows. */
  total: number;
  /**
   * Records in the For Approval queue: Pending transactions plus Done job orders not yet
   * approved. Not part of `total` — those rows are already counted by the badges above.
   * 0 for anyone who cannot open the page.
   */
  for_approval: number;
  /**
   * Transaction revert requests still Pending a decision. Not part of `total` — the bell already
   * lists them in its feed. 0 for anyone who cannot open Revert Requests.
   */
  transaction_revert: number;
}

export const EMPTY_NAV_BADGE_COUNTS: NavBadgeCounts = {
  application: 0,
  job_order: 0,
  service_order: 0,
  work_order: 0,
  transaction: 0,
  prepaid_override: 0,
  total: 0,
  for_approval: 0,
  transaction_revert: 0,
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

/**
 * Fired after a Prepaid Override or transaction revert request is submitted or decided, or a
 * record is approved from For Approval, so the sidebar badges refresh at once.
 */
export const NAV_BADGES_CHANGED_EVENT = "nav-badges-changed";

export const notifyNavBadgesChanged = (): void => {
  try {
    window.dispatchEvent(new Event(NAV_BADGES_CHANGED_EVENT));
  } catch {
    // Intentionally quiet: a badge refresh is never worth an error.
  }
};
