import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CreditCard, Loader2, RefreshCw, Send, ShieldAlert, XCircle,
} from 'lucide-react';
import {
  xenditReconcileService,
  type XenditActionResult,
  type XenditAuditList,
  type XenditFilter,
  type XenditReconcileRow,
} from '../services/xenditReconcileService';
import { useDataGrid, type DataGridColumn } from '../hooks/useDataGrid';
import { useToolTheme } from '../hooks/useToolTheme';
import { useStatusSlices } from '../hooks/useStatusSlices';
import { useViewOptions } from '../hooks/useViewOptions';
import { SelectAllHeaderCell } from '../components/DataGridControls';
import { ToolShell, ToolToolbar, ToolDataTable, type SidebarSlice, type ToolNotice } from '../components/tools';
import TableFunnelFilter, {
  applyFunnelFilters,
  deriveOptionsByKey,
  type FilterValues,
  type FunnelColumn,
} from '../filter/TableFunnelFilter';
import type { SliceDefinition } from '../services/statusSliceService';
import type { GroupableColumn } from '../services/viewOptionsService';

interface XenditReconcileToolProps {
  isDarkMode?: boolean;
}

/**
 * Xendit payments against our own billing pipeline, and the tools to settle the gap.
 *
 * Rebuilt onto the standard SYNC list frame. The screen's job is unchanged and so is
 * every action on it — verify against the live gateway, force-post through the payment
 * worker's own claim, mark an abandoned checkout expired.
 *
 * Paging stays on the server: a 90-day window can hold tens of thousands of payments
 * and the API caps a page at 200, so the grid holds one server page and the footer is
 * driven from the server's counts rather than the grid's.
 */

const MODULE_KEY = 'xendit_reconcile';

/**
 * The slices this screen opens with.
 *
 * `unposted` is the operationally urgent one — Xendit has the money and billing has
 * not applied it, which is a paying customer sitting disconnected — so it is first and
 * wears the colour an operator's eye goes to.
 */
const SLICE_DEFINITIONS: SliceDefinition[] = [
  { id: 'unposted', label: 'Confirmed Paid (Unposted)', color: '#3b82f6' },
  { id: 'pending', label: 'Pending Verification', color: '#f59e0b' },
  { id: 'settled', label: 'Fully Settled', color: '#10b981' },
  { id: 'expired', label: 'Expired / Failed', color: '#6b7280' },
  { id: 'missing_account', label: 'Missing in Billing', color: '#ef4444' },
];

/**
 * Slices the API narrows for us, versus the one this screen applies itself.
 *
 * "Missing in Billing" is a property of a row, not a server filter — a payment with no
 * matching billing account can be in any of the four gateway states — so it is applied
 * over the fetched page.
 */
const CLIENT_SLICES = new Set(['missing_account']);

/** Selectable lookback windows, in days. */
const WINDOWS = [7, 30, 60, 90];

/** Default rows per server page. Adjustable from the footer; the API caps it at 200. */
const DEFAULT_PER_PAGE = 50;

/** Billing-pipeline status colouring. */
const BILLING_TONES: Record<string, string> = {
  PAID: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  QUEUED: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  PROCESSING: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  API_RETRY: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  PENDING: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  EXPIRED: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  FAILED: 'bg-red-500/15 text-red-500 border-red-500/30',
};

const peso = (value: number): string =>
  '₱' + value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A timestamp as `MM/DD/YYYY HH:MM AM/PM`, in the operator's own timezone.
 *
 * The format every other SYNC list screen prints a timestamp in — Service Orders, Job
 * Orders, Transactions — so a reference read here and a reference read there look the
 * same. Pinned here rather than left to `toLocaleString()`, which varies by browser
 * locale: reconciling a gateway against a ledger is exactly the job where an ambiguous
 * day/month costs an hour.
 *
 * Xendit sends UTC ISO-8601 and our own rows are stored in server time; both render as
 * local time, which is what the operator's Xendit dashboard also shows them. An
 * unparseable value is shown as-is rather than as "Invalid Date".
 */
