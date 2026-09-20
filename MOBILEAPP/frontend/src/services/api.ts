import apiClient from '../config/api';
import { 
  LoginResponse, 
  ForgotPasswordResponse, 
  HealthCheckResponse,
  ApplicationsResponse
} from '../types/api';

export const login = async (email: string, password: string): Promise<LoginResponse> => {
  const response = await apiClient.post<LoginResponse>('/login', {
    email,
    password
  });
  return response.data;
};

export const forgotPassword = async (account_no: string): Promise<ForgotPasswordResponse> => {
  const response = await apiClient.post<ForgotPasswordResponse>('/forgot-password', {
    account_no
  });
  return response.data;
};

export const healthCheck = async (): Promise<HealthCheckResponse> => {
  const response = await apiClient.get<HealthCheckResponse>('/health');
  return response.data;
};

export const fetchApplications = async (): Promise<ApplicationsResponse> => {
  try {
    const response = await apiClient.get<ApplicationsResponse>('/applications');
    return response.data;
  } catch (error) {
    console.error('Error fetching applications:', error);
    throw error;
  }
};

export const fetchAgentCommissionHistory = async (type?: string): Promise<any> => {
  try {
    const params = type && type !== 'all' ? { type } : {};
    const response = await apiClient.get('/commissions/history', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching agent commission history:', error);
    throw error;
  }
};

export const fetchAgentIncentiveHistory = async (params?: any): Promise<any> => {
  try {
    const response = await apiClient.get('/commissions/incentive-history', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching agent incentive history:', error);
    throw error;
  }
};

export const storeAgentCommissionHistory = async (data: any): Promise<any> => {
  try {
    const response = await apiClient.post('/commissions/history', data);
    return response.data;
  } catch (error) {
    console.error('Error storing agent commission history:', error);
    throw error;
  }
};

/** How many applications this agent has raised. Scoped to the caller server side. */
export const fetchAgentApplicationCount = async (): Promise<any> => {
  try {
    const response = await apiClient.get('/applications/my-count');
    return response.data;
  } catch (error) {
    console.error('Error fetching agent application count:', error);
    throw error;
  }
};

export const fetchAgentAchievements = async (agentId: string | number): Promise<any> => {
  try {
    const response = await apiClient.get('/commissions/achievements', {
      params: { agent_id: agentId }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching agent achievements:', error);
    throw error;
  }
};

export const claimAgentAchievement = async (data: any): Promise<any> => {
  try {
    const response = await apiClient.post('/commissions/achievements', data);
    return response.data;
  } catch (error) {
    console.error('Error claiming agent achievement:', error);
    throw error;
  }
};

export const fetchAgentCommissionTrend = async (filter: string): Promise<any> => {
  try {
    const response = await apiClient.get('/commissions/trend', {
      params: { filter }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching agent commission trend:', error);
    throw error;
  }
};

export const createApplication = async (applicationData: any): Promise<any> => {
  try {
    const response = await apiClient.post('/applications', applicationData);
    return response.data;
  } catch (error) {
    console.error('Error creating application:', error);
    throw error;
  }
};

export const uploadApplicationImages = async (id: number | string, formData: FormData): Promise<any> => {
  try {
    const response = await apiClient.post(`/applications/${id}/upload-images`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error uploading application images:', error);
    throw error;
  }
};
