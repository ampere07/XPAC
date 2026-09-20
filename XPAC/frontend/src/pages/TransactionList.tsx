import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Receipt, ChevronLeft, ChevronDown, CheckCheck, X, Check, ChevronRight, Menu, FileText, Globe, Filter, ChevronsLeft, ChevronsRight, RefreshCw, Loader2, ArrowUp, ArrowDown, Columns3, Download } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import TransactionListDetails from '../components/TransactionListDetails';
import { transactionService } from '../services/transactionService';
import { getCities, City } from '../services/cityService';
import { getRegions, Region } from '../services/regionService';
import { barangayService, Barangay } from '../services/barangayService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useTransactionStore } from '../store/transactionStore';
import pusher from '../services/pusherService';
import { Transaction } from '../types/transaction';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';


import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import TransactionFunnelFilter, { FilterValues, allColumns } from '../filter/TransactionFunnelFilter';
import SessionExpiredModal from '../components/SessionExpiredModal';
import apiClient from '../config/api';
import { exportToCSV } from '../utils/exportUtils';
import { usePermissions } from '../hooks/usePermissions';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

interface LocationItem {
  id: string;
  name: string;
  count: number;
}

const transactionTableColumns = [
  { key: 'date_processed', label: 'Date Processed', width: 'min-w-40' },
  { key: 'created_at', label: 'Created At', width: 'min-w-40' },
  { key: 'account_no', label: 'Account No.', width: 'min-w-36' },
  { key: 'received_payment', label: 'Received Payment', width: 'min-w-36' },
  { key: 'payment_method', label: 'Payment Method', width: 'min-w-36' },
  { key: 'processed_by', label: 'Processed By', width: 'min-w-40' },
  { key: 'full_name', label: 'Full Name', width: 'min-w-40' },
  { key: 'or_no', label: 'OR No.', width: 'min-w-28' },
  { key: 'reference_no', label: 'Reference No.', width: 'min-w-36' },
  { key: 'remarks', label: 'Remarks', width: 'min-w-48' },
  { key: 'status', label: 'Status', width: 'min-w-28' },
  { key: 'transaction_type', label: 'Transaction Type', width: 'min-w-36' },
  { key: 'barangay', label: 'Barangay', width: 'min-w-32' },
  { key: 'id', label: 'Transaction ID', width: 'min-w-32' },
  { key: 'contact_no', label: 'Contact No', width: 'min-w-36' },
  { key: 'approved_by', label: 'Modified By', width: 'min-w-36' },
  { key: 'updated_at', label: 'Modified Date', width: 'min-w-40' },
  { key: 'payment_date', label: 'Payment Date', width: 'min-w-36' },
  { key: 'account_balance', label: 'Account Balance', width: 'min-w-36' },
];

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
          className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === 1
            ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
            : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
            }`}
          title="First Page"
        >
          <ChevronsLeft size={16} />
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
          className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === totalPages
            ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
            : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
            }`}
          title="Last Page"
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  );
};

interface TransactionListProps {
  onNavigate?: (section: string, extra?: string) => void;
}

