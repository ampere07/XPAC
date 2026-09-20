import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface UsageType {
  id: number;
  usage_name: string;
  created_at?: string;
  updated_at?: string;
}

export const getAllUsageTypes = async (): Promise<ApiResponse<UsageType[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<UsageType[]>>('/usage-types');
    return response.data;
  } catch (error: any) {
    console.error('Error fetching usage types:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch usage types'
    };
  }
};

export const getUsageTypeById = async (id: number): Promise<ApiResponse<UsageType>> => {
  try {
    const response = await apiClient.get<ApiResponse<UsageType>>(`/usage-types/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching usage type:', error);
    throw error;
  }
};

export const createUsageType = async (usageTypeData: Partial<UsageType>): Promise<ApiResponse<UsageType>> => {
  try {
    const response = await apiClient.post<ApiResponse<UsageType>>('/usage-types', usageTypeData);
    return response.data;
  } catch (error: any) {
    console.error('Error creating usage type:', error);
    throw error;
  }
};

export const updateUsageType = async (id: number, usageTypeData: Partial<UsageType>): Promise<ApiResponse<UsageType>> => {
  try {
    const response = await apiClient.put<ApiResponse<UsageType>>(`/usage-types/${id}`, usageTypeData);
    return response.data;
  } catch (error: any) {
    console.error('Error updating usage type:', error);
    throw error;
  }
};

export const deleteUsageType = async (id: number): Promise<ApiResponse<null>> => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/usage-types/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting usage type:', error);
    throw error;
  }
};
