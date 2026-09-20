import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ChevronDown, ChevronUp, Download, HardDrive, History, Loader2,
  Network, PauseCircle, RefreshCw, Router, Trash2, Undo2, UserCog, XCircle
} from 'lucide-react';
import { useDataGrid, type DataGridColumn } from '../hooks/useDataGrid';
import { useToolTheme } from '../hooks/useToolTheme';
import { useStatusSlices } from '../hooks/useStatusSlices';
import { useViewOptions } from '../hooks/useViewOptions';
import { SelectAllHeaderCell, SelectionBar } from '../components/DataGridControls';
import { ToolShell, ToolToolbar, ToolDataTable, type SidebarSlice, type ToolNotice } from '../components/tools';
import TableFunnelFilter, {
  applyFunnelFilters,
  deriveOptionsByKey,
  type FilterValues,
  type FunnelColumn,
} from '../filter/TableFunnelFilter';
import type { SliceDefinition } from '../services/statusSliceService';
import type { GroupableColumn } from '../services/viewOptionsService';
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
    // Inventory is read-only as a table, but it is also the only place that lists
    // every provisioned ONU, which makes it where an operator goes after a modem
    // swap. The one action offered here is that swap.
    { key: 'actions', label: 'Actions', locked: true },
  ],
  mac_alignment: [
    { key: 'select', label: '', locked: true },
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
    { key: 'select', label: '', locked: true },
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
    { key: 'select', label: '', locked: true },
    { key: 'sn', label: 'Serial / Account', value: (row) => [row.sn, row.account_no, row.customer_name].filter(Boolean).join(' ') },
    { key: 'address', label: 'Address', value: (row) => (row.address_changed ? row.new_address : row.old_address) },
    { key: 'contact', label: 'Contact', value: (row) => (row.contact_changed ? row.new_contact : row.old_contact) },
    { key: 'coords', label: 'Coordinates', value: (row) => (row.coords_changed ? row.new_latitude : row.old_latitude) },
    { key: 'vlan', label: 'VLAN', value: (row) => row.olt_vlan },
  ],
  cleanup: [
    { key: 'select', label: '', locked: true },
    { key: 'sn', label: 'Serial', value: (row) => row.sn },
    { key: 'name', label: 'Name', value: (row) => row.name },
    { key: 'zone', label: 'Zone / OLT', value: (row) => [row.zone_name, row.olt_name].filter(Boolean).join(' / ') },
    { key: 'status', label: 'Status', value: (row) => row.status },
    { key: 'days_offline', label: 'Days Offline', value: (row) => (row.days_offline === null || row.days_offline === undefined ? null : Number(row.days_offline)) },
    { key: 'mac_address', label: 'MAC Address', value: (row) => row.mac_address },
    // Shown by default. Most guards are advice the operator may act against, but the
    // pullout guard is a hard gate - an ONU with no Done pullout Service Order cannot
    // be selected or deleted - so the reason a row is held back has to be on screen,
    // not one toggle away.
    { key: 'safety', label: 'Reasons / Blockers', value: (row) => (row.eligible ? '' : (row.reasons ?? []).join(' - ')) },
  ],
  logs: [],
};

/** What the sidebar's "All" row is called on each tab. */
const TAB_ALL_LABEL: Record<TabId, string> = {
  inventory: 'ONUs',
  mac_alignment: 'Matches',
  sn_alignment: 'Matches',
  profile: 'Profiles',
  cleanup: 'Candidates',
  logs: 'Operations',
};

/**
 * The status slices each tab opens with.
 *
 * These replace the dropdown narrowing bar the tool used to carry above the table. The
 * cuts are the same ones - MAC discovered or pending, named or not, which alignment
 * verdict, which kind of pending profile change - but they now live where every other
 * SYNC list screen keeps them, and the operator can reorder, recolor or hide any of
 * them for their own account.
 *
 * Keyed per tab because the six tables share no vocabulary: an "Aligned" ONU and a
 * "Fill" subscriber are answers to different questions.
 */
const TAB_SLICES: Record<TabId, SliceDefinition[]> = {
  inventory: [
    { id: 'online', label: 'Online', color: '#10b981' },
    { id: 'offline', label: 'Not Online', color: '#64748b' },
    { id: 'name_not_set', label: 'Name Not Set', color: '#f59e0b' },
    { id: 'named', label: 'Named', color: '#3b82f6' },
    { id: 'mac_cached', label: 'Bridge MAC Discovered', color: '#06b6d4' },
    { id: 'mac_pending', label: 'Pending MAC Discovery', color: '#f97316' },
  ],
  mac_alignment: [
    { id: 'rename_needed', label: 'Rename Needed', color: '#f59e0b' },
    { id: 'aligned', label: 'Already Aligned', color: '#10b981' },
    { id: 'unmatched', label: 'Unmatched', color: '#a855f7' },
    { id: 'no_mac', label: 'Awaiting MAC Discovery', color: '#6b7280' },
  ],
  sn_alignment: [
    { id: 'sn_missing', label: 'Fill (No SN Recorded)', color: '#f59e0b' },
    { id: 'sn_mismatch', label: 'Replace (SN Differs)', color: '#f97316' },
    { id: 'sn_aligned', label: 'Already Aligned', color: '#10b981' },
    { id: 'sn_no_subscriber', label: 'No Billing Record', color: '#ef4444' },
    { id: 'sn_unmatched', label: 'Unmatched', color: '#a855f7' },
    { id: 'sn_no_mac', label: 'Awaiting MAC Discovery', color: '#6b7280' },
  ],
  profile: [
    { id: 'address', label: 'Address Change', color: '#3b82f6' },
    { id: 'contact', label: 'Contact Change', color: '#06b6d4' },
    { id: 'coords', label: 'Coordinate Change', color: '#8b5cf6' },
    { id: 'vlan', label: 'VLAN Drift', color: '#f59e0b' },
  ],
  cleanup: [
    { id: 'mac_cached', label: 'Bridge MAC Known', color: '#06b6d4' },
    { id: 'mac_pending', label: 'Never Crawled', color: '#6b7280' },
    { id: 'blocked', label: 'Safety Objection', color: '#f59e0b' },
    { id: 'clear', label: 'No Objection', color: '#10b981' },
    { id: 'pullout_pending', label: 'No Done Pullout', color: '#ef4444' },
  ],
  logs: [],
};

