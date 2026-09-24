import apiClient from '../config/api';

/**
 * `optical_scan` is the per-ONU bridge-MAC crawl — one API call per ONU, and the
 * endpoint SmartOLT throttles hardest, so it only ever runs as a background job.
 * `mac_discovery` is its original name, still accepted server-side. The job type
 * keeps the `optical_scan` spelling because rows already sitting in `tool_jobs`
 * carry it; the crawl itself no longer reads optical power.
 */
export type JobType =
  | 'smartolt_sync'
  | 'radius_scan'
  | 'optical_scan'
  | 'mac_discovery'
  | 'rename'
  | 'profile_sync'
  | 'sn_alignment'
  | 'delete';

/**
 * `paused` is a rate-limit stop, not a failure: SmartOLT refused the call, the job
 * checkpointed where it got to, and it resumes itself once the cooldown elapses.
 */
export type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';

/** Checkpoint state a paused job carries, so the banner can say when it resumes. */
export interface JobContext {
  rate_limited?: boolean;
  rate_limit_hits?: number;
  paused_at?: string;
  resume_at?: string;
  pause_reason?: string;
}

export interface ToolJob {
  id: number;
  type: JobType;
  status: JobStatus;
  current: number;
  total: number;
  message: string;
  summary: Record<string, number> | null;
  context?: JobContext;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * What each job type is called on screen.
 *
 * Shared by the full progress modal and its minimized dock so the two cannot end up
 * naming the same running job differently. `mac_discovery` and `optical_scan` are the
 * same server-side step under two names, so they read identically here.
 */
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  smartolt_sync: 'ONU inventory sync',
  radius_scan: 'ONU status sync',
  optical_scan: 'Bridge MAC discovery',
  mac_discovery: 'Bridge MAC discovery',
  rename: 'ONU rename',
  profile_sync: 'Profile push',
  sn_alignment: 'Router/modem SN alignment',
  delete: 'ONU unprovision',
};

/** The on-screen name for a job, falling back to the raw type for anything newer. */
export function jobTypeLabel(type: JobType | string): string {
  return JOB_TYPE_LABELS[type as JobType] ?? String(type).replace(/_/g, ' ');
}

/**
 * Completion percentage, 0-100.
 *
 * A job whose total is not known yet shows a sliver rather than an empty bar — at
 * that point work has started, and a bar reading zero while the console is already
 * logging steps reads as stuck. Rounded so the bar and the number beside it agree.
 */
export function jobProgressPercent(job: Pick<ToolJob, 'current' | 'total'>): number {
  if (!job.total || job.total <= 0) {
    return 5;
  }

  return Math.min(100, Math.round((job.current / job.total) * 100));
}

export interface OnuRow {
  external_id: string;
  sn: string;
  name: string;
  olt_name: string;
  board: string;
  port: string;
  zone_name: string;
  odb_name: string;
  address: string;
  contact: string;
  status: string;
  last_status_change: string;
  days_offline: number | null;
  /** Colon-delimited bridge MAC, or '' where the ONU has never been crawled. */
  mac_address: string;
  mac_checked_at: string | null;
}

/**
 * The fifteen figures the dashboard grid renders.
 *
 * The first nine come from the cached inventory, status and MAC snapshots and are
 * always present. The last six describe work the alignment, profile and cleanup
 * passes did, and are `null` until that pass has run at least once — "not computed
 * yet" is not the same answer as "zero", and the grid shows which one it has.
 */
export interface SmartOltMetrics {
  inventory: number;
  authorized: number;
  offline: number;
  los: number;
  pwrfail: number;
  name_not_set: number;
  named: number;
  mac_cached: number;
  pending_discovery: number;
  radius_active: number | null;
  matched_sessions: number | null;
  rename_required: number | null;
  already_correct: number | null;
  address_updates: number | null;
  delete_candidates: number | null;
  computed_at: {
    mac_alignment: string | null;
    profile: string | null;
    cleanup: string | null;
  };
}

