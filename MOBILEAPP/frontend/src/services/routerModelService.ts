import apiClient from '../config/api';

export interface RouterModel {
  model: string;
  brand?: string;
  description?: string;
  modified_by?: string;
  modified_date?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const routerModelService = {
  getAllRouterModels: async (): Promise<RouterModel[]> => {
    try {
      const response = await apiClient.get<ApiResponse<RouterModel[]>>('/router-models');
      if (response.data && response.data.success && Array.isArray(response.data.data)) {
        return response.data.data.filter(rm => {
          if (!rm.model) return false;
          const name = String(rm.model).trim().toLowerCase();
          return name !== 'undefined' && name !== 'null' && name !== '' && !name.includes('undefined');
        });
      }
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching router models:', error);
      return [];
    }
  },

  getRouterModelByName: async (model: string): Promise<RouterModel | null> => {
    try {
      const response = await apiClient.get<ApiResponse<RouterModel>>(`/router-models/${model}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching router model:', error);
      return null;
    }
  }
};
