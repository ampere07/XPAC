import apiClient from '../config/api';
import {
  User,
  Organization,
  Group,
  Role,
  CreateUserRequest,
  UpdateUserRequest,
  ApiResponse
} from '../types/api';

// User Management API
export const userService = {
  // Get all users
  getAllUsers: async (): Promise<ApiResponse<User[]>> => {
    try {
      const response = await apiClient.get<ApiResponse<User[]>>('/users');
      return response.data;
    } catch (error: any) {
      console.error('Get users API error:', error.message);
      throw error;
    }
  },

  // Get users by role
  getUsersByRole: async (roleName: string): Promise<ApiResponse<User[]>> => {
    try {
      const response = await apiClient.get<ApiResponse<User[]>>(`/users?role=${roleName}`);
      return response.data;
    } catch (error: any) {
      console.error('Get users by role API error:', error.message);
      throw error;
    }
  },

  // Get users by role ID
  getUsersByRoleId: async (roleId: number): Promise<ApiResponse<User[]>> => {
    try {
      const response = await apiClient.get<ApiResponse<User[]>>(`/users?role_id=${roleId}`);
      return response.data;
    } catch (error: any) {
      console.error('Get users by role ID API error:', error.message);
      throw error;
    }
  },

  // Create new user
  createUser: async (userData: CreateUserRequest): Promise<ApiResponse<User>> => {
    try {
      const response = await apiClient.post<ApiResponse<User>>('/users', userData);
      return response.data;
    } catch (error: any) {
      console.error('Create user API error:', error.message);
      throw error;
    }
  },

  // Get user by ID
  getUserById: async (userId: number): Promise<ApiResponse<User>> => {
    const response = await apiClient.get<ApiResponse<User>>(`/users/${userId}`);
    return response.data;
  },

  // Update user
  updateUser: async (userId: number, userData: UpdateUserRequest): Promise<ApiResponse<User>> => {
    try {
      const response = await apiClient.put<ApiResponse<User>>(`/users/${userId}`, userData);
      return response.data;
    } catch (error: any) {
      console.error('Update user API error:', error.message);
      throw error;
    }
  },

  // Delete user
  deleteUser: async (userId: number): Promise<ApiResponse<void>> => {
    try {
      const response = await apiClient.delete<ApiResponse<void>>(`/users/${userId}`);
      return response.data;
    } catch (error: any) {
      console.error('Delete user API error:', error.message);
      throw error;
    }
  },

  // Assign role to user
  assignRole: async (userId: number, roleId: number): Promise<ApiResponse<void>> => {
    const response = await apiClient.post<ApiResponse<void>>(`/users/${userId}/roles`, {
      role_id: roleId
    });
    return response.data;
  },

  // Remove role from user
  removeRole: async (userId: number, roleId: number): Promise<ApiResponse<void>> => {
    const response = await apiClient.delete<ApiResponse<void>>(`/users/${userId}/roles?role_id=${roleId}`);
    return response.data;
  },

  // Assign group to user
  assignGroup: async (userId: number, groupId: number): Promise<ApiResponse<void>> => {
    const response = await apiClient.post<ApiResponse<void>>(`/users/${userId}/groups`, {
      group_id: groupId
    });
    return response.data;
  },

  // Remove group from user
  removeGroup: async (userId: number, groupId: number): Promise<ApiResponse<void>> => {
    const response = await apiClient.delete<ApiResponse<void>>(`/users/${userId}/groups?group_id=${groupId}`);
    return response.data;
  }
};

// Organization Management API
export const organizationService = {
  // Get all organizations
  getAllOrganizations: async (): Promise<ApiResponse<Organization[]>> => {
    const response = await apiClient.get<ApiResponse<Organization[]>>('/organizations');
    return response.data;
  },

  // Create new organization
  createOrganization: async (orgData: {
    organization_name: string;
    address?: string | null;
    contact_number?: string | null;
    email_address?: string | null;
  }): Promise<ApiResponse<Organization>> => {
    const response = await apiClient.post<ApiResponse<Organization>>('/organizations', orgData);
    return response.data;
  },

  // Get organization by ID
  getOrganizationById: async (orgId: number): Promise<ApiResponse<Organization>> => {
    const response = await apiClient.get<ApiResponse<Organization>>(`/organizations/${orgId}`);
    return response.data;
  },

  // Update organization
  updateOrganization: async (orgId: number, orgData: {
    organization_name?: string;
    address?: string | null;
    contact_number?: string | null;
    email_address?: string | null;
  }): Promise<ApiResponse<Organization>> => {
    const response = await apiClient.put<ApiResponse<Organization>>(`/organizations/${orgId}`, orgData);
    return response.data;
  },

  // Delete organization
  deleteOrganization: async (orgId: number): Promise<ApiResponse<void>> => {
    const response = await apiClient.delete<ApiResponse<void>>(`/organizations/${orgId}`);
    return response.data;
  }
};

