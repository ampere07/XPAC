import apiClient, { API_BASE_URL } from '../config/api';

/** One RADIUS device the operator may target. */
export interface RadiusServer {
  id: number;
  position: number;
  label: string;
  ip: string;
  port: string | number;
  ssl_type: string;
  username: string;
}

/** The eight states an audited account can land in. */
export type ReconciliationState =
  | 'duplicate_radius'
  | 'restricted'
  | 'disabled_mismatch'
  | 'password_mismatch'
  | 'group_mismatch'
  | 'orphan_radius'
  | 'missing_radius'
  | 'synced';

export interface ReconciliationRow {
  username: string;
  account_no: string | null;
  customer_name: string | null;
  state: ReconciliationState;
  server_id: number | null;
  server_label: string;
  rad_id: string | null;
  rad_group: string | null;
  rad_password: string | null;
  rad_disabled: boolean | null;
  bill_group: string | null;
  bill_target_group: string | null;
  db_password: string;
  billing_status_id: number | string | null;
  online: boolean;
  session_id: string | null;
  session_ip: string | null;
  session_mac: string | null;
  duplicate_servers: number[];
}

export interface DuplicateInstance {
  server_id: number;
  server_label: string;
  server_ip: string;
  rad_id: string;
  group: string;
  disabled: boolean;
  online: boolean;
}

export interface DuplicateAccount {
  username: string;
  server_count: number;
  instances: DuplicateInstance[];
  discrepancies: string[];
}

export interface TraceLine {
  timestamp: string;
  level: string;
  message: string;
}

export interface ReconciliationSummary {
  total: number;
  servers: number;
  total_billing: number;
  duplicate_accounts: number;
  duplicate_radius: number;
  restricted: number;
  disabled_mismatch: number;
  password_mismatch: number;
  group_mismatch: number;
  orphan_radius: number;
  missing_radius: number;
  synced: number;
}

export interface ReconciliationData {
  success: boolean;
  mode: string;
  servers: Array<{ id: number; label: string; ip: string; user_count: number; session_count: number }>;
  summary: ReconciliationSummary;
  duplicates: DuplicateAccount[];
  rows: ReconciliationRow[];
  errors: string[];
  trace: TraceLine[];
  /**
   * True when this is the cached snapshot rather than a live sweep. The tool opens
   * on a snapshot so a page load never contacts every RADIUS device; only
   * "Sync & Reconcile Now" (getData) touches hardware.
   */
  stale?: boolean;
  /** When the underlying audit actually ran, or null if none ever has. */
  synced_at?: string | null;
}

export interface OperationLog {
  log_id: number;
  created_at: string | null;
  level: string;
  action: string;
  message: string;
  operator: string;
  username: string | null;
  server_id: number | null;
  server_label: string | null;
  previous_state: Record<string, any>;
  new_state: Record<string, any>;
  reversible: boolean;
  reversed: boolean;
  reversed_at: string | null;
}

/** Every mutating endpoint answers in this shape. A skip is a success. */
export interface ActionResult {
  success: boolean;
  skipped: boolean;
  message: string;
}

export interface BulkResult {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
  data: Array<{ username: string; status: string; message: string }>;
}

export type BulkOperation =
  | 'sync_passwords'
  | 'sync_group_mikrotik'
  | 'sync_group_billing'
  | 'restrict'
  | 'disconnect'
  | 'delete';

export interface BulkUserPayload {
  username: string;
  server_id?: number | null;
  rad_id?: string | null;
  rad_group?: string | null;
  target_group?: string | null;
  rad_password?: string | null;
}

const BASE = '/radius-reconciliation';

/**
 * A 422 from these endpoints carries a real operator-facing message (a stale row,
 * an unreachable device, a refused duplicate resolution). Surfacing that beats
 * surfacing axios's generic status text, so it is unwrapped here rather than in
 * every caller.
 */
const unwrap = async (call: any): Promise<ActionResult> => {
  try {
    const response = await call;
    return response.data as ActionResult;
  } catch (error: any) {
    const payload = error?.response?.data;
    return {
      success: false,
      skipped: false,
      message: payload?.message || error?.message || 'The request failed.',
    };
  }
};

