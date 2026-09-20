import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: {
    current_page: number;
    total_pages: number;
    total_items: number;
    per_page: number;
    from: number;
    to: number;
  };
}

export interface InventoryItem {
  id: number;
  item_name: string;
  item_description?: string;
  category_id?: number;
  supplier_id?: number;
  quantity_alert?: number;
  image_url?: string;
  created_at?: string;
  updated_at?: string;
}

export const getAllInventoryItems = async (search?: string, page: number = 1, limit: number = 100): Promise<ApiResponse<InventoryItem[]>> => {
  try {
    const params: any = { page, limit };
    if (search) {
      params.search = search;
    }
    
    const response = await apiClient.get<ApiResponse<InventoryItem[]>>('/inventory-items', { params });
    return response.data;
  } catch (error: any) {
    console.error('Error fetching inventory items:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch inventory items'
    };
  }
};

export const getInventoryItemById = async (id: number): Promise<ApiResponse<InventoryItem>> => {
  try {
    const response = await apiClient.get<ApiResponse<InventoryItem>>(`/inventory-items/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching inventory item:', error);
    throw error;
  }
};

export const createInventoryItem = async (itemData: any): Promise<ApiResponse<InventoryItem>> => {
  try {
    const response = await apiClient.post<ApiResponse<InventoryItem>>('/inventory-items', itemData);
    return response.data;
  } catch (error: any) {
    console.error('Error creating inventory item:', error);
    throw error;
  }
};

export const updateInventoryItem = async (id: number, itemData: any): Promise<ApiResponse<InventoryItem>> => {
  try {
    const response = await apiClient.put<ApiResponse<InventoryItem>>(`/inventory-items/${id}`, itemData);
    return response.data;
  } catch (error: any) {
    console.error('Error updating inventory item:', error);
    throw error;
  }
};

export const deleteInventoryItem = async (id: number): Promise<ApiResponse<null>> => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/inventory-items/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting inventory item:', error);
    throw error;
  }
};
