import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Globe, ChevronLeft ,ChevronDown, ChevronRight, Menu, X, Filter, ChevronsLeft, ChevronsRight, RefreshCw, ArrowUp, ArrowDown, Columns3, Download } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import PaymentPortalDetails from '../components/PaymentPortalDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { usePaymentPortalStore } from '../store/paymentPortalStore';
import { PaymentPortalLog as PaymentPortalRecord } from '../services/paymentPortalLogsService';
import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import { getCities, City } from '../services/cityService';
import { getRegions, Region } from '../services/regionService';
import { barangayService, Barangay } from '../services/barangayService';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import PaymentPortalFunnelFilter, { FilterValues, allColumns as filterColumns } from '../filter/PaymentPortalFunnelFilter';
import pusher from '../services/pusherService';
import { exportToCSV } from '../utils/exportUtils';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

// Interfaces for payment portal data (PaymentPortalRecord is imported now)
// Removed local PaymentPortalRecord interface

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
  { key: 'date_time', label: 'Date Time', width: 'min-w-44' },
  { key: 'accountNo', label: 'Account No', width: 'min-w-36' },
  { key: 'fullName', label: 'Full Name', width: 'min-w-48' },
  { key: 'total_amount', label: 'Total Amount', width: 'min-w-32' },
  { key: 'status', label: 'Status', width: 'min-w-32' },
  { key: 'reference_no', label: 'Reference No', width: 'min-w-48' },
  { key: 'contactNo', label: 'Contact Number', width: 'min-w-36' },
  { key: 'accountBalance', label: 'Account Balance', width: 'min-w-36' },
  { key: 'checkout_id', label: 'Checkout ID', width: 'min-w-48' },
  { key: 'transaction_status', label: 'Transaction Status', width: 'min-w-40' },
  { key: 'payment_channel', label: 'Payment Channel', width: 'min-w-36' },
  { key: 'updated_at', label: 'Modified Date', width: 'min-w-44' },
];

