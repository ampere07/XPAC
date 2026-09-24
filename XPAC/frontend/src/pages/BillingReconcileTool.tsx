import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Ban, CalendarClock, CheckCircle2, FileWarning, Loader2, Play,
  RefreshCw, RotateCcw, Search, X,
} from 'lucide-react';
import {
  billingReconcileService,
  type BillingReconcileAudit,
  type BillingReconcileReasons,
  type BillingReconcileRow,
} from '../services/billingReconcileService';
import { useDataGrid, type DataGridColumn } from '../hooks/useDataGrid';
import {
  ColumnMenu,
  ExportButton,
  PageSizeSelector,
  SelectAllHeaderCell,
  SortableHeaderCell,
} from '../components/DataGridControls';

interface BillingReconcileToolProps {
  isDarkMode?: boolean;
}

/**
 * How each reason is badged.
 *
 * Colour carries the operator's next action, not the severity of the word: green is
 * "this one is ready, press Generate", amber is "fix the account first", grey is
 * "nothing to do here". A reason the server adds later renders in the neutral style
 * under its own server-supplied label rather than disappearing.
 */
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
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
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
  { key: 'plan_name', label: 'Plan', value: (row) => row.plan_name ?? '' },
  // Numeric so the column orders by price, not by digit string.
  { key: 'plan_price', label: 'Plan Price', value: (row) => row.plan_price },
  { key: 'billing_day', label: 'Billing Day', value: (row) => row.billing_day },
  { key: 'billing_status', label: 'Billing Status', value: (row) => row.billing_status ?? '' },
  { key: 'generation_type', label: 'Billing Type', value: (row) => row.generation_type ?? '', defaultHidden: true },
  { key: 'account_balance', label: 'Balance', value: (row) => row.account_balance, defaultHidden: true },
  { key: 'date_installed', label: 'Installed', value: (row) => row.date_installed ?? '', defaultHidden: true },
  { key: 'last_invoice_date', label: 'Last Invoice', value: (row) => row.last_invoice_date ?? '', defaultHidden: true },
  { key: 'actions', label: 'Actions', locked: true },
];

