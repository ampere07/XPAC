import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Edit, Trash2, FileText, Wallet, CheckCircle2, AlertTriangle, Scale,
  Banknote, Repeat, ChevronLeft, ChevronRight, RefreshCw,
} from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import MonthlyPayableFormModal from '../modals/MonthlyPayableFormModal';
import RecordPaymentModal from '../modals/RecordPaymentModal';
import {
  getMonthlyPayables,
  createMonthlyPayable,
  updateMonthlyPayable,
  deleteMonthlyPayable,
  recordPayablePayment,
  deletePayablePayment,
  generateMonthlyBatch,
  currentBillingMonth,
  MonthlyPayable,
  PayableFilters,
  PayablePayload,
  PaymentPayload,
  PayableSummary,
  PayableStatus,
  PayablePayment,
  PAYABLE_STATUSES,
  STATUS_STYLES,
} from '../services/monthlyPayableService';
import { getExpensesCategories, ExpensesCategory } from '../services/expensesCategoryService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import pusher from '../services/pusherService';
import { usePageActions } from '../hooks/usePageActions';

const peso = (value: number) =>
  `₱${(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EMPTY_SUMMARY: PayableSummary = {
  total_due: 0,
  total_paid: 0,
  outstanding: 0,
  total_count: 0,
  overdue_count: 0,
  overdue_amount: 0,
  due_today: 0,
  by_status: { pending: 0, partial: 0, paid: 0, overdue: 0, cancelled: 0 },
};

/** Shifts a 'YYYY-MM' string by whole months without tripping over year boundaries. */
const shiftMonth = (billingMonth: string, delta: number): string => {
  const [year, month] = billingMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const MonthlyPayables: React.FC = () => {
  // Add, Edit and Delete are granted separately (monthly-payables.create / .edit /
  // .delete), plus .generate for Generate Month and .pay for logging a payment:
  // the same keys the API checks, so a control is drawn only when the request
  // behind it would succeed.
  const actions = usePageActions('monthly-payables');

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [payables, setPayables] = useState<MonthlyPayable[]>([]);
  const [summary, setSummary] = useState<PayableSummary>(EMPTY_SUMMARY);
  const [categories, setCategories] = useState<ExpensesCategory[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [billingMonth, setBillingMonth] = useState(currentBillingMonth());
  const [statusFilter, setStatusFilter] = useState<PayableStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<number | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<MonthlyPayable | null>(null);
  const [payingId, setPayingId] = useState<number | null>(null);

  // Search goes to the server alongside the rest: the table is paginated, so filtering the
  // current page client-side would hide matches sitting on page two.
  const filters: PayableFilters = useMemo(
    () => ({
      billing_month: billingMonth,
      status: statusFilter,
      category_id: categoryFilter,
      search: searchQuery.trim() || undefined,
      page,
    }),
    [billingMonth, statusFilter, categoryFilter, searchQuery, page]
  );

  const fetchData = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        setError(null);

        const result = await getMonthlyPayables(filters);

        setPayables(result.data);
        setSummary(result.summary);
        setLastPage(result.meta?.last_page ?? 1);
        setTotal(result.meta?.total ?? result.data.length);
      } catch (err: any) {
        console.error('Error fetching monthly payables:', err);
        setError(err?.response?.data?.message || err?.message || 'Failed to load monthly payables.');
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  useEffect(() => {
    const applyTheme = () => setIsDarkMode(localStorage.getItem('theme') !== 'light');
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    getExpensesCategories().then(setCategories);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Real-time updates via Pusher/Soketi. The channel is shared with the sidebar's overdue
  // badge, so cleanup unbinds this handler but deliberately does NOT unsubscribe —
  // pusher.unsubscribe() tears the channel down for every listener, and the sidebar
  // outlives this page.
  useEffect(() => {
    const handleUpdate = () => {
      fetchData(true).catch((err) =>
        console.error('[MonthlyPayables Soketi] Failed to refresh data:', err)
      );
    };

    const channel = pusher.subscribe('monthly-payables');
    channel.bind('monthly-payables-updated', handleUpdate);

    return () => {
      channel.unbind('monthly-payables-updated', handleUpdate);
    };
  }, [fetchData]);

  const paying = useMemo(
    () => payables.find((p) => p.id === payingId) ?? null,
    [payables, payingId]
  );

  /**
   * Every filter change resets to page 1 in the same handler rather than in a follow-up
   * effect. Doing it in an effect would let one render escape with the new filter and the
   * old page number, firing a request for a page that no longer exists.
   */
  const changeStatus = (value: PayableStatus | '') => {
    setStatusFilter(value);
    setPage(1);
  };

  const changeCategory = (value: number | '') => {
    setCategoryFilter(value);
    setPage(1);
  };

  const changeSearch = (value: string) => {
    setSearchQuery(value);
    setPage(1);
  };

  const changeMonth = (value: string) => {
    setBillingMonth(value || currentBillingMonth());
    setPage(1);
  };

  const handleAdd = () => {
    if (!actions.canCreate) return;
    setEditing(null);
    setIsFormOpen(true);
  };

  const handleEdit = (payable: MonthlyPayable) => {
    if (!actions.canEdit) return;
    setEditing(payable);
    setIsFormOpen(true);
  };

  const handleSave = async (payload: PayablePayload) => {
    if (editing) {
      await updateMonthlyPayable(editing.id, payload);
    } else {
      await createMonthlyPayable(payload);
    }
    // Refetch rather than splice: the metric cards have to move with the row.
    await fetchData(true);
  };

  const handleDelete = async (payable: MonthlyPayable) => {
    if (!actions.canDelete) return;
    if (!window.confirm(`Delete "${payable.title}" (${peso(payable.amountDue)})?`)) return;

    try {
      await deleteMonthlyPayable(payable.id);
      await fetchData(true);
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to delete payable. Please try again.');
    }
  };

  const handleRecordPayment = async (payload: PaymentPayload) => {
    if (!actions.can('pay')) return;
    if (!paying) return;
    await recordPayablePayment(paying.id, payload);
    await fetchData(true);
  };

  const handleDeletePayment = async (payment: PayablePayment) => {
    if (!actions.can('pay')) return;
    if (!paying) return;
    await deletePayablePayment(paying.id, payment.id);
    await fetchData(true);
  };

  /** Carries last month's recurring bills into the period currently on screen. */
  const handleGenerate = async () => {
    if (!actions.can('generate')) return;
    const source = shiftMonth(billingMonth, -1);
    if (
      !window.confirm(
        `Generate ${billingMonth} payables from the recurring bills in ${source}?\n\n` +
          'Bills already present in this month are skipped, so running this twice is safe.'
      )
    ) {
      return;
    }

    setGenerating(true);
    setNotice(null);

    try {
      const { message } = await generateMonthlyBatch(billingMonth, source);
      setNotice(message);
      await fetchData(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to generate payables.');
    } finally {
      setGenerating(false);
    }
  };

  const clearFilters = () => {
    setStatusFilter('');
    setCategoryFilter('');
    setSearchQuery('');
    setBillingMonth(currentBillingMonth());
    setPage(1);
  };

  const hasFilters = Boolean(
    statusFilter || categoryFilter || searchQuery || billingMonth !== currentBillingMonth()
  );

  const accent = colorPalette?.primary || '#7c3aed';

  const cardClass = `rounded-xl border p-5 ${
    isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
  }`;

  const controlClass = `px-3 h-[38px] border rounded text-sm focus:outline-none ${
    isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
  }`;

  const summaryCard = (
    title: string,
    value: string,
    sub: string,
    icon: React.ReactNode,
    iconColor: string,
    valueColor?: string
  ) => (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-[11px] font-semibold uppercase tracking-wider ${
            isDarkMode ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          {title}
        </span>
        <span className={iconColor}>{icon}</span>
      </div>
      <div className={`text-2xl font-bold ${valueColor || (isDarkMode ? 'text-white' : 'text-gray-900')}`}>
        {loading && payables.length === 0 ? '…' : value}
      </div>
      <div className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>{sub}</div>
    </div>
  );

  const th = `text-left py-3 px-4 font-medium whitespace-nowrap ${
    isDarkMode ? 'text-gray-400' : 'text-gray-600'
  }`;
  const td = `py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'}`;

  return (
    <div className={`h-full flex flex-col ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Header */}
      <div
        className={`px-6 py-4 border-b flex-shrink-0 flex items-center justify-between gap-4 ${
          isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <div>
          <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Monthly Payables
          </h1>
          <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Rent, utilities, bandwidth, subscriptions, retainers and supplier dues owed for a
            billing period.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions.can('generate') && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className={`px-4 py-2 border rounded text-sm flex items-center gap-2 transition-colors disabled:opacity-50 ${
                isDarkMode
                  ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
              title={`Copy recurring bills from ${shiftMonth(billingMonth, -1)} into ${billingMonth}`}
            >
              <Repeat size={16} className={generating ? 'animate-spin' : ''} />
              <span>{generating ? 'Generating…' : 'Generate Month'}</span>
            </button>
          )}
          {actions.canCreate && (
            <button
              onClick={handleAdd}
              className="text-white px-4 py-2 rounded text-sm flex items-center gap-2 transition-colors"
              style={{ backgroundColor: accent }}
            >
              <Plus size={16} />
              <span>Add Payable</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {error && (
            <div className="p-4 rounded border border-red-500/40 bg-red-500/10 text-red-500 text-sm flex items-center justify-between gap-4">
              <span>{error}</span>
              <button onClick={() => fetchData()} className="underline flex-shrink-0">
                Retry
              </button>
            </div>
          )}

          {notice && (
            <div className="p-4 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-sm flex items-center justify-between gap-4">
              <span>{notice}</span>
              <button onClick={() => setNotice(null)} className="underline flex-shrink-0">
                Dismiss
              </button>
            </div>
          )}

          {/* Metric cards — computed over the whole filtered period, not just this page. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {summaryCard(
              'Total Payables',
              peso(summary.total_due),
              `${summary.total_count} bill${summary.total_count === 1 ? '' : 's'} in ${billingMonth}`,
              <Wallet size={18} />,
              'text-indigo-500'
            )}
            {summaryCard(
              'Paid Amount',
              peso(summary.total_paid),
              `${summary.by_status.paid} fully settled`,
              <CheckCircle2 size={18} />,
              'text-emerald-500'
            )}
            {summaryCard(
              'Remaining Balance',
              peso(summary.outstanding),
              `${summary.by_status.partial} partially paid`,
              <Scale size={18} />,
              'text-amber-500'
            )}
            {summaryCard(
              'Overdue',
              String(summary.overdue_count),
              summary.overdue_count > 0
                ? `${peso(summary.overdue_amount)} past due · ${summary.due_today} due today`
                : `${summary.due_today} due today`,
              <AlertTriangle size={18} />,
              'text-red-500',
              summary.overdue_count > 0 ? 'text-red-500' : undefined
            )}
          </div>

          {/* Filter bar */}
          <div className={`${cardClass} space-y-4`}>
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <GlobalSearch
                searchQuery={searchQuery}
                setSearchQuery={changeSearch}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
                placeholder="Search title, vendor, account number, notes…"
              />

              <div className="flex flex-wrap items-center gap-3">
                {/* Billing period stepper — the month is the primary axis of this page. */}
                <div className="flex items-center">
                  <button
                    onClick={() => changeMonth(shiftMonth(billingMonth, -1))}
                    className={`h-[38px] px-2 border rounded-l ${
                      isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                    }`}
                    title="Previous month"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <input
                    type="month"
                    value={billingMonth}
                    onChange={(e) => changeMonth(e.target.value)}
                    className={`${controlClass} rounded-none border-l-0 border-r-0`}
                    title="Billing period"
                  />
                  <button
                    onClick={() => changeMonth(shiftMonth(billingMonth, 1))}
                    className={`h-[38px] px-2 border rounded-r ${
                      isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                    }`}
                    title="Next month"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => changeStatus(e.target.value as PayableStatus | '')}
                  className={controlClass}
                >
                  <option value="">All statuses</option>
                  {PAYABLE_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label} ({summary.by_status[status.value]})
                    </option>
                  ))}
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) => changeCategory(e.target.value ? Number(e.target.value) : '')}
                  className={controlClass}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => fetchData()}
                  className={`h-[38px] px-3 border rounded ${
                    isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                  title="Refresh"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>

                {hasFilters && (
                  <button
                    onClick={clearFilters}
                    className={`text-sm underline ${
                      isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div
            className={`rounded-xl border overflow-hidden ${
              isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}
          >
            <div className="overflow-x-auto">
              <table className="w-max min-w-full text-sm">
                <thead>
                  <tr
                    className={`border-b ${
                      isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <th className={th}>Title</th>
                    <th className={th}>Category</th>
                    <th className={th}>Vendor</th>
                    <th className={th}>Due Date</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={`${th} text-right`}>Paid</th>
                    <th className={`${th} text-right`}>Balance</th>
                    <th className={th}>Status</th>
                    <th className={`${th} text-center`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={9}
                        className={`px-4 py-12 text-center ${
                          isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}
                      >
                        Loading payables…
                      </td>
                    </tr>
                  ) : payables.length > 0 ? (
                    payables.map((payable) => (
                      <tr
                        key={payable.id}
                        className={`border-b transition-colors ${
                          isDarkMode
                            ? 'border-gray-800 hover:bg-gray-800'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <td className={td}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{payable.title}</span>
                            {payable.isRecurring && (
                              <Repeat
                                size={13}
                                className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}
                              />
                            )}
                          </div>
                          {payable.accountNumber && (
                            <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                              {payable.accountNumber}
                            </div>
                          )}
                        </td>
                        <td className={td}>{payable.categoryName}</td>
                        <td className={td} title={payable.vendorName}>
                          {payable.vendorName || '—'}
                        </td>
                        {/* Red whenever the bill is late and unsettled — independent of the
                            status badge, which reads 'partial' once any money lands. */}
                        <td
                          className={`py-3 px-4 whitespace-nowrap ${
                            payable.isPastDue
                              ? 'text-red-500 font-semibold'
                              : isDarkMode
                              ? 'text-white'
                              : 'text-gray-900'
                          }`}
                          title={
                            payable.isPastDue ? `${payable.daysOverdue} day(s) past due` : undefined
                          }
                        >
                          {payable.dueDate}
                          {payable.isPastDue && (
                            <span className="ml-1 text-[10px] font-bold">
                              (+{payable.daysOverdue}d)
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-right font-semibold`}>{peso(payable.amountDue)}</td>
                        <td
                          className={`py-3 px-4 whitespace-nowrap text-right ${
                            payable.amountPaid > 0
                              ? 'text-emerald-500'
                              : isDarkMode
                              ? 'text-gray-500'
                              : 'text-gray-400'
                          }`}
                        >
                          {peso(payable.amountPaid)}
                        </td>
                        <td
                          className={`py-3 px-4 whitespace-nowrap text-right font-semibold ${
                            payable.balance > 0
                              ? 'text-amber-500'
                              : isDarkMode
                              ? 'text-gray-500'
                              : 'text-gray-400'
                          }`}
                        >
                          {peso(payable.balance)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              STATUS_STYLES[payable.status]
                            }`}
                          >
                            {payable.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-1">
                            {actions.can('pay') && (
                              <button
                                onClick={() => setPayingId(payable.id)}
                                disabled={payable.status === 'cancelled'}
                                className={`p-2 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                                  isDarkMode
                                    ? 'text-gray-400 hover:text-emerald-400'
                                    : 'text-gray-600 hover:text-emerald-600'
                                }`}
                                title={
                                  payable.status === 'cancelled'
                                    ? 'Cancelled — reopen it first'
                                    : 'Log payment'
                                }
                              >
                                <Banknote size={16} />
                              </button>
                            )}
                            {payable.receiptPath ? (
                              <a
                                href={payable.receiptPath}
                                target="_blank"
                                rel="noreferrer"
                                className="p-2 rounded inline-flex"
                                style={{ color: accent }}
                                title="View receipt"
                              >
                                <FileText size={16} />
                              </a>
                            ) : (
                              <span className="p-2 inline-flex opacity-25">
                                <FileText size={16} />
                              </span>
                            )}
                            {actions.canEdit && (
                              <button
                                onClick={() => handleEdit(payable)}
                                className={`p-2 rounded transition-colors ${
                                  isDarkMode
                                    ? 'text-gray-400 hover:text-green-400'
                                    : 'text-gray-600 hover:text-green-600'
                                }`}
                                title="Edit"
                              >
                                <Edit size={16} />
                              </button>
                            )}
                            {actions.canDelete && (
                              <button
                                onClick={() => handleDelete(payable)}
                                className={`p-2 rounded transition-colors ${
                                  isDarkMode
                                    ? 'text-gray-400 hover:text-red-400'
                                    : 'text-gray-600 hover:text-red-600'
                                }`}
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={9}
                        className={`px-4 py-12 text-center ${
                          isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}
                      >
                        {hasFilters
                          ? 'No payables match your filters'
                          : `Nothing recorded for ${billingMonth} — add one, or generate the month from ${shiftMonth(
                              billingMonth,
                              -1
                            )}.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {lastPage > 1 && (
              <div
                className={`flex items-center justify-between gap-4 px-4 py-3 border-t ${
                  isDarkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-600'
                }`}
              >
                <span className="text-xs">
                  Page {page} of {lastPage} · {total} record{total === 1 ? '' : 's'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className={`px-3 py-1.5 border rounded text-xs disabled:opacity-40 ${
                      isDarkMode ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                    disabled={page >= lastPage}
                    className={`px-3 py-1.5 border rounded text-xs disabled:opacity-40 ${
                      isDarkMode ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <MonthlyPayableFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
        payable={editing}
        defaultBillingMonth={billingMonth}
      />

      <RecordPaymentModal
        isOpen={payingId !== null}
        onClose={() => setPayingId(null)}
        onSave={handleRecordPayment}
        onDeletePayment={handleDeletePayment}
        payable={paying}
      />
    </div>
  );
};

export default MonthlyPayables;