const PaymentPortal: React.FC = () => {
  const {
    paymentPortalRecords: records,
    totalCount,
    isLoading: loading,
    error,
    fetchPaymentPortalRecords,
    refreshPaymentPortalRecords,
    fetchUpdates
  } = usePaymentPortalStore();

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
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
  const [selectedRecord, setSelectedRecord] = useState<PaymentPortalRecord | null>(null);
  const selectedRecordRef = useRef<PaymentPortalRecord | null>(null);

  useEffect(() => {
    selectedRecordRef.current = selectedRecord;
  }, [selectedRecord]);

  // Auto-update selectedRecord when records list updates (from Pusher or Refresh)
  useEffect(() => {
    if (selectedRecordRef.current && records.length > 0) {
      const updatedMatch = records.find(r => r.id === selectedRecordRef.current?.id);
      if (updatedMatch && JSON.stringify(updatedMatch) !== JSON.stringify(selectedRecordRef.current)) {
        setSelectedRecord(updatedMatch);
      }
    }
  }, [records]);

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
  const isFullyLoaded = totalCount === 0 || records.length >= totalCount;
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<FilterValues>(() => {
    const saved = localStorage.getItem('paymentPortalFunnelFilters');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    }
    return {};
  });

  const [dateTimeFrom, setDateTimeFrom] = useState<string>('');
  const [dateTimeTo, setDateTimeTo] = useState<string>('');

  // Auto-navigate to list view when location/date range changes on mobile
  useEffect(() => {
    if (isMobile && (selectedLocation !== 'all' || dateTimeFrom || dateTimeTo)) {
      setMobileViewMode('list');
    }
  }, [selectedLocation, dateTimeFrom, dateTimeTo, isMobile]);

  const removeFilter = (key: string) => {
    const newFilters = { ...activeFilters };
    delete newFilters[key];
    setActiveFilters(newFilters);
    localStorage.setItem('paymentPortalFunnelFilters', JSON.stringify(newFilters));
  };

  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Column management states
  const [sortColumn, setSortColumn] = useState<string | null>('date_time');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('paymentPortalColumnOrder');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (err) {
        console.error('Failed to load column order:', err);
      }
    }
    return [];
  });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('paymentPortalVisibleColumns');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (err) {
        console.error('Failed to load column visibility:', err);
      }
    }
    return [];
  });
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  // Sidebar states
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);

  // Format currency function
  const formatCurrency = (amount: number) => {
    return `₱${amount.toFixed(2)}`;
  };

  // Fetch data from API (placeholder for now)
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

  useEffect(() => {
    fetchPaymentPortalRecords();
  }, [fetchPaymentPortalRecords]);

  // Fetch lookup data
  useEffect(() => {
    const fetchLookupData = async () => {
      try {
        const [citiesData, regionsData, barangaysRes] = await Promise.all([
          getCities(),
          getRegions(),
          barangayService.getAll()
        ]);
        setCities(citiesData || []);
        setRegions(regionsData || []);
        setBarangays(barangaysRes.success ? barangaysRes.data : []);
      } catch (err) {
        console.error('Failed to fetch lookup data:', err);
      }
    };

    fetchLookupData();
  }, []);

  // Pusher/Soketi connection for real-time payment portal updates
  useEffect(() => {
    const handleUpdate = async (data: any) => {
      setHasNewData(true);
      try {
        await fetchPaymentPortalRecords(true);
      } catch (err) {
        console.error('[PaymentPortal Soketi] Failed to refresh data:', err);
      }
    };

    const paymentChannel = pusher.subscribe('payments');

    paymentChannel.bind('pusher:subscription_succeeded', () => {
    });
    paymentChannel.bind('pusher:subscription_error', (error: any) => {
      console.error('[PaymentPortal Soketi] Subscription error:', error);
    });

    paymentChannel.bind('payment-updated', handleUpdate);

    // Re-subscribe on reconnection
    const stateHandler = (states: { previous: string; current: string }) => {
      if (states.current === 'connected' && paymentChannel.subscribed !== true) {
        pusher.subscribe('payments');
      }
    };
    pusher.connection.bind('state_change', stateHandler);

    return () => {
      paymentChannel.unbind('pusher:subscription_succeeded');
      paymentChannel.unbind('pusher:subscription_error');
      paymentChannel.unbind('payment-updated', handleUpdate);
      pusher.connection.unbind('state_change', stateHandler);
      pusher.unsubscribe('payments');
    };
  }, [fetchPaymentPortalRecords]);

  // Polling for updates every 3 seconds - Incremental fetch
  useEffect(() => {
    const POLLING_INTERVAL = 3000; // 3 seconds
    const intervalId = setInterval(async () => {
      try {
        await fetchUpdates();
      } catch (err) {
        console.error('[PaymentPortal Page] Polling failed:', err);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [fetchUpdates]);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      try {
        await refreshPaymentPortalRecords();
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

    // Use passive listeners for performance if possible, but standard is fine here
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
  }, [refreshPaymentPortalRecords]);

  // Fetch payment methods for filtering mapping
  useEffect(() => {
    const fetchPaymentMethods = async () => {
      try {
        const res = await paymentMethodService.getAll();
        if (res.success) {
          setPaymentMethods(res.data);
        }
      } catch (err) {
        console.error('Failed to fetch payment methods in PaymentPortal:', err);
      }
    };
    fetchPaymentMethods();
  }, []);

  // Initialize column order and visibility
  useEffect(() => {
    if (allColumns.length > 0 && columnOrder.length === 0) {
      const initialOrder = allColumns.map(col => col.key);
      setColumnOrder(initialOrder);
      setVisibleColumns(initialOrder);
    }
  }, [columnOrder.length]);

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const next = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      localStorage.setItem('paymentPortalVisibleColumns', JSON.stringify(next));
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map(col => col.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('paymentPortalVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('paymentPortalVisibleColumns', JSON.stringify([]));
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
    localStorage.setItem('paymentPortalColumnOrder', JSON.stringify(newOrder));
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

  const filteredColumns = allColumns
    .filter(col => visibleColumns.includes(col.key))
    .sort((a, b) => {
      const indexA = columnOrder.indexOf(a.key);
      const indexB = columnOrder.indexOf(b.key);
      return indexA - indexB;
    });

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

  const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarStartXRef.current = e.clientX;
    sidebarStartWidthRef.current = sidebarWidth;
  };

  const toggleLocationExpansion = (e: React.MouseEvent, locationId: string) => {
    e.stopPropagation();
    setExpandedLocations(prev => {
      const next = new Set(prev);
      if (next.has(locationId)) {
        next.delete(locationId);
      } else {
        next.add(locationId);
      }
      return next;
    });
  };


  const userOrgId = useMemo(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
    } catch {
      return null;
    }
  }, []);

  // 1. Initial search/funnel filtering (Global filtered set for sidebar counts)
  const globalFilteredRecords = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');

    let filtered = records.filter(record => {
      // Organization filter — mirrors applicationmanagement.tsx logic exactly
      if (userOrgId) {
        if (record.organization_id !== userOrgId) return false;
      } else {
        if (record.organization_id) return false;
      }

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
      filtered = filtered.filter((record: any) => {
        return Object.entries(activeFilters).every(([key, filter]: [string, any]) => {
          const getValForFilter = (item: any, k: string) => {
            switch (k) {
              case 'fullName': return item.fullName ?? item.full_name;
              case 'accountNo': return item.accountNo ?? item.account_no;
              case 'reference_no': return item.reference_no ?? item.referenceNo;
              case 'payment_method': {
                const channel = item.payment_channel;
                if (!channel) return null;
                // Try to find the numeric ID for this channel string
                const pm = paymentMethods.find(m => 
                  m.payment_method.toLowerCase().trim() === channel.toLowerCase().trim()
                );
                return pm ? String(pm.id) : channel;
              }
              default: return item[k];
            }
          };

          const val = getValForFilter(record, key);

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
            if (!val) return false;
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

    // Apply sidebar date range filters for date_time
    if (dateTimeFrom || dateTimeTo) {
      filtered = filtered.filter(record => {
        if (!record.date_time) return false;

        const dateValue = new Date(record.date_time).getTime();
        if (isNaN(dateValue)) return false;

        if (dateTimeFrom) {
          const fromDate = new Date(dateTimeFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (dateValue < fromDate.getTime()) return false;
        }

        if (dateTimeTo) {
          const toDate = new Date(dateTimeTo);
          toDate.setHours(23, 59, 59, 999);
          if (dateValue > toDate.getTime()) return false;
        }

        return true;
      });
    }

    return filtered;
  }, [records, searchQuery, activeFilters, dateTimeFrom, dateTimeTo, userOrgId]);

  // Generate location items with hierarchy - Now using globalFilteredRecords
  const locationItems = useMemo(() => {
    // Counts for each level
    const regionCounts: Record<string, number> = {};
    const cityCounts: Record<string, number> = {};
    const barangayCounts: Record<string, number> = {};

    // Initialize counts
    regions.forEach(r => regionCounts[r.name] = 0);
    cities.forEach(c => cityCounts[`${c.region_id}_${c.name}`] = 0);
    barangays.forEach(b => barangayCounts[`${b.city_id}_${b.barangay}`] = 0);

    // Count appearances in records
    globalFilteredRecords.forEach(record => {
      const city = record.city;
      const barangay = record.barangay;

      // Find matched city to get region
      const matchedCity = cities.find(c => c.name === city);
      if (matchedCity) {
        const matchedRegion = regions.find(r => r.id === matchedCity.region_id);
        if (matchedRegion) {
          regionCounts[matchedRegion.name] = (regionCounts[matchedRegion.name] || 0) + 1;
        }
        cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] = (cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] || 0) + 1;
      }

      if (barangay) {
        const matchedBarangay = barangays.find(b =>
          b.barangay === barangay &&
          (!city || cities.find(c => c.id === b.city_id)?.name === city)
        );
        if (matchedBarangay) {
          barangayCounts[`${matchedBarangay.city_id}_${matchedBarangay.barangay}`] = (barangayCounts[`${matchedBarangay.city_id}_${matchedBarangay.barangay}`] || 0) + 1;
        }
      }
    });

    return {
      regions: regions.map(r => ({
        id: `reg:${r.name}`,
        name: r.name,
        count: regionCounts[r.name] || 0,
        cities: cities.filter(c => c.region_id === r.id).map(c => ({
          id: `city:${c.name}`,
          name: c.name,
          regionName: r.name,
          count: cityCounts[`${r.id}_${c.name}`] || 0,
          barangays: barangays.filter(b => b.city_id === c.id).map(b => ({
            id: `brgy:${b.barangay}`,
            name: b.barangay,
            cityName: c.name,
            regionName: r.name,
            count: barangayCounts[`${c.id}_${b.barangay}`] || 0
          }))
        }))
      })),
      total: globalFilteredRecords.length
    };
  }, [regions, cities, barangays, globalFilteredRecords]);

  // Filter records based on location
  const filteredRecords = useMemo(() => {
    let filtered = globalFilteredRecords.filter(record => {
      let matchesLocation = selectedLocation === 'all';

      if (!matchesLocation) {
        if (selectedLocation.startsWith('reg:')) {
          const regionName = selectedLocation.substring(4);
          // Try to match region via city lookup since record doesn't have region field directly
          const matchedCity = cities.find(c => c.name === record.city);
          const matchedRegion = regions.find(r => r.id === matchedCity?.region_id);
          matchesLocation = matchedRegion?.name === regionName;
        } else if (selectedLocation.startsWith('city:')) {
          const cityName = selectedLocation.substring(5);
          matchesLocation = record.city === cityName;
        } else if (selectedLocation.startsWith('brgy:')) {
          const barangayName = selectedLocation.substring(5);
          matchesLocation = record.barangay === barangayName;
        }
      }

      return matchesLocation;
    });

    // Sorting logic
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue: any = (a as any)[sortColumn] || '';
        let bValue: any = (b as any)[sortColumn] || '';

        // Handle numeric values
        const numericColumns = [
          'total_amount', 'accountBalance', 'account_balance_before'
        ];

        if (numericColumns.includes(sortColumn)) {
          aValue = Number(aValue) || 0;
          bValue = Number(bValue) || 0;
        } else if (sortColumn === 'date_time' || sortColumn === 'updated_at') {
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
  }, [globalFilteredRecords, selectedLocation, cities, regions, sortColumn, sortDirection]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLocation, searchQuery, itemsPerPage, dateTimeFrom, dateTimeTo, activeFilters]);

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
    if (searchQuery || selectedLocation !== 'all' || Object.keys(activeFilters).length > 0) {
      return filteredRecords.length;
    }
    return Math.max(totalCount, records.length);
  }, [filteredRecords.length, totalCount, records.length, searchQuery, selectedLocation, activeFilters]);

  const totalPages = Math.ceil(totalDisplayCount / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };


  const handleRowClick = (record: PaymentPortalRecord) => {
    setSelectedRecord(record);
    setSelectedCustomer(null); // Clear customer view when switching records
  };

  const currentRecordIndex = selectedRecord 
    ? filteredRecords.findIndex(r => r.id === selectedRecord.id)
    : -1;

  const handlePreviousRecord = () => {
    if (currentRecordIndex > 0) {
      handleRowClick(filteredRecords[currentRecordIndex - 1]);
    }
  };

  const handleNextRecord = () => {
    if (currentRecordIndex !== -1 && currentRecordIndex < filteredRecords.length - 1) {
      handleRowClick(filteredRecords[currentRecordIndex + 1]);
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

  const currentCustomerIndex = selectedCustomer?.billingAccount?.accountNo
    ? filteredRecords.findIndex(r => r.accountNo === selectedCustomer.billingAccount!.accountNo || r.account_id === selectedCustomer.billingAccount!.accountNo)
    : -1;

  const handlePreviousCustomer = () => {
    if (currentCustomerIndex > 0) {
      const prevRecord = filteredRecords[currentCustomerIndex - 1];
      const accNo = prevRecord.accountNo || prevRecord.account_id;
      if (accNo) {
        handleViewCustomer(String(accNo));
      }
    }
  };

  const handleNextCustomer = () => {
    if (currentCustomerIndex !== -1 && currentCustomerIndex < filteredRecords.length - 1) {
      const nextRecord = filteredRecords[currentCustomerIndex + 1];
      const accNo = nextRecord.accountNo || nextRecord.account_id;
      if (accNo) {
        handleViewCustomer(String(accNo));
      }
    }
  };

  const handleRefresh = async () => {
    setHasNewData(false);
    setIsRefreshingManual(true);
    try {
      await fetchUpdates();
    } finally {
      setIsRefreshingManual(false);
    }
  };

  // Status text color component
  const StatusText = ({ status }: { status: string }) => {
    let textColor = '';

    switch (status?.toLowerCase()) {
      case 'completed':
      case 'success':
      case 'paid':
        textColor = 'text-green-500';
        break;
      case 'pending':
      case 'processing':
      case 'queued':
        textColor = 'text-yellow-500';
        break;
      case 'failed':
      case 'cancelled':
        textColor = 'text-red-500';
        break;
      default:
        textColor = 'text-gray-400';
    }

    return (
      <span className={`${textColor} capitalize`}>
        {status || 'N/A'}
      </span>
    );
  };

  const renderCellValue = (record: PaymentPortalRecord, columnKey: string) => {
    switch (columnKey) {
      case 'date_time':
        return record.date_time || 'N/A';
      case 'accountNo':
        return <span className="text-red-400 font-medium">{record.accountNo || record.account_id || 'N/A'}</span>;
      case 'fullName':
        return record.fullName || 'N/A';
      case 'total_amount':
        return formatCurrency(record.total_amount || 0);
      case 'status':
        return <StatusText status={record.status || 'N/A'} />;
      case 'reference_no':
        return record.reference_no || 'N/A';
      case 'contactNo':
        return record.contactNo || 'N/A';
      case 'accountBalance':
        return formatCurrency(record.accountBalance || 0);
      case 'checkout_id':
        return record.checkout_id || 'N/A';
      case 'transaction_status':
        return <StatusText status={record.transaction_status || 'N/A'} />;
      case 'payment_channel':
        return record.payment_channel || 'N/A';
      case 'updated_at':
        return record.updated_at ? new Date(record.updated_at).toLocaleString() : 'N/A';
      default:
        return 'N/A';
    }
  };

  const handleExport = () => {
    if (!filteredRecords || filteredRecords.length === 0) return;

    const exportColumns = allColumns
      .filter(col => visibleColumns.includes(col.key))
      .sort((a, b) => {
        const indexA = columnOrder.indexOf(a.key);
        const indexB = columnOrder.indexOf(b.key);
        return indexA - indexB;
      });

    const getExportValue = (record: PaymentPortalRecord, columnKey: string) => {
      switch (columnKey) {
        case 'accountNo':
          return record.accountNo || record.account_id || '-';
        case 'status':
          return record.status || '-';
        case 'transaction_status':
          return record.transaction_status || '-';
        case 'total_amount':
          return formatCurrency(record.total_amount || 0);
        case 'accountBalance':
          return formatCurrency(record.accountBalance || 0);
        default:
          return renderCellValue(record, columnKey);
      }
    };

    exportToCSV('payment_portal_export', exportColumns, filteredRecords, getExportValue);
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden relative ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      {/* Location Sidebar Container */}
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
              }`}>Payment Portal</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Date Range Filter Section */}
          <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Date Range
              </span>
              {(dateTimeFrom || dateTimeTo) && (
                <button
                  onClick={() => {
                    setDateTimeFrom('');
                    setDateTimeTo('');
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
                  value={dateTimeFrom}
                  onChange={(e) => setDateTimeFrom(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={dateTimeFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
              <div className="relative">
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                <input
                  type="date"
                  value={dateTimeTo}
                  onChange={(e) => setDateTimeTo(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={dateTimeTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
            </div>
          </div>

          {/* All Level */}
          <button
            onClick={() => setSelectedLocation('all')}
            className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
              } ${selectedLocation === 'all'
                ? ''
                : isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}
            style={selectedLocation === 'all' ? {
              backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
              color: colorPalette?.primary || '#7c3aed'
            } : {}}
          >
            <div className="flex items-center">
              <span>All Records</span>
            </div>
            <span
              className={`px-2 py-1 rounded-full text-xs ${selectedLocation === 'all'
                ? 'text-white'
                : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                }`}
              style={selectedLocation === 'all' ? {
                backgroundColor: colorPalette?.primary || '#7c3aed'
              } : {}}
            >
              {locationItems.total}
            </span>
          </button>

          {/* Region Level */}
          {locationItems.regions.map((region: any) => (
            <div key={region.id}>
              <button
                onClick={() => setSelectedLocation(region.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                  } ${selectedLocation === region.id
                    ? ''
                    : isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                style={selectedLocation === region.id ? {
                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                  color: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                <div className="flex items-center flex-1">
                  <button
                    onClick={(e) => toggleLocationExpansion(e, region.id)}
                    className="p-1 mr-1"
                  >
                    {expandedLocations.has(region.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <Globe className="h-4 w-4 mr-2" />
                  <span>{region.name}</span>
                </div>
                {region.count > 0 && (
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${selectedLocation === region.id
                      ? 'text-white'
                      : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                      }`}
                    style={selectedLocation === region.id ? {
                      backgroundColor: colorPalette?.primary || '#7c3aed'
                    } : {}}
                  >
                    {region.count}
                  </span>
                )}
              </button>

              {/* City Level */}
              {expandedLocations.has(region.id) && region.cities.map((city: any) => (
                <div key={city.id}>
                  <button
                    onClick={() => setSelectedLocation(city.id)}
                    className={`w-full flex items-center justify-between pl-10 pr-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                      } ${selectedLocation === city.id
                        ? ''
                        : isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}
                    style={selectedLocation === city.id ? {
                      backgroundColor: colorPalette?.primary ? `${colorPalette.primary}22` : 'rgba(249, 115, 22, 0.1)',
                      color: colorPalette?.primary || '#7c3aed'
                    } : {}}
                  >
                    <div className="flex items-center flex-1">
                      <button
                        onClick={(e) => toggleLocationExpansion(e, city.id)}
                        className="p-1 mr-1"
                      >
                        {expandedLocations.has(city.id) ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </button>
                      <span>{city.name}</span>
                    </div>
                    {city.count > 0 && (
                      <span className="text-xs opacity-60">{city.count}</span>
                    )}
                  </button>

                  {/* Barangay Level */}
                  {expandedLocations.has(city.id) && city.barangays.map((barangay: any) => (
                    <button
                      key={barangay.id}
                      onClick={() => setSelectedLocation(barangay.id)}
                      className={`w-full flex items-center justify-between pl-16 pr-4 py-1.5 text-xs transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                        } ${selectedLocation === barangay.id
                          ? ''
                          : isDarkMode ? 'text-gray-500' : 'text-gray-500'
                        }`}
                      style={selectedLocation === barangay.id ? {
                        color: colorPalette?.primary || '#7c3aed',
                        fontWeight: 'bold'
                      } : {}}
                    >
                      <div className="flex items-center flex-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-current mr-2 opacity-40"></span>
                        <span>{barangay.name}</span>
                      </div>
                      {barangay.count > 0 && (
                        <span className="text-[10px] opacity-50">{barangay.count}</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
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

      {/* Payment Portal Records List - Shrinks when detail view is shown */}
      <div className={`${
        mobileViewMode === 'list' || !isMobile ? 'flex-1 flex flex-col' : 'hidden'
      } overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="flex flex-col h-full">
          {/* Search Bar */}
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="flex items-center justify-between space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
              <div className="flex items-center space-x-3 flex-1 min-w-[250px]">
                {mobileViewMode === 'list' && (
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
                    placeholder="Search payment portal records..."
                  />
                </div>
              </div>
              <button
                onClick={() => setIsFunnelFilterOpen(true)}
                title={Object.keys(activeFilters).length > 0
                  ? `Active Filters:\n${Object.entries(activeFilters).map(([key, filter]: [string, any]) => {
                    const colName = filterColumns.find(c => c.key === key)?.label || key;
                    if (filter.type === 'text') return `${colName}: ${filter.value}`;
                    if (filter.type === 'checklist') {
                      return `${colName}: ${Array.isArray(filter.value) ? filter.value.join(', ') : filter.value}`;
                    }
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
                    return colName;
                  }).join('\n')}`
                  : "Filter Payment Portal Records"
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
                      <span className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
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
                      {allColumns.map((column) => (
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
              <button
                onClick={handleExport}
                disabled={loading || filteredRecords.length === 0}
                title="Export to CSV"
                className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border flex-shrink-0"
                style={{
                  backgroundColor: '#ffffff',
                  borderColor: colorPalette?.primary || '#7c3aed',
                  color: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (!loading && filteredRecords.length > 0 && colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && filteredRecords.length > 0) {
                    e.currentTarget.style.backgroundColor = '#ffffff';
                  }
                }}
              >
                <Download className="h-5 w-5" />
              </button>
              <button
                onClick={handleRefresh}
                disabled={loading || !isFullyLoaded || isRefreshingManual}
                title={!isFullyLoaded ? `Loading records... (${records.length}/${totalCount})` : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
                className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border flex-shrink-0"
                style={{
                  backgroundColor: '#ffffff',
                  borderColor: colorPalette?.primary || '#7c3aed',
                  color: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (!loading && isFullyLoaded && !isRefreshingManual && colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && isFullyLoaded && !isRefreshingManual) {
                    e.currentTarget.style.backgroundColor = '#ffffff';
                  }
                }}
              >
                <RefreshCw className={`h-5 w-5 ${(loading || !isFullyLoaded || isRefreshingManual) ? 'animate-spin' : ''}`} />
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
                    localStorage.removeItem('paymentPortalFunnelFilters');
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

          {/* Table Container */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-x-auto overflow-y-auto" ref={scrollRef}>
              {loading ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <div className="animate-pulse flex flex-col items-center">
                    <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                    <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                  </div>
                  <p className="mt-4">Loading payment portal records...</p>
                </div>
              ) : error ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                  <p>{error}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className={`mt-4 px-4 py-2 rounded text-white ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-400 hover:bg-gray-500'}`}>
                    Retry
                  </button>
                </div>
              ) : (
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
                  <tbody className={`${isDarkMode ? 'bg-gray-900 divide-y divide-gray-800' : 'bg-white divide-y divide-gray-200'
                    }`}>
                    {paginatedRecords.length > 0 ? (
                      paginatedRecords.map((record: PaymentPortalRecord) => (
                        <tr
                          key={record.id}
                          className={`border-b cursor-pointer transition-colors ${isDarkMode
                            ? 'border-gray-800 hover:bg-gray-900'
                            : 'border-gray-200 hover:bg-gray-50'
                            } ${selectedRecord?.id === record.id ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
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
                        <td colSpan={filteredColumns.length} className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                          {filteredRecords.length > 0
                            ? 'No payment portal records found matching your filters'
                            : (totalCount > records.length)
                              ? 'Loading more records... please wait.'
                              : 'No payment portal records found.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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



      {/* Payment Portal Detail View - Only visible when a record is selected */}
      {selectedRecord && (
        <div className="flex-shrink-0 overflow-hidden">
          <PaymentPortalDetails
            record={selectedRecord}
            onClose={() => setSelectedRecord(null)}
            onViewCustomer={handleViewCustomer}
            onPrevious={currentRecordIndex > 0 ? handlePreviousRecord : undefined}
            onNext={currentRecordIndex !== -1 && currentRecordIndex < filteredRecords.length - 1 ? handleNextRecord : undefined}
          />
        </div>
      )}

      {(selectedCustomer || isLoadingDetails) && (
        <div className="flex-shrink-0 overflow-hidden">
          {isLoadingDetails ? (
            <div className={`w-[600px] h-full flex items-center justify-center border-l ${isDarkMode
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
              onPrevious={currentCustomerIndex > 0 ? handlePreviousCustomer : undefined}
              onNext={currentCustomerIndex !== -1 && currentCustomerIndex < filteredRecords.length - 1 ? handleNextCustomer : undefined}
            />
          ) : null}
        </div>
      )}
      <PaymentPortalFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          setActiveFilters(filters);
          localStorage.setItem('paymentPortalFunnelFilters', JSON.stringify(filters));
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={activeFilters}
      />
    </div>
  );
};

export default PaymentPortal;
