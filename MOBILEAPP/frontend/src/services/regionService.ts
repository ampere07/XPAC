import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface Region {
  id: number;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export const getRegions = async (): Promise<Region[]> => {
  try {
    const response = await apiClient.get('/regions');
    const data = response.data as any;
    
    if (Array.isArray(data)) {
      return data;
    }
    
    if (data.success && Array.isArray(data.data)) {
      return data.data;
    }
    
    return [];
  } catch (error: any) {
    console.error('Error fetching regions:', error);
    return [];
  }
};
