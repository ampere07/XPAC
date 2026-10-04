import apiClient from '../config/api';
import { Transaction } from '../types/transaction';
import { JobOrder } from '../types/jobOrder';

/**
 * The For Approval queue (GET /for-approval/*).
 *
 * Lists only. Approving a record goes through the same endpoint and hook as its own page —
 * see hooks/useTransactionApproval and hooks/useJobOrderApproval.
 */

export type ForApprovalCategory = 'transactions' | 'job-orders';

export interface ForApprovalCounts {
  transactions: number;
  job_orders: number;
  total: number;
}

export interface ForApprovalPagination {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
}

export interface ForApprovalPage<T> {
  rows: T[];
  pagination: ForApprovalPagination;
  /** Both categories, so the filter counts refresh with the rows. */
  counts: ForApprovalCounts;
}

export interface ForApprovalQuery {
  page: number;
  limit: number;
  search?: string;
}

interface ListResponse<T> {
  success: boolean;
  data: T[];
  pagination: ForApprovalPagination;
  counts: ForApprovalCounts;
  message?: string;
}

/**
 * Transactions as the Transaction List loads them: the account (with customer), the processor,
 * the payment method and any revert request.
 */
export type ForApprovalTransaction = Transaction & {
  revert_request?: { id: number; status: string } | null;
};

/** Throws with the server's message, so the page can show it as it is. */
const fetchPage = async <T>(path: string, query: ForApprovalQuery): Promise<ForApprovalPage<T>> => {
  try {
    const response = await apiClient.get<ListResponse<T>>(path, {
      params: {
        page: query.page,
        limit: query.limit,
        search: query.search?.trim() || undefined,
      },
    });

    if (!response.data?.success) {
      throw new Error(response.data?.message || 'Failed to load the approval queue.');
    }

    return {
      rows: response.data.data || [],
      pagination: response.data.pagination,
      counts: response.data.counts,
    };
  } catch (error: any) {
    throw new Error(error.response?.data?.message || error.message || 'Failed to load the approval queue.');
  }
};

export const forApprovalService = {
  getTransactions: (query: ForApprovalQuery) =>
    fetchPage<ForApprovalTransaction>('/for-approval/transactions', query),

  getJobOrders: (query: ForApprovalQuery) =>
    fetchPage<JobOrder>('/for-approval/job-orders', query),
};
