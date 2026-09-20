import apiClient from '../config/api';

export interface AppVersionConfig {
  latest_version: string;
  min_version: string;
  playstore_url: string;
}

export interface AppVersionResponse {
  success: boolean;
  data: AppVersionConfig;
}

export const getAppVersionConfig = async (): Promise<AppVersionConfig> => {
  try {
    const response = await apiClient.get<AppVersionResponse>('/app-version/config');
    return response.data.data;
  } catch (error) {
    console.error('Error fetching app version config:', error);
    throw error;
  }
};

/**
 * Compares two semantic version strings.
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 === v2
 */
export const compareVersions = (v1: string, v2: string): number => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
};