// Group Management API
export const groupService = {
  // Get all groups
  getAllGroups: async (): Promise<ApiResponse<Group[]>> => {
    const response = await apiClient.get<ApiResponse<Group[]>>('/groups');
    return response.data;
  },

  // Create new group
  createGroup: async (groupData: {
    group_name: string;
    fb_page_link?: string | null;
    fb_messenger_link?: string | null;
    template?: string | null;
    company_name?: string | null;
    portal_url?: string | null;
    hotline?: string | null;
    email?: string | null;
    org_id?: number | null;
  }): Promise<ApiResponse<Group>> => {
    const response = await apiClient.post<ApiResponse<Group>>('/groups', groupData);
    return response.data;
  },

  // Get group by ID
  getGroupById: async (groupId: number): Promise<ApiResponse<Group>> => {
    const response = await apiClient.get<ApiResponse<Group>>(`/groups/${groupId}`);
    return response.data;
  },

  // Update group
  updateGroup: async (groupId: number, groupData: {
    group_name?: string;
    fb_page_link?: string | null;
    fb_messenger_link?: string | null;
    template?: string | null;
    company_name?: string | null;
    portal_url?: string | null;
    hotline?: string | null;
    email?: string | null;
    org_id?: number | null;
  }): Promise<ApiResponse<Group>> => {
    const response = await apiClient.put<ApiResponse<Group>>(`/groups/${groupId}`, groupData);
    return response.data;
  },

  // Delete group
  deleteGroup: async (groupId: number): Promise<ApiResponse<void>> => {
    const response = await apiClient.delete<ApiResponse<void>>(`/groups/${groupId}`);
    return response.data;
  },


};

// Role Management API
export const roleService = {
  // Get all roles
  getAllRoles: async (): Promise<ApiResponse<Role[]>> => {
    const response = await apiClient.get<ApiResponse<Role[]>>('/roles');
    return response.data;
  },

  // Create new role
  createRole: async (roleData: { role_name: string }): Promise<ApiResponse<Role>> => {
    const response = await apiClient.post<ApiResponse<Role>>('/roles', roleData);
    return response.data;
  },

  // Get role by ID
  getRoleById: async (roleId: number): Promise<ApiResponse<Role>> => {
    const response = await apiClient.get<ApiResponse<Role>>(`/roles/${roleId}`);
    return response.data;
  },

  // Update role
  updateRole: async (roleId: number, roleData: { role_name: string }): Promise<ApiResponse<Role>> => {
    const response = await apiClient.put<ApiResponse<Role>>(`/roles/${roleId}`, roleData);
    return response.data;
  },

  // Delete role
  deleteRole: async (roleId: number): Promise<ApiResponse<void>> => {
    const response = await apiClient.delete<ApiResponse<void>>(`/roles/${roleId}`);
    return response.data;
  }
};

// Database Setup API
export const setupService = {
  // Initialize database
  initializeDatabase: async (): Promise<ApiResponse<any>> => {
    const response = await apiClient.post<ApiResponse<any>>('/setup/initialize');
    return response.data;
  },

  // Check database status
  checkDatabaseStatus: async (): Promise<ApiResponse<any>> => {
    const response = await apiClient.get<ApiResponse<any>>('/setup/status');
    return response.data;
  }
};

// Logs Management API
export const logsService = {
  // Get all logs with filters
  getLogs: async (params?: {
    level?: string;
    action?: string;
    user_id?: number;
    resource_type?: string;
    search?: string;
    per_page?: number;
    page?: number;
    all_time?: boolean;
  }): Promise<ApiResponse<any>> => {
    const response = await apiClient.get<ApiResponse<any>>('/logs', { params });
    return response.data;
  },

  // Get log by ID
  getLogById: async (logId: number): Promise<ApiResponse<any>> => {
    const response = await apiClient.get<ApiResponse<any>>(`/logs/${logId}`);
    return response.data;
  },

  // Get log statistics
  getStats: async (days?: number): Promise<ApiResponse<any>> => {
    const response = await apiClient.get<ApiResponse<any>>('/logs/stats', {
      params: { days }
    });
    return response.data;
  },

  // Export logs
  exportLogs: async (params?: {
    format?: 'json' | 'csv';
    level?: string;
    action?: string;
    days?: number;
  }): Promise<any> => {
    const response = await apiClient.get('/logs/export', { params });
    return response.data;
  },

  // Clear old logs
  clearLogs: async (params?: {
    older_than_days?: number;
    level?: string;
  }): Promise<ApiResponse<any>> => {
    const queryParams = new URLSearchParams();
    if (params?.older_than_days) {
      queryParams.append('older_than_days', params.older_than_days.toString());
    }
    if (params?.level) {
      queryParams.append('level', params.level);
    }

    const url = `/logs/clear${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await apiClient.delete<ApiResponse<any>>(url);
    return response.data;
  }
};
