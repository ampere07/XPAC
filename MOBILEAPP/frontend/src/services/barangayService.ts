import apiClient from '../config/api';

export interface Barangay {
  id: number;
  barangay: string;
  city_id?: number;
}

export interface BarangaysResponse {
  success: boolean;
  data: Barangay[];
  message?: string;
}

export interface BarangayResponse {
  success: boolean;
  data: Barangay;
  message?: string;
}

export const barangayService = {
  getAll: async (): Promise<BarangaysResponse> => {
    try {
      const response = await apiClient.get<BarangaysResponse>('/barangays');
      return response.data;
    } catch (error) {
      console.error('Error fetching barangays:', error);
      throw error;
    }
  },

  getById: async (id: number): Promise<BarangayResponse> => {
    try {
      const response = await apiClient.get<BarangayResponse>(`/barangays/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching barangay:', error);
      throw error;
    }
  },

  getByCity: async (cityId: number): Promise<BarangaysResponse> => {
    try {
      const response = await apiClient.get<BarangaysResponse>(`/barangays/city/${cityId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching barangays by city:', error);
      throw error;
    }
  }
};

export default barangayService;
