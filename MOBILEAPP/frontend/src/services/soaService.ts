import apiClient from '../config/api';

export interface SOARecord {
  id: number;
  account_no: string;
  statement_date: string;
  balance_from_previous_bill: number;
  payment_received_previous: number;
  remaining_balance_previous: number;
  monthly_service_fee: number;
  others_and_basic_charges: number;
  service_charge: number;
  rebate: number;
  discounts: number;
  staggered: number;
  vat: number;
  due_date: string;
  amount_due: number;
  total_amount_due: number;
  print_link?: string;
  created_by: string;
  updated_by: string;
  created_at?: string;
  updated_at?: string;
  account?: {
    account_no: string;
    date_installed?: string;
    billing_day: number;
    customer?: {
      full_name: string;
      contact_number_primary?: string;
      email_address?: string;
      address?: string;
      desired_plan?: string;
      barangay?: string;
      city?: string;
      region?: string;
    };
  };
}

export interface SOAResponse {
  success: boolean;
  data: SOARecord[];
  count?: number;
  total?: number; // Added total to support full records count
  pagination?: {
    current_page: number;
    per_page: number;
    has_more: boolean;
  };
  message?: string;
}

export const soaService = {
  async getAllStatements(fastMode: boolean = false, page: number = 1, perPage: number = 100): Promise<SOARecord[]> {
    try {
      // Using the dedicated SOA records endpoint that directly queries statement_of_accounts table
      const response = await apiClient.get<SOAResponse>('/soa-records', {
        params: {
          fast: fastMode ? '1' : '0',
          page,
          per_page: perPage
        }
      });
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to fetch statements');
    } catch (error) {
      console.error('Error fetching SOA records:', error);
      throw error;
    }
  },

  /**
   * Fetches SOA records and includes total results count from database
   */
  async getAllStatementsWithTotal(fastMode: boolean = false, page: number = 1, perPage: number = 100): Promise<SOAResponse> {
    try {
      const response = await apiClient.get<SOAResponse>('/soa-records', {
        params: {
          fast: fastMode ? '1' : '0',
          page,
          per_page: perPage
        }
      });
      if (response.data.success) {
        return response.data;
      }
      throw new Error(response.data.message || 'Failed to fetch statements');
    } catch (error) {
      console.error('Error fetching SOA records with total:', error);
      throw error;
    }
  },

  async getStatementsByAccount(accountId: number): Promise<SOARecord[]> {
    try {
      const response = await apiClient.get<SOAResponse>('/billing-generation/statements', {
        params: { account_id: accountId }
      });
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to fetch statements');
    } catch (error) {
      console.error('Error fetching SOA records by account:', error);
      throw error;
    }
  },

  async getStatementsByAccountNo(accountNo: string): Promise<SOARecord[]> {
    try {
      const response = await apiClient.get<SOAResponse>('/billing-generation/statements', {
        params: { account_no: accountNo }
      });
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to fetch statements');
    } catch (error) {
      console.error('Error fetching SOA records by account no:', error);
      throw error;
    }
  },

  async getStatementById(id: number): Promise<SOARecord> {
    try {
      const response = await apiClient.get<{ success: boolean; data: SOARecord }>(`/billing-generation/statements/${id}`);
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error('Failed to fetch statement');
    } catch (error) {
      console.error('Error fetching SOA record:', error);
      throw error;
    }
  }
};
