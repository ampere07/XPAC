import apiClient from '../config/api';

interface ApiResponse<T = any> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
  count?: number;
  total?: number;
}

interface ApproveTransactionResponse {
  success: boolean;
  message?: string;
  data?: any;
}

interface CreateTransactionPayload {
  account_no?: string;
  transaction_type: string;
  received_payment: number;
  payment_date: string;
  date_processed: string;
  processed_by_user_id?: number;
  processed_by_user?: string;
  payment_method: string;
  reference_no: string;
  or_no: string;
  remarks?: string;
  status: string;
  image_url?: string;
  created_by_user?: string;
}

interface CreateTransactionResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

/**
 * The print-ready projection of a transaction, as resolved by the backend
 * TransactionReceiptFormatter.
 *
 * Every field is already coalesced server side, which is the point: a transaction migrated
 * from the old database can have a NULL OR number, a payment_method holding a row ID rather
 * than a name, and an account_no that no longer matches any billing_accounts row. Resolving
 * that needs queries the client cannot make.
 */
export interface TransactionReceipt {
  transaction_id: number | string;
  receipt_no: string;
  or_no: string | null;
  reference_no: string | null;
  /** ISO-8601, or null when the row carries no usable date at all. */
  paid_at: string | null;
  account_no: string;
  customer_name: string;
  contact: string;
  address: string;
  plan: string | null;
  description: string;
  amount: number;
  payment_method: string;
  processed_by: string | null;
  remarks: string | null;
  status: string | null;
  is_printable: boolean;
}

export const transactionService = {
  approveTransaction: async (transactionId: string, approvedBy?: string): Promise<ApproveTransactionResponse> => {
    try {
      const response = await apiClient.post<ApiResponse>(`/transactions/${transactionId}/approve`, {
        approved_by: approvedBy,
        updated_by_user: approvedBy
      });
      return {
        success: true,
        message: response.data.message || 'Transaction approved successfully',
        data: response.data
      };
    } catch (error: any) {
      console.error('Error approving transaction:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to approve transaction'
      };
    }
  },

  revertTransaction: async (transactionId: string, revertedBy?: string): Promise<ApproveTransactionResponse> => {
    try {
      const response = await apiClient.post<ApiResponse>(`/transactions/${transactionId}/revert`, {
        reverted_by: revertedBy,
        updated_by_user: revertedBy
      });
      return {
        success: true,
        message: response.data.message || 'Transaction reverted successfully',
        data: response.data
      };
    } catch (error: any) {
      console.error('Error reverting transaction:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to revert transaction'
      };
    }
  },

  deleteTransaction: async (transactionId: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.delete<ApiResponse>(`/transactions/${transactionId}`);
      return response.data;
    } catch (error: any) {
      console.error('Error deleting transaction:', error);
      throw error.response?.data || error;
    }
  },

  createTransaction: async (payload: CreateTransactionPayload): Promise<CreateTransactionResponse> => {
    try {
      const response = await apiClient.post<ApiResponse>('/transactions', payload);
      return {
        success: true,
        message: response.data.message || 'Transaction created successfully',
        data: response.data.data
      };
    } catch (error: any) {
      console.error('[API ERROR] Error creating transaction:', error);
      console.error('[API ERROR] Error response:', error.response?.data);
      console.error('[API ERROR] Error status:', error.response?.status);
      console.error('[API ERROR] Error message:', error.message);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to create transaction',
        error: error.response?.data?.error || error.message
      };
    }
  },
  
  updateTransaction: async (transactionId: string, payload: CreateTransactionPayload): Promise<CreateTransactionResponse> => {
    try {
      const response = await apiClient.put<ApiResponse>(`/transactions/${transactionId}`, payload);
      return {
        success: true,
        message: response.data.message || 'Transaction updated successfully',
        data: response.data.data
      };
    } catch (error: any) {
      console.error('[API ERROR] Error updating transaction:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to update transaction',
        error: error.response?.data?.error || error.message
      };
    }
  },

  getAllTransactions: async (limit?: number, offset?: number, updatedSince?: string): Promise<any> => {
    try {
      const response = await apiClient.get<ApiResponse>('/transactions', {
        params: { limit, offset, updated_since: updatedSince }
      });
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0,
        total: response.data.total || 0
      };
    } catch (error: any) {
      console.error('Error fetching transactions:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to fetch transactions',
        data: []
      };
    }
  },

  getTransactionsByAccountNo: async (accountNo: string): Promise<any> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/transactions/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || []
      };
    } catch (error: any) {
      console.error('Error fetching transactions by account:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to fetch transactions',
        data: []
      };
    }
  },

  /**
   * The print-ready projection of one transaction.
   *
   * Enrichment, not a dependency: the caller already holds the transaction and can build a
   * slip from it, so a failure here returns `data: null` and the caller falls back to its own
   * derivation rather than blocking the print. That matters at a counter — a receipt the
   * cashier cannot produce because an endpoint was slow is a worse outcome than a receipt
   * missing the address of a customer whose account was closed years ago.
   */
  getTransactionReceipt: async (
    transactionId: string | number
  ): Promise<{ success: boolean; data: TransactionReceipt | null; message?: string }> => {
    try {
      const response = await apiClient.get<ApiResponse<TransactionReceipt>>(
        `/transactions/${transactionId}/receipt`
      );
      return {
        success: true,
        data: response.data.data ?? null
      };
    } catch (error: any) {
      console.error('Error fetching transaction receipt:', error);
      return {
        success: false,
        data: null,
        message: error.response?.data?.message || error.message || 'Failed to fetch receipt'
      };
    }
  },

  uploadTransactionImage: async (formData: FormData): Promise<any> => {
    try {
      const response = await apiClient.post<ApiResponse>('/transactions/upload-images', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      return {
        success: true,
        message: response.data.message || 'Images uploaded successfully',
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Error uploading transaction images:', error);
      return {
        success: false,
      };
    }
  },

  generateProRatedInstallationInvoice: async (accountNo: string): Promise<any> => {
    try {
      const response = await apiClient.post<ApiResponse>('/transactions/generate-installation-invoice', {
        account_no: accountNo
      });
      return {
        success: true,
        data: response.data
      };
    } catch (error: any) {
      console.error('Failed to generate pro-rated invoice:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to generate pro-rated invoice'
      };
    }
  },

  batchApproveTransactions: async (transactionIds: string[], approvedBy?: string): Promise<any> => {
    try {
      const response = await apiClient.post<ApiResponse>('/transactions/batch-approve', {
        transaction_ids: transactionIds,
        approved_by: approvedBy,
        updated_by_user: approvedBy
      });

      return {
        success: true,
        message: response.data.message || 'Batch approval completed',
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Error batch approving transactions:', error);
      console.error('Error response:', error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to batch approve transactions'
      };
    }
  },

  updateStatus: async (transactionId: string, status: string): Promise<ApiResponse> => {
    try {
      let currentUserEmail = '';
      try {
        const authData = localStorage.getItem('authData');
        if (authData) {
          const parsed = JSON.parse(authData);
          currentUserEmail = parsed.email_address || parsed.email || parsed.user?.email_address || parsed.user?.email || '';
        }
      } catch (e) {
        console.error('Error getting current user email:', e);
      }

      const response = await apiClient.put<ApiResponse>(`/transactions/${transactionId}/status`, {
        status,
        updated_by_user: currentUserEmail
      });
      return response.data;
    } catch (error: any) {
      console.error('Error updating transaction status:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to update transaction status'
      };
    }
  }
};
