import apiClient from '../config/api';

export interface InvoiceRecord {
  id: number;
  account_no: string;
  invoice_date: string;
  invoice_balance: number;
  others_and_basic_charges: number;
  service_charge: number;
  rebate: number;
  discounts: number;
  staggered: number;
  total_amount: number;
  received_payment: number;
  due_date: string;
  status: string;
  payment_portal_log_ref?: string;
  transaction_id?: string;
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

export interface InvoiceResponse {
  success: boolean;
  data: InvoiceRecord[];
  count?: number;
  message?: string;
}

export const invoiceService = {
  async getAllInvoices(fastMode: boolean = false, page: number = 1, perPage: number = 100): Promise<any> {
    try {
      // Using the dedicated invoice records endpoint that directly queries invoices table
      const response = await apiClient.get<InvoiceResponse>('/invoice-records', {
        params: {
          fast: fastMode ? '1' : '0',
          page,
          per_page: perPage
        }
      });

      return {
        success: response.data.success,
        data: response.data.data || [],
        total: (response.data as any).total || (response.data.data ? response.data.data.length : 0),
        message: response.data.message
      };
    } catch (error) {
      console.error('Error fetching invoice records:', error);
      return {
        success: false,
        data: [],
        total: 0,
        message: error instanceof Error ? error.message : 'Failed to fetch invoices'
      };
    }
  },

  async getInvoicesByAccount(accountId: number): Promise<InvoiceRecord[]> {
    try {
      const response = await apiClient.get<InvoiceResponse>('/billing-generation/invoices', {
        params: { account_id: accountId }
      });
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to fetch invoices');
    } catch (error) {
      console.error('Error fetching invoice records by account:', error);
      throw error;
    }
  },

  async getInvoicesByAccountNo(accountNo: string): Promise<InvoiceRecord[]> {
    try {
      const response = await apiClient.get<InvoiceResponse>('/billing-generation/invoices', {
        params: { account_no: accountNo }
      });
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || 'Failed to fetch invoices');
    } catch (error) {
      console.error('Error fetching invoice records by account no:', error);
      throw error;
    }
  },

  async getInvoiceById(id: number): Promise<InvoiceRecord> {
    try {
      const response = await apiClient.get<{ success: boolean; data: InvoiceRecord }>(`/billing-generation/invoices/${id}`);
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error('Failed to fetch invoice');
    } catch (error) {
      console.error('Error fetching invoice record:', error);
      throw error;
    }
  }
};
