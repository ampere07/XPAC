import apiClient, { setAuthToken } from '../config/api';
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

  // Keep the token the server issued alongside the session. It is what carries
  // the login through in a browser that will not return the session cookie —
  // an in-app browser such as Messenger's. Where the cookie works this is never
  // read, because the server checks the session first.
  const token = (response.data as any)?.data?.token;
  if (typeof token === 'string' && token !== '') {
    setAuthToken(token);
  }

  return response.data;
};

/**
 * Sign out on the server, then locally.
 *
 * The server call revokes this device's token and clears the session. It is
 * allowed to fail — an expired session answers 401 — but the local credential
 * is cleared either way, so signing out never leaves a usable token behind.
 */
export const logout = async (): Promise<void> => {
  try {
    await apiClient.post('/logout');
  } catch {
    // Already signed out server-side; nothing more to revoke.
  } finally {
    setAuthToken(null);
  }
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
