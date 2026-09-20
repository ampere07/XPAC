import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ServiceOrderItem {
  id?: number;
  service_order_id: number;
  item_name: string;
  quantity: number;
}

export const createServiceOrderItems = async (items: ServiceOrderItem[]): Promise<ApiResponse<ServiceOrderItem[]>> => {
  try {
    const response = await apiClient.post<ApiResponse<ServiceOrderItem[]>>('/service-order-items', { items });
    return response.data;
  } catch (error: any) {
    console.error('Error creating service order items:', error);
    if (error.response?.data?.errors) {
      console.error('Validation errors:', error.response.data.errors);
    }
    throw error;
  }
};

export const getServiceOrderItems = async (serviceOrderId: number): Promise<ApiResponse<ServiceOrderItem[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<ServiceOrderItem[]>>(`/service-order-items/${serviceOrderId}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching service order items:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch service order items'
    };
  }
};

export const updateServiceOrderItems = async (serviceOrderId: number, items: ServiceOrderItem[]): Promise<ApiResponse<ServiceOrderItem[]>> => {
  try {
    const response = await apiClient.put<ApiResponse<ServiceOrderItem[]>>(`/service-order-items/${serviceOrderId}`, { items });
    return response.data;
  } catch (error: any) {
    console.error('Error updating service order items:', error);
    throw error;
  }
};

export const deleteServiceOrderItems = async (serviceOrderId: number): Promise<ApiResponse<null>> => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/service-order-items/${serviceOrderId}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting service order items:', error);
    throw error;
  }
};
