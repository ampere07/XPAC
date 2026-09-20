import apiClient from '../config/api';
import { ApiResponse } from '../types/api';

export interface Technician {
  id: number;
  first_name: string;
  middle_initial: string | null;
  last_name: string;
  updated_at?: string;
  updated_by?: string;
}

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

  getTechnicianById: async (id: number): Promise<ApiResponse<Technician>> => {
    try {
      const response = await apiClient.get<ApiResponse<Technician>>(`/technicians/${id}`);
      return response.data;
    } catch (error: any) {
      console.error('Get technician by ID API error:', error.message);
      throw error;
    }
  },

  createTechnician: async (technicianData: Partial<Technician>): Promise<ApiResponse<Technician>> => {
    try {
      const response = await apiClient.post<ApiResponse<Technician>>('/technicians', technicianData);
      return response.data;
    } catch (error: any) {
      console.error('Create technician API error:', error.message);
      throw error;
    }
  },

  updateTechnician: async (id: number, technicianData: Partial<Technician>): Promise<ApiResponse<Technician>> => {
    try {
      const response = await apiClient.put<ApiResponse<Technician>>(`/technicians/${id}`, technicianData);
      return response.data;
    } catch (error: any) {
      console.error('Update technician API error:', error.message);
      throw error;
    }
  },

  deleteTechnician: async (id: number): Promise<ApiResponse<void>> => {
    try {
      const response = await apiClient.delete<ApiResponse<void>>(`/technicians/${id}`);
      return response.data;
    } catch (error: any) {
      console.error('Delete technician API error:', error.message);
      throw error;
    }
  }
};
