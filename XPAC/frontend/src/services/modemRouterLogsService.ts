import apiClient from '../config/api';

export interface ModemRouterLogRecord {
  id: string;
  source_type: 'job_order' | 'service_order';
  reference_id: number;
  sn: string;
  model: string | null;
  event_type: string;
  description: string;
  event_date: string;
  account_no: string | null;
  customer_name: string | null;
  address: string | null;
  lcpnap: string | null;
  port: string | null;
  technician: string | null;
  status: string | null;
  remarks: string | null;
}

export interface ModemRouterLogSummary {
  total_movements: number;
  total_installations: number;
  total_pullouts: number;
  total_replacements: number;
  unique_serials: number;
}

export interface ModemRouterLogFilter {
  search?: string;
  sn?: string;
  event_type?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  per_page?: number;
}

export interface ModemRouterLogResponse {
  success: boolean;
  data: ModemRouterLogRecord[];
  meta: {
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
  };
}

const BASE = '/modem-router-logs';

export const modemRouterLogsService = {
  getLogs: async (filters: ModemRouterLogFilter = {}): Promise<ModemRouterLogResponse> => {
    const params: Record<string, any> = {};
    if (filters.search) params.search = filters.search;
    if (filters.sn) params.sn = filters.sn;
    if (filters.event_type && filters.event_type !== 'all') params.event_type = filters.event_type;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.page) params.page = filters.page;
    if (filters.per_page) params.per_page = filters.per_page;

    const response = await apiClient.get<ModemRouterLogResponse>(BASE, { params });
    return response.data;
  },

  getTimelineBySn: async (sn: string): Promise<ModemRouterLogRecord[]> => {
    const response = await apiClient.get<{ success: boolean; sn: string; data: ModemRouterLogRecord[] }>(
      `${BASE}/sn/${encodeURIComponent(sn)}`
    );
    return response.data.data;
  },

  getSummary: async (): Promise<ModemRouterLogSummary> => {
    const response = await apiClient.get<{ success: boolean; data: ModemRouterLogSummary }>(`${BASE}/summary`);
    return response.data.data;
  },
};
