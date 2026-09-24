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
  /** 'Prepaid' | 'Postpaid', copied in from the billing account by ServiceOrderApiController. */
  generation_type?: string | null;
  username?: string;
  /**
   * PPPoE password from technical_details. service_orders does not store it, so
   * ServiceOrderApiController joins it in — falling back to the account's newest job order for
   * accounts installed before technical_details carried the column.
   */
  pppoe_password?: string | null;
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
  client_signature_url?: string;
  image1_url?: string;
  image2_url?: string;
  image3_url?: string;
  status?: string;
  created_at?: string;
  created_by_user?: string;
  updated_at?: string;
  updated_by_user?: string;
  referred_by?: string;
  old_lcp?: string;
  old_nap?: string;
  old_port?: string;
  old_vlan?: string;
  old_lcpnap?: string;
  new_lcp?: string;
  new_nap?: string;
  new_port?: string;
  new_vlan?: string;
  router_model?: string;
  billing_day?: string;
  onsite_remarks?: string;
  status_remarks?: string;
  contract_template?: string;
  ip_address?: string;
  usage_type?: string;
  start_time?: string | null;
  end_time?: string | null;
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

export const getServiceOrders = async (assignedEmail?: string, page: number = 1, limit: number = 50, search: string = '', updatedSince?: string, accountNo?: string) => {
  try {
    const params: { assigned_email?: string; user_role?: string; page: number; limit: number; search?: string; updated_since?: string; account_no?: string } = {
      page,
      limit
    };

    if (assignedEmail) {
      params.assigned_email = assignedEmail;
    }

    if (search) {
      params.search = search;
    }

    if (updatedSince) {
      params.updated_since = updatedSince;
    }

    if (accountNo) {
      params.account_no = accountNo;
    }

    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        if (userData.role) {
          params.user_role = userData.role;
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

export const deleteServiceOrder = async (id: string) => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>(`/service-orders/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting service order:', error);
    throw error;
  }
};

export const getRelatedDetailsUpdateLogs = async (id: string | number): Promise<any> => {
  try {
    const idStr = id.toString();
    const response = await apiClient.get<any>(`/details-update-logs/by-service-order/${idStr}`);
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
      count: 0,
      message: error.response?.data?.message || 'Failed to fetch related details update logs'
    };
  }
};

export interface BlockedTransferLogPayload {
  performed_by?: string;
  original_technician_name?: string;
  new_technician_name?: string;
  account_no?: string;
  start_time?: string | null;
  description?: string;
}

export const logBlockedTechnicianTransfer = async (
  id: string | number,
  payload: BlockedTransferLogPayload
) => {
  try {
    const idStr = id.toString();
    const response = await apiClient.post<ApiResponse<any>>(
      `/service-orders/${idStr}/log-blocked-transfer`,
      payload
    );
    return response.data;
  } catch (error: any) {
    // Audit logging must never block the user-facing flow.
    console.error('Error logging blocked technician transfer:', error);
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to log blocked transfer'
    } as ApiResponse<any>;
  }
};
