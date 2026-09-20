import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowUp, ChevronLeft, ChevronRight ,ArrowDown, Columns3, X, ChevronsLeft, ChevronsRight, Menu, Globe, Calendar, ChevronDown, Filter, RefreshCw, Download } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import SOADetails from '../components/SOADetails';
import '../services/soaService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { paymentService, PendingPayment } from '../services/paymentService';
import { useSOAStore, SOARecordUI } from '../store/soaStore';
import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import SOAFunnelFilter, { FilterValues, allColumns as filterColumns } from '../filter/SOAFunnelFilter';
import pusher from '../services/pusherService';
import { exportToCSV } from '../utils/exportUtils';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

interface PaginationControlsProps {
  totalPages: number;
  itemsPerPage: number;
  setItemsPerPage: (val: number) => void;
  isDarkMode: boolean;
  currentPage: number;
  totalDisplayCount: number;
  handlePageChange: (page: number) => void;
}

const PaginationControls: React.FC<PaginationControlsProps> = ({
  totalPages,
  itemsPerPage,
  setItemsPerPage,
  isDarkMode,
  currentPage,
  totalDisplayCount,
  handlePageChange
}) => {
  if (totalDisplayCount === 0) return null;

  return (
    <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t relative z-20 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
      <div className={`flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        <div className="flex items-center gap-2">
          <span>Show</span>
          <select
            value={itemsPerPage}
            onChange={(e) => setItemsPerPage(Number(e.target.value))}
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
          Showing <span className="font-medium">{totalDisplayCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, totalDisplayCount)}</span> of <span className="font-medium">{totalDisplayCount}</span> results
        </span>
      </div>
      <div className="flex items-center justify-center space-x-2">
        <button
          onClick={() => handlePageChange(1)}
          disabled={currentPage === 1}
          className={`p-1 rounded transition-colors ${currentPage === 1
            ? (isDarkMode ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 cursor-not-allowed')
            : (isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100')
            }`}
          title="First Page"
        >
          <ChevronsLeft className="h-5 w-5" />
        </button>

        <button
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === 1
            ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
            : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
            }`}
        >
          <ChevronLeft size={16} />
        </button>

        <div className="flex items-center space-x-1">
          <span className={`px-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Page {currentPage} of {totalPages}
          </span>
        </div>

        <button
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === totalPages
            ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
            : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
            }`}
        >
          <ChevronRight size={16} />
        </button>

        <button
          onClick={() => handlePageChange(totalPages)}
          disabled={currentPage === totalPages}
          className={`p-1 rounded transition-colors ${currentPage === totalPages
            ? (isDarkMode ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 cursor-not-allowed')
            : (isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100')
            }`}
          title="Last Page"
        >
          <ChevronsRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

const allColumns = [
  { key: 'statementDate', label: 'Statement Date', width: 'min-w-36' },
  { key: 'accountNo', label: 'Account No', width: 'min-w-36' },
  { key: 'dateInstalled', label: 'Date Installed', width: 'min-w-32' },
  { key: 'fullName', label: 'Full Name', width: 'min-w-40' },
  { key: 'contactNumber', label: 'Contact No', width: 'min-w-36' },
  { key: 'emailAddress', label: 'Email Address', width: 'min-w-48' },
  { key: 'plan', label: 'Plan', width: 'min-w-32' },
  { key: 'balanceFromPreviousBill', label: 'Balance From Previous Bill', width: 'min-w-48' },
  { key: 'statementNo', label: 'Statement No', width: 'min-w-36' },
  { key: 'paymentReceivedPrevious', label: 'Payment Received From Previous Bill', width: 'min-w-64' },
  { key: 'remainingBalancePrevious', label: 'Remaining Balance From Previous Bill', width: 'min-w-64' },
  { key: 'monthlyServiceFee', label: 'Monthly Service Fee', width: 'min-w-40' },
  { key: 'staggered', label: 'Staggered Installation', width: 'min-w-40' },
  { key: 'serviceCharge', label: 'Service Charge', width: 'min-w-36' },
  { key: 'discounts', label: 'Discounts', width: 'min-w-28' },
  { key: 'rebate', label: 'Rebates', width: 'min-w-28' },
  { key: 'vat', label: 'VAT', width: 'min-w-28' },
  { key: 'dueDate', label: 'Due Date', width: 'min-w-32' },
  { key: 'disconnectionDate', label: 'Disconnection Date', width: 'min-w-40' },
  { key: 'amountDue', label: 'Amount Due', width: 'min-w-32' },
  { key: 'totalAmountDue', label: 'Total Amount Due', width: 'min-w-36' },
  { key: 'updatedBy', label: 'Modified By', width: 'min-w-32' },
  { key: 'updatedAt', label: 'Modified Date', width: 'min-w-40' },
  { key: 'printLink', label: 'Print Link', width: 'min-w-28' },
  { key: 'barangay', label: 'Barangay', width: 'min-w-32' },
  { key: 'city', label: 'City', width: 'min-w-32' },
  { key: 'region', label: 'Region', width: 'min-w-32' },
];

const customerColumns = [
  { key: 'statementDate', label: 'Statement Date', width: 'min-w-36' },
  { key: 'id', label: 'ID', width: 'min-w-20' },
  { key: 'action', label: 'Action', width: 'min-w-32' },
];

const SOA: React.FC = () => {
  const { soaRecords, totalCount, isLoading, error, fetchSOARecords, refreshSOARecords, pollLatestUpdates } = useSOAStore();
  const isFullyLoaded = totalCount === 0 || soaRecords.length >= totalCount;

  // Initial data fetch
  useEffect(() => {
    fetchSOARecords();
  }, [fetchSOARecords]);

  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const selectedRecord = useMemo(() => {
    if (!selectedRecordId) return null;
    return soaRecords.find(r => r.id === selectedRecordId) || null;
  }, [soaRecords, selectedRecordId]);


  // Removed local soaRecords, isLoading, error state
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [accountNo, setAccountNo] = useState<string>('');
  const [accountBalance, setAccountBalance] = useState<number>(0);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState<boolean>(false);
  const [showPaymentVerifyModal, setShowPaymentVerifyModal] = useState<boolean>(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [fullName, setFullName] = useState<string>('');
  const [showPaymentLinkModal, setShowPaymentLinkModal] = useState<boolean>(false);
  const [paymentLinkData, setPaymentLinkData] = useState<{ referenceNo: string; amount: number; paymentUrl: string } | null>(null);
  const [showPendingPaymentModal, setShowPendingPaymentModal] = useState<boolean>(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const [sortColumn, setSortColumn] = useState<string | null>('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<FilterValues>(() => {
    const saved = localStorage.getItem('soaFunnelFilters');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    }
    return {};
  });

  const [statementDateFrom, setStatementDateFrom] = useState<string>('');
  const [statementDateTo, setStatementDateTo] = useState<string>('');
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [mobileViewMode, setMobileViewMode] = useState<'sidebar' | 'list'>('sidebar');

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setMobileViewMode('list');
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-navigate to list view when selectedDate or statementDate changes on mobile
  useEffect(() => {
    if (isMobile && (selectedDate !== 'All' || statementDateFrom || statementDateTo)) {
      setMobileViewMode('list');
    }
  }, [selectedDate, statementDateFrom, statementDateTo, isMobile]);

  const removeFilter = (key: string) => {
    const newFilters = { ...activeFilters };
    delete newFilters[key];
    setActiveFilters(newFilters);
    localStorage.setItem('soaFunnelFilters', JSON.stringify(newFilters));
  };



  const displayColumns = userRole === 'customer' ? customerColumns : allColumns;

  const userOrgId = useMemo(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
    } catch {
      return null;
    }
  }, []);

  // 1. Initial search/funnel filtering (Global filtered set for sidebar dates)
  const globalFilteredRecords = useMemo(() => {
    let filtered = soaRecords.filter((record: SOARecordUI) => {
      // Organization filter — mirrors applicationmanagement.tsx logic exactly
      if (userOrgId) {
        if (record.organization_id !== userOrgId) return false;
      } else {
        if (record.organization_id) return false;
      }

      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') {
          return Object.values(val).some(v => checkValue(v));
        }
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };

      return searchQuery === '' || checkValue(record);
    });

    // Apply funnel filters
    if (activeFilters && Object.keys(activeFilters).length > 0) {
      filtered = filtered.filter(record => {
        return Object.entries(activeFilters).every(([key, filter]: [string, any]) => {
          const getVal = (item: any, k: string) => {
            switch (k) {
              case 'fullName': return item.fullName ?? item.full_name;
              case 'accountNo': return item.accountNo ?? item.account_no;
              case 'invoiceStatus': return item.invoiceStatus ?? item.status;
              default: return item[k];
            }
          };

          const val = getVal(record, key);

          if (filter.type === 'checklist') {
            if (!filter.value || !Array.isArray(filter.value) || filter.value.length === 0) return true;
            const valStr = String(val || '').toLowerCase().trim();
            if (key === 'barangay' || key === 'city' || key === 'region') {
              const directVal = String(record[key] || '').toLowerCase().trim();
              const address = String(record.address || '').toLowerCase();
              return (filter.value as string[]).some(option => {
                const opt = option.toLowerCase().trim();
                return directVal === opt || address.includes(opt);
              });
            }
            return (filter.value as string[]).some(option => valStr === option.toLowerCase().trim());
          }

          if (filter.type === 'text') {
            if (!filter.value) return true;
            const value = String(val || '').toLowerCase();
            return value.includes(String(filter.value).toLowerCase());
          }

          if (filter.type === 'number') {
            const numValue = Number(val);
            if (isNaN(numValue)) return false;
            if (filter.from !== undefined && filter.from !== '' && numValue < Number(filter.from)) return false;
            if (filter.to !== undefined && filter.to !== '' && numValue > Number(filter.to)) return false;
            return true;
          }

          if (filter.type === 'date') {
            if (!val || val === 'N/A') return false;
            const dateValue = new Date(val).getTime();
            if (isNaN(dateValue)) return false;
            if (filter.from) {
              const fromDate = new Date(filter.from).getTime();
              if (dateValue < fromDate) return false;
            }
            if (filter.to) {
              const toDate = new Date(filter.to).getTime();
              if (dateValue > toDate) return false;
            }
            return true;
          }
          return true;
        });
      });
    }

    // Apply sidebar date range filters for statement date
    if (statementDateFrom || statementDateTo) {
      filtered = filtered.filter(record => {
        if (!record.statementDateRaw && !record.statementDate) return false;

        const dateStr = record.statementDateRaw || record.statementDate;
        const dateValue = new Date(dateStr).getTime();
        if (isNaN(dateValue)) return false;

        if (statementDateFrom) {
          const fromDate = new Date(statementDateFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (dateValue < fromDate.getTime()) return false;
        }

        if (statementDateTo) {
          const toDate = new Date(statementDateTo);
          toDate.setHours(23, 59, 59, 999);
          if (dateValue > toDate.getTime()) return false;
        }

        return true;
      });
    }

    return filtered;
  }, [soaRecords, searchQuery, activeFilters, statementDateFrom, statementDateTo, userOrgId]);

  // Derive date items from context data instead of fetching separately or static - Now using globalFilteredRecords
  const dateItems = useMemo(() => {
    const dateCounts: Record<string, number> = {};
    const dates = new Map<string, string>();

    globalFilteredRecords.forEach((record: SOARecordUI) => {
      if (record.statementDate && record.statementDate !== 'N/A') {
        dateCounts[record.statementDate] = (dateCounts[record.statementDate] || 0) + 1;
        dates.set(record.statementDate, record.statementDateRaw || record.statementDate);
      }
    });

    const sortedDates = Array.from(dates.entries())
      .sort((a, b) => {
        const timeA = new Date(a[1]).getTime();
        const timeB = new Date(b[1]).getTime();
        return timeB - timeA;
      })
      .map(([formatted]) => ({
        date: formatted,
        count: dateCounts[formatted]
      }));

    return {
      all: globalFilteredRecords.length,
      dates: sortedDates
    };
  }, [globalFilteredRecords]);

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    checkDarkMode();

    const observer = new MutationObserver(() => {
      checkDarkMode();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const user = JSON.parse(authData);
        setUserRole(user.role?.toLowerCase() || '');
        setAccountNo(user.username || ''); // username IS the account_no
        const balance = parseFloat(user.account_balance || '0');
        setAccountBalance(balance);
        setPaymentAmount(balance > 0 ? balance : 100); // Default to 100 if no balance
        setFullName(user.full_name || '');
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    }
  }, []);

  // Fetch color palette
  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, []);

  // Pusher/Soketi connection for real-time SOA updates
  useEffect(() => {
    const handleUpdate = async (data: any) => {
      setHasNewData(true);
      try {
        await pollLatestUpdates();
      } catch (err) {
        console.error('[SOA Soketi] Failed to refresh data:', err);
      }
    };

    const soaChannel = pusher.subscribe('soa');

    soaChannel.bind('pusher:subscription_succeeded', () => {
    });
    soaChannel.bind('pusher:subscription_error', (error: any) => {
      console.error('[SOA Soketi] Subscription error:', error);
    });

    soaChannel.bind('soa-updated', handleUpdate);

    // Re-subscribe on reconnection
    const stateHandler = (states: { previous: string; current: string }) => {
      if (states.current === 'connected' && soaChannel.subscribed !== true) {
        pusher.subscribe('soa');
      }
    };
    pusher.connection.bind('state_change', stateHandler);

    return () => {
      soaChannel.unbind('pusher:subscription_succeeded');
      soaChannel.unbind('pusher:subscription_error');
      soaChannel.unbind('soa-updated', handleUpdate);
      pusher.connection.unbind('state_change', stateHandler);
      pusher.unsubscribe('soa');
    };
  }, [pollLatestUpdates]);

  // Polling for updates every 60 seconds (fetches only latest modified data)
  useEffect(() => {
    const POLLING_INTERVAL = 60000; // 60 seconds
    const intervalId = setInterval(async () => {
      try {
        await pollLatestUpdates();
      } catch (err) {
        console.error('[SOA Page] Polling failed:', err);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [pollLatestUpdates]);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      try {
        await refreshSOARecords();
      } catch (err) {
        console.error('Idle refresh failed:', err);
      }
      // Set the timer again to refresh every 15 mins if they remain idle
      startTimer();
    };

    const startTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(refreshData, IDLE_TIME_LIMIT);
    };

    const resetTimer = () => {
      startTimer();
    };

    const activityEvents = ['mousedown', 'keypress', 'touchstart'];

    const handleActivity = () => {
      resetTimer();
    };

    // Use passive listeners for performance
    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    startTimer(); // Initialize timer on mount

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [refreshSOARecords]);

  // Initialize column order and visibility
  useEffect(() => {
    if (displayColumns.length > 0) {
      setColumnOrder(displayColumns.map(col => col.key));
      setVisibleColumns(displayColumns.map(col => col.key));
    }
  }, [displayColumns]);

  // Removed automatic silent refresh on mount to favor session storage
  // and context-managed initial fetch.



  // 2. Final filtering based on the selected statement date
  const filteredRecords = useMemo(() => {
    let filtered = globalFilteredRecords.filter((record: SOARecordUI) => {
      const matchesDate = selectedDate === 'All' || record.statementDate === selectedDate;
      return matchesDate;
    });

    // Sorting logic
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue: any = (a as any)[sortColumn] || '';
        let bValue: any = (b as any)[sortColumn] || '';

        // Handle numeric values
        const numericColumns = [
          'balanceFromPreviousBill', 'paymentReceivedPrevious', 'remainingBalancePrevious',
          'monthlyServiceFee', 'serviceCharge', 'rebate', 'discounts', 'staggered',
          'vat', 'amountDue', 'totalAmountDue'
        ];

        if (numericColumns.includes(sortColumn)) {
          aValue = Number(aValue) || 0;
          bValue = Number(bValue) || 0;
        } else if (sortColumn === 'statementDate' || sortColumn === 'dueDate' || sortColumn === 'createdAt' || sortColumn === 'updatedAt') {
          // Use raw date for sorting if available
          if (sortColumn === 'statementDate') {
            aValue = a.statementDateRaw || a.statementDate || '';
            bValue = b.statementDateRaw || b.statementDate || '';
          }
          aValue = new Date(aValue).getTime() || 0;
          bValue = new Date(bValue).getTime() || 0;
        } else {
          aValue = String(aValue).toLowerCase();
          bValue = String(bValue).toLowerCase();
        }

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [globalFilteredRecords, selectedDate, sortColumn, sortDirection]);

  const currentSOAIndex = useMemo(() => {
    if (!selectedRecordId || !filteredRecords) return -1;
    return filteredRecords.findIndex(r => r.id === selectedRecordId);
  }, [filteredRecords, selectedRecordId]);

  const handlePreviousRecord = () => {
    if (currentSOAIndex > 0) {
      const prevRecord = filteredRecords[currentSOAIndex - 1];
      setSelectedRecordId(prevRecord.id);
    }
  };

  const handleNextRecord = () => {
    if (currentSOAIndex >= 0 && currentSOAIndex < filteredRecords.length - 1) {
      const nextRecord = filteredRecords[currentSOAIndex + 1];
      setSelectedRecordId(nextRecord.id);
    }
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDate, searchQuery, itemsPerPage, statementDateFrom, statementDateTo, activeFilters]);

  // Scroll to top on page change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRecords.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRecords, currentPage, itemsPerPage]);

  // Use totalCount for total pages if no filter/search is active
  const totalDisplayCount = useMemo(() => {
    if (selectedDate === 'All' && searchQuery === '' && Object.keys(activeFilters).length === 0) {
      return totalCount;
    }
    return filteredRecords.length;
  }, [filteredRecords.length, totalCount, selectedDate, searchQuery, activeFilters]);

  const totalPages = Math.ceil(totalDisplayCount / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };


  const handleRowClick = (record: SOARecordUI) => {
    if (userRole !== 'customer') {
      setSelectedRecordId(record.id);
      setSelectedCustomer(null); // Clear customer view when switching records
    }
  };

  const handleViewCustomer = async (accountNo: string) => {
    setIsLoadingDetails(true);
    try {
      const detail = await getCustomerDetail(accountNo);
      if (detail) {
        setSelectedCustomer(detail);
      }
    } catch (err) {
      console.error('Error fetching customer details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleCloseDetails = () => {
    setSelectedRecordId(null);
  };

  const handleRefresh = async () => {
    setHasNewData(false);
    setIsRefreshingManual(true);
    try {
      await pollLatestUpdates();
    } finally {
      setIsRefreshingManual(false);
    }
  };

  const handlePayNow = async () => {
    setErrorMessage('');
    setIsPaymentProcessing(true);

    try {
      // Fetch current account balance from database
      const currentBalance = await paymentService.getAccountBalance(accountNo);
      setAccountBalance(currentBalance);

      const pending = await paymentService.checkPendingPayment(accountNo);

      if (pending && pending.payment_url) {
        setPendingPayment(pending);
        setShowPendingPaymentModal(true);
      } else {
        setPaymentAmount(currentBalance > 0 ? currentBalance : 100);
        setShowPaymentVerifyModal(true);
      }
    } catch (error: any) {
      console.error('Error checking pending payment:', error);
      setPaymentAmount(accountBalance > 0 ? accountBalance : 100);
      setShowPaymentVerifyModal(true);
    } finally {
      setIsPaymentProcessing(false);
    }
  };

  const handleCloseVerifyModal = () => {
    setShowPaymentVerifyModal(false);
    setPaymentAmount(accountBalance);
  };

  const handleProceedToCheckout = async () => {
    if (paymentAmount < 1) {
      setErrorMessage('Payment amount must be at least ₱1.00');
      return;
    }

    if (isPaymentProcessing) {
      return;
    }

    setIsPaymentProcessing(true);
    setErrorMessage('');

    try {
      const response = await paymentService.createPayment(accountNo, paymentAmount);

      if (response.status === 'success' && response.payment_url) {
        setShowPaymentVerifyModal(false);
        setPaymentLinkData({
          referenceNo: response.reference_no || '',
          amount: response.amount || paymentAmount,
          paymentUrl: response.payment_url
        });
        setShowPaymentLinkModal(true);
      } else {
        throw new Error(response.message || 'Failed to create payment link');
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      setErrorMessage(error.message || 'Failed to create payment. Please try again.');
    } finally {
      setIsPaymentProcessing(false);
    }
  };

  const handleOpenPaymentLink = () => {
    if (paymentLinkData?.paymentUrl) {
      window.open(paymentLinkData.paymentUrl, '_blank');
      setShowPaymentLinkModal(false);
      setPaymentLinkData(null);
    }
  };



  const handleResumePendingPayment = () => {
    if (pendingPayment && pendingPayment.payment_url) {
      window.open(pendingPayment.payment_url, '_blank');
      setShowPendingPaymentModal(false);
      setPendingPayment(null);
    }
  };

  const handleCancelPendingPayment = () => {
    setShowPendingPaymentModal(false);
    setPendingPayment(null);
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar) return;

      const diff = e.clientX - sidebarStartXRef.current;
      const newWidth = Math.max(200, Math.min(500, sidebarStartWidthRef.current + diff));

      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Sidebar handles its own state
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setFilterDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [filterDropdownRef]);

  const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarStartXRef.current = e.clientX;
    sidebarStartWidthRef.current = sidebarWidth;
  };

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const newColumns = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      return newColumns;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = displayColumns.map(col => col.key);
    setVisibleColumns(allKeys);
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
  };

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection('asc');
      } else {
        setSortDirection('desc');
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const handleDragStart = (e: React.DragEvent, columnKey: string) => {
    setDraggedColumn(columnKey);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedColumn && draggedColumn !== columnKey) {
      setDragOverColumn(columnKey);
    }
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, targetColumnKey: string) => {
    e.preventDefault();

    if (!draggedColumn || draggedColumn === targetColumnKey) {
      setDraggedColumn(null);
      setDragOverColumn(null);
      return;
    }

    const newOrder = [...columnOrder];
    const draggedIndex = newOrder.indexOf(draggedColumn);
    const targetIndex = newOrder.indexOf(targetColumnKey);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedColumn);

    setColumnOrder(newOrder);
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  const handleMouseDownResize = (e: React.MouseEvent, columnKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnKey);
    startXRef.current = e.clientX;

    const th = (e.target as HTMLElement).closest('th');
    if (th) {
      startWidthRef.current = th.offsetWidth;
    }
  };

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
      return dateString;
    }
  };

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingColumn) return;

      const diff = e.clientX - startXRef.current;
      const newWidth = Math.max(100, startWidthRef.current + diff);

      setColumnWidths(prev => ({
        ...prev,
        [resizingColumn]: newWidth
      }));
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn]);

  const filteredColumns = displayColumns
    .filter(col => visibleColumns.includes(col.key))
    .sort((a, b) => {
      const indexA = columnOrder.indexOf(a.key);
      const indexB = columnOrder.indexOf(b.key);
      return indexA - indexB;
    });

  const handleDownloadPDF = (printLink: string | undefined) => {
    if (printLink) {
      window.open(printLink, '_blank');
    }
  };

  const renderCellValue = (record: SOARecordUI, columnKey: string) => {
    switch (columnKey) {
      case 'id':
        return record.id;
      case 'statementNo':
        return record.statementNo || `SOA-${record.id}`;
      case 'accountNo':
        return <span className="text-red-400">{record.accountNo}</span>;
      case 'statementDate':
        return formatDate(record.statementDate);
      case 'disconnectionDate':
        return '-';
      case 'action':
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDownloadPDF(record.printLink);
            }}
            disabled={!record.printLink}
            className="px-3 py-1 rounded text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: record.printLink ? (colorPalette?.primary || '#7c3aed') : '#6b7280'
            }}
            onMouseEnter={(e) => {
              if (record.printLink && colorPalette?.accent) {
                e.currentTarget.style.backgroundColor = colorPalette.accent;
              }
            }}
            onMouseLeave={(e) => {
              if (record.printLink && colorPalette?.primary) {
                e.currentTarget.style.backgroundColor = colorPalette.primary;
              }
            }}
          >
            Download PDF
          </button>
        );
      case 'balanceFromPreviousBill':
        return `₱ ${(record.balanceFromPreviousBill ?? 0).toFixed(2)}`;
      case 'paymentReceivedPrevious':
        return `₱ ${(record.paymentReceivedPrevious ?? 0).toFixed(2)}`;
      case 'remainingBalancePrevious':
        return `₱ ${(record.remainingBalancePrevious ?? 0).toFixed(2)}`;
      case 'monthlyServiceFee':
        return `₱ ${(record.monthlyServiceFee ?? 0).toFixed(2)}`;
      case 'serviceCharge':
        return `₱ ${(record.serviceCharge ?? 0).toFixed(2)}`;
      case 'rebate':
        return `₱ ${(record.rebate ?? 0).toFixed(2)}`;
      case 'discounts':
        return `₱ ${(record.discounts ?? 0).toFixed(2)}`;
      case 'staggered':
        return `₱ ${(record.staggered ?? 0).toFixed(2)}`;
      case 'vat':
        return `₱ ${(record.vat ?? 0).toFixed(2)}`;
      case 'dueDate':
        return formatDate(record.dueDate);
      case 'amountDue':
        return `₱ ${(record.amountDue ?? 0).toFixed(2)}`;
      case 'totalAmountDue':
        return `₱ ${(record.totalAmountDue ?? 0).toFixed(2)}`;
      case 'printLink':
        return record.printLink || 'NULL';
      case 'createdAt':
        return formatDate(record.createdAt);
      case 'createdBy':
        return record.createdBy || '-';
      case 'updatedAt':
        return formatDate(record.updatedAt);
      case 'updatedBy':
        return record.updatedBy || '-';
      case 'fullName':
        return record.fullName || '-';
      case 'contactNumber':
        return record.contactNumber || '-';
      case 'emailAddress':
        return record.emailAddress || '-';
      case 'address':
        return <span title={record.address}>{record.address || '-'}</span>;
      case 'plan':
        return record.plan || '-';
      case 'dateInstalled':
        return formatDate(record.dateInstalled);
      case 'barangay':
        return record.barangay || '-';
      case 'city':
        return record.city || '-';
      case 'region':
        return record.region || '-';
      default:
        return '-';
    }
  };

  const handleExport = () => {
    if (!filteredRecords || filteredRecords.length === 0) return;

    const exportColumns = displayColumns
      .filter(col => visibleColumns.includes(col.key))
      .sort((a, b) => {
        const indexA = columnOrder.indexOf(a.key);
        const indexB = columnOrder.indexOf(b.key);
        return indexA - indexB;
      });

    const getExportValue = (record: SOARecordUI, columnKey: string) => {
      switch (columnKey) {
        case 'action':
          return record.printLink || 'No Link';
        case 'accountNo':
          return record.accountNo || '-';
        case 'address':
          return record.address || '-';
        default:
          return renderCellValue(record, columnKey);
      }
    };

    exportToCSV('soa_records_export', exportColumns, filteredRecords, getExportValue);
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      {userRole !== 'customer' && (
        <div
          onClick={() => {
            if (isMobile) {
              setMobileViewMode('list');
            }
          }}
          className={`${
            mobileViewMode === 'sidebar' ? 'flex w-full' : 'hidden'
          } md:flex border-r flex-shrink-0 flex-col relative ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`} style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}>
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
            }`}>
            <div className="flex items-center justify-between mb-1">
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Statements</h2>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Date Range Filter Section */}
            <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Statement Date Range
                </span>
                {(statementDateFrom || statementDateTo) && (
                  <button
                    onClick={() => {
                      setStatementDateFrom('');
                      setStatementDateTo('');
                    }}
                    className="text-[10px] font-bold uppercase tracking-wider hover:underline"
                    style={{ color: colorPalette?.primary || '#7c3aed' }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>From</label>
                  <input
                    type="date"
                    value={statementDateFrom}
                    onChange={(e) => setStatementDateFrom(e.target.value)}
                    className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                    style={statementDateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                  />
                </div>
                <div className="relative">
                  <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                  <input
                    type="date"
                    value={statementDateTo}
                    onChange={(e) => setStatementDateTo(e.target.value)}
                    className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                    style={statementDateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                  />
                </div>
              </div>
            </div>

            {/* All Level */}
            <button
              onClick={() => setSelectedDate('All')}
              className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                } ${selectedDate === 'All'
                  ? ''
                  : isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              style={selectedDate === 'All' ? {
                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                color: colorPalette?.primary || '#7c3aed'
              } : {}}
            >
              <div className="flex items-center">
                <span>All Records</span>
              </div>
              <span
                className={`px-2 py-1 rounded text-xs transition-colors ${selectedDate === 'All'
                  ? 'text-white'
                  : isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'
                  }`}
                style={selectedDate === 'All' ? {
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                {dateItems.all}
              </span>
            </button>

            {/* Statement Month Dropdown */}
            <div className={`p-0 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-100'}`}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDateDropdownOpen(!isDateDropdownOpen);
                }}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                  } ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
              >
                <div className="flex items-center">
                  <span className="font-medium">Statement Month</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'
                      }`}
                  >
                    {dateItems.dates.length}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-200 ${isDateDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {isDateDropdownOpen && (
                <div className={`${isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50/50 shadow-inner'}`}>
                  {dateItems.dates.map((item, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedDate(item.date)}
                      className={`w-full flex items-center justify-between px-6 py-2.5 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                        } ${selectedDate === item.date
                          ? ''
                          : isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}
                      style={selectedDate === item.date ? {
                        backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                        color: colorPalette?.primary || '#7c3aed',
                        fontWeight: 500
                      } : {}}
                    >
                      <div className="flex items-center">
                        <Calendar className="h-4 w-4 mr-3 opacity-60" />
                        <span className="truncate">{item.date}</span>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${selectedDate === item.date
                          ? 'text-white'
                          : isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-500'
                          }`}
                        style={selectedDate === item.date ? {
                          backgroundColor: colorPalette?.primary || '#7c3aed'
                        } : {}}
                      >
                        {item.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isMobile && (
            <div className={`p-4 border-t flex-shrink-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
              <button
                onClick={() => setMobileViewMode('list')}
                className="w-full py-2 px-4 rounded text-white text-xs font-semibold"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              >
                View Records
              </button>
            </div>
          )}

          {!isMobile && (
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-10"
              style={{
                backgroundColor: isResizingSidebar ? (colorPalette?.primary || '#7c3aed') : 'transparent'
              }}
              onMouseEnter={(e) => {
                if (!isResizingSidebar && colorPalette?.primary) {
                  e.currentTarget.style.backgroundColor = colorPalette.primary;
                }
              }}
              onMouseLeave={(e) => {
                if (!isResizingSidebar) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
              onMouseDown={handleMouseDownSidebarResize}
            />
          )}
        </div>
      )}

      <div className={`${
        mobileViewMode === 'list' || !isMobile ? 'flex-1 flex flex-col' : 'hidden'
      } overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="flex flex-col h-full">
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="flex items-center justify-between space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
              <div className="flex items-center space-x-3 flex-1 min-w-[250px]">
                {mobileViewMode === 'list' && userRole !== 'customer' && (
                  <button
                    onClick={() => setMobileViewMode('sidebar')}
                    className={`md:hidden p-2 rounded-lg border transition-colors flex items-center justify-center flex-shrink-0 ${
                      isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                    title="Back to Filters"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                )}
                <div className="flex-1 w-full">
                  <GlobalSearch 
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    isDarkMode={isDarkMode}
                    colorPalette={colorPalette}
                    placeholder="Search SOA records..."
                  />
                </div>
              </div>
              <button
                onClick={() => setIsFunnelFilterOpen(true)}
                title={Object.keys(activeFilters).length > 0
                  ? `Active Filters:\n${Object.entries(activeFilters).map(([key, filter]: [string, any]) => {
                    const colName = filterColumns.find(c => c.key === key)?.label || key;
                    if (filter.type === 'text') return `${colName}: ${filter.value}`;
                    if (filter.type === 'number') {
                      if (filter.from && filter.to) return `${colName}: ${filter.from} - ${filter.to}`;
                      if (filter.from) return `${colName}: > ${filter.from}`;
                      if (filter.to) return `${colName}: < ${filter.to}`;
                    }
                    if (filter.type === 'date') {
                      if (filter.from && filter.to) return `${colName}: ${filter.from} to ${filter.to}`;
                      if (filter.from) return `${colName}: After ${filter.from}`;
                      if (filter.to) return `${colName}: Before ${filter.to}`;
                    }
                    if (filter.type === 'checklist') {
                      return `${colName}: ${Array.isArray(filter.value) ? filter.value.join(', ') : filter.value}`;
                    }
                    return colName;
                  }).join('\n')}`
                  : "Filter SOA Records"
                }
                className={`px-4 py-2 rounded text-sm transition-colors flex items-center flex-shrink-0 ${Object.keys(activeFilters).length > 0
                  ? 'text-red-500 hover:bg-red-500/10'
                  : isDarkMode
                    ? 'hover:bg-gray-700 text-white'
                    : 'hover:bg-gray-200 text-gray-900 border border-gray-300'
                  }`}
              >
                <Filter className="h-5 w-5" />
              </button>
              {userRole !== 'customer' && (
                <div className="relative z-50 flex-shrink-0" ref={filterDropdownRef}>
                  <button
                    className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                      ? 'hover:bg-gray-700 text-white'
                      : 'hover:bg-gray-200 text-gray-900 border border-gray-300'
                      }`}
                    onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                    title="Column Visibility"
                  >
                    <Columns3 className="h-5 w-5" />
                  </button>
                  {filterDropdownOpen && (
                    <div className={`fixed mt-10 w-80 rounded shadow-lg z-50 max-h-[70vh] flex flex-col -translate-x-[calc(100%-3.5rem)] ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
                      }`}>
                      <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                        }`}>
                        <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>Column Visibility</span>
                        <div className="flex space-x-2">
                          <button
                            onClick={handleSelectAllColumns}
                            className="text-xs"
                            style={{ color: colorPalette?.primary || '#7c3aed' }}
                          >
                            Select All
                          </button>
                          <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>|</span>
                          <button
                            onClick={handleDeselectAllColumns}
                            className="text-xs"
                            style={{ color: colorPalette?.primary || '#7c3aed' }}
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>
                      <div className="overflow-y-auto flex-1">
                        {displayColumns.map((column) => (
                          <label
                            key={column.key}
                            className={`flex items-center px-4 py-2 cursor-pointer text-sm ${isDarkMode
                              ? 'hover:bg-gray-700 text-white'
                              : 'hover:bg-gray-100 text-gray-900'
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={visibleColumns.includes(column.key)}
                              onChange={() => handleToggleColumn(column.key)}
                              className={`mr-3 h-4 w-4 rounded ${isDarkMode
                                ? 'border-gray-600 bg-gray-700 focus:ring-offset-gray-800'
                                : 'border-gray-300 bg-white focus:ring-offset-white'
                                }`}
                              style={{
                                accentColor: colorPalette?.primary || '#7c3aed'
                              }}
                            />
                            <span>{column.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {userRole === 'customer' && (
                <button
                  onClick={handlePayNow}
                  disabled={isPaymentProcessing}
                  className="text-white px-4 py-2 rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  style={{
                    backgroundColor: isPaymentProcessing ? '#6b7280' : (colorPalette?.primary || '#7c3aed')
                  }}
                  onMouseEnter={(e) => {
                    if (!isPaymentProcessing && colorPalette?.accent) {
                      e.currentTarget.style.backgroundColor = colorPalette.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isPaymentProcessing && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = colorPalette.primary;
                    }
                  }}
                >
                  {isPaymentProcessing ? 'Processing...' : 'Pay Now'}
                </button>
              )}
              <button
                onClick={handleExport}
                disabled={isLoading || filteredRecords.length === 0}
                title="Export to CSV"
                className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border flex-shrink-0"
                style={{
                  backgroundColor: '#ffffff',
                  borderColor: colorPalette?.primary || '#7c3aed',
                  color: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (!isLoading && filteredRecords.length > 0 && colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isLoading && filteredRecords.length > 0) {
                    e.currentTarget.style.backgroundColor = '#ffffff';
                  }
                }}
              >
                <Download className="h-5 w-5" />
              </button>
              <button
                onClick={handleRefresh}
                disabled={isLoading || !isFullyLoaded || isRefreshingManual}
                title={!isFullyLoaded ? `Loading records... (${soaRecords.length}/${totalCount})` : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
                className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border flex-shrink-0"
                style={{
                  backgroundColor: '#ffffff',
                  borderColor: colorPalette?.primary || '#7c3aed',
                  color: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (!isLoading && isFullyLoaded && !isRefreshingManual && colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isLoading && isFullyLoaded && !isRefreshingManual) {
                    e.currentTarget.style.backgroundColor = '#ffffff';
                  }
                }}
              >
                <RefreshCw className={`h-5 w-5 ${(isLoading || !isFullyLoaded || isRefreshingManual) ? 'animate-spin' : ''}`} />
                {hasNewData && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Active Funnel Filters Row */}
          {Object.keys(activeFilters || {}).length > 0 && (
            <div className={`px-4 py-2 border-b flex flex-wrap items-center gap-2 overflow-x-auto no-scrollbar ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Active Filters:
              </span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(activeFilters || {}).map(([key, filter]: [string, any]) => {
                  const column = filterColumns.find(c => (c as any).key === key);
                  const label = column?.label || key;

                  let displayValue = '';
                  if (filter.type === 'text' || filter.type === 'boolean') {
                    displayValue = String(filter.value);
                  } else if (filter.type === 'checklist') {
                    displayValue = Array.isArray(filter.value)
                      ? filter.value.join(', ')
                      : String(filter.value || '');
                  } else if (filter.type === 'number' || filter.type === 'date') {
                    if (filter.from && filter.to) displayValue = `${filter.from} - ${filter.to}`;
                    else if (filter.from) displayValue = `> ${filter.from}`;
                    else if (filter.to) displayValue = `< ${filter.to}`;
                  }

                  return (
                    <div
                      key={key}
                      className={`group flex items-center h-7 pl-2 pr-1 rounded-full text-xs font-medium transition-all`}
                      style={{
                        backgroundColor: hexToRgba(colorPalette?.primary || '#7c3aed', isDarkMode ? 0.1 : 0.05),
                        color: colorPalette?.primary || '#7c3aed',
                        border: `1px solid ${hexToRgba(colorPalette?.primary || '#7c3aed', 0.2)}`
                      }}
                    >
                      <span className="opacity-70 mr-1">{label}:</span>
                      <span className="truncate max-w-[150px]">{displayValue}</span>
                      <button
                        onClick={() => removeFilter(key)}
                        className={`ml-1 p-0.5 rounded-full transition-colors`}
                        onMouseEnter={(e) => {
                          if (colorPalette?.primary) {
                            e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.2);
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={() => {
                    setActiveFilters({});
                    localStorage.removeItem('soaFunnelFilters');
                  }}
                  className={`text-[10px] font-bold uppercase tracking-wider underline-offset-4 hover:underline transition-colors px-2 py-1 rounded-md`}
                  style={{ color: colorPalette?.primary || '#7c3aed' }}
                  onMouseEnter={(e) => {
                    if (colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-hidden">
              {isLoading && soaRecords.length === 0 ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  <div className="animate-pulse flex flex-col items-center">
                    <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                    <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                  </div>
                  <p className="mt-4">Loading SOA records...</p>
                </div>
              ) : error ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'
                  }`}>
                  <p>{error}</p>
                  <button
                    onClick={handleRefresh}
                    className={`mt-4 px-4 py-2 rounded ${isDarkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}>
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  <div className="h-full relative flex flex-col">
                    <div className="flex-1 overflow-auto" ref={scrollRef}>
                      <table className="w-max min-w-full text-sm border-separate border-spacing-0">
                        <thead>
                          <tr className={`border-b sticky top-0 z-10 ${isDarkMode
                            ? 'border-gray-700 bg-gray-800'
                            : 'border-gray-200 bg-gray-100'
                            }`}>
                            {filteredColumns.map((column, index) => (
                              <th
                                key={column.key}
                                draggable
                                onDragStart={(e) => handleDragStart(e, column.key)}
                                onDragOver={(e) => handleDragOver(e, column.key)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, column.key)}
                                onDragEnd={handleDragEnd}
                                onClick={() => handleSort(column.key)}
                                className={`group relative text-left py-3 px-3 font-normal whitespace-nowrap cursor-pointer select-none transition-colors ${isDarkMode ? 'text-gray-400 bg-gray-800 hover:bg-gray-700' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                                  } ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') : ''
                                  } ${dragOverColumn === column.key ? (isDarkMode ? 'border-l-2 border-orange-500' : 'border-l-2 border-orange-600') : ''
                                  } ${draggedColumn === column.key ? 'opacity-50' : ''}`}
                                style={{
                                  width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                  minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : (column.width === 'min-w-max' ? 'max-content' : undefined)
                                }}
                              >
                                <div className="flex items-center space-x-1">
                                  <span>{column.label}</span>
                                  {sortColumn === column.key && (
                                    sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                                  )}
                                </div>
                                {/* Resize Handle */}
                                <div
                                  className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity z-10 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`}
                                  onMouseDown={(e) => handleMouseDownResize(e, column.key)}
                                />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedRecords.length > 0 ? (
                            paginatedRecords.map((record: SOARecordUI) => (
                              <tr
                                key={record.id}
                                className={`border-b cursor-pointer transition-colors ${isDarkMode
                                  ? 'border-gray-800 hover:bg-gray-900'
                                  : 'border-gray-200 hover:bg-gray-50'
                                  } ${selectedRecord?.id === record.id ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''
                                  } ${userRole === 'customer' ? '' : 'cursor-pointer'
                                  }`}
                                onClick={() => handleRowClick(record)}
                              >
                                {filteredColumns.map((column, index) => (
                                  <td
                                    key={column.key}
                                    className={`py-4 px-3 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                                      } ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200') : ''
                                      }`}
                                    style={{
                                      width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                      minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : (column.width === 'min-w-max' ? 'max-content' : undefined)
                                    }}
                                  >
                                    {renderCellValue(record, column.key)}
                                  </td>
                                ))}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={displayColumns.length} className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                }`}>
                                {filteredRecords.length > 0
                                  ? 'No SOA records found matching your filters'
                                  : (totalCount > soaRecords.length)
                                    ? 'Loading more records... please wait.'
                                    : 'No SOA records found.'}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
            <PaginationControls
              totalPages={totalPages}
              itemsPerPage={itemsPerPage}
              setItemsPerPage={setItemsPerPage}
              isDarkMode={isDarkMode}
              currentPage={currentPage}
              totalDisplayCount={totalDisplayCount}
              handlePageChange={handlePageChange}
            />
          </div>
        </div>
      </div>



      {selectedRecord && userRole !== 'customer' && (
        <div className="flex-shrink-0 overflow-hidden">
          <SOADetails
            soaRecord={selectedRecord}
            onViewCustomer={handleViewCustomer}
            onClose={handleCloseDetails}
            onPrevious={currentSOAIndex > 0 ? handlePreviousRecord : undefined}
            onNext={currentSOAIndex < filteredRecords.length - 1 ? handleNextRecord : undefined}
          />
        </div>
      )}

      {(selectedCustomer || isLoadingDetails) && (
        <div className="flex-shrink-0 overflow-hidden">
          {isLoadingDetails ? (
            <div className={`h-full flex items-center justify-center border-l ${
              isMobile ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]' : 'w-[600px]'
            } ${isDarkMode
              ? 'bg-gray-900 text-white border-white border-opacity-30'
              : 'bg-white text-gray-900 border-gray-300'
              }`}>
              <div className="text-center">
                <div
                  className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4"
                  style={{ borderBottomColor: colorPalette?.primary || '#7c3aed' }}
                ></div>
                <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Loading details...</p>
              </div>
            </div>
          ) : selectedCustomer ? (
            <BillingDetails
              billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
              onlineStatusRecords={[]}
              onClose={() => setSelectedCustomer(null)}
            />
          ) : null}
        </div>
      )}

      {showPaymentVerifyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            className={`rounded-lg shadow-xl max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'
              }`}
          >
            <div className={`p-6 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
              }`}>
              <h3 className="text-xl font-bold text-center">Confirm Payment</h3>
            </div>

            <div className="p-6">
              <div className={`p-4 rounded mb-4 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'
                }`}>
                <div className="flex justify-between mb-2">
                  <span>Account:</span>
                  <span className="font-bold">{fullName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Current Balance:</span>
                  <span className={`font-bold ${accountBalance > 0 ? 'text-red-500' : 'text-green-500'
                    }`}>₱{accountBalance.toFixed(2)}</span>
                </div>
              </div>

              {errorMessage && (
                <div className={`p-3 rounded mb-4 ${isDarkMode ? 'bg-red-900/20 border border-red-800' : 'bg-red-50 border border-red-200'
                  }`}>
                  <p className="text-red-500 text-sm text-center">{errorMessage}</p>
                </div>
              )}

              <div className="mb-4">
                <label className="block font-bold mb-2">Payment Amount</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={paymentAmount || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Allow empty, numbers, and decimal point
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setPaymentAmount(value === '' ? 0 : parseFloat(value) || 0);
                    }
                  }}
                  onBlur={(e) => {
                    // Format to 2 decimal places on blur if there's a value
                    const value = parseFloat(e.target.value);
                    if (!isNaN(value) && value > 0) {
                      setPaymentAmount(parseFloat(value.toFixed(2)));
                    } else {
                      setPaymentAmount(0);
                    }
                  }}
                  placeholder="100"
                  className={`w-full px-4 py-3 rounded text-lg font-bold ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    } border focus:outline-none focus:ring-2`}
                  style={{
                    '--tw-ring-color': colorPalette?.primary || '#7c3aed'
                  } as React.CSSProperties}
                />
                <div className={`text-sm text-right mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  {accountBalance > 0 ? (
                    <span>Outstanding balance: ₱{accountBalance.toFixed(2)}</span>
                  ) : (
                    <span>Minimum: ₱1.00</span>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleCloseVerifyModal}
                  disabled={isPaymentProcessing}
                  className={`flex-1 px-4 py-3 rounded font-bold transition-colors ${isDarkMode
                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleProceedToCheckout}
                  disabled={isPaymentProcessing || paymentAmount < 1}
                  className="flex-1 px-4 py-3 rounded font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: (isPaymentProcessing || paymentAmount < 1)
                      ? '#6b7280'
                      : (colorPalette?.primary || '#7c3aed')
                  }}
                  onMouseEnter={(e) => {
                    if (!isPaymentProcessing && paymentAmount >= 1 && colorPalette?.accent) {
                      e.currentTarget.style.backgroundColor = colorPalette.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isPaymentProcessing && paymentAmount >= 1 && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = colorPalette.primary;
                    }
                  }}
                >
                  {isPaymentProcessing ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    'PROCEED TO CHECKOUT →'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPendingPaymentModal && pendingPayment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            className={`rounded-lg shadow-xl max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}
          >
            <div className={`p-6 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className="text-xl font-bold text-center">Transaction In Progress</h3>
            </div>

            <div className="p-6">
              <div className={`p-4 rounded mb-6 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                <p className="text-center mb-4">
                  You have a pending payment (<b>{pendingPayment.reference_no}</b>).
                  <br />The link is still active.
                </p>
                <div className="flex justify-between mt-4">
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Amount:</span>
                  <span className="font-bold text-lg" style={{ color: colorPalette?.primary || '#7c3aed' }}>
                    ₱{pendingPayment.amount.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleCancelPendingPayment}
                  className={`flex-1 px-4 py-3 rounded font-bold transition-colors ${isDarkMode
                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                    }`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleResumePendingPayment}
                  className="flex-1 px-4 py-3 rounded font-bold text-white transition-colors"
                  style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                  onMouseEnter={(e) => {
                    if (colorPalette?.accent) {
                      e.currentTarget.style.backgroundColor = colorPalette.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = colorPalette.primary;
                    }
                  }}
                >
                  Pay Now →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPaymentLinkModal && paymentLinkData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            className={`rounded-lg shadow-xl max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}
          >
            <div className={`p-6 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className="text-xl font-bold text-center">Proceed to Payment Portal</h3>
            </div>

            <div className="p-6">
              <div className={`p-4 rounded mb-6 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                <div className="flex justify-between mb-3">
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Reference:</span>
                  <span className="font-mono font-bold">{paymentLinkData.referenceNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Amount:</span>
                  <span className="font-bold text-lg" style={{ color: colorPalette?.primary || '#7c3aed' }}>
                    ₱{paymentLinkData.amount.toFixed(2)}
                  </span>
                </div>
              </div>

              <button
                onClick={handleOpenPaymentLink}
                className="w-full px-4 py-3 rounded font-bold text-white transition-colors"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                onMouseEnter={(e) => {
                  if (colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = colorPalette.primary;
                  }
                }}
              >
                PROCEED
              </button>
            </div>
          </div>
        </div>
      )}
      <SOAFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          setActiveFilters(filters);
          localStorage.setItem('soaFunnelFilters', JSON.stringify(filters));
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={activeFilters}
        records={soaRecords}
      />
    </div>
  );
};

export default SOA;
