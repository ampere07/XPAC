import apiClient from '../config/api';

/**
 * Which slice of the payment worklist to show.
 *
 * `unposted` is the one that matters operationally: Xendit has the money and
 * billing does not yet reflect it. `pending` is awaiting the gateway's verdict.
 */
export type XenditFilter = 'all' | 'pending' | 'unposted' | 'settled' | 'expired';

/**
 * One row of the reconciliation table.
 *
 * `xendit_status` is what the gateway last told us, read out of the stored callback
 * payload; `billing_status` is where the payment sits in our own pipeline. They are
 * deliberately separate columns — the whole point of this screen is the case where
 * the two disagree.
 */
export interface XenditReconcileRow {
  id: number;
  reference_no: string;
  invoice_id: string;
  xendit_payment_id: string | null;
  account_no: string;
  subscriber_name: string | null;
  /** False when no billing account carries this account number — nothing to credit. */
  account_exists: boolean;
  amount: number;
  currency: string;
  channel: string;
  xendit_status: string | null;
  billing_status: string;
  settled_at: string | null;
  /**
   * The three dates the reconciliation table sorts on.
   *
   * created_at and updated_at come off our own pending_payments row. expiry_date is
   * the gateway's and is read out of the stored callback payload — pending_payments
   * has no expiry column — so it stays null until Xendit has reported on the request.
   */
  created_at: string | null;
  /**
   * `created_at` pre-formatted by the backend as `YYYY-MM-DD HH:MM:SS`.
   *
   * The Date Created column displays this and sorts on `created_at`, so what the
   * operator reads and what the table orders by can never drift apart.
   */
  date_created: string | null;
  updated_at: string | null;
  expiry_date: string | null;
  payment_date: string | null;
  attempts: number;
  last_reconciled_at: string | null;
  next_reconciliation_at: string | null;
  reconnect_status: string | null;
  /** The gateway has confirmed payment and billing has not posted it yet. */
  can_force_post: boolean;
  can_mark_expired: boolean;
}

export interface XenditReconcileSummary {
  unreconciled: number;
  unposted: number;
  settled: number;
  expired: number;
  missing_in_db: number;
}

export interface XenditAuditList {
  rows: XenditReconcileRow[];
  summary: XenditReconcileSummary;
  total: number;
  page: number;
  per_page: number;
  filter: XenditFilter;
  days: number;
}

export interface XenditActionResult {
  success: boolean;
  skipped: boolean;
  message: string;
  outcome?: string | null;
  row?: XenditReconcileRow | null;
}

export interface XenditAuditParams {
  filter?: XenditFilter;
  search?: string;
  days?: number;
  page?: number;
  per_page?: number;
}

const BASE = '/xendit-reconciliation';

/**
 * A 422 from these endpoints carries a real operator-facing message — an
 * unconfirmed payment refused for posting, a missing billing account, a row another
 * process already moved. Surfacing that beats surfacing axios's status text.
 */
const unwrap = async (call: any): Promise<XenditActionResult> => {
  try {
    const response = await call;
    return response.data as XenditActionResult;
  } catch (error: any) {
    const payload = error?.response?.data;
    return {
      success: false,
      skipped: false,
      message: payload?.message || error?.message || 'The request failed.',
      row: payload?.row ?? null,
    };
  }
};

export const xenditReconcileService = {
  /** The worklist and its stat cards. Reads our own records only — no gateway call. */
  getAudit: async (params: XenditAuditParams = {}): Promise<XenditAuditList> => {
    const response = await apiClient.get<{ success: boolean; data: XenditAuditList }>(`${BASE}/audit`, { params });
    return response.data.data;
  },

  /** Live lookup against Xendit. A confirmed payment is queued for the payment worker. */
  verify: (id: number): Promise<XenditActionResult> => unwrap(apiClient.post(`${BASE}/verify`, { id })),

  /**
   * Post a gateway-confirmed payment now, instead of waiting for the worker's next
   * pass. Refused server-side unless Xendit has actually confirmed it.
   */
  forcePost: (id: number): Promise<XenditActionResult> => unwrap(apiClient.post(`${BASE}/force-post`, { id })),

  /** Write off an abandoned checkout. Refused if the gateway says it was paid. */
  markExpired: (id: number, reason?: string): Promise<XenditActionResult> =>
    unwrap(apiClient.post(`${BASE}/mark-expired`, { id, reason })),
};
