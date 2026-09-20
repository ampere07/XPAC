import apiClient from '../config/api';

interface CreateStaggeredInstallationPayload {
  account_no: string;
  staggered_install_no: string;
  staggered_date: string;
  staggered_balance: number;
  months_to_pay: number;
  monthly_payment: number;
  modified_by: string;
  modified_date: string;
  user_email: string;
  remarks?: string;
  status?: string;
}

interface ApiResponse<T = any> {
  data?: T;
  message?: string;
  error?: string;
}

interface StaggeredInstallationResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

export const staggeredInstallationService = {
  getAll: async (accountNo?: string): Promise<StaggeredInstallationResponse> => {
    try {
      const params = accountNo ? { account_no: accountNo } : {};
      console.log('Fetching staggered installations from API...');
      const response = await apiClient.get<ApiResponse>('/staggered-installations', { params });
      console.log('API response:', response.data);
      return {
        success: true,
        data: response.data.data || [],
        message: response.data.message
      };
    } catch (error: any) {
      console.error('Error fetching staggered installations:', error);
      console.error('Error response:', error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to fetch staggered installations',
        data: []
      };
    }
  },

  create: async (payload: CreateStaggeredInstallationPayload): Promise<StaggeredInstallationResponse> => {
    try {
      const response = await apiClient.post<ApiResponse>('/staggered-installations', payload);
      return {
        success: true,
        message: response.data.message || 'Staggered installation created successfully',
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Error creating staggered installation:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to create staggered installation',
        error: error.response?.data?.error
      };
    }
  },

  getById: async (id: string): Promise<StaggeredInstallationResponse> => {
    try {
      const response = await apiClient.get<ApiResponse>(`/staggered-installations/${id}`);
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Error fetching staggered installation:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to fetch staggered installation'
      };
    }
  },

  update: async (id: string, payload: Partial<CreateStaggeredInstallationPayload>): Promise<StaggeredInstallationResponse> => {
    try {
      const response = await apiClient.put<ApiResponse>(`/staggered-installations/${id}`, payload);
      return {
        success: true,
        message: response.data.message || 'Staggered installation updated successfully',
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Error updating staggered installation:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to update staggered installation'
      };
    }
  },

  delete: async (id: string): Promise<StaggeredInstallationResponse> => {
    try {
      const response = await apiClient.delete<ApiResponse>(`/staggered-installations/${id}`);
      return {
        success: true,
        message: response.data.message || 'Staggered installation deleted successfully'
      };
    } catch (error: any) {
      console.error('Error deleting staggered installation:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to delete staggered installation'
      };
    }
  },

  approve: async (id: string): Promise<StaggeredInstallationResponse> => {
    try {
      console.log('Approving staggered installation:', id);
      const response = await apiClient.post<ApiResponse>(`/staggered-installations/${id}/approve`);
      console.log('Approve response:', response.data);
      return {
        success: true,
        message: response.data.message || 'Staggered installation approved successfully',
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Error approving staggered installation:', error);
      console.error('Error response:', error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to approve staggered installation',
        error: error.response?.data?.error
      };
    }
  }
};
