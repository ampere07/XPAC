/**
 * One reading of "is this account active" and "is this subscriber online", shared by
 * every details panel that renders a customer summary.
 *
 * These two questions are unrelated and were previously answered from the same field:
 * the panels derived BOTH the account status and the session status from
 * `billingStatusId`, so a paid-up subscriber whose modem was unplugged still showed
 * as Online, and the account status itself was inverted — the backend treats
 * `billing_status_id = 1` as Active (see RadiusReconnectionService and
 * PaymentWorkerService, and `INACTIVE_BILLING_STATUS_IDS = [2, 3, 5]` in
 * RadiusReconciliationService), while the panels tested for `=== 2`.
 *
 * Both helpers prefer the value the API already resolved and only fall back to the id
 * when it is absent, so the mapping lives in one place instead of six.
 */

/**
 * The billing account's status — a billing fact, not a network one.
 *
 * `billingStatusName` comes straight from the `billing_status` table via
 * CustomerDetailController, so it is authoritative whenever present.
 */
export const accountStatusFrom = (customerData: any): string =>
  customerData?.billingAccount?.billingStatusName
  || (customerData?.billingAccount?.billingStatusId === 1 ? 'Active' : 'Inactive');

/**
 * The subscriber's live session state — a network fact, read from RADIUS.
 *
 * `active_sessions` is the fallback, not the primary: `session_status` already accounts
 * for a customer holding a live session while sitting in the Restricted or Disconnected
 * RADIUS group, and that distinction must not be flattened to "online". It is consulted
 * only when session_status is absent.
 *
 * 'Empty' rather than 'Offline' when nothing is known: the account has no session
 * record at all, which is not the same claim as "we checked and they are offline".
 */
export const sessionStatusFrom = (customerData: any): string => {
  const status = customerData?.onlineSessionStatus;
  if (status) return status;
  return Number(customerData?.active_sessions ?? 0) >= 1 ? 'Online' : 'Empty';
};
