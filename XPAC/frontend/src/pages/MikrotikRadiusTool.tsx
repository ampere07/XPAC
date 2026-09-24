import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, Copy, Download, History, KeyRound,
  Loader2, RefreshCw, Router, ShieldAlert, Trash2, Undo2, X, Zap
} from 'lucide-react';
import { useDataGrid, type DataGridColumn, type DataGridFilter } from '../hooks/useDataGrid';
import {
  ColumnMenu,
  GridFilterBar,
  SelectAllHeaderCell,
  SelectionBar,
  SortableHeaderCell,
} from '../components/DataGridControls';
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

interface MikrotikRadiusToolProps {
  isDarkMode?: boolean;
}

/**
 * The five discrepancy views, ordered so the states that need action come first.
 *
 * A tab covers a set of states rather than one, because two backend states can be
 * the same finding to an operator: `restricted` and `disabled_mismatch` are both
 * "service is being withheld", and both belong on the same screen. `duplicate_radius`
 * and `password_mismatch` are not tabs of their own — duplicates get the dedicated
 * banner above the table, and a password mismatch is visible in its own column.
 */
type FilterId = 'mismatched_groups' | 'restricted' | 'rogue' | 'missing' | 'matched' | 'all';

const FILTERS: Array<{ id: FilterId; label: string; states: ReconciliationState[] }> = [
  { id: 'mismatched_groups', label: 'Mismatched Groups', states: ['group_mismatch'] },
  { id: 'restricted', label: 'Restricted / Disconnected', states: ['restricted', 'disabled_mismatch'] },
  { id: 'rogue', label: 'Rogue in MikroTik', states: ['orphan_radius'] },
  { id: 'missing', label: 'Missing in MikroTik', states: ['missing_radius'] },
  { id: 'matched', label: 'Fully Synced', states: ['synced'] },
  { id: 'all', label: 'All Accounts', states: [] },
];

/** States each filter covers, for counting and filtering without re-deriving the map. */
const FILTER_STATES: Record<FilterId, ReconciliationState[]> = FILTERS.reduce(
  (acc, tab) => ({ ...acc, [tab.id]: tab.states }),
  {} as Record<FilterId, ReconciliationState[]>
);

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

/**
 * The audit table's columns.
 *
 * `value` is what the column is searched and sorted on; the cell markup itself is built
 * by `renderCell` in the component, which keeps the badges and sub-lines this screen
 * already renders. Module scope so the identities stay stable across renders and the
 * grid's memos are not invalidated on every pass.
 *
 * `server_label` and `customer_name` are off by default because both already ride as a
 * sub-line inside a neighbouring cell; enabling either promotes it to a real column and
 * the sub-line stands down, so the same fact is never shown twice.
 */
