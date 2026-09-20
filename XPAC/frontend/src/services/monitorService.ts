import api from '../config/api';

export interface DashboardCounts {
  so_support_in_progress: number;
  so_visit_in_progress: number;
  so_visit_pullout_in_progress: number;
  app_pending: number;
  jo_in_progress: number;
  radius_online: number;
  radius_offline: number;
  radius_disconnected: number;
  radius_restricted: number;
}

export interface MonitorResponse<T> {
  status: string;
  data: T;
  barangays?: any[];
}

export const monitorService = {
  getDashboardCounts: async (): Promise<MonitorResponse<DashboardCounts>> => {
    try {
      const response = await api.get<MonitorResponse<DashboardCounts>>('/monitor/handle', {
        params: { action: 'dashboard_counts' }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching dashboard counts:', error);
      throw error;
    }
  }
};