export const radiusReconciliationService = {
  getServers: async (): Promise<RadiusServer[]> => {
    const response = await apiClient.get<{ success: boolean; data: RadiusServer[] }>(`${BASE}/servers`);
    return response.data.data;
  },

  /**
   * The last completed audit, read from cache. No device is contacted, so this is
   * safe to call on every page load and on every server-selector change.
   */
  getSnapshot: async (serverId: string): Promise<ReconciliationData> => {
    const response = await apiClient.get<ReconciliationData>(`${BASE}/snapshot`, {
      params: { server_id: serverId },
    });
    return response.data;
  },

  /**
   * The live sweep. Contacts every targeted RADIUS device twice (users, sessions)
   * and reads the whole subscriber table — only ever call this from an explicit
   * operator action.
   */
  getData: async (serverId: string): Promise<ReconciliationData> => {
    const response = await apiClient.get<ReconciliationData>(`${BASE}/data`, {
      params: { server_id: serverId },
    });
    return response.data;
  },

  syncPassword: (username: string, radPassword: string): Promise<ActionResult> =>
    unwrap(apiClient.post(`${BASE}/sync-password`, { username, rad_password: radPassword })),

  syncGroupToMikrotik: (
    username: string,
    targetGroup: string,
    serverId: number | null,
    radId?: string | null
  ): Promise<ActionResult> =>
    unwrap(
      apiClient.post(`${BASE}/sync-group-mikrotik`, {
        username,
        target_group: targetGroup,
        server_id: serverId,
        rad_id: radId ?? null,
      })
    ),

  syncGroupToBilling: (username: string, radGroup: string): Promise<ActionResult> =>
    unwrap(apiClient.post(`${BASE}/sync-group-billing`, { username, rad_group: radGroup })),

  restrict: (username: string, serverId: number | null, radId?: string | null): Promise<ActionResult> =>
    unwrap(apiClient.post(`${BASE}/restrict`, { username, server_id: serverId, rad_id: radId ?? null })),

  disconnect: (username: string, serverId: number | null): Promise<ActionResult> =>
    unwrap(apiClient.post(`${BASE}/disconnect`, { username, server_id: serverId })),

  addUser: (username: string, password: string, group: string, serverId: number): Promise<ActionResult> =>
    unwrap(apiClient.post(`${BASE}/add-user`, { username, password, group, server_id: serverId })),

  deleteUser: (username: string, radId: string | null, serverId: number): Promise<ActionResult> =>
    unwrap(apiClient.post(`${BASE}/delete-user`, { username, rad_id: radId, server_id: serverId })),

  resolveDuplicate: (username: string, keepServerId: number, removeServerId: number): Promise<ActionResult> =>
    unwrap(
      apiClient.post(`${BASE}/resolve-duplicate`, {
        username,
        keep_server_id: keepServerId,
        remove_server_id: removeServerId,
      })
    ),

  bulk: async (
    operation: BulkOperation,
    users: BulkUserPayload[],
    serverId: string
  ): Promise<{ success: boolean; message: string; data: BulkResult }> => {
    try {
      const response = await apiClient.post<{ success: boolean; message: string; data: BulkResult }>(`${BASE}/bulk`, {
        operation,
        users,
        server_id: serverId,
      });
      return response.data;
    } catch (error: any) {
      const payload = error?.response?.data;
      return {
        success: false,
        message: payload?.message || error?.message || 'The batch failed.',
        data: { success: 0, failed: users.length, skipped: 0, errors: [], data: [] },
      };
    }
  },

  undo: (logId: number): Promise<ActionResult> => unwrap(apiClient.post(`${BASE}/undo`, { log_id: logId })),

  getLogs: async (limit = 50): Promise<OperationLog[]> => {
    const response = await apiClient.get<{ success: boolean; data: OperationLog[] }>(`${BASE}/logs`, {
      params: { limit },
    });
    return response.data.data;
  },

  /**
   * The CSV is streamed by the backend, so it is fetched as a blob and handed to
   * the browser rather than rebuilt from the rows already on screen — an export
   * must cover every matching row, not just the visible page.
   */
  exportCsv: async (filter: string, serverId: string): Promise<void> => {
    const response = await apiClient.get(`${BASE}/export`, {
      params: { filter, server_id: serverId },
      responseType: 'blob',
    });

    const url = window.URL.createObjectURL(new Blob([response.data as BlobPart], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `radius-reconciliation-${filter}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};

export { API_BASE_URL };
