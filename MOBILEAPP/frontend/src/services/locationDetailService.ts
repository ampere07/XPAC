import apiClient from '../config/api';

export interface LocationDetail {
  id: number;
  location_name: string;
  barangay_id: number;
  barangay?: {
    id: number;
    barangay: string;
    city_id?: number;
  };
}

export interface LocationDetailsResponse {
  success: boolean;
  data: LocationDetail[];
  message?: string;
}

export interface LocationDetailResponse {
  success: boolean;
  data: LocationDetail;
  message?: string;
}

export const locationDetailService = {
  getAll: async (): Promise<LocationDetailsResponse> => {
    try {
      const response = await apiClient.get<LocationDetailsResponse>('/location-details');
      return response.data;
    } catch (error) {
      console.error('Error fetching location details:', error);
      throw error;
    }
  },

  getById: async (id: number): Promise<LocationDetailResponse> => {
    try {
      const response = await apiClient.get<LocationDetailResponse>(`/location-details/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching location detail:', error);
      throw error;
    }
  },

  getByBarangay: async (barangayId: number): Promise<LocationDetailsResponse> => {
    try {
      const response = await apiClient.get<LocationDetailsResponse>(`/location-details/barangay/${barangayId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching location details by barangay:', error);
      throw error;
    }
  }
};

export default locationDetailService;
