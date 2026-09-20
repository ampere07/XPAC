import apiClient from '../config/api';

export interface StatusRemark {
  id: number;
  status_remarks: string;
  modified_date?: string;
  modified_by?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const statusRemarksService = {
  getAllStatusRemarks: async (): Promise<StatusRemark[]> => {
    try {
      const response = await apiClient.get<ApiResponse<StatusRemark[]>>('/status-remarks');
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching status remarks:', error);
      return [];
    }
  }
};
