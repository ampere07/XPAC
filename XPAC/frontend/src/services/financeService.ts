import apiClient from '../config/api';

/**
 * Billing → Finance: money collected from recorded transactions and the payment portal.
 * The server does all the arithmetic (FinanceSummaryService); this file only carries it.
 */

/** Where a payment was recorded: by staff on the Transaction List, or online through Xendit. */
export type FinanceSource = 'transactions' | 'portal';

/** How the period is chosen. Each mode sends only its own fields. */
export type FinancePeriod =
  | { mode: 'range'; from: string; to: string }
  | { mode: 'month'; month: string }
  | { mode: 'months'; months: string[] }
  | { mode: 'year'; year: number }
  | { mode: 'years'; year_from: number; year_to: number };

export type FinancePeriodMode = FinancePeriod['mode'];

export interface FinanceAmount {
  amount: number;
  count: number;
}

export interface FinanceTrendBucket {
  key: string;
  label: string;
  transactions: number;
  portal: number;
  amount: number;
  count: number;
}

/**
 * One row of a breakdown. Every breakdown sums to the period total: payments with no method,
 * processor or location are grouped as "Unspecified" rather than left out.
 */
export interface FinanceBreakdownRow {
  key: string;
  label: string;
  /** Secondary text: the processor's email, a city's region, a barangay's city. */
  detail: string | null;
  /** Set where the row belongs to one source (payment methods, processors). */
  source: FinanceSource | null;
  amount: number;
  count: number;
  /** The same amount, split by where it was recorded. */
  by_source: Record<FinanceSource, number>;
}

export interface FinanceSummary {
  period: {
    mode: FinancePeriodMode;
    label: string;
    granularity: 'day' | 'month' | 'year';
    ranges: { from: string; to: string }[];
  };
  totals: {
    amount: number;
    count: number;
    average: number;
    sources: Record<FinanceSource, FinanceAmount>;
  };
  trend: FinanceTrendBucket[];
  by_payment_method: FinanceBreakdownRow[];
  by_processor: FinanceBreakdownRow[];
  by_region: FinanceBreakdownRow[];
  by_city: FinanceBreakdownRow[];
  by_barangay: FinanceBreakdownRow[];
  meta: {
    first_year: number;
    generated_at: string;
  };
}

export const financeService = {
  async summary(period: FinancePeriod): Promise<FinanceSummary> {
    const response = await apiClient.get<{ success: boolean; message?: string; data: FinanceSummary }>(
      '/finance/summary',
      { params: period }
    );
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to load the finance summary');
    }
    return response.data.data;
  },
};
