import apiClient from '../config/api';

/**
 * Why an account that should have been billed this cycle has no invoice.
 *
 * The vocabulary is the server's — BillingReconciliationService::REASON_LABELS — and
 * the screen reads the labels off `getReasons()` rather than keeping a second copy
 * that can drift out of step with the rules that produced them.
 */
export type BillingReconcileReason =
  | 'ready'
  | 'missing_billing_day'
  | 'missing_plan'
  | 'zero_price'
  | 'inactive_status'
  | 'prepaid'
  | 'already_invoiced'
  | 'open_job_order'
  | 'dismissed';

export interface BillingReconcileRow {
  billing_account_id: number;
  account_no: string;
  customer_name: string | null;
  plan_name: string | null;
  /** Null when no plan is linked — distinct from a plan that is priced at 0.00. */
  plan_price: number | null;
  /** 0 is a real value meaning "every end of month"; null means none is set at all. */
  billing_day: number | null;
  billing_status: string | null;
  billing_status_id: number | null;
  generation_type: string | null;
  date_installed: string | null;
  account_balance: number;
  /** Whether this account's generation day for the current cycle has already passed. */
  due_this_cycle: boolean;
  reason: BillingReconcileReason;
  reason_label: string;
  /** Only rows the tool can actually clear by billing them offer a Generate button. */
  can_generate: boolean;
  can_dismiss: boolean;
  last_invoice_date: string | null;
  dismissed_reason: string | null;
  dismissed_at: string | null;
}

/**
 * Counts over the whole cycle, not over the page.
 *
 * `due` is every account whose generation day has passed; `ungenerated` is how many of
 * those have no invoice. The per-reason keys break that down. They are computed during
 * the same sweep that builds the rows, so the cards and the table can never disagree.
 */
export interface BillingReconcileSummary {
  due: number;
  ungenerated: number;
  ready: number;
  missing_billing_day: number;
  missing_plan: number;
  zero_price: number;
  inactive_status: number;
  prepaid: number;
  already_invoiced: number;
  open_job_order: number;
  dismissed: number;
}

export interface BillingReconcileAudit {
  /** The cycle being reconciled, as `YYYY-MM` in Asia/Manila. */
  period: string;
  as_of: string;
  /** Days before its billing day an account is generated, from billing_config. */
  advance_generation_day: number;
  summary: BillingReconcileSummary;
  rows: BillingReconcileRow[];
  filter: {
    reason: string;
    billing_status: string;
    billing_day: number | null;
    search: string;
    include_ok: boolean;
  };
}

export interface BillingReconcileReasons {
  labels: Record<string, string>;
  generatable: string[];
  max_batch: number;
}

export interface BillingReconcileActionResult {
  success: boolean;
  message: string;
  data: {
    success: number;
    failed: number;
    skipped: number;
    errors: Array<{ billing_account_id?: number; account_no?: string; error: string }>;
    accounts?: Array<{
      billing_account_id: number;
      account_no: string;
      outcome: 'generated' | 'skipped' | 'blocked';
      message: string;
      statement_created?: boolean;
      invoice_created?: boolean;
    }>;
  };
}

export interface BillingReconcileParams {
  reason?: string;
  billing_status?: string;
  billing_day?: number | '';
  search?: string;
  include_ok?: boolean;
}

const BASE = '/billing-reconciliation';

/**
 * A 422 from these endpoints carries a real operator-facing message — an account
 * blocked on a guard, an id outside the caller's organization, a row another process
 * billed first. Surfacing that beats surfacing axios's status text.
 */
const unwrap = async (call: any): Promise<BillingReconcileActionResult> => {
  try {
    const response = await call;
    return response.data as BillingReconcileActionResult;
  } catch (error: any) {
    const payload = error?.response?.data;
    return {
      success: false,
      message: payload?.message || error?.message || 'The request failed.',
      data: payload?.data ?? { success: 0, failed: 0, skipped: 0, errors: [] },
    };
  }
};

export const billingReconcileService = {
  /** The worklist and its stat cards. Reads our own records only — generates nothing. */
  getAudit: async (params: BillingReconcileParams = {}): Promise<BillingReconcileAudit> => {
    const response = await apiClient.get<{ success: boolean; data: BillingReconcileAudit }>(`${BASE}/audit`, {
      params: {
        ...params,
        billing_day: params.billing_day === '' ? undefined : params.billing_day,
        include_ok: params.include_ok ? 1 : undefined,
      },
    });
    return response.data.data;
  },

  getReasons: async (): Promise<BillingReconcileReasons> => {
    const response = await apiClient.get<{ success: boolean; data: BillingReconcileReasons }>(`${BASE}/reasons`);
    return response.data.data;
  },

  /**
   * Raise this cycle's bill for the accounts named, through the same generator the
   * nightly cron uses. Repeating it is a skip, not a second invoice.
   */
  generate: (accountIds: number[]): Promise<BillingReconcileActionResult> =>
    unwrap(apiClient.post(`${BASE}/generate`, { account_ids: accountIds })),

  /** Record that these accounts are deliberately not billed this cycle. */
  dismiss: (accountIds: number[], reason?: string): Promise<BillingReconcileActionResult> =>
    unwrap(apiClient.post(`${BASE}/dismiss`, { account_ids: accountIds, reason })),

  /** Undo a dismissal and put the account back on this cycle's worklist. */
  restore: (accountIds: number[]): Promise<BillingReconcileActionResult> =>
    unwrap(apiClient.post(`${BASE}/restore`, { account_ids: accountIds })),
};
