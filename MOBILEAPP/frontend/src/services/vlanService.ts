import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: {
    current_page: number;
    total_pages: number;
    total_items: number;
    items_per_page: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

export interface VLAN {
  vlan_id: string;
  value: number;
  created_at?: string;
  updated_at?: string;
}

export const getAllVLANs = async (search?: string, page: number = 1, limit: number = 100): Promise<ApiResponse<VLAN[]>> => {
  try {
    const params: any = { page, limit };
    if (search) {
      params.search = search;
    }
    
    const response = await apiClient.get<ApiResponse<VLAN[]>>('/vlans', { params });
    return response.data;
  } catch (error: any) {
    console.error('Error fetching VLANs:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch VLANs'
    };
  }
};

export const getVLANById = async (id: string): Promise<ApiResponse<VLAN>> => {
  try {
    const response = await apiClient.get<ApiResponse<VLAN>>(`/vlans/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching VLAN:', error);
    throw error;
  }
};

export const createVLAN = async (vlanData: { value: number; vlan_id: string }): Promise<ApiResponse<VLAN>> => {
  try {
    const response = await apiClient.post<ApiResponse<VLAN>>('/vlans', vlanData);
    return response.data;
  } catch (error: any) {
    console.error('Error creating VLAN:', error);
    throw error;
  }
};

export const updateVLAN = async (id: string, vlanData: { value: number; vlan_id: string }): Promise<ApiResponse<VLAN>> => {
  try {
    const response = await apiClient.put<ApiResponse<VLAN>>(`/vlans/${id}`, vlanData);
    return response.data;
  } catch (error: any) {
    console.error('Error updating VLAN:', error);
    throw error;
  }
};

export const deleteVLAN = async (id: string): Promise<ApiResponse<null>> => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/vlans/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting VLAN:', error);
    throw error;
  }
};
