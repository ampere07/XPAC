import apiClient from '../config/api';

export interface LCP {
  id: number;
  lcp_name: string;
  created_at?: string;
  updated_at?: string;
  created_by_user_id?: number;
  updated_by_user_id?: number;
}

interface PaginationMeta {
  current_page: number;
  total_pages: number;
  total_items: number;
  items_per_page: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface LcpApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: PaginationMeta;
  errors?: Record<string, string[]>;
}

export const getLCPs = async (
  page: number = 1,
  limit: number = 20,
  search: string = ''
): Promise<LcpApiResponse<LCP[]>> => {
  try {
    const response = await apiClient.get<LcpApiResponse<LCP[]>>('/lcp', {
      params: { page, limit, search }
    });
    return response.data;
  } catch (error: any) {
    console.error('Error fetching LCP records:', error);
    throw error;
  }
};

export const getAllLCPs = async (): Promise<LcpApiResponse<LCP[]>> => {
  return getLCPs(1, 10000);
};

export const getLCPById = async (id: number): Promise<LcpApiResponse<LCP>> => {
  try {
    const response = await apiClient.get<LcpApiResponse<LCP>>(`/lcp/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching LCP record:', error);
    throw error;
  }
};

export const createLCP = async (name: string): Promise<LcpApiResponse<LCP>> => {
  try {
    const response = await apiClient.post<LcpApiResponse<LCP>>('/lcp', { name });
    return response.data;
  } catch (error: any) {
    console.error('Error creating LCP:', error);
    throw error;
  }
};

export const updateLCP = async (id: number, name: string): Promise<LcpApiResponse<LCP>> => {
  try {
    const response = await apiClient.put<LcpApiResponse<LCP>>(`/lcp/${id}`, { name });
    return response.data;
  } catch (error: any) {
    console.error('Error updating LCP:', error);
    throw error;
  }
};

export const deleteLCP = async (id: number): Promise<LcpApiResponse<void>> => {
  try {
    const response = await apiClient.delete<LcpApiResponse<void>>(`/lcp/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting LCP:', error);
    throw error;
  }
};
