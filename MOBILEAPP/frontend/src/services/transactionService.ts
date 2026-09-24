import apiClient from '../config/api';

interface ApiResponse<T = any> {
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
  payment_method: string;
  reference_no: string;
  or_no: string;
  remarks?: string;
  status: string;
  image_url?: string;
}

interface CreateTransactionResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

export const transactionService = {
  approveTransaction: async (transactionId: string): Promise<ApproveTransactionResponse> => {
    try {
      const response = await apiClient.post<ApiResponse>(`/transactions/${transactionId}/approve`);
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

  createTransaction: async (payload: CreateTransactionPayload): Promise<CreateTransactionResponse> => {
    try {
      console.log('[API CALL] Creating transaction with payload:', payload);
      const response = await apiClient.post<ApiResponse>('/transactions', payload);
      console.log('[API SUCCESS] Transaction created:', response.data);
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

  getAllTransactions: async (limit?: number, offset?: number): Promise<any> => {
    try {
      const response = await apiClient.get<ApiResponse>('/transactions', {
        params: { limit, offset }
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
        message: error.response?.data?.message || error.message || 'Failed to upload images'
      };
    }
  },

  batchApproveTransactions: async (transactionIds: string[]): Promise<any> => {
    try {
      console.log('Batch approving transactions:', transactionIds);
      console.log('Transaction IDs type:', typeof transactionIds);
      console.log('First ID:', transactionIds[0], 'Type:', typeof transactionIds[0]);

      const response = await apiClient.post<ApiResponse>('/transactions/batch-approve', {
        transaction_ids: transactionIds
      });

      console.log('Batch approve response:', response.data);

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
  }
};
