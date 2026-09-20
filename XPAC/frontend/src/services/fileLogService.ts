import apiClient from '../config/api';

export interface FileLogEntry {
  datetime: string;
  level: string;
  message: string;
  context: string;
}

export interface FileLogPagination {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

export interface FileLogResponse {
  success: boolean;
  data: FileLogEntry[];
  pagination: FileLogPagination;
  meta: {
    type: string;
    filename: string;
    filesize?: number;
    message?: string;
  };
}

export const fileLogService = {
  getLogs: async (
    type: 'smartolt' | 'radius',
    params?: {
      search?: string;
      level?: string;
      page?: number;
      per_page?: number;
    }
  ): Promise<FileLogResponse> => {
    const response = await apiClient.get<FileLogResponse>(`/file-logs/${type}`, { params });
    return response.data;
  },
};