/**
 * Does a row belong to a slice?
 *
 * One predicate per tab rather than per slice, because on every tab the answer is a
 * single switch over the row's own state. Anything unrecognised falls through to true,
 * so a slice added ahead of its predicate shows everything rather than nothing.
 */
const sliceMatches = (tab: TabId, row: any, sliceId: string): boolean => {
  if (sliceId === 'all') return true;

  switch (tab) {
    case 'inventory': {
      const notSet = !String(row.name || '').trim() || String(row.name).trim().toLowerCase() === 'not set';
      switch (sliceId) {
        case 'online': return String(row.status).toLowerCase() === 'online';
        case 'offline': return String(row.status).toLowerCase() !== 'online';
        case 'name_not_set': return notSet;
        case 'named': return !notSet;
        case 'mac_cached': return !!row.mac_address;
        case 'mac_pending': return !row.mac_address;
        default: return true;
      }
    }

    case 'profile':
      switch (sliceId) {
        case 'address': return !!row.address_changed;
        case 'contact': return !!row.contact_changed;
        case 'coords': return !!row.coords_changed;
        case 'vlan': return !!row.vlan_drift;
        default: return true;
      }

    case 'cleanup':
      switch (sliceId) {
        case 'mac_cached': return !!row.mac_address;
        case 'mac_pending': return !row.mac_address;
        // Advisory, not a gate: cleanup runs on the operator's selection and an
        // objection is recorded with the deletion rather than preventing it. This
        // only lets them look at one group at a time.
        case 'blocked': return !row.eligible;
        case 'clear': return !!row.eligible;
        // The exception to the above. No Done pullout Service Order is a hard block,
        // enforced by the delete job, so these rows cannot be selected at all.
        case 'pullout_pending': return row.pullout_cleared !== true;
        default: return true;
      }

    case 'mac_alignment':
    case 'sn_alignment':
      return row.state === sliceId;

    default:
      return true;
  }
};

/** Columns the funnel panel narrows on, per tab. */
const TAB_FUNNEL_COLUMNS: Record<TabId, FunnelColumn[]> = {
  inventory: [
    { key: 'name', label: 'Smart OLT Name', dataType: 'varchar' },
    { key: 'sn', label: 'Serial', dataType: 'varchar' },
    { key: 'status', label: 'Status', dataType: 'checklist' },
    { key: 'mac_address', label: 'MAC Address', dataType: 'varchar' },
    { key: 'olt_name', label: 'OLT', dataType: 'checklist' },
    { key: 'zone_name', label: 'Zone', dataType: 'checklist' },
    { key: 'days_offline', label: 'Days Offline', dataType: 'int' },
  ],
  mac_alignment: [
    { key: 'radius_username', label: 'RADIUS Username', dataType: 'varchar' },
    { key: 'calling_station_id', label: 'Calling-Station-Id', dataType: 'varchar' },
    { key: 'current_name', label: 'Current SmartOLT Name', dataType: 'varchar' },
    { key: 'target_name', label: 'Target Name', dataType: 'varchar' },
    { key: 'sn', label: 'Serial', dataType: 'varchar' },
    { key: 'server_label', label: 'RADIUS Server', dataType: 'checklist' },
    { key: 'status', label: 'ONU Status', dataType: 'checklist' },
  ],
  sn_alignment: [
    { key: 'sn', label: 'SmartOLT Serial', dataType: 'varchar' },
    { key: 'billing_sn', label: 'Billing SN', dataType: 'varchar' },
    { key: 'account_no', label: 'Account No', dataType: 'varchar' },
    { key: 'customer_name', label: 'Customer', dataType: 'varchar' },
    { key: 'radius_username', label: 'RADIUS Username', dataType: 'varchar' },
    { key: 'server_label', label: 'RADIUS Server', dataType: 'checklist' },
    { key: 'status', label: 'ONU Status', dataType: 'checklist' },
  ],
  profile: [
    { key: 'sn', label: 'Serial', dataType: 'varchar' },
    { key: 'account_no', label: 'Account No', dataType: 'varchar' },
    { key: 'customer_name', label: 'Customer', dataType: 'varchar' },
    { key: 'olt_vlan', label: 'OLT VLAN', dataType: 'checklist' },
    { key: 'billing_vlan', label: 'Billing VLAN', dataType: 'checklist' },
  ],
  cleanup: [
    { key: 'sn', label: 'Serial', dataType: 'varchar' },
    { key: 'name', label: 'Name', dataType: 'varchar' },
    { key: 'zone_name', label: 'Zone', dataType: 'checklist' },
    { key: 'olt_name', label: 'OLT', dataType: 'checklist' },
    { key: 'status', label: 'Status', dataType: 'checklist' },
    { key: 'days_offline', label: 'Days Offline', dataType: 'int' },
    { key: 'mac_address', label: 'MAC Address', dataType: 'varchar' },
  ],
  logs: [],
};

/**
 * Columns each tab can be grouped, sorted and coloured by.
 *
 * Per tab for the same reason the slices are: the six tables share no vocabulary, and
 * offering "Billing SN" as a group level on the inventory tab would produce a tree
 * over a column that does not exist there.
 *
 * Deliberately narrower than the table's columns. Grouping is only useful over a value
 * with few enough distinct entries to read as a tree, so a serial and a MAC address are
 * not offered — the OLT, the zone and the verdict are.
 */
