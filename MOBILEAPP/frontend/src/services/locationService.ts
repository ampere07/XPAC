import apiClient from '../config/api';

export interface Location {
  id: number;
  name: string;
  type: 'region' | 'city' | 'borough' | 'village';
  parentId?: number;
  parentName?: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocationFormData {
  name: string;
  type: 'region' | 'city' | 'borough' | 'village';
  parentId?: number;
  description?: string;
  isActive: boolean;
}

export interface LocationsResponse {
  success: boolean;
  data: Location[];
  message?: string;
}

export interface LocationResponse {
  success: boolean;
  data: Location;
  message?: string;
}

export const locationService = {
  getAll: async (): Promise<LocationsResponse> => {
    try {
      const response = await apiClient.get<LocationsResponse>('/locations');
      return response.data;
    } catch (error) {
      console.error('Error fetching locations:', error);
      throw error;
    }
  },

  getById: async (id: number): Promise<LocationResponse> => {
    try {
      const response = await apiClient.get<LocationResponse>(`/locations/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching location:', error);
      throw error;
    }
  },

  create: async (locationData: LocationFormData): Promise<LocationResponse> => {
    try {
      const response = await apiClient.post<LocationResponse>('/locations', locationData);
      return response.data;
    } catch (error) {
      console.error('Error creating location:', error);
      throw error;
    }
  },

  update: async (id: number, locationData: Partial<LocationFormData>): Promise<LocationResponse> => {
    try {
      const response = await apiClient.put<LocationResponse>(`/locations/${id}`, locationData);
      return response.data;
    } catch (error) {
      console.error('Error updating location:', error);
      throw error;
    }
  },

  delete: async (id: number): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await apiClient.delete<{ success: boolean; message?: string }>(`/locations/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting location:', error);
      throw error;
    }
  },

  getByType: async (type: string): Promise<LocationsResponse> => {
    try {
      const response = await apiClient.get<LocationsResponse>(`/locations/type/${type}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching locations by type:', error);
      throw error;
    }
  },

  getChildren: async (parentId: number): Promise<LocationsResponse> => {
    try {
      const response = await apiClient.get<LocationsResponse>(`/locations/parent/${parentId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching child locations:', error);
      throw error;
    }
  },

  toggleStatus: async (id: number): Promise<LocationResponse> => {
    try {
      const response = await apiClient.patch<LocationResponse>(`/locations/${id}/toggle-status`);
      return response.data;
    } catch (error) {
      console.error('Error toggling location status:', error);
      throw error;
    }
  }
};

export default locationService;
