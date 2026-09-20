import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface Group {
  id: number;
  group_name: string;
  fb_page_link?: string;
  fb_messenger_link?: string;
  template?: string;
  company_name?: string;
  portal_url?: string;
  hotline?: string;
  email?: string;
  org_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export const getAllGroups = async (): Promise<ApiResponse<Group[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<Group[]>>('/groups');
    return response.data;
  } catch (error: any) {
    console.error('Error fetching groups:', error);
    return {
      success: false,
      data: [],
      message: error.message || 'Failed to fetch groups'
    };
  }
};

export const getGroupById = async (id: number): Promise<ApiResponse<Group>> => {
  try {
    const response = await apiClient.get<ApiResponse<Group>>(`/groups/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching group:', error);
    throw error;
  }
};

export const createGroup = async (groupData: Partial<Group>): Promise<ApiResponse<Group>> => {
  try {
    const response = await apiClient.post<ApiResponse<Group>>('/groups', groupData);
    return response.data;
  } catch (error: any) {
    console.error('Error creating group:', error);
    throw error;
  }
};

export const updateGroup = async (id: number, groupData: Partial<Group>): Promise<ApiResponse<Group>> => {
  try {
    const response = await apiClient.put<ApiResponse<Group>>(`/groups/${id}`, groupData);
    return response.data;
  } catch (error: any) {
    console.error('Error updating group:', error);
    throw error;
  }
};

export const deleteGroup = async (id: number): Promise<ApiResponse<null>> => {
  try {
    const response = await apiClient.delete<ApiResponse<null>>(`/groups/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Error deleting group:', error);
    throw error;
  }
};
