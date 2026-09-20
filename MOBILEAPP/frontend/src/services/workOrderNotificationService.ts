import apiClient from '../config/api';

export interface WorkOrderNotification {
  id: number;
  job_order_id: number;
  customer_name: string;
  account_no?: string;
  plan_name: string;
  onsite_status: string;
  status: string;
  is_read: boolean;
  created_at: string;
  formatted_date: string;
}

export interface WorkOrderNotificationResponse {
  success: boolean;
  data: WorkOrderNotification[];
  message?: string;
}

export interface UnreadCountResponse {
  success: boolean;
  count: number;
}

interface AxiosErrorType {
  response?: {
    status: number;
    data: any;
  };
  message: string;
  isAxiosError: boolean;
}

const isAxiosError = (error: any): error is AxiosErrorType => {
  return error && error.isAxiosError === true;
};

export const workOrderNotificationService = {
  async createNotification(data: {
    job_order_id: number | string;
    customer_name: string;
    account_no?: string;
    onsite_status: string;
    plan_name?: string;
  }): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await apiClient.post<{ success: boolean; message?: string }>('/job-order-notifications', data);
      return response.data;
    } catch (error) {
      if (isAxiosError(error)) {
        console.error('Failed to create notification:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
      } else {
        console.error('Failed to create notification:', error);
      }
      return { success: false, message: 'Failed to create notification' };
    }
  },

  async getRecentNotifications(limit: number = 10): Promise<WorkOrderNotification[]> {
    try {
      const response = await apiClient.get<WorkOrderNotificationResponse>(
        `/job-order-notifications/recent?limit=${limit}&t=${Date.now()}`
      );
      return response.data.data || [];
    } catch (error) {
      if (isAxiosError(error)) {
        console.error('Failed to fetch notifications:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
      } else {
        console.error('Failed to fetch notifications:', error);
      }
      return [];
    }
  },

  async getUnreadCount(): Promise<number> {
    try {
      const response = await apiClient.get<UnreadCountResponse>(
        `/job-order-notifications/unread-count?t=${Date.now()}`
      );
      return response.data.count || 0;
    } catch (error) {
      if (isAxiosError(error)) {
        console.error('Failed to fetch unread count:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
      } else {
        console.error('Failed to fetch unread count:', error);
      }
      return 0;
    }
  },

  async markAsRead(id: number): Promise<boolean> {
    try {
      const response = await apiClient.put<{ success: boolean }>(`/job-order-notifications/${id}/read`);
      return response.data.success;
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      return false;
    }
  },

  async markAllAsRead(): Promise<boolean> {
    try {
      const response = await apiClient.put<{ success: boolean }>('/job-order-notifications/mark-all-read');
      return response.data.success;
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      return false;
    }
  }
};
