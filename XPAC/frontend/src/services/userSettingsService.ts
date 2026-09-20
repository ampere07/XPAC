import api from '../config/api';
import { requestCache } from '../utils/requestCache';

export interface DarkModeResponse {
  success: boolean;
  message?: string;
  data?: {
    darkmode: 'active' | 'inactive';
  };
}

export const userSettingsService = {
  updateDarkMode: async (userId: number, darkmode: 'active' | 'inactive'): Promise<DarkModeResponse> => {
    const response = await api.post<DarkModeResponse>('/user-settings/darkmode', {
      user_id: userId,
      darkmode
    });
    requestCache.invalidate(`darkmode_${userId}`);
    return response.data;
  },

  getDarkMode: async (userId: number): Promise<DarkModeResponse> => {
    return requestCache.get(
      `darkmode_${userId}`,
      async () => {
        const response = await api.get<DarkModeResponse>(`/user-settings/${userId}/darkmode`);
        return response.data;
      },
      10000
    );
  }
};
