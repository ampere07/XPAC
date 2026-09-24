import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  count?: number;
  pagination?: {
    current_page: number;
    total_pages: number;
    total_items: number;
    per_page: number;
    from: number;
    to: number;
  };
}

export interface LCPNAP {
  id: number;
  lcpnap_name: string;
  lcp: string;
  nap: string;
  coordinates: string;
  street?: string;
  city?: string;
  region?: string;
  barangay?: string;
  port_total?: number;
  reading_image_url?: string;
  image1_url?: string;
  image2_url?: string;
  modified_by?: string;
  modified_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface LCPNAPMapData {
  id: number;
  lcpnap_name: string;
  lcp_name: string;
  nap_name: string;
  coordinates: string;
  street?: string;
  city?: string;
  region?: string;
  barangay?: string;
  port_total?: number;
  reading_image_url?: string;
  image1_url?: string;
  image2_url?: string;
  modified_by?: string;
  modified_date?: string;
}

export const getAllLCPNAPs = async (search?: string, page: number = 1, limit: number = 100): Promise<ApiResponse<LCPNAP[]>> => {
  try {
    const params: any = { page, limit };
    if (search) {
      params.search = search;
    }

    const response = await apiClient.get<ApiResponse<LCPNAP[]>>('/lcpnap', { params });
    return response.data;
  } catch (error: any) {
    console.error('Error fetching LCPNAP records:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch LCPNAP records'
    };
  }
};

export const getAllLCPNAPsForMap = async (): Promise<ApiResponse<LCPNAPMapData[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<LCPNAPMapData[]>>('/lcp-nap-locations');
    return response.data;
  } catch (error: any) {
    console.error('Error fetching LCPNAP map data:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch LCPNAP map data'
    };
  }
};

export const getLCPNAPById = async (id: number): Promise<ApiResponse<LCPNAP>> => {
  try {
    const response = await apiClient.get<ApiResponse<LCPNAP>>(`/lcpnap/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching LCPNAP record:', error);
    throw error;
  }
};

export const getLCPNAPForMapById = async (id: number): Promise<ApiResponse<LCPNAPMapData>> => {
  try {
    const response = await apiClient.get<ApiResponse<LCPNAPMapData>>(`/lcp-nap-locations/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching LCPNAP map record:', error);
    throw error;
  }
};

export const createLCPNAP = async (lcpnapData: FormData): Promise<ApiResponse<LCPNAP>> => {
  try {
    const response = await apiClient.post<ApiResponse<LCPNAP>>('/lcpnap', lcpnapData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('Error creating LCPNAP record:', error);
    throw error;
  }
};

export const updateLCPNAP = async (id: number, lcpnapData: FormData): Promise<ApiResponse<LCPNAP>> => {
  try {
    const response = await apiClient.put<ApiResponse<LCPNAP>>(`/lcpnap/${id}`, lcpnapData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('Error updating LCPNAP record:', error);
    throw error;
  }
};

export const deleteLCPNAP = async (id: number): Promise<ApiResponse<null>> => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/lcpnap/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting LCPNAP record:', error);
    throw error;
  }
};

export const getLCPNAPStatistics = async (): Promise<ApiResponse<{ total_locations: number; total_with_coordinates: number }>> => {
  try {
    const response = await apiClient.get<ApiResponse<{ total_locations: number; total_with_coordinates: number }>>('/lcpnap/statistics');
    return response.data;
  } catch (error: any) {
    console.error('Error fetching LCPNAP statistics:', error);
    throw error;
  }
};

export const getLCPNAPLookupData = async (): Promise<ApiResponse<Array<{ id: number; lcpnap_name: string }>>> => {
  try {
    const response = await apiClient.get<ApiResponse<Array<{ id: number; lcpnap_name: string }>>>('/lcpnap/lookup');
    return response.data;
  } catch (error: any) {
    console.error('Error fetching LCPNAP lookup data:', error);
    throw error;
  }
};
export const getMostUsedLCPNAPs = async (): Promise<ApiResponse<LCPNAP[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<LCPNAP[]>>('/lcpnap/get-most-used');
    return response.data;
  } catch (error: any) {
    console.error('Error fetching most used LCPNAP records:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch most used LCPNAP records'
    };
  }
};

export interface RelatedCustomer {
  account_no: string;
  full_name: string;
  port: string;
  status: string;
}

export const getRelatedCustomers = async (id: number): Promise<ApiResponse<RelatedCustomer[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<RelatedCustomer[]>>(`/lcpnap/${id}/related-customers`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching related customers:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch related customers'
    };
  }
};