const AUDIT_COLUMNS: Array<DataGridColumn<ReconciliationRow>> = [
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
 * Dropdown narrowing that sits on top of the state tabs above the table. The tabs group
 * states by the action they imply; these cut across that grouping — "everything offline",
 * "everything whose password drifted" — which no single tab expresses.
 */
const AUDIT_FILTERS: Array<DataGridFilter<ReconciliationRow>> = [
  {
    key: 'state',
    label: 'State',
    options: (Object.keys(STATE_BADGES) as ReconciliationState[]).map((state) => ({
      value: state,
      label: STATE_BADGES[state].label,
    })),
    predicate: (row, value) => row.state === value,
  },
  {
    key: 'session',
    label: 'Session',
    options: [
      { value: 'online', label: 'Online' },
      { value: 'offline', label: 'Offline' },
    ],
    predicate: (row, value) => (value === 'online' ? row.online : !row.online),
  },
  {
    key: 'password',
    label: 'Password',
    options: [
      { value: 'mismatch', label: 'Differs from billing' },
      { value: 'match', label: 'Matches billing' },
    ],
    predicate: (row, value) => {
      const differs = !!row.rad_password && row.rad_password !== row.db_password;
      return value === 'mismatch' ? differs : !differs;
    },
  },
];

const MikrotikRadiusTool: React.FC<MikrotikRadiusToolProps> = ({ isDarkMode: isDarkModeProp }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof isDarkModeProp === 'boolean') return isDarkModeProp;
    const theme = localStorage.getItem('theme');
    return theme === 'dark' || theme === null;
  });

  const [servers, setServers] = useState<RadiusServer[]>([]);
  const [serverId, setServerId] = useState<string>('all');
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [view, setView] = useState<'audit' | 'logs'>('audit');
  const [filter, setFilter] = useState<FilterId>('mismatched_groups');


  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [undoTarget, setUndoTarget] = useState<OperationLog | null>(null);

  const [duplicateTarget, setDuplicateTarget] = useState<DuplicateAccount | null>(null);
  const [keepServerId, setKeepServerId] = useState<number | null>(null);

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

  // ---- Rows + grid -------------------------------------------------------
  //
  // Declared ahead of the loaders so those can reset the grid's page and selection
  // directly when a fresh dataset lands.

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary;
  const duplicates = data?.duplicates ?? [];

  /** The state tab pre-narrows the set; the grid searches, sorts and pages what is left. */
  const tabRows = useMemo(() => {
    const states = FILTER_STATES[filter] ?? [];
    return states.length === 0 ? rows : rows.filter((row) => states.includes(row.state));
  }, [rows, filter]);

  const grid = useDataGrid<ReconciliationRow>({
    rows: tabRows,
    columns: AUDIT_COLUMNS,
    rowKey,
    filters: AUDIT_FILTERS,
    pageSize: PAGE_SIZE,
    storageKey: 'mikrotik_radius_tool.columns',
  });

  const { clearSelection: clearGridSelection, setPage: setGridPage } = grid;

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
   * This is the whole point of splitting snapshot from sweep: landing on this page,
   * or flipping the server selector, used to reconcile the entire estate before the
   * operator had asked for anything.
   */
  const loadSnapshot = useCallback(async (target: string) => {
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
  }, [clearGridSelection, setGridPage]);

  /**
   * The live sweep. Only ever called from the explicit operator action, never on mount.
   */
  const loadData = useCallback(async (target: string) => {
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
  }, [clearGridSelection, setGridPage]);

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

  useEffect(() => { loadServers(); }, [loadServers]);
  // Snapshot only. The heavy multi-router sweep is bound to the Sync & Reconcile Now
  // button and to nothing else.
  useEffect(() => { loadSnapshot(serverId); }, [serverId, loadSnapshot]);
  useEffect(() => { if (view === 'logs') loadLogs(); }, [view, loadLogs]);

  // ---- Derived -----------------------------------------------------------

  /** How many rows a tab would show, before the search box narrows them. */
  const filterCount = useCallback(
    (id: FilterId): number => {
      const states = FILTER_STATES[id] ?? [];
      return states.length === 0 ? rows.length : rows.filter((row) => states.includes(row.state)).length;
    },
    [rows]
  );

  const { pagedRows, selectedRows, page, totalPages, visibleColumns } = grid;

  /** Sub-lines stand down when their fact has been promoted to a column of its own. */
  const visibleKeys = useMemo(() => new Set(visibleColumns.map((c) => c.key)), [visibleColumns]);

  // ---- Actions -----------------------------------------------------------

  const runAction = useCallback(
    async (key: string, action: () => Promise<{ success: boolean; skipped: boolean; message: string }>, reload = true) => {
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

      // One call per redundant copy, so a failure on the second server does not
      // hide the fact that the first was already resolved.
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

  // ---- Theme tokens ------------------------------------------------------

  const card = isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200';
  const text = isDarkMode ? 'text-gray-100' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const input = isDarkMode
    ? 'bg-gray-950 border-gray-800 text-gray-100 placeholder-gray-600'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';
  const rowHover = isDarkMode ? 'hover:bg-gray-800/60' : 'hover:bg-gray-50';
  const headRow = isDarkMode ? 'bg-gray-950/60 text-gray-400' : 'bg-gray-50 text-gray-600';

  const metricCards: Array<{ label: string; value: number; tone: string; filter: FilterId }> = summary
    ? [
        { label: 'Total Audited', value: summary.total, tone: 'text-blue-500', filter: 'all' },
        { label: 'Fully Synced', value: summary.synced, tone: 'text-emerald-500', filter: 'matched' },
        { label: 'Mismatched Groups', value: summary.group_mismatch, tone: 'text-amber-600', filter: 'mismatched_groups' },
        { label: 'Restricted / Disconnected', value: summary.restricted + summary.disabled_mismatch, tone: 'text-gray-400', filter: 'restricted' },
        { label: 'Rogue in MikroTik', value: summary.orphan_radius, tone: 'text-purple-500', filter: 'rogue' },
        { label: 'Missing in MikroTik', value: summary.missing_radius, tone: 'text-blue-400', filter: 'missing' },
        { label: 'Password Mismatch', value: summary.password_mismatch, tone: 'text-amber-500', filter: 'all' },
        { label: 'Duplicates', value: summary.duplicate_accounts, tone: 'text-red-500', filter: 'all' },
      ]
    : [];

  /**
   * One table cell, chosen by column key.
   *
   * Columns are operator-orderable and hideable, so the cells can no longer be a fixed
   * sequence of <td>s — each returns its own, and the header order drives the row order.
   * The badge and sub-line composition the screen already used is preserved verbatim.
   */
  const renderCell = (columnKey: string, row: ReconciliationRow): React.ReactNode => {
    const key = rowKey(row);
    const badge = STATE_BADGES[row.state];

    switch (columnKey) {
      case 'state':
        return (
          <td className="px-3 py-2.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${badge.classes}`}>
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
        return <td className={`px-3 py-2.5 font-mono text-xs font-medium ${text}`}>{row.username}</td>;

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
            {row.rad_password
              ? (
                <span
                  className={`font-mono ${row.db_password && row.db_password !== row.rad_password ? 'text-amber-500' : text}`}
                  title={
                    row.db_password && row.db_password !== row.rad_password
                      ? `Billing holds a different password (${row.db_password})`
                      : 'Matches the billing record'
                  }
                >
                  {row.rad_password}
                </span>
              )
              : <span className={muted}>—</span>}
          </td>
        );

      case 'session':
        return (
          <td className="px-3 py-2.5">
            <span className={`inline-flex items-center gap-1.5 text-xs ${row.online ? 'text-emerald-500' : muted}`}>
              <span
                className={`inline-block w-2 h-2 rounded-full ${row.online ? 'bg-emerald-500' : isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}
              />
              {row.online ? (row.session_ip || 'Online') : 'Offline'}
            </span>
          </td>
        );

      case 'actions':
        return (
          <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      {/* Save Pass — write the device's password into billing.
                          Offered whenever the two disagree, not only on the
                          password_mismatch state: a higher-priority finding
                          (a duplicate, a restriction) hides that state but does
                          not make the credential drift go away. */}
                      {row.rad_password && row.rad_password !== row.db_password && (
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
                            {busy === `Push to Mikrotik ${row.username}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Push to Mikrotik'}
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
                            {busy === `Retain Mikrotik ${row.username}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Retain Mikrotik'}
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
                            const dup = duplicates.find((d) => d.username === row.username);
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

  return (
    <div className={`p-4 md:p-6 min-h-full ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Router className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className={`text-xl font-bold ${text}`}>Mikrotik Radius Tool</h1>
            <p className={`text-sm ${muted}`}>
              Reconcile Mikrotik User Manager accounts against billing across every configured RADIUS device.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Server mode selector */}
          <div className="relative">
            <select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              disabled={loading}
              className={`appearance-none pl-3 pr-9 py-2 rounded-lg border text-sm font-medium ${input} disabled:opacity-50`}
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

          <button
            onClick={() => loadData(serverId)}
            disabled={loading}
            title="Contact every targeted RADIUS device and re-audit against billing"
            className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sync &amp; Reconcile Now
          </button>

          <button
            onClick={() => radiusReconciliationService.exportCsv(filter, serverId)}
            disabled={loading || !data}
            className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 disabled:opacity-50 ${card} ${text}`}
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>

        </div>
      </div>

      {/* Snapshot advisory — the operator must never mistake a recording for live state */}
      {data?.stale && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-blue-500/30 bg-blue-500/10 text-sm text-blue-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">
            {data.synced_at
              ? <>Showing the cached audit from <strong>{new Date(data.synced_at).toLocaleString()}</strong>. No RADIUS device has been contacted since. Press <strong>Sync &amp; Reconcile Now</strong> for live state.</>
              : <>No audit has been run for this target yet. Press <strong>Sync &amp; Reconcile Now</strong> to contact the RADIUS devices and build the worklist.</>}
          </span>
        </div>
      )}

      {/* Notice */}
      {notice && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg border text-sm flex items-start justify-between gap-3 ${
            notice.tone === 'success'
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

      {/* Cross-RADIUS duplicate banner */}
      {duplicates.length > 0 && (
        <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-red-500">
                {duplicates.length} account{duplicates.length === 1 ? '' : 's'} exist on more than one RADIUS server
              </h3>
              <p className={`text-xs mt-1 ${muted}`}>
                A duplicate authenticates on whichever device answers first, so plan and password changes can silently
                apply to the wrong copy. Resolve each one by naming the server to keep.
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
                        {dup.discrepancies.map((d) => (
                          <li key={d} className="text-xs text-amber-500 flex items-start gap-1.5">
                            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                            {d}
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

      {/* View switch */}
      <div className="flex items-center gap-2 mb-4">
        {(['audit', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setView(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 transition-colors ${
              view === tab
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : `${card} ${text} hover:border-indigo-500/50`
            }`}
          >
            {tab === 'audit' ? <Zap className="w-4 h-4" /> : <History className="w-4 h-4" />}
            {tab === 'audit' ? 'Reconciliation Audit' : 'Operation Logs & Undo'}
          </button>
        ))}
      </div>

      {view === 'audit' ? (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
            {metricCards.map((metric) => (
              <button
                key={metric.label}
                onClick={() => { setFilter(metric.filter); grid.setPage(1); }}
                className={`rounded-xl border p-3 text-left transition-colors hover:border-indigo-500/50 ${card}`}
              >
                <div className={`text-xs font-medium ${muted}`}>{metric.label}</div>
                <div className={`text-2xl font-bold mt-1 ${metric.tone}`}>{metric.value}</div>
              </button>
            ))}
          </div>

          {/* Filters + search */}
          <div className={`rounded-xl border p-3 mb-4 ${card}`}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {FILTERS.map((tab) => {
                const count = filterCount(tab.id);
                return (
                  <button
                    key={tab.id}
                    onClick={() => { setFilter(tab.id); grid.setPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      filter === tab.id
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : isDarkMode
                        ? 'bg-gray-950 border-gray-800 text-gray-300 hover:border-indigo-500/50'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-indigo-500/50'
                    }`}
                  >
                    {tab.label} <span className="opacity-60">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <GridFilterBar
                isDarkMode={isDarkMode}
                search={grid.search}
                onSearch={grid.setSearch}
                placeholder="Search by username, account number, customer, group or server…"
                filters={AUDIT_FILTERS}
                filterValues={grid.filterValues}
                onFilterChange={grid.setFilterValue}
                hasActiveFilter={grid.hasActiveFilter}
                onClear={grid.clearFilters}
                filteredCount={grid.filteredCount}
                totalRows={grid.totalRows}
              />
              <ColumnMenu
                isDarkMode={isDarkMode}
                columns={grid.columns}
                hiddenKeys={grid.hiddenKeys}
                onToggle={grid.toggleColumn}
                onMove={grid.moveColumn}
                onReset={grid.resetColumns}
              />
            </div>
          </div>

          {/* Bulk bar */}
          <SelectionBar
            isDarkMode={isDarkMode}
            selectedCount={grid.selectedCount}
            selectableFilteredCount={grid.selectableFilteredCount}
            isAllFilteredSelected={grid.isAllFilteredSelected}
            onSelectAllFiltered={grid.selectAllFiltered}
            onClearSelection={grid.clearSelection}
          >
            {([
                { op: 'sync_passwords' as BulkOperation, label: 'Sync Passwords', icon: KeyRound },
                { op: 'sync_group_mikrotik' as BulkOperation, label: 'Sync Groups → RADIUS', icon: RefreshCw },
                { op: 'sync_group_billing' as BulkOperation, label: 'Sync Groups → Billing', icon: RefreshCw },
                { op: 'restrict' as BulkOperation, label: 'Restrict', icon: ShieldAlert },
                { op: 'disconnect' as BulkOperation, label: 'Disconnect', icon: Zap },
              ]).map(({ op, label, icon: Icon }) => (
                <button
                  key={op}
                  onClick={() => runBulk(op)}
                  disabled={busy !== null}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 ${card} ${text} hover:border-indigo-500/50`}
                >
                  {busy === `bulk:${op}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                  {label}
                </button>
              ))}
          </SelectionBar>

          {/* Table */}
          <div className={`rounded-xl border overflow-hidden ${card}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={`text-xs uppercase tracking-wide ${headRow}`}>
                  <tr>
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
                      <td colSpan={visibleColumns.length + 1} className={`px-4 py-12 text-center ${muted}`}>
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                        Contacting {serverId === 'all' ? 'every RADIUS device' : 'the RADIUS device'} and reading billing…
                      </td>
                    </tr>
                  )}

                  {!loading && pagedRows.length === 0 && (
                    <tr>
                      <td colSpan={visibleColumns.length + 1} className={`px-4 py-12 text-center ${muted}`}>
                        {rows.length === 0
                          ? 'Press "Sync & Reconcile Now" to audit the RADIUS devices against billing.'
                          : 'No account matches this filter.'}
                      </td>
                    </tr>
                  )}

                  {!loading && pagedRows.map((row) => {
                    const key = rowKey(row);
                    return (
                      <tr key={key} className={rowHover}>
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={grid.selected.has(key)}
                            onChange={(e) => grid.toggleRow(key, e.target.checked)}
                            className="rounded"
                          />
                        </td>
                        {visibleColumns.map((column) => (
                          <React.Fragment key={column.key}>{renderCell(column.key, row)}</React.Fragment>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {!loading && grid.filteredCount > PAGE_SIZE && (
              <div className={`flex items-center justify-between px-4 py-3 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                <span className={`text-xs ${muted}`}>
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, grid.filteredCount)} of {grid.filteredCount}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => grid.setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className={`px-3 py-1 rounded border text-xs disabled:opacity-40 ${card} ${text}`}
                  >
                    Previous
                  </button>
                  <span className={`text-xs ${muted}`}>Page {page} of {totalPages}</span>
                  <button
                    onClick={() => grid.setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className={`px-3 py-1 rounded border text-xs disabled:opacity-40 ${card} ${text}`}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Operation logs & undo */
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <h2 className={`text-sm font-semibold ${text}`}>Operation Logs &amp; Undo</h2>
            <button
              onClick={loadLogs}
              disabled={logsLoading}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 ${card} ${text}`}
            >
              {logsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
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
                  <tr><td colSpan={8} className={`px-4 py-10 text-center ${muted}`}><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                )}
                {!logsLoading && logs.length === 0 && (
                  <tr><td colSpan={8} className={`px-4 py-10 text-center ${muted}`}>No operation has been recorded yet.</td></tr>
                )}
                {!logsLoading && logs.map((entry) => (
                  <tr key={entry.log_id} className={rowHover}>
                    <td className={`px-3 py-2.5 text-xs whitespace-nowrap ${muted}`}>
                      {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-xs ${text}`}>{entry.operator}</td>
                    <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>{entry.action}</td>
                    <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>{entry.username ?? '—'}</td>
                    <td className={`px-3 py-2.5 text-xs ${muted}`}>{entry.server_label ?? '—'}</td>
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
        </div>
      )}

      {/* Duplicate resolution modal */}
      {duplicateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
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
                      : isDarkMode ? 'border-gray-800' : 'border-gray-200'
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
                onClick={() => { setDuplicateTarget(null); setKeepServerId(null); }}
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

    </div>
  );
};

export default MikrotikRadiusTool;
