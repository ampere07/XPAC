import api from '../config/api';

export interface SequenceItem {
  id: string;
  type: string;
  label: string;
  value?: string;
}

export interface UsernamePattern {
  id: number;
  pattern_name: string;
  pattern_type: string;
  sequence: SequenceItem[];
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
}

interface PatternCreateData {
  pattern_name: string;
  pattern_type: 'username' | 'password' | 'port';
  sequence: SequenceItem[];
  created_by?: string;
}

interface PatternResponse {
  success: boolean;
  data: UsernamePattern;
  message?: string;
  action?: 'created' | 'updated';
}

interface PatternsListResponse {
  success: boolean;
  data: UsernamePattern[];
}

export const pppoeService = {
  getPatterns: async (type?: 'username' | 'password' | 'port'): Promise<UsernamePattern[]> => {
    const params = type ? { pattern_type: type } : {};
    const response = await api.get<PatternsListResponse>('/pppoe/patterns', { params });
    return response.data.data;
  },

  getPattern: async (id: number): Promise<UsernamePattern> => {
    const response = await api.get<PatternResponse>(`/pppoe/patterns/${id}`);
    return response.data.data;
  },

  createPattern: async (data: PatternCreateData): Promise<UsernamePattern> => {
    const response = await api.post<PatternResponse>('/pppoe/patterns', data);
    return response.data.data;
  },

  updatePattern: async (id: number, data: Partial<PatternCreateData>): Promise<UsernamePattern> => {
    const response = await api.put<PatternResponse>(`/pppoe/patterns/${id}`, data);
    return response.data.data;
  },

  savePattern: async (data: PatternCreateData): Promise<PatternResponse> => {
    const response = await api.post<PatternResponse>('/pppoe/patterns/save', data);
    return response.data;
  },

  deletePattern: async (id: number): Promise<void> => {
    await api.delete(`/pppoe/patterns/${id}`);
  }
};
