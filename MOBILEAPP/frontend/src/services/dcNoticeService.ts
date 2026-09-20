import api from '../config/api';

export interface DCNotice {
  id: number;
  account_id: number;
  invoice_id: number | null;
  dc_notice_date: string | null;
  print_link: string | null;
  created_at: string;
  created_by_user_id: number | null;
  updated_at: string;
  updated_by_user_id: number | null;
  account_no?: string;
  full_name?: string;
  contact_number?: string;
  email_address?: string;
  address?: string;
  plan?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: {
    current_page: number;
    per_page: number;
    has_more: boolean;
  };
}

export const dcNoticeService = {
  async getAll(fastMode: boolean = false, page: number = 1, limit: number = 50, search?: string, date?: string): Promise<ApiResponse<DCNotice[]>> {
    const response = await api.get('/dc-notices', {
      params: {
        fast: fastMode ? '1' : '0',
        page,
        limit,
        search,
        date
      }
    });
    return response.data as ApiResponse<DCNotice[]>;
  },

  async getById(id: number): Promise<ApiResponse<DCNotice>> {
    const response = await api.get(`/dc-notices/${id}`);
    return response.data as ApiResponse<DCNotice>;
  },

  async create(data: Partial<DCNotice>): Promise<ApiResponse<DCNotice>> {
    const response = await api.post('/dc-notices', data);
    return response.data as ApiResponse<DCNotice>;
  },

  async update(id: number, data: Partial<DCNotice>): Promise<ApiResponse<DCNotice>> {
    const response = await api.put(`/dc-notices/${id}`, data);
    return response.data as ApiResponse<DCNotice>;
  },

  async delete(id: number): Promise<ApiResponse<null>> {
    const response = await api.delete(`/dc-notices/${id}`);
    return response.data as ApiResponse<null>;
  },

  async getStatistics(): Promise<ApiResponse<{ total_notices: number; this_month: number }>> {
    const response = await api.get('/dc-notices/statistics');
    return response.data as ApiResponse<{ total_notices: number; this_month: number }>;
  },
};