export interface SmartOltState {
  configured: boolean;
  sub_domain: string | null;
  inventory_count: number;
  inventory_synced_at: string | null;
  status_synced_at: string | null;
  mac_synced_at: string | null;
  mac_cached: number;
  /** @deprecated Alias of `mac_cached`, kept while the old key is still served. */
  optical_checked: number;
  status_counts: Record<string, number>;
  metrics: SmartOltMetrics;
  active_job: ToolJob | null;
  rows: OnuRow[];
}

/**
 * @deprecated Superseded by {@link MacAlignmentRow}. The Name Alignment tab was retired
 * because a name composed from billing records can disagree with the device that is
 * actually authenticating; MAC alignment matches the ONU bridge MAC against the live
 * PPPoE calling-station-id and is authoritative. Kept because the backend endpoint and
 * its CSV dataset still respond.
 */
export interface AlignmentRow {
  external_id: string;
  sn: string;
  current_name: string;
  proposed_name: string;
  matched_by: string | null;
  account_no: string | null;
  customer_name: string | null;
  plan: string | null;
  status: string;
  rename_needed: boolean;
  eligible: boolean;
  reason: string;
}

/** @deprecated Superseded by {@link MacAlignmentPreview}. See {@link AlignmentRow}. */
export interface AlignmentPreview {
  summary: { total: number; matched: number; rename_needed: number; aligned: number; unmatched: number; placeholder: number };
  rows: AlignmentRow[];
  updated_at: string;
}

/**
 * A row of the MAC alignment pass: which subscriber is actually authenticating
 * behind this ONU, matched by bridge MAC against the RADIUS calling-station-id.
 * `target_name` is the matched RADIUS username verbatim, never a composed label.
 */
export type MacAlignState = 'aligned' | 'rename_needed' | 'unmatched' | 'no_mac';

export interface MacAlignmentRow {
  external_id: string;
  state: MacAlignState;
  radius_username: string;
  calling_station_id: string;
  current_name: string;
  target_name: string;
  sn: string;
  status: string;
  server_id: number | null;
  server_label: string;
  eligible: boolean;
  reason: string;
}

export interface MacAlignmentPreview {
  summary: {
    total: number;
    matched: number;
    rename_needed: number;
    aligned: number;
    unmatched: number;
    no_mac: number;
    sessions: number;
  };
  rows: MacAlignmentRow[];
  errors: string[];
  updated_at: string;
}

/**
 * A row of the SN alignment pass: the serial SmartOLT reports for an ONU against the
 * `router_modem_sn` stored on the matched subscriber's billing record.
 *
 * Matched by bridge MAC against the live PPPoE calling-station-id — the same binding
 * the MAC alignment pass uses. Applying writes the SmartOLT serial into billing;
 * nothing ever pushes the billing value back to SmartOLT.
 */
export type SnAlignState =
  | 'sn_aligned'
  | 'sn_missing'
  | 'sn_mismatch'
  | 'sn_no_subscriber'
  | 'sn_unmatched'
  | 'sn_no_mac';

export interface SnAlignmentRow {
  external_id: string;
  state: SnAlignState;
  /** The serial SmartOLT reports for this ONU — the value that would be written. */
  sn: string;
  /** What `technical_details.router_modem_sn` currently holds, if anything. */
  billing_sn: string;
  radius_username: string;
  calling_station_id: string;
  current_name: string;
  account_no: string;
  customer_name: string;
  /** The billing row the write targets; null when nothing was matched. */
  technical_detail_id: number | null;
  status: string;
  server_id: number | null;
  server_label: string;
  eligible: boolean;
  reason: string;
}

export interface SnAlignmentPreview {
  summary: {
    total: number;
    matched: number;
    aligned: number;
    missing: number;
    mismatch: number;
    no_subscriber: number;
    unmatched: number;
    no_mac: number;
    sessions: number;
  };
  rows: SnAlignmentRow[];
  errors: string[];
  updated_at: string;
}