const TransactionList: React.FC<TransactionListProps> = ({ onNavigate }) => {
  const { transactions, totalCount, isLoading: loading, error, silentRefresh, fetchTransactions, fetchUpdates } = useTransactionStore();

  // Fetch data on mount if empty
  useEffect(() => {
    if (transactions.length === 0) {
      fetchTransactions();
    }
  }, [fetchTransactions, transactions.length]);

  // Data is managed by the store. 
  // Initialization happens in the first useEffect and polling handles updates.
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        setUserRole(userData.role || '');
        setRoleId(userData.role_id || null);
        
        let perms: string[] = [];
        if (userData.permissions) {
          if (Array.isArray(userData.permissions)) {
            perms = userData.permissions;
          } else if (typeof userData.permissions === 'string') {
            try {
              const parsed = JSON.parse(userData.permissions);
              perms = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
              perms = userData.permissions.split(',').map((p: string) => p.trim()).filter(Boolean);
            }
          }
        }
        setUserPermissions(perms);
      } catch (error) {
        console.error('Error parsing auth data in TransactionList:', error);
      }
    }
  }, []);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
  const { can: hasPermission } = usePermissions();

  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const selectedTransactionRef = useRef<Transaction | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewers, setViewers] = useState<Record<string, string[]>>({});
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
  const isFullyLoaded = totalCount === 0 || transactions.length >= totalCount;

  const broadCastViewing = async (id: string, action: string) => {
    try {
      await apiClient.post('/transactions/broadcast-viewing', {
        transaction_id: id,
        action: action
      });
    } catch (err) {
      console.error('[Presence] Failed to broadcast viewing:', err);
    }
  };

  // Local state for batch approval (kept local as it's UI functionality)
  const [isBatchApproveMode, setIsBatchApproveMode] = useState<boolean>(false);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const [showFailedModal, setShowFailedModal] = useState<boolean>(false);
  const [approvalMessage, setApprovalMessage] = useState<string>('');
  const [approvalDetails, setApprovalDetails] = useState<any>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [customerRefreshKey, setCustomerRefreshKey] = useState<number>(0);
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<FilterValues>(() => {
    const saved = localStorage.getItem('transactionFunnelFilters');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    }
    return {};
  });

  const [processedDateFrom, setProcessedDateFrom] = useState<string>('');
  const [processedDateTo, setProcessedDateTo] = useState<string>('');

  const removeFilter = (key: string) => {
    const newFilters = { ...activeFilters };
    delete newFilters[key];
    setActiveFilters(newFilters);
    localStorage.setItem('transactionFunnelFilters', JSON.stringify(newFilters));
  };

  const [showSessionExpired, setShowSessionExpired] = useState(false);

  useEffect(() => {
    const handleExpired = () => {
      setShowSessionExpired(true);
    };

    window.addEventListener('auth:session-expired', handleExpired);
    
    return () => {
      window.removeEventListener('auth:session-expired', handleExpired);
    };
  }, []);

  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [mobileViewMode, setMobileViewMode] = useState<'sidebar' | 'list'>('sidebar');

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-navigate to list view when location/date range changes on mobile
  useEffect(() => {
    if (isMobile && (selectedLocation !== 'all' || processedDateFrom || processedDateTo)) {
      setMobileViewMode('list');
    }
  }, [selectedLocation, processedDateFrom, processedDateTo, isMobile]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);


  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const [sortColumn, setSortColumn] = useState<string | null>('date_processed');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('transactionTableColumnOrder');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load column order:', err);
      }
    }
    return transactionTableColumns.map(col => col.key);
  });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('transactionTableVisibleColumns');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load column visibility:', err);
      }
    }
    return transactionTableColumns.map(col => col.key);
  });
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const colStartXRef = useRef<number>(0);
  const colStartWidthRef = useRef<number>(0);

  // Dark mode synchronization logic
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
    selectedTransactionRef.current = selectedTransaction;
  }, [selectedTransaction]);

  // Auto-update selectedTransaction when transactions list updates (from Pusher or Refresh)
  useEffect(() => {
    if (selectedTransactionRef.current && transactions.length > 0) {
      const updatedMatch = transactions.find(t => t.id === selectedTransactionRef.current?.id);
      if (updatedMatch && JSON.stringify(updatedMatch) !== JSON.stringify(selectedTransactionRef.current)) {
        setSelectedTransaction(updatedMatch);
      }
    }
  }, [transactions]);

  // Fetch theme data
  useEffect(() => {
    const fetchThemeData = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };

    fetchThemeData();
  }, []);

  const handleRefresh = async () => {
    setHasNewData(false);
    setIsRefreshingManual(true);
    try {
      await fetchUpdates();
    } finally {
      setIsRefreshingManual(false);
    }
  };

  // Fetch lookup data
  useEffect(() => {
    const fetchLookupData = async () => {
      try {
        const [citiesData, regionsData, barangaysRes, pmRes] = await Promise.all([
          getCities(),
          getRegions(),
          barangayService.getAll(),
          paymentMethodService.getAll()
        ]);
        setCities(citiesData || []);
        setRegions(regionsData || []);
        setBarangays(barangaysRes.success ? barangaysRes.data : []);
        if (pmRes.success) {
          setPaymentMethods(pmRes.data);
        }
      } catch (err) {
        console.error('Failed to fetch lookup data:', err);
      }
    };

    fetchLookupData();
  }, []);

  // Pusher/Soketi connection for real-time transaction updates
  useEffect(() => {
    const channel = pusher.subscribe('transactions');

    channel.bind('transaction-updated', async (data: any) => {
      setHasNewData(true);
      try {
        await fetchUpdates();
      } catch (err) {
        console.error('[TransactionList Soketi] Failed to refresh data:', err);
      }
    });

    // Log connection state for debugging
    const stateHandler = (states: { previous: string; current: string }) => {
      if (states.current === 'connected' && channel.subscribed !== true) {
        pusher.subscribe('transactions');
      }
    };
    pusher.connection.bind('state_change', stateHandler);

    return () => {
      channel.unbind('pusher:subscription_succeeded');
      channel.unbind('pusher:subscription_error');
      channel.unbind('transaction-updated');
      pusher.connection.unbind('state_change', stateHandler);
      pusher.unsubscribe('transactions');
    };
  }, [fetchUpdates]);

  // Presence channel for knowing who's viewing what
  useEffect(() => {
    const presenceChannel = pusher.subscribe('presence-transactions-presence');

    presenceChannel.bind('viewing-update', (data: { transaction_id: string; username: string; action: string }) => {
      setViewers(prev => {
        const username = data.username;
        const currentViewers = prev[String(data.transaction_id)] || [];
        if (data.action === 'started_viewing') {
          if (!currentViewers.includes(username)) {
            return { ...prev, [String(data.transaction_id)]: [...currentViewers, username] };
          }
        } else if (data.action === 'stopped_viewing') {
          return { ...prev, [String(data.transaction_id)]: currentViewers.filter(name => name !== username) };
        }
        return prev;
      });
    });

    presenceChannel.bind('pusher:member_removed', (member: any) => {
      const identifier = member.info?.username || member.info?.email;
      if (identifier) {
        setViewers(prev => {
          const newState = { ...prev };
          Object.keys(newState).forEach(id => {
            newState[id] = (newState[id] || []).filter(e => e !== identifier);
          });
          return newState;
        });
      }
    });

    presenceChannel.bind('pusher:subscription_succeeded', (members: any) => {
    });

    presenceChannel.bind('pusher:member_added', (member: any) => {
      // If we are currently viewing a transaction, broadcast it so the new member knows
      if (selectedTransactionRef.current) {
        broadCastViewing(String(selectedTransactionRef.current.id), 'started_viewing');
      }
    });

    return () => {
      presenceChannel.unbind_all();
      pusher.unsubscribe('presence-transactions-presence');
    };
  }, []);

  // Polling for updates every 3 seconds - Incremental fetch
  useEffect(() => {
    const POLLING_INTERVAL = 3000; // 3 seconds
    const intervalId = setInterval(async () => {
      try {
        await fetchUpdates();
      } catch (err) {
        console.error('[TransactionList Page] Polling failed:', err);
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
        await fetchUpdates();
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

    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [fetchUpdates]);



  useEffect(() => {
    if (!resizingColumn) return;
    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - colStartXRef.current;
      const newWidth = Math.max(80, colStartWidthRef.current + diff);
      setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
    };
    const handleMouseUp = () => setResizingColumn(null);
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
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const formatDate = (dateStr?: string, includeTime: boolean = false): string => {
    if (!dateStr) return 'No date';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr || 'Invalid Date';

      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();

      if (includeTime) {
        let hours = date.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${mm}/${dd}/${yyyy} ${hours}:${minutes}:${seconds} ${ampm}`;
      }

      return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
      console.warn('Error formatting date:', dateStr, e);
      return dateStr || 'Error';
    }
  };

  const formatCurrency = (amount: number | string | null | undefined) => {
    if (amount === null || amount === undefined || amount === '') return '₱0.00';
    try {
      const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
      if (isNaN(numAmount)) return '₱0.00';
      return `₱${numAmount.toFixed(2)}`;
    } catch (e) {
      console.warn('Error formatting currency:', amount, e);
      return '₱0.00';
    }
  };

  const getPaymentMethodName = (pmId: string | number | null | undefined): string => {
    if (!pmId) return '-';
    // Ensure paymentMethods is available (it's fetched on mount in this component)
    const pm = paymentMethods.find(m => String(m.id) === String(pmId));
    return pm ? pm.payment_method : String(pmId);
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
  const globalFilteredTransactions = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
    let filtered = transactions.filter(transaction => {
      // Organization filter — mirrors applicationmanagement.tsx logic exactly
      if (userOrgId) {
        if (transaction.organization_id !== userOrgId) return false;
      } else {
        if (transaction.organization_id) return false;
      }

      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') {
          return Object.values(val).some(v => checkValue(v));
        }
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };

      return searchQuery === '' || checkValue(transaction);
    });

    // Apply funnel filters
    if (activeFilters && Object.keys(activeFilters).length > 0) {
      filtered = filtered.filter(transaction => {
        return Object.entries(activeFilters).every(([key, filter]: [string, any]) => {
          const getValForFilter = (item: any, k: string) => {
            switch (k) {
              case 'id': return item.id;
              case 'account_no': return item.account?.account_no || item.account_no;
              case 'full_name': return item.account?.customer?.full_name;
              case 'contact_no': return item.account?.customer?.contact_number_primary;
              case 'date_processed': return item.date_processed;
              case 'processed_by_user': return item.processor?.email_address || item.processed_by_user;
              case 'payment_method': return item.payment_method_info?.payment_method || getPaymentMethodName(item.payment_method);
              case 'reference_no': return item.reference_no;
              case 'or_no': return item.or_no;
              case 'remarks': return item.remarks;
              case 'status': return item.status;
              case 'transaction_type': return item.transaction_type;
              case 'barangay': return item.account?.customer?.barangay;
              case 'city': return item.account?.customer?.city;
              case 'region': return item.account?.customer?.region;
              case 'account_balance': return item.account?.account_balance;
              default: return item[k];
            }
          };

          const val = getValForFilter(transaction, key);

          if (filter.type === 'checklist') {
            if (!filter.value || !Array.isArray(filter.value) || filter.value.length === 0) return true;

            const valStr = String(val || '').toLowerCase().trim();

            if (key === 'barangay' || key === 'city' || key === 'region') {
              const directVal = String(val || '').toLowerCase().trim();
              const address = String(transaction.account?.customer?.address || '').toLowerCase();

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
            if (filter.from && dateValue < new Date(filter.from).getTime()) return false;
            if (filter.to && dateValue > new Date(filter.to).getTime()) return false;
            return true;
          }

          return true;
        });
      });
    }

    // Apply sidebar date range filters for date_processed
    if (processedDateFrom || processedDateTo) {
      filtered = filtered.filter(transaction => {
        if (!transaction.date_processed) return false;

        const dateValue = new Date(transaction.date_processed).getTime();
        if (isNaN(dateValue)) return false;

        if (processedDateFrom) {
          const fromDate = new Date(processedDateFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (dateValue < fromDate.getTime()) return false;
        }

        if (processedDateTo) {
          const toDate = new Date(processedDateTo);
          toDate.setHours(23, 59, 59, 999);
          if (dateValue > toDate.getTime()) return false;
        }

        return true;
      });
    }

    return filtered;
  }, [transactions, searchQuery, activeFilters, processedDateFrom, processedDateTo, userOrgId]);

  // Generate hierarchical location items - Now using globalFilteredTransactions
  const locationItems = useMemo(() => {
    // Counts for each level
    const regionCounts: Record<string, number> = {};
    const cityCounts: Record<string, number> = {};
    const barangayCounts: Record<string, number> = {};

    // Initialize counts
    regions.forEach(r => regionCounts[r.name] = 0);
    cities.forEach(c => cityCounts[`${c.region_id}_${c.name}`] = 0);
    barangays.forEach(b => barangayCounts[`${b.city_id}_${b.barangay}`] = 0);

    // Count appearances in transactions
    globalFilteredTransactions.forEach(transaction => {
      const region = transaction.account?.customer?.region;
      const city = transaction.account?.customer?.city;
      const barangay = transaction.account?.customer?.barangay;

      if (region) regionCounts[region] = (regionCounts[region] || 0) + 1;

      if (city) {
        const matchedCity = cities.find(c => c.name === city);
        if (matchedCity) {
          cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] = (cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] || 0) + 1;
        }
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
      total: globalFilteredTransactions.length
    };
  }, [regions, cities, barangays, globalFilteredTransactions]);

  const filteredTransactions = useMemo(() => {
    let filtered = globalFilteredTransactions.filter(transaction => {
      let matchesLocation = selectedLocation === 'all';

      if (!matchesLocation) {
        if (selectedLocation.startsWith('reg:')) {
          matchesLocation = transaction.account?.customer?.region === selectedLocation.substring(4);
        } else if (selectedLocation.startsWith('city:')) {
          matchesLocation = transaction.account?.customer?.city === selectedLocation.substring(5);
        } else if (selectedLocation.startsWith('brgy:')) {
          matchesLocation = transaction.account?.customer?.barangay === selectedLocation.substring(5);
        }
      }

      return matchesLocation;
    });

    if (sortColumn) {
      const numericCols = ['received_payment', 'account_balance'];
      const dateCols = ['date_processed', 'created_at', 'updated_at', 'payment_date'];
      filtered = [...filtered].sort((a, b) => {
        const getVal = (t: any) => {
          switch (sortColumn) {
            case 'date_processed': return t.date_processed;
            case 'created_at': return t.created_at;
            case 'account_no': return t.account?.account_no || '';
            case 'received_payment': return Number(t.received_payment) || 0;
            case 'payment_method': return t.payment_method_info?.payment_method || String(t.payment_method || '');
            case 'processed_by': return t.processor?.email_address || t.processed_by_user || '';
            case 'full_name': return t.account?.customer?.full_name || '';
            case 'or_no': return t.or_no || '';
            case 'reference_no': return t.reference_no || '';
            case 'remarks': return t.remarks || '';
            case 'status': return t.status || '';
            case 'transaction_type': return t.transaction_type || '';
            case 'barangay': return t.account?.customer?.barangay || '';
            case 'id': return Number(t.id) || 0;
            case 'contact_no': return t.account?.customer?.contact_number_primary || '';
            case 'approved_by': return t.approved_by || '';
            case 'updated_at': return t.updated_at;
            case 'payment_date': return t.payment_date;
            case 'account_balance': return Number(t.account?.account_balance) || 0;
            default: return '';
          }
        };
        let aVal = getVal(a);
        let bVal = getVal(b);
        if (dateCols.includes(sortColumn)) {
          aVal = new Date(aVal || '').getTime() || 0;
          bVal = new Date(bVal || '').getTime() || 0;
        } else if (!numericCols.includes(sortColumn) && sortColumn !== 'id') {
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
        }
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [globalFilteredTransactions, selectedLocation, sortColumn, sortDirection]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLocation, searchQuery, activeFilters, itemsPerPage, processedDateFrom, processedDateTo]);

  // Scroll to top on page change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

  useEffect(() => {
    return () => {
      if (selectedTransaction) {
        broadCastViewing(String(selectedTransaction.id), 'stopped_viewing');
      }
    };
  }, [selectedTransaction]);

  const paginatedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTransactions.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTransactions, currentPage, itemsPerPage]);

  // Use totalCount for total pages if no filter/search is active
  const totalDisplayCount = useMemo(() => {
    if (searchQuery || selectedLocation !== 'all' || Object.keys(activeFilters).length > 0) {
      return filteredTransactions.length;
    }
    return Math.max(totalCount, transactions.length);
  }, [filteredTransactions.length, totalCount, transactions.length, searchQuery, selectedLocation, activeFilters]);

  const totalPages = Math.ceil(totalDisplayCount / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };


  const handleRowClick = (transaction: Transaction) => {
    if (isBatchApproveMode) {
      if ((transaction.status || '').toLowerCase() === 'pending') {
        toggleTransactionSelection(transaction.id);
      }
    } else {
      // Presence broadcasting
      if (selectedTransaction && String(selectedTransaction.id) !== String(transaction.id)) {
        broadCastViewing(String(selectedTransaction.id), 'stopped_viewing');
      }
      if (!selectedTransaction || String(selectedTransaction.id) !== String(transaction.id)) {
        broadCastViewing(String(transaction.id), 'started_viewing');
      }

      setSelectedTransaction(transaction);
      setSelectedCustomer(null);
    }
  };

  const refreshCustomerDetails = async (accountNo: string) => {
    try {
      const detail = await getCustomerDetail(accountNo);
      if (detail) {
        setSelectedCustomer(detail);
        setCustomerRefreshKey(prev => prev + 1);
      }
    } catch (err) {
      console.error('Error refreshing customer details:', err);
    }
  };

  const handleApprovalSuccess = async () => {
    await fetchUpdates();
    // Sync selectedTransaction with fresh store data
    if (selectedTransaction) {
      const freshTransactions = useTransactionStore.getState().transactions;
      const updated = freshTransactions.find(t => t.id === selectedTransaction.id);
      if (updated) setSelectedTransaction(updated);
    }
    // Refresh customer panel if open
    if (selectedCustomer) {
      const accountNo = selectedCustomer.billingAccount?.accountNo;
      if (accountNo) await refreshCustomerDetails(accountNo);
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
    ? filteredTransactions.findIndex(t => t.account?.account_no === selectedCustomer.billingAccount!.accountNo)
    : -1;

  const handlePreviousCustomer = () => {
    if (currentCustomerIndex > 0) {
      const prevTx = filteredTransactions[currentCustomerIndex - 1];
      if (prevTx.account?.account_no) {
        handleViewCustomer(prevTx.account.account_no);
      }
    }
  };

  const handleNextCustomer = () => {
    if (currentCustomerIndex !== -1 && currentCustomerIndex < filteredTransactions.length - 1) {
      const nextTx = filteredTransactions[currentCustomerIndex + 1];
      if (nextTx.account?.account_no) {
        handleViewCustomer(nextTx.account.account_no);
      }
    }
  };

  const toggleTransactionSelection = (transactionId: string) => {
    const transaction = transactions.find(t => t.id === transactionId);
    if (!transaction || (transaction.status || '').toLowerCase() !== 'pending') {
      return;
    }

    setSelectedTransactionIds(prev => {
      if (prev.includes(transactionId)) {
        return prev.filter(id => id !== transactionId);
      } else {
        return [...prev, transactionId];
      }
    });
  };

  const currentTransactionIndex = selectedTransaction 
    ? filteredTransactions.findIndex(t => t.id === selectedTransaction.id)
    : -1;

  const handlePreviousTransaction = () => {
    if (currentTransactionIndex > 0) {
      handleRowClick(filteredTransactions[currentTransactionIndex - 1]);
    }
  };

  const handleNextTransaction = () => {
    if (currentTransactionIndex !== -1 && currentTransactionIndex < filteredTransactions.length - 1) {
      handleRowClick(filteredTransactions[currentTransactionIndex + 1]);
    }
  };

  const toggleSelectAll = () => {
    const pendingTransactions = filteredTransactions.filter(t => (t.status || '').toLowerCase() === 'pending');
    const pendingTransactionIds = pendingTransactions.map(t => t.id);

    if (selectedTransactionIds.length === pendingTransactionIds.length && pendingTransactionIds.length > 0) {
      setSelectedTransactionIds([]);
    } else {
      setSelectedTransactionIds(pendingTransactionIds);
    }
  };

  const handleCancelApprove = () => {
    setIsBatchApproveMode(false);
    setSelectedTransactionIds([]);
  };

  const handleBatchApprove = async () => {
    if (selectedTransactionIds.length === 0) {
      return;
    }

    setShowConfirmModal(true);
  };

  const confirmBatchApproval = async () => {
    setShowConfirmModal(false);

    try {
      setIsApproving(true);

      let currentUserEmail = '';
      try {
        const authData = localStorage.getItem('authData');
        if (authData) {
          const parsed = JSON.parse(authData);
          currentUserEmail = parsed.email || parsed.user?.email || '';
        }
      } catch (err) {
        console.error('Error getting current user email:', err);
      }

      const result = await transactionService.batchApproveTransactions(selectedTransactionIds, currentUserEmail);

      if (result.success) {
        const successCount = result.data?.success?.length || 0;
        const failedCount = result.data?.failed?.length || 0;

        setApprovalDetails(result.data);

        if (failedCount > 0) {
          setApprovalMessage(
            `Batch approval completed with some failures: ${successCount} successful, ${failedCount} failed`
          );
          setShowFailedModal(true);
        } else {
          setApprovalMessage(
            `Successfully approved ${successCount} transaction(s)`
          );
          setShowSuccessModal(true);
        }

        setIsBatchApproveMode(false);
        setSelectedTransactionIds([]);

        // Refresh transactions using context
        await fetchUpdates();
        // Refresh customer panel if open
        if (selectedCustomer) {
          const accountNo = selectedCustomer.billingAccount?.accountNo;
          if (accountNo) await refreshCustomerDetails(accountNo);
        }
      } else {
        setApprovalMessage(result.message || 'Failed to approve transactions');
        setShowFailedModal(true);
      }
    } catch (err: any) {
      console.error('Batch approval error:', err);
      setApprovalMessage(`Failed to approve transactions: ${err.message}`);
      setShowFailedModal(true);
    } finally {
      setIsApproving(false);
    }
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

  const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarStartXRef.current = e.clientX;
    sidebarStartWidthRef.current = sidebarWidth;
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
    if (draggedColumn && draggedColumn !== columnKey) setDragOverColumn(columnKey);
  };

  const handleDragLeave = () => setDragOverColumn(null);

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetKey) {
      setDraggedColumn(null);
      setDragOverColumn(null);
      return;
    }
    const newOrder = [...columnOrder];
    const fromIdx = newOrder.indexOf(draggedColumn);
    const toIdx = newOrder.indexOf(targetKey);
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedColumn);
    setColumnOrder(newOrder);
    localStorage.setItem('transactionTableColumnOrder', JSON.stringify(newOrder));
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
    colStartXRef.current = e.clientX;
    const th = (e.target as HTMLElement).closest('th');
    if (th) colStartWidthRef.current = th.offsetWidth;
  };

  const handleToggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem('transactionTableVisibleColumns', JSON.stringify(next));
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = transactionTableColumns.map(c => c.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('transactionTableVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('transactionTableVisibleColumns', JSON.stringify([]));
  };

  const filteredColumns = transactionTableColumns
    .filter(col => visibleColumns.includes(col.key))
    .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key));

  const StatusText = ({ status }: { status?: string | null }) => {
    let textColor = '';
    const statusLower = (status || '').toLowerCase();

    switch (statusLower) {
      case 'done':
      case 'completed':
        textColor = 'text-green-500';
        break;
      case 'pending':
        textColor = 'text-yellow-500';
        break;
      case 'processing':
        textColor = 'text-blue-500';
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
        {status || 'Unknown'}
      </span>
    );
  };

  const renderCellValue = (transaction: Transaction, columnKey: string) => {
    switch (columnKey) {
      case 'date_processed':
        return formatDate(transaction.date_processed, true);
      case 'created_at':
        return formatDate(transaction.created_at, true);
      case 'account_no':
        return (
          <div className="flex items-center space-x-2 min-w-0">
            <span className="text-red-400 font-medium">{transaction.account?.account_no || '-'}</span>
            {viewers[String(transaction.id)] && viewers[String(transaction.id)].length > 0 && (
              <div className="flex flex-wrap gap-1 flex-shrink-0">
                {viewers[String(transaction.id)].map((username: string) => (
                  <span
                    key={username}
                    className="text-[8px] px-1.5 py-0.5 rounded-full font-bold animate-pulse lowercase shadow-sm"
                    style={{ backgroundColor: colorPalette?.primary || '#f97316', color: '#ffffff' }}
                  >
                    {username} is viewing
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      case 'received_payment':
        return <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(transaction.received_payment)}</span>;
      case 'payment_method':
        return transaction.payment_method_info?.payment_method || getPaymentMethodName(transaction.payment_method) || String(transaction.payment_method || '-');
      case 'processed_by':
        return transaction.processor?.email_address || transaction.processed_by_user || '-';
      case 'full_name':
        return transaction.account?.customer?.full_name || '-';
      case 'or_no':
        return transaction.or_no || '-';
      case 'reference_no':
        return transaction.reference_no || '-';
      case 'remarks':
        return <span className="max-w-xs truncate block">{transaction.remarks || 'No remarks'}</span>;
      case 'status':
        return <StatusText status={transaction.status} />;
      case 'transaction_type':
        return transaction.transaction_type || '-';
      case 'barangay':
        return transaction.account?.customer?.barangay || '-';
      case 'id':
        return transaction.id;
      case 'contact_no':
        return transaction.account?.customer?.contact_number_primary || '-';
      case 'approved_by':
        return transaction.approved_by || '-';
      case 'updated_at':
        return formatDate(transaction.updated_at, true);
      case 'payment_date':
        return formatDate(transaction.payment_date);
      case 'account_balance':
        return formatCurrency(transaction.account?.account_balance || 0);
      default:
        return '-';
    }
  };

  const handleExport = () => {
    if (!filteredTransactions || filteredTransactions.length === 0) return;

    const exportColumns = transactionTableColumns
      .filter(col => visibleColumns.includes(col.key))
      .sort((a, b) => {
        const indexA = columnOrder.indexOf(a.key);
        const indexB = columnOrder.indexOf(b.key);
        return indexA - indexB;
      });

    const getExportValue = (transaction: Transaction, columnKey: string) => {
      switch (columnKey) {
        case 'account_no':
          return transaction.account?.account_no || '-';
        case 'received_payment':
          return formatCurrency(transaction.received_payment);
        case 'remarks':
          return transaction.remarks || 'No remarks';
        case 'status':
          return transaction.status || '-';
        default:
          return renderCellValue(transaction, columnKey);
      }
    };

    exportToCSV('transactions_export', exportColumns, filteredTransactions, getExportValue);
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden relative ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
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
              }`}>Transactions</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Date Range Filter Section */}
          <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                DATE RANGE
              </span>
              {(processedDateFrom || processedDateTo) && (
                <button
                  onClick={() => {
                    setProcessedDateFrom('');
                    setProcessedDateTo('');
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
                  value={processedDateFrom}
                  onChange={(e) => setProcessedDateFrom(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={processedDateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
              <div className="relative">
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                <input
                  type="date"
                  value={processedDateTo}
                  onChange={(e) => setProcessedDateTo(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={processedDateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
              {isMobile && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMobileViewMode('list');
                  }}
                  className="w-full mt-2 text-white py-1.5 rounded text-xs transition-colors font-medium"
                  style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                >
                  View Transactions
                </button>
              )}
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
              <span>All Transactions</span>
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
                  <Receipt className="h-4 w-4 mr-2" />
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
      </div>

      <div
        className={`${
          mobileViewMode === 'list' || !isMobile ? 'flex-1 flex flex-col' : 'hidden'
        } overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}
      >
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
                  placeholder="Search transactions..."
                />
              </div>
            </div>
            {hasPermission('transaction-list.batch-approve') && (
              <button
                onClick={() => isBatchApproveMode ? handleCancelApprove() : setIsBatchApproveMode(true)}
                className="p-2 md:px-4 md:py-2 rounded flex items-center justify-center transition-colors text-white flex-shrink-0"
                style={{
                  backgroundColor: isBatchApproveMode ? '#dc2626' : (colorPalette?.primary || '#7c3aed')
                }}
                onMouseEnter={(e) => {
                  if (isBatchApproveMode) {
                    e.currentTarget.style.backgroundColor = '#b91c1c';
                  } else if (colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (isBatchApproveMode) {
                    e.currentTarget.style.backgroundColor = '#dc2626';
                  } else if (colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = colorPalette.primary;
                  }
                }}
                title={isBatchApproveMode ? "Cancel Approve" : "Batch Approve"}
              >
                {isBatchApproveMode ? (
                  <>
                    <X className="h-5 w-5 md:h-4 md:w-4 md:mr-2" />
                    <span className="hidden md:inline">Cancel Approve</span>
                  </>
                ) : (
                  <>
                    <CheckCheck className="h-5 w-5 md:h-4 md:w-4 md:mr-2" />
                    <span className="hidden md:inline">Batch Approve</span>
                  </>
                )}
              </button>
            )}
            {hasPermission('transaction-list.batch-approve') && isBatchApproveMode && (
              <button
                onClick={handleBatchApprove}
                disabled={selectedTransactionIds.length === 0 || isApproving}
                className={`px-4 py-2 rounded flex items-center transition-colors flex-shrink-0 ${selectedTransactionIds.length === 0 || isApproving
                  ? isDarkMode
                    ? 'bg-gray-700 text-gray-500 border border-gray-600 cursor-not-allowed'
                    : 'bg-gray-300 text-gray-500 border border-gray-400 cursor-not-allowed'
                  : isDarkMode
                    ? 'bg-green-600 text-white border border-green-700 hover:bg-green-700'
                    : 'bg-green-500 text-white border border-green-600 hover:bg-green-600'
                  }`}
              >
                <Check className="h-4 w-4 mr-2" />
                <span>{isApproving ? 'Approving...' : `Approve (${selectedTransactionIds.length})`}</span>
              </button>
            )}
            <button
              onClick={() => setIsFunnelFilterOpen(true)}
              title={Object.keys(activeFilters).length > 0
                ? `Active Filters:\n${Object.entries(activeFilters).map(([key, filter]: [string, any]) => {
                  const colName = allColumns.find(c => c.key === key)?.label || key;
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
                : "Filter Transactions"
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
                className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-200 text-gray-900 border border-gray-300'}`}
                onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                title="Column Visibility"
              >
                <Columns3 className="h-5 w-5" />
              </button>
              {filterDropdownOpen && (
                <div className={`fixed mt-10 w-72 rounded shadow-lg z-50 max-h-[70vh] flex flex-col -translate-x-[calc(100%-3.5rem)] ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
                  <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Column Visibility</span>
                    <div className="flex space-x-2">
                      <button onClick={handleSelectAllColumns} className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>Select All</button>
                      <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>|</span>
                      <button onClick={handleDeselectAllColumns} className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>Deselect All</button>
                    </div>
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {transactionTableColumns.map((column) => (
                      <label
                        key={column.key}
                        className={`flex items-center px-4 py-2 cursor-pointer text-sm ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                      >
                        <input
                          type="checkbox"
                          checked={visibleColumns.includes(column.key)}
                          onChange={() => handleToggleColumn(column.key)}
                          className="mr-3 h-4 w-4 rounded"
                          style={{ accentColor: colorPalette?.primary || '#7c3aed' }}
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
              disabled={loading || filteredTransactions.length === 0}
              title="Export to CSV"
              className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border flex-shrink-0"
              style={{
                backgroundColor: '#ffffff',
                borderColor: colorPalette?.primary || '#7c3aed',
                color: colorPalette?.primary || '#7c3aed'
              }}
              onMouseEnter={(e) => {
                if (!loading && filteredTransactions.length > 0 && colorPalette?.primary) {
                  e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                }
              }}
              onMouseLeave={(e) => {
                if (!loading && filteredTransactions.length > 0) {
                  e.currentTarget.style.backgroundColor = '#ffffff';
                }
              }}
            >
              <Download className="h-5 w-5" />
            </button>
            <button
              onClick={handleRefresh}
              disabled={loading || !isFullyLoaded || isRefreshingManual}
              title={!isFullyLoaded ? `Loading records... (${transactions.length}/${totalCount})` : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
              className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
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
                const column = allColumns.find(c => c.key === key);
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
                  localStorage.removeItem('transactionFunnelFilters');
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
            {loading ? (
              <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <div className="animate-pulse flex flex-col items-center">
                  <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                  <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                </div>
                <p className="mt-4">Loading transactions...</p>
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
              <div className="h-full relative flex flex-col">
                <div className="flex-1 overflow-auto" ref={scrollRef}>
                  <table className="w-max min-w-full text-sm border-separate border-spacing-0">
                    <thead>
                      <tr className={`border-b sticky top-0 z-10 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-100'}`}>
                        {isBatchApproveMode && (
                          <th className={`px-4 py-3 text-left ${isDarkMode ? 'text-gray-400 bg-gray-800' : 'text-gray-600 bg-gray-100'}`}>
                            <input
                              type="checkbox"
                              checked={
                                selectedTransactionIds.length > 0 &&
                                selectedTransactionIds.length === filteredTransactions.filter(t => (t.status || '').toLowerCase() === 'pending').length &&
                                filteredTransactions.filter(t => (t.status || '').toLowerCase() === 'pending').length > 0
                              }
                              onChange={toggleSelectAll}
                              className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                              style={{ accentColor: colorPalette?.primary || '#7c3aed' }}
                            />
                          </th>
                        )}
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
                            className={`group relative text-left py-3 px-3 font-normal whitespace-nowrap cursor-pointer select-none transition-colors ${isDarkMode ? 'text-gray-400 bg-gray-800 hover:bg-gray-700' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'} ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') : ''} ${dragOverColumn === column.key ? (isDarkMode ? 'border-l-2 border-orange-500' : 'border-l-2 border-orange-600') : ''} ${draggedColumn === column.key ? 'opacity-50' : ''}`}
                            style={{
                              width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                              minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                            }}
                          >
                            <div className="flex items-center space-x-1">
                              <span>{column.label}</span>
                              {sortColumn === column.key && (
                                sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                              )}
                            </div>
                            <div
                              className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity z-10 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`}
                              onMouseDown={(e) => handleMouseDownResize(e, column.key)}
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedTransactions.length > 0 ? (
                        paginatedTransactions.map((transaction) => {
                          const isSelected = selectedTransactionIds.includes(transaction.id);
                          const isPending = (transaction.status || '').toLowerCase() === 'pending';
                          const canSelect = isBatchApproveMode && isPending;

                          return (
                            <tr
                              key={transaction.id}
                              className={`border-b transition-colors ${canSelect ? 'cursor-pointer' : isBatchApproveMode ? 'cursor-not-allowed' : 'cursor-pointer'} ${isDarkMode ? 'border-gray-800 hover:bg-gray-800' : 'border-gray-200 hover:bg-gray-50'} ${!isSelected && selectedTransaction?.id === transaction.id ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : !isSelected && isBatchApproveMode && !isPending ? (isDarkMode ? 'bg-gray-800 opacity-50' : 'bg-gray-200 opacity-50') : ''}`}
                              style={isSelected ? { backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)' } : {}}
                              onClick={() => handleRowClick(transaction)}
                            >
                              {isBatchApproveMode && (
                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleTransactionSelection(transaction.id)}
                                    disabled={!isPending}
                                    className={`w-4 h-4 rounded border-gray-300 ${isPending ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                                    style={{ accentColor: colorPalette?.primary || '#7c3aed' }}
                                  />
                                </td>
                              )}
                              {filteredColumns.map((column, index) => (
                                <td
                                  key={column.key}
                                  className={`py-3 px-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200') : ''}`}
                                  style={{
                                    width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                    minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                                  }}
                                >
                                  {renderCellValue(transaction, column.key)}
                                </td>
                              ))}
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={filteredColumns.length + (isBatchApproveMode ? 1 : 0)} className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {filteredTransactions.length > 0
                              ? 'No transactions found matching your filters'
                              : (totalCount > transactions.length)
                                ? 'Loading more records... please wait.'
                                : 'No transactions found.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
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

      {selectedTransaction && (
        <div className="flex-shrink-0 overflow-hidden">
          <TransactionListDetails
            transaction={selectedTransaction}
            onClose={() => setSelectedTransaction(null)}
            onNavigate={onNavigate}
            onViewCustomer={handleViewCustomer}
            onApprovalSuccess={handleApprovalSuccess}
            paymentMethods={paymentMethods}
            onPrevious={currentTransactionIndex > 0 ? handlePreviousTransaction : undefined}
            onNext={currentTransactionIndex !== -1 && currentTransactionIndex < filteredTransactions.length - 1 ? handleNextTransaction : undefined}
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
              onRefresh={async () => {
                const accountNo = selectedCustomer.billingAccount?.accountNo;
                if (accountNo) await refreshCustomerDetails(accountNo);
              }}
              refreshKey={customerRefreshKey}
              onPrevious={currentCustomerIndex > 0 ? handlePreviousCustomer : undefined}
              onNext={currentCustomerIndex !== -1 && currentCustomerIndex < filteredTransactions.length - 1 ? handleNextCustomer : undefined}
            />
          ) : null}
        </div>
      )}

      <LoadingModalGlobal
        isOpen={isApproving}
        type="loading"
        title="Approving"
        message="Approving transactions..."
        loadingPercentage={50}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
      />

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-300'
            }`}>
            <h3 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Confirm Batch Approval</h3>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Are you sure you want to approve {selectedTransactionIds.length} transaction(s)? This will update account balances and apply payments to invoices.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmBatchApproval}
                className="text-white px-6 py-2 rounded transition-colors"
                style={{
                  backgroundColor: colorPalette?.primary || '#22c55e'
                }}
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
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-300'
            }`}>
            <h3 className={`text-xl font-semibold mb-4 text-green-500`}>Success</h3>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>{approvalMessage}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowSuccessModal(false)}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showFailedModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`rounded-lg p-6 max-w-2xl w-full mx-4 border ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-300'
            }`}>
            <h3 className={`text-xl font-semibold mb-4 text-red-500`}>Batch Approval Results</h3>
            <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>{approvalMessage}</p>

            {approvalDetails && approvalDetails.failed && approvalDetails.failed.length > 0 && (
              <div className={`mb-6 p-4 rounded max-h-96 overflow-y-auto ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'
                }`}>
                <h4 className={`font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>Failed Transactions:</h4>
                <ul className="space-y-2">
                  {approvalDetails.failed.map((fail: any, index: number) => (
                    <li key={index} className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                      <span className="font-medium">ID: {fail.transaction_id}</span> - {fail.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowFailedModal(false)}
                className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <TransactionFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          setActiveFilters(filters);
          localStorage.setItem('transactionFunnelFilters', JSON.stringify(filters));
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={activeFilters}
      />

      <SessionExpiredModal 
        isOpen={showSessionExpired} 
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        onConfirm={() => {
          setShowSessionExpired(false);
          // Only clear auth data and reload to redirect to log in
          localStorage.removeItem('authData');
          window.location.reload();
        }} 
      />
    </div >
  );
};

export default TransactionList;
