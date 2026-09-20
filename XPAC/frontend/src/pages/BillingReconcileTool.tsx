import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Loader2, Play, RotateCcw } from 'lucide-react';
import {
  billingReconcileService,
  type BillingReconcileAudit,
  type BillingReconcileReasons,
  type BillingReconcileRow,
} from '../services/billingReconcileService';
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

interface BillingReconcileToolProps {
  isDarkMode?: boolean;
}

/**
 * Why an account due for billing this cycle produced no invoice, and how to clear it.
 *
 * Rebuilt onto the standard SYNC list frame — status sidebar, standard toolbar,
 * sortable grid, paginated footer — so it reads like Service Orders rather than like a
 * dashboard someone bolted a table to. Every action it had is unchanged: generate
 * through the same generator the nightly cron uses, dismiss for the cycle, restore.
 *
 * The reason vocabulary is still the server's. What is new is the plan slice: the
 * audit now says whether the plan linked to the account and the plan the subscriber
 * was sold name the same thing, judged on the first word the way Job Order account
 * creation judges it, so a price suffix stops reading as a discrepancy.
 */

const MODULE_KEY = 'billing_reconcile';

/**
 * The slices this screen opens with.
 *
 * Ordered by what an operator does first — money that can be recovered right now, then
 * the data faults in roughly the order they are caused — and colored so that green is
 * "act", amber and orange are "fix the account", red is "blocked", grey is "nothing to
 * do". Any of it can be reordered, recolored or hidden per operator.
 *
 * `all_reasons` is not among them: the "All" row above the list is that.
 */
const SLICE_DEFINITIONS: SliceDefinition[] = [
  { id: 'ready', label: 'Ready to Generate', color: '#10b981' },
  { id: 'missing_billing_day', label: 'Missing Billing Day', color: '#f59e0b' },
  { id: 'missing_plan', label: 'Missing / Unlinked Plan', color: '#f59e0b' },
  { id: 'plan_mismatch', label: 'Plan Disagreement', color: '#ec4899' },
  { id: 'zero_price', label: 'Plan Price is 0.00', color: '#f97316' },
  { id: 'inactive_status', label: 'Not Active', color: '#ef4444' },
  { id: 'open_job_order', label: 'Open Job Order', color: '#a855f7' },
  { id: 'prepaid', label: 'Prepaid (Awaiting Renewal)', color: '#3b82f6' },
  { id: 'already_invoiced', label: 'Already Invoiced', color: '#22c55e' },
  { id: 'dismissed', label: 'Dismissed', color: '#6b7280' },
];

/**
 * Slices the server narrows for us, versus the one this screen applies itself.
 *
 * `plan_mismatch` is not a reason code — an account can be Ready and still have a plan
 * disagreement — so it cannot be pushed into the audit's `reason` parameter. It filters
 * the loaded rows instead.
 */
const CLIENT_SLICES = new Set(['plan_mismatch']);

/** Reasons whose rows the server only returns when explicitly asked for. */
const NEEDS_INCLUDE_OK = new Set(['already_invoiced']);

const REASON_TONES: Record<string, string> = {
  ready: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  missing_billing_day: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  missing_plan: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  zero_price: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  inactive_status: 'bg-red-500/15 text-red-500 border-red-500/30',
  prepaid: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  already_invoiced: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  open_job_order: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  dismissed: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const PAGE_SIZE = 100;

const peso = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? '—'
    : `₱${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A billing day as an operator reads it.
 *
 * 0 is not "no billing day" — it is the sentinel for "every end of month", and the two
 * mean opposite things to this screen, so they are never rendered the same way.
 */
const billingDayLabel = (day: number | null): string => {
  if (day === null || day === undefined) return 'not set';
  if (day === 0) return 'End of month';
  return String(day);
};

const stamp = (value: string | null): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())}/${parsed.getFullYear()}`;
};

/**
 * The table's columns.
 *
 * `value` drives sorting, searching and CSV export; the cell renderer below draws them,
 * so a column can never export something different from what it displays.
 */
