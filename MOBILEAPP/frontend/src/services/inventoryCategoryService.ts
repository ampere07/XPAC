import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface InventoryCategory {
  id: number;
  name: string;
  created_at?: string;
  updated_at?: string;
  modified_by?: string;
  modified_date?: string;
}

export const getInventoryCategories = async (): Promise<InventoryCategory[]> => {
  try {
    const response = await apiClient.get('/inventory-categories');
    console.log('Raw inventory categories response:', response);
    console.log('Inventory categories response.data:', response.data);
    
    const data = response.data as any;
    
    if (Array.isArray(data)) {
      console.log(`Successfully retrieved ${data.length} inventory categories from direct array`);
      return data;
    }
    
    if (data.success && Array.isArray(data.data)) {
      const categories = data.data;
      console.log(`Successfully retrieved ${categories.length} inventory categories from wrapped response`);
      return categories;
    }
    
    console.log('Using empty categories array as fallback. Data type:', typeof data, 'Is array:', Array.isArray(data));
    return [];
    
  } catch (error: any) {
    console.error('Error fetching inventory categories:', error);
    console.error('Error details:', error.response ? error.response.data : 'No response data');
    return [];
  }
};

export const getInventoryCategoryById = async (id: number): Promise<InventoryCategory | null> => {
  try {
    const response = await apiClient.get<ApiResponse<InventoryCategory>>(`/inventory-categories/${id}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    return null;
  } catch (error: any) {
    console.error('Error fetching inventory category:', error);
    return null;
  }
};

export const createInventoryCategory = async (data: { 
  name: string;
  modified_by?: string;
}): Promise<InventoryCategory> => {
  try {
    const response = await apiClient.post<ApiResponse<InventoryCategory>>('/inventory-categories', data);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to create inventory category');
  } catch (error: any) {
    console.error('Error creating inventory category:', error);
    throw error;
  }
};

export const updateInventoryCategory = async (id: number, data: { 
  name: string;
  modified_by?: string;
}): Promise<InventoryCategory> => {
  try {
    const response = await apiClient.put<ApiResponse<InventoryCategory>>(`/inventory-categories/${id}`, data);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to update inventory category');
  } catch (error: any) {
    console.error('Error updating inventory category:', error);
    throw error;
  }
};

export const deleteInventoryCategory = async (id: number): Promise<void> => {
  try {
    await apiClient.delete(`/inventory-categories/${id}`);
  } catch (error: any) {
    console.error('Error deleting inventory category:', error);
    throw error;
  }
};
