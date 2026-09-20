import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface WorkOrderItem {
  id?: number;
  job_order_id: number;
  item_name: string;
  quantity: number;
}

export const createWorkOrderItems = async (items: WorkOrderItem[]): Promise<ApiResponse<WorkOrderItem[]>> => {
  try {
    const response = await apiClient.post<ApiResponse<WorkOrderItem[]>>('/job-order-items', { items });
    return response.data;
  } catch (error: any) {
    console.error('Error creating work order items:', error);
    if (error.response?.data?.errors) {
      console.error('Validation errors:', error.response.data.errors);
    }
    throw error;
  }
};

export const getWorkOrderItems = async (workOrderId: number): Promise<ApiResponse<WorkOrderItem[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<WorkOrderItem[]>>(`/job-order-items/${workOrderId}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching work order items:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch work order items'
    };
  }
};

export const updateWorkOrderItems = async (workOrderId: number, items: WorkOrderItem[]): Promise<ApiResponse<WorkOrderItem[]>> => {
  try {
    const response = await apiClient.put<ApiResponse<WorkOrderItem[]>>(`/job-order-items/${workOrderId}`, { items });
    return response.data;
  } catch (error: any) {
    console.error('Error updating work order items:', error);
    throw error;
  }
};

export const deleteWorkOrderItems = async (workOrderId: number): Promise<ApiResponse<null>> => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/job-order-items/${workOrderId}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting work order items:', error);
    throw error;
  }
};
