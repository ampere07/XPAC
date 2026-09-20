import apiClient from '../config/api';
import { requestCache } from '../utils/requestCache';

export interface SystemConfigResponse {
  success: boolean;
  data?: string | null;
  message?: string;
}

export interface UploadLogoResponse {
  success: boolean;
  message: string;
  data?: {
    logo_url: string;
    file_id: string;
  };
}

class SystemConfigService {
  async getLogo(): Promise<string | null> {
    return requestCache.get(
      'system_logo',
      async () => {
        const response = await apiClient.get<SystemConfigResponse>('/system-config/logo');
        return response.data.data || null;
      },
      30000
    );
  }

  async uploadLogo(file: File, updatedBy: string): Promise<UploadLogoResponse> {
    const formData = new FormData();
    formData.append('logo', file);
    formData.append('updated_by', updatedBy);

    const response = await apiClient.post<UploadLogoResponse>('/system-config/logo', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    requestCache.invalidate('system_logo');
    return response.data;
  }

  async deleteLogo(updatedBy: string): Promise<SystemConfigResponse> {
    const response = await apiClient.delete<SystemConfigResponse>('/system-config/logo', {
      params: { updated_by: updatedBy }
    });
    requestCache.invalidate('system_logo');
    return response.data;
  }
}

export const systemConfigService = new SystemConfigService();
