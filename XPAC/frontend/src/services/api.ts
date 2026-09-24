import apiClient from '../config/api';
import { 
  LoginResponse, 
  ForgotPasswordResponse, 
  HealthCheckResponse,
  ApplicationsResponse
} from '../types/api';

/**
 * Technicians are allowed one live session. If the account is already signed in on another
 * device the request rejects with a 409 carrying require_confirmation, and the caller has to
 * re-submit with forceLogin true to end that other session first. Other roles never see it.
 */
export const login = async (
  email: string,
  password: string,
  forceLogin: boolean = false
): Promise<LoginResponse> => {
  const response = await apiClient.post<LoginResponse>('/login', {
    email,
    password,
    force_login: forceLogin
  });
  return response.data;
};

export const forgotPassword = async (email: string): Promise<ForgotPasswordResponse> => {
  const response = await apiClient.post<ForgotPasswordResponse>('/forgot-password', {
    email
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
