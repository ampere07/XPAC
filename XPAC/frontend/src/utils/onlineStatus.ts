/**
 * How an account's connectivity is presented, from its billing status and its
 * RADIUS session status.
 *
 * Single source of truth on purpose. This lived as two copies — one in the customer
 * list, one in the details panel — and they drifted: the details panel was missing
 * the Inactive rule and the Empty guard, so an inactive account with a live session
 * read as ONLINE in the panel while the list beside it read OFFLINE. Anything that
 * shows connectivity should call this rather than re-deriving it.
 *
 * Order is load-bearing. Billing status wins over session status where the two
 * disagree: an account the business has switched off is not "online" merely because
 * RADIUS has not caught up.
 */

/**
 * The two status fields CustomerDetails reads, taken from a customer-detail payload.
 *
 * Every panel that can open CustomerDetails through the arrow beside Account No.
 * builds its own record, and those builders had drifted badly:
 *
 *  - Three derived onlineStatus from `billingStatusId === 2` — a BILLING status id
 *    (2 is Blacklisted), not a session status. The panel then showed OFFLINE for
 *    accounts that were plainly online in the customer list.
 *  - Most used `billingStatusId === 2 ? 'Active' : 'Inactive'` for the billing
 *    status too, where 1 is Active. The comparison was simply against the wrong id.
 *
 * Derived here once so the panel shows the same thing no matter which screen it was
 * opened from.
 */
export const accountStatusFrom = (customerData: any): string =>
  customerData?.billingAccount?.billingStatusName
  || (customerData?.billingAccount?.billingStatusId === 1 ? 'Active' : 'Inactive');

/**
 * RADIUS session status, from `online_status.session_status`.
 *
 * `active_sessions` is the fallback, not the primary: session_status already
 * accounts for a customer holding a live session while sitting in the Restricted or
 * Disconnected RADIUS group, and that distinction must not be flattened to "online".
 * It is consulted only when session_status is absent — a row written before the
 * field existed, or a partial sync — where a live session count is better evidence
 * than defaulting to offline. The Customer list has always had this signal from
 * BillingController; the detail endpoint now returns it too, so the panel and the
 * list resolve the same way.
 *
 * 'Empty' means no session record at all, which reads as offline.
 */
export const sessionStatusFrom = (customerData: any): string => {
  const status = customerData?.onlineSessionStatus;

  if (status) return status;

  return Number(customerData?.active_sessions ?? 0) >= 1 ? 'Online' : 'Empty';
};

export interface OnlineStatusInfo {
  label: string;
  color: string;
  hex: string;
  fillColor?: string;
  hollow?: boolean;
  hideCircle?: boolean;
}

export interface OnlineStatusInput {
  /** Billing status name — Active, Inactive, Restricted, Pullout, VIP. */
  status?: string | null;
  /** RADIUS session status — Online, Offline, Restricted, Disconnected, Empty. */
  onlineStatus?: string | null;
}

export const getOnlineStatusInfo = (record: OnlineStatusInput): OnlineStatusInfo => {
  const lowerStatus = (record?.status || '').toLowerCase();
  const lowerOnlineStatus = (record?.onlineStatus || '').toLowerCase();

  let bucket = 'offline';

  if (lowerStatus === 'restricted' || lowerOnlineStatus === 'restricted') bucket = 'restricted';
  else if (lowerStatus === 'not found' || lowerOnlineStatus === 'not found') bucket = 'not found';
  else if (lowerStatus === 'disconnected' || lowerOnlineStatus === 'disconnected') bucket = 'disconnected';
  // An account switched off in billing reads as offline whatever RADIUS reports —
  // a stale session must not make a closed account look connected.
  else if (lowerStatus === 'inactive') bucket = 'offline';
  else if (['online', 'active', 'connected'].includes(lowerOnlineStatus)) bucket = 'online';
  // 'empty' means "no session record", which is offline — not a status of its own.
  else if (lowerOnlineStatus && lowerOnlineStatus !== 'offline' && lowerOnlineStatus !== 'empty') {
    bucket = lowerOnlineStatus;
  }

  if (bucket === 'online') return { label: 'ONLINE', color: 'text-green-500', hex: '#22c55e', fillColor: 'bg-green-500', hollow: false };
  if (bucket === 'offline') return { label: 'OFFLINE', color: 'text-yellow-400', hex: '#facc15', hollow: true };
  if (bucket === 'not found') return { label: 'NOT FOUND', color: 'text-red-600', hex: '#dc2626', fillColor: 'bg-red-600', hollow: false };
  if (bucket === 'disconnected') return { label: 'DISCONNECTED', color: 'text-gray-400', hex: '#9ca3af', fillColor: 'bg-gray-400', hollow: false };
  if (bucket === 'restricted') return { label: 'RESTRICTED', color: 'text-gray-400', hex: '#be6b33', fillColor: 'bg-orange-500', hollow: false };
  if (bucket === 'empty') return { label: 'EMPTY', color: 'text-slate-400', hex: '#94a3b8', hollow: true, hideCircle: true };

  // A status neither side has seen before is shown under its own name rather than
  // being forced into one of the buckets above.
  return { label: bucket.toUpperCase(), color: 'text-blue-500', hex: '#3b82f6', fillColor: 'bg-blue-500', hollow: false };
};
