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

export interface Port {
  id: number;
  PORT_ID: string;
  Label: string;
  created_at?: string;
  updated_at?: string;
}

export const getAllPorts = async (lcpnap?: string, page: number = 1, limit: number = 100, excludeUsed: boolean = false, currentJobOrderId?: number): Promise<ApiResponse<Port[]>> => {
  try {
    const params: any = { page, limit };
    if (lcpnap) {
      params.lcpnap = lcpnap;
    }
    if (excludeUsed) {
      params.exclude_used = true;
    }
    if (currentJobOrderId) {
      params.current_job_order_id = currentJobOrderId;
    }

    const response = await apiClient.get<ApiResponse<Port[]>>('/ports', { params });
    return response.data;
  } catch (error: any) {
    console.error('Error fetching ports:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch ports'
    };
  }
};

export const getUsedPorts = async (lcpnap: string, currentJobOrderId?: number, currentAccountNo?: string): Promise<ApiResponse<{ used: string[], total: number }>> => {
  try {
    const params: any = { lcpnap };
    if (currentJobOrderId) {
      params.current_job_order_id = currentJobOrderId;
    }
    if (currentAccountNo) {
      params.current_account_no = currentAccountNo;
    }
    const response = await apiClient.get<any>('/ports/used', { params });

    // Transform backend structure to expected structure if needed
    // The backend returns { success: true, data: string[], total_ports: number }
    return {
      success: response.data.success,
      data: {
        used: response.data.data,
        total: response.data.total_ports
      },
      message: response.data.message
    };
  } catch (error: any) {
    console.error('Error fetching used ports:', error);
    return {
      success: false,
      data: { used: [], total: 32 },
      message: error.message || 'Failed to fetch used ports'
    };
  }
};

export const getPortById = async (id: number): Promise<ApiResponse<Port>> => {
  try {
    const response = await apiClient.get<ApiResponse<Port>>(`/ports/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching port:', error);
    throw error;
  }
};

export const createPort = async (portData: { label: string; port_id: string }): Promise<ApiResponse<Port>> => {
  try {
    const response = await apiClient.post<ApiResponse<Port>>('/ports', portData);
    return response.data;
  } catch (error: any) {
    console.error('Error creating port:', error);
    throw error;
  }
};

export const updatePort = async (id: number, portData: { label: string; port_id: string }): Promise<ApiResponse<Port>> => {
  try {
    const response = await apiClient.put<ApiResponse<Port>>(`/ports/${id}`, portData);
    return response.data;
  } catch (error: any) {
    console.error('Error updating port:', error);
    throw error;
  }
};

export const deletePort = async (id: number): Promise<ApiResponse<null>> => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/ports/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting port:', error);
    throw error;
  }
};
