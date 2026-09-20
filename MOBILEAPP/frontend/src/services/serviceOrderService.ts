import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  count?: number;
  table?: string;
}

export interface ServiceOrderData {
  id: string;
  ticket_id: string;
  account_no: string;
  account_id?: number;
  timestamp: string;
  full_name: string;
  contact_number: string;
  full_address: string;
  contact_address: string;
  date_installed?: string;
  email_address?: string;
  house_front_picture_url?: string;
  plan?: string;
  group_name?: string;
  username?: string;
  connection_type?: string;
  router_modem_sn?: string;
  lcp?: string;
  nap?: string;
  port?: string;
  vlan?: string;
  lcpnap?: string;
  concern?: string;
  concern_remarks?: string;
  requested_by?: string;
  support_status?: string;
  assigned_email?: string;
  repair_category?: string;
  visit_status?: string;
  priority_level?: string;
  visit_by_user?: string;
  visit_with?: string;
  visit_remarks?: string;
  support_remarks?: string;
  service_charge?: number;
  new_router_sn?: string;
  new_lcpnap_id?: number;
  new_lcpnap?: string;
  new_plan_id?: number;
  new_plan?: string;
  new_lcp?: string;
  new_nap?: string;
  new_port?: string;
  new_vlan?: string;
  router_model?: string;
  proof_image_url?: string;
  client_signature_url?: string;
  image1_url?: string;
  image2_url?: string;
  image3_url?: string;
  image4?: string;
  setup_image_url?: string;
  router_reading_image_url?: string;
  box_reading_image_url?: string;
  speedtest_image_url?: string;
  status?: string;
  created_at?: string;
  created_by_user?: string;
  updated_at?: string;
  updated_by_user?: string;
  start_time?: string;
  end_time?: string;
  region?: string;
  city?: string;
  barangay?: string;
  referred_by?: string;
  proof_of_billing_url?: string;
  government_valid_id_url?: string;
  second_government_valid_id_url?: string;
  document_attachment_url?: string;
  other_isp_bill_url?: string;
  technicians?: string[];
}

export const createServiceOrder = async (serviceOrderData: Partial<ServiceOrderData>) => {
  try {
    const response = await apiClient.post<ApiResponse<ServiceOrderData>>('/service-orders', serviceOrderData);
    return response.data;
  } catch (error) {
    console.error('Error creating service order:', error);
    throw error;
  }
};

export const getServiceOrders = async (assignedEmail?: string, page: number = 1, limit: number = 50, search: string = '', accountNo?: string) => {
  try {
    const params: { assigned_email?: string; user_role?: string; user_email?: string; page: number; limit: number; search?: string; account_no?: string } = {
      page,
      limit
    };

    if (assignedEmail) {
      params.assigned_email = assignedEmail;
    }

    if (search) {
      params.search = search;
    }

    if (accountNo) {
      params.account_no = accountNo;
    }

    const authData = await AsyncStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        if (userData.role) {
          params.user_role = userData.role;
        }
        if (userData.email) {
          params.user_email = userData.email;
        }
      } catch (err) {
        console.error('Failed to parse authData:', err);
      }
    }

    const response = await apiClient.get<ApiResponse<ServiceOrderData[]>>('/service-orders', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching service orders:', error);
    throw error;
  }
};

export const getServiceOrder = async (id: string) => {
  try {
    const response = await apiClient.get<ApiResponse<ServiceOrderData>>(`/service-orders/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching service order:', error);
    throw error;
  }
};

export const updateServiceOrder = async (id: string, serviceOrderData: Partial<ServiceOrderData>) => {
  try {
    const response = await apiClient.put<ApiResponse<ServiceOrderData>>(`/service-orders/${id}`, serviceOrderData);
    return response.data;
  } catch (error) {
    console.error('Error updating service order:', error);
    throw error;
  }
};

/**
 * Release a service order to its technician ahead of their queue.
 *
 * Administrator-only on the server, so the flag cannot be flipped by the
 * technician whose queue it governs.
 */
export const enableServiceOrderForTechnician = async (id: string | number) => {
  try {
    const idStr = id.toString();
    const authData = await AsyncStorage.getItem('authData');
    const currentUser = authData ? JSON.parse(authData) : null;
    const payload = currentUser?.email ? { updated_by_user: currentUser.email } : {};
    const response = await apiClient.post<ApiResponse<any>>(`/service-orders/${idStr}/enable-technician`, payload);
    return response.data;
  } catch (error) {
    console.error('Error enabling service order for technician:', error);
    throw error;
  }
};

export const deleteServiceOrder = async (id: string) => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>(`/service-orders/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting service order:', error);
    throw error;
  }
};
