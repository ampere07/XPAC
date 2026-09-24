import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ChevronDown, ChevronUp, Download, Gauge, HardDrive, History, Loader2,
  Network, PauseCircle, RefreshCw, Router, Trash2, Undo2, UserCog, X, XCircle
} from 'lucide-react';
import { useDataGrid, type DataGridColumn, type DataGridFilter } from '../hooks/useDataGrid';
import {
  ColumnMenu,
  ExportButton,
  GridFilterBar,
  PageSizeSelector,
  SelectAllHeaderCell,
  SelectionBar,
  SortableHeaderCell,
} from '../components/DataGridControls';
import {
  smartOltReconciliationService,
  DELETE_CONFIRMATION,
  jobProgressPercent,
  jobTypeLabel,
  type CleanupPreview,
  type JobType,
  type MacAlignmentPreview,
  type MacAlignState,
  type ProfilePreview,
  type SnAlignmentPreview,
  type SnAlignState,
  type SmartOltLog,
  type SmartOltState,
  type ToolJob,
} from '../services/smartOltReconciliationService';

interface SmartOltToolProps {
  isDarkMode?: boolean;
}

type TabId = 'inventory' | 'mac_alignment' | 'sn_alignment' | 'profile' | 'cleanup' | 'logs';

/**
 * The retired `alignment` (Name Alignment) tab is deliberately absent.
 *
 * It proposed a name composed from billing records and matched on serial/account
 * heuristics, which could disagree with the device that is actually authenticating.
 * `mac_alignment` is authoritative: it matches the ONU's bridge MAC against the live
 * PPPoE calling-station-id from RADIUS and renames to that session's username
 * verbatim. Every automated naming action now runs through that pass only.
 *
 * The backend `alignment-preview` endpoint and its CSV dataset are untouched and still
 * respond — see `getAlignmentPreview` in the service, kept deprecated-in-place.
 */
const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'inventory', label: 'ONU Inventory', icon: Network },
  { id: 'mac_alignment', label: 'MAC & Username Alignment', icon: Router },
  { id: 'sn_alignment', label: 'Router/Modem SN', icon: HardDrive },
  { id: 'profile', label: 'Profile Sync', icon: UserCog },
  { id: 'cleanup', label: 'Inactive ONU Cleanup', icon: Trash2 },
  { id: 'logs', label: 'Operation Logs & Undo', icon: History },
];

