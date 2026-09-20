import apiClient from '../config/api';

export interface PaymentMethod {
  id: number;
  payment_method: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export const paymentMethodService = {
  getAll: async (): Promise<ApiResponse<PaymentMethod[]>> => {
    try {
      const response = await apiClient.get<ApiResponse<PaymentMethod[]>>('/payment-methods');
      return response.data;
    } catch (error: any) {
      console.error('Error fetching payment methods:', error);
      return {
        success: false,
        data: [],
        message: 'Failed to fetch payment methods'
      };
    }
  }
};
