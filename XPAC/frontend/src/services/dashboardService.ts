import api from '../config/api';

export interface DashboardCounts {
  radius_online: number;
  radius_offline: number;
  radius_disconnected: number;
  radius_restricted: number;
  support_status_in_progress: number;
  support_status_for_visit: number;
  support_status_resolved: number;
  support_status_failed: number;
  visit_status_in_progress: number;
  visit_status_done: number;
  visit_status_rescheduled: number;
  visit_status_failed: number;
  
  // Job Order Status Today
  jo_status_pending: number;
  jo_status_in_progress: number;
  jo_status_done: number;
  jo_status_failed: number;

  // Application Status Today
  app_status_scheduled: number;
  app_status_in_progress: number;
  app_status_no_facility: number;
  app_status_cancelled: number;
  app_status_no_slot: number;
  app_status_duplicate: number;

  so_support_in_progress: number;
  so_visit_in_progress: number;
  so_visit_pullout_in_progress: number;
  app_pending: number;
  jo_in_progress: number;
  monthly_support_concerns: { label: string; count: number }[];
  monthly_repair_categories: { label: string; count: number }[];
  
  // Service Connection Statuses
  services?: {
    radius: {
      status: 'online' | 'offline';
      message: string | null;
      updated_at: string | null;
    };
    smartolt: {
      status: 'online' | 'offline';
      message: string | null;
      updated_at: string | null;
    };
  };
}

export interface DashboardResponse<T> {
  status: string;
  data: T;
  message?: string;
}

export const dashboardService = {
  getCounts: async (organizationId?: string | number): Promise<DashboardResponse<DashboardCounts>> => {
    try {
      const params = organizationId && organizationId !== 'All' ? { organization_id: organizationId } : {};
      const response = await api.get<DashboardResponse<DashboardCounts>>('/dashboard/counts', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching dashboard counts from DashboardController:', error);
      throw error;
    }
  }
};
