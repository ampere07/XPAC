import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, Copy, Edit2, History, KeyRound, Loader2, RefreshCw,
  ShieldAlert, Trash2, Undo2, X, Zap,
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
import {
  radiusReconciliationService,
  type BulkOperation,
  type BulkUserPayload,
  type DuplicateAccount,
  type OperationLog,
  type ReconciliationData,
  type ReconciliationRow,
  type ReconciliationState,
  type RadiusServer,
} from '../services/radiusReconciliationService';
import type { SliceDefinition } from '../services/statusSliceService';
import type { GroupableColumn } from '../services/viewOptionsService';

interface MikrotikRadiusToolProps {
  isDarkMode?: boolean;
}

/**
 * Mikrotik User Manager accounts reconciled against billing, across every RADIUS device.
 *
 * Rebuilt onto the standard SYNC list frame. Every action is unchanged — push a group
 * to the device, adopt the device's group into billing, save a password, restrict,
 * disconnect, delete a rogue, resolve a cross-server duplicate, undo any of it.
 *
 * The one behavioural change is on the server side, and it is the reason half of this
 * screen used to be full: `group_mismatch` is now judged on the first word of the plan
 * label — the same reduction Job Order account creation applies when it picks the
 * group to create an account in — so "SWIFT" on the device against "SWIFT 1000" in
 * billing is no longer reported as a discrepancy.
 */

const MODULE_KEY = 'mikrotik_radius';

/**
 * One slice per backend state, rather than the five grouped tabs this screen used to
 * carry.
 *
 * The grouping was a guess about which findings belong together, and it was wrong for
 * half the people using it — a NOC operator wants `restricted` and `disabled_mismatch`
 * apart, a collections clerk wants them together. Per-state slices plus per-user
 * ordering and hiding lets each of them build the screen they actually work.
 */
const SLICE_DEFINITIONS: SliceDefinition[] = [
  { id: 'group_mismatch', label: 'Mismatched Groups', color: '#f59e0b' },
  { id: 'password_mismatch', label: 'Password Mismatch', color: '#eab308' },
  { id: 'format_mismatch', label: 'Format Drift', color: '#ec4899' },
  { id: 'duplicate_radius', label: 'Duplicates', color: '#ef4444' },
  { id: 'orphan_radius', label: 'Rogue in MikroTik', color: '#a855f7' },
  { id: 'missing_radius', label: 'Missing in MikroTik', color: '#3b82f6' },
  { id: 'disabled_mismatch', label: 'Disabled', color: '#f97316' },
  { id: 'restricted', label: 'Restricted', color: '#64748b' },
  { id: 'synced', label: 'Fully Synced', color: '#10b981' },
];