const TAB_GROUPABLE: Record<TabId, Array<GroupableColumn<any>>> = {
  inventory: [
    { key: 'status', label: 'Status', value: (row) => row.status },
    { key: 'olt_name', label: 'OLT', value: (row) => row.olt_name },
    { key: 'zone_name', label: 'Zone', value: (row) => row.zone_name },
    { key: 'board', label: 'Board', value: (row) => row.board },
    { key: 'port', label: 'Port', value: (row) => row.port },
    { key: 'odb_name', label: 'ODB', value: (row) => row.odb_name },
    { key: 'mac_known', label: 'Bridge MAC', value: (row) => (row.mac_address ? 'Discovered' : 'Pending discovery') },
  ],
  mac_alignment: [
    { key: 'state', label: 'Verdict', value: (row) => MAC_STATE_BADGES[row.state as MacAlignState]?.label ?? row.state },
    { key: 'server_label', label: 'RADIUS Server', value: (row) => row.server_label },
    { key: 'status', label: 'ONU Status', value: (row) => row.status },
  ],
  sn_alignment: [
    { key: 'state', label: 'Verdict', value: (row) => SN_STATE_BADGES[row.state as SnAlignState]?.label ?? row.state },
    { key: 'server_label', label: 'RADIUS Server', value: (row) => row.server_label },
    { key: 'status', label: 'ONU Status', value: (row) => row.status },
    { key: 'customer_name', label: 'Customer', value: (row) => row.customer_name },
  ],
  profile: [
    { key: 'olt_vlan', label: 'OLT VLAN', value: (row) => row.olt_vlan },
    { key: 'billing_vlan', label: 'Billing VLAN', value: (row) => row.billing_vlan },
    { key: 'vlan_drift', label: 'VLAN Drift', value: (row) => (row.vlan_drift ? 'Drifted' : 'Matches') },
    { key: 'customer_name', label: 'Customer', value: (row) => row.customer_name },
  ],
  cleanup: [
    { key: 'status', label: 'Status', value: (row) => row.status },
    { key: 'zone_name', label: 'Zone', value: (row) => row.zone_name },
    { key: 'olt_name', label: 'OLT', value: (row) => row.olt_name },
    { key: 'safety', label: 'Safety', value: (row) => (row.eligible ? 'No objection' : 'Objection recorded') },
    { key: 'pullout', label: 'Pullout', value: (row) => (row.pullout_cleared === true ? 'Done' : 'Not done') },
    { key: 'mac_known', label: 'Bridge MAC', value: (row) => (row.mac_address ? 'Known' : 'Never crawled') },
  ],
  logs: [],
};

/** One SN-alignment queue item, built the same way by every batch trigger. */
const snItem = (row: any) => ({
  external_id: row.external_id,
  technical_detail_id: row.technical_detail_id,
  new_sn: row.sn,
});

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
 * Cleanup is not gated on `eligible`. That flag is a safety opinion about a real
 * candidate, not a statement that there is nothing to do, and this tool lets the
 * operator act against it: the objection is recorded with the deletion instead of
 * preventing it.
 *
 * The one exception is the pullout guard. An ONU with no Done pullout Service Order
 * for its serial or account is refused by the delete job whatever the operator
 * selected, so it is not offered for selection - a row that can only ever come back
 * "blocked" should not look deletable. The reason shows in the Reasons / Blockers
 * column.
 */
