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
  organization_id?: number | null;
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
  active_sessions?: number;
  restricted_sessions?: number;
  offline_sessions?: number;
  disconnected_sessions?: number;
  not_found_sessions?: number;
  total_technical_details?: number;
  total_sessions?: number;
  organization_id?: number | null;
}

let mapDataCache: LCPNAPMapData[] | null = null;

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

export const getAllLCPNAPsForMap = async (forceRefresh: boolean = false, search?: string): Promise<ApiResponse<LCPNAPMapData[]>> => {
  try {
    if (!forceRefresh && mapDataCache && !search) {
      return {
        success: true,
        data: mapDataCache,
        message: 'Data loaded from cache'
      };
    }

    const params: any = {};
    if (search) params.search = search;

    const response = await apiClient.get<ApiResponse<LCPNAPMapData[]>>('/lcp-nap-locations', { params });
    if (response.data.success && !search) {
      mapDataCache = response.data.data;
    }
    return response.data;
  } catch (error: any) {
    console.error('Error fetching LCPNAP map data:', error);
    return {
      success: false,
      data: mapDataCache || [],
      message: error.message || 'Failed to fetch LCPNAP map data'
    };
  }
};

export const clearLCPNAPMapCache = () => {
  mapDataCache = null;
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
export const getRelatedCustomers = async (id: number): Promise<ApiResponse<any[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<any[]>>(`/lcpnap/${id}/related-customers`);
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
