import apiClient from '../config/api';
import { JobOrderData } from '../types/jobOrder';

// Export JobOrderData for backwards compatibility
export type { JobOrderData } from '../types/jobOrder';

// Response interface
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
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
  assignedEmail?: string,
  updatedSince?: string
) => {
  try {
    const params: any = {
      fast: fastMode ? '1' : '0',
      page,
      limit,
      search,
      updated_since: updatedSince
    };

    if (assignedEmail) {
      params.assigned_email = assignedEmail;
    }

    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        if (userData.role) {
          params.user_role = userData.role;
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
    const authData = localStorage.getItem('authData');
    const currentUser = authData ? JSON.parse(authData) : null;
    const payload = currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {};
    const response = await apiClient.post<ApiResponse<any>>(`/job-orders/${idStr}/approve`, payload);
    return response.data;
  } catch (error) {
    console.error('Error approving job order:', error);
    throw error;
  }
};

export const getRelatedDetailsUpdateLogs = async (id: string | number): Promise<any> => {
  try {
    const idStr = id.toString();
    const response = await apiClient.get<any>(`/audit-trail-logs/by-job-order/${idStr}`);
    return {
      success: response.data.success ?? true,
      data: response.data.data || [],
      count: response.data.count || 0
    };
  } catch (error: any) {
    console.error('Error fetching related details update logs:', error);
    return {
      success: false,
      data: [],
      message: error.response?.data?.message || 'Failed to fetch related details update logs'
    };
  }
};

export interface BlockedTransferLogPayload {
  performed_by?: string;
  original_technician_name?: string;
  original_technician_email?: string;
  new_technician_name?: string;
  new_technician_email?: string;
  start_time?: string | null;
  description?: string;
}

export const logBlockedTechnicianTransfer = async (
  id: string | number,
  payload: BlockedTransferLogPayload
) => {
  try {
    const idStr = id.toString();
    const response = await apiClient.post<ApiResponse<any>>(
      `/job-orders/${idStr}/log-blocked-transfer`,
      payload
    );
    return response.data;
  } catch (error: any) {
    // Audit logging must never block the user-facing flow.
    console.error('Error logging blocked technician transfer:', error);
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to log blocked transfer'
    } as ApiResponse<any>;
  }
};