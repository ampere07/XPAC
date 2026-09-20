import apiClient from '../config/api';

export interface FormUIConfig {
  page_hex: string;
  button_hex: string;
  logo_url: string;
  multi_step: string;
  brand_name: string;
  transparency_rgba: string;
  form_hex: string;
}

export interface FormUIResponse {
  success: boolean;
  data?: FormUIConfig;
  message?: string;
}

class FormUIService {
  async getConfig(): Promise<FormUIConfig | null> {
    try {
      const response = await apiClient.get<FormUIResponse>('/form-ui/config');
      return response.data.data || null;
    } catch (error) {
      console.error('Failed to fetch form UI config:', error);
      return null;
    }
  }
}

export const formUIService = new FormUIService();
