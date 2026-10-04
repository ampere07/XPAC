import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { RefreshCw, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, Receipt, Wrench } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import ForApprovalDetails, { ForApprovalRecord, forApprovalRecordKey } from '../components/ForApprovalDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import {
  forApprovalService,
  ForApprovalCategory,
  ForApprovalCounts,
  ForApprovalPagination,
  ForApprovalTransaction,
} from '../services/forApprovalService';
import { notifyNavBadgesChanged } from '../services/navBadgeService';
import pusher from '../services/pusherService';
import { JobOrder } from '../types/jobOrder';
import { useUserDirectory } from '../hooks/useUserDirectory';
import { resolveUserDisplayName } from '../utils/userDisplay';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

const CATEGORIES: Array<{ id: ForApprovalCategory; label: string; icon: React.ElementType; countKey: keyof ForApprovalCounts }> = [
  { id: 'transactions', label: 'Transactions', icon: Receipt, countKey: 'transactions' },
  { id: 'job-orders', label: 'Job Orders', icon: Wrench, countKey: 'job_orders' },
];

const EMPTY_COUNTS: ForApprovalCounts = { transactions: 0, job_orders: 0, total: 0 };

/** Waits this long after the last keystroke before searching the server. */
const SEARCH_DEBOUNCE_MS = 350;
/** Safety net for changes nothing broadcasts, e.g. a job order marked Done from the mobile app. */
const POLL_INTERVAL_MS = 60 * 1000;

/**
 * Rows as they were fetched, kept with the category they belong to, so switching tabs never
 * draws the old category's rows under the new category's columns while the next page loads.
 */
type ListState =
  | { category: 'transactions'; rows: ForApprovalTransaction[] }
  | { category: 'job-orders'; rows: JobOrder[] };

