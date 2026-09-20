import apiClient from '../config/api';

export interface MassRebateData {
  number_of_dates: number;
  rebate_type: 'lcpnap' | 'lcp' | 'barangay';
  selected_rebate: string;
  month: string;
  status: 'Unused' | 'Used' | 'Pending';
  created_by: string;
  modified_by?: string | null;
}

export interface MassRebate {
  id: number;
  number_of_dates: number;
  rebate_type: 'lcpnap' | 'lcp' | 'barangay';
  selected_rebate: string;
  month: string;
  status: 'Unused' | 'Used' | 'Pending';
  created_by: string;
  modified_by?: string | null;
  modified_date?: string;
}

export interface MassRebatesResponse {
  success: boolean;
  data: MassRebate[];
  count?: number;
  message?: string;
}

export interface MassRebateResponse {
  success: boolean;
  data: MassRebate;
  message?: string;
}

export const getAll = async (): Promise<MassRebatesResponse> => {
  try {
    const response = await apiClient.get<MassRebatesResponse>('/mass-rebates');
    return response.data;
  } catch (error) {
    console.error('Error fetching mass rebates:', error);
    throw error;
  }
};

export const getById = async (id: number): Promise<MassRebateResponse> => {
  try {
    const response = await apiClient.get<MassRebateResponse>(`/mass-rebates/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching mass rebate:', error);
    throw error;
  }
};

export const create = async (data: MassRebateData): Promise<MassRebateResponse> => {
  try {
    console.log('Creating mass rebate with data:', data);
    const response = await apiClient.post<MassRebateResponse>('/mass-rebates', data);
    console.log('Mass rebate created successfully:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('Error creating mass rebate:', error);
    console.error('Error response:', error.response);
    console.error('Error response data:', error.response?.data);
    console.error('Error response status:', error.response?.status);
    console.error('Error response headers:', error.response?.headers);
    throw error;
  }
};

export const update = async (id: number, data: Partial<MassRebateData>): Promise<MassRebateResponse> => {
  try {
    const response = await apiClient.put<MassRebateResponse>(`/mass-rebates/${id}`, data);
    return response.data;
  } catch (error) {
    console.error('Error updating mass rebate:', error);
    throw error;
  }
};

export const remove = async (id: number): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiClient.delete<{ success: boolean; message: string }>(`/mass-rebates/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting mass rebate:', error);
    throw error;
  }
};

export const markAsUsed = async (id: number): Promise<MassRebateResponse> => {
  try {
    const response = await apiClient.post<MassRebateResponse>(`/mass-rebates/${id}/mark-used`);
    return response.data;
  } catch (error) {
    console.error('Error marking mass rebate as used:', error);
    throw error;
  }
};
