import apiClient from '../config/api';
import {
  Technician,
  ApiResponse
} from '../types/api';

export const technicianService = {
  getAllTechnicians: async (): Promise<ApiResponse<Technician[]>> => {
    try {
      const response = await apiClient.get<ApiResponse<Technician[]>>('/technicians');
      return response.data;
    } catch (error: any) {
      console.error('Get technicians API error:', error.message);
      throw error;
    }
  },

  createTechnician: async (techData: Omit<Technician, 'id' | 'updated_at'>): Promise<ApiResponse<Technician>> => {
    try {
      const response = await apiClient.post<ApiResponse<Technician>>('/technicians', techData);
      return response.data;
    } catch (error: any) {
      console.error('Create technician API error:', error.message);
      throw error;
    }
  },

  getTechnicianById: async (techId: number): Promise<ApiResponse<Technician>> => {
    const response = await apiClient.get<ApiResponse<Technician>>(`/technicians/${techId}`);
    return response.data;
  },

  updateTechnician: async (techId: number, techData: Partial<Technician>): Promise<ApiResponse<Technician>> => {
    try {
      const response = await apiClient.put<ApiResponse<Technician>>(`/technicians/${techId}`, techData);
      return response.data;
    } catch (error: any) {
      console.error('Update technician API error:', error.message);
      throw error;
    }
  },

  deleteTechnician: async (techId: number): Promise<ApiResponse<void>> => {
    try {
      const response = await apiClient.delete<ApiResponse<void>>(`/technicians/${techId}`);
      return response.data;
    } catch (error: any) {
      console.error('Delete technician API error:', error.message);
      throw error;
    }
  }
};