/** How each MAC-alignment verdict is badged in the STATE column. */
const MAC_STATE_BADGES: Record<MacAlignState, { label: string; classes: string }> = {
  rename_needed: { label: 'Rename', classes: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  aligned: { label: 'Aligned', classes: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  unmatched: { label: 'Unmatched', classes: 'bg-purple-500/15 text-purple-500 border-purple-500/30' },
  no_mac: { label: 'No MAC', classes: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
};

/**
 * How each SN-alignment verdict is badged.
 *
 * `Fill` and `Replace` are deliberately different words: one writes into an empty
 * column and the other overwrites a serial somebody already recorded, and an operator
 * about to run a batch of hundreds needs to see which of the two they are doing.
 */
const SN_STATE_BADGES: Record<SnAlignState, { label: string; classes: string }> = {
  sn_missing: { label: 'Fill', classes: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  sn_mismatch: { label: 'Replace', classes: 'bg-orange-500/15 text-orange-500 border-orange-500/30' },
  sn_aligned: { label: 'Aligned', classes: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  sn_no_subscriber: { label: 'No Account', classes: 'bg-red-500/15 text-red-500 border-red-500/30' },
  sn_unmatched: { label: 'Unmatched', classes: 'bg-purple-500/15 text-purple-500 border-purple-500/30' },
  sn_no_mac: { label: 'No MAC', classes: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
};

const PAGE_SIZE = 100;

/**
 * Columns per tab.
 *
 * `value` is what a column is searched and sorted on; the markup for each cell is built
 * by `renderCell` in the component, so the badges, diff lines and reason lists this
 * screen already renders survive the move to an orderable, hideable column set.
 *
 * Rows are typed `any` here to match how this file already handles the four different
 * preview shapes it renders through one table slot.
 */
const TAB_COLUMNS: Record<TabId, Array<DataGridColumn<any>>> = {
  inventory: [
    { key: 'name', label: 'Smart OLT Name', value: (row) => row.name },
    { key: 'sn', label: 'Serial', value: (row) => row.sn },
    { key: 'status', label: 'Status', value: (row) => row.status },
    // The bridge MAC every matching pass in this tool binds on. Empty means the
    // discovery crawl has not reached this ONU yet, not that it has no MAC.
    { key: 'mac_address', label: 'MAC Address', value: (row) => row.mac_address },
    {
      key: 'location',
      label: 'OLT / Board / Port / Zone',
      value: (row) => [row.olt_name, row.board, row.port, row.zone_name].filter(Boolean).join(' / '),
    },
  ],
  mac_alignment: [
    { key: 'state', label: 'State', value: (row) => MAC_STATE_BADGES[row.state as MacAlignState]?.label ?? row.state },
    { key: 'radius_username', label: 'RADIUS Username', value: (row) => row.radius_username },
    { key: 'calling_station_id', label: 'Calling-Station-Id (MAC)', value: (row) => row.calling_station_id },
    { key: 'current_name', label: 'Current SmartOLT Name', value: (row) => row.current_name },
    { key: 'target_name', label: 'Target Name', value: (row) => row.target_name },
    { key: 'sn', label: 'Serial', value: (row) => row.sn },
    { key: 'server_label', label: 'RADIUS Server', value: (row) => row.server_label, defaultHidden: true },
    { key: 'status', label: 'Status', value: (row) => row.status },
    { key: 'actions', label: 'Actions', locked: true },
  ],
  sn_alignment: [
    { key: 'state', label: 'State', value: (row) => SN_STATE_BADGES[row.state as SnAlignState]?.label ?? row.state },
    { key: 'sn', label: 'SmartOLT Serial', value: (row) => row.sn },
    { key: 'billing_sn', label: 'Billing SN', value: (row) => row.billing_sn },
    { key: 'account_no', label: 'Account No', value: (row) => row.account_no },
    { key: 'customer_name', label: 'Customer', value: (row) => row.customer_name },
    { key: 'radius_username', label: 'RADIUS Username', value: (row) => row.radius_username },
    { key: 'calling_station_id', label: 'Calling-Station-Id (MAC)', value: (row) => row.calling_station_id, defaultHidden: true },
    { key: 'current_name', label: 'ONU Name', value: (row) => row.current_name, defaultHidden: true },
    { key: 'status', label: 'Status', value: (row) => row.status },
    { key: 'actions', label: 'Actions', locked: true },
  ],
  profile: [
    { key: 'sn', label: 'Serial / Account', value: (row) => [row.sn, row.account_no, row.customer_name].filter(Boolean).join(' ') },
    { key: 'address', label: 'Address', value: (row) => (row.address_changed ? row.new_address : row.old_address) },
    { key: 'contact', label: 'Contact', value: (row) => (row.contact_changed ? row.new_contact : row.old_contact) },
    { key: 'coords', label: 'Coordinates', value: (row) => (row.coords_changed ? row.new_latitude : row.old_latitude) },
    { key: 'vlan', label: 'VLAN', value: (row) => row.olt_vlan },
  ],
  cleanup: [
    { key: 'sn', label: 'Serial', value: (row) => row.sn },
    { key: 'name', label: 'Name', value: (row) => row.name },
    { key: 'zone', label: 'Zone / OLT', value: (row) => [row.zone_name, row.olt_name].filter(Boolean).join(' / ') },
    { key: 'status', label: 'Status', value: (row) => row.status },
    { key: 'days_offline', label: 'Days Offline', value: (row) => (row.days_offline === null || row.days_offline === undefined ? null : Number(row.days_offline)) },
    { key: 'mac_address', label: 'MAC Address', value: (row) => row.mac_address },
    // The old Verdict column is gone: cleanup runs on the operator's selection, not
    // on an eligibility ruling. What the guards said is kept one toggle away rather
    // than deleted, so an override can still be read back off the table it was made
    // from — it starts hidden precisely so it cannot read as a gate.
    { key: 'safety', label: 'Safety Notes', value: (row) => (row.eligible ? '' : (row.reasons ?? []).join(' - ')), defaultHidden: true },
  ],
  logs: [],
};

/** Dropdown narrowing per tab, cutting across what the free-text search can express. */
const TAB_FILTERS: Record<TabId, Array<DataGridFilter<any>>> = {
  inventory: [
    {
      key: 'mac',
      label: 'Bridge MAC',
      options: [
        { value: 'cached', label: 'Discovered' },
        { value: 'pending', label: 'Pending discovery' },
      ],
      predicate: (row, value) => (value === 'cached' ? !!row.mac_address : !row.mac_address),
    },
    {
      key: 'naming',
      label: 'Naming',
      options: [
        { value: 'named', label: 'Named' },
        { value: 'not_set', label: 'Name not set' },
      ],
      predicate: (row, value) => {
        const notSet = !String(row.name || '').trim() || String(row.name).trim().toLowerCase() === 'not set';
        return value === 'not_set' ? notSet : !notSet;
      },
    },
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: 'online', label: 'Online' },
        { value: 'offline', label: 'Not online' },
      ],
      predicate: (row, value) =>
        value === 'online'
          ? String(row.status).toLowerCase() === 'online'
          : String(row.status).toLowerCase() !== 'online',
    },
  ],
  mac_alignment: [
    {
      key: 'state',
      label: 'State',
      options: (Object.keys(MAC_STATE_BADGES) as MacAlignState[]).map((state) => ({
        value: state,
        label: MAC_STATE_BADGES[state].label,
      })),
      predicate: (row, value) => row.state === value,
    },
    {
      key: 'eligible',
      label: 'Actionable',
      options: [
        { value: 'yes', label: 'Can be renamed' },
        { value: 'no', label: 'Blocked' },
      ],
      predicate: (row, value) => (value === 'yes' ? !!row.eligible : !row.eligible),
    },
  ],
  sn_alignment: [
    {
      key: 'state',
      label: 'State',
      options: (Object.keys(SN_STATE_BADGES) as SnAlignState[]).map((state) => ({
        value: state,
        label: SN_STATE_BADGES[state].label,
      })),
      predicate: (row, value) => row.state === value,
    },
    {
      key: 'eligible',
      label: 'Actionable',
      options: [
        { value: 'yes', label: 'Can be written' },
        { value: 'no', label: 'Blocked' },
      ],
      predicate: (row, value) => (value === 'yes' ? !!row.eligible : !row.eligible),
    },
  ],
  profile: [
    {
      key: 'change',
      label: 'Pending change',
      options: [
        { value: 'address', label: 'Address' },
        { value: 'contact', label: 'Contact' },
        { value: 'coords', label: 'Coordinates' },
        { value: 'vlan', label: 'VLAN drift' },
      ],
      predicate: (row, value) => {
        if (value === 'address') return !!row.address_changed;
        if (value === 'contact') return !!row.contact_changed;
        if (value === 'coords') return !!row.coords_changed;
        return !!row.vlan_drift;
      },
    },
  ],
  // No verdict dropdown. The Inactive ONU table is a worklist of what has been dark
  // past the threshold, and the operator decides what comes off it; narrowing by an
  // eligibility ruling was the gate this tool no longer applies. Whether a bridge MAC
  // is known is the useful cut instead — an ONU nothing has ever authenticated behind
  // is a different decommission decision from one that has a subscriber attached.
  cleanup: [
    {
      key: 'mac',
      label: 'Bridge MAC',
      options: [
        { value: 'cached', label: 'Discovered' },
        { value: 'pending', label: 'Never crawled' },
      ],
      predicate: (row, value) => (value === 'cached' ? !!row.mac_address : !row.mac_address),
    },
  ],
  logs: [],
};

/** ONU rows are keyed by SmartOLT's own external id on every tab. */
const onuRowKey = (row: any) => String(row.external_id);

/**
 * A metric card's value.
 *
 * `null` means the pass behind it has never run, which is not the same claim as zero
 * — a dash says "unknown", a 0 says "we looked and there is nothing".
 */
const formatMetric = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : String(value);

/**
 * Which rows a batch action may legally touch.
 *
 * Inventory is a read-only view and has no checkbox column at all. The alignment and
 * profile tabs still gate on the backend's `eligible`, because there an ineligible row
 * is one with nothing to apply — selecting it would queue a no-op.
 *
 * Cleanup is deliberately not gated. `eligible` there is a safety opinion about a real
 * candidate, not a statement that there is nothing to do, and this tool lets the
 * operator act against it: the objection is recorded with the deletion instead of
 * preventing it. Blocking selection is what the old verdict gate did.
 */
const isRowSelectable = (tab: TabId) => (row: any) => {
  if (tab === 'inventory') return false;
  if (tab === 'cleanup') return true;
  return !!row.eligible;
};

/**
 * Pause between slices while this tab is the one driving the job.
 *
 * Short, because each call has already done up to a full slice of real work server-side
 * before it returned — the awaited round trip is the actual pacing, and this is only
 * breathing room between them.
 */
const JOB_DRIVE_MS = 400;

/**
 * Pause between reads when something else is driving.
 *
 * Two things advance a job: this tab, and `cron:tool-jobs-drain` on the server. Only
 * one may be inside it at a time — the server claim decides which — so when this tab
 * loses the claim it stops pushing and just watches at a slower cadence.
 */
const JOB_POLL_MS = 2_000;

/**
 * How often a rate-limit-paused job is re-read.
 *
 * A parked job only changes when its SmartOLT cooldown elapses and the drain picks it
 * back up, which is minutes away, so there is nothing to see in the meantime.
 */
const PAUSED_POLL_MS = 30_000;

const SmartOltTool: React.FC<SmartOltToolProps> = ({ isDarkMode: isDarkModeProp }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof isDarkModeProp === 'boolean') return isDarkModeProp;
    const theme = localStorage.getItem('theme');
    return theme === 'dark' || theme === null;
  });

  const [tab, setTab] = useState<TabId>('inventory');
  const [state, setState] = useState<SmartOltState | null>(null);
  const [macAlignment, setMacAlignment] = useState<MacAlignmentPreview | null>(null);
  const [snAlignment, setSnAlignment] = useState<SnAlignmentPreview | null>(null);
  const [profile, setProfile] = useState<ProfilePreview | null>(null);
  const [cleanup, setCleanup] = useState<CleanupPreview | null>(null);
  const [logs, setLogs] = useState<SmartOltLog[]>([]);

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [offlineDays, setOfflineDays] = useState(30);

  const [job, setJob] = useState<ToolJob | null>(null);
  const [jobLog, setJobLog] = useState<string[]>([]);
  const [jobPaused, setJobPaused] = useState(false);
  /**
   * Whether the running job is docked to the corner instead of held behind a modal.
   *
   * Only presentation: the sweep is driven by pollJob's timer and by the server-side
   * drain, neither of which renders, so docking the progress card changes nothing
   * about how the job advances. What it changes is that the operator can work the
   * tables, filters and other tabs while a 4,000-ONU pass runs, instead of watching a
   * backdrop that blocks the page for as long as the sweep takes.
   */
  const [isMinimized, setIsMinimized] = useState(false);
  /**
   * True once this session has a poll attached.
   *
   * A ref, not state: nothing renders from it, and the reattach effect has to read the
   * current value inside an async callback — state read there would be the value from
   * the render that scheduled it, which is exactly how a second poll gets started.
   */
  const jobWatched = useRef(false);
  /** Last message written to the run log, so re-reads of the same step are not repeated. */
  const lastJobMessage = useRef<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [undoTarget, setUndoTarget] = useState<SmartOltLog | null>(null);

  const jobTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (jobTimer.current) clearTimeout(jobTimer.current);
    };
  }, []);

  useEffect(() => {
    if (typeof isDarkModeProp === 'boolean') {
      setIsDarkMode(isDarkModeProp);
      return;
    }
    const check = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [isDarkModeProp]);

  // ---- Loaders -----------------------------------------------------------

  const loadState = useCallback(async (includeRows = true) => {
    setLoading(true);
    try {
      const result = await smartOltReconciliationService.getState(includeRows);
      if (!mounted.current) return;
      setState(result);
      // A paused job is adopted too: it is a rate-limit stop with a checkpoint, and
      // reopening the page is exactly when the operator needs to see it resume.
      if (result.active_job && (result.active_job.status === 'running' || result.active_job.status === 'paused')) {
        setJob(result.active_job);
      }
      if (!result.configured) {
        setNotice({ tone: 'error', text: 'SmartOLT is not configured. Set the sub-domain and token in Configurations → SmartOLT Config.' });
      }
    } catch (error: any) {
      if (mounted.current) setNotice({ tone: 'error', text: error?.response?.data?.message || 'Could not read the SmartOLT state.' });
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const loadTabData = useCallback(async (target: TabId) => {
    setLoading(true);
    try {
      if (target === 'mac_alignment') setMacAlignment(await smartOltReconciliationService.getMacAlignment());
      if (target === 'sn_alignment') setSnAlignment(await smartOltReconciliationService.getSnAlignment());
      if (target === 'profile') setProfile(await smartOltReconciliationService.getProfilePreview());
      if (target === 'cleanup') setCleanup(await smartOltReconciliationService.getCleanupPreview(offlineDays));
      if (target === 'logs') setLogs(await smartOltReconciliationService.getLogs(100));
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.response?.data?.message || 'Could not load this view.' });
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [offlineDays]);

  useEffect(() => { loadState(true); }, [loadState]);

  // ---- Job engine --------------------------------------------------------

  const appendJobLog = useCallback((line: string) => {
    setJobLog((prev) => [...prev.slice(-200), `${new Date().toLocaleTimeString()}  ${line}`]);
  }, []);

  /**
   * Drive the running job, and mirror its progress.
   *
   * Both ends push. This tab advances the job slice by slice while it is open, and
   * `cron:tool-jobs-drain` advances it server-side regardless — so a sweep starts
   * moving the instant it is created rather than waiting up to a minute for the next
   * scheduler tick, and it keeps moving after the tab is closed. Neither end is
   * required for the other to work, which is the point: the tool was left stuck at 0%
   * on any host where that cron had not been installed.
   *
   * The two cannot collide. `processJob` takes the server-side claim before applying
   * anything and answers `skipped` when another driver holds it, so a tick that loses
   * the race reads progress instead of repeating a step. Losing it is normal, not an
   * error — it just means the cron got there first.
   *
   * The message is only appended when it changes: the same step is read several times
   * over at this cadence, and logging each read would bury the run in duplicates.
   */
  const pollJob = useCallback(
    async (jobId: number) => {
      // Drives and reports in one round trip — the response carries the job state as
      // it stands after the slice, so no separate status read is needed on this path.
      let result = await smartOltReconciliationService.processJob(jobId);
      if (!mounted.current) return;

      // Only if the drive could not report at all (transport error, or the claim was
      // refused without a job body) is a plain read needed to keep the bar truthful.
      if (!result.job) {
        result = await smartOltReconciliationService.getJobStatus(jobId);
        if (!mounted.current) return;
      }

      if (result.job) {
        setJob(result.job);

        if (result.job.status === 'running' || result.job.status === 'paused') {
          const message = result.job.message;
          if (message && message !== lastJobMessage.current) {
            lastJobMessage.current = message;
            appendJobLog(message);
          }

          // Paused waits out a quota cooldown. Otherwise: press on quickly when this
          // tab did the work, and back off when another driver holds the claim.
          const delay =
            result.job.status === 'paused'
              ? PAUSED_POLL_MS
              : result.skipped
              ? JOB_POLL_MS
              : JOB_DRIVE_MS;

          jobTimer.current = setTimeout(() => pollJob(jobId), delay);
          return;
        }

        lastJobMessage.current = null;
        appendJobLog(`Job ${result.job.status}: ${result.job.message}`);
        setNotice({
          tone: result.job.status === 'completed' ? 'success' : result.job.status === 'aborted' ? 'info' : 'error',
          text: result.job.message,
        });

        // Refresh whatever the finished job just changed.
        await loadState(true);
        if (tab !== 'inventory') await loadTabData(tab);
      } else {
        appendJobLog(result.message);
        setNotice({ tone: 'error', text: result.message });
        setJob(null);
      }
    },
    [appendJobLog, loadState, loadTabData, tab]
  );

  /**
   * Reattach to a sweep that is already running when the page loads.
   *
   * The whole point of moving execution server-side is that an operator can leave.
   * Without this they would come back to an idle-looking screen while a sync ran on
   * regardless, and would very reasonably try to start it again — which the server
   * would refuse, because the slot is occupied by the job they cannot see.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const active = await smartOltReconciliationService.getActiveJob();
      if (cancelled || !mounted.current || !active) return;

      // Never stomp a job this session just started.
      if (jobWatched.current) return;
      jobWatched.current = true;

      setJob((current) => current ?? active);
      appendJobLog(`Reattached to ${active.type} already running (${active.current}/${active.total}).`);
      if (jobTimer.current) clearTimeout(jobTimer.current);
      jobTimer.current = setTimeout(() => pollJob(active.id), 0);
    })();

    return () => {
      cancelled = true;
    };
    // Once per mount: this is a reattach, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startJob = useCallback(
    async (type: JobType, options: Record<string, any> = {}) => {
      setJobLog([]);
      setJobPaused(false);
      // A newly started job always opens expanded, whatever the last one was left as.
      setIsMinimized(false);
      const result = await smartOltReconciliationService.startJob(type, options);

      if (!result.success || !result.job) {
        setNotice({ tone: 'error', text: result.message });
        return;
      }

      setJob(result.job);
      jobWatched.current = true;
      lastJobMessage.current = null;
      appendJobLog(`Started ${type}. It now runs on the server — you can close this tab.`);
      jobTimer.current = setTimeout(() => pollJob(result.job!.id), 0);
    },
    [appendJobLog, pollJob]
  );

  /**
   * Stop watching. The job itself keeps running.
   *
   * This used to halt the work, because the browser was the thing driving it. It no
   * longer is, so the control is labelled for what it now does — anything still
   * called "Pause" here would be a lie about what happened to the sweep. Stopping
   * the work is Cancel, which aborts it server-side.
   */
  const stopWatching = useCallback(() => {
    if (jobTimer.current) clearTimeout(jobTimer.current);
    jobTimer.current = null;
    setJobPaused(true);
    appendJobLog('Stopped watching. The job continues on the server.');
  }, [appendJobLog]);

  const startWatching = useCallback(() => {
    if (!job) return;
    if (jobTimer.current) clearTimeout(jobTimer.current);
    setJobPaused(false);
    appendJobLog('Watching again.');
    jobTimer.current = setTimeout(() => pollJob(job.id), 0);
  }, [job, appendJobLog, pollJob]);

  const cancelJob = useCallback(async () => {
    if (!job) return;
    if (jobTimer.current) clearTimeout(jobTimer.current);
    jobTimer.current = null;
    const result = await smartOltReconciliationService.abortJob(job.id);
    setJob(result.job);
    appendJobLog(result.message);
    await loadState(true);
  }, [job, appendJobLog, loadState]);

  // ---- Derived -----------------------------------------------------------

  /** The rows behind the current tab, before the grid searches, sorts or pages them. */
  const activeRows: any[] = useMemo(() => {
    if (tab === 'inventory') return state?.rows ?? [];
    if (tab === 'mac_alignment') return macAlignment?.rows ?? [];
    if (tab === 'sn_alignment') return snAlignment?.rows ?? [];
    if (tab === 'profile') return profile?.rows ?? [];
    if (tab === 'cleanup') return cleanup?.rows ?? [];
    return [];
  }, [tab, state?.rows, macAlignment?.rows, snAlignment?.rows, profile?.rows, cleanup?.rows]);

  /**
   * The fifteen dashboard cards, in the order they are read.
   *
   * Derived rather than hardcoded in the markup so the labels, captions and colours
   * stay next to the values they describe. Nothing here computes: every figure is
   * already resolved server-side by `getState`, which is what keeps a page poll from
   * costing a RADIUS sweep.
   */
  const metricCards = useMemo(() => {
    const m = state?.metrics;

    return [
      { key: 'inventory', label: 'Inventory', caption: 'Total SmartOLT ONUs', value: m?.inventory ?? state?.inventory_count ?? 0, tone: '' },
      { key: 'authorized', label: 'Authorized', caption: 'Online / authorized', value: m?.authorized, tone: 'text-emerald-500' },
      { key: 'offline', label: 'Offline', caption: 'Power / link down', value: m?.offline, tone: 'text-gray-400' },
      { key: 'los', label: 'LOS', caption: 'Fiber loss of signal', value: m?.los, tone: 'text-red-500' },
      { key: 'pwrfail', label: 'Power Fail', caption: 'Dying gasp / off', value: m?.pwrfail, tone: 'text-amber-500' },
      { key: 'name_not_set', label: 'Name = "Not Set"', caption: 'Unassigned names', value: m?.name_not_set, tone: 'text-amber-500' },

      { key: 'named', label: 'Named ONUs', caption: 'Custom names set', value: m?.named, tone: 'text-blue-500' },
      { key: 'radius_active', label: 'RADIUS Active', caption: 'Active user sessions', value: m?.radius_active, tone: 'text-blue-500' },
      { key: 'mac_cached', label: 'MAC Cached', caption: 'OLT bridge MAC cache', value: m?.mac_cached, tone: 'text-blue-500' },
      { key: 'pending_discovery', label: 'Pending Discovery', caption: 'Uncached MAC ONUs', value: m?.pending_discovery, tone: 'text-orange-500' },
      { key: 'matched_sessions', label: 'Matched Sessions', caption: 'Exact MAC matches', value: m?.matched_sessions, tone: 'text-emerald-500' },
      { key: 'rename_required', label: 'Rename Required', caption: 'Includes "not set"', value: m?.rename_required, tone: 'text-amber-500' },

      { key: 'already_correct', label: 'Already Correct', caption: 'Name equals username', value: m?.already_correct, tone: 'text-emerald-500' },
      { key: 'address_updates', label: 'Address Updates', caption: 'Pending DB sync', value: m?.address_updates, tone: 'text-blue-500' },
      { key: 'delete_candidates', label: 'Delete Candidates', caption: 'Passed safety rules', value: m?.delete_candidates, tone: 'text-red-500' },
    ];
  }, [state]);

  const gridColumns = useMemo(() => TAB_COLUMNS[tab], [tab]);
  const gridFilters = useMemo(() => TAB_FILTERS[tab], [tab]);
  const selectable = useMemo(() => isRowSelectable(tab), [tab]);

  const grid = useDataGrid<any>({
    rows: activeRows,
    columns: gridColumns,
    rowKey: onuRowKey,
    isSelectable: selectable,
    filters: gridFilters,
    pageSize: PAGE_SIZE,
    // One namespace per tab — the four tables share no columns, so they must not
    // share a stored layout either.
    storageKey: `smartolt_tool.columns.${tab}`,
  });

  const { pagedRows, selected, page, totalPages, visibleColumns } = grid;
  const toggle = grid.toggleRow;
  const { clearSelection: clearGridSelection, setPage: setGridPage } = grid;

  // Switching tab swaps the dataset wholesale: ids from the previous tab must not carry
  // a selection over, and page 3 of the old table means nothing in the new one.
  useEffect(() => {
    clearGridSelection();
    setGridPage(1);
    if (tab !== 'inventory') loadTabData(tab);
  }, [tab, loadTabData, clearGridSelection, setGridPage]);

  /**
   * Re-run a matching tab against live data.
   *
   * Plain `loadTabData` was not enough on its own. The preview itself is recomputed
   * server-side on every call — it re-reads the RADIUS session table and the
   * subscriber records rather than replaying a stored result — but the figures above
   * the table and the tick-boxes below it were left standing from the previous
   * computation, so a re-match that had genuinely changed the answer still looked
   * like the old one. This drops the selection first (an id from the previous pass
   * must not carry onto a row that is no longer the same decision), recomputes the
   * tab, then refreshes the dashboard metrics off the summary that pass just parked.
   *
   * The SmartOLT ONU inventory and the bridge-MAC cache are deliberately NOT
   * re-downloaded here: both cost throttled API calls per ONU and neither changes
   * between two presses of this button. Sync SmartOLT Inventory and Discover Bridge
   * MACs are the buttons that spend that quota, on purpose.
   */
  const rematch = useCallback(async (target: TabId) => {
    clearGridSelection();
    setGridPage(1);
    await loadTabData(target);
    await loadState(true);
    setNotice({ tone: 'info', text: 'Re-matched against the live RADIUS sessions and the current billing records.' });
  }, [clearGridSelection, setGridPage, loadTabData, loadState]);

  const confirmUndo = useCallback(async () => {
    if (!undoTarget) return;
    const result = await smartOltReconciliationService.undo(undoTarget.log_id);
    setNotice({ tone: result.success ? (result.skipped ? 'info' : 'success') : 'error', text: result.message });
    setUndoTarget(null);
    await loadTabData('logs');
    if (result.success) await loadState(true);
  }, [undoTarget, loadTabData, loadState]);

  // ---- Theme tokens ------------------------------------------------------

  const card = isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200';
  const text = isDarkMode ? 'text-gray-100' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const input = isDarkMode
    ? 'bg-gray-950 border-gray-800 text-gray-100 placeholder-gray-600'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';
  const rowHover = isDarkMode ? 'hover:bg-gray-800/60' : 'hover:bg-gray-50';
  const headRow = isDarkMode ? 'bg-gray-950/60 text-gray-400' : 'bg-gray-50 text-gray-600';

  // A paused job still owns the single active-job slot server-side, so it must keep
  // the start buttons disabled exactly as a running one does.
  const jobRunning = job !== null && (job.status === 'running' || job.status === 'paused');
  const jobRateLimited = job !== null && job.status === 'paused';

  /**
   * The backend export only knows these datasets; MAC alignment has no CSV of its own.
   * 'alignment' stays in the union because the backend dataset is still served, but no
   * tab selects it since the Name Alignment tab was retired.
   */
  const exportDataset: 'inventory' | 'alignment' | 'sn_alignment' | 'profile' | 'cleanup' =
    tab === 'sn_alignment' || tab === 'profile' || tab === 'cleanup' ? tab : 'inventory';

  /** Checkbox column included, when the tab has one. */
  const columnSpan = visibleColumns.length + (tab === 'inventory' ? 0 : 1);

  const emptyMessage =
    tab === 'inventory'
      ? (<>No ONU in the cache. Run <strong>Sync Inventory</strong> to download it from SmartOLT.</>)
      : tab === 'mac_alignment'
        ? (
          <>
            Nothing matched. Run <strong>Sync Inventory</strong>, then <strong>Discover Bridge MACs</strong> to
            discover the bridge MACs this pass matches against.
          </>
        )
        : tab === 'sn_alignment'
          ? (
            <>
              Nothing matched. Run <strong>Sync Inventory</strong>, then <strong>Discover Bridge MACs</strong> so the
              bridge MACs this pass matches on are known.
            </>
          )
          : tab === 'profile'
            ? 'No matched ONU has a pending profile change.'
            : `No ONU has been offline for ${offlineDays} days or more.`;

  /**
   * One table cell, chosen by column key within the active tab.
   *
   * Keys are namespaced by tab in `TAB_COLUMNS`, and a few (`sn`, `name`, `status`) are
   * deliberately shared where the four previews render them identically.
   */
  const renderCell = (columnKey: string, row: any): React.ReactNode => {
    // ---- shared across tabs ----
    if (columnKey === 'sn' && tab !== 'profile') {
      return <td className={`px-3 py-2.5 font-mono text-xs ${text}`}>{row.sn || '—'}</td>;
    }
    if (columnKey === 'name') {
      return <td className={`px-3 py-2.5 text-xs ${text}`}>{row.name || <span className={muted}>not set</span>}</td>;
    }

    if (tab === 'inventory') {
      switch (columnKey) {
        case 'location':
          return (
            <td className={`px-3 py-2.5 text-xs ${muted}`}>
              {[row.olt_name, row.board, row.port, row.zone_name].filter(Boolean).join(' / ') || '—'}
            </td>
          );
        case 'status':
          return (
            <td className={`px-3 py-2.5 text-xs ${text}`}>
              {row.status}
              {row.days_offline !== null && row.status !== 'online' && (
                <span className={`ml-1 ${muted}`}>({row.days_offline}d)</span>
              )}
            </td>
          );
        case 'mac_address':
          return (
            <td className={`px-3 py-2.5 text-xs font-mono ${row.mac_address ? text : muted}`}>
              {row.mac_address || 'pending discovery'}
            </td>
          );
        default:
          return <td className="px-3 py-2.5" />;
      }
    }

    if (tab === 'mac_alignment') {
      switch (columnKey) {
        case 'state':
          return (
            <td className="px-3 py-2.5">
              <span className={`text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap ${MAC_STATE_BADGES[row.state as MacAlignState].classes}`}>
                {MAC_STATE_BADGES[row.state as MacAlignState].label}
              </span>
            </td>
          );
        case 'radius_username':
          return (
            <td className={`px-3 py-2.5 text-xs font-mono ${row.radius_username ? text : muted}`}>
              {row.radius_username || '—'}
            </td>
          );
        case 'calling_station_id':
          return <td className={`px-3 py-2.5 text-xs font-mono ${muted}`}>{row.calling_station_id || '—'}</td>;
        case 'current_name':
          return <td className={`px-3 py-2.5 text-xs ${row.current_name === 'not set' ? muted : text}`}>{row.current_name}</td>;
        case 'target_name':
          return (
            <td className={`px-3 py-2.5 text-xs font-mono font-medium ${row.eligible ? 'text-cyan-500' : muted}`}>
              {row.target_name || '—'}
            </td>
          );
        case 'server_label':
          return <td className={`px-3 py-2.5 text-xs ${muted}`}>{row.server_label || '—'}</td>;
        case 'status':
          return <td className={`px-3 py-2.5 text-xs ${muted}`}>{row.status}</td>;
        case 'actions':
          return (
            <td className="px-3 py-2.5 text-right">
              {row.eligible ? (
                <button
                  onClick={() => startJob('rename', {
                    items: [{ external_id: row.external_id, new_name: row.target_name }],
                  })}
                  disabled={jobRunning}
                  title={`Rename this ONU to "${row.target_name}"`}
                  className="px-2 py-1 rounded border border-cyan-500/40 text-cyan-500 text-xs font-medium hover:bg-cyan-500/10 disabled:opacity-40"
                >
                  Rename
                </button>
              ) : (
                <span className={`text-xs ${muted}`} title={row.reason}>—</span>
              )}
            </td>
          );
        default:
          return <td className="px-3 py-2.5" />;
      }
    }

    if (tab === 'sn_alignment') {
      switch (columnKey) {
        case 'state':
          return (
            <td className="px-3 py-2.5">
              <span className={`text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap ${SN_STATE_BADGES[row.state as SnAlignState].classes}`}>
                {SN_STATE_BADGES[row.state as SnAlignState].label}
              </span>
            </td>
          );
        case 'sn':
          // The value that would be written — highlighted only when it actually would be.
          return (
            <td className={`px-3 py-2.5 font-mono text-xs font-medium ${row.eligible ? 'text-cyan-500' : text}`}>
              {row.sn || '—'}
            </td>
          );
        case 'billing_sn':
          // Struck through when this row would replace it, so the operator sees the
          // value they are about to lose before they run the batch.
          return (
            <td className="px-3 py-2.5 text-xs">
              {row.billing_sn
                ? (
                  <span className={`font-mono ${row.state === 'sn_mismatch' ? `line-through ${muted}` : text}`}>
                    {row.billing_sn}
                  </span>
                )
                : <span className={muted}>not set</span>}
            </td>
          );
        case 'account_no':
          return <td className={`px-3 py-2.5 text-xs ${row.account_no ? text : muted}`}>{row.account_no || '—'}</td>;
        case 'customer_name':
          return <td className={`px-3 py-2.5 text-xs ${muted}`}>{row.customer_name || '—'}</td>;
        case 'radius_username':
          return (
            <td className={`px-3 py-2.5 text-xs font-mono ${row.radius_username ? text : muted}`}>
              {row.radius_username || '—'}
            </td>
          );
        case 'calling_station_id':
          return <td className={`px-3 py-2.5 text-xs font-mono ${muted}`}>{row.calling_station_id || '—'}</td>;
        case 'current_name':
          return <td className={`px-3 py-2.5 text-xs ${row.current_name === 'not set' ? muted : text}`}>{row.current_name}</td>;
        case 'status':
          return <td className={`px-3 py-2.5 text-xs ${muted}`}>{row.status}</td>;
        case 'actions':
          return (
            <td className="px-3 py-2.5 text-right">
              {row.eligible ? (
                <button
                  onClick={() => startJob('sn_alignment', {
                    items: [{
                      external_id: row.external_id,
                      technical_detail_id: row.technical_detail_id,
                      new_sn: row.sn,
                    }],
                  })}
                  disabled={jobRunning}
                  title={`Write "${row.sn}" into this subscriber's router/modem SN`}
                  className="px-2 py-1 rounded border border-cyan-500/40 text-cyan-500 text-xs font-medium hover:bg-cyan-500/10 disabled:opacity-40"
                >
                  {row.state === 'sn_mismatch' ? 'Replace' : 'Write'}
                </button>
              ) : (
                <span className={`text-xs ${muted}`} title={row.reason}>—</span>
              )}
            </td>
          );
        default:
          return <td className="px-3 py-2.5" />;
      }
    }

    if (tab === 'profile') {
      switch (columnKey) {
        case 'sn':
          return (
            <td className={`px-3 py-2.5 text-xs ${text}`}>
              <div className="font-mono">{row.sn || '—'}</div>
              <div className={muted}>{row.account_no ?? '—'} {row.customer_name ? `· ${row.customer_name}` : ''}</div>
            </td>
          );
        case 'address':
          return (
            <td className="px-3 py-2.5 text-xs">
              {row.address_changed ? (
                <>
                  <div className={`line-through ${muted}`}>{row.old_address || '(empty)'}</div>
                  <div className="text-cyan-500">{row.new_address}</div>
                </>
              ) : <span className={muted}>{row.old_address || '—'}</span>}
            </td>
          );
        case 'contact':
          return (
            <td className="px-3 py-2.5 text-xs">
              {row.contact_changed ? (
                <>
                  <div className={`line-through ${muted}`}>{row.old_contact || '(empty)'}</div>
                  <div className="text-cyan-500">{row.new_contact}</div>
                </>
              ) : <span className={muted}>{row.old_contact || '—'}</span>}
            </td>
          );
        case 'coords':
          return (
            <td className="px-3 py-2.5 text-xs">
              {row.coords_changed ? (
                <>
                  <div className={`line-through ${muted}`}>{row.old_latitude || '—'}, {row.old_longitude || '—'}</div>
                  <div className="text-cyan-500">{row.new_latitude}, {row.new_longitude}</div>
                </>
              ) : <span className={muted}>{row.old_latitude ? `${row.old_latitude}, ${row.old_longitude}` : '—'}</span>}
            </td>
          );
        case 'vlan':
          return (
            <td className="px-3 py-2.5 text-xs">
              <span className={row.vlan_drift ? 'text-amber-500' : muted}>
                {row.olt_vlan || '—'}{row.vlan_drift ? ` → ${row.billing_vlan}` : ''}
              </span>
            </td>
          );
        default:
          return <td className="px-3 py-2.5" />;
      }
    }

    // ---- cleanup ----
    switch (columnKey) {
      case 'zone':
        return (
          <td className={`px-3 py-2.5 text-xs ${muted}`}>
            {[row.zone_name, row.olt_name].filter(Boolean).join(' / ') || '—'}
          </td>
        );
      case 'status':
        return <td className={`px-3 py-2.5 text-xs ${text}`}>{row.status}</td>;
      case 'days_offline':
        return <td className={`px-3 py-2.5 text-xs ${text}`}>{row.days_offline ?? '—'}</td>;
      case 'mac_address':
        return (
          <td className={`px-3 py-2.5 text-xs font-mono ${row.mac_address ? text : muted}`}>
            {row.mac_address || '—'}
          </td>
        );
      case 'safety':
        return (
          <td className="px-3 py-2.5 text-xs">
            {row.eligible ? (
              <span className={muted}>—</span>
            ) : (
              <div className="space-y-0.5">
                {(row.reasons ?? []).map((reason: string) => (
                  <div key={reason} className="flex items-start gap-1 text-amber-500">
                    <XCircle className="w-3 h-3 mt-0.5 shrink-0" /> {reason}
                  </div>
                ))}
              </div>
            )}
          </td>
        );
      default:
        return <td className="px-3 py-2.5" />;
    }
  };

  return (
    <div className={`p-4 md:p-6 min-h-full ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
            <Network className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className={`text-xl font-bold ${text}`}>SmartOLT Tool</h1>
            <p className={`text-sm ${muted}`}>
              ONU inventory, bridge-MAC discovery, MAC-based name and router/modem SN alignment, profile push and safe decommissioning.
              {state?.inventory_synced_at && (
                <> Inventory synced {new Date(state.inventory_synced_at).toLocaleString()}.</>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => startJob('smartolt_sync')}
            disabled={jobRunning || !state?.configured}
            className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" /> Sync SmartOLT Inventory
          </button>
          <button
            onClick={() => startJob('radius_scan')}
            disabled={jobRunning || !state?.configured}
            className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 disabled:opacity-50 ${card} ${text}`}
          >
            <Activity className="w-4 h-4" /> Sync RADIUS
          </button>
          {/* Background bridge-MAC crawl. One API call per ONU against a hard quota,
              so it runs as a bounded background job and never inline. Default queues
              only ONUs never read; hold Shift to force a full rescan. */}
          <button
            onClick={(e) => startJob('optical_scan', { rescan: e.shiftKey })}
            disabled={jobRunning || !state?.configured}
            title="Discover bridge MACs in the background. Shift-click to re-read every ONU."
            className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 disabled:opacity-50 ${card} ${text}`}
          >
            <Gauge className="w-4 h-4" /> Discover Bridge MACs
          </button>
          <button
            onClick={() => smartOltReconciliationService.exportCsv(exportDataset)}
            disabled={loading}
            className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 disabled:opacity-50 ${card} ${text}`}
          >
            <Download className="w-4 h-4" /> Export All
          </button>
        </div>
      </div>

      {/* Notice */}
      {notice && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg border text-sm flex items-start justify-between gap-3 ${notice.tone === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
              : notice.tone === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-500'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-500'
            }`}
        >
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Rate-limit pause banner — the job is parked, not broken, and resumes itself */}
      {jobRateLimited && job && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-500">
          <div className="flex items-start gap-2">
            <PauseCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold">SmartOLT API rate limit reached — the job is paused, not lost.</div>
              <div className="mt-1 opacity-90">
                {job.message}
                {job.context?.resume_at && (
                  <> It resumes automatically at {new Date(job.context.resume_at).toLocaleTimeString()}.</>
                )}
              </div>
              <div className="mt-1 text-xs opacity-75">
                Progress is checkpointed at {job.current} of {job.total}
                {typeof job.context?.rate_limit_hits === 'number' && job.context.rate_limit_hits > 0 && (
                  <> · {job.context.rate_limit_hits} quota stop{job.context.rate_limit_hits === 1 ? '' : 's'} this run</>
                )}
                . The nightly automation also picks up parked jobs from this checkpoint.
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              <button
                onClick={startWatching}
                title="Retry now. If SmartOLT's quota has not cleared the job stays paused."
                className="px-2 py-1 rounded border border-amber-500/40 text-xs font-medium hover:bg-amber-500/10"
              >
                Resume
              </button>
              <button
                onClick={cancelJob}
                className="px-2 py-1 rounded border border-amber-500/40 text-xs font-medium hover:bg-amber-500/10"
              >
                Abort
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live slice progress for any running background job */}
      {job && job.status === 'running' && (
        <div className={`mb-4 rounded-lg border p-3 ${card}`}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className={`text-sm font-medium ${text} flex items-center gap-2`}>
              <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />
              {job.message}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs font-mono ${muted}`}>
                {job.current} / {job.total || '?'}
              </span>
              <button
                onClick={jobPaused ? startWatching : stopWatching}
                className={`px-2 py-1 rounded border text-xs font-medium ${card} ${text}`}
              >
                {jobPaused ? 'Watch' : 'Stop watching'}
              </button>
              <button
                onClick={cancelJob}
                className="px-2 py-1 rounded border border-red-500/40 text-red-500 text-xs font-medium hover:bg-red-500/10"
              >
                Abort
              </button>
            </div>
          </div>

          <div className={`h-1.5 rounded-full overflow-hidden ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
            <div
              className="h-full bg-cyan-500 transition-all duration-300"
              style={{ width: job.total > 0 ? `${Math.min(100, (job.current / job.total) * 100)}%` : '100%' }}
            />
          </div>
        </div>
      )}

      {/* Metrics grid. Fifteen cards in three rows of six, six and three: the estate
          as SmartOLT reports it, then what RADIUS and the MAC cache make of it, then
          what there is to act on. A dash rather than a zero means the pass behind that
          figure has not run yet — open its tab, or wait for the nightly automation. */}
      {state && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {metricCards.map(({ key, label, caption, value, tone }) => (
            <div key={key} className={`rounded-xl border p-3 ${card}`} title={caption}>
              <div className={`text-[10px] font-semibold tracking-wide uppercase ${muted}`}>{label}</div>
              <div className={`text-2xl font-bold mt-1 ${value === null || value === undefined ? muted : (tone || text)}`}>
                {formatMetric(value)}
              </div>
              <div className={`text-[10px] mt-0.5 truncate ${muted}`}>{caption}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 transition-colors ${tab === id ? 'bg-cyan-600 border-cyan-600 text-white' : `${card} ${text} hover:border-cyan-500/50`
              }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Search + per-tab controls */}
      {tab !== 'logs' && (
        <div className={`rounded-xl border p-3 mb-4 flex flex-col md:flex-row md:items-center gap-3 ${card}`}>
          <GridFilterBar
            isDarkMode={isDarkMode}
            search={grid.search}
            onSearch={grid.setSearch}
            placeholder="Search by serial, name, account number or zone…"
            filters={gridFilters}
            filterValues={grid.filterValues}
            onFilterChange={grid.setFilterValue}
            hasActiveFilter={grid.hasActiveFilter}
            onClear={grid.clearFilters}
            filteredCount={grid.filteredCount}
            totalRows={grid.totalRows}
          />

          <PageSizeSelector
            isDarkMode={isDarkMode}
            pageSize={grid.pageSize}
            onPageSizeChange={grid.setPageSize}
            filteredCount={grid.filteredCount}
          />

          {/* Exports what is on screen — current filters, sort and columns, or just
              the ticked rows. The header's Export All is the server-side full dataset. */}
          <ExportButton
            isDarkMode={isDarkMode}
            onExport={() => grid.toCsv(`smartolt_${tab}_${new Date().toISOString().slice(0, 10)}`)}
            rowCount={grid.selectedCount > 0 ? grid.selectedCount : grid.filteredCount}
            isSelection={grid.selectedCount > 0}
            label="Export View"
          />

          <ColumnMenu
            isDarkMode={isDarkMode}
            columns={grid.columns}
            hiddenKeys={grid.hiddenKeys}
            onToggle={grid.toggleColumn}
            onMove={grid.moveColumn}
            onReset={grid.resetColumns}
          />

          {tab === 'cleanup' && (
            <div className="flex items-center gap-2">
              <label className={`text-xs ${muted}`}>Offline for at least</label>
              <input
                type="number"
                min={1}
                value={offlineDays}
                onChange={(e) => setOfflineDays(Math.max(1, Number(e.target.value)))}
                className={`w-20 px-2 py-2 rounded-lg border text-sm ${input}`}
              />
              <span className={`text-xs ${muted}`}>days</span>
              <button
                onClick={() => loadTabData('cleanup')}
                className={`px-3 py-2 rounded-lg border text-xs font-medium ${card} ${text}`}
              >
                Re-evaluate
              </button>
            </div>
          )}

          {tab === 'mac_alignment' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => rematch('mac_alignment')}
                disabled={loading}
                title="Recompute this table against the live RADIUS sessions and current billing records."
                className={`px-3 py-2 rounded-lg border text-xs font-medium disabled:opacity-50 ${card} ${text}`}
              >
                {loading ? 'Re-matching…' : 'Re-match'}
              </button>

              {/* Batch actions. `Align All Matched` deliberately ignores the checkbox
                  selection and takes every eligible row — including ones on pages the
                  operator has not scrolled to — which is the whole point of "All". */}
              <select
                value=""
                disabled={jobRunning}
                onChange={(e) => {
                  const action = e.target.value;
                  e.target.value = '';

                  if (action === 'align_all') {
                    const items = (macAlignment?.rows ?? [])
                      .filter((row) => row.eligible)
                      .map((row) => ({ external_id: row.external_id, new_name: row.target_name }));

                    if (items.length === 0) {
                      setNotice({ tone: 'info', text: 'Every matched ONU already carries its RADIUS username.' });
                      return;
                    }
                    startJob('rename', { items });
                    return;
                  }

                  if (action === 'align_selected') {
                    const items = (macAlignment?.rows ?? [])
                      .filter((row) => row.eligible && selected.has(row.external_id))
                      .map((row) => ({ external_id: row.external_id, new_name: row.target_name }));

                    if (items.length === 0) {
                      setNotice({ tone: 'info', text: 'Select at least one ONU whose name differs from its RADIUS username.' });
                      return;
                    }
                    startJob('rename', { items });
                    return;
                  }

                  if (action === 'unprovision_selected') {
                    if (selected.size === 0) {
                      setNotice({ tone: 'info', text: 'Select at least one ONU to unprovision.' });
                      return;
                    }
                    // Same confirmation gate the cleanup tab uses — permanent removal
                    // must never be one dropdown click away.
                    setDeleteConfirm('');
                    setDeleteModalOpen(true);
                  }
                }}
                className={`px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 ${input}`}
              >
                <option value="">Batch actions…</option>
                <option value="align_all">
                  Align All Matched ({(macAlignment?.rows ?? []).filter((r) => r.eligible).length})
                </option>
                <option value="align_selected">Align Selected ({selected.size})</option>
                <option value="unprovision_selected">Unprovision Selected ({selected.size})</option>
              </select>
            </div>
          )}

          {tab === 'sn_alignment' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => rematch('sn_alignment')}
                disabled={loading}
                title="Recompute this table against the live RADIUS sessions and current billing records."
                className={`px-3 py-2 rounded-lg border text-xs font-medium disabled:opacity-50 ${card} ${text}`}
              >
                {loading ? 'Re-matching…' : 'Re-match'}
              </button>

              {/* `Write All Missing` is offered separately from `All Eligible` on purpose:
                  filling blank columns is safe and is what most operators want, while
                  replacing serials somebody already recorded deserves its own decision. */}
              <select
                value=""
                disabled={jobRunning}
                onChange={(e) => {
                  const action = e.target.value;
                  e.target.value = '';

                  const toItem = (row: any) => ({
                    external_id: row.external_id,
                    technical_detail_id: row.technical_detail_id,
                    new_sn: row.sn,
                  });

                  if (action === 'write_missing') {
                    const items = (snAlignment?.rows ?? [])
                      .filter((row) => row.eligible && row.state === 'sn_missing')
                      .map(toItem);

                    if (items.length === 0) {
                      setNotice({ tone: 'info', text: 'Every matched subscriber already has a router/modem SN recorded.' });
                      return;
                    }
                    startJob('sn_alignment', { items });
                    return;
                  }

                  if (action === 'write_all') {
                    const items = (snAlignment?.rows ?? []).filter((row) => row.eligible).map(toItem);

                    if (items.length === 0) {
                      setNotice({ tone: 'info', text: 'Nothing to write — every matched subscriber already carries its ONU serial.' });
                      return;
                    }
                    startJob('sn_alignment', { items });
                    return;
                  }

                  if (action === 'write_selected') {
                    const items = (snAlignment?.rows ?? [])
                      .filter((row) => row.eligible && selected.has(row.external_id))
                      .map(toItem);

                    if (items.length === 0) {
                      setNotice({ tone: 'info', text: 'Select at least one subscriber whose recorded SN differs from the ONU.' });
                      return;
                    }
                    startJob('sn_alignment', { items });
                  }
                }}
                className={`px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 ${input}`}
              >
                <option value="">Batch actions…</option>
                <option value="write_missing">
                  Fill Missing Only ({(snAlignment?.rows ?? []).filter((r) => r.state === 'sn_missing').length})
                </option>
                <option value="write_all">
                  Write All Eligible ({(snAlignment?.rows ?? []).filter((r) => r.eligible).length})
                </option>
                <option value="write_selected">Write Selected ({selected.size})</option>
              </select>
            </div>
          )}

          {tab === 'profile' && (
            <button
              onClick={() => {
                const items = (profile?.rows ?? [])
                  .filter((row) => row.eligible && selected.has(row.external_id))
                  .map((row) => ({
                    external_id: row.external_id,
                    new_address: row.new_address,
                    new_contact: row.new_contact,
                    new_latitude: row.new_latitude,
                    new_longitude: row.new_longitude,
                    address_changed: row.address_changed,
                    contact_changed: row.contact_changed,
                    coords_changed: row.coords_changed,
                  }));
                if (items.length === 0) {
                  setNotice({ tone: 'info', text: 'Select at least one ONU with a pending change.' });
                  return;
                }
                startJob('profile_sync', { items });
              }}
              disabled={jobRunning}
              className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-50"
            >
              Push {selected.size > 0 ? `${selected.size} ` : ''}selected
            </button>
          )}

          {tab === 'cleanup' && (
            <button
              onClick={() => {
                if (selected.size === 0) {
                  setNotice({ tone: 'info', text: 'Select at least one eligible ONU.' });
                  return;
                }
                setDeleteConfirm('');
                setDeleteModalOpen(true);
              }}
              disabled={jobRunning}
              className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Decommission {selected.size > 0 ? selected.size : ''}
            </button>
          )}
        </div>
      )}

      {/* Selection summary — the batch triggers themselves stay on each tab's control row */}
      {tab !== 'inventory' && tab !== 'logs' && (
        <SelectionBar
          isDarkMode={isDarkMode}
          selectedCount={grid.selectedCount}
          selectableFilteredCount={grid.selectableFilteredCount}
          isAllFilteredSelected={grid.isAllFilteredSelected}
          onSelectAllFiltered={grid.selectAllFiltered}
          onClearSelection={grid.clearSelection}
        />
      )}

      {/* MAC alignment summary — and any device that did not answer */}
      {tab === 'mac_alignment' && macAlignment && (
        <div className="mb-4 space-y-2">
          <div className={`px-4 py-3 rounded-lg border text-sm ${card} ${muted}`}>
            Matched <strong className={text}>{macAlignment.summary.matched}</strong> of{' '}
            <strong className={text}>{macAlignment.summary.total}</strong> ONU(s) against{' '}
            <strong className={text}>{macAlignment.summary.sessions}</strong> live RADIUS session(s) —{' '}
            <span className="text-amber-500">{macAlignment.summary.rename_needed} need renaming</span>,{' '}
            <span className="text-emerald-500">{macAlignment.summary.aligned} already aligned</span>,{' '}
            {macAlignment.summary.unmatched} unmatched, {macAlignment.summary.no_mac} awaiting MAC discovery.
            The target name is the matched RADIUS username exactly.
          </div>

          {macAlignment.errors.length > 0 && (
            <div className="px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-500 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Some RADIUS devices did not answer, so this match is incomplete — an ONU shown as
                unmatched may simply belong to a device that was unreachable. {macAlignment.errors.join(' · ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* SN alignment summary — and any device that did not answer */}
      {tab === 'sn_alignment' && snAlignment && (
        <div className="mb-4 space-y-2">
          <div className={`px-4 py-3 rounded-lg border text-sm ${card} ${muted}`}>
            Matched <strong className={text}>{snAlignment.summary.matched}</strong> of{' '}
            <strong className={text}>{snAlignment.summary.total}</strong> ONU(s) against{' '}
            <strong className={text}>{snAlignment.summary.sessions}</strong> live RADIUS session(s) —{' '}
            <span className="text-amber-500">{snAlignment.summary.missing} missing an SN</span>,{' '}
            <span className="text-orange-500">{snAlignment.summary.mismatch} recorded differently</span>,{' '}
            <span className="text-emerald-500">{snAlignment.summary.aligned} already aligned</span>,{' '}
            {snAlignment.summary.no_subscriber} with no billing record, {snAlignment.summary.unmatched} unmatched,{' '}
            {snAlignment.summary.no_mac} awaiting MAC discovery. Applying writes SmartOLT's serial into the
            subscriber's <strong className={text}>router/modem SN</strong>; nothing is ever pushed back to SmartOLT.
          </div>

          {snAlignment.summary.mismatch > 0 && (
            <div className="px-4 py-3 rounded-lg border border-orange-500/30 bg-orange-500/10 text-sm text-orange-500 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {snAlignment.summary.mismatch} subscriber(s) already carry a different serial. Writing those
                overwrites what is recorded now — the old value is shown struck through, and every write is
                reversible from Operation Logs &amp; Undo.
              </span>
            </div>
          )}

          {snAlignment.errors.length > 0 && (
            <div className="px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-500 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Some RADIUS devices did not answer, so this match is incomplete — an ONU shown as
                unmatched may simply belong to a device that was unreachable. {snAlignment.errors.join(' · ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* VLAN advisory on the profile tab */}
      {tab === 'profile' && profile && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-500 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {profile.vlan_note}
            {profile.summary.vlan_drift > 0 && ` ${profile.summary.vlan_drift} ONU(s) currently show a VLAN difference.`}
          </span>
        </div>
      )}

      {/* Content table */}
      <div className={`rounded-xl border overflow-hidden ${card}`}>
        <div className="overflow-x-auto">
          {/*
            One table body for every tab.

            The columns are operator-orderable and hideable now, so a fixed sequence of
            <td>s no longer works — `renderCell` returns each cell and the header order
            drives the row order. Every badge, diff line and reason list the four previews
            rendered before is preserved inside it.
          */}
          <table className="w-full text-sm">
            <thead className={`text-xs uppercase tracking-wide ${headRow}`}>
              <tr>
                {/* Inventory is a read-only view: no selection column at all. */}
                {tab !== 'inventory' && (
                  <SelectAllHeaderCell
                    isDarkMode={isDarkMode}
                    isPageSelected={grid.isPageSelected}
                    isAllFilteredSelected={grid.isAllFilteredSelected}
                    selectablePageCount={grid.selectablePageCount}
                    selectableFilteredCount={grid.selectableFilteredCount}
                    selectedCount={grid.selectedCount}
                    onSelectPage={grid.selectPage}
                    onDeselectPage={grid.deselectPage}
                    onSelectAllFiltered={grid.selectAllFiltered}
                    onClearSelection={grid.clearSelection}
                  />
                )}
                {visibleColumns.map((column) => {
                  const sortState = grid.sortStateFor(column.key);
                  return (
                    <SortableHeaderCell
                      key={column.key}
                      label={column.label}
                      sortable={!!column.value}
                      direction={sortState.direction}
                      priority={sortState.priority}
                      onSort={(additive) => grid.toggleSort(column.key, additive)}
                      align={column.key === 'actions' ? 'right' : 'left'}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody className={isDarkMode ? 'divide-y divide-gray-800' : 'divide-y divide-gray-100'}>
              {loading && (
                <tr>
                  <td colSpan={columnSpan} className={`px-4 py-12 text-center ${muted}`}>
                    <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                  </td>
                </tr>
              )}

              {!loading && pagedRows.length === 0 && (
                <tr>
                  <td colSpan={columnSpan} className={`px-4 py-12 text-center ${muted}`}>{emptyMessage}</td>
                </tr>
              )}

              {!loading && pagedRows.map((row: any) => {
                const id = onuRowKey(row);
                return (
                  <tr key={id} className={rowHover}>
                    {tab !== 'inventory' && (
                      <td className="px-3 py-2.5">
                        {/* Disabled state comes from the same predicate the header's
                            select-all uses. It was hardcoded to `!row.eligible`, which
                            the two could — and did — disagree about: after cleanup
                            stopped gating on eligibility, Select All took every
                            inactive ONU while the individual boxes stayed greyed out,
                            so a row could be selected in bulk but not on its own. */}
                        <input
                          type="checkbox"
                          disabled={!selectable(row)}
                          checked={selected.has(id)}
                          onChange={(e) => toggle(id, e.target.checked)}
                          className="rounded disabled:opacity-30"
                        />
                      </td>
                    )}
                    {visibleColumns.map((column) => (
                      <React.Fragment key={column.key}>{renderCell(column.key, row)}</React.Fragment>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {tab === 'logs' && (
            <table className="w-full text-sm">
              <thead className={`text-xs uppercase tracking-wide ${headRow}`}>
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">When</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Operator</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Action</th>
                  <th className="px-3 py-2.5 text-left font-semibold">ONU</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Change</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Undo</th>
                </tr>
              </thead>
              <tbody className={isDarkMode ? 'divide-y divide-gray-800' : 'divide-y divide-gray-100'}>
                {loading && <tr><td colSpan={7} className={`px-4 py-10 text-center ${muted}`}><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>}
                {!loading && logs.length === 0 && (
                  <tr><td colSpan={7} className={`px-4 py-10 text-center ${muted}`}>No operation has been recorded yet.</td></tr>
                )}
                {!loading && logs.map((entry) => (
                  <tr key={entry.log_id} className={rowHover}>
                    <td className={`px-3 py-2.5 text-xs whitespace-nowrap ${muted}`}>
                      {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-xs ${text}`}>{entry.operator}</td>
                    <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>{entry.action}</td>
                    <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>{entry.external_id ?? '—'}</td>
                    <td className={`px-3 py-2.5 text-xs ${muted} max-w-md`}>
                      <div className="truncate" title={entry.message}>{entry.message}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {entry.reversed ? (
                        <span className="text-[11px] px-2 py-0.5 rounded border bg-gray-500/15 text-gray-400 border-gray-500/30">Reversed</span>
                      ) : entry.reversible ? (
                        <span className="text-[11px] px-2 py-0.5 rounded border bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Applied</span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded border bg-amber-500/15 text-amber-500 border-amber-500/30">Final</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => setUndoTarget(entry)}
                        disabled={!entry.reversible || entry.reversed}
                        className="px-2 py-1 rounded text-[11px] font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1"
                      >
                        <Undo2 className="w-3 h-3" /> Undo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {tab !== 'logs' && !loading && grid.filteredCount > PAGE_SIZE && (
          <div className={`flex items-center justify-between px-4 py-3 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <span className={`text-xs ${muted}`}>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, grid.filteredCount)} of {grid.filteredCount}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => grid.setPage(Math.max(1, page - 1))} disabled={page === 1}
                className={`px-3 py-1 rounded border text-xs disabled:opacity-40 ${card} ${text}`}>Previous</button>
              <span className={`text-xs ${muted}`}>Page {page} of {totalPages}</span>
              <button onClick={() => grid.setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                className={`px-3 py-1 rounded border text-xs disabled:opacity-40 ${card} ${text}`}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Stepwise job progress — full modal, or docked to the corner when minimized.
          Both branches read the same job state and the same poll; minimizing only
          drops the backdrop and the console, never the work. */}
      {job && (job.status === 'running' || jobPaused) && (
        isMinimized ? (
          <div className="fixed bottom-5 right-5 z-50 w-80 max-w-[calc(100vw-2.5rem)]">
            <div className={`rounded-xl border shadow-2xl p-3 ${card}`}>
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className={`w-4 h-4 shrink-0 ${jobPaused ? '' : 'animate-spin'}`} />
                <span className={`text-xs font-bold truncate flex-1 min-w-0 ${text}`} title={jobTypeLabel(job.type)}>
                  {jobTypeLabel(job.type)}
                </span>
                <button
                  type="button"
                  onClick={() => setIsMinimized(false)}
                  title="Expand"
                  aria-label="Expand job progress"
                  className={`p-1 rounded border ${card} ${text}`}
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={cancelJob}
                  title="Cancel job"
                  aria-label="Cancel job"
                  className="p-1 rounded bg-red-600 hover:bg-red-500 text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className={`h-1.5 rounded-full overflow-hidden mb-1.5 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-300"
                  style={{ width: `${jobProgressPercent(job)}%` }}
                />
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <p className={`text-[11px] truncate flex-1 min-w-0 ${muted}`} title={job.message}>{job.message}</p>
                <span className={`text-[11px] font-medium tabular-nums shrink-0 ${muted}`}>
                  {jobProgressPercent(job)}% · {job.current}/{job.total || '?'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className={`w-full max-w-2xl rounded-xl border p-5 ${card}`}>
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className={`text-base font-bold flex items-center gap-2 min-w-0 ${text}`}>
                  <Loader2 className={`w-4 h-4 shrink-0 ${jobPaused ? '' : 'animate-spin'}`} />
                  <span className="truncate">{jobTypeLabel(job.type)}</span>
                </h3>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs ${muted}`}>
                    Step {job.current} of {job.total || '?'}
                  </span>
                  {/* Sends the job to the corner dock. The sweep is unaffected — this
                      is what lets an operator keep working through a long pass. */}
                  <button
                    type="button"
                    onClick={() => setIsMinimized(true)}
                    title="Minimize"
                    aria-label="Minimize job progress"
                    className={`p-1 rounded border ${card} ${text}`}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className={`h-2 rounded-full overflow-hidden mb-2 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-300"
                  style={{ width: `${jobProgressPercent(job)}%` }}
                />
              </div>
              <p className={`text-sm mb-4 ${muted}`}>{job.message}</p>

              <div className={`rounded-lg border p-3 mb-4 h-48 overflow-y-auto font-mono text-[11px] ${isDarkMode ? 'bg-gray-950 border-gray-800 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                {jobLog.length === 0 ? <span>Waiting for the first step…</span> : jobLog.map((line, index) => <div key={index}>{line}</div>)}
              </div>

              <div className="flex items-center justify-end gap-2">
                {/* Watching is a property of this screen, not of the job. The work runs
                    server-side either way; only Cancel stops it. */}
                <button onClick={() => setIsMinimized(true)} className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}>
                  Minimize
                </button>
                {jobPaused ? (
                  <button onClick={startWatching} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium">
                    Watch
                  </button>
                ) : (
                  <button onClick={stopWatching} className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}>
                    Stop watching
                  </button>
                )}
                <button onClick={cancelJob} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium">
                  Cancel job
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* Permanent deletion confirmation */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-lg rounded-xl border p-5 ${card}`}>
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h3 className={`text-base font-bold ${text}`}>Permanently unprovision {selected.size} ONU(s)?</h3>
                <p className={`text-sm mt-1 ${muted}`}>
                  This removes the ONU from the OLT. It cannot be undone from this tool — the ONU must be re-provisioned
                  in SmartOLT. Your selection is what runs: billing and RADIUS state is still checked and recorded against
                  each deletion, but it no longer stops one. Check the Safety Notes column before confirming.
                </p>
              </div>
            </div>

            {tab === 'mac_alignment' && (
              <div className="mb-4 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-500">
                Deleting from this tab removes ONUs that are currently MAC-matched to a live RADIUS session. Billing and
                session state is evaluated and recorded against each deletion, but it will not stop one — the selection
                is what runs. Confirm from the Inactive ONU tab instead unless you intend exactly this.
              </div>
            )}

            <label className={`block text-xs font-medium mb-1.5 ${muted}`}>
              Type <span className="font-mono font-bold">{DELETE_CONFIRMATION}</span> to confirm
            </label>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={DELETE_CONFIRMATION}
              className={`w-full px-3 py-2 rounded-lg border text-sm font-mono mb-4 ${input}`}
            />

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setDeleteModalOpen(false); setDeleteConfirm(''); }} className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}>
                Cancel
              </button>
              <button
                onClick={() => {
                  setDeleteModalOpen(false);
                  startJob('delete', {
                    external_ids: Array.from(selected),
                    offline_days: offlineDays,
                    confirmation: deleteConfirm,
                  });
                  setDeleteConfirm('');
                }}
                disabled={deleteConfirm !== DELETE_CONFIRMATION}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Permanently delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo confirmation */}
      {undoTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-md rounded-xl border p-5 ${card}`}>
            <h3 className={`text-base font-bold mb-2 ${text}`}>Reverse this operation?</h3>
            <p className={`text-sm mb-3 ${muted}`}>{undoTarget.message}</p>

            <div className={`rounded-lg border p-3 mb-4 text-xs font-mono ${isDarkMode ? 'bg-gray-950 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`mb-1 ${muted}`}>Restoring:</div>
              <pre className={`whitespace-pre-wrap break-all ${text}`}>{JSON.stringify(undoTarget.previous_state, null, 2)}</pre>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setUndoTarget(null)} className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}>
                Cancel
              </button>
              <button
                onClick={confirmUndo}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium flex items-center gap-2"
              >
                <Undo2 className="w-4 h-4" /> Reverse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartOltTool;
