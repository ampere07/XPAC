import apiClient from '../config/api';

interface RadiusAccountResponse {
  success: boolean;
  message: string;
  data?: {
    name: string;
    [key: string]: any;
  };
}

export async function createAccount(
  username: string,
  plan: string,
  password: string
): Promise<string> {
  try {
    const response = await apiClient.post<RadiusAccountResponse>('/radius/create-account', {
      username,
      plan,
      password
    });

    if (response.data.success && response.data.data) {
      return response.data.data.name;
    } else {
      throw new Error(response.data.message || 'Failed to create RADIUS account');
    }
  } catch (error: any) {
    console.error('Error creating RADIUS account:', error);
    throw new Error(
      error.response?.data?.message || 
      error.message || 
      'Failed to create RADIUS account'
    );
  }
}
