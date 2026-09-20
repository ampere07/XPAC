export interface LoginResponse {
  status: string;
  message: string;
  data: {
    user: {
      id: number;
      username: string;
      email: string;
      full_name: string;
      role: string;
      role_id: number;
      /** The role's effective permission keys. `['*']` for a SuperAdmin. */
      permissions?: string[] | null;
      /** The section this role lands on after signing in. */
      home?: string | null;
      organization?: {
        id: number;
        name: string;
      };
    };
    token: string;
  };
}

export interface ForgotPasswordResponse {
  status: string;
  message: string;
}

export interface HealthCheckResponse {
  status: string;
  message: string;
  data: {
    server: string;
    timestamp: string;
  };
}

export interface ApiError {
  message: string;
  code?: string;
  details?: any;
}

export interface UserData {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string;
  role_id: number;
  /**
   * The role's effective permission keys, resolved server side — see
   * ATSS2_0/backend/app/Support/Permissions.php. `['*']` for a SuperAdmin.
   */
  permissions?: string[] | null;
  /** The section this role lands on after signing in, e.g. "job-order". */
  home?: string | null;
  organization?: {
    id: number;
    name: string;
  };
}

export interface User {
  id: number;
  salutation?: string;
  first_name: string;
  middle_initial?: string;
  last_name: string;
  username: string;
  email_address: string;
  contact_number?: string;
  organization_id?: number | null;
  role_id?: number | null;
  created_at: string;
  updated_at: string;
  organization?: {
    id: number;
    organization_name: string;
    address?: string | null;
    contact_number?: string | null;
    email_address?: string | null;
  };
  role?: {
    id: number;
    role_name: string;
  };
}

export interface Organization {
  id: number;
  organization_name: string;
  address?: string | null;
  contact_number?: string | null;
  email_address?: string | null;
  created_at: string;
  created_by_user_id?: number | null;
  updated_at: string;
  updated_by_user_id?: number | null;
  users?: User[];
}

export interface Role {
  id: number;
  role_name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  users?: User[];
}

export interface Group {
  group_id: number;
  group_name: string;
  fb_page_link?: string | null;
  fb_messenger_link?: string | null;
  template?: string | null;
  company_name?: string | null;
  portal_url?: string | null;
  hotline?: string | null;
  email?: string | null;
  org_id?: number | null;
  modified_by_user_id?: number | null;
  modified_date?: string | null;
  users?: User[];
  organization?: {
    id: number;
    organization_name: string;
    address?: string | null;
    contact_number?: string | null;
    email_address?: string | null;
  };
}

export interface CreateUserRequest {
  salutation?: string;
  first_name: string;
  middle_initial?: string;
  last_name: string;
  username: string;
  email_address: string;
  contact_number?: string;
  password: string;
  organization_id?: number;
  role_id?: number;
  agent_id?: number | null;
  darkmode?: string;
  created_by_user_id?: number | null;
  updated_by_user_id?: number | null;
}

export interface UpdateUserRequest {
  salutation?: string;
  first_name?: string;
  middle_initial?: string;
  last_name?: string;
  username?: string;
  email_address?: string;
  contact_number?: string;
  password?: string;
  organization_id?: number | null | undefined;
  role_id?: number | null | undefined;
  agent_id?: number | null;
}

export interface Technician {
  id: number;
  first_name: string;
  middle_initial?: string | null;
  last_name: string;
  updated_at?: string;
  updated_by?: string;
  organization_id?: number | null;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  errors?: Record<string, string[]>;
  pagination?: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number;
    to: number;
  };
}

export interface Application {
  id: string;
  customerName: string;
  timestamp: string;
  address: string;
  action?: 'Schedule' | 'Duplicate';
  location: string;
  email?: string;
  mobileNumber?: string;
  secondaryNumber?: string;
}

export interface ApplicationsResponse {
  applications: Application[];
}

export interface SalesAgent {
  id: number;
  name: string;
  email?: string;
  mobile_number?: string;
  territory?: string;
  commission_rate?: number;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: number;
  team_name: string;
  created_by: string;
  created_at: string;
  organization_id?: number | null;
}