const STATE_BADGES: Record<ReconciliationState, { label: string; classes: string }> = {
  duplicate_radius: { label: 'Duplicate', classes: 'bg-red-500/15 text-red-500 border-red-500/30' },
  password_mismatch: { label: 'Password', classes: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  group_mismatch: { label: 'Group', classes: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  disabled_mismatch: { label: 'Disabled', classes: 'bg-orange-500/15 text-orange-500 border-orange-500/30' },
  orphan_radius: { label: 'Orphan', classes: 'bg-purple-500/15 text-purple-500 border-purple-500/30' },
  missing_radius: { label: 'Missing', classes: 'bg-blue-500/15 text-blue-500 border-blue-500/30' },
  restricted: { label: 'Restricted', classes: 'bg-gray-500/15 text-gray-500 border-gray-500/30' },
  synced: { label: 'In Sync', classes: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
};

/** Rows rendered at once. The dataset can run to thousands; the table pages rather than mounting them all. */
const PAGE_SIZE = 100;

/** A row's stable key — a username can legitimately appear once per server. */
const rowKey = (row: ReconciliationRow) => `${row.username}::${row.server_id ?? 'none'}`;

/** Does this row's RADIUS password differ from the one billing holds? */
const passwordDiffers = (row: ReconciliationRow): boolean =>
  !!row.rad_password && row.rad_password !== row.db_password;

/**
 * The audit table's columns.
 *
 * `value` is what the column is searched and sorted on; the cell markup is built by
 * `renderCell` in the component, which keeps the badges and sub-lines this screen
 * already renders. Module scope so the identities stay stable across renders and the
 * grid's memos are not invalidated on every pass.
 *
 * `server_label` and `customer_name` are off by default because both already ride as a
 * sub-line inside a neighbouring cell; enabling either promotes it to a real column and
 * the sub-line stands down, so the same fact is never shown twice.
 */
const AUDIT_COLUMNS: Array<DataGridColumn<ReconciliationRow>> = [
  { key: 'select', label: '', locked: true },
  { key: 'state', label: 'State', value: (row) => STATE_BADGES[row.state]?.label ?? row.state },
  { key: 'account_no', label: 'Account No', value: (row) => row.account_no },
  { key: 'customer_name', label: 'Customer', value: (row) => row.customer_name, defaultHidden: true },
  { key: 'username', label: 'Username', value: (row) => row.username },
  { key: 'rad_group', label: 'MikroTik RADIUS Group', value: (row) => row.rad_group },
  { key: 'server_label', label: 'RADIUS Server', value: (row) => row.server_label, defaultHidden: true },
  { key: 'bill_group', label: 'Billing Group / Plan', value: (row) => row.bill_group },
  { key: 'rad_password', label: 'PPPoE Password (RADIUS)', value: (row) => row.rad_password },
  { key: 'session', label: 'Session Status', value: (row) => (row.online ? row.session_ip || 'Online' : 'Offline') },
  { key: 'actions', label: 'Actions', locked: true },
];

/**
 * Funnel columns.
 *
 * `session_status` and `password_state` are derived, not stored — they are the two
 * narrowings the old dropdown bar offered that no column expresses on its own, and
 * losing them when the toolbar was standardised would have been a regression.
 */
const FUNNEL_COLUMNS: FunnelColumn[] = [
  { key: 'username', label: 'Username', dataType: 'varchar' },
  { key: 'account_no', label: 'Account No', dataType: 'varchar' },
  { key: 'customer_name', label: 'Customer', dataType: 'varchar' },
  { key: 'rad_group', label: 'MikroTik Group', dataType: 'checklist' },
  { key: 'bill_group', label: 'Billing Plan', dataType: 'checklist' },
  { key: 'server_label', label: 'RADIUS Server', dataType: 'checklist' },
  {
    key: 'session_status',
    label: 'Session',
    dataType: 'checklist',
    options: [
      { label: 'Online', value: 'Online' },
      { label: 'Offline', value: 'Offline' },
    ],
  },
  {
    key: 'password_state',
    label: 'Password',
    dataType: 'checklist',
    options: [
      { label: 'Differs from billing', value: 'Differs from billing' },
      { label: 'Matches billing', value: 'Matches billing' },
    ],
  },
];

/** Resolve a funnel column's value, including the two derived ones. */
const funnelValue = (row: ReconciliationRow, key: string): any => {
  if (key === 'session_status') return row.online ? 'Online' : 'Offline';
  if (key === 'password_state') return passwordDiffers(row) ? 'Differs from billing' : 'Matches billing';
  return (row as any)[key];
};

/**
 * Columns this screen can be grouped, sorted and coloured by.
 *
 * Server and group are the two an operator reaches for first — "show me every
 * mismatched account on RADIUS-2, by plan" is the shape of most of the work here.
 */
const GROUPABLE_COLUMNS: Array<GroupableColumn<ReconciliationRow>> = [
  { key: 'state', label: 'State', value: (row) => STATE_BADGES[row.state]?.label ?? row.state },
  { key: 'server_label', label: 'RADIUS Server', value: (row) => row.server_label },
  { key: 'rad_group', label: 'MikroTik Group', value: (row) => row.rad_group },
  { key: 'bill_group', label: 'Billing Plan', value: (row) => row.bill_group },
  { key: 'session', label: 'Session', value: (row) => (row.online ? 'Online' : 'Offline') },
  { key: 'password_state', label: 'Password', value: (row) => (passwordDiffers(row) ? 'Differs from billing' : 'Matches billing') },
  { key: 'customer_name', label: 'Customer', value: (row) => row.customer_name },
];

const MikrotikRadiusTool: React.FC<MikrotikRadiusToolProps> = ({ isDarkMode: isDarkModeProp }) => {
  const { isDarkMode, colorPalette, isMobile } = useToolTheme(isDarkModeProp);
  const { slices, visibleSlices, save: saveSlices, reset: resetSlices } = useStatusSlices(
    MODULE_KEY,
    SLICE_DEFINITIONS
  );

  const [servers, setServers] = useState<RadiusServer[]>([]);
  const [serverId, setServerId] = useState<string>('all');
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<ToolNotice | null>(null);

  const [view, setView] = useState<'audit' | 'logs'>('audit');
  const [slice, setSlice] = useState<string>('group_mismatch');

  const [funnelOpen, setFunnelOpen] = useState(false);
  const [funnelFilters, setFunnelFilters] = useState<FilterValues>({});

  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [undoTarget, setUndoTarget] = useState<OperationLog | null>(null);

  const [duplicateTarget, setDuplicateTarget] = useState<DuplicateAccount | null>(null);
  const [keepServerId, setKeepServerId] = useState<number | null>(null);

  const [alignTarget, setAlignTarget] = useState<ReconciliationRow | null>(null);
  const [alignedUsernameInput, setAlignedUsernameInput] = useState<string>('');
  const [bulkAlignConfirmOpen, setBulkAlignConfirmOpen] = useState(false);

  // ---- Rows + grid -------------------------------------------------------
  //
  // Declared ahead of the loaders so those can reset the grid's page and selection
  // directly when a fresh dataset lands.

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary;
  const duplicates = data?.duplicates ?? [];

  /**
   * Dynamic grouping, sorting and per-value colours.
   *
   * Built over the whole audit rather than the narrowed view, so a group count says how
   * many accounts sit under that value — not how many survived the search box.
   */
  const grouping = useViewOptions(MODULE_KEY, GROUPABLE_COLUMNS, rows);

  /** The sidebar slice pre-narrows the set; the grid searches, sorts and pages what is left. */
  const sliceRows = useMemo(() => {
    // Grouped, the sidebar selection is a path into the tree and it replaces the state
    // narrowing entirely — the two are competing answers to the same question.
    let result = grouping.isGrouped
      ? grouping.filterByGroup(rows, slice)
      : slice === 'all'
        ? rows
        : slice === 'format_mismatch'
          ? rows.filter((row) => row.is_format_valid === false)
          : rows.filter((row) => row.state === slice);

    if (Object.keys(funnelFilters).length > 0) {
      result = applyFunnelFilters(result, funnelFilters, funnelValue);
    }

    return result;
  }, [rows, slice, funnelFilters, grouping]);

  const funnelOptions = useMemo(() => deriveOptionsByKey(rows, FUNNEL_COLUMNS, funnelValue), [rows]);

  const grid = useDataGrid<ReconciliationRow>({
    rows: sliceRows,
    columns: AUDIT_COLUMNS,
    rowKey,
    pageSize: PAGE_SIZE,
    storageKey: 'mikrotik_radius_tool.columns',
  });

  const { clearSelection: clearGridSelection, setPage: setGridPage } = grid;

  /**
   * Adopt the configured sort once the preferences have loaded.
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


  // ---- Data loading ------------------------------------------------------

  const loadServers = useCallback(async () => {
    try {
      const list = await radiusReconciliationService.getServers();
      setServers(list);
    } catch {
      setNotice({ tone: 'error', text: 'Could not read the configured RADIUS servers.' });
    }
  }, []);

  /**
   * Open on the cached snapshot. No RADIUS device is contacted.
   *
   * This is the whole point of splitting snapshot from sweep: landing on this page, or
   * flipping the server selector, used to reconcile the entire estate before the
   * operator had asked for anything.
   */
  const loadSnapshot = useCallback(
    async (target: string) => {
      setLoading(true);
      try {
        const result = await radiusReconciliationService.getSnapshot(target);
        setData(result);
        clearGridSelection();
        setGridPage(1);
      } catch (error: any) {
        setNotice({ tone: 'error', text: error?.response?.data?.message || 'Could not read the cached snapshot.' });
      } finally {
        setLoading(false);
      }
    },
    [clearGridSelection, setGridPage]
  );

  /** The live sweep. Only ever called from the explicit operator action, never on mount. */
  const loadData = useCallback(
    async (target: string) => {
      setLoading(true);
      setNotice(null);
      try {
        const result = await radiusReconciliationService.getData(target);
        setData(result);
        clearGridSelection();
        setGridPage(1);

        if (result.errors.length > 0) {
          setNotice({ tone: 'error', text: result.errors.join(' · ') });
        }
      } catch (error: any) {
        setNotice({ tone: 'error', text: error?.response?.data?.message || 'The reconciliation sweep failed.' });
      } finally {
        setLoading(false);
      }
    },
    [clearGridSelection, setGridPage]
  );

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      setLogs(await radiusReconciliationService.getLogs(100));
    } catch {
      setNotice({ tone: 'error', text: 'Could not read the operation log.' });
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  // Snapshot only. The heavy multi-router sweep is bound to the Sync & Reconcile Now
  // button and to nothing else.
  useEffect(() => {
    loadSnapshot(serverId);
  }, [serverId, loadSnapshot]);

  useEffect(() => {
    if (view === 'logs') loadLogs();
  }, [view, loadLogs]);

  // ---- Derived -----------------------------------------------------------

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((row) => {
      counts[row.state] = (counts[row.state] ?? 0) + 1;
      if (row.is_format_valid === false) {
        counts['format_mismatch'] = (counts['format_mismatch'] ?? 0) + 1;
      }
    });
    return counts;
  }, [rows]);

  const sidebarSlices: SidebarSlice[] = useMemo(
    () => visibleSlices.map((definition) => ({ ...definition, count: stateCounts[definition.id] ?? 0 })),
    [visibleSlices, stateCounts]
  );

  const { selectedRows, visibleColumns } = grid;

  const alignableSelectedRows = useMemo(() => {
    return selectedRows.filter((r) => !!r.suggested_username && r.suggested_username !== r.username);
  }, [selectedRows]);

  /** Sub-lines stand down when their fact has been promoted to a column of its own. */
  const visibleKeys = useMemo(() => new Set(visibleColumns.map((column) => column.key)), [visibleColumns]);

  // ---- Actions -----------------------------------------------------------

  const runAction = useCallback(
    async (
      key: string,
      action: () => Promise<{ success: boolean; skipped: boolean; message: string }>,
      reload = true
    ) => {
      setBusy(key);
      try {
        const result = await action();
        setNotice({
          tone: result.success ? (result.skipped ? 'info' : 'success') : 'error',
          text: result.message,
        });

        if (result.success && reload) {
          await loadData(serverId);
        }
      } catch (error: any) {
        setNotice({
          tone: 'error',
          text: error?.response?.data?.message || error?.message || 'The action failed.',
        });
      } finally {
        setBusy(null);
      }
    },
    [loadData, serverId]
  );

  const runBulk = useCallback(
    async (operation: BulkOperation) => {
      if (selectedRows.length === 0) return;

      const payload: BulkUserPayload[] = selectedRows.map((row) => ({
        username: row.username,
        server_id: row.server_id,
        rad_id: row.rad_id,
        rad_group: row.rad_group,
        target_group: row.bill_target_group,
        rad_password: row.rad_password,
        suggested_username: row.suggested_username,
      }));

      setBusy(`bulk:${operation}`);
      try {
        const result = await radiusReconciliationService.bulk(operation, payload, serverId);
        setNotice({ tone: result.success ? 'success' : 'error', text: result.message });
        await loadData(serverId);
      } finally {
        setBusy(null);
      }
    },
    [selectedRows, serverId, loadData]
  );

  const confirmUndo = useCallback(async () => {
    if (!undoTarget) return;
    setBusy(`undo:${undoTarget.log_id}`);
    try {
      const result = await radiusReconciliationService.undo(undoTarget.log_id);
      setNotice({ tone: result.success ? (result.skipped ? 'info' : 'success') : 'error', text: result.message });
      setUndoTarget(null);
      await loadLogs();
      if (result.success) await loadData(serverId);
    } finally {
      setBusy(null);
    }
  }, [undoTarget, loadLogs, loadData, serverId]);

  const confirmResolveDuplicate = useCallback(async () => {
    if (!duplicateTarget || keepServerId === null) return;

    const removeIds = duplicateTarget.instances
      .map((instance) => instance.server_id)
      .filter((id) => id !== keepServerId);

    setBusy(`dup:${duplicateTarget.username}`);
    try {
      const messages: string[] = [];
      let failed = false;

      // One call per redundant copy, so a failure on the second server does not hide
      // the fact that the first was already resolved.
      for (const removeId of removeIds) {
        const result = await radiusReconciliationService.resolveDuplicate(
          duplicateTarget.username,
          keepServerId,
          removeId
        );
        messages.push(result.message);
        if (!result.success) failed = true;
      }

      setNotice({ tone: failed ? 'error' : 'success', text: messages.join(' ') });
      setDuplicateTarget(null);
      setKeepServerId(null);
      await loadData(serverId);
    } finally {
      setBusy(null);
    }
  }, [duplicateTarget, keepServerId, loadData, serverId]);

  useEffect(() => {
    if (alignTarget) {
      setAlignedUsernameInput(alignTarget.suggested_username || alignTarget.username);
    } else {
      setAlignedUsernameInput('');
    }
  }, [alignTarget]);

  const handleConfirmAlign = useCallback(async () => {
    if (!alignTarget || !alignedUsernameInput.trim()) return;
    const target = alignTarget;
    const newUsername = alignedUsernameInput.trim();

    await runAction(`Align ${target.username}`, async () => {
      const result = await radiusReconciliationService.alignUsername(target.username, newUsername, target.server_id);
      if (result.success) {
        setAlignTarget(null);
      }
      return result;
    });
  }, [alignTarget, alignedUsernameInput, runAction]);

  // ---- Theme tokens ------------------------------------------------------

  const card = isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200';
  const text = isDarkMode ? 'text-gray-100' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const input = isDarkMode
    ? 'bg-gray-950 border-gray-800 text-gray-100 placeholder-gray-600'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';
  const rowHover = isDarkMode ? 'hover:bg-gray-800/60' : 'hover:bg-gray-50';
  const headRow = isDarkMode ? 'bg-gray-950/60 text-gray-400' : 'bg-gray-50 text-gray-600';

  // ---- Cells -------------------------------------------------------------

  /**
   * One table cell, chosen by column key.
   *
   * Columns are operator-orderable and hideable, so the cells cannot be a fixed
   * sequence of <td>s — each returns its own, and the header order drives the row
   * order. The badge and sub-line composition the screen already used is preserved.
   */
  const renderCell = (row: ReconciliationRow, column: DataGridColumn<ReconciliationRow>): React.ReactNode => {
    const key = rowKey(row);
    const badge = STATE_BADGES[row.state];

    switch (column.key) {
      case 'select':
        return (
          <td className="px-3 py-2.5">
            <input
              type="checkbox"
              checked={grid.selected.has(key)}
              onChange={(event) => grid.toggleRow(key, event.target.checked)}
              className="rounded"
            />
          </td>
        );

      case 'state':
        return (
          <td className="px-3 py-2.5">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${badge.classes}`}
            >
              {badge.label}
            </span>
          </td>
        );

      case 'account_no':
        return (
          <td className={`px-3 py-2.5 text-xs ${muted}`}>
            <span className={text}>{row.account_no ?? '—'}</span>
            {/* Only while Customer is not a column in its own right. */}
            {!visibleKeys.has('customer_name') && row.customer_name && (
              <div className="opacity-70 mt-0.5">{row.customer_name}</div>
            )}
          </td>
        );

      case 'customer_name':
        return <td className={`px-3 py-2.5 text-xs ${text}`}>{row.customer_name ?? '—'}</td>;

      case 'username':
        return (
          <td className="px-3 py-2.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`font-mono text-xs font-medium ${text}`}>{row.username}</span>
              {row.is_format_valid === false && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap bg-pink-500/15 text-pink-500 border-pink-500/30"
                  title={row.format_issue || 'Username does not conform to Job Order format'}
                >
                  Format Drift
                </span>
              )}
            </div>
            {row.is_format_valid === false && row.suggested_username && (
              <div className="text-[10px] text-pink-400/90 mt-0.5 font-mono">
                Suggested: {row.suggested_username}
              </div>
            )}
          </td>
        );

      case 'rad_group':
        return (
          <td className={`px-3 py-2.5 text-xs ${text}`}>
            <div>{row.rad_group ?? '—'}</div>
            {/* Only while RADIUS Server is not a column in its own right. */}
            {!visibleKeys.has('server_label') && (
              <div className={`opacity-70 mt-0.5 ${muted}`}>
                {row.server_label}
                {row.rad_disabled ? ' · disabled' : ''}
              </div>
            )}
          </td>
        );

      case 'server_label':
        return (
          <td className={`px-3 py-2.5 text-xs ${muted}`}>
            {row.server_label}
            {row.rad_disabled ? ' · disabled' : ''}
          </td>
        );

      case 'bill_group':
        return <td className={`px-3 py-2.5 text-xs ${text}`}>{row.bill_group ?? '—'}</td>;

      case 'rad_password':
        return (
          <td className="px-3 py-2.5 text-xs">
            {row.rad_password ? (
              <span
                className={`font-mono ${passwordDiffers(row) ? 'text-amber-500' : text}`}
                title={
                  passwordDiffers(row)
                    ? `Billing holds a different password (${row.db_password})`
                    : 'Matches the billing record'
                }
              >
                {row.rad_password}
              </span>
            ) : (
              <span className={muted}>—</span>
            )}
          </td>
        );

      case 'session':
        return (
          <td className="px-3 py-2.5">
            <span className={`inline-flex items-center gap-1.5 text-xs ${row.online ? 'text-emerald-500' : muted}`}>
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  row.online ? 'bg-emerald-500' : isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                }`}
              />
              {row.online ? row.session_ip || 'Online' : 'Offline'}
            </span>
          </td>
        );

      case 'actions':
        return (
          <td className="px-3 py-2.5">
            <div className="flex items-center justify-end gap-1 flex-wrap">
              {/* Align & Update button — update username in DB */}
              {(row.is_format_valid === false || row.account_no) && (
                <button
                  onClick={() => setAlignTarget(row)}
                  disabled={busy !== null}
                  title="Align PPPoE username on database to match Job Order format standards"
                  className="px-2 py-1 rounded text-[11px] font-medium bg-pink-500/15 text-pink-400 border border-pink-500/30 hover:bg-pink-500/25 disabled:opacity-50 flex items-center gap-1"
                >
                  <Edit2 className="w-3 h-3" />
                  Align & Update
                </button>
              )}

              {/* Save Pass — write the device's password into billing. Offered
                  whenever the two disagree, not only on the password_mismatch state: a
                  higher-priority finding (a duplicate, a restriction) hides that state
                  but does not make the credential drift go away. */}
              {passwordDiffers(row) && (
                <button
                  onClick={() =>
                    runAction(`Save Pass ${row.username}`, () =>
                      radiusReconciliationService.syncPassword(row.username, row.rad_password ?? '')
                    )
                  }
                  disabled={busy !== null}
                  title="Write the RADIUS PPPoE password into technical_details and the account's latest job order"
                  className="px-2 py-1 rounded text-[11px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-50"
                >
                  {busy === `Save Pass ${row.username}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save Pass'}
                </button>
              )}

              {row.state === 'group_mismatch' && (
                <>
                  {/* Push to Mikrotik — billing wins. */}
                  <button
                    onClick={() =>
                      runAction(`Push to Mikrotik ${row.username}`, () =>
                        radiusReconciliationService.syncGroupToMikrotik(
                          row.username,
                          row.bill_target_group ?? '',
                          row.server_id,
                          row.rad_id
                        )
                      )
                    }
                    disabled={busy !== null}
                    title={`Set the device group to "${row.bill_target_group ?? ''}" and re-enable the account`}
                    className="px-2 py-1 rounded text-[11px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25 disabled:opacity-50"
                  >
                    {busy === `Push to Mikrotik ${row.username}` ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      'Push to Mikrotik'
                    )}
                  </button>

                  {/* Retain Mikrotik — the device wins; billing adopts it. */}
                  <button
                    onClick={() =>
                      runAction(`Retain Mikrotik ${row.username}`, () =>
                        radiusReconciliationService.syncGroupToBilling(row.username, row.rad_group ?? '')
                      )
                    }
                    disabled={busy !== null}
                    title="Map the device's group to its full billing plan label and update the customer's plan"
                    className="px-2 py-1 rounded text-[11px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/30 hover:bg-purple-500/25 disabled:opacity-50"
                  >
                    {busy === `Retain Mikrotik ${row.username}` ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      'Retain Mikrotik'
                    )}
                  </button>
                </>
              )}

              {/* Restrict — park in Restricted, disable, and kill the session. */}
              {row.state !== 'missing_radius' && row.state !== 'restricted' && (
                <button
                  onClick={() =>
                    runAction(`Restrict ${row.username}`, () =>
                      radiusReconciliationService.restrict(row.username, row.server_id, row.rad_id)
                    )
                  }
                  disabled={busy !== null}
                  title="Move to the Restricted group, disable the account and terminate any live session"
                  className="px-2 py-1 rounded text-[11px] font-medium bg-gray-500/15 text-gray-400 border border-gray-500/30 hover:bg-gray-500/25 disabled:opacity-50"
                >
                  {busy === `Restrict ${row.username}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Restrict'}
                </button>
              )}

              {row.state === 'duplicate_radius' && (
                <button
                  onClick={() => {
                    const dup = duplicates.find((entry) => entry.username === row.username);
                    if (dup) {
                      setDuplicateTarget(dup);
                      setKeepServerId(dup.instances[0]?.server_id ?? null);
                    }
                  }}
                  className="px-2 py-1 rounded text-[11px] font-medium bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25"
                >
                  Resolve
                </button>
              )}

              {/* Disconnect — kill the session, leave the group alone. */}
              {row.online && (
                <button
                  onClick={() =>
                    runAction(`Disconnect ${row.username}`, () =>
                      radiusReconciliationService.disconnect(row.username, row.server_id)
                    )
                  }
                  disabled={busy !== null}
                  title="Terminate the live session without changing the account's group"
                  className="px-2 py-1 rounded text-[11px] font-medium bg-orange-500/15 text-orange-500 border border-orange-500/30 hover:bg-orange-500/25 disabled:opacity-50"
                >
                  {busy === `Disconnect ${row.username}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Disconnect'}
                </button>
              )}

              {row.state === 'orphan_radius' && row.server_id !== null && (
                <button
                  onClick={() =>
                    runAction(`del:${key}`, () =>
                      radiusReconciliationService.deleteUser(row.username, row.rad_id, row.server_id as number)
                    )
                  }
                  disabled={busy !== null}
                  title="Remove this account from the device"
                  className="px-2 py-1 rounded text-[11px] font-medium bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50"
                >
                  {busy === `del:${key}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                </button>
              )}
            </div>
          </td>
        );

      default:
        return <td className="px-3 py-2.5" />;
    }
  };

  const renderHeaderCell = (column: DataGridColumn<ReconciliationRow>) =>
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

  // ---- Render ------------------------------------------------------------

  return (
    <ToolShell
      title="Mikrotik RADIUS"
      isDarkMode={isDarkMode}
      colorPalette={colorPalette}
      isMobile={isMobile}
      allLabel="All Accounts"
      allCount={summary?.total ?? rows.length}
      slices={sidebarSlices}
      selectedSliceId={slice}
      onSelectSlice={setSlice}
      configurableSlices={slices}
      sliceDefinitions={SLICE_DEFINITIONS}
      onSaveSlices={saveSlices}
      onResetSlices={resetSlices}
      groupableColumns={GROUPABLE_COLUMNS}
      groupTree={grouping.tree}
      viewOptions={grouping.options}
      onSaveViewOptions={grouping.save}
      onResetViewOptions={grouping.reset}
      distinctValues={grouping.distinctValues}
      colorFor={grouping.colorFor}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      sidebarHeader={
        <div className={`px-3 py-2.5 border-b space-y-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          <div className="relative">
            <select
              value={serverId}
              onChange={(event) => setServerId(event.target.value)}
              disabled={loading}
              aria-label="RADIUS server"
              className={`w-full appearance-none pl-3 pr-9 py-2 rounded-lg border text-xs font-medium ${input} disabled:opacity-50`}
            >
              <option value="all">Combined (All Servers)</option>
              {servers.map((server) => (
                <option key={server.id} value={String(server.id)}>
                  {server.label}
                </option>
              ))}
            </select>
            <ChevronDown className={`w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${muted}`} />
          </div>

          <div className={`flex items-center rounded-lg border overflow-hidden ${card}`}>
            {(['audit', 'logs'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setView(tab)}
                className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                  view === tab ? 'text-white' : `${text} hover:opacity-80`
                }`}
                style={view === tab ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : undefined}
              >
                {tab === 'audit' ? <Zap className="w-3.5 h-3.5" /> : <History className="w-3.5 h-3.5" />}
                {tab === 'audit' ? 'Audit' : 'Logs'}
              </button>
            ))}
          </div>
        </div>
      }
      toolbar={
        <ToolToolbar
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          searchQuery={grid.search}
          onSearch={grid.setSearch}
          searchPlaceholder="Search by username, account number, customer, group or server..."
          onOpenFilter={() => setFunnelOpen(true)}
          activeFilterCount={Object.keys(funnelFilters).length}
          columns={grid.columns}
          hiddenKeys={grid.hiddenKeys}
          onToggleColumn={grid.toggleColumn}
          onResetColumns={grid.resetColumns}
          onExport={() => radiusReconciliationService.exportCsv(slice === 'all' ? 'all' : slice, serverId)}
          exportDisabled={loading || !data}
          onRefresh={() => loadData(serverId)}
          refreshing={loading}
          refreshTitle="Contact every targeted RADIUS device and re-audit against billing"
          hasNewData={data?.stale ?? false}
        >
          <button
            onClick={() => loadData(serverId)}
            disabled={loading}
            title="Contact every targeted RADIUS device and re-audit against billing"
            className="flex-shrink-0 px-3 py-2 rounded-lg text-white text-xs font-medium flex items-center gap-2 disabled:opacity-50"
            style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden lg:inline">Sync &amp; Reconcile Now</span>
          </button>
        </ToolToolbar>
      }
      banner={
        <>
          {/* Snapshot advisory — the operator must never mistake a recording for live state */}
          {data?.stale && (
            <div className="mx-4 mt-3 px-4 py-3 rounded-lg border border-blue-500/30 bg-blue-500/10 text-sm text-blue-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1">
                {data.synced_at ? (
                  <>
                    Showing the cached audit from <strong>{new Date(data.synced_at).toLocaleString()}</strong>. No
                    RADIUS device has been contacted since. Press <strong>Sync &amp; Reconcile Now</strong> for live
                    state.
                  </>
                ) : (
                  <>
                    No audit has been run for this target yet. Press <strong>Sync &amp; Reconcile Now</strong> to
                    contact the RADIUS devices and build the worklist.
                  </>
                )}
              </span>
            </div>
          )}

          {/* Cross-RADIUS duplicate banner */}
          {view === 'audit' && duplicates.length > 0 && (
            <div className="mx-4 mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-red-500">
                    {duplicates.length} account{duplicates.length === 1 ? '' : 's'} exist on more than one RADIUS server
                  </h3>
                  <p className={`text-xs mt-1 ${muted}`}>
                    A duplicate authenticates on whichever device answers first, so plan and password changes can
                    silently apply to the wrong copy. Resolve each one by naming the server to keep.
                  </p>

                  <div className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
                    {duplicates.map((dup) => (
                      <div
                        key={dup.username}
                        className={`rounded-lg border p-3 flex flex-col md:flex-row md:items-center gap-3 ${card}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-mono text-sm font-semibold ${text}`}>{dup.username}</span>
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 border border-red-500/30">
                              {dup.server_count} servers
                            </span>
                          </div>
                          <div className={`text-xs mt-1 ${muted}`}>
                            {dup.instances.map((i) => `${i.server_label}${i.online ? ' · online' : ''}`).join('  ·  ')}
                          </div>
                          <ul className="mt-1 space-y-0.5">
                            {dup.discrepancies.map((discrepancy) => (
                              <li key={discrepancy} className="text-xs text-amber-500 flex items-start gap-1.5">
                                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                {discrepancy}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <button
                          onClick={() => {
                            setDuplicateTarget(dup);
                            setKeepServerId(dup.instances[0]?.server_id ?? null);
                          }}
                          className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium flex items-center gap-1.5"
                        >
                          <Copy className="w-3.5 h-3.5" /> Resolve
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'audit' && grid.selectedCount > 0 && (
            <div className="px-4 pt-3">
              <SelectionBar
                isDarkMode={isDarkMode}
                selectedCount={grid.selectedCount}
                selectableFilteredCount={grid.selectableFilteredCount}
                isAllFilteredSelected={grid.isAllFilteredSelected}
                onSelectAllFiltered={grid.selectAllFiltered}
                onClearSelection={grid.clearSelection}
              >
                <button
                  onClick={() => {
                    if (alignableSelectedRows.length === 0) {
                      setNotice({
                        tone: 'info',
                        text: 'None of the selected accounts have an unaligned suggested username.',
                      });
                      return;
                    }
                    setBulkAlignConfirmOpen(true);
                  }}
                  disabled={busy !== null}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 bg-pink-500/15 text-pink-400 border-pink-500/40 hover:bg-pink-500/25 cursor-pointer"
                >
                  {busy === 'bulk:align_username' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Edit2 className="w-3.5 h-3.5" />
                  )}
                  Align &amp; Update ({alignableSelectedRows.length})
                </button>
                {(
                  [
                    { op: 'sync_passwords' as BulkOperation, label: 'Sync Passwords', icon: KeyRound },
                    { op: 'sync_group_mikrotik' as BulkOperation, label: 'Sync Groups → RADIUS', icon: RefreshCw },
                    { op: 'sync_group_billing' as BulkOperation, label: 'Sync Groups → Billing', icon: RefreshCw },
                    { op: 'restrict' as BulkOperation, label: 'Restrict', icon: ShieldAlert },
                    { op: 'disconnect' as BulkOperation, label: 'Disconnect', icon: Zap },
                  ] as const
                ).map(({ op, label, icon: Icon }) => (
                  <button
                    key={op}
                    onClick={() => runBulk(op)}
                    disabled={busy !== null}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 ${card} ${text}`}
                  >
                    {busy === `bulk:${op}` ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Icon className="w-3.5 h-3.5" />
                    )}
                    {label}
                  </button>
                ))}
              </SelectionBar>
            </div>
          )}
        </>
      }
    >
      {view === 'audit' ? (
        <ToolDataTable
          grid={grid}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          renderCell={renderCell}
          renderHeaderCell={renderHeaderCell}
          rowKey={rowKey}
          loading={loading}
          emptyMessage={
            rows.length === 0
              ? 'Press "Sync & Reconcile Now" to audit the RADIUS devices against billing.'
              : 'No account matches this slice.'
          }
          storageKey="mikrotik_radius_tool.widths"
        />
      ) : (
        /* Operation logs & undo */
        <div className="flex-1 overflow-auto">
          <div
            className={`flex items-center justify-between px-4 py-3 border-b sticky top-0 z-10 ${
              isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
            }`}
          >
            <h2 className={`text-sm font-semibold ${text}`}>Operation Logs &amp; Undo</h2>
            <button
              onClick={loadLogs}
              disabled={logsLoading}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 ${card} ${text}`}
            >
              {logsLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Refresh
            </button>
          </div>

          <table className="w-full text-sm">
            <thead className={`text-xs uppercase tracking-wide ${headRow}`}>
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">When</th>
                <th className="px-3 py-2.5 text-left font-semibold">Operator</th>
                <th className="px-3 py-2.5 text-left font-semibold">Action</th>
                <th className="px-3 py-2.5 text-left font-semibold">Target</th>
                <th className="px-3 py-2.5 text-left font-semibold">Server</th>
                <th className="px-3 py-2.5 text-left font-semibold">Change</th>
                <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                <th className="px-3 py-2.5 text-right font-semibold">Undo</th>
              </tr>
            </thead>
            <tbody className={isDarkMode ? 'divide-y divide-gray-800' : 'divide-y divide-gray-100'}>
              {logsLoading && (
                <tr>
                  <td colSpan={8} className={`px-4 py-10 text-center ${muted}`}>
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </td>
                </tr>
              )}
              {!logsLoading && logs.length === 0 && (
                <tr>
                  <td colSpan={8} className={`px-4 py-10 text-center ${muted}`}>
                    No operation has been recorded yet.
                  </td>
                </tr>
              )}
              {!logsLoading &&
                logs.map((entry) => (
                  <tr key={entry.log_id} className={rowHover}>
                    <td className={`px-3 py-2.5 text-xs whitespace-nowrap ${muted}`}>
                      {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-xs ${text}`}>{entry.operator}</td>
                    <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>{entry.action}</td>
                    <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>{entry.username ?? '—'}</td>
                    <td className={`px-3 py-2.5 text-xs ${muted}`}>{entry.server_label ?? '—'}</td>
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
                        disabled={!entry.reversible || entry.reversed || busy !== null}
                        className="px-2 py-1 rounded text-[11px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25 disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1"
                      >
                        <Undo2 className="w-3 h-3" /> Undo
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <TableFunnelFilter
        isOpen={funnelOpen}
        onClose={() => setFunnelOpen(false)}
        onApplyFilters={(filters) => {
          setFunnelFilters(filters);
          setFunnelOpen(false);
        }}
        currentFilters={funnelFilters}
        columns={FUNNEL_COLUMNS}
        title="RADIUS Audit Filters"
        subtitle="Narrow the worklist by column"
        storageKey="mikrotik_radius_tool.funnel"
        optionsByKey={funnelOptions}
      />

      {/* Duplicate resolution modal */}
      {duplicateTarget && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-lg rounded-xl border p-5 ${card}`}>
            <div className="flex items-start gap-3 mb-4">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h3 className={`text-base font-bold ${text}`}>Resolve duplicate account</h3>
                <p className={`text-sm mt-1 ${muted}`}>
                  <span className="font-mono">{duplicateTarget.username}</span> exists on{' '}
                  {duplicateTarget.server_count} servers. Choose the copy to keep — every other copy is deleted and its
                  live session cut.
                </p>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              {duplicateTarget.instances.map((instance) => (
                <label
                  key={instance.server_id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                    keepServerId === instance.server_id
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : isDarkMode
                        ? 'border-gray-800'
                        : 'border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="keep-server"
                    checked={keepServerId === instance.server_id}
                    onChange={() => setKeepServerId(instance.server_id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${text}`}>{instance.server_label}</div>
                    <div className={`text-xs ${muted}`}>
                      Group {instance.group}
                      {instance.disabled ? ' · disabled' : ''}
                      {instance.online ? ' · live session' : ''}
                    </div>
                  </div>
                  {keepServerId === instance.server_id && <CheckCircle2 className="w-4 h-4 text-indigo-500" />}
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setDuplicateTarget(null);
                  setKeepServerId(null);
                }}
                className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}
              >
                Cancel
              </button>
              <button
                onClick={confirmResolveDuplicate}
                disabled={keepServerId === null || busy !== null}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {busy?.startsWith('dup:') && <Loader2 className="w-4 h-4 animate-spin" />}
                Keep selected &amp; delete the rest
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
                disabled={busy !== null}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {busy?.startsWith('undo:') ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                Reverse
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Align PPPoE Username Modal */}
      {alignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            className={`w-full max-w-md rounded-xl border shadow-xl p-5 ${
              isDarkMode ? 'bg-gray-900 border-gray-800 text-gray-100' : 'bg-white border-gray-200 text-gray-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-700/50">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-pink-500/15 text-pink-400 border border-pink-500/30">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Align PPPoE Username</h3>
                  <p className={`text-[11px] ${muted}`}>Update database to match Job Order standards</p>
                </div>
              </div>
              <button
                onClick={() => setAlignTarget(null)}
                className={`p-1 rounded-lg hover:bg-gray-800 ${muted}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <div className={`p-3 rounded-lg border ${isDarkMode ? 'bg-gray-950/60 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className={muted}>Account No:</span>
                    <span className="font-medium ml-1">{alignTarget.account_no ?? '—'}</span>
                  </div>
                  <div>
                    <span className={muted}>Customer:</span>
                    <span className="font-medium ml-1 truncate">{alignTarget.customer_name ?? '—'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className={muted}>Current DB Username:</span>
                    <span className="font-mono font-medium ml-1 text-amber-400">{alignTarget.username}</span>
                  </div>
                  {alignTarget.suggested_username && (
                    <div className="col-span-2">
                      <span className={muted}>Suggested Format:</span>
                      <span className="font-mono font-medium ml-1 text-emerald-400">{alignTarget.suggested_username}</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium">New Aligned Username</label>
                  {alignTarget.suggested_username && (
                    <button
                      type="button"
                      onClick={() => setAlignedUsernameInput(alignTarget.suggested_username ?? '')}
                      className="text-[10px] text-pink-400 hover:underline cursor-pointer"
                    >
                      Use Suggested
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={alignedUsernameInput}
                  onChange={(e) => setAlignedUsernameInput(e.target.value)}
                  placeholder="e.g. lp120np6p2RoseMadeja"
                  className={`w-full px-3 py-2 rounded-lg border font-mono text-xs ${input}`}
                />
                <p className={`text-[10px] mt-1.5 ${muted}`}>
                  Note: This action updates <span className="font-mono">technical_details</span>, associated <span className="font-mono">job_orders</span>, and automatically renames the account on the MikroTik router.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-700/50">
              <button
                type="button"
                onClick={() => setAlignTarget(null)}
                disabled={busy !== null}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${isDarkMode ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-100'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAlign}
                disabled={busy !== null || !alignedUsernameInput.trim() || alignedUsernameInput.trim() === alignTarget.username}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-pink-600 hover:bg-pink-500 text-white disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {busy?.startsWith('Align') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Align &amp; Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Align Confirmation Modal */}
      {bulkAlignConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className={`w-full max-w-md rounded-xl border p-5 shadow-2xl ${card} ${text}`}>
            <div className="flex items-center justify-between pb-3 border-b border-gray-700/50">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-pink-500/20 text-pink-400 flex items-center justify-center">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Bulk Align &amp; Update Usernames</h3>
                  <p className={`text-[11px] ${muted}`}>Update database and sync to MikroTik</p>
                </div>
              </div>
              <button
                onClick={() => setBulkAlignConfirmOpen(false)}
                className={`p-1 rounded-lg hover:bg-gray-800 ${muted}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <p>
                You are about to align <strong>{alignableSelectedRows.length}</strong> selected account(s)
                to their canonical suggested formats.
              </p>
              <div className={`p-3 rounded-lg border max-h-48 overflow-y-auto ${isDarkMode ? 'bg-gray-950/60 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                <div className="space-y-1.5 font-mono text-[11px]">
                  {alignableSelectedRows.map((r) => (
                    <div key={rowKey(r)} className="flex items-center justify-between gap-2 border-b border-gray-800/40 pb-1">
                      <span className="text-amber-400 truncate max-w-[180px]">{r.username}</span>
                      <span className="text-gray-500">→</span>
                      <span className="text-emerald-400 truncate max-w-[180px]">{r.suggested_username}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className={`text-[11px] ${muted}`}>
                This will update <span className="font-mono">technical_details</span>, associated <span className="font-mono">job_orders</span>, and automatically rename the account on the MikroTik User Manager router.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-700/50">
              <button
                type="button"
                onClick={() => setBulkAlignConfirmOpen(false)}
                disabled={busy !== null}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${isDarkMode ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-100'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setBulkAlignConfirmOpen(false);
                  await runBulk('align_username');
                }}
                disabled={busy !== null}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-pink-600 hover:bg-pink-500 text-white disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                Confirm Align &amp; Update
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
};

export default MikrotikRadiusTool;