const COLUMNS: Array<DataGridColumn<BillingReconcileRow>> = [
  { key: 'select', label: '', locked: true },
  { key: 'account_no', label: 'Account No', value: (row) => row.account_no },
  { key: 'customer_name', label: 'Subscriber', value: (row) => row.customer_name ?? '' },
  { key: 'reason', label: 'Reason', value: (row) => row.reason_label },
  { key: 'plan_name', label: 'Linked Plan', value: (row) => row.plan_name ?? '' },
  // Shown by default: the whole point of the plan pass is that an operator can see the
  // sold label beside the linked one and judge for themselves.
  { key: 'desired_plan', label: 'Sold Plan', value: (row) => row.desired_plan ?? '' },
  { key: 'plan_price', label: 'Plan Price', value: (row) => row.plan_price },
  { key: 'suggested_plan_name', label: 'Suggested Plan', value: (row) => row.suggested_plan_name ?? '', defaultHidden: true },
  { key: 'billing_day', label: 'Billing Day', value: (row) => row.billing_day },
  { key: 'billing_status', label: 'Billing Status', value: (row) => row.billing_status ?? '' },
  { key: 'generation_type', label: 'Billing Type', value: (row) => row.generation_type ?? '', defaultHidden: true },
  { key: 'account_balance', label: 'Balance', value: (row) => row.account_balance, defaultHidden: true },
  { key: 'date_installed', label: 'Installed', value: (row) => row.date_installed ?? '', defaultHidden: true },
  { key: 'last_invoice_date', label: 'Last Invoice', value: (row) => row.last_invoice_date ?? '', defaultHidden: true },
  { key: 'actions', label: 'Actions', locked: true },
];

/** Columns the funnel panel can narrow on, and the type each one filters as. */
const FUNNEL_COLUMNS: FunnelColumn[] = [
  { key: 'account_no', label: 'Account No', dataType: 'varchar' },
  { key: 'customer_name', label: 'Subscriber', dataType: 'varchar' },
  { key: 'reason_label', label: 'Reason', dataType: 'checklist' },
  { key: 'plan_name', label: 'Linked Plan', dataType: 'checklist' },
  { key: 'desired_plan', label: 'Sold Plan', dataType: 'varchar' },
  { key: 'plan_price', label: 'Plan Price', dataType: 'decimal' },
  { key: 'billing_day', label: 'Billing Day', dataType: 'int' },
  { key: 'billing_status', label: 'Billing Status', dataType: 'checklist' },
  { key: 'account_balance', label: 'Balance', dataType: 'decimal' },
  { key: 'date_installed', label: 'Installed', dataType: 'date' },
  { key: 'last_invoice_date', label: 'Last Invoice', dataType: 'date' },
];

/**
 * Columns this screen can be grouped, sorted and coloured by.
 *
 * A deliberately smaller set than the table's columns: grouping is only useful over a
 * value with few enough distinct entries to read as a tree, so an account number and a
 * balance are not offered. Billing day is, because "everything that bills on the 15th"
 * is a real worklist.
 */
const GROUPABLE_COLUMNS: Array<GroupableColumn<BillingReconcileRow>> = [
  { key: 'reason_label', label: 'Reason', value: (row) => row.reason_label },
  { key: 'billing_status', label: 'Billing Status', value: (row) => row.billing_status },
  { key: 'plan_name', label: 'Linked Plan', value: (row) => row.plan_name },
  { key: 'desired_plan', label: 'Sold Plan', value: (row) => row.desired_plan },
  { key: 'plan_match', label: 'Plan Agreement', value: (row) => row.plan_match },
  { key: 'billing_day', label: 'Billing Day', value: (row) => row.billing_day },
  { key: 'generation_type', label: 'Billing Type', value: (row) => row.generation_type },
  { key: 'customer_name', label: 'Subscriber', value: (row) => row.customer_name },
];