export interface ProfileRow {
  external_id: string;
  sn: string;
  name: string;
  account_no: string | null;
  customer_name: string | null;
  old_address: string;
  new_address: string;
  old_contact: string;
  new_contact: string;
  old_latitude: string;
  new_latitude: string;
  old_longitude: string;
  new_longitude: string;
  olt_vlan: string;
  billing_vlan: string;
  address_changed: boolean;
  contact_changed: boolean;
  coords_changed: boolean;
  vlan_drift: boolean;
  eligible: boolean;
}

export interface ProfilePreview {
  summary: { total: number; eligible: number; unchanged: number; unmatched: number; vlan_drift: number };
  rows: ProfileRow[];
  vlan_note: string;
  updated_at: string;
}

export interface CleanupRow {
  external_id: string;
  sn: string;
  name: string;
  zone_name: string;
  odb_name: string;
  olt_name: string;
  status: string;
  last_status_change: string;
  days_offline: number | null;
  /**
   * The bridge MAC discovered behind this ONU, colon-delimited.
   *
   * Empty means "never crawled", not "this ONU has no MAC" — an ONU the discovery
   * pass has not reached yet renders as a dash.
   */
  mac_address: string;
  mac_checked_at: string | null;
  /**
   * What the billing and RADIUS guards said about removing this ONU.
   *
   * Advisory in this tool. Cleanup runs on the operator's selection, and an objection
   * is recorded against the deletion rather than refusing it; these drive a warning
   * column, not a filter. The unattended nightly pass still treats them as binding.
   */
  eligible: boolean;
  reasons: string[];
}

export interface CleanupPreview {
  summary: { total: number; eligible: number; blocked: number };
  rows: CleanupRow[];
  offline_days: number;
  updated_at: string;
}

export interface SmartOltLog {
  log_id: number;
  created_at: string | null;
  level: string;
  action: string;
  message: string;
  operator: string;
  external_id: string | null;
  previous_state: Record<string, any>;
  new_state: Record<string, any>;
  reversible: boolean;
  reversed: boolean;
  reversed_at: string | null;
}

export interface ActionResult {
  success: boolean;
  skipped: boolean;
  message: string;
}

export interface JobResult extends ActionResult {
  job: ToolJob | null;
}

export interface MacDiscoveryResult {
  success: boolean;
  checked: number;
  remaining: number;
  items: Array<{
    external_id: string;
    sn: string;
    name: string;
    status: string;
    /** The MAC shown for this ONU: the first one discovered behind it. */
    mac_address: string;
    /** Every MAC discovered behind this ONU, colon-delimited. */
    macs: string[];
    checked_at: string | null;
  }>;
  errors: string[];
}

/** The literal phrase the backend requires before it will unprovision an ONU. */
export const DELETE_CONFIRMATION = 'DELETE';

const BASE = '/smartolt-reconciliation';

const unwrapJob = async (call: any): Promise<JobResult> => {
  try {
    const response = await call;
    return response.data as JobResult;
  } catch (error: any) {
    const payload = error?.response?.data;
    return {
      success: false,
      skipped: false,
      message: payload?.message || error?.message || 'The request failed.',
      job: payload?.job ?? null,
    };
  }
};

