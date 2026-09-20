import apiClient from '../config/api';

export interface CustomerRecord {
  id: number;
  first_name: string;
  middle_initial?: string;
  last_name: string;
  full_name?: string;
  email_address?: string;
  contact_number_primary: string;
  contact_number_secondary?: string;
  address: string;
  location?: string;
  barangay?: string;
  city?: string;
  region?: string;
  address_coordinates?: string;
  housing_status?: string;
  referred_by?: string;
  desired_plan?: string;
  house_front_picture_url?: string;
  group_id?: number;
  group_name?: string;
  created_by?: number;
  updated_by?: number;
  created_at?: string;
  updated_at?: string;
  billing_accounts?: BillingAccountInfo[];
}

export interface BillingAccountInfo {
  id: number;
  account_no: string;
  billing_status_id: number;
  account_balance: number;
}

interface CustomerApiResponse {
  success: boolean;
  data?: CustomerRecord[];
  message?: string;
  count?: number;
}

interface CustomerDetailApiResponse {
  success: boolean;
  data?: CustomerRecord;
  message?: string;
}

export const getCustomers = async (): Promise<CustomerRecord[]> => {
  try {
    const response = await apiClient.get<CustomerApiResponse>('/customers');
    
    if (response.data?.success && response.data?.data) {
      return response.data.data;
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching customers:', error);
    return [];
  }
};

export const getCustomer = async (id: number): Promise<CustomerRecord | null> => {
  try {
    const response = await apiClient.get<CustomerDetailApiResponse>(`/customers/${id}`);
    
    if (response.data?.success && response.data?.data) {
      return response.data.data;
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching customer:', error);
    return null;
  }
};

export const createCustomer = async (data: Partial<CustomerRecord>): Promise<CustomerRecord | null> => {
  try {
    const response = await apiClient.post<CustomerDetailApiResponse>('/customers', data);
    
    if (response.data?.success && response.data?.data) {
      return response.data.data;
    }
    
    return null;
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
};

export const updateCustomer = async (id: number, data: Partial<CustomerRecord>): Promise<CustomerRecord | null> => {
  try {
    const response = await apiClient.put<CustomerDetailApiResponse>(`/customers/${id}`, data);
    
    if (response.data?.success && response.data?.data) {
      return response.data.data;
    }
    
    return null;
  } catch (error) {
    console.error('Error updating customer:', error);
    throw error;
  }
};

export const deleteCustomer = async (id: number): Promise<boolean> => {
  try {
    const response = await apiClient.delete<{ success: boolean }>(`/customers/${id}`);
    return response.data?.success || false;
  } catch (error) {
    console.error('Error deleting customer:', error);
    throw error;
  }
};
