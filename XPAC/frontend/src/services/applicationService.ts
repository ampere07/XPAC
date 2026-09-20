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
    total_count?: number;
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
    total_count?: number;
    has_more: boolean;
  };
}

export const getApplications = async (
  fastMode: boolean = false,
  page: number = 1,
  limit: number = 50,
  search?: string,
  since?: string
): Promise<ApiResponse<Application[]>> => {
  try {
    const response = await apiClient.get<ApplicationResponse>('/applications', {
      params: {
        fast: fastMode ? '1' : '0',
        page,
        limit,
        search,
        since
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

/**
 * Uploads an application's supporting documents to Drive and stores the resulting URLs.
 * Accepted form keys: proof_of_billing, government_valid_id,
 * secondary_government_valid_id, house_front_image, promo_image, nearest_landmark1,
 * nearest_landmark2, document_attachment, other_isp_bill.
 */
export const uploadApplicationImages = async (
  id: number | string,
  formData: FormData
): Promise<{ success?: boolean; message?: string; data?: any }> => {
  const response = await apiClient.post<{ success?: boolean; message?: string; data?: any }>(
    `/applications/${id}/upload-images`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
};

export const getRelatedDetailsUpdateLogs = async (id: string): Promise<any> => {
  try {
    const response = await apiClient.get<any>(`/audit-trail-logs/by-application/${id}`);
    return {
      success: response.data.success ?? true,
      data: response.data.data || [],
      count: response.data.count || 0
    };
  } catch (error: any) {
    console.error('Error fetching related details update logs:', error);
    return {
      success: false,
      data: [],
      message: error.response?.data?.message || 'Failed to fetch related details update logs'
    };
  }
};
