/**
 * How an account's connectivity is presented, from its billing status and its
 * RADIUS session status.
 *
 * Port of the web app's `utils/onlineStatus.ts`, kept deliberately identical in its
 * rules so the same account never reads ONLINE on one and OFFLINE on the other.
 * Only the returned styling differs: React Native takes hex colours, not Tailwind
 * class names, so both are returned and each caller uses the pair it needs.
 *
 * Single source of truth on purpose. This logic lived as a copy per screen and the
 * copies drifted badly — see `sessionStatusFrom` below for what that cost.
 *
 * Order is load-bearing. Billing status wins over session status where the two
 * disagree: an account the business has switched off is not "online" merely because
 * RADIUS has not caught up.
 */

/**
 * The account's BILLING status, taken from a customer-detail payload.
 *
 * Every screen that can open Customer Details built its own record, and most derived
 * this from `billingStatusId === 2`. Active is id 1, not 2 — 2 is Blacklisted — so
 * nearly every account resolved to 'Inactive', which `getOnlineStatusInfo()` then
 * forces into the offline bucket regardless of the RADIUS session. That is the
 * "always Offline" the Customer Details panel showed.
 *
 * Prefers the name the backend resolves from the billing_status table and only falls
 * back to the id when it is absent.
 */
export const accountStatusFrom = (customerData: any): string =>
  customerData?.billingAccount?.billingStatusName
  || (customerData?.billingAccount?.billingStatusId === 1 ? 'Active' : 'Inactive');

/**
 * RADIUS session status, from `online_status.session_status`.
 *
 * The same screens derived this from `billingStatusId === 2` too — a BILLING status
 * id used as a SESSION status, so the panel reported 'Offline' for every account that
 * was not blacklisted.
 *
 * `active_sessions` is the fallback, not the primary: session_status already accounts
 * for a customer who holds a live session while sitting in the Restricted or
 * Disconnected RADIUS group, and that distinction must not be flattened to "online".
 * It is consulted only when session_status is absent — a row written before the field
 * existed, or a partial sync — where a live session count is the better evidence than
 * defaulting to offline.
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
  /** Hex, for React Native styles. */
  hex: string;
  /** Alias of `hex`, for callers styling a status dot. */
  dotColor: string;
  /** Alias of `hex`, for callers that named the field `color`. */
  color: string;
  hollow: boolean;
  hideCircle: boolean;
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

  const info = (label: string, hex: string, hollow = false, hideCircle = false): OnlineStatusInfo =>
    ({ label, hex, dotColor: hex, color: hex, hollow, hideCircle });

  if (bucket === 'online') return info('ONLINE', '#22c55e');
  if (bucket === 'offline') return info('OFFLINE', '#facc15', true);
  if (bucket === 'not found') return info('NOT FOUND', '#dc2626');
  if (bucket === 'disconnected') return info('DISCONNECTED', '#9ca3af');
  if (bucket === 'restricted') return info('RESTRICTED', '#f97316');
  if (bucket === 'empty') return info('EMPTY', '#94a3b8', true, true);

  // A status neither side has seen before is shown under its own name rather than
  // being forced into one of the buckets above.
  return info(bucket.toUpperCase(), '#3b82f6');
};
