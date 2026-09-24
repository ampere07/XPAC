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
      /** A custom role saved before per-action keys existed. */
      permissions_legacy?: boolean;
      organization?: {
        id: number;
        name: string;
      };
    };
    token: string;
  };
}

/**
 * Body of the 409 the login endpoint returns when a technician is already signed in on
 * another device. The login is not completed until it is re-submitted with force_login.
 */
export interface SessionConflictResponse {
  status: string;
  require_confirmation?: boolean;
  message: string;
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
  organization_id?: number | null;
  /**
   * The role's effective permission keys, resolved server side (see
   * backend/app/Support/Permissions.php). `['*']` for a SuperAdmin.
   */
  permissions?: string[] | null;
  /** The section this role lands on after signing in, e.g. "job-order". */
  home?: string | null;
  /**
   * Whether `permissions` is the server's resolved list rather than a custom
   * role's raw stored row (see AuthLike in config/permissions.ts).
   */
  permissions_resolved?: boolean;
  /**
   * A custom role saved before per-action keys existed; it keeps the bell's
   * shortcuts (see LEGACY_CUSTOM_REACHABLE in config/permissions.ts).
   */
  permissions_legacy?: boolean;
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
  // Appended by the backend User model (first + middle initial + last).
  full_name?: string;
  username: string;
  email_address: string;
  contact_number?: string;
  organization_id?: number | null;
  role_id?: number | null;
  agent_id?: number | null;
  created_at: string;
  updated_at: string;
  active?: boolean;
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
    description?: string;
    permissions?: string;
  };
  agent_balance?: {
    id: number;
    agent_id: number;
    balance: number;
    commission?: number;
    incentives?: number;
    quota?: number;
    incentives_value?: number;
    remarks?: string;
    created_at?: string;
    updated_at?: string;
  } | null;
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
  organization_id?: number | null;
  users?: User[];
}

export interface Role {
  id: number;
  role_name: string;
  description?: string;
  /**
   * The seeded role (1-8) this custom role inherits from, or null for a
   * standalone one. Inherited keys are resolved live on the server, never
   * copied into `permissions`.
   */
  base_role_id?: number | null;
  /**
   * Only the keys ticked against this role; a hybrid's inherited keys are not
   * here. An array from Laravel's cast, or a JSON / comma-separated string on
   * a row written before that cast existed.
   */
  permissions?: string | string[] | null;
  /**
   * What the role effectively holds, as the server resolves it (grandfathered
   * actions of a role saved before per-action keys included, the inherited
   * half excluded). Role Management seeds its checkboxes from this.
   */
  effective_permissions?: string[] | null;
  /**
   * The permission-model generation the row was last saved under. Below
   * CURRENT_VERSION (or absent, on a backend without the column) the role was
   * saved before per-action keys existed.
   */
  permissions_version?: number | null;
  created_at: string;
  updated_at: string;
  organization_id?: number | null;
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
  agent_id?: number;
  darkmode?: string;
  created_by_user_id?: number | null;
  updated_by_user_id?: number | null;
  active?: number | boolean;
  commission?: number;
  quota?: number;
  incentives_value?: number;
  remarks?: string;
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
  agent_id?: number | null | undefined;
  active?: boolean;
  commission?: number;
  quota?: number;
  incentives_value?: number;
  remarks?: string;
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

export interface Technician {
  id: number;
  first_name: string;
  middle_initial?: string;
  last_name: string;
  updated_at?: string;
  updated_by?: string;
  organization_id?: number | null;
}

export interface Agent {
    id: number;
    team_name: string;
    created_by: string;
    created_at: string;
    organization_id?: number | null;
}


