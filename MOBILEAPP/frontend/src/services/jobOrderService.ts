import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import { JobOrderData } from '../types/jobOrder';

// Export JobOrderData for backwards compatibility
export type { JobOrderData } from '../types/jobOrder';

// Response interface
interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  count?: number;
  table?: string;
  debug?: any;
  pagination?: {
    current_page: number;
    per_page: number;
    total_count?: number;
    has_more: boolean;
  };
}

export const createJobOrder = async (jobOrderData: JobOrderData) => {
  try {
    const response = await apiClient.post<ApiResponse<JobOrderData>>('/job-orders', jobOrderData);
    return response.data;
  } catch (error) {
    console.error('Error creating job order:', error);
    throw error;
  }
};

export const getJobOrders = async (
  fastMode: boolean = false,
  page: number = 1,
  limit: number = 50,
  search?: string,
  assignedEmail?: string
) => {
  try {
    const params: any = {
      fast: fastMode ? '1' : '0',
      page,
      limit,
      search
    };

    if (assignedEmail) {
      params.assigned_email = assignedEmail;
    }

    const authData = await AsyncStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        if (userData.role) {
          params.user_role = userData.role;
        }
        if (userData.email) {
          params.user_email = userData.email;
        }
      } catch (err) {
        console.error('Failed to parse authData:', err);
      }
    }

    const response = await apiClient.get<ApiResponse<JobOrderData[]>>('/job-orders', { params });

    // Process the data to ensure it matches our expected format
    if (response.data && response.data.success && Array.isArray(response.data.data)) {
      // Map any database field names that might be different from our interface
      const processedData = response.data.data.map(item => {
        return {
          ...item,
          id: item.id || item.JobOrder_ID
        };
      });

      return {
        ...response.data,
        jobOrders: processedData // Consistent with getApplications returning 'applications'
      };
    }

    return {
      ...response.data,
      jobOrders: [],
      pagination: response.data.pagination || { current_page: page, per_page: limit, has_more: false }
    };
  } catch (error) {
    console.error('Error fetching job orders:', error);
    return {
      success: false,
      jobOrders: [],
      pagination: { current_page: page, per_page: limit, has_more: false },
      message: error instanceof Error ? error.message : 'Unknown error fetching job orders'
    };
  }
};

export const getJobOrder = async (id: string | number) => {
  try {
    // Ensure ID is a string for the API URL
    const idStr = id.toString();
    const response = await apiClient.get<ApiResponse<JobOrderData>>(`/job-orders/${idStr}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching job order:', error);
    throw error;
  }
};

export const updateJobOrder = async (id: string | number, jobOrderData: Partial<JobOrderData>) => {
  try {
    // Ensure ID is a string for the API URL
    const idStr = id.toString();
    const response = await apiClient.put<ApiResponse<JobOrderData>>(`/job-orders/${idStr}`, jobOrderData);
    return response.data;
  } catch (error) {
    console.error('Error updating job order:', error);
    throw error;
  }
};

export const approveJobOrder = async (id: string | number) => {
  try {
    const idStr = id.toString();
    const response = await apiClient.post<ApiResponse<any>>(`/job-orders/${idStr}/approve`);
    return response.data;
  } catch (error) {
    console.error('Error approving job order:', error);
    throw error;
  }
};

export const uploadJobOrderImages = async (id: string | number, formData: FormData) => {
  try {
    const idStr = id.toString();
    const response = await apiClient.post<ApiResponse<any>>(`/job-orders/${idStr}/upload-images`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error uploading job order images:', error);
    throw error;
  }
};