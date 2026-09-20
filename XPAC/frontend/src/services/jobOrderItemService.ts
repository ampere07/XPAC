import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface JobOrderItem {
  id?: number;
  job_order_id: number;
  item_name: string;
  quantity: number;
}

export const createJobOrderItems = async (items: JobOrderItem[]): Promise<ApiResponse<JobOrderItem[]>> => {
  try {
    const response = await apiClient.post<ApiResponse<JobOrderItem[]>>('/job-order-items', { items });
    return response.data;
  } catch (error: any) {
    console.error('Error creating job order items:', error);
    if (error.response?.data?.errors) {
      console.error('Validation errors:', error.response.data.errors);
    }
    throw error;
  }
};

export const getJobOrderItems = async (jobOrderId: number): Promise<ApiResponse<JobOrderItem[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<JobOrderItem[]>>(`/job-order-items/${jobOrderId}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching job order items:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch job order items'
    };
  }
};

export const updateJobOrderItems = async (jobOrderId: number, items: JobOrderItem[]): Promise<ApiResponse<JobOrderItem[]>> => {
  try {
    const response = await apiClient.put<ApiResponse<JobOrderItem[]>>(`/job-order-items/${jobOrderId}`, { items });
    return response.data;
  } catch (error: any) {
    console.error('Error updating job order items:', error);
    throw error;
  }
};

export const deleteJobOrderItems = async (jobOrderId: number): Promise<ApiResponse<null>> => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/job-order-items/${jobOrderId}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting job order items:', error);
    throw error;
  }
};
