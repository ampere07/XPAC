import apiClient from '../config/api';
import { Application } from '../types/application';

interface ApplicationResponse {
  status?: string;
  message?: string;
  applications?: Application[];
  application?: Application;
  success?: boolean;
  pagination?: {
    current_page: number;
    per_page: number;
    has_more: boolean;
  };
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  applications?: T;
  message?: string;
  pagination?: {
    current_page: number;
    per_page: number;
    has_more: boolean;
  };
}

export const getApplications = async (
  fastMode: boolean = false,
  page: number = 1,
  limit: number = 50,
  search?: string
): Promise<ApiResponse<Application[]>> => {
  try {
    const response = await apiClient.get<ApplicationResponse>('/applications', {
      params: {
        fast: fastMode ? '1' : '0',
        page,
        limit,
        search
      }
    });

    return {
      success: response.data.success ?? true,
      applications: response.data.applications || [],
      pagination: response.data.pagination
    };
  } catch (error: any) {
    console.error('Error fetching applications:', error);
    if (error?.response) {
      console.error('Response error:', error.response.data);
    }
    throw error;
  }
};

export const getApplication = async (id: string): Promise<Application> => {
  try {
    const response = await apiClient.get<ApplicationResponse>(`/applications/${id}`);

    if (!response.data.application) {
      throw new Error('Application not found in API response');
    }

    return response.data.application;
  } catch (error: any) {
    console.error('Error fetching application details:', error);
    throw new Error(`Failed to fetch application details: ${error.message}`);
  }
};

export const createApplication = async (application: Partial<Application>): Promise<Application> => {
  const response = await apiClient.post<ApplicationResponse>('/applications', application);
  if (!response.data.application) {
    throw new Error('Failed to create application');
  }
  return response.data.application;
};

export const updateApplication = async (id: string, application: Partial<Application>): Promise<Application> => {
  const response = await apiClient.put<ApplicationResponse>(`/applications/${id}`, application);
  if (!response.data.application) {
    throw new Error('Failed to update application');
  }
  return response.data.application;
};

export const deleteApplication = async (id: string): Promise<void> => {
  await apiClient.delete<ApplicationResponse>(`/applications/${id}`);
};
