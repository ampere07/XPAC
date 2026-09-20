import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  count?: number;
  pagination?: {
    current_page: number;
    per_page: number;
    has_more: boolean;
  };
}

export interface ApplicationVisitData {
  id?: number;
  application_id: number;
  timestamp?: string;
  assigned_email: string;
  visit_by?: string | null;
  visit_with?: string | null;
  visit_with_other?: string | null;
  visit_status?: string | null;
  visit_remarks?: string | null;
  application_status?: string | null;
  status_remarks?: string | null;
  image1_url?: string | null;
  image2_url?: string | null;
  image3_url?: string | null;
  house_front_picture_url?: string | null;
  region?: string | null;
  city?: string | null;
  barangay?: string | null;
  location?: string | null;
  choose_plan?: string | null;
  promo?: string | null;
  created_at?: string;
  created_by_user_email?: string;
  updated_at?: string;
  updated_by_user_email?: string;
  full_name?: string;
  full_address?: string;
  referred_by?: string;
  first_name?: string;
  middle_initial?: string;
  last_name?: string;
  installation_address?: string;
}

export const createApplicationVisit = async (visitData: ApplicationVisitData) => {
  try {
    if (!visitData.application_id) {
      throw new Error('application_id is required');
    }

    const response = await apiClient.post<ApiResponse<ApplicationVisitData>>('/application-visits', visitData);

    if (!response.data.success) {
      throw new Error(response.data.message || 'Unknown API error');
    }

    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const getAllApplicationVisits = async (
  assignedEmail?: string,
  fastMode: boolean = false,
  page: number = 1,
  limit: number = 50,
  search?: string
) => {
  try {
    const params: any = {
      fast: fastMode ? '1' : '0',
      page,
      limit
    };

    if (assignedEmail) {
      params.assigned_email = assignedEmail;
    }

    if (search) {
      params.search = search;
    }

    const response = await apiClient.get<ApiResponse<ApplicationVisitData[]>>('/application-visits', { params });

    if (response.data && response.data.data) {
      return response.data;
    }

    return {
      success: false,
      data: [],
      message: 'Invalid response format from API'
    };
  } catch (error: any) {
    return {
      success: false,
      data: [],
      message: error.message
    };
  }
};

export const getApplicationVisits = async (applicationId: string) => {
  try {
    const response = await apiClient.get<ApiResponse<ApplicationVisitData[]>>(`/application-visits/application/${applicationId}`);

    if (response.data && response.data.data) {
      return response.data;
    }

    return {
      success: false,
      data: [],
      message: 'Invalid response format from API'
    };
  } catch (error: any) {
    return {
      success: false,
      data: [],
      message: error.message
    };
  }
};

export const getApplicationVisit = async (id: string) => {
  try {
    const response = await apiClient.get<ApiResponse<ApplicationVisitData>>(`/application-visits/${id}`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const updateApplicationVisit = async (id: string, visitData: Partial<ApplicationVisitData>) => {
  try {
    const response = await apiClient.put<ApiResponse<ApplicationVisitData>>(`/application-visits/${id}`, visitData);
    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const deleteApplicationVisit = async (id: string) => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/application-visits/${id}`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const uploadApplicationVisitImages = async (
  id: string,
  firstName: string,
  middleInitial: string | undefined,
  lastName: string,
  images: { image1: File | null; image2: File | null; image3: File | null }
) => {
  try {
    const formData = new FormData();
    formData.append('first_name', firstName);
    formData.append('middle_initial', middleInitial || '');
    formData.append('last_name', lastName);

    if (images.image1) {
      formData.append('image1', images.image1);
    }
    if (images.image2) {
      formData.append('image2', images.image2);
    }
    if (images.image3) {
      formData.append('image3', images.image3);
    }

    const response = await apiClient.post<ApiResponse<{ image1_url?: string; image2_url?: string; image3_url?: string }>>(
      `/application-visits/${id}/upload-images`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    return response.data;
  } catch (error: any) {
    throw error;
  }
};