const stampFull = (value: string | null): string => {
  if (!value) return '—';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const pad = (n: number) => String(n).padStart(2, '0');
  const hours24 = parsed.getHours();
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  return (
    `${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())}/${parsed.getFullYear()} ` +
    `${pad(hours12)}:${pad(parsed.getMinutes())} ${meridiem}`
  );
};

/**
 * The calendar day a timestamp falls on, as `MM/DD/YYYY`.
 *
 * Grouping key only. Grouping on the raw timestamp would produce one node per payment,
 * which is a list with extra indentation rather than a hierarchy.
 */
const dayOf = (value: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())}/${parsed.getFullYear()}`;
};

/** Sort key for a date: epoch milliseconds, so null sinks and order is chronological. */
const dateValue = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * The table's columns.
 *
 * All three timestamps are visible by default and none of them is behind the column
 * menu. Every one of them is something an operator matches against a Xendit dashboard
 * row or quotes into a dispute, and having to go looking for the date on a
 * reconciliation screen was the most common complaint about this table.
 */
const COLUMNS: Array<DataGridColumn<XenditReconcileRow>> = [
  { key: 'select', label: '', locked: true },
  { key: 'reference', label: 'Reference / Invoice ID', value: (row) => `${row.reference_no} ${row.invoice_id}`.trim() },
  { key: 'account_no', label: 'Account No', value: (row) => row.account_no },
  { key: 'subscriber', label: 'Subscriber Name', value: (row) => row.subscriber_name ?? '' },
  { key: 'amount', label: 'Amount', value: (row) => row.amount },
  { key: 'channel', label: 'Channel', value: (row) => row.channel },
  { key: 'created_at', label: 'Date & Time Created', value: (row) => dateValue(row.created_at) },
  { key: 'settled_at', label: 'Date & Time Paid', value: (row) => dateValue(row.settled_at) },
  { key: 'xendit_status', label: 'Xendit Status', value: (row) => row.xendit_status ?? '' },
  { key: 'billing_status', label: 'Billing Status', value: (row) => row.billing_status },
  { key: 'expiry_date', label: 'Expiry / Updated', value: (row) => dateValue(row.expiry_date ?? row.updated_at) },
  { key: 'actions', label: 'Actions', locked: true },
];

const FUNNEL_COLUMNS: FunnelColumn[] = [
  { key: 'reference_no', label: 'Reference No', dataType: 'varchar' },
  { key: 'invoice_id', label: 'Invoice ID', dataType: 'varchar' },
  { key: 'account_no', label: 'Account No', dataType: 'varchar' },
  { key: 'subscriber_name', label: 'Subscriber Name', dataType: 'varchar' },
  { key: 'amount', label: 'Amount', dataType: 'decimal' },
  { key: 'channel', label: 'Channel', dataType: 'checklist' },
  { key: 'xendit_status', label: 'Xendit Status', dataType: 'checklist' },
  { key: 'billing_status', label: 'Billing Status', dataType: 'checklist' },
  { key: 'created_at', label: 'Date Created', dataType: 'datetime' },
  { key: 'settled_at', label: 'Date Paid', dataType: 'datetime' },
];

/**
 * Columns this screen can be grouped, sorted and coloured by.
 *
 * Channel and status are the useful cuts — "every GCash payment Xendit confirmed that
 * billing has not posted" is one tree away. Date Paid groups by calendar day rather
 * than by timestamp, because a tree with one node per second is not a tree.
 */
const GROUPABLE_COLUMNS: Array<GroupableColumn<XenditReconcileRow>> = [
  { key: 'billing_status', label: 'Billing Status', value: (row) => row.billing_status },
  { key: 'xendit_status', label: 'Xendit Status', value: (row) => row.xendit_status },
  { key: 'channel', label: 'Channel', value: (row) => row.channel },
  { key: 'account_exists', label: 'Billing Account', value: (row) => (row.account_exists ? 'Matched' : 'Missing in billing') },
  { key: 'paid_day', label: 'Date Paid', value: (row) => dayOf(row.settled_at) },
  { key: 'created_day', label: 'Date Created', value: (row) => dayOf(row.created_at) },
];

const XenditReconcileTool: React.FC<XenditReconcileToolProps> = ({ isDarkMode: isDarkModeProp }) => {
  const { isDarkMode, colorPalette, isMobile } = useToolTheme(isDarkModeProp);
  const { slices, visibleSlices, save: saveSlices, reset: resetSlices } = useStatusSlices(
    MODULE_KEY,
    SLICE_DEFINITIONS
  );

  const [data, setData] = useState<XenditAuditList | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<ToolNotice | null>(null);

  const [slice, setSlice] = useState('unposted');
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);

  const [funnelOpen, setFunnelOpen] = useState(false);
  const [funnelFilters, setFunnelFilters] = useState<FilterValues>({});

  const [postTarget, setPostTarget] = useState<XenditReconcileRow | null>(null);
  const [expireTarget, setExpireTarget] = useState<XenditReconcileRow | null>(null);
  const [expireReason, setExpireReason] = useState('');

  /** A client-side slice reads the whole window and narrows it here. */
  const serverFilter: XenditFilter = CLIENT_SLICES.has(slice) || slice === 'all' ? 'all' : (slice as XenditFilter);

  // ---- Data --------------------------------------------------------------

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary;

  /**
   * Dynamic grouping, sorting and per-value colours.
   *
   * Scoped to the fetched server page, which is all this screen holds — the counts in
   * the tree describe the page, and the sidebar slice counts above still describe the
   * whole window.
   */
  const view = useViewOptions(MODULE_KEY, GROUPABLE_COLUMNS, allRows);

  const rows = useMemo(() => {
    // Grouped, the sidebar selection is a path into the tree and it replaces the slice
    // narrowing entirely — the two are competing answers to the same question.
    let result = view.isGrouped ? view.filterByGroup(allRows, slice) : allRows;

    if (!view.isGrouped && slice === 'missing_account') {
      result = result.filter((row) => !row.account_exists);
    }

    if (Object.keys(funnelFilters).length > 0) {
      result = applyFunnelFilters(result, funnelFilters);
    }

    return result;
  }, [allRows, slice, funnelFilters, view]);

  const funnelOptions = useMemo(() => deriveOptionsByKey(allRows, FUNNEL_COLUMNS), [allRows]);

  /**
   * Sorting, column visibility, selection and export over the fetched page.
   *
   * The grid's own page size is pinned to the server's, so it renders the fetched page
   * in one block; the footer is driven from the server counts instead. Search likewise
   * stays server-side — it has to reach rows this page does not hold.
   */
  const grid = useDataGrid<XenditReconcileRow>({
    rows,
    columns: COLUMNS,
    rowKey: (row) => String(row.id),
    pageSize: perPage,
    initialSort: [{ key: 'settled_at', direction: 'desc' }],
    storageKey: 'xendit_reconcile.columns',
  });

  const { clearSelection } = grid;
  const selectedRows = grid.selectedRows;

  /**
   * Adopt the configured sort once the preferences have loaded.
   *
   * Applied to the grid rather than pre-sorting the rows, so a header click still wins
   * for the rest of the session — the saved order is a starting point, not a lock.
   */
  const sortSignature = JSON.stringify(view.sortRules);
  useEffect(() => {
    if (!view.loaded || view.sortRules.length === 0) return;
    grid.setSort(view.sortRules);
    // sortSignature stands in for the rules array, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.loaded, sortSignature]);

  /**
   * Changing the grouping invalidates the selection.
   *
   * A node path from the previous hierarchy names levels that no longer exist, so it
   * would silently match nothing and the table would render empty.
   */
  const groupSignature = view.options.groupBy.join('|');
  useEffect(() => {
    setSlice('all');
  }, [groupSignature]);


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await xenditReconcileService.getAudit({
        filter: serverFilter,
        search: search.trim() || undefined,
        days,
        page,
        per_page: perPage,
      });
      setData(result);
      clearSelection();
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.response?.data?.message || 'Could not read the payment worklist.' });
    } finally {
      setLoading(false);
    }
  }, [serverFilter, search, days, page, perPage, clearSelection]);

  useEffect(() => {
    load();
  }, [load]);

  // Any change of what is being looked at starts again at the first page — page 4 of
  // "unposted" is a different set from page 4 of "expired".
  useEffect(() => {
    setPage(1);
  }, [slice, search, days, perPage]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / perPage));

  // ---- Sidebar -----------------------------------------------------------

  const sidebarSlices: SidebarSlice[] = useMemo(
    () =>
      visibleSlices.map((definition) => ({
        ...definition,
        count:
          definition.id === 'missing_account'
            ? summary?.missing_in_db ?? 0
            : definition.id === 'pending'
              ? summary?.unreconciled ?? 0
              : ((summary as any)?.[definition.id] as number | undefined) ?? 0,
      })),
    [visibleSlices, summary]
  );

  const allCount = summary
    ? summary.unreconciled + summary.unposted + summary.settled + summary.expired
    : 0;

  // ---- Actions -----------------------------------------------------------

  /**
   * Replace one row with the state the backend just handed back.
   *
   * Used where an action did not move the payment anywhere: the operator keeps their
   * page, filter and selection instead of watching the whole table reload to show a
   * single unchanged cell.
   */
  const applyRow = useCallback((updated: XenditReconcileRow) => {
    setData((prev) =>
      prev ? { ...prev, rows: prev.rows.map((row) => (row.id === updated.id ? updated : row)) } : prev
    );
  }, []);

  const runAction = useCallback(
    async (key: string, action: () => Promise<XenditActionResult>) => {
      setBusy(key);
      try {
        const result = await action();
        setNotice({
          tone: result.success ? (result.skipped ? 'info' : 'success') : 'error',
          text: result.message,
        });

        // `skipped` is the backend saying the payment is where it was — Xendit still
        // shows it open, or another process had already moved it. Nothing else on
        // screen changed, so the row is patched in place. Anything that did move a
        // payment changes the counts and possibly its membership of the current
        // slice, so that still reloads the list.
        if (result.skipped && result.row) {
          applyRow(result.row);
        } else {
          await load();
        }
      } finally {
        setBusy(null);
      }
    },
    [load, applyRow]
  );

  const confirmForcePost = useCallback(async () => {
    if (!postTarget) return;
    const target = postTarget;
    setPostTarget(null);
    await runAction(`post:${target.id}`, () => xenditReconcileService.forcePost(target.id));
  }, [postTarget, runAction]);

  const confirmMarkExpired = useCallback(async () => {
    if (!expireTarget) return;
    const target = expireTarget;
    const reason = expireReason.trim();
    setExpireTarget(null);
    setExpireReason('');
    await runAction(`exp:${target.id}`, () => xenditReconcileService.markExpired(target.id, reason || undefined));
  }, [expireTarget, expireReason, runAction]);

  /** Verify every selected row, one call each so a single failure is attributable. */
  const verifySelected = useCallback(async () => {
    if (selectedRows.length === 0) return;
    setBusy('bulk:verify');
    try {
      let confirmed = 0;
      let unchanged = 0;
      let failed = 0;

      for (const row of selectedRows) {
        const result = await xenditReconcileService.verify(row.id);
        if (!result.success) failed++;
        else if (result.outcome === 'queued') confirmed++;
        else unchanged++;
      }

      setNotice({
        tone: failed > 0 ? 'error' : 'success',
        text: `Verified ${selectedRows.length} payment(s): ${confirmed} confirmed and queued, ${unchanged} unchanged, ${failed} failed.`,
      });
      await load();
    } finally {
      setBusy(null);
    }
  }, [selectedRows, load]);

  // ---- Theme tokens ------------------------------------------------------

  const card = isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200';
  const text = isDarkMode ? 'text-gray-100' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const input = isDarkMode
    ? 'bg-gray-950 border-gray-800 text-gray-100 placeholder-gray-600'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';

  // ---- Cells -------------------------------------------------------------

  const renderCell = (row: XenditReconcileRow, column: DataGridColumn<XenditReconcileRow>): React.ReactNode => {
    switch (column.key) {
      case 'select':
        return (
          <td className="px-3 py-2.5">
            <input
              type="checkbox"
              checked={grid.selected.has(String(row.id))}
              onChange={(event) => grid.toggleRow(String(row.id), event.target.checked)}
              className="rounded"
            />
          </td>
        );

      case 'reference':
        return (
          <td className="px-3 py-2.5 text-xs">
            <div className={`font-mono font-medium ${text}`}>{row.reference_no}</div>
            <div className={`font-mono opacity-70 ${muted}`}>{row.invoice_id || '—'}</div>
          </td>
        );

      case 'account_no':
        return (
          <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>
            {row.account_no}
            {!row.account_exists && (
              <span
                className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-red-500/15 text-red-500 border-red-500/30"
                title="No billing account carries this account number, so this payment cannot be posted."
              >
                no account
              </span>
            )}
          </td>
        );

      case 'subscriber':
        return (
          <td className={`px-3 py-2.5 text-xs ${row.subscriber_name ? text : muted}`}>{row.subscriber_name ?? '—'}</td>
        );

      case 'amount':
        return (
          <td className={`px-3 py-2.5 text-xs text-right font-mono font-medium ${text}`}>{peso(row.amount)}</td>
        );

      case 'channel':
        return <td className={`px-3 py-2.5 text-xs ${muted}`}>{row.channel}</td>;

      case 'xendit_status':
        return (
          <td className="px-3 py-2.5 text-xs">
            {row.xendit_status ? (
              <span className={text}>{row.xendit_status}</span>
            ) : (
              <span className={muted} title="The gateway has not reported on this payment yet.">
                not reported
              </span>
            )}
          </td>
        );

      case 'billing_status':
        return (
          <td className="px-3 py-2.5">
            <span
              className={`text-[11px] px-2 py-0.5 rounded border font-medium ${
                BILLING_TONES[row.billing_status] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'
              }`}
            >
              {row.billing_status}
            </span>
          </td>
        );

      case 'created_at':
        // Formatted here rather than taken from the backend's `date_created`, which is
        // ISO-shaped: the two would print the same instant in two different formats on
        // one screen, and this column has to match the rest of SYNC.
        return (
          <td className={`px-3 py-2.5 text-xs font-mono whitespace-nowrap ${text}`}>{stampFull(row.created_at)}</td>
        );

      case 'settled_at':
        return (
          <td
            className={`px-3 py-2.5 text-xs font-mono whitespace-nowrap ${row.settled_at ? text : muted}`}
            title={row.settled_at ? 'When the gateway confirmed payment' : 'Not paid yet'}
          >
            {stampFull(row.settled_at)}
          </td>
        );

      case 'expiry_date':
        // The gateway's expiry where it reported one, otherwise the last time our own
        // row moved. Titled so which is on screen is never a guess — they mean
        // different things to a dispute.
        return (
          <td
            className={`px-3 py-2.5 text-xs font-mono whitespace-nowrap ${muted}`}
            title={
              row.expiry_date
                ? 'Gateway expiry date'
                : 'No gateway expiry reported — showing when this record was last updated'
            }
          >
            {stampFull(row.expiry_date ?? row.updated_at)}
            {!row.expiry_date && row.updated_at && <span className="ml-1 opacity-60">(upd)</span>}
          </td>
        );

      case 'actions':
        return (
          <td className="px-3 py-2.5">
            <div className="flex items-center justify-end gap-1 flex-wrap">
              <button
                onClick={() => runAction(`ver:${row.id}`, () => xenditReconcileService.verify(row.id))}
                disabled={busy !== null || !row.invoice_id}
                title={
                  row.invoice_id
                    ? "Ask Xendit for this payment's current status"
                    : 'This payment carries no gateway id, so there is nothing to look up'
                }
                className="px-2 py-1 rounded text-[11px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 disabled:opacity-40"
              >
                {busy === `ver:${row.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Verify with Xendit'}
              </button>

              {row.can_force_post && (
                <button
                  onClick={() => setPostTarget(row)}
                  disabled={busy !== null}
                  title="Apply the balance, clear the invoice and issue the receipt now"
                  className="px-2 py-1 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  {busy === `post:${row.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Force Post Payment'}
                </button>
              )}

              {row.can_mark_expired && (
                <button
                  onClick={() => {
                    setExpireTarget(row);
                    setExpireReason('');
                  }}
                  disabled={busy !== null}
                  title="Write off this abandoned checkout"
                  className="px-2 py-1 rounded text-[11px] font-medium bg-gray-500/15 text-gray-400 border border-gray-500/30 hover:bg-gray-500/25 disabled:opacity-40"
                >
                  {busy === `exp:${row.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Mark Expired'}
                </button>
              )}
            </div>
          </td>
        );

      default:
        return <td className="px-3 py-2.5" />;
    }
  };

  const renderHeaderCell = (column: DataGridColumn<XenditReconcileRow>) =>
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
      title="Xendit Reconcile"
      isDarkMode={isDarkMode}
      colorPalette={colorPalette}
      isMobile={isMobile}
      allLabel="All Payments"
      allCount={allCount}
      slices={sidebarSlices}
      selectedSliceId={slice}
      onSelectSlice={setSlice}
      configurableSlices={slices}
      sliceDefinitions={SLICE_DEFINITIONS}
      onSaveSlices={saveSlices}
      onResetSlices={resetSlices}
      groupableColumns={GROUPABLE_COLUMNS}
      groupTree={view.tree}
      viewOptions={view.options}
      onSaveViewOptions={view.save}
      onResetViewOptions={view.reset}
      distinctValues={view.distinctValues}
      colorFor={view.colorFor}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      sidebarHeader={
        <div className={`px-3 py-2 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          <div className={`text-[10px] uppercase tracking-wide mb-1.5 ${muted}`}>Lookback window</div>
          <div className={`flex items-center rounded-lg border overflow-hidden ${card}`}>
            {WINDOWS.map((option) => (
              <button
                key={option}
                onClick={() => setDays(option)}
                className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
                  days === option ? 'text-white' : `${text} hover:opacity-80`
                }`}
                style={days === option ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : undefined}
              >
                {option}d
              </button>
            ))}
          </div>
        </div>
      }
      toolbar={
        <ToolToolbar
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          searchQuery={search}
          onSearch={setSearch}
          searchPlaceholder="Search by reference, invoice id, account number or subscriber name..."
          onOpenFilter={() => setFunnelOpen(true)}
          activeFilterCount={Object.keys(funnelFilters).length}
          columns={grid.columns}
          hiddenKeys={grid.hiddenKeys}
          onToggleColumn={grid.toggleColumn}
          onResetColumns={grid.resetColumns}
          onExport={() =>
            grid.toCsv(`xendit_reconcile_${slice}_${new Date().toISOString().slice(0, 10)}`)
          }
          exportDisabled={rows.length === 0}
          onRefresh={load}
          refreshing={loading}
          refreshTitle={`Re-read the last ${days} days`}
        />
      }
      banner={
        selectedRows.length > 0 ? (
          <div className="mx-4 mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 flex flex-wrap items-center gap-2">
            <span className={`text-sm font-medium ${text}`}>{selectedRows.length} selected</span>
            <div className="flex-1" />
            <button
              onClick={verifySelected}
              disabled={busy !== null}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 ${card} ${text}`}
            >
              {busy === 'bulk:verify' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Verify with Xendit
            </button>
            <button onClick={clearSelection} className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${card} ${muted}`}>
              Clear
            </button>
          </div>
        ) : null
      }
    >
      <ToolDataTable
        grid={grid}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        renderCell={renderCell}
        renderHeaderCell={renderHeaderCell}
        rowKey={(row) => String(row.id)}
        loading={loading}
        emptyMessage={`No payment matches this slice in the last ${days} days.`}
        storageKey="xendit_reconcile.widths"
        pageSizeOptions={[25, 50, 100, 200]}
        pagination={{
          page,
          totalPages,
          totalRows: data?.total ?? 0,
          pageSize: perPage,
          onPageChange: setPage,
          onPageSizeChange: setPerPage,
        }}
      />

      <TableFunnelFilter
        isOpen={funnelOpen}
        onClose={() => setFunnelOpen(false)}
        onApplyFilters={(filters) => {
          setFunnelFilters(filters);
          setFunnelOpen(false);
        }}
        currentFilters={funnelFilters}
        columns={FUNNEL_COLUMNS}
        title="Xendit Reconcile Filters"
        subtitle="Narrow this page by column"
        storageKey="xendit_reconcile.funnel"
        optionsByKey={funnelOptions}
      />

      {postTarget && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-md rounded-xl border p-5 ${card}`}>
            <h3 className={`text-base font-bold mb-2 flex items-center gap-2 ${text}`}>
              <Send className="w-4 h-4 text-emerald-500" /> Post this payment to billing?
            </h3>

            <p className={`text-sm mb-3 ${muted}`}>
              This applies the payment to the account balance, settles the open invoices it covers, issues the receipt,
              and reconnects the subscriber if the balance clears. It runs through the payment worker&rsquo;s own claim,
              so posting the same payment twice is not possible.
            </p>

            <div
              className={`rounded-lg border p-3 mb-4 text-xs space-y-1 ${
                isDarkMode ? 'bg-gray-950 border-gray-800' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex justify-between gap-3">
                <span className={muted}>Reference</span>
                <span className={`font-mono ${text}`}>{postTarget.reference_no}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className={muted}>Account</span>
                <span className={`font-mono ${text}`}>{postTarget.account_no}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className={muted}>Subscriber</span>
                <span className={text}>{postTarget.subscriber_name ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className={muted}>Amount</span>
                <span className={`font-mono font-semibold ${text}`}>{peso(postTarget.amount)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className={muted}>Paid at</span>
                <span className={`font-mono ${text}`}>{stampFull(postTarget.settled_at)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className={muted}>Xendit says</span>
                <span className="text-emerald-500 font-medium">{postTarget.xendit_status}</span>
              </div>
            </div>

            {!postTarget.account_exists && (
              <div className="mb-4 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-500 flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                No billing account carries this account number. The post will be refused — there is nothing to credit.
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setPostTarget(null)} className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}>
                Cancel
              </button>
              <button
                onClick={confirmForcePost}
                disabled={busy !== null}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" /> Post payment
              </button>
            </div>
          </div>
        </div>
      )}

      {expireTarget && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-md rounded-xl border p-5 ${card}`}>
            <h3 className={`text-base font-bold mb-2 flex items-center gap-2 ${text}`}>
              <XCircle className="w-4 h-4 text-gray-400" /> Mark this checkout expired?
            </h3>

            <p className={`text-sm mb-3 ${muted}`}>
              Records {expireTarget.reference_no} ({peso(expireTarget.amount)}) as an abandoned checkout and stops the
              reconciliation cron re-checking it. Refused automatically if Xendit has in fact confirmed payment — verify
              first if you are unsure.
            </p>

            <div className="mb-4 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-500 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This does not tell Xendit anything. It only records our side.
            </div>

            <label className={`block text-xs mb-1 ${muted}`}>Reason (optional, recorded in the log)</label>
            <input
              value={expireReason}
              onChange={(event) => setExpireReason(event.target.value)}
              maxLength={255}
              placeholder="e.g. customer paid over the counter instead"
              className={`w-full px-3 py-2 rounded-lg border text-sm mb-4 ${input}`}
            />

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setExpireTarget(null);
                  setExpireReason('');
                }}
                className={`px-4 py-2 rounded-lg border text-sm ${card} ${text}`}
              >
                Cancel
              </button>
              <button
                onClick={confirmMarkExpired}
                disabled={busy !== null}
                className="px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                <CreditCard className="w-4 h-4" /> Mark expired
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
};

export default XenditReconcileTool;
