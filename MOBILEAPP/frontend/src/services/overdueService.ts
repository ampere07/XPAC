import api from '../config/api';

export interface Overdue {
  id: number;
  account_no: string;
  invoice_id: number | null;
  overdue_date: string | null;
  print_link: string | null;
  created_at: string;
  created_by_user_id: number | null;
  updated_at: string;
  updated_by_user_id: number | null;
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
    total?: number;
  };
}

export const overdueService = {
  async getAll(fastMode: boolean = false, page: number = 1, limit: number = 50, search?: string, date?: string): Promise<ApiResponse<Overdue[]>> {
    const response = await api.get('/overdues', {
      params: {
        fast: fastMode ? '1' : '0',
        page,
        limit,
        search,
        date
      }
    });
    return response.data as ApiResponse<Overdue[]>;
  },

  async getById(id: number): Promise<ApiResponse<Overdue>> {
    const response = await api.get(`/overdues/${id}`);
    return response.data as ApiResponse<Overdue>;
  },

  async create(data: Partial<Overdue>): Promise<ApiResponse<Overdue>> {
    const response = await api.post('/overdues', data);
    return response.data as ApiResponse<Overdue>;
  },

  async update(id: number, data: Partial<Overdue>): Promise<ApiResponse<Overdue>> {
    const response = await api.put(`/overdues/${id}`, data);
    return response.data as ApiResponse<Overdue>;
  },

  async delete(id: number): Promise<ApiResponse<null>> {
    const response = await api.delete(`/overdues/${id}`);
    return response.data as ApiResponse<null>;
  },

  async getStatistics(): Promise<ApiResponse<{ total_overdue: number; this_month: number }>> {
    const response = await api.get('/overdues/statistics');
    return response.data as ApiResponse<{ total_overdue: number; this_month: number }>;
  },
};
