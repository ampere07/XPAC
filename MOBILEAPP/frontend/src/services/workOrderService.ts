import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import { WorkOrderData } from '../types/workOrder';

export type { WorkOrderData } from '../types/workOrder';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  count?: number;
  table?: string;
  pagination?: {
    current_page: number;
    total_pages: number;
    total_items: number;
    items_per_page: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

export const createWorkOrder = async (workOrderData: WorkOrderData) => {
  try {
    const response = await apiClient.post<ApiResponse<WorkOrderData>>('/work-orders', workOrderData);
    return response.data;
  } catch (error) {
    console.error('Error creating work order:', error);
    throw error;
  }
};

export const getWorkOrders = async (
  fastMode: boolean = false,
  page: number = 1,
  limit: number = 50,
  search?: string,
  status?: string
) => {
  try {
    const params: any = {
      page,
      limit,
      search,
      status
    };

    const response = await apiClient.get<ApiResponse<WorkOrderData[]>>('/work-orders', { params });

    if (response.data && response.data.success && Array.isArray(response.data.data)) {
      return {
        ...response.data,
        workOrders: response.data.data
      };
    }

    return {
      ...response.data,
      workOrders: [],
      pagination: response.data.pagination || { current_page: page, total_pages: 1, total_items: 0, items_per_page: limit, has_next: false, has_prev: false }
    };
  } catch (error) {
    console.error('Error fetching work orders:', error);
    return {
      success: false,
      workOrders: [],
      pagination: { current_page: page, total_pages: 1, total_items: 0, items_per_page: limit, has_next: false, has_prev: false },
      message: error instanceof Error ? error.message : 'Unknown error fetching work orders'
    };
  }
};

export const getWorkOrder = async (id: string | number) => {
  try {
    const idStr = id.toString();
    const response = await apiClient.get<ApiResponse<WorkOrderData>>(`/work-orders/${idStr}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching work order:', error);
    throw error;
  }
};

export const updateWorkOrder = async (id: string | number, workOrderData: Partial<WorkOrderData>) => {
  try {
    const idStr = id.toString();
    const response = await apiClient.put<ApiResponse<WorkOrderData>>(`/work-orders/${idStr}`, workOrderData);
    return response.data;
  } catch (error) {
    console.error('Error updating work order:', error);
    throw error;
  }
};

/**
 * Release a work order to its technician ahead of their queue.
 *
 * Administrator-only on the server, so the flag cannot be flipped by the
 * technician whose queue it governs.
 */
export const enableWorkOrderForTechnician = async (id: string | number) => {
  try {
    const idStr = id.toString();
    const authData = await AsyncStorage.getItem('authData');
    const currentUser = authData ? JSON.parse(authData) : null;
    const payload = currentUser?.email ? { updated_by: currentUser.email } : {};
    const response = await apiClient.post<ApiResponse<any>>(`/work-orders/${idStr}/enable-technician`, payload);
    return response.data;
  } catch (error) {
    console.error('Error enabling work order for technician:', error);
    throw error;
  }
};

export const deleteWorkOrder = async (id: string | number) => {
  try {
    const idStr = id.toString();
    const response = await apiClient.delete<ApiResponse<any>>(`/work-orders/${idStr}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting work order:', error);
    throw error;
  }
};