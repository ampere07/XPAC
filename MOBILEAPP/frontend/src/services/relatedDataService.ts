import apiClient from '../config/api';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  count?: number;
}

export const relatedDataService = {
  // Fetch related invoices by account number
  getRelatedInvoices: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/invoices/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching related invoices:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch invoices'
      };
    }
  },

  // Fetch related payment portal logs by account number
  getRelatedPaymentPortalLogs: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/payment-portal-logs/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching payment portal logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch payment portal logs'
      };
    }
  },

  // Fetch related transactions by account number
  getRelatedTransactions: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/transactions/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching related transactions:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch transactions'
      };
    }
  },

  // Fetch related staggered installations by account number
  getRelatedStaggered: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/staggered-installations/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching related staggered installations:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch staggered installations'
      };
    }
  },

  // Fetch related discounts by account number
  getRelatedDiscounts: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/discounts/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching related discounts:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch discounts'
      };
    }
  },

  // Fetch related service orders by account number
  getRelatedServiceOrders: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/service-orders/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching related service orders:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch service orders'
      };
    }
  },

  // Fetch service order by ID
  getServiceOrderById: async (id: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/service-orders/${id}`);
      return {
        success: true,
        data: response.data.data || null,
        count: 1
      };
    } catch (error: any) {
      console.error('Error fetching service order:', error);
      return {
        success: false,
        data: null,
        message: error.response?.data?.message || 'Failed to fetch service order'
      };
    }
  },

  // Fetch related reconnection logs by account number
  getRelatedReconnectionLogs: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/reconnection-logs/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching reconnection logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch reconnection logs'
      };
    }
  },

  // Fetch related disconnected logs by account number
  getRelatedDisconnectedLogs: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/disconnected-logs/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching disconnected logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch disconnected logs'
      };
    }
  },

  // Fetch related details update logs by account number
  getRelatedDetailsUpdateLogs: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/details-update-logs/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching details update logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch details update logs'
      };
    }
  },

  // Fetch related plan change logs by account number
  getRelatedPlanChangeLogs: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/plan-change-logs/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching plan change logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch plan change logs'
      };
    }
  },

  // Fetch related service charge logs by account number
  getRelatedServiceChargeLogs: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/service-charge-logs/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching service charge logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch service charge logs'
      };
    }
  },

  // Fetch related change due logs by account number
  getRelatedChangeDueLogs: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/change-due-logs/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching change due logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch change due logs'
      };
    }
  },

  // Fetch related security deposits by account number
  getRelatedSecurityDeposits: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/security-deposits/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching security deposits:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch security deposits'
      };
    }
  },

  // Fetch related statement of accounts by account number
  getRelatedStatementOfAccounts: async (accountNo: string): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/statement-of-accounts/by-account/${accountNo}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching statement of accounts:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch statement of accounts'
      };
    }
  },

  // Fetch related inventory logs by item ID
  getRelatedInventoryLogs: async (itemId: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/inventory-logs/by-item/${itemId}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching inventory logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch inventory logs'
      };
    }
  },

  // Fetch related borrowed logs by item ID
  getRelatedBorrowedLogs: async (itemId: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/borrowed-logs/by-item/${itemId}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching borrowed logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch borrowed logs'
      };
    }
  },

  // Fetch related defective logs by item ID
  getRelatedDefectiveLogs: async (itemId: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/defective-logs/by-item/${itemId}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching defective logs:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch defective logs'
      };
    }
  },

  // Fetch related job orders by item ID
  getRelatedJobOrdersByItem: async (itemId: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/job-orders/by-item/${itemId}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching job orders:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch job orders'
      };
    }
  },

  // Fetch service orders by item ID
  getRelatedServiceOrdersByItem: async (itemId: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/service-orders/by-item/${itemId}`);
      return {
        success: true,
        data: response.data.data || [],
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching service orders:', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Failed to fetch service orders'
      };
    }
  },

  // Fetch statement of account by ID
  getStatementOfAccountById: async (id: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/statement-of-accounts/${id}`);
      return {
        success: true,
        data: response.data.data || null,
        count: 1
      };
    } catch (error: any) {
      console.error('Error fetching statement of account:', error);
      return {
        success: false,
        data: null,
        message: error.response?.data?.message || 'Failed to fetch statement of account'
      };
    }
  },

  // Fetch invoice by ID
  getInvoiceById: async (id: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/invoices/${id}`);
      return {
        success: true,
        data: response.data.data || null,
        count: 1
      };
    } catch (error: any) {
      console.error('Error fetching invoice:', error);
      return {
        success: false,
        data: null,
        message: error.response?.data?.message || 'Failed to fetch invoice'
      };
    }
  },

  // Fetch payment portal log by ID
  getPaymentPortalLogById: async (id: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/payment-portal-logs/${id}`);
      return {
        success: true,
        data: response.data.data || null,
        count: 1
      };
    } catch (error: any) {
      console.error('Error fetching payment portal log:', error);
      return {
        success: false,
        data: null,
        message: error.response?.data?.message || 'Failed to fetch payment portal log'
      };
    }
  },

  // Fetch transaction by ID
  getTransactionById: async (id: string | number): Promise<ApiResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/transactions/${id}`);
      return {
        success: true,
        data: response.data.data || null,
        count: 1
      };
    } catch (error: any) {
      console.error('Error fetching transaction:', error);
      return {
        success: false,
        data: null,
        message: error.response?.data?.message || 'Failed to fetch transaction'
      };
    }
  }
};