const BillingReconcileTool: React.FC<BillingReconcileToolProps> = ({ isDarkMode: isDarkModeProp }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof isDarkModeProp === 'boolean') return isDarkModeProp;
    const theme = localStorage.getItem('theme');
    return theme === 'dark' || theme === null;
  });

  const [data, setData] = useState<BillingReconcileAudit | null>(null);
  const [reasons, setReasons] = useState<BillingReconcileReasons | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [reasonFilter, setReasonFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dayFilter, setDayFilter] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [includeOk, setIncludeOk] = useState(false);

  const [dismissTarget, setDismissTarget] = useState<BillingReconcileRow[] | null>(null);
  const [dismissReason, setDismissReason] = useState('');

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

  // ---- Data --------------------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await billingReconcileService.getAudit({
        reason: reasonFilter || undefined,
        billing_status: statusFilter || undefined,
        billing_day: dayFilter,
        search: search.trim() || undefined,
        include_ok: includeOk,
      });
      setData(result);
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.response?.data?.message || 'Could not read the billing worklist.' });
    } finally {
      setLoading(false);
    }
  }, [reasonFilter, statusFilter, dayFilter, search, includeOk]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // The reason vocabulary comes from the server so the filter and the badges are
    // built from the rules that produced them, not from a second copy in this file.
    billingReconcileService.getReasons().then(setReasons).catch(() => setReasons(null));
  }, []);

  // Memoized so the identity is stable: `data?.rows ?? []` would build a fresh array
  // every render and invalidate everything downstream of it.
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary;

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

  const generatableSelection = useMemo(
    () => selectedRows.filter((row) => row.can_generate),
    [selectedRows]
  );
  const dismissableSelection = useMemo(
    () => selectedRows.filter((row) => row.can_dismiss),
    [selectedRows]
  );

  // ---- Actions -----------------------------------------------------------

  const runAction = useCallback(
    async (key: string, action: () => Promise<{ success: boolean; message: string }>) => {
      setBusy(key);
      try {
        const result = await action();
        setNotice({ tone: result.success ? 'success' : 'error', text: result.message });
        // Generation and dismissal both change which rows belong on the worklist and
        // what the cards say, so the whole audit is re-read rather than patched.
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
      setNotice({ tone: 'info', text: 'None of the selected accounts can be billed from here — fix the flagged reason first.' });
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
  const rowHover = isDarkMode ? 'hover:bg-gray-800/60' : 'hover:bg-gray-50';
  const headRow = isDarkMode ? 'bg-gray-950/60 text-gray-400' : 'bg-gray-50 text-gray-600';

  /**
   * The summary cards, each one a shortcut into the filter it counts.
   *
   * Ordered by what an operator does with them: how much is unbilled, how much of that
   * is billable right now, then the data problems in the order they are usually caused.
   */
  const statCards: Array<{ label: string; value: number; tone: string; reason: string; hint: string }> = summary
    ? [
        {
          label: 'Total Ungenerated',
          value: summary.ungenerated,
          tone: 'text-amber-500',
          reason: '',
          hint: 'Accounts whose billing day has passed with no invoice raised for this cycle.',
        },
        {
          label: 'Ready to Generate',
          value: summary.ready,
          tone: 'text-emerald-500',
          reason: 'ready',
          hint: 'Nothing is wrong with these — the generator simply did not reach them.',
        },
        {
          label: 'Missing Billing Day',
          value: summary.missing_billing_day,
          tone: 'text-amber-500',
          reason: 'missing_billing_day',
          hint: 'No billing day is set, so no scheduled run will ever pick the account up.',
        },
        {
          label: 'Plan Issues',
          value: summary.missing_plan + summary.zero_price,
          tone: 'text-orange-500',
          reason: 'missing_plan',
          hint: 'No plan linked, or a plan priced at 0.00. Fix the account before billing it.',
        },
        {
          label: 'Not Active',
          value: summary.inactive_status,
          tone: 'text-red-500',
          reason: 'inactive_status',
          hint: 'Inactive, suspended or terminated. Scheduled billing only bills Active accounts.',
        },
        {
          label: 'Open Job Order',
          value: summary.open_job_order,
          tone: 'text-purple-400',
          reason: 'open_job_order',
          hint: 'Onboarding is unfinished. Billing an undelivered line is a bill the customer disputes.',
        },
        {
          label: 'Prepaid',
          value: summary.prepaid,
          tone: 'text-blue-400',
          reason: 'prepaid',
          hint: 'Prepaid accounts bill at renewal, not on a billing day. Listed for completeness.',
        },
        {
          label: 'Dismissed',
          value: summary.dismissed,
          tone: 'text-gray-400',
          reason: 'dismissed',
          hint: 'Marked do-not-generate for this cycle. Reconsidered next cycle.',
        },
      ]
    : [];

  const renderCell = (columnKey: string, row: BillingReconcileRow): React.ReactNode => {
    switch (columnKey) {
      case 'select':
        return (
          <td key={columnKey} className="px-3 py-2.5">
            <input
              type="checkbox"
              checked={grid.selected.has(String(row.billing_account_id))}
              disabled={!row.can_generate && !row.can_dismiss}
              onChange={(e) => grid.toggleRow(String(row.billing_account_id), e.target.checked)}
              className="rounded"
            />
          </td>
        );

      case 'account_no':
        return (
          <td key={columnKey} className={`px-3 py-2.5 text-xs font-mono ${text}`}>{row.account_no}</td>
        );

      case 'customer_name':
        return (
          <td key={columnKey} className={`px-3 py-2.5 text-xs ${row.customer_name ? text : muted}`}>
            {row.customer_name || 'no customer record'}
          </td>
        );

      case 'reason':
        return (
          <td key={columnKey} className="px-3 py-2.5">
            <span
              className={`text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap ${
                REASON_TONES[row.reason] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'
              }`}
              title={row.dismissed_reason ?? undefined}
            >
              {row.reason_label}
            </span>
          </td>
        );

      case 'plan_name':
        return (
          <td key={columnKey} className={`px-3 py-2.5 text-xs ${row.plan_name ? text : muted}`}>
            {row.plan_name || 'not linked'}
          </td>
        );

      case 'plan_price':
        // A plan priced at 0.00 is the finding, so it renders as the figure it is and
        // is never collapsed into the same dash as "no plan at all".
        return (
          <td className={`px-3 py-2.5 text-xs text-right font-mono ${row.plan_price === 0 ? 'text-orange-500' : text}`} key={columnKey}>
            {peso(row.plan_price)}
          </td>
        );

      case 'billing_day':
        return (
          <td key={columnKey} className={`px-3 py-2.5 text-xs ${row.billing_day === null ? 'text-amber-500' : muted}`}>
            {billingDayLabel(row.billing_day)}
          </td>
        );

      case 'billing_status':
        return <td key={columnKey} className={`px-3 py-2.5 text-xs ${muted}`}>{row.billing_status || '—'}</td>;

      case 'generation_type':
        return <td key={columnKey} className={`px-3 py-2.5 text-xs ${muted}`}>{row.generation_type || '—'}</td>;

      case 'account_balance':
        return <td key={columnKey} className={`px-3 py-2.5 text-xs text-right font-mono ${muted}`}>{peso(row.account_balance)}</td>;

      case 'date_installed':
        return <td key={columnKey} className={`px-3 py-2.5 text-xs font-mono ${muted}`}>{stamp(row.date_installed)}</td>;

      case 'last_invoice_date':
        return <td key={columnKey} className={`px-3 py-2.5 text-xs font-mono ${muted}`}>{stamp(row.last_invoice_date)}</td>;

      case 'actions':
        return (
          <td key={columnKey} className="px-3 py-2.5">
            <div className="flex items-center justify-end gap-1 flex-wrap">
              {row.can_generate && (
                <button
                  onClick={() => generateOne(row)}
                  disabled={busy !== null}
                  title="Raise this cycle's statement and invoice now, through the same generator the nightly run uses"
                  className="px-2 py-1 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40 flex items-center gap-1"
                >
                  {busy === `gen:${row.billing_account_id}`
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Play className="w-3 h-3" />}
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
                  {busy === `res:${row.billing_account_id}`
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RotateCcw className="w-3 h-3" />}
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
        return <td key={columnKey} className="px-3 py-2.5" />;
    }
  };

  return (
    <div className={`p-4 md:p-6 min-h-full ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/25">
            <FileWarning className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className={`text-xl font-bold ${text}`}>Billing Reconcile</h1>
            <p className={`text-sm ${muted}`}>
              Accounts due for billing this cycle that produced no invoice, and why.
              {data && (
                <> Cycle <strong className={text}>{data.period}</strong>
                  {data.advance_generation_day > 0 && (
                    <> · generated {data.advance_generation_day} day
                      {data.advance_generation_day === 1 ? '' : 's'} ahead of the billing day</>
                  )}.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 disabled:opacity-50 ${card} ${text}`}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

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

      {/* Stat cards — each one filters the table to what it counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-5">
        {statCards.map((stat) => (
          <button
            key={stat.label}
            onClick={() => setReasonFilter(stat.reason)}
            title={stat.hint}
            className={`rounded-xl border p-3 text-left transition-colors hover:border-amber-500/50 ${card} ${
              reasonFilter === stat.reason && stat.reason !== '' ? 'ring-1 ring-amber-500/50' : ''
            }`}
          >
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${muted}`}>{stat.label}</div>
            <div className={`text-2xl font-bold mt-1 ${stat.tone}`}>{stat.value}</div>
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className={`rounded-xl border p-3 mb-4 ${card}`}>
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${muted}`} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by account number, subscriber name or plan…"
              className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm ${input}`}
            />
          </div>

          <select
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
            aria-label="Filter by reason"
            className={`px-3 py-2 rounded-lg border text-sm ${input}`}
          >
            <option value="">All reasons</option>
            {Object.entries(reasons?.labels ?? {}).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <input
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            placeholder="Billing status"
            aria-label="Filter by billing status"
            className={`w-40 px-3 py-2 rounded-lg border text-sm ${input}`}
          />

          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${input}`}>
            <CalendarClock className="w-4 h-4 shrink-0 opacity-70" />
            <input
              value={dayFilter === '' ? '' : String(dayFilter)}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                setDayFilter(digits === '' ? '' : Math.min(31, Number(digits)));
              }}
              placeholder="Day"
              inputMode="numeric"
              aria-label="Filter by billing day"
              className="w-12 bg-transparent text-center focus:outline-none"
            />
          </div>

          <label className={`flex items-center gap-2 text-xs whitespace-nowrap ${muted}`}>
            <input type="checkbox" checked={includeOk} onChange={(e) => setIncludeOk(e.target.checked)} className="rounded" />
            Show billed
          </label>

          <PageSizeSelector
            isDarkMode={isDarkMode}
            pageSize={grid.pageSize}
            onPageSizeChange={grid.setPageSize}
            filteredCount={grid.filteredCount}
          />

          <ExportButton
            isDarkMode={isDarkMode}
            onExport={() => grid.toCsv(`billing_reconcile_${data?.period ?? 'cycle'}`)}
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
        </div>
      </div>

      {/* Bulk bar */}
      {selectedRows.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 mb-4 flex flex-wrap items-center gap-2">
          <span className={`text-sm font-medium ${text}`}>
            {selectedRows.length} selected · {generatableSelection.length} billable
          </span>
          <div className="flex-1" />
          <button
            onClick={generateSelected}
            disabled={busy !== null || generatableSelection.length === 0}
            className="px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-500 text-xs font-medium flex items-center gap-1.5 hover:bg-emerald-500/10 disabled:opacity-40"
          >
            {busy === 'bulk:generate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
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
      )}

      {/* Table */}
      <div className={`rounded-xl border overflow-hidden ${card}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={`text-xs uppercase tracking-wide ${headRow}`}>
              <tr>
                {grid.visibleColumns.map((column) => {
                  if (column.key === 'select') {
                    return (
                      <SelectAllHeaderCell
                        key={column.key}
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
                    );
                  }

                  if (column.key === 'actions') {
                    return (
                      <th key={column.key} className="px-3 py-2.5 text-right font-semibold">{column.label}</th>
                    );
                  }

                  return (
                    <SortableHeaderCell
                      key={column.key}
                      label={column.label}
                      sortable={typeof column.value === 'function'}
                      direction={grid.sortStateFor(column.key).direction}
                      priority={grid.sortStateFor(column.key).priority}
                      onSort={(additive: boolean) => grid.toggleSort(column.key, additive)}
                      align={column.key === 'plan_price' || column.key === 'account_balance' ? 'right' : 'left'}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody className={isDarkMode ? 'divide-y divide-gray-800' : 'divide-y divide-gray-100'}>
              {loading && (
                <tr>
                  <td colSpan={grid.visibleColumns.length} className={`px-4 py-12 text-center ${muted}`}>
                    <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                  </td>
                </tr>
              )}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={grid.visibleColumns.length} className={`px-4 py-12 text-center ${muted}`}>
                    <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                    Every account due this cycle has been billed.
                  </td>
                </tr>
              )}

              {!loading && grid.pagedRows.map((row) => (
                <tr key={row.billing_account_id} className={rowHover}>
                  {grid.visibleColumns.map((column) => renderCell(column.key, row))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {grid.totalPages > 1 && (
          <div className={`flex items-center justify-between px-3 py-2 border-t text-xs ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <span className={muted}>
              Page {grid.page} of {grid.totalPages} · {grid.filteredCount.toLocaleString()} row(s)
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => grid.setPage(Math.max(1, grid.page - 1))}
                disabled={grid.page <= 1}
                className={`px-2 py-1 rounded border disabled:opacity-40 ${card} ${text}`}
              >
                Previous
              </button>
              <button
                onClick={() => grid.setPage(Math.min(grid.totalPages, grid.page + 1))}
                disabled={grid.page >= grid.totalPages}
                className={`px-2 py-1 rounded border disabled:opacity-40 ${card} ${text}`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Dismiss confirmation */}
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
                  They drop off this cycle's worklist. The decision covers {data?.period ?? 'this cycle'} only —
                  next cycle they are reconsidered. Nothing is billed, cancelled or written to the account.
                </p>
              </div>
            </div>

            <input
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
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
                onClick={() => { setDismissTarget(null); setDismissReason(''); }}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium ${card} ${text}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingReconcileTool;
