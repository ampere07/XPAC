import axios from 'axios';

const getApiBaseUrl = (): string => {
  const baseUrl = process.env.REACT_APP_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("REACT_APP_API_BASE_URL is not defined");
  }
  return baseUrl;
};

const API_BASE_URL = getApiBaseUrl();

export interface PaymentPortalLog {
  id: string | number;
  reference_no: string;
  account_id: number | string;
  total_amount: number;
  date_time: string;
  checkout_id: string;
  status: string;
  transaction_status: string;
  ewallet_type?: string;
  payment_channel?: string;
  type?: string;
  payment_url?: string;
  json_payload?: string;
  callback_payload?: string;
  account_balance_before?: number;
  updated_at?: string;
  // Joined account details
  accountNo?: string;
  fullName?: string;
  contactNo?: string;
  emailAddress?: string;
  accountBalance?: number;
  address?: string;
  city?: string;
  barangay?: string;
  plan?: string;
  provider?: string;
  organization_id?: number;
}

export interface PaymentPortalLogsResponse {
  status: string;
  data: PaymentPortalLog[];
  total?: number;
  count?: number;
}

export interface PaymentPortalLogResponse {
  status: string;
  data: PaymentPortalLog;
}

export const paymentPortalLogsService = {
  /**
   * Get all payment portal logs
   */
  getAllLogs: async (params?: {
    status?: string;
    account_no?: string;
    city?: string;
    search?: string;
    limit?: number;
    offset?: number;
    updated_since?: string;
  }): Promise<any> => {
    try {
      const authData = localStorage.getItem('authData');
      let token = '';

      if (authData) {
        const parsed = JSON.parse(authData);
        token = parsed.token || '';
      }

      const response = await axios.get<PaymentPortalLogsResponse>(
        `${API_BASE_URL}/payment-portal-logs`,
        {
          params,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          }
        }
      );

      return {
        success: response.data.status === 'success',
        data: response.data.data || [],
        total: response.data.total || 0,
        count: response.data.count || 0
      };
    } catch (error: any) {
      console.error('Error fetching payment portal logs:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to fetch payment portal logs',
        data: [],
        total: 0,
        count: 0
      };
    }
  },

  /**
   * Get a single payment portal log by ID
   */
  getLogById: async (id: string | number): Promise<PaymentPortalLog | null> => {
    try {
      const authData = localStorage.getItem('authData');
      let token = '';

      if (authData) {
        const parsed = JSON.parse(authData);
        token = parsed.token || '';
      }

      const response = await axios.get<PaymentPortalLogResponse>(
        `${API_BASE_URL}/payment-portal-logs/${id}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          // The session cookie, as the shared API client sends it.
          withCredentials: true,
        }
      );

      return response.data.data || null;
    } catch (error: any) {
      console.error('Error fetching payment portal log:', error.response?.data || error.message);
      return null;
    }
  },

  /**
   * Get payment portal logs by account number
   */
  getLogsByAccountNo: async (accountNo: string): Promise<PaymentPortalLog[]> => {
    try {
      const authData = localStorage.getItem('authData');
      let token = '';

      if (authData) {
        const parsed = JSON.parse(authData);
        token = parsed.token || '';
      }

      const response = await axios.get<PaymentPortalLogsResponse>(
        `${API_BASE_URL}/payment-portal-logs/account/${accountNo}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          // The session cookie, as the shared API client sends it.
          withCredentials: true,
        }
      );

      return response.data.data || [];
    } catch (error: any) {
      console.error('Error fetching payment portal logs by account:', error.response?.data || error.message);
      return [];
    }
  },
};