const formatDate = (value?: string | null, includeTime = false): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);

  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const datePart = `${mm}/${dd}/${date.getFullYear()}`;
  if (!includeTime) return datePart;

  const hours = date.getHours() % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${datePart} ${hours}:${minutes} ${date.getHours() >= 12 ? 'PM' : 'AM'}`;
};

const formatMoney = (amount: number | string | null | undefined): string => {
  const value = typeof amount === 'number' ? amount : parseFloat(String(amount ?? '').replace(/[^0-9.-]/g, ''));
  const safe = Number.isFinite(value) ? value : 0;
  return `₱${safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const toRecord = (list: ListState, index: number): ForApprovalRecord =>
  list.category === 'transactions'
    ? { category: 'transactions', transaction: list.rows[index] }
    : { category: 'job-orders', jobOrder: list.rows[index] };

/**
 * For Approval: every pending transaction and every job order whose onsite work is Done, in one
 * queue, with a side panel to review and approve each one.
 *
 * Who may open it is the 'for-approval' key (Administrator and SuperAdmin among the seeded
 * roles), checked by Dashboard's section guard here and by the API on every request. Approving
 * runs the same approval as the record's own page — see ForApprovalDetails.
 *
 * Paged, searched and counted on the server, so the page costs the same with ten records waiting
 * as with ten thousand.
 */
const ForApproval: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const userDirectory = useUserDirectory();

  const [category, setCategory] = useState<ForApprovalCategory>('transactions');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const [list, setList] = useState<ListState>({ category: 'transactions', rows: [] });
  const [pagination, setPagination] = useState<ForApprovalPagination | null>(null);
  const [counts, setCounts] = useState<ForApprovalCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ForApprovalRecord | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only the newest request may write to the list: a slow page must not overwrite a newer one.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setIsDarkMode(localStorage.getItem('theme') === 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(setColorPalette)
      .catch(err => console.error('Failed to fetch color palette:', err));

    paymentMethodService.getAll().then(res => {
      if (res.success && Array.isArray(res.data)) setPaymentMethods(res.data);
    });
  }, []);

  // A new search starts again from the first page — set together, so it is one request.
  useEffect(() => {
    const next = searchQuery.trim();
    if (next === debouncedSearch) return;

    const timer = setTimeout(() => {
      setDebouncedSearch(next);
      setCurrentPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery, debouncedSearch]);

  /** `silent` keeps the rows on screen while refreshing — for live updates and after an approval. */
  const loadPage = useCallback(async (silent = false) => {
    const requestId = ++requestIdRef.current;

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const query = { page: currentPage, limit: itemsPerPage, search: debouncedSearch };

      let result;
      let fresh: ListState;
      if (category === 'transactions') {
        result = await forApprovalService.getTransactions(query);
        fresh = { category: 'transactions', rows: result.rows };
      } else {
        result = await forApprovalService.getJobOrders(query);
        fresh = { category: 'job-orders', rows: result.rows };
      }

      if (requestId !== requestIdRef.current) return;

      setList(fresh);
      // The open panel shows the refreshed row, so what is approved is what is on screen. A row
      // that has left the queue (just approved) stays as it was until its panel is closed.
      setSelected(current => {
        if (!current || current.category !== fresh.category) return current;
        const key = forApprovalRecordKey(current);
        const index = fresh.rows.findIndex((_, i) => forApprovalRecordKey(toRecord(fresh, i)) === key);
        return index === -1 ? current : toRecord(fresh, index);
      });
      setPagination(result.pagination);
      setCounts(result.counts);
      setError(null);

      // Approvals can empty the last page; step back to the last page that still has rows.
      if (result.rows.length === 0 && currentPage > 1 && result.pagination.last_page < currentPage) {
        setCurrentPage(Math.max(1, result.pagination.last_page));
      }
    } catch (err: any) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message || 'Failed to load the approval queue.');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [category, currentPage, itemsPerPage, debouncedSearch]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  // The handlers below are bound once; they reach the current page through this ref.
  const loadPageRef = useRef(loadPage);
  useEffect(() => {
    loadPageRef.current = loadPage;
  }, [loadPage]);

  // Approvals, new payments and finished installs made elsewhere — by another user, or from the
  // Transaction List / Job Order pages — land here without a manual refresh.
  useEffect(() => {
    const refresh = () => loadPageRef.current(true);

    const subscriptions: [string, string][] = [
      ['transactions', 'transaction-updated'],
      ['job-orders', 'job-order-done'],
    ];

    const bound = subscriptions.map(([channelName, event]) => {
      const channel = pusher.subscribe(channelName);
      channel.bind(event, refresh);
      return { channel, event };
    });

    const interval = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      // Unbind only: the Sidebar badges and the list pages listen on these same channels.
      bound.forEach(({ channel, event }) => channel.unbind(event, refresh));
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: 0 });
  }, [currentPage, category]);

  const handleCategoryChange = (next: ForApprovalCategory) => {
    if (next === category) return;
    setSelected(null);
    setList(next === 'transactions' ? { category: 'transactions', rows: [] } : { category: 'job-orders', rows: [] });
    setPagination(null);
    setCurrentPage(1);
    setCategory(next);
  };

  const handleApproved = () => {
    // The approved record leaves the queue and every count moves; the sidebar follows at once.
    loadPage(true);
    notifyNavBadgesChanged();
  };

  // Previous / Next walk the rows on this page. A record that has just been approved is no
  // longer among them, so its panel offers neither.
  const selectedIndex = useMemo(() => {
    if (!selected || selected.category !== list.category) return -1;
    const key = forApprovalRecordKey(selected);
    return list.rows.findIndex((_, index) => forApprovalRecordKey(toRecord(list, index)) === key);
  }, [selected, list]);

  const totalPages = Math.max(1, pagination?.last_page || 1);
  const totalResults = pagination?.total || 0;
  const isBusy = loading || refreshing;

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  const headerCellClass = (index: number, columnCount: number) =>
    `text-left py-3 px-3 font-normal whitespace-nowrap ${isDarkMode ? 'text-gray-400 bg-gray-800' : 'text-gray-600 bg-gray-100'} ${index < columnCount - 1 ? (isDarkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') : ''}`;
  const bodyCellClass = (index: number, columnCount: number) =>
    `py-3 px-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} ${index < columnCount - 1 ? (isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200') : ''}`;

  const statusBadge = (status?: string | null) => {
    const s = (status || '').toLowerCase();
    const tone = s === 'done' ? 'text-green-500' : s === 'pending' ? 'text-yellow-500' : s === 'failed' ? 'text-red-500' : (isDarkMode ? 'text-gray-400' : 'text-gray-500');
    return <span className={`capitalize ${tone}`}>{status || '-'}</span>;
  };

  const paymentMethodName = (transaction: ForApprovalTransaction): string =>
    transaction.payment_method_info?.payment_method ||
    paymentMethods.find(m => String(m.id) === String(transaction.payment_method))?.payment_method ||
    transaction.payment_method ||
    '-';

  const transactionColumns: Array<{ label: string; render: (t: ForApprovalTransaction) => React.ReactNode }> = [
    { label: 'Date Created', render: t => formatDate(t.created_at, true) },
    { label: 'Account No.', render: t => <span className="text-red-400 font-medium">{t.account?.account_no || t.account_no || '-'}</span> },
    { label: 'Full Name', render: t => t.account?.customer?.full_name || '-' },
    { label: 'Received Payment', render: t => <span className="font-medium">{formatMoney(t.received_payment)}</span> },
    { label: 'Payment Method', render: t => paymentMethodName(t) },
    { label: 'Transaction Type', render: t => t.transaction_type || '-' },
    { label: 'Reference No.', render: t => t.reference_no || '-' },
    { label: 'OR No.', render: t => t.or_no || '-' },
    { label: 'Payment Date', render: t => formatDate(t.payment_date) },
    { label: 'Processed By', render: t => resolveUserDisplayName(t.processor?.email_address || t.processed_by_user, userDirectory, '-') },
    { label: 'Status', render: t => statusBadge(t.status) },
  ];

  const jobOrderColumns: Array<{ label: string; render: (jo: JobOrder) => React.ReactNode }> = [
    { label: 'Job Order #', render: jo => jo.id },
    { label: 'Timestamp', render: jo => formatDate(jo.Timestamp || jo.created_at, true) },
    { label: 'Full Name', render: jo => [jo.First_Name, jo.Last_Name].filter(Boolean).join(' ') || '-' },
    { label: 'Contact No.', render: jo => jo.Mobile_Number || '-' },
    { label: 'Plan', render: jo => jo.Desired_Plan || '-' },
    { label: 'Location', render: jo => [jo.Barangay, jo.City].filter(Boolean).join(', ') || '-' },
    { label: 'Assigned Tech', render: jo => resolveUserDisplayName(jo.Assigned_Email, userDirectory, '-') },
    { label: 'Connection Type', render: jo => jo.connection_type || '-' },
    { label: 'Date Installed', render: jo => formatDate(jo.date_installed) },
    { label: 'Onsite Status', render: jo => statusBadge(jo.Onsite_Status) },
    { label: 'Billing Status', render: jo => statusBadge(jo.billing_status || jo.Billing_Status || 'In Progress') },
    { label: 'Billing Type', render: jo => jo.generation_type || '-' },
  ];

  const columnCount = list.category === 'transactions' ? transactionColumns.length : jobOrderColumns.length;
  const selectedKey = selected ? forApprovalRecordKey(selected) : null;
  const categoryLabel = list.category === 'transactions' ? 'transactions' : 'job orders';

  const renderRows = () => {
    if (list.rows.length === 0) {
      return (
        <tr>
          <td colSpan={columnCount} className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {debouncedSearch
              ? `No ${categoryLabel} awaiting approval match "${debouncedSearch}".`
              : `No ${categoryLabel} awaiting approval.`}
          </td>
        </tr>
      );
    }

    return list.rows.map((_, index) => {
      const record = toRecord(list, index);
      const key = forApprovalRecordKey(record);
      const cells = record.category === 'transactions'
        ? transactionColumns.map(column => column.render(record.transaction))
        : jobOrderColumns.map(column => column.render(record.jobOrder));

      return (
        <tr
          key={key}
          onClick={() => setSelected(record)}
          className={`border-b transition-colors cursor-pointer ${isDarkMode ? 'border-gray-800 hover:bg-gray-800' : 'border-gray-200 hover:bg-gray-50'} ${selectedKey === key ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
        >
          {cells.map((cell, cellIndex) => (
            <td key={cellIndex} className={bodyCellClass(cellIndex, cells.length)}>{cell}</td>
          ))}
        </tr>
      );
    });
  };

  const navButtonClass = (disabled: boolean, wide = false) =>
    `${wide ? 'px-3' : 'px-2'} py-1 rounded text-sm transition-colors ${disabled
      ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
      : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`;

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden relative ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      <div className={`flex-1 flex flex-col overflow-hidden min-w-0 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        {/* Header */}
        <div className={`p-4 border-b flex-shrink-0 space-y-3 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <h1 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>For Approval</h1>
            {counts.total > 0 && (
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-yellow-500 bg-opacity-20 text-yellow-500 whitespace-nowrap">
                {counts.total} awaiting approval
              </span>
            )}
          </div>

          {/* Category filter */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none" role="tablist" aria-label="Approval category">
            {CATEGORIES.map(({ id, label, icon: Icon, countKey }) => {
              const active = category === id;
              const primary = colorPalette?.primary || '#7c3aed';
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleCategoryChange(id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors ${active
                    ? 'text-white'
                    : (isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50')}`}
                  style={active ? { backgroundColor: primary, borderColor: primary } : undefined}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center ${active ? 'bg-white bg-opacity-25' : (isDarkMode ? 'bg-gray-700' : 'bg-gray-200')}`}
                  >
                    {counts[countKey]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <GlobalSearch
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
                placeholder={category === 'transactions'
                  ? 'Search account no., name, reference no., OR no...'
                  : 'Search JO #, name, contact, SN, username...'}
              />
            </div>
            <button
              onClick={() => loadPage(true)}
              disabled={isBusy}
              title="Refresh"
              className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border flex-shrink-0"
              style={{
                backgroundColor: '#ffffff',
                borderColor: colorPalette?.primary || '#7c3aed',
                color: colorPalette?.primary || '#7c3aed',
              }}
              onMouseEnter={(e) => {
                if (!isBusy && colorPalette?.primary) e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
              }}
              onMouseLeave={(e) => {
                if (!isBusy) e.currentTarget.style.backgroundColor = '#ffffff';
              }}
            >
              <RefreshCw className={`h-5 w-5 ${isBusy ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading && list.rows.length === 0 ? (
            <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <div className="animate-pulse flex flex-col items-center">
                <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
              </div>
              <p className="mt-4">Loading records awaiting approval...</p>
            </div>
          ) : error && list.rows.length === 0 ? (
            <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
              <p>{error}</p>
              <button
                onClick={() => loadPage()}
                className={`mt-4 px-4 py-2 rounded text-white ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-400 hover:bg-gray-500'}`}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className={`flex-1 overflow-auto ${loading ? 'opacity-60' : ''}`} ref={scrollRef}>
              {error && (
                <div className={`border p-3 m-3 rounded text-sm ${isDarkMode ? 'bg-red-900 bg-opacity-20 border-red-700 text-red-400' : 'bg-red-100 border-red-300 text-red-900'}`}>
                  {error}
                </div>
              )}
              <table className="w-max min-w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="sticky top-0 z-10">
                    {(list.category === 'transactions' ? transactionColumns : jobOrderColumns).map((column, index) => (
                      <th key={column.label} className={headerCellClass(index, columnCount)}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>{renderRows()}</tbody>
              </table>
            </div>
          )}

          {totalResults > 0 && (
            <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t relative z-20 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
              <div className={`flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <div className="flex items-center gap-2">
                  <span>Show</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className={`px-2 py-1 rounded border text-sm focus:outline-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <span>entries</span>
                </div>
                <span>
                  Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
                  <span className="font-medium">{Math.min(currentPage * itemsPerPage, totalResults)}</span> of{' '}
                  <span className="font-medium">{totalResults}</span> results
                </span>
              </div>
              <div className="flex items-center justify-center space-x-2">
                <button onClick={() => handlePageChange(1)} disabled={currentPage === 1} className={navButtonClass(currentPage === 1)} title="First Page">
                  <ChevronsLeft size={16} />
                </button>
                <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className={navButtonClass(currentPage === 1, true)} title="Previous Page">
                  <ChevronLeft size={16} />
                </button>
                <span className={`px-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Page {currentPage} of {totalPages}
                </span>
                <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className={navButtonClass(currentPage === totalPages, true)} title="Next Page">
                  <ChevronRight size={16} />
                </button>
                <button onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} className={navButtonClass(currentPage === totalPages)} title="Last Page">
                  <ChevronsRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Details panel. Full screen on a phone (the panel positions itself), beside the list otherwise. */}
      {selected && (
        <div className="flex-shrink-0 overflow-hidden">
          <ForApprovalDetails
            record={selected}
            onClose={() => setSelected(null)}
            onApproved={handleApproved}
            onPrevious={selectedIndex > 0 ? () => setSelected(toRecord(list, selectedIndex - 1)) : undefined}
            onNext={selectedIndex !== -1 && selectedIndex < list.rows.length - 1 ? () => setSelected(toRecord(list, selectedIndex + 1)) : undefined}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            paymentMethods={paymentMethods}
          />
        </div>
      )}
    </div>
  );
};

export default ForApproval;
