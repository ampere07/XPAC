import apiClient from '../config/api';

export interface Plan {
  id: number;
  name: string;
  description?: string;
  price?: number;
  modified_date?: string;
  modified_by?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const planService = {
  getAllPlans: async (): Promise<Plan[]> => {
    try {
      const response = await apiClient.get<ApiResponse<Plan[]>>('/plans');
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching plans:', error);
      return [];
    }
  },

  getPlanById: async (id: number): Promise<Plan | null> => {
    try {
      const response = await apiClient.get<ApiResponse<Plan>>(`/plans/${id}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching plan:', error);
      return null;
    }
  }
};