const BillingReconcileTool: React.FC<BillingReconcileToolProps> = ({ isDarkMode: isDarkModeProp }) => {
  const { isDarkMode, colorPalette, isMobile } = useToolTheme(isDarkModeProp);
  const { slices, visibleSlices, colorOf, save: saveSlices, reset: resetSlices } = useStatusSlices(
    MODULE_KEY,
    SLICE_DEFINITIONS
  );

  const [data, setData] = useState<BillingReconcileAudit | null>(null);
  const [reasons, setReasons] = useState<BillingReconcileReasons | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<ToolNotice | null>(null);

  /** The sidebar selection. 'all', a reason code, or a client-side slice id. */
  const [slice, setSlice] = useState('all');
  const [search, setSearch] = useState('');
  const [includeOk, setIncludeOk] = useState(false);

  const [funnelOpen, setFunnelOpen] = useState(false);
  const [funnelFilters, setFunnelFilters] = useState<FilterValues>({});

  const [dismissTarget, setDismissTarget] = useState<BillingReconcileRow[] | null>(null);
  const [dismissReason, setDismissReason] = useState('');

  // Only the server-side slices become a `reason` parameter; the rest narrow locally.
  const serverReason = slice !== 'all' && !CLIENT_SLICES.has(slice) ? slice : '';

  // ---- Data --------------------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await billingReconcileService.getAudit({
        reason: serverReason || undefined,
        search: search.trim() || undefined,
        // Already-invoiced rows are excluded from the default worklist server-side, so
        // asking for that slice has to ask for them explicitly or it renders empty.
        include_ok: includeOk || NEEDS_INCLUDE_OK.has(slice),
      });
      setData(result);
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.response?.data?.message || 'Could not read the billing worklist.' });
    } finally {
      setLoading(false);
    }
  }, [serverReason, search, includeOk, slice]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // The reason vocabulary comes from the server so the badges are built from the
    // rules that produced them, not from a second copy in this file.
    billingReconcileService.getReasons().then(setReasons).catch(() => setReasons(null));
  }, []);

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary;

  /**
   * Dynamic grouping, sorting and per-value colours.
   *
   * Built over the whole worklist rather than the narrowed view, so a group count says
   * how many rows exist under that value — not how many survived the search box.
   */
  const view = useViewOptions(MODULE_KEY, GROUPABLE_COLUMNS, allRows);

  /** Rows after the sidebar slice and the funnel panel, before the grid's own search. */
  const rows = useMemo(() => {
    // Grouped, the sidebar selection is a path into the tree and it replaces the
    // slice narrowing entirely — the two are competing answers to the same question.
    let result = view.isGrouped ? view.filterByGroup(allRows, slice) : allRows;

    if (!view.isGrouped && CLIENT_SLICES.has(slice)) {
      result = result.filter((row) => row.plan_match === 'mismatch');
    }

    if (Object.keys(funnelFilters).length > 0) {
      result = applyFunnelFilters(result, funnelFilters, (row, key) => {
        switch (key) {
          case 'reason_label': return row.reason_label;
          case 'customer_name': return row.customer_name;
          case 'plan_name': return row.plan_name;
          case 'desired_plan': return row.desired_plan;
          case 'billing_status': return row.billing_status;
          default: return (row as any)[key];
        }
      });
    }

    return result;
  }, [allRows, slice, funnelFilters, view]);

  const funnelOptions = useMemo(
    () =>
      deriveOptionsByKey(allRows, FUNNEL_COLUMNS, (row, key) =>
        key === 'reason_label' ? row.reason_label : (row as any)[key]
      ),
    [allRows]
  );

  const grid = useDataGrid<BillingReconcileRow>({
    rows,
    columns: COLUMNS,
    rowKey: (row) => String(row.billing_account_id),
    // Only rows this screen can act on are selectable — ticking one it cannot bill or
    // dismiss would put it in a batch that silently drops it again server-side.
    isSelectable: (row) => row.can_generate || row.can_dismiss,
    pageSize: PAGE_SIZE,
    initialSort: [{ key: 'account_no', direction: 'asc' }],
    storageKey: 'billing_reconcile.columns',
  });

  const { selectedRows, clearSelection } = grid;
  const { setSort } = grid;

  /**
   * Adopt the configured sort once the preferences have loaded.
   *
   * Applied to the grid rather than pre-sorting the rows, so a header click still wins
   * for the rest of the session — the saved order is a starting point, not a lock.
   */
  const sortSignature = JSON.stringify(view.sortRules);
  useEffect(() => {
    if (!view.loaded || view.sortRules.length === 0) return;
    setSort(view.sortRules);
    // sortSignature stands in for the rules array, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.loaded, sortSignature, setSort]);

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

  const generatableSelection = useMemo(() => selectedRows.filter((row) => row.can_generate), [selectedRows]);
  const dismissableSelection = useMemo(() => selectedRows.filter((row) => row.can_dismiss), [selectedRows]);

  // ---- Sidebar -----------------------------------------------------------

  const sidebarSlices: SidebarSlice[] = useMemo(
    () =>
      visibleSlices.map((definition) => ({
        ...definition,
        count:
          definition.id === 'plan_mismatch'
            ? summary?.plan_mismatch ?? 0
            : ((summary as any)?.[definition.id] as number | undefined) ?? 0,
      })),
    [visibleSlices, summary]
  );

  // ---- Actions -----------------------------------------------------------

  const runAction = useCallback(
    async (key: string, action: () => Promise<{ success: boolean; message: string }>) => {
      setBusy(key);
      try {
        const result = await action();
        setNotice({ tone: result.success ? 'success' : 'error', text: result.message });
        // Generation and dismissal both change which rows belong on the worklist and
        // what the counts say, so the whole audit is re-read rather than patched.
        await load();
        clearSelection();
      } finally {
        setBusy(null);
      }
    },
    [load, clearSelection]
  );

  const generateOne = useCallback(
    (row: BillingReconcileRow) =>
      runAction(`gen:${row.billing_account_id}`, () => billingReconcileService.generate([row.billing_account_id])),
    [runAction]
  );

  const generateSelected = useCallback(() => {
    if (generatableSelection.length === 0) {
      setNotice({
        tone: 'info',
        text: 'None of the selected accounts can be billed from here — fix the flagged reason first.',
      });
      return;
    }
    const max = reasons?.max_batch ?? 200;
    const batch = generatableSelection.slice(0, max).map((row) => row.billing_account_id);
    return runAction('bulk:generate', () => billingReconcileService.generate(batch));
  }, [generatableSelection, reasons, runAction]);

  const confirmDismiss = useCallback(() => {
    if (!dismissTarget || dismissTarget.length === 0) return;
    const ids = dismissTarget.map((row) => row.billing_account_id);
    const reason = dismissReason.trim();
    setDismissTarget(null);
    setDismissReason('');
    return runAction('bulk:dismiss', () => billingReconcileService.dismiss(ids, reason || undefined));
  }, [dismissTarget, dismissReason, runAction]);

  const restoreOne = useCallback(
    (row: BillingReconcileRow) =>
      runAction(`res:${row.billing_account_id}`, () => billingReconcileService.restore([row.billing_account_id])),
    [runAction]
  );

  // ---- Theme tokens ------------------------------------------------------

  const card = isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200';
  const text = isDarkMode ? 'text-gray-100' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const input = isDarkMode
    ? 'bg-gray-950 border-gray-800 text-gray-100 placeholder-gray-600'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';

  // ---- Cells -------------------------------------------------------------

  const renderCell = (row: BillingReconcileRow, column: DataGridColumn<BillingReconcileRow>): React.ReactNode => {
    switch (column.key) {
      case 'select':
        return (
          <td className="px-3 py-2.5">
            <input
              type="checkbox"
              checked={grid.selected.has(String(row.billing_account_id))}
              disabled={!row.can_generate && !row.can_dismiss}
              onChange={(event) => grid.toggleRow(String(row.billing_account_id), event.target.checked)}
              className="rounded"
            />
          </td>
        );

      case 'account_no':
        return <td className={`px-3 py-2.5 text-xs font-mono ${text}`}>{row.account_no}</td>;

      case 'customer_name':
        return (
          <td className={`px-3 py-2.5 text-xs ${row.customer_name ? text : muted}`}>
            {row.customer_name || 'no customer record'}
          </td>
        );

      case 'reason':
        return (
          <td className="px-3 py-2.5">
            <span
              className={`text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap ${
                REASON_TONES[row.reason] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'
              }`}
              title={row.dismissed_reason ?? undefined}
              style={colorOf(row.reason) ? { borderColor: `${colorOf(row.reason)}66` } : undefined}
            >
              {row.reason_label}
            </span>
          </td>
        );

      case 'plan_name':
        return (
          <td className={`px-3 py-2.5 text-xs ${row.plan_name ? text : muted}`}>{row.plan_name || 'not linked'}</td>
        );

      case 'desired_plan':
        // A disagreement is called out here rather than in its own column: the two
        // labels side by side are the finding, and a separate verdict column would be
        // read without them.
        return (
          <td className={`px-3 py-2.5 text-xs ${row.desired_plan ? text : muted}`}>
            <div className="flex items-center gap-1.5">
              <span className="truncate">{row.desired_plan || '—'}</span>
              {row.plan_match === 'mismatch' && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap bg-pink-500/15 text-pink-400 border-pink-500/30"
                  title={
                    row.suggested_plan_name
                      ? `The sold plan resolves to "${row.suggested_plan_name}", not the linked plan.`
                      : 'The linked plan and the sold plan name different plans.'
                  }
                >
                  differs
                </span>
              )}
              {row.plan_match === 'suggested' && row.suggested_plan_name && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap bg-amber-500/15 text-amber-500 border-amber-500/30"
                  title={`No plan is linked. The sold label resolves to "${row.suggested_plan_name}" — link it on the account to make this billable.`}
                >
                  → {row.suggested_plan_name}
                </span>
              )}
            </div>
          </td>
        );

      case 'suggested_plan_name':
        return (
          <td className={`px-3 py-2.5 text-xs ${row.suggested_plan_name ? text : muted}`}>
            {row.suggested_plan_name || '—'}
            {row.suggested_plan_price !== null && row.suggested_plan_name && (
              <span className={`ml-1 ${muted}`}>({peso(row.suggested_plan_price)})</span>
            )}
          </td>
        );

      case 'plan_price':
        // A plan priced at 0.00 is the finding, so it renders as the figure it is and
        // is never collapsed into the same dash as "no plan at all".
        return (
          <td className={`px-3 py-2.5 text-xs text-right font-mono ${row.plan_price === 0 ? 'text-orange-500' : text}`}>
            {peso(row.plan_price)}
          </td>
        );

      case 'billing_day':
        return (
          <td className={`px-3 py-2.5 text-xs ${row.billing_day === null ? 'text-amber-500' : muted}`}>
            {billingDayLabel(row.billing_day)}
          </td>
        );

      case 'billing_status':
        return <td className={`px-3 py-2.5 text-xs ${muted}`}>{row.billing_status || '—'}</td>;

      case 'generation_type':
        return <td className={`px-3 py-2.5 text-xs ${muted}`}>{row.generation_type || '—'}</td>;

      case 'account_balance':
        return <td className={`px-3 py-2.5 text-xs text-right font-mono ${muted}`}>{peso(row.account_balance)}</td>;

      case 'date_installed':
        return <td className={`px-3 py-2.5 text-xs font-mono ${muted}`}>{stamp(row.date_installed)}</td>;

      case 'last_invoice_date':
        return <td className={`px-3 py-2.5 text-xs font-mono ${muted}`}>{stamp(row.last_invoice_date)}</td>;

      case 'actions':
        return (
          <td className="px-3 py-2.5">
            <div className="flex items-center justify-end gap-1 flex-wrap">
              {row.can_generate && (
                <button
                  onClick={() => generateOne(row)}
                  disabled={busy !== null}
                  title="Raise this cycle's statement and invoice now, through the same generator the nightly run uses"
                  className="px-2 py-1 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40 flex items-center gap-1"
                >
                  {busy === `gen:${row.billing_account_id}` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                  Generate Billing
                </button>
              )}

              {row.can_dismiss && (
                <button
                  onClick={() => setDismissTarget([row])}
                  disabled={busy !== null}
                  title="Mark this account as deliberately not billed for this cycle"
                  className={`px-2 py-1 rounded border text-[11px] font-medium disabled:opacity-40 flex items-center gap-1 ${card} ${muted}`}
                >
                  <Ban className="w-3 h-3" />
                  Dismiss
                </button>
              )}

              {row.reason === 'dismissed' && (
                <button
                  onClick={() => restoreOne(row)}
                  disabled={busy !== null}
                  title="Put this account back on the worklist"
                  className={`px-2 py-1 rounded border text-[11px] font-medium disabled:opacity-40 flex items-center gap-1 ${card} ${muted}`}
                >
                  {busy === `res:${row.billing_account_id}` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3 h-3" />
                  )}
                  Restore
                </button>
              )}

              {!row.can_generate && !row.can_dismiss && row.reason !== 'dismissed' && (
                <span className={`text-[11px] ${muted}`}>—</span>
              )}
            </div>
          </td>
        );

      default:
        return <td className="px-3 py-2.5" />;
    }
  };

  const renderHeaderCell = (column: DataGridColumn<BillingReconcileRow>) =>
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

  const cycleNote = data
    ? `Cycle ${data.period}${
        data.advance_generation_day > 0
          ? ` · generated ${data.advance_generation_day} day${data.advance_generation_day === 1 ? '' : 's'} ahead`
          : ''
      }`
    : 'Reading the cycle…';

  return (
    <ToolShell
      title="Billing Reconcile"
      isDarkMode={isDarkMode}
      colorPalette={colorPalette}
      isMobile={isMobile}
      allLabel="All Ungenerated"
      allCount={summary?.ungenerated ?? 0}
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
        <div className={`px-4 py-2 text-[11px] border-b ${muted} ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          {cycleNote}
        </div>
      }
      toolbar={
        <ToolToolbar
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          searchQuery={search}
          onSearch={setSearch}
          searchPlaceholder="Search by account number, subscriber name or plan..."
          onOpenFilter={() => setFunnelOpen(true)}
          activeFilterCount={Object.keys(funnelFilters).length}
          columns={grid.columns}
          hiddenKeys={grid.hiddenKeys}
          onToggleColumn={grid.toggleColumn}
          onResetColumns={grid.resetColumns}
          onExport={() => grid.toCsv(`billing_reconcile_${data?.period ?? 'cycle'}`)}
          exportDisabled={grid.filteredCount === 0}
          onRefresh={load}
          refreshing={loading}
          refreshTitle="Re-run the audit for this cycle"
        >
          <label className={`flex items-center gap-2 text-xs whitespace-nowrap flex-shrink-0 ${muted}`}>
            <input
              type="checkbox"
              checked={includeOk}
              onChange={(event) => setIncludeOk(event.target.checked)}
              className="rounded"
            />
            Show billed
          </label>
        </ToolToolbar>
      }
      banner={
        selectedRows.length > 0 ? (
          <div className="mx-4 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex flex-wrap items-center gap-2">
            <span className={`text-sm font-medium ${text}`}>
              {selectedRows.length} selected · {generatableSelection.length} billable
            </span>
            <div className="flex-1" />
            <button
              onClick={generateSelected}
              disabled={busy !== null || generatableSelection.length === 0}
              className="px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-500 text-xs font-medium flex items-center gap-1.5 hover:bg-emerald-500/10 disabled:opacity-40"
            >
              {busy === 'bulk:generate' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Generate Billing ({generatableSelection.length})
            </button>
            <button
              onClick={() => setDismissTarget(dismissableSelection)}
              disabled={busy !== null || dismissableSelection.length === 0}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-40 ${card} ${text}`}
            >
              <Ban className="w-3.5 h-3.5" />
              Dismiss ({dismissableSelection.length})
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
        rowKey={(row) => String(row.billing_account_id)}
        loading={loading}
        emptyMessage="Every account due this cycle has been billed."
        storageKey="billing_reconcile.widths"
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
        title="Billing Reconcile Filters"
        subtitle="Narrow the worklist by column"
        storageKey="billing_reconcile.funnel"
        optionsByKey={funnelOptions}
      />

      {dismissTarget && dismissTarget.length > 0 && (
        <div className="fixed inset-0 z-[900] bg-black/50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-xl border p-4 ${card}`}>
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h2 className={`text-sm font-semibold ${text}`}>
                  Mark {dismissTarget.length} account{dismissTarget.length === 1 ? '' : 's'} do-not-generate?
                </h2>
                <p className={`text-xs mt-1 ${muted}`}>
                  They drop off this cycle's worklist. The decision covers {data?.period ?? 'this cycle'} only — next
                  cycle they are reconsidered. Nothing is billed, cancelled or written to the account.
                </p>
              </div>
            </div>

            <input
              value={dismissReason}
              onChange={(event) => setDismissReason(event.target.value)}
              placeholder="Reason (optional, recorded against the decision)"
              className={`w-full px-3 py-2 rounded-lg border text-sm mb-3 ${input}`}
            />

            <div className="flex items-center gap-2">
              <button
                onClick={confirmDismiss}
                disabled={busy !== null}
                className="flex-1 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                onClick={() => {
                  setDismissTarget(null);
                  setDismissReason('');
                }}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium ${card} ${text}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
};

export default BillingReconcileTool;