const isRowSelectable = (tab: TabId) => (row: any) => {
  if (tab === 'inventory') return false;
  if (tab === 'cleanup') return row.pullout_cleared === true;
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
  const { isDarkMode, colorPalette, isMobile } = useToolTheme(isDarkModeProp);
  const accent = colorPalette?.primary || '#7c3aed';

  const [tab, setTab] = useState<TabId>('inventory');

  /** The sidebar selection, and the funnel panel, both scoped to the active tab. */
  const [slice, setSlice] = useState('all');
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [funnelFilters, setFunnelFilters] = useState<FilterValues>({});
  const [showMetrics, setShowMetrics] = useState(true);

  // Replace SN. Held here rather than inside the modal so a mis-typed serial survives
  // a re-render, and so the row it belongs to cannot drift out from under the dialog.
  const [replaceTarget, setReplaceTarget] = useState<any | null>(null);
  const [replaceSn, setReplaceSn] = useState('');
  const [replaceWriteBilling, setReplaceWriteBilling] = useState(true);
  const [replacing, setReplacing] = useState(false);

  const sliceDefinitions = useMemo(() => TAB_SLICES[tab], [tab]);
  const { slices, visibleSlices, save: saveSlices, reset: resetSlices } = useStatusSlices(
    `smartolt.${tab}`,
    sliceDefinitions
  );
  const [state, setState] = useState<SmartOltState | null>(null);
  const [macAlignment, setMacAlignment] = useState<MacAlignmentPreview | null>(null);
  const [snAlignment, setSnAlignment] = useState<SnAlignmentPreview | null>(null);
  const [profile, setProfile] = useState<ProfilePreview | null>(null);
  const [cleanup, setCleanup] = useState<CleanupPreview | null>(null);
  const [logs, setLogs] = useState<SmartOltLog[]>([]);

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<ToolNotice | null>(null);

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
  /**
   * A bridge-MAC crawl queued behind the RADIUS status sync.
   *
   * "Sync RADIUS & discover MACs" is one button but two jobs, and only one job may
   * hold the tool's single slot at a time. Rather than fire both and have the second
   * refused, the crawl is parked here and started when the first finishes. A ref, not
   * state: it is read inside the poll callback, where a state value would be the one
   * captured by the render that scheduled it.
   */
  const pendingMacScan = useRef<{ rescan: boolean } | null>(null);

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

        // The second half of "Sync RADIUS & discover MACs". Only chained off a
        // completed status sync: an aborted or failed one means the operator stopped
        // the sweep or it broke, and neither is a reason to start spending the
        // per-ONU quota the crawl costs. Cleared either way so it can never fire twice.
        const queuedScan = pendingMacScan.current;
        pendingMacScan.current = null;

        if (queuedScan !== null && result.job.type === 'radius_scan' && result.job.status === 'completed') {
          appendJobLog('Status sync finished — starting bridge MAC discovery.');
          await loadState(true);
          await startJobRef.current?.('optical_scan', { rescan: queuedScan.rescan });
          return;
        }

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

  /**
   * `startJob`, reachable from `pollJob`.
   *
   * The two are mutually recursive - a finished status sync starts the MAC crawl, and
   * every started job installs a poll - and `startJob` is declared after `pollJob`.
   * Routing one direction through a ref keeps both callbacks stable instead of
   * rebuilding the poll on every render.
   */
  const startJobRef = useRef<((type: JobType, options?: Record<string, any>) => Promise<void>) | null>(null);

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

  useEffect(() => {
    startJobRef.current = startJob;
  }, [startJob]);

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
  const selectable = useMemo(() => isRowSelectable(tab), [tab]);

  /**
   * Dynamic grouping, sorting and per-value colours, namespaced per tab.
   *
   * Built over the whole tab rather than the narrowed view, so a group count says how
   * many ONUs sit under that value — not how many survived the search box.
   */
  const groupableColumns = useMemo(() => TAB_GROUPABLE[tab], [tab]);
  const grouping = useViewOptions(`smartolt.${tab}`, groupableColumns, activeRows);

  const funnelColumns = useMemo(() => TAB_FUNNEL_COLUMNS[tab], [tab]);
  const funnelOptions = useMemo(
    () => deriveOptionsByKey(activeRows, funnelColumns),
    [activeRows, funnelColumns]
  );

  /** The sidebar selection narrows first, then the funnel panel; the grid does the rest. */
  const sliceRows = useMemo(() => {
    // Grouped, the sidebar selection is a path into the tree and it replaces the slice
    // narrowing entirely — the two are competing answers to the same question.
    let result = grouping.isGrouped
      ? grouping.filterByGroup(activeRows, slice)
      : slice === 'all'
        ? activeRows
        : activeRows.filter((row) => sliceMatches(tab, row, slice));

    if (Object.keys(funnelFilters).length > 0) {
      result = applyFunnelFilters(result, funnelFilters);
    }

    return result;
  }, [activeRows, tab, slice, funnelFilters, grouping]);

  /** Slice counts come from the whole tab, not the narrowed view — a count that moved
      with the filter would make the sidebar useless for deciding where to look next. */
  const sidebarSlices: SidebarSlice[] = useMemo(
    () =>
      visibleSlices.map((definition) => ({
        ...definition,
        count: activeRows.filter((row) => sliceMatches(tab, row, definition.id)).length,
      })),
    [visibleSlices, activeRows, tab]
  );

  const grid = useDataGrid<any>({
    rows: sliceRows,
    columns: gridColumns,
    rowKey: onuRowKey,
    isSelectable: selectable,
    pageSize: PAGE_SIZE,
    // One namespace per tab — the four tables share no columns, so they must not
    // share a stored layout either.
    storageKey: `smartolt_tool.columns.${tab}`,
  });

  const { selected } = grid;
  const { clearSelection: clearGridSelection, setPage: setGridPage } = grid;

  /**
   * Adopt the configured sort once this tab's preferences have loaded.
   *
   * Applied to the grid rather than pre-sorting the rows, so a header click still wins
   * for the rest of the session — the saved order is a starting point, not a lock.
   */
  const sortSignature = JSON.stringify(grouping.sortRules);
  useEffect(() => {
    if (!grouping.loaded || grouping.sortRules.length === 0) return;
    grid.setSort(grouping.sortRules);
    // sortSignature stands in for the rules array, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouping.loaded, sortSignature]);

  /**
   * Changing the grouping invalidates the selection.
   *
   * A node path from the previous hierarchy names levels that no longer exist, so it
   * would silently match nothing and the table would render empty.
   */
  const groupSignature = grouping.options.groupBy.join('|');
  useEffect(() => {
    setSlice('all');
  }, [groupSignature]);

  // Switching tab swaps the dataset wholesale: ids from the previous tab must not carry
  // a selection over, and page 3 of the old table means nothing in the new one.
  useEffect(() => {
    clearGridSelection();
    setGridPage(1);
    // A slice id from the previous tab means nothing on this one, and a funnel filter
    // keyed on a column that no longer exists would silently empty the table.
    setSlice('all');
    setFunnelFilters({});
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

  /**
   * Sync RADIUS, then discover the bridge MACs.
   *
   * Two jobs, one operator intention: read who is authenticating, then find the MAC
   * that binds a session to an ONU. Only one job may hold the slot at a time, so this
   * starts the status sync and hands the crawl off to the completion path rather than
   * firing both and having the second refused.
   *
   * `rescan` re-reads every ONU instead of only the ones never crawled. It is the
   * expensive choice - one throttled call per ONU across the whole estate - so it is
   * behind a shift-click rather than on the button itself.
   */
  const startReconcileSweep = useCallback(
    async (rescan: boolean) => {
      pendingMacScan.current = { rescan };
      await startJob('radius_scan');
    },
    [startJob]
  );

  /**
   * Apply a serial replacement, then put the screen back in step with it.
   *
   * The inventory is re-read rather than patched: the ONU's serial is what the MAC and
   * SN alignment passes match on, so a stale copy here would have the next batch write
   * the old serial straight back into billing.
   */
  const confirmReplaceSn = useCallback(async () => {
    if (!replaceTarget) return;

    const target = replaceTarget;
    const serial = replaceSn.trim();

    setReplacing(true);
    try {
      const result = await smartOltReconciliationService.replaceSn(
        target.external_id,
        serial,
        replaceWriteBilling ? target.technical_detail_id ?? null : null
      );

      setNotice({
        tone: result.success ? (result.skipped ? 'info' : 'success') : 'error',
        text: result.message,
      });

      if (result.success) {
        setReplaceTarget(null);
        setReplaceSn('');
        await loadState(true);
        if (tab !== 'inventory') await loadTabData(tab);
      }
    } finally {
      setReplacing(false);
    }
  }, [replaceTarget, replaceSn, replaceWriteBilling, loadState, loadTabData, tab]);

  const openReplaceSn = useCallback((row: any) => {
    setReplaceTarget(row);
    setReplaceSn('');
    setReplaceWriteBilling(true);
  }, []);

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
   * The select-all header, on the tabs that have a checkbox column.
   *
   * Inventory is read-only and declares no `select` column at all, so nothing here
   * fires for it.
   */
  const renderHeaderCell = (column: DataGridColumn<any>) =>
    column.key === 'select' ? (
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
    ) : null;

  /**
   * One table cell, chosen by column key within the active tab.
   *
   * Keys are namespaced by tab in `TAB_COLUMNS`, and a few (`sn`, `name`, `status`) are
   * deliberately shared where the four previews render them identically.
   */
  const renderCell = (columnKey: string, row: any): React.ReactNode => {
    // ---- shared across tabs ----
    if (columnKey === 'select') {
      const id = onuRowKey(row);
      return (
        <td className="px-3 py-2.5">
          {/* Disabled state comes from the same predicate the header's select-all uses.
              It was once hardcoded to `!row.eligible`, which the two could - and did -
              disagree about: after cleanup stopped gating on eligibility, Select All
              took every inactive ONU while the individual boxes stayed greyed out, so a
              row could be selected in bulk but not on its own. */}
          <input
            type="checkbox"
            disabled={!selectable(row)}
            checked={grid.selected.has(id)}
            onChange={(event) => grid.toggleRow(id, event.target.checked)}
            className="rounded disabled:opacity-30"
          />
        </td>
      );
    }

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
        case 'actions':
          return (
            <td className="px-3 py-2.5 text-right">
              <button
                onClick={() => openReplaceSn(row)}
                disabled={jobRunning || !state?.configured}
                title="The modem behind this ONU was swapped — point the provisioning record at the new serial"
                className={`px-2 py-1 rounded border text-xs font-medium disabled:opacity-40 ${card} ${text}`}
              >
                Replace SN
              </button>
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
            <td className="px-3 py-2.5">
              <div className="flex items-center justify-end gap-1">
                {row.eligible ? (
                  <button
                    onClick={() => startJob('sn_alignment', { items: [snItem(row)] })}
                    disabled={jobRunning}
                    title={`Write "${row.sn}" into this subscriber's router/modem SN`}
                    className="px-2 py-1 rounded border text-xs font-medium disabled:opacity-40"
                    style={{ borderColor: `${accent}66`, color: accent }}
                  >
                    {row.state === 'sn_mismatch' ? 'Adopt SN' : 'Write SN'}
                  </button>
                ) : (
                  <span className={`text-xs ${muted}`} title={row.reason}>—</span>
                )}

                {/* The other direction. `Write SN` copies the OLT's serial into
                    billing; this changes which device the OLT is provisioning, which
                    is what actually happened when a technician swapped the modem. */}
                <button
                  onClick={() => openReplaceSn(row)}
                  disabled={jobRunning || !state?.configured}
                  title="The modem behind this ONU was swapped — point SmartOLT at the new serial"
                  className={`px-2 py-1 rounded border text-xs font-medium disabled:opacity-40 ${card} ${muted}`}
                >
                  Replace SN
                </button>
              </div>
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
    <ToolShell
      title="SmartOLT Tool"
      isDarkMode={isDarkMode}
      colorPalette={colorPalette}
      isMobile={isMobile}
      allLabel={`All ${TAB_ALL_LABEL[tab]}`}
      allCount={tab === 'logs' ? logs.length : activeRows.length}
      slices={sidebarSlices}
      selectedSliceId={slice}
      onSelectSlice={setSlice}
      configurableSlices={slices}
      sliceDefinitions={sliceDefinitions}
      onSaveSlices={saveSlices}
      onResetSlices={resetSlices}
      groupableColumns={groupableColumns}
      groupTree={grouping.tree}
      viewOptions={grouping.options}
      onSaveViewOptions={grouping.save}
      onResetViewOptions={grouping.reset}
      distinctValues={grouping.distinctValues}
      colorFor={grouping.colorFor}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      sidebarHeader={
        <div className={`px-2 py-2 border-b space-y-1 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === id ? 'text-white' : `${text} ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`
              }`}
              style={tab === id ? { backgroundColor: accent } : undefined}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate text-left">{label}</span>
            </button>
          ))}
        </div>
      }
      toolbar={
        <ToolToolbar
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          searchQuery={grid.search}
          onSearch={grid.setSearch}
          searchPlaceholder="Search by serial, name, account number or zone..."
          onOpenFilter={() => setFunnelOpen(true)}
          activeFilterCount={Object.keys(funnelFilters).length}
          columns={grid.columns}
          hiddenKeys={grid.hiddenKeys}
          onToggleColumn={grid.toggleColumn}
          onResetColumns={grid.resetColumns}
          onExport={() => grid.toCsv(`smartolt_${tab}_${new Date().toISOString().slice(0, 10)}`)}
          exportDisabled={tab === 'logs' || grid.filteredCount === 0}
          onRefresh={() => (tab === 'inventory' ? loadState(true) : rematch(tab))}
          refreshing={loading}
          refreshTitle={
            tab === 'inventory'
              ? 'Re-read the cached inventory and metrics'
              : 'Recompute this view against the live RADIUS sessions and current billing records'
          }
        >
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => startJob('smartolt_sync')}
              disabled={jobRunning || !state?.configured}
              title="Download the ONU inventory and VLAN assignments from SmartOLT"
              className="px-3 py-2 rounded-lg text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
              style={{ backgroundColor: accent }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Sync Inventory</span>
            </button>

            {/* Sync RADIUS and discover MACs. One button, because they are one job to
                an operator: read who is authenticating, then find the bridge MAC that
                binds a session to an ONU. Shift-click forces a full re-crawl of every
                ONU rather than only the ones never read. */}
            <button
              onClick={(event) => startReconcileSweep(event.shiftKey)}
              disabled={jobRunning || !state?.configured}
              title="Sync ONU statuses from RADIUS, then discover bridge MACs. Shift-click to re-read every ONU."
              className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 ${card} ${text}`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Sync RADIUS &amp; MACs</span>
            </button>

            <button
              onClick={() => smartOltReconciliationService.exportCsv(exportDataset)}
              disabled={loading}
              title="Export the full server-side dataset for this tab"
              className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 ${card} ${text}`}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Export All</span>
            </button>
          </div>
        </ToolToolbar>
      }
      banner={
        <>
          {/* Rate-limit pause banner — the job is parked, not broken, and resumes itself */}
          {jobRateLimited && job && (
            <div className="mx-4 mt-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-500">
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
                </div>
              </div>
            </div>
          )}

          {/* Estate metrics. A dash rather than a zero means the pass behind that figure
              has not run yet — open its tab, or wait for the nightly automation.
              Collapsible: fifteen cards is the right amount of context when an operator
              arrives and pure noise once they are working a table. */}
          {state && (
            <div className="px-4 pt-3">
              <button
                onClick={() => setShowMetrics((open) => !open)}
                className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide mb-2 ${muted} hover:opacity-80`}
              >
                {showMetrics ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Estate metrics
              </button>
              <div
                className={`grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-8 gap-2 ${showMetrics ? '' : 'hidden'}`}
              >
                {metricCards.map(({ key, label, caption, value, tone }) => (
                  <div key={key} className={`rounded-lg border px-2.5 py-2 ${card}`} title={caption}>
                    <div className={`text-[9px] font-semibold tracking-wide uppercase truncate ${muted}`}>{label}</div>
                    <div
                      className={`text-lg font-bold leading-tight ${
                        value === null || value === undefined ? muted : tone || text
                      }`}
                    >
                      {formatMetric(value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MAC alignment summary — and any device that did not answer */}
          {tab === 'mac_alignment' && macAlignment && (
            <div className="px-4 pt-3 space-y-2">
              <div className={`px-4 py-3 rounded-lg border text-sm ${card} ${muted}`}>
                Matched <strong className={text}>{macAlignment.summary.matched}</strong> of{' '}
                <strong className={text}>{macAlignment.summary.total}</strong> ONU(s) against{' '}
                <strong className={text}>{macAlignment.summary.sessions}</strong> live RADIUS session(s) —{' '}
                <span className="text-amber-500">{macAlignment.summary.rename_needed} need renaming</span>,{' '}
                <span className="text-emerald-500">{macAlignment.summary.aligned} already aligned</span>,{' '}
                {macAlignment.summary.unmatched} unmatched, {macAlignment.summary.no_mac} awaiting MAC discovery. The
                target name is the matched RADIUS username exactly.
              </div>

              {macAlignment.errors.length > 0 && (
                <div className="px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-500 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Some RADIUS devices did not answer, so this match is incomplete — an ONU shown as unmatched may
                    simply belong to a device that was unreachable. {macAlignment.errors.join(' · ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* SN alignment summary — and any device that did not answer */}
          {tab === 'sn_alignment' && snAlignment && (
            <div className="px-4 pt-3 space-y-2">
              <div className={`px-4 py-3 rounded-lg border text-sm ${card} ${muted}`}>
                Matched <strong className={text}>{snAlignment.summary.matched}</strong> of{' '}
                <strong className={text}>{snAlignment.summary.total}</strong> ONU(s) against{' '}
                <strong className={text}>{snAlignment.summary.sessions}</strong> live RADIUS session(s) —{' '}
                <span className="text-amber-500">{snAlignment.summary.missing} missing an SN</span>,{' '}
                <span className="text-orange-500">{snAlignment.summary.mismatch} recorded differently</span>,{' '}
                <span className="text-emerald-500">{snAlignment.summary.aligned} already aligned</span>,{' '}
                {snAlignment.summary.no_subscriber} with no billing record, {snAlignment.summary.unmatched} unmatched,{' '}
                {snAlignment.summary.no_mac} awaiting MAC discovery. Applying writes SmartOLT&rsquo;s serial into the
                subscriber&rsquo;s <strong className={text}>router/modem SN</strong>; nothing is ever pushed back to
                SmartOLT.
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
                    Some RADIUS devices did not answer, so this match is incomplete — an ONU shown as unmatched may
                    simply belong to a device that was unreachable. {snAlignment.errors.join(' · ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* VLAN advisory on the profile tab */}
          {tab === 'profile' && profile && (
            <div className="mx-4 mt-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-500 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {profile.vlan_note}
                {profile.summary.vlan_drift > 0 &&
                  ` ${profile.summary.vlan_drift} ONU(s) currently show a VLAN difference.`}
              </span>
            </div>
          )}

          {/* Per-tab action row */}
          {tab !== 'logs' && tab !== 'inventory' && (
            <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
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
                <>
                  {/* `Align All Matched` deliberately ignores the checkbox selection and
                      takes every eligible row — including ones on pages the operator has
                      not scrolled to — which is the whole point of "All". */}
                  <button
                    onClick={() => {
                      const items = (macAlignment?.rows ?? [])
                        .filter((row) => row.eligible)
                        .map((row) => ({ external_id: row.external_id, new_name: row.target_name }));

                      if (items.length === 0) {
                        setNotice({ tone: 'info', text: 'Every matched ONU already carries its RADIUS username.' });
                        return;
                      }
                      startJob('rename', { items });
                    }}
                    disabled={jobRunning}
                    title="Rename every matched ONU to its subscriber's RADIUS username, across all pages"
                    className="px-3 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50"
                    style={{ backgroundColor: accent }}
                  >
                    Align All Matched ({(macAlignment?.rows ?? []).filter((r) => r.eligible).length})
                  </button>

                  <button
                    onClick={() => {
                      const items = (macAlignment?.rows ?? [])
                        .filter((row) => row.eligible && selected.has(row.external_id))
                        .map((row) => ({ external_id: row.external_id, new_name: row.target_name }));

                      if (items.length === 0) {
                        setNotice({
                          tone: 'info',
                          text: 'Select at least one ONU whose name differs from its RADIUS username.',
                        });
                        return;
                      }
                      startJob('rename', { items });
                    }}
                    disabled={jobRunning}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium disabled:opacity-50 ${card} ${text}`}
                  >
                    Align Selected ({selected.size})
                  </button>

                  <button
                    onClick={() => {
                      if (selected.size === 0) {
                        setNotice({ tone: 'info', text: 'Select at least one ONU to unprovision.' });
                        return;
                      }
                      // Same confirmation gate the cleanup tab uses — permanent removal
                      // must never be one click away.
                      setDeleteConfirm('');
                      setDeleteModalOpen(true);
                    }}
                    disabled={jobRunning}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium disabled:opacity-50 ${card} ${muted}`}
                  >
                    Unprovision Selected ({selected.size})
                  </button>
                </>
              )}

              {tab === 'sn_alignment' && (
                <>
                  {/* `Fill Missing` is offered separately from `Write All` on purpose:
                      filling blank columns is safe and is what most operators want, while
                      replacing serials somebody already recorded deserves its own decision. */}
                  <button
                    onClick={() => {
                      const items = (snAlignment?.rows ?? [])
                        .filter((row) => row.eligible && row.state === 'sn_missing')
                        .map(snItem);

                      if (items.length === 0) {
                        setNotice({
                          tone: 'info',
                          text: 'Every matched subscriber already has a router/modem SN recorded.',
                        });
                        return;
                      }
                      startJob('sn_alignment', { items });
                    }}
                    disabled={jobRunning}
                    title="Write the ONU serial into every matched subscriber whose router/modem SN is blank"
                    className="px-3 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50"
                    style={{ backgroundColor: accent }}
                  >
                    Fill Missing Only ({(snAlignment?.rows ?? []).filter((r) => r.state === 'sn_missing').length})
                  </button>

                  <button
                    onClick={() => {
                      const items = (snAlignment?.rows ?? []).filter((row) => row.eligible).map(snItem);

                      if (items.length === 0) {
                        setNotice({
                          tone: 'info',
                          text: 'Nothing to write — every matched subscriber already carries its ONU serial.',
                        });
                        return;
                      }
                      startJob('sn_alignment', { items });
                    }}
                    disabled={jobRunning}
                    title="Write the ONU serial into every write-eligible subscriber, including ones that already hold a different serial"
                    className={`px-3 py-2 rounded-lg border text-xs font-medium disabled:opacity-50 ${card} ${text}`}
                  >
                    Write All Eligible ({(snAlignment?.rows ?? []).filter((r) => r.eligible).length})
                  </button>

                  <button
                    onClick={() => {
                      const items = (snAlignment?.rows ?? [])
                        .filter((row) => row.eligible && selected.has(row.external_id))
                        .map(snItem);

                      if (items.length === 0) {
                        setNotice({
                          tone: 'info',
                          text: 'Select at least one subscriber whose recorded SN differs from the ONU.',
                        });
                        return;
                      }
                      startJob('sn_alignment', { items });
                    }}
                    disabled={jobRunning}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium disabled:opacity-50 ${card} ${text}`}
                  >
                    Write Selected ({selected.size})
                  </button>
                </>
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
                  className="px-3 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50"
                  style={{ backgroundColor: accent }}
                >
                  Push {selected.size > 0 ? `${selected.size} ` : ''}selected
                </button>
              )}

              {tab === 'cleanup' && (
                <button
                  onClick={() => {
                    if (selected.size === 0) {
                      setNotice({ tone: 'info', text: 'Select at least one ONU.' });
                      return;
                    }
                    setDeleteConfirm('');
                    setDeleteModalOpen(true);
                  }}
                  disabled={jobRunning}
                  className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Decommission {selected.size > 0 ? selected.size : ''}
                </button>
              )}
            </div>
          )}

          {/* Selection summary — the batch triggers themselves stay on the action row */}
          {tab !== 'inventory' && tab !== 'logs' && grid.selectedCount > 0 && (
            <div className="px-4 pt-3">
              <SelectionBar
                isDarkMode={isDarkMode}
                selectedCount={grid.selectedCount}
                selectableFilteredCount={grid.selectableFilteredCount}
                isAllFilteredSelected={grid.isAllFilteredSelected}
                onSelectAllFiltered={grid.selectAllFiltered}
                onClearSelection={grid.clearSelection}
              />
            </div>
          )}
        </>
      }
    >
      {tab === 'logs' ? (
        <div className="flex-1 overflow-auto">
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
              {loading && (
                <tr>
                  <td colSpan={7} className={`px-4 py-10 text-center ${muted}`}>
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={7} className={`px-4 py-10 text-center ${muted}`}>
                    No operation has been recorded yet.
                  </td>
                </tr>
              )}
              {!loading &&
                logs.map((entry) => (
                  <tr key={entry.log_id} className={rowHover}>
                    <td className={`px-3 py-2.5 text-xs whitespace-nowrap ${muted}`}>
                      {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-xs ${text}`}>{entry.operator}</td>
                    <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>{entry.action}</td>
                    <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>{entry.external_id ?? '—'}</td>
                    <td className={`px-3 py-2.5 text-xs ${muted} max-w-md`}>
                      <div className="truncate" title={entry.message}>
                        {entry.message}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {entry.reversed ? (
                        <span className="text-[11px] px-2 py-0.5 rounded border bg-gray-500/15 text-gray-400 border-gray-500/30">
                          Reversed
                        </span>
                      ) : entry.reversible ? (
                        <span className="text-[11px] px-2 py-0.5 rounded border bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
                          Applied
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded border bg-amber-500/15 text-amber-500 border-amber-500/30">
                          Final
                        </span>
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
        </div>
      ) : (
        <ToolDataTable
          grid={grid}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          renderCell={(row, column) => renderCell(column.key, row)}
          renderHeaderCell={renderHeaderCell}
          rowKey={onuRowKey}
          loading={loading}
          emptyMessage={emptyMessage}
          storageKey={`smartolt_tool.widths.${tab}`}
        />
      )}

      <TableFunnelFilter
        isOpen={funnelOpen}
        onClose={() => setFunnelOpen(false)}
        onApplyFilters={(filters) => {
          setFunnelFilters(filters);
          setFunnelOpen(false);
        }}
        currentFilters={funnelFilters}
        columns={funnelColumns}
        title="SmartOLT Filters"
        subtitle={TABS.find((entry) => entry.id === tab)?.label ?? 'Narrow by column'}
        storageKey={`smartolt_tool.funnel.${tab}`}
        optionsByKey={funnelOptions}
      />

      {/* Stepwise job progress — full modal, or docked to the corner when minimized.
          Both branches read the same job state and the same poll; minimizing only
          drops the backdrop and the console, never the work. */}
      {job && (job.status === 'running' || jobPaused) && (
        isMinimized ? (
          <div className="fixed bottom-5 right-5 z-[950] w-80 max-w-[calc(100vw-2.5rem)]">
            <div className={`rounded-xl border shadow-2xl p-3 ${card}`}>
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className={`w-4 h-4 shrink-0 ${jobPaused ? '' : 'animate-spin'}`} />
                <span className={`text-xs font-bold truncate flex-1 min-w-0 ${text}`} title={jobTypeLabel(job.type)}>
                  {jobTypeLabel(job.type)}
                </span>
                <button
                  onClick={() => setIsMinimized(false)}
                  title="Expand"
                  className={`p-1 rounded shrink-0 ${muted} hover:opacity-70`}
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={cancelJob}
                  title="Abort this job"
                  className="p-1 rounded shrink-0 text-red-500 hover:opacity-70"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className={`h-1.5 rounded-full overflow-hidden mb-1.5 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                <div
                  className="h-full transition-all duration-300"
                  style={{ width: `${jobProgressPercent(job)}%`, backgroundColor: accent }}
                />
              </div>

              <div className={`text-[11px] flex items-center justify-between ${muted}`}>
                <span className="truncate" title={job.message}>
                  {job.message}
                </span>
                <span className="shrink-0 ml-2 font-mono">
                  {job.current}/{job.total || '?'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-[950] flex items-center justify-center bg-black/60 p-4">
            <div className={`w-full max-w-lg rounded-xl border p-5 ${card}`}>
              <div className="flex items-center gap-3 mb-4">
                <Loader2 className={`w-5 h-5 ${jobPaused ? '' : 'animate-spin'}`} style={{ color: accent }} />
                <h3 className={`text-base font-bold flex-1 ${text}`}>{jobTypeLabel(job.type)}</h3>
                <button
                  onClick={() => setIsMinimized(true)}
                  title="Keep it running and get back to the tables"
                  className={`p-1.5 rounded ${muted} hover:opacity-70`}
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              <div className={`h-2 rounded-full overflow-hidden mb-2 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                <div
                  className="h-full transition-all duration-300"
                  style={{ width: `${jobProgressPercent(job)}%`, backgroundColor: accent }}
                />
              </div>

              <div className={`text-xs mb-3 flex items-center justify-between ${muted}`}>
                <span>{job.message}</span>
                <span className="font-mono">
                  {job.current}/{job.total || '?'}
                </span>
              </div>

              <div
                className={`rounded-lg border p-2 h-40 overflow-y-auto text-[11px] font-mono space-y-0.5 ${
                  isDarkMode ? 'bg-gray-950 border-gray-800' : 'bg-gray-50 border-gray-200'
                }`}
              >
                {jobLog.map((line, index) => (
                  <div key={index} className={muted}>
                    {line}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 mt-4">
                <button onClick={() => setIsMinimized(true)} className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}>
                  Run in background
                </button>
                {jobPaused ? (
                  <button
                    onClick={startWatching}
                    className="px-4 py-2 rounded-lg text-white text-sm font-medium"
                    style={{ backgroundColor: accent }}
                  >
                    Watch again
                  </button>
                ) : (
                  <button onClick={stopWatching} className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}>
                    Stop watching
                  </button>
                )}
                <button
                  onClick={cancelJob}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium"
                >
                  Abort
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* Replace SN confirmation */}
      {replaceTarget && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-md rounded-xl border p-5 ${card}`}>
            <h3 className={`text-base font-bold mb-2 flex items-center gap-2 ${text}`}>
              <HardDrive className="w-4 h-4" style={{ color: accent }} /> Replace this ONU&rsquo;s serial?
            </h3>

            <p className={`text-sm mb-3 ${muted}`}>
              Points the SmartOLT provisioning record at a different physical device. The ONU keeps its slot, zone,
              VLAN, speed profile and name — only the serial that answers on it changes. Use this after a technician has
              swapped the modem.
            </p>

            <div
              className={`rounded-lg border p-3 mb-3 text-xs space-y-1 ${
                isDarkMode ? 'bg-gray-950 border-gray-800' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex justify-between gap-3">
                <span className={muted}>ONU</span>
                <span className={`font-mono ${text}`}>{replaceTarget.external_id}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className={muted}>Name</span>
                <span className={text}>{replaceTarget.name || 'not set'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className={muted}>Current serial</span>
                <span className={`font-mono ${text}`}>{replaceTarget.sn || '—'}</span>
              </div>
              {replaceTarget.account_no && (
                <div className="flex justify-between gap-3">
                  <span className={muted}>Account</span>
                  <span className={`font-mono ${text}`}>{replaceTarget.account_no}</span>
                </div>
              )}
            </div>

            <label className={`block text-xs mb-1 ${muted}`}>Replacement serial</label>
            <input
              value={replaceSn}
              onChange={(e) => setReplaceSn(e.target.value.trim().toUpperCase())}
              placeholder="e.g. HWTC1A2B3C4D"
              autoFocus
              maxLength={64}
              className={`w-full px-3 py-2 rounded-lg border text-sm font-mono mb-3 ${input}`}
            />

            {replaceTarget.technical_detail_id ? (
              <label className={`flex items-start gap-2 text-xs mb-4 ${muted}`}>
                <input
                  type="checkbox"
                  checked={replaceWriteBilling}
                  onChange={(e) => setReplaceWriteBilling(e.target.checked)}
                  className="rounded mt-0.5"
                />
                <span>
                  Also record it as this subscriber&rsquo;s router/modem SN. The OLT is changed first; if that is
                  refused nothing is written to billing.
                </span>
              </label>
            ) : (
              <div className={`text-xs mb-4 ${muted}`}>
                No subscriber is matched to this ONU, so only SmartOLT is changed. Reconcile billing afterwards from the
                Router/Modem SN tab.
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setReplaceTarget(null);
                  setReplaceSn('');
                }}
                disabled={replacing}
                className={`px-4 py-2 rounded-lg border text-sm disabled:opacity-50 ${card} ${text}`}
              >
                Cancel
              </button>
              <button
                onClick={confirmReplaceSn}
                disabled={replacing || replaceSn.trim().length < 4 || replaceSn.trim() === replaceTarget.sn}
                title={
                  replaceSn.trim() === replaceTarget.sn
                    ? 'That is the serial this ONU already carries.'
                    : 'Apply the replacement'
                }
                className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: accent }}
              >
                {replacing ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
                Replace serial
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent deletion */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-md rounded-xl border p-5 ${card}`}>
            <h3 className="text-base font-bold mb-2 text-red-500 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Permanently unprovision {selected.size} ONU(s)?
            </h3>
            <p className={`text-sm mb-3 ${muted}`}>
              This removes the ONU from SmartOLT. It cannot be undone from this tool — the ONU has to be
              re-provisioned by hand. Type <strong className={text}>{DELETE_CONFIRMATION}</strong> to confirm.
            </p>
            <p className={`text-xs mb-3 ${muted}`}>
              Only ONUs with a pullout Service Order marked Done can be removed. Any ONU that no longer has one
              when the job reaches it is skipped and counted as blocked.
            </p>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={DELETE_CONFIRMATION}
              className={`w-full px-3 py-2 rounded-lg border text-sm mb-4 ${input}`}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setDeleteModalOpen(false);
                  setDeleteConfirm('');
                }}
                className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}
              >
                Cancel
              </button>
              <button
                disabled={deleteConfirm !== DELETE_CONFIRMATION}
                onClick={() => {
                  setDeleteModalOpen(false);
                  startJob('delete', {
                    external_ids: Array.from(selected),
                    confirmation: deleteConfirm,
                    offline_days: offlineDays,
                  });
                  setDeleteConfirm('');
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-40"
              >
                Unprovision
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo confirmation */}
      {undoTarget && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-md rounded-xl border p-5 ${card}`}>
            <h3 className={`text-base font-bold mb-2 ${text}`}>Reverse this operation?</h3>
            <p className={`text-sm mb-3 ${muted}`}>{undoTarget.message}</p>
            <div
              className={`rounded-lg border p-3 mb-4 text-xs font-mono ${
                isDarkMode ? 'bg-gray-950 border-gray-800' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className={`mb-1 ${muted}`}>Restoring:</div>
              <pre className={`whitespace-pre-wrap break-all ${text}`}>
                {JSON.stringify(undoTarget.previous_state, null, 2)}
              </pre>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setUndoTarget(null)} className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}>
                Cancel
              </button>
              <button
                onClick={confirmUndo}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2"
                style={{ backgroundColor: accent }}
              >
                <Undo2 className="w-4 h-4" /> Reverse
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
};

export default SmartOltTool;
