import apiClient from '../config/api';

// Interface definitions for lookup data
export interface ContractTemplate {
  Template_Name: string;
  Description: string;
}

export interface BillingStatus {
  id: number;
  status_name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

// Response interface
interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// Service functions to fetch lookup data
export const getContractTemplates = async (): Promise<ContractTemplate[]> => {
  try {
    const response = await apiClient.get<ApiResponse<ContractTemplate[]>>('/job-orders/lookup/contract-templates');
    return response.data.data;
  } catch (error) {
    console.error('Error fetching contract templates:', error);
    return []; // Return empty array instead of throwing error
  }
};

export const getBillingStatuses = async (): Promise<BillingStatus[]> => {
  try {
    const response = await apiClient.get<ApiResponse<BillingStatus[]>>('/billing-statuses');
    return response.data.data;
  } catch (error) {
    console.error('Error fetching billing statuses:', error);
    return []; // Return empty array instead of throwing error
  }
};