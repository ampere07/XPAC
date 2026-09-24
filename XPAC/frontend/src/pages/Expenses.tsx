import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Edit, Trash2, Download, FileText, CalendarDays, CalendarRange, Wallet, Hash,
  Building2, HardDrive,
} from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import ExpensesFormModal from '../modals/ExpensesFormModal';
import {
  getExpenses,
  getExpenseSummary,
  createExpense,
  updateExpense,
  deleteExpense,
  exportExpensesCsv,
  Expense,
  ExpenseFilters,
  ExpensePayload,
  ExpenseSummary,
  ExpenseType,
  ExpenseFrequency,
  EXPENSE_TYPES,
  EXPENSE_FREQUENCIES,
} from '../services/expensesService';
import { getExpensesCategories, ExpensesCategory } from '../services/expensesCategoryService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import pusher from '../services/pusherService';
import { usePageActions } from '../hooks/usePageActions';

const peso = (value: number) =>
  `₱${(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Expenses: React.FC = () => {
  // Add, Edit and Delete are granted separately (expenses.create / .edit /
  // .delete), the same keys the API checks, so a control is drawn only when
  // the request behind it would succeed.
  const actions = usePageActions('expenses');

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [categories, setCategories] = useState<ExpensesCategory[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ExpenseType | ''>('');
  const [frequencyFilter, setFrequencyFilter] = useState<ExpenseFrequency | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<number | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  // Search is applied client-side for instant feedback; the rest are sent to the
  // API so the totals and the CSV reflect the same slice the table shows.
  const serverFilters: ExpenseFilters = useMemo(
    () => ({
      expense_type: typeFilter,
      frequency: frequencyFilter,
      category_id: categoryFilter,
      date_from: dateFrom,
      date_to: dateTo,
    }),
    [typeFilter, frequencyFilter, categoryFilter, dateFrom, dateTo]
  );

  const fetchData = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        setError(null);

        const [rows, totals] = await Promise.all([
          getExpenses(serverFilters),
          getExpenseSummary(categoryFilter),
        ]);

        setExpenses(rows);
        setSummary(totals);
      } catch (err: any) {
        console.error('Error fetching expenses:', err);
        setError(err?.response?.data?.message || 'Failed to load expenses.');
      } finally {
        setLoading(false);
      }
    },
    [serverFilters, categoryFilter]
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

  // Real-time updates via Pusher/Soketi
  useEffect(() => {
    const handleUpdate = () => {
      fetchData(true).catch((err) =>
        console.error('[Expenses Soketi] Failed to refresh data:', err)
      );
    };

    const channel = pusher.subscribe('expenses');
    channel.bind('expenses-updated', handleUpdate);

    return () => {
      channel.unbind('expenses-updated', handleUpdate);
      pusher.unsubscribe('expenses');
    };
  }, [fetchData]);

  const filteredExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return expenses;

    return expenses.filter((e) =>
      [e.payee, e.description, e.category, e.invoiceNo, e.provider, e.supplier]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q))
    );
  }, [expenses, searchQuery]);

  const handleAdd = () => {
    if (!actions.canCreate) return;
    setEditing(null);
    setIsModalOpen(true);
  };

  const handleEdit = (expense: Expense) => {
    if (!actions.canEdit) return;
    setEditing(expense);
    setIsModalOpen(true);
  };

  const handleSave = async (payload: ExpensePayload) => {
    if (editing) {
      await updateExpense(editing.id, payload);
    } else {
      await createExpense(payload);
    }
    // Refetch instead of splicing: the summary totals have to move with the row.
    await fetchData(true);
  };

  const handleDelete = async (expense: Expense) => {
    if (!actions.canDelete) return;
    if (!window.confirm(`Delete this ${expense.expenseType} expense of ${peso(expense.amount)}?`)) {
      return;
    }

    try {
      await deleteExpense(expense.id);
      await fetchData(true);
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to delete expense. Please try again.');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportExpensesCsv({ ...serverFilters, search: searchQuery.trim() || undefined });
    } catch (err: any) {
      console.error('Error exporting expenses:', err);
      alert('Failed to export CSV. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setTypeFilter('');
    setFrequencyFilter('');
    setCategoryFilter('');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
  };

  const hasFilters = Boolean(
    typeFilter || frequencyFilter || categoryFilter || dateFrom || dateTo || searchQuery
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
    iconColor: string
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
      <div className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
        {loading && !summary ? '…' : value}
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
        <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          Expenses
        </h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleExport}
            disabled={exporting}
            className={`px-4 py-2 border rounded text-sm flex items-center gap-2 transition-colors disabled:opacity-50 ${
              isDarkMode
                ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Download size={16} />
            <span>{exporting ? 'Exporting…' : 'CSV'}</span>
          </button>
          {actions.canCreate && (
            <button
              onClick={handleAdd}
              className="text-white px-4 py-2 rounded text-sm flex items-center gap-2 transition-colors"
              style={{ backgroundColor: accent }}
            >
              <Plus size={16} />
              <span>Add Expense</span>
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

          {/* Summary cards.
              Two rows because the table now records two independent facts. The
              first row splits by frequency (which card an expense lands in); the
              second splits by nature (OpEx against CapEx), which is the split the
              executive dashboard reports and the one that decides whether the
              spend belongs against this month's result at all. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {summaryCard(
              'Daily Expenses (Today)',
              peso(summary?.daily_today ?? 0),
              summary?.scope.today ?? '',
              <CalendarDays size={18} />,
              'text-emerald-500'
            )}
            {summaryCard(
              'Monthly Expenses (This Month)',
              peso(summary?.monthly_this_month ?? 0),
              summary ? `${summary.scope.month_start} → ${summary.scope.month_end}` : '',
              <CalendarRange size={18} />,
              'text-indigo-500'
            )}
            {summaryCard(
              'Total This Month',
              peso(summary?.total_this_month ?? 0),
              'Daily + monthly combined',
              <Wallet size={18} />,
              'text-orange-500'
            )}
            {summaryCard(
              'Records This Month',
              String(summary?.count_this_month ?? 0),
              `${summary?.count_today ?? 0} recorded today`,
              <Hash size={18} />,
              'text-sky-500'
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {summaryCard(
              'OPEX This Month',
              peso(summary?.opex_this_month ?? 0),
              `${summary?.opex_count ?? 0} operating entries — consumed in the period`,
              <Building2 size={18} />,
              'text-amber-500'
            )}
            {summaryCard(
              'CAPEX This Month',
              peso(summary?.capex_this_month ?? 0),
              `${summary?.capex_count ?? 0} capital entries — assets that outlive the period`,
              <HardDrive size={18} />,
              'text-violet-500'
            )}
          </div>

          {/* Filters */}
          <div className={`${cardClass} space-y-4`}>
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <GlobalSearch
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
                placeholder="Search payee, description, category, invoice…"
              />

              <div className="flex flex-wrap items-center gap-3">
                {/* Two selects, because the two facts filter independently —
                    "show me every capital purchase" and "show me the monthly
                    ones" are different questions, and one combined dropdown
                    could not ask either without excluding the other. */}
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as ExpenseType | '')}
                  className={controlClass}
                  title="Expense type"
                >
                  <option value="">All types</option>
                  {EXPENSE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>

                <select
                  value={frequencyFilter}
                  onChange={(e) => setFrequencyFilter(e.target.value as ExpenseFrequency | '')}
                  className={controlClass}
                  title="Frequency"
                >
                  <option value="">All frequencies</option>
                  {EXPENSE_FREQUENCIES.map((frequency) => (
                    <option key={frequency.value} value={frequency.value}>
                      {frequency.label}
                    </option>
                  ))}
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value ? Number(e.target.value) : '')}
                  className={controlClass}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={controlClass}
                  title="From date"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={controlClass}
                  title="To date"
                />

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

          {/* List */}
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
                    <th className={th}>Date</th>
                    <th className={th}>Type</th>
                    <th className={th}>Frequency</th>
                    <th className={th}>Category</th>
                    <th className={th}>Payee</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={th}>Description</th>
                    <th className={th}>Invoice No.</th>
                    <th className={th}>Receipt</th>
                    <th className={th}>Modified By</th>
                    <th className={`${th} text-center`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={11}
                        className={`px-4 py-12 text-center ${
                          isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}
                      >
                        Loading expenses…
                      </td>
                    </tr>
                  ) : filteredExpenses.length > 0 ? (
                    filteredExpenses.map((expense) => (
                      <tr
                        key={expense.id}
                        className={`border-b transition-colors ${
                          isDarkMode
                            ? 'border-gray-800 hover:bg-gray-800'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <td className={td}>{expense.date}</td>
                        {/* Distinct colour families for the two axes, so a glance
                            down the table never confuses "capital" with
                            "monthly" — they are different questions. */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              expense.expenseType === 'CAPEX'
                                ? 'bg-violet-500/10 text-violet-500'
                                : 'bg-amber-500/10 text-amber-500'
                            }`}
                          >
                            {expense.expenseType || 'OPEX'}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              expense.frequency === 'Monthly'
                                ? 'bg-indigo-500/10 text-indigo-500'
                                : 'bg-emerald-500/10 text-emerald-500'
                            }`}
                          >
                            {expense.frequency || 'Daily'}
                          </span>
                        </td>
                        <td className={td}>{expense.category || '—'}</td>
                        <td className={td} title={expense.payee}>
                          {expense.payee || '—'}
                        </td>
                        <td className={`${td} text-right font-semibold`}>{peso(expense.amount)}</td>
                        <td
                          className={`py-3 px-4 max-w-xs truncate ${
                            isDarkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}
                          title={expense.description}
                        >
                          {expense.description || '—'}
                        </td>
                        <td className={td}>{expense.invoiceNo || '—'}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {expense.photo ? (
                            <a
                              href={expense.photo}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex"
                              style={{ color: accent }}
                              title="View receipt"
                            >
                              <FileText size={16} />
                            </a>
                          ) : (
                            <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>—</span>
                          )}
                        </td>
                        <td
                          className={`py-3 px-4 whitespace-nowrap ${
                            isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}
                        >
                          {expense.modifiedBy || '—'}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-1">
                            {actions.canEdit && (
                              <button
                                onClick={() => handleEdit(expense)}
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
                                onClick={() => handleDelete(expense)}
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
                        colSpan={11}
                        className={`px-4 py-12 text-center ${
                          isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}
                      >
                        {expenses.length === 0
                          ? 'No expenses recorded yet — use Add Expense to record one.'
                          : 'No expenses match your filters'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <ExpensesFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
        expense={editing}
      />
    </div>
  );
};

export default Expenses;
