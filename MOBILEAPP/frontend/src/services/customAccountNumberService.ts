import apiClient from '../config/api';

export interface CustomAccountNumber {
  starting_number: string;
  created_at: string;
  updated_at: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const customAccountNumberService = {
  get: async (): Promise<ApiResponse<CustomAccountNumber | null>> => {
    try {
      const response = await apiClient.get<ApiResponse<CustomAccountNumber | null>>('/custom-account-number');
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return { success: true, data: null };
      }
      throw error;
    }
  },

  create: async (startingNumber: string): Promise<ApiResponse<CustomAccountNumber>> => {
    try {
      const authData = localStorage.getItem('authData');
      let userEmail = 'unknown@user.com';
      
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.user?.email || 'unknown@user.com';
        } catch (error) {
          console.error('Error parsing auth data:', error);
        }
      }

      const response = await apiClient.post<ApiResponse<CustomAccountNumber>>('/custom-account-number', {
        starting_number: startingNumber,
        user_email: userEmail
      });
      return response.data;
    } catch (error) {
      console.error('Error creating custom account number:', error);
      throw error;
    }
  },

  update: async (startingNumber: string): Promise<ApiResponse<CustomAccountNumber>> => {
    try {
      const authData = localStorage.getItem('authData');
      let userEmail = 'unknown@user.com';
      
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.user?.email || 'unknown@user.com';
        } catch (error) {
          console.error('Error parsing auth data:', error);
        }
      }

      const response = await apiClient.put<ApiResponse<CustomAccountNumber>>('/custom-account-number', {
        starting_number: startingNumber,
        user_email: userEmail
      });
      return response.data;
    } catch (error) {
      console.error('Error updating custom account number:', error);
      throw error;
    }
  },

  delete: async (): Promise<ApiResponse<null>> => {
    try {
      const response = await apiClient.delete<ApiResponse<null>>('/custom-account-number');
      return response.data;
    } catch (error) {
      console.error('Error deleting custom account number:', error);
      throw error;
    }
  }
};