export const smartOltReconciliationService = {
  getState: async (includeRows = false): Promise<SmartOltState> => {
    const response = await apiClient.get<{ success: boolean; data: SmartOltState }>(`${BASE}/state`, {
      params: { include_rows: includeRows ? 1 : 0 },
    });
    return response.data.data;
  },

  /**
   * Read the bridge MAC behind the named ONUs, or behind every ONU never crawled.
   *
   * One throttled SmartOLT call per ONU, so the sweep is capped server-side and the
   * caller repeats until `remaining` reaches zero. The background `optical_scan` job
   * is the usual way to run this over a whole estate.
   */
  discoverBridgeMacs: async (externalIds: string[] = [], limit = 25): Promise<MacDiscoveryResult> => {
    const response = await apiClient.get<MacDiscoveryResult>(`${BASE}/mac-discovery`, {
      params: { external_ids: externalIds, limit },
    });
    return response.data;
  },

  /**
   * @deprecated Use {@link getMacAlignment}. No UI calls this any more — the Name
   * Alignment tab was retired in favour of the authoritative MAC pass — but the backend
   * route is unchanged and still serves, so this stays callable.
   */
  getAlignmentPreview: async (): Promise<AlignmentPreview> => {
    const response = await apiClient.get<{ success: boolean; data: AlignmentPreview }>(`${BASE}/alignment-preview`);
    return response.data.data;
  },

  getMacAlignment: async (): Promise<MacAlignmentPreview> => {
    const response = await apiClient.get<{ success: boolean; data: MacAlignmentPreview }>(`${BASE}/mac-alignment`);
    return response.data.data;
  },

  getSnAlignment: async (): Promise<SnAlignmentPreview> => {
    const response = await apiClient.get<{ success: boolean; data: SnAlignmentPreview }>(`${BASE}/sn-alignment`);
    return response.data.data;
  },

  getProfilePreview: async (): Promise<ProfilePreview> => {
    const response = await apiClient.get<{ success: boolean; data: ProfilePreview }>(`${BASE}/profile-preview`);
    return response.data.data;
  },

  getCleanupPreview: async (offlineDays: number): Promise<CleanupPreview> => {
    const response = await apiClient.get<{ success: boolean; data: CleanupPreview }>(`${BASE}/cleanup-preview`, {
      params: { offline_days: offlineDays },
    });
    return response.data.data;
  },

  startJob: (type: JobType, options: Record<string, any> = {}): Promise<JobResult> =>
    unwrapJob(apiClient.post(`${BASE}/start-job`, { type, ...options })),

  /**
   * @deprecated The browser no longer drives jobs — `cron:tool-jobs-drain` advances
   * them server-side, so a sweep keeps running with the tab closed. Use
   * {@link getJobStatus} to watch progress. Kept callable because the route is
   * unchanged and it is still the way to nudge a job by hand while investigating.
   */
  processJob: (jobId: number): Promise<JobResult> => unwrapJob(apiClient.post(`${BASE}/process-job`, { job_id: jobId })),

  /**
   * Progress for one job. A plain read: polling neither starts nor advances work.
   */
  getJobStatus: async (jobId: number): Promise<JobResult> => {
    try {
      const response = await apiClient.get<JobResult>(`${BASE}/job-status`, { params: { job_id: jobId } });
      return response.data;
    } catch (error: any) {
      const payload = error?.response?.data;
      return {
        success: false,
        skipped: false,
        message: payload?.message || error?.message || 'Could not read the job status.',
        job: payload?.job ?? null,
      };
    }
  },

  /**
   * Whatever job currently holds the single active slot, if any.
   *
   * Lets the tool reattach its progress bar on load: an operator who closed the tab
   * mid-sweep comes back to a running job rather than to an idle-looking screen.
   */
  getActiveJob: async (): Promise<ToolJob | null> => {
    try {
      const response = await apiClient.get<{ success: boolean; job: ToolJob | null }>(`${BASE}/active-job`);
      return response.data.job ?? null;
    } catch {
      // A failed reattach must not block the page from rendering.
      return null;
    }
  },

  abortJob: (jobId: number): Promise<JobResult> => unwrapJob(apiClient.post(`${BASE}/abort-job`, { job_id: jobId })),

  undo: async (logId: number): Promise<ActionResult> => {
    try {
      const response = await apiClient.post<ActionResult>(`${BASE}/undo`, { log_id: logId });
      return response.data;
    } catch (error: any) {
      const payload = error?.response?.data;
      return { success: false, skipped: false, message: payload?.message || error?.message || 'The undo failed.' };
    }
  },

  getLogs: async (limit = 50): Promise<SmartOltLog[]> => {
    const response = await apiClient.get<{ success: boolean; data: SmartOltLog[] }>(`${BASE}/logs`, {
      params: { limit },
    });
    return response.data.data;
  },

  exportCsv: async (dataset: 'inventory' | 'alignment' | 'sn_alignment' | 'profile' | 'cleanup'): Promise<void> => {
    const response = await apiClient.get(`${BASE}/export`, {
      params: { dataset },
      responseType: 'blob',
    });

    const url = window.URL.createObjectURL(new Blob([response.data as BlobPart], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `smartolt-${dataset}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
