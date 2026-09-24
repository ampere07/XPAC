import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronLeft, Circle, X, Columns3, ArrowUp, ArrowDown, RefreshCw, Filter, ChevronRight, ChevronDown, ChevronsLeft, ChevronsRight, Download, Menu } from 'lucide-react';
import pusher from '../services/pusherService';
import BillingDetails from '../components/CustomerDetails';
import GlobalRelatedDataOverlay from '../components/GlobalRelatedDataOverlay';
import { BillingRecord } from '../services/billingService';
import { getCustomerDetail, CustomerDetailData, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import { getCities, City } from '../services/cityService';
import { getRegions, Region } from '../services/regionService';
import { barangayService, Barangay } from '../services/barangayService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import CustomerFunnelFilter, { allColumns as filterColumns, Column as FilterColumn } from '../filter/CustomerFunnelFilter';
import SessionExpiredModal from '../components/SessionExpiredModal';
import { useBillingStore } from '../store/billingStore';
import { billingStatusService, BillingStatus } from '../services/billingStatusService';
import { userService } from '../services/userService';
import GlobalSearch from './globalfunctions/GlobalSearch';
import apiClient from '../config/api';
import { exportToCSV } from '../utils/exportUtils';
import {
  deriveVipLabel,
  deriveVatTypeLabel,
  normalizeGenerationType,
  isPrepaidGeneration,
  VIP_BILLING_STATUS_ID
} from '../utils/billingFilterOptions';
import { mergeSavedColumns, BILLING_ATTRIBUTE_COLUMN_KEYS } from '../utils/tableColumnPrefs';
import { getOnlineStatusInfo } from '../utils/onlineStatus';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
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

/**
 * Prepaid expiry as a countdown, e.g. "30 days left".
 *
 * Counts whole CALENDAR days, deliberately ignoring the stored time-of-day:
 * prepaid_expires_at inherits the clock time of the payment that set it, so a
 * millisecond diff would report "29 days left" or "30 days left" for the same
 * account depending on the hour it was viewed. Comparing dates keeps the label
 * stable for the whole day.
 *
 * The +1 makes the expiry date itself count as a remaining day, matching
 * AutoDisconnectService::processPrepaidRestrictions() — an account expiring 07/30
 * keeps service all through 07/30 and is only restricted on 07/31. So on 07/30
 * this reads "1 day left", not "Expired".
 *
 * @returns null when there is no expiry (postpaid, or a prepaid account that has
 *          never paid), so the caller can omit the segment entirely.
 */
const formatPrepaidDaysLeft = (raw: string | null | undefined): string | null => {
  if (!raw) return null;

  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw).trim());
  if (!parts) return null;

  // Local midnight on both sides so the subtraction is a pure date difference.
  const expiry = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (isNaN(expiry.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Rounded because a DST boundary makes a "day" 23 or 25 hours long.
  const daysLeft = Math.round((expiry.getTime() - today.getTime()) / 86400000) + 1;

  if (daysLeft <= 0) return 'Expired';

  return `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
};

interface LocationItem {
  id: string;
  name: string;
  count: number;
}

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
            className={`px-2 py-1 rounded border text-sm focus:outline-none ${isDarkMode
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
              }`}
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

type DisplayMode = 'card' | 'table';

// All available columns for the table - extended list to match BillingListView
const allColumns = [
  { key: 'status', label: 'Status', width: 'min-w-28' },
  { key: 'billingStatus', label: 'Billing Status', width: 'min-w-28' },
  { key: 'accountNo', label: 'Account No.', width: 'min-w-32' },
  { key: 'dateInstalled', label: 'Date Installed', width: 'min-w-28' },
  { key: 'customerName', label: 'Full Name', width: 'min-w-40' },
  { key: 'address', label: 'Address', width: 'min-w-56' },
  { key: 'contactNumber', label: 'Contact Number', width: 'min-w-36' },
  { key: 'emailAddress', label: 'Email Address', width: 'min-w-48' },
  { key: 'plan', label: 'Plan', width: 'min-w-40' },
  { key: 'balance', label: 'Account Balance', width: 'min-w-32' },
  { key: 'vatType', label: 'VAT Type', width: 'min-w-32' },
  { key: 'generationType', label: 'Generation Type', width: 'min-w-36' },
  { key: 'expirationDate', label: 'Expiration Date', width: 'min-w-36' },
  { key: 'vip', label: 'VIP', width: 'min-w-24' },
  { key: 'username', label: 'Username', width: 'min-w-32' },
  { key: 'connectionType', label: 'Connection Type', width: 'min-w-36' },
  { key: 'routerModel', label: 'Router Model', width: 'min-w-32' },
  { key: 'routerModemSN', label: 'Router/Modem SN', width: 'min-w-36' },
  { key: 'lcpnap', label: 'LCPNAP', width: 'min-w-32' },
  { key: 'port', label: 'PORT', width: 'min-w-28' },
  { key: 'vlan', label: 'VLAN', width: 'min-w-24' },
  { key: 'billingDay', label: 'Billing Day', width: 'min-w-28' },
  { key: 'totalPaid', label: 'Total Paid', width: 'min-w-28' },
  { key: 'provider', label: 'Provider', width: 'min-w-24' },
  { key: 'lcp', label: 'LCP', width: 'min-w-28' },
  { key: 'nap', label: 'NAP', width: 'min-w-28' },
  { key: 'modifiedBy', label: 'Modified By', width: 'min-w-32' },
  { key: 'modifiedDate', label: 'Modified Date', width: 'min-w-36' },
  { key: 'barangay', label: 'Barangay', width: 'min-w-32' },
  { key: 'city', label: 'City', width: 'min-w-28' },
  { key: 'region', label: 'Region', width: 'min-w-28' },
  { key: 'lcpnapport', label: 'LCPNAPPORT', width: 'min-w-36' },
  { key: 'usageType', label: 'Usage Type', width: 'min-w-32' },
  { key: 'referredBy', label: 'Referred By', width: 'min-w-36' },
  { key: 'secondContactNumber', label: 'Second Contact Number', width: 'min-w-40' },
  { key: 'mikrotikId', label: 'Mikrotik ID', width: 'min-w-32' },
  { key: 'sessionIP', label: 'IP', width: 'min-w-32' },
  { key: 'sessionGroup', label: 'Group', width: 'min-w-32' },
  { key: 'housingStatus', label: 'Housing Status', width: 'min-w-32' },
  { key: 'addressCoordinates', label: 'Address Coordinates', width: 'min-w-36' },
  { key: 'location', label: 'Location', width: 'min-w-32' },
  { key: 'customerCreatedAt', label: 'Customer Created At', width: 'min-w-36' },
  { key: 'billingAccountCreatedAt', label: 'Billing Account Created At', width: 'min-w-36' },
  { key: 'techCreatedAt', label: 'Technical Details Created At', width: 'min-w-36' }
];

interface CustomerProps {
  initialSearchQuery?: string;
  autoOpenAccountNo?: string;
}

const Customer: React.FC<CustomerProps> = ({ initialSearchQuery, autoOpenAccountNo }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery || '');
  const { billingRecords, totalCount, isLoading: isTableLoading, error: contextError, fetchBillingRecords, refreshLatestData } = useBillingStore();
  const isFullyLoaded = totalCount === 0 || billingRecords.length >= totalCount;
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const selectedCustomerRef = useRef<CustomerDetailData | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [customerRefreshKey, setCustomerRefreshKey] = useState<number>(0);
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isSilentRefreshing, setIsSilentRefreshing] = useState<boolean>(false);
  const [viewers, setViewers] = useState<Record<string, string[]>>({});

  const [overlayData, setOverlayData] = useState<{
    isOpen: boolean;
    title: string;
    data: any[];
    columns: any[];
    count: number;
  }>({
    isOpen: false,
    title: '',
    data: [],
    columns: [],
    count: 0
  });

  const handleExpandSection = (sectionKey: string, title: string, data: any[], columns: any[], count: number) => {
    setOverlayData({
      isOpen: true,
      title,
      data,
      columns,
      count
    });
  };

  const [selectedBillingStatus, setSelectedBillingStatus] = useState<string>('');
  const [selectedAccountBalance, setSelectedAccountBalance] = useState<number | null>(null);
  const [selectedTotalPaid, setSelectedTotalPaid] = useState<number | null>(null);

  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [billingStatuses, setBillingStatuses] = useState<BillingStatus[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  const isLoading = isTableLoading || isActionLoading;
  const error = localError || contextError;
  const setError = setLocalError; // Alias for compatibility with existing code





  const [displayMode, setDisplayMode] = useState<DisplayMode>('card');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
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

  // Auto-navigate to list view when location/status changes on mobile
  useEffect(() => {
    if (isMobile && selectedLocation) {
      setMobileViewMode('list');
    }
  }, [selectedLocation, isMobile]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('customerTableVisibleColumns');
    if (saved) {
      try {
        // Merged rather than used as-is: a preference saved before a column existed omits it,
        // which would hide newly added columns from every returning user. Only the new keys are
        // merged in, so columns the user hid on purpose stay hidden.
        return mergeSavedColumns(
          JSON.parse(saved),
          BILLING_ATTRIBUTE_COLUMN_KEYS,
          allColumns.map(col => col.key),
          'customerTableVisibleColumns:billingAttrs'
        );
      } catch (err) {
        console.error('Failed to load column visibility:', err);
      }
    }
    return allColumns.map(col => col.key);
  });
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('customerTableColumnOrder');
    if (saved) {
      try {
        // Without merging, a new column is missing from the saved order and indexOf returns -1,
        // which would sort it ahead of every other column.
        return mergeSavedColumns(
          JSON.parse(saved),
          BILLING_ATTRIBUTE_COLUMN_KEYS,
          allColumns.map(col => col.key),
          'customerTableColumnOrder:billingAttrs'
        );
      } catch (err) {
        console.error('Failed to load column order:', err);
      }
    }
    return allColumns.map(col => col.key);
  });
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userEmailCache, setUserEmailCache] = useState<Record<string, string>>({});
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<any>(() => {
    const saved = localStorage.getItem('customerFunnelFilters');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.location) {
          delete parsed.location;
          localStorage.setItem('customerFunnelFilters', JSON.stringify(parsed));
        }
        return parsed;
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    }
    return {};
  });

  const removeFilter = (key: string) => {
    setActiveFilters((prev: any) => {
      const next = { ...prev };
      delete next[key];
      localStorage.setItem('customerFunnelFilters', JSON.stringify(next));
      return next;
    });
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch location data
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
    selectedCustomerRef.current = selectedCustomer;
  }, [selectedCustomer]);

  // Handle click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setFilterDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownRef, filterDropdownRef]);

  useEffect(() => {
    const fetchLocationData = async () => {
      try {
        const [citiesData, regionsData, barangaysRes, statusesRes, activePalette] = await Promise.all([
          getCities(),
          getRegions(),
          barangayService.getAll(),
          billingStatusService.getAll(),
          settingsColorPaletteService.getActive()
        ]) as [any, any, any, any, any];
        setCities(citiesData || []);
        setRegions(regionsData || []);
        setBarangays(barangaysRes.success ? barangaysRes.data : []);
        setBillingStatuses(statusesRes || []);
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch location data:', err);
        setCities([]);
        setRegions([]);
        setBarangays([]);
      }
    };

    fetchLocationData();
  }, []);

  // Pusher/Soketi connection for real-time customer data
  useEffect(() => {
    const handleDataChange = async (data: any) => {
      setHasNewData(true);
      try {
        await refreshLatestData();
        
        if (selectedCustomerRef.current?.billingAccount?.accountNo) {
          const updatedCustomer = await getCustomerDetail(selectedCustomerRef.current.billingAccount.accountNo);
          setSelectedCustomer(updatedCustomer);
          if (updatedCustomer) {
            const detail = convertCustomerDataToBillingDetail(updatedCustomer);
            setSelectedAccountBalance(detail.accountBalance ?? null);
            setSelectedTotalPaid(detail.totalPaid ?? null);
            setSelectedBillingStatus(detail.billingStatus || '');
          }
          setCustomerRefreshKey(prev => prev + 1);
        }
      } catch (err) {
        console.error('[Customer Soketi] Failed to fetch latest data:', err);
      }
    };

    const appChannel = pusher.subscribe('applications');
    const jobChannel = pusher.subscribe('job-orders');
    const customerChannel = pusher.subscribe('customers');

    // Subscription success/error handlers
    const channels = [
      { channel: appChannel, name: 'applications' },
      { channel: jobChannel, name: 'job-orders' },
      { channel: customerChannel, name: 'customers' }
    ];
    channels.forEach(({ channel, name }) => {
      channel.bind('pusher:subscription_succeeded', () => {
      });
      channel.bind('pusher:subscription_error', (error: any) => {
        console.error(`[Customer Soketi] Subscription error on ${name}:`, error);
      });
    });

    appChannel.bind('new-application', handleDataChange);
    jobChannel.bind('job-order-done', handleDataChange);
    customerChannel.bind('customer-updated', handleDataChange);

    // Re-subscribe on reconnection
    const stateHandler = (states: { previous: string; current: string }) => {
      if (states.current === 'connected') {
        if (appChannel.subscribed !== true) pusher.subscribe('applications');
        if (jobChannel.subscribed !== true) pusher.subscribe('job-orders');
        if (customerChannel.subscribed !== true) pusher.subscribe('customers');
      }
    };
    pusher.connection.bind('state_change', stateHandler);

    return () => {
      channels.forEach(({ channel }) => {
        channel.unbind('pusher:subscription_succeeded');
        channel.unbind('pusher:subscription_error');
      });
      appChannel.unbind('new-application', handleDataChange);
      jobChannel.unbind('job-order-done', handleDataChange);
      customerChannel.unbind('customer-updated', handleDataChange);
      pusher.connection.unbind('state_change', stateHandler);
      pusher.unsubscribe('applications');
      pusher.unsubscribe('job-orders');
      pusher.unsubscribe('customers');
    };
  }, [refreshLatestData]);

  // Presence channel for knowing who's viewing what
  useEffect(() => {
    const presenceChannel = pusher.subscribe('presence-customers-presence');

    presenceChannel.bind('viewing-update', (data: { customer_id: string; username: string; action: string }) => {
      setViewers(prev => {
        const username = data.username;
        const currentViewers = prev[data.customer_id] || [];
        if (data.action === 'started_viewing') {
          if (!currentViewers.includes(username)) {
            return { ...prev, [data.customer_id]: [...currentViewers, username] };
          }
        } else if (data.action === 'stopped_viewing') {
          return { ...prev, [data.customer_id]: currentViewers.filter(name => name !== username) };
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
      // If we are currently viewing a customer, broadcast it so the new member knows
      if (selectedCustomerRef.current?.billingAccount?.accountNo) {
        broadCastViewing(selectedCustomerRef.current.billingAccount.accountNo, 'started_viewing');
      }
    });

    return () => {
      presenceChannel.unbind_all();
      pusher.unsubscribe('presence-customers-presence');
    };
  }, []);

  // Polling for updates every 3 seconds - Incremental fetch
  useEffect(() => {
    const POLLING_INTERVAL = 3000; // 3 seconds
    const intervalId = setInterval(async () => {
      try {
        await refreshLatestData();
      } catch (err) {
        console.error('[Customer Page] Polling failed:', err);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [refreshLatestData]);

  // Trigger silent refresh on mount to ensure data is fresh but no spinner if cached
  useEffect(() => {
    fetchBillingRecords();
  }, [fetchBillingRecords]);

  // Sync initialSearchQuery
  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // Auto-open account if prop provided
  useEffect(() => {
    const autoOpen = async () => {
      if (autoOpenAccountNo) {
        setIsLoadingDetails(true);
        try {
          const detail = await getCustomerDetail(autoOpenAccountNo);
          if (detail) {
            setSelectedCustomer(detail);
          }
        } catch (err) {
          console.error('Error auto-opening customer details:', err);
        } finally {
          setIsLoadingDetails(false);
        }
      }
    };
    autoOpen();
  }, [autoOpenAccountNo]);

  const broadCastViewing = async (id: string, action: string) => {
    try {
      await apiClient.post('/customers/broadcast-viewing', {
        customer_id: id,
        action: action
      });
    } catch (err) {
      console.error('[Presence] Failed to broadcast viewing:', err);
    }
  };

  useEffect(() => {
    return () => {
      if (selectedCustomer && selectedCustomer.billingAccount?.accountNo) {
        broadCastViewing(selectedCustomer.billingAccount.accountNo, 'stopped_viewing');
      }
    };
  }, [selectedCustomer]);

  // Keep selected customer details in sync with the billing records from the store (updated via polling)
  useEffect(() => {
    if (!selectedCustomerRef.current?.billingAccount?.accountNo) return;
    const accountNo = selectedCustomerRef.current.billingAccount.accountNo;
    const updatedRecord = billingRecords.find(r => r.applicationId === accountNo || r.id === accountNo);
    
    if (updatedRecord) {
      const currentCustomer = selectedCustomerRef.current;
      const currentBalance = currentCustomer.billingAccount?.accountBalance ?? 0;
      const currentTotalPaid = (currentCustomer as any).totalPaid ?? (currentCustomer as any).total_paid ?? 0;
      const currentStatus = currentCustomer.billingAccount?.billingStatusName || 'Active';
      const currentOnlineStatus = currentCustomer.onlineSessionStatus || 'Empty';

      const hasChanged = 
        currentStatus !== (updatedRecord.billingStatus || '') ||
        currentBalance !== updatedRecord.balance ||
        currentTotalPaid !== (updatedRecord.totalPaid ?? 0) ||
        currentOnlineStatus !== (updatedRecord.onlineStatus || 'Empty');

      if (hasChanged) {
        setSelectedBillingStatus(updatedRecord.billingStatus || '');
        setSelectedAccountBalance(updatedRecord.balance);
        setSelectedTotalPaid(updatedRecord.totalPaid ?? null);
        
        setSelectedCustomer(prev => {
          if (!prev) return null;
          return {
            ...prev,
            onlineSessionStatus: updatedRecord.onlineStatus || prev.onlineSessionStatus,
            billingAccount: prev.billingAccount ? {
              ...prev.billingAccount,
              accountBalance: updatedRecord.balance,
              billingStatusName: updatedRecord.billingStatus,
              billingStatusId: updatedRecord.billing_status_id ?? prev.billingAccount.billingStatusId,
              updatedAt: updatedRecord.modifiedDate || prev.billingAccount.updatedAt,
              updatedBy: updatedRecord.modifiedBy || prev.billingAccount.updatedBy,
            } : undefined,
            technicalDetails: prev.technicalDetails ? {
              ...prev.technicalDetails,
              username: updatedRecord.username || prev.technicalDetails.username,
              connectionType: updatedRecord.connectionType || prev.technicalDetails.connectionType,
              routerModel: updatedRecord.routerModel || prev.technicalDetails.routerModel,
              routerModemSn: updatedRecord.routerModemSN || prev.technicalDetails.routerModemSn,
              lcpnap: updatedRecord.lcpnap || prev.technicalDetails.lcpnap,
              port: updatedRecord.port || prev.technicalDetails.port,
              vlan: updatedRecord.vlan || prev.technicalDetails.vlan,
              lcp: updatedRecord.lcp || prev.technicalDetails.lcp,
              nap: updatedRecord.nap || prev.technicalDetails.nap,
            } : undefined
          };
        });

        // Trigger refetch of related data in CustomerDetails.tsx
        setCustomerRefreshKey(prev => prev + 1);
      }
    }
  }, [billingRecords]);



  // Reset selected location if regions change and selected location is no longer valid
  useEffect(() => {
    if (selectedLocation === 'all') return;

    const [type, name] = selectedLocation.split(':');
    let isValid = false;

    if (type === 'status') {
      isValid = true; // Status categories are always valid
    } else if (type === 'reg') {
      isValid = regions.some(r => r.name === name);
    } else if (type === 'city') {
      isValid = cities.some(c => c.name === name);
    } else if (type === 'brgy') {
      isValid = barangays.some(b => b.barangay === name);
    }

    if (!isValid) {
      setSelectedLocation('all');
    }
  }, [regions, cities, barangays, selectedLocation]);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      try {
        await refreshLatestData();
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
  }, [refreshLatestData]);

  // Memoize city name lookup for performance
  const getCityName = useMemo(() => {
    const cityMap = new Map(cities.map(c => [c.id, c.name]));
    return (cityId: number | null | undefined): string => {
      if (!cityId) return 'Unknown City';
      return cityMap.get(cityId) || `City ${cityId}`;
    };
  }, [cities]);

  // Shared with CustomerDetails so the row and the panel it opens always agree.
  const getStatusInfo = getOnlineStatusInfo;

  const getVal = (item: BillingRecord, key: string): any => {
    switch (key) {
      case 'id':
      case 'accountNo': return item.id || item.applicationId;
      case 'customerName': return item.customerName;
      case 'firstName': return item.firstName;
      case 'middleInitial': return item.middleInitial;
      case 'lastName': return item.lastName;
      case 'address': return item.address;
      case 'contactNumber': return item.contactNumber;
      case 'secondContactNumber': return item.secondContactNumber;
      case 'emailAddress': return item.emailAddress;
      case 'plan': return item.plan;
      case 'balance':
      case 'accountBalance': return item.balance;
      case 'status': return item.status;
      case 'onlineStatus': {
        const info = getStatusInfo(item);
        return info.label.toLowerCase();
      }
      case 'billingStatus': return item.billingStatus || 'Active';
      case 'dateInstalled': return item.dateInstalled;
      case 'username': return item.username;
      case 'connectionType': return item.connectionType;
      case 'routerModel': return item.routerModel;
      case 'sessionGroup': return item.sessionGroup;
      case 'routerModemSN': return item.routerModemSN;
      case 'lcpnap': return item.lcpnap;
      case 'port': return item.port;
      case 'vlan': return item.vlan;
      case 'billingDay': return item.billingDay;
      case 'totalPaid': return item.totalPaid;
      case 'provider': return item.provider;
      case 'lcp': return item.lcp;
      case 'nap': return item.nap;
      case 'modifiedBy': return item.modifiedBy;
      case 'modifiedDate': return item.modifiedDate;
      case 'barangay': return item.barangay;
      case 'city': return item.city;
      case 'region': return item.region;
      case 'usageType': return item.usageType;
      case 'referredBy': return item.referredBy;
      case 'sessionIP': return item.sessionIP;
      case 'houseFrontPicture': return item.houseFrontPicture;
      case 'housingStatus': return (item as any).housingStatus;
      case 'addressCoordinates': return (item as any).addressCoordinates;
      case 'balanceUpdateDate': return (item as any).balanceUpdateDate;
      case 'billingAccountCreatedBy': return (item as any).billingAccountCreatedBy;
      case 'billingAccountCreatedAt': return (item as any).billingAccountCreatedAt;
      case 'billingAccountUpdatedBy': return (item as any).billingAccountUpdatedBy;
      case 'billingAccountUpdatedAt': return (item as any).billingAccountUpdatedAt;
      case 'customerCreatedAt': return (item as any).customerCreatedAt;
      case 'customerCreatedBy': return (item as any).customerCreatedBy;
      case 'techCreatedAt': return (item as any).techCreatedAt;
      case 'techCreatedBy': return (item as any).techCreatedBy;
      case 'techUpdatedAt': return (item as any).techUpdatedAt;
      case 'techUpdatedBy': return (item as any).techUpdatedBy;
      case 'desiredPlan': return item.desiredPlan || item.plan;
      case 'groupName': return item.groupName || item.provider;
      case 'usernameStatus': return item.usernameStatus;
      case 'sessionGroup': return item.sessionGroup;
      // A customer is VIP when their billing status is VIP — there is no vip flag on
      // billing_accounts, and status id 7 is what CheckVipExpiration acts on.
      case 'vip': return deriveVipLabel(
        item.billing_status_id === VIP_BILLING_STATUS_ID ||
        String(item.billingStatus || '').trim().toLowerCase() === 'vip'
      );
      // Matches the label CustomerDetails shows, so the filter never disagrees with the panel.
      case 'vatType': return deriveVatTypeLabel(item.vatEnabled, item.vatType);
      case 'generationType': return normalizeGenerationType(item.generationType);
      case 'prepaidExpiration': return item.prepaidExpiration;
      // Table column key. Sorts on the raw timestamp (not the formatted label) so the order is
      // chronological, and only prepaid accounts contribute a value — matching what is rendered.
      case 'expirationDate':
        return isPrepaidGeneration(item.generationType) ? (item.prepaidExpiration || '') : '';
      default: return (item as any)[key];
    }
  };

  // Helper function to apply funnel filters
  const applyFunnelFilters = (records: BillingRecord[], filters: any): BillingRecord[] => {
    if (!filters || Object.keys(filters).length === 0) return records;

    return records.filter(record => {
      return Object.entries(filters).every(([key, filter]: [string, any]) => {
        const recordValue = getVal(record, key);

        // Prepaid Expiration needs its own handling, before the generic date branch:
        //  1. It is only meaningful for Prepaid accounts — a postpaid customer has no expiry to
        //     compare against, so it cannot satisfy a date range.
        //  2. prepaid_expires_at is a datetime while the filter inputs are plain dates. The
        //     generic branch feeds both to new Date(), which reads 'YYYY-MM-DD' as UTC midnight
        //     but 'YYYY-MM-DD HH:mm:ss' as local — so an expiry at local midnight would fall
        //     before a "from" of its own date and be dropped. Both sides are pinned to local
        //     day boundaries here instead.
        if (key === 'prepaidExpiration') {
          if (!isPrepaidGeneration(record.generationType)) return false;
          if (!recordValue) return false;

          const toLocalTime = (raw: any, endOfDay = false): number => {
            let s = String(raw).trim().replace(' ', 'T');
            if (s.length === 10) s = endOfDay ? `${s}T23:59:59.999` : `${s}T00:00:00`;
            return new Date(s).getTime();
          };

          const expiryTime = toLocalTime(recordValue);
          if (isNaN(expiryTime)) return false;
          if (filter.from && expiryTime < toLocalTime(filter.from)) return false;
          if (filter.to && expiryTime > toLocalTime(filter.to, true)) return false;
          return true;
        }

        if (filter.type === 'checklist') {
          if (!filter.value || !Array.isArray(filter.value) || filter.value.length === 0) return true;

          const valStr = String(recordValue || '').toLowerCase();
          return filter.value.some((v: string) => {
            const filterVal = String(v).toLowerCase();
            // Use exact match for all checklist options to avoid "Ultra" matching "Ultra-Plus 2099"
            return valStr === filterVal;
          });
        }

        if (filter.type === 'text') {
          if (!filter.value) return true;
          const value = String(recordValue || '').toLowerCase();
          if (key === 'billing_status_id') {
            return value === filter.value.toLowerCase();
          }
          return value.includes(filter.value.toLowerCase());
        }

        if (filter.type === 'number') {
          const numValue = Number(recordValue);
          if (isNaN(numValue)) return false;
          if (filter.from !== undefined && filter.from !== '' && numValue < Number(filter.from)) return false;
          if (filter.to !== undefined && filter.to !== '' && numValue > Number(filter.to)) return false;
          return true;
        }

        if (filter.type === 'date') {
          if (!recordValue) return false;
          const dateValue = new Date(recordValue).getTime();
          if (isNaN(dateValue)) return false;
          if (filter.from && dateValue < new Date(filter.from).getTime()) return false;
          if (filter.to && dateValue > new Date(filter.to).getTime()) return false;
          return true;
        }

        return true;
      });
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
    let filtered = billingRecords.filter(record => {
      // Organization filter — mirrors applicationmanagement.tsx logic exactly
      if (userOrgId) {
        if (record.organization_id !== userOrgId) return false;
      } else {
        if (record.organization_id) return false;
      }

      return searchQuery === '' || Object.values(record).some(value => {
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      });
    });

    return applyFunnelFilters(filtered, activeFilters);
  }, [billingRecords, searchQuery, activeFilters, userOrgId]);

  // Memoize status tree (Status > Billing Status > Barangay) - Now using globalFilteredRecords
  const statusTree = useMemo(() => {
    const tree: Record<string, { 
      count: number, 
      bStatuses: Record<string, { count: number, barangays: Record<string, number> }>,
      sessionStatuses?: Record<string, { count: number, bStatuses: Record<string, { count: number, barangays: Record<string, number> }> }>
    }> = {};

    globalFilteredRecords.forEach((record: BillingRecord) => {
      const accessStatus = record.status || '';
      let bucket = 'offline';

      const lowerStatus = accessStatus.toLowerCase();
      const lowerOnlineStatus = (record.onlineStatus || '').toLowerCase();

      if (lowerStatus === 'restricted' || lowerOnlineStatus === 'restricted') bucket = 'restricted';
      else if (lowerStatus === 'not found' || lowerOnlineStatus === 'not found') bucket = 'not found';
      else if (lowerStatus === 'disconnected' || lowerOnlineStatus === 'disconnected') bucket = 'disconnected';
      else if (lowerStatus === 'inactive') bucket = 'offline';
      else if (['online', 'active', 'connected'].includes(lowerOnlineStatus)) bucket = 'online';
      else if (lowerOnlineStatus && lowerOnlineStatus !== 'offline' && lowerOnlineStatus !== 'empty') bucket = lowerOnlineStatus;

      if (!tree[bucket]) {
        tree[bucket] = { count: 0, bStatuses: {}, sessionStatuses: (bucket === 'restricted' || bucket === 'disconnected') ? {} : undefined };
      }

      tree[bucket].count++;
      const bStatus = record.billingStatus || 'Regular';
      const brgy = record.barangay || 'No Barangay';

      if (bucket === 'restricted' || bucket === 'disconnected') {
        const isActive = (record.active_sessions || 0) >= 1;
        const sessionKey = isActive ? 'online' : 'offline';

        if (!tree[bucket].sessionStatuses![sessionKey]) {
          tree[bucket].sessionStatuses![sessionKey] = { count: 0, bStatuses: {} };
        }
        tree[bucket].sessionStatuses![sessionKey].count++;

        if (!tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus]) {
          tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus] = { count: 0, barangays: {} };
        }
        tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus].count++;
        tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus].barangays[brgy] = (tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus].barangays[brgy] || 0) + 1;
      } else {
        if (!tree[bucket].bStatuses[bStatus]) {
          tree[bucket].bStatuses[bStatus] = { count: 0, barangays: {} };
        }
        tree[bucket].bStatuses[bStatus].count++;
        tree[bucket].bStatuses[bStatus].barangays[brgy] = (tree[bucket].bStatuses[bStatus].barangays[brgy] || 0) + 1;
      }
    });

    return {
      items: Object.keys(tree).map(name => ({
        id: `status:${name}`,
        name: name,
        count: tree[name].count,
        sessionStatuses: tree[name].sessionStatuses ? Object.entries(tree[name].sessionStatuses!).map(([sKey, sData]) => ({
          id: `status:${name}:session:${sKey}`,
          name: sKey === 'online' ? 'Session Online' : 'Session Offline',
          count: sData.count,
          bStatuses: Object.entries(sData.bStatuses).sort().map(([bName, bData]) => ({
            id: `status:${name}:session:${sKey}:billing:${bName}`,
            name: bName,
            count: bData.count,
            barangays: Object.entries(bData.barangays).sort().map(([brgyName, brgyCount]) => ({
              id: `status:${name}:session:${sKey}:billing:${bName}:brgy:${brgyName}`,
              name: brgyName,
              count: brgyCount
            }))
          }))
        })) : undefined,
        bStatuses: !tree[name].sessionStatuses ? Object.entries(tree[name].bStatuses).sort().map(([bName, bData]) => ({
          id: `status:${name}:billing:${bName}`,
          name: bName,
          count: bData.count,
          barangays: Object.entries(bData.barangays).sort().map(([brgyName, brgyCount]) => ({
            id: `status:${name}:billing:${bName}:brgy:${brgyName}`,
            name: brgyName,
            count: brgyCount
          }))
        })) : []
      })).sort((a, b) => {
        const order = ['online', 'offline', 'disconnected', 'restricted', 'not found', 'empty'];
        const indexA = order.indexOf(a.name.toLowerCase());
        const indexB = order.indexOf(b.name.toLowerCase());
        
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.name.localeCompare(b.name);
      }),
      total: globalFilteredRecords.length
    };
  }, [globalFilteredRecords]);

  // Memoize filtered and sorted records for performance - Building on globalFilteredRecords
  const filteredBillingRecords = useMemo(() => {
    let filtered = globalFilteredRecords.filter((record: BillingRecord) => {
      // Location hierarchy filter
      let matchesLocation = selectedLocation === 'all';
      if (!matchesLocation) {
        if (selectedLocation.startsWith('status:')) {
          const parts = selectedLocation.split(':');
          const statusName = parts[1];
          const accessStatus = record.status || '';
          let recordBucket = 'offline';
          const lowerStatus = accessStatus.toLowerCase();
          const lowerOnlineStatus = (record.onlineStatus || '').toLowerCase();

          if (lowerStatus === 'restricted' || lowerOnlineStatus === 'restricted') recordBucket = 'restricted';
          else if (lowerStatus === 'not found' || lowerOnlineStatus === 'not found') recordBucket = 'not found';
          else if (lowerStatus === 'disconnected' || lowerOnlineStatus === 'disconnected') recordBucket = 'disconnected';
          else if (lowerStatus === 'inactive') recordBucket = 'offline';
          else if (['online', 'active', 'connected'].includes(lowerOnlineStatus)) recordBucket = 'online';
          else if (lowerOnlineStatus && lowerOnlineStatus !== 'offline' && lowerOnlineStatus !== 'empty') recordBucket = lowerOnlineStatus;

          if (recordBucket !== statusName) return false;
          
          let currentLevel = 2;

          // Check for session level (e.g., Restricted or Disconnected)
          if (parts.length > currentLevel && parts[currentLevel] === 'session') {
            const sessionType = parts[currentLevel + 1];
            const isActive = (record.active_sessions || 0) >= 1;
            const recordSession = isActive ? 'online' : 'offline';
            if (recordSession !== sessionType) return false;
            currentLevel += 2;
          }

          // Check sub-billing status
          if (parts.length > currentLevel && parts[currentLevel] === 'billing') {
            const bStatus = parts[currentLevel + 1];
            if (record.billingStatus !== bStatus) return false;
            currentLevel += 2;

            // Check sub-barangay
            if (parts.length > currentLevel && parts[currentLevel] === 'brgy') {
              const brgyName = parts[currentLevel + 1];
              if (record.barangay !== brgyName) return false;
            }
          }
          matchesLocation = true;
        } else if (selectedLocation.startsWith('reg:')) {
          matchesLocation = record.region === selectedLocation.substring(4);
        } else if (selectedLocation.startsWith('city:')) {
          matchesLocation = record.city === selectedLocation.substring(5);
        } else if (selectedLocation.startsWith('brgy:')) {
          matchesLocation = record.barangay === selectedLocation.substring(5);
        }
      }

      return matchesLocation;
    });

    // Sorting logic
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue = getVal(a, sortColumn);
        let bValue = getVal(b, sortColumn);

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [globalFilteredRecords, selectedLocation, sortColumn, sortDirection]);

  const totalDisplayCount = useMemo(() => {
    if (selectedLocation === 'all' && searchQuery === '' && Object.keys(activeFilters).length === 0) {
      return totalCount;
    }
    return filteredBillingRecords.length;
  }, [filteredBillingRecords.length, totalCount, selectedLocation, searchQuery, activeFilters]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Reset page when filters or items per page change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLocation, searchQuery, activeFilters, sortColumn, sortDirection, itemsPerPage]);

  // Scroll to top on page change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

  // Derived paginated records
  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredBillingRecords.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredBillingRecords, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(totalDisplayCount / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  // Resolve user IDs for Modified By column
  useEffect(() => {
    const resolveUserIds = async () => {
      const ids = paginatedRecords
        .map(record => record.modifiedBy)
        .filter((v): v is string => !!v && !isNaN(Number(v)));

      const uniqueIds = Array.from(new Set(ids));

      await Promise.all(
        uniqueIds.map(async (id) => {
          if (userEmailCache[id]) return;
          try {
            const res = await userService.getUserById(Number(id));
            if (res.success && res.data?.email_address) {
              setUserEmailCache(prev => ({ ...prev, [id]: res.data!.email_address }));
            }
          } catch (error) {
            console.error(`Failed to resolve user ID ${id}:`, error);
          }
        })
      );
    };

    if (paginatedRecords.length > 0) {
      resolveUserIds();
    }
  }, [paginatedRecords]);



  const handleRecordClick = async (record: BillingRecord) => {
    try {
      setIsLoadingDetails(true);
      setSelectedBillingStatus(record.billingStatus || '');
      setSelectedAccountBalance(record.balance);
      setSelectedTotalPaid(record.totalPaid ?? null);
      
      // Presence broadcasting
      if (selectedCustomer && selectedCustomer.billingAccount?.accountNo !== record.applicationId) {
        broadCastViewing(selectedCustomer.billingAccount!.accountNo, 'stopped_viewing');
      }
      if (!selectedCustomer || selectedCustomer.billingAccount?.accountNo !== record.applicationId) {
        broadCastViewing(record.applicationId, 'started_viewing');
      }

      const customerData = await getCustomerDetail(record.applicationId);
      setSelectedCustomer(customerData);
    } catch (error) {
      console.error('Failed to fetch customer details:', error);
      setError('Failed to load customer details');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleCloseDetails = () => {
    if (selectedCustomer?.billingAccount?.accountNo) {
      broadCastViewing(selectedCustomer.billingAccount.accountNo, 'stopped_viewing');
    }
    setSelectedCustomer(null);
    setSelectedBillingStatus('');
    setSelectedAccountBalance(null);
    setSelectedTotalPaid(null);
  };

  const currentRecordIndex = selectedCustomer?.billingAccount?.accountNo 
    ? filteredBillingRecords.findIndex(r => r.applicationId === selectedCustomer.billingAccount!.accountNo)
    : -1;

  const handlePreviousRecord = () => {
    if (currentRecordIndex > 0) {
      handleRecordClick(filteredBillingRecords[currentRecordIndex - 1]);
    }
  };

  const handleNextRecord = () => {
    if (currentRecordIndex !== -1 && currentRecordIndex < filteredBillingRecords.length - 1) {
      handleRecordClick(filteredBillingRecords[currentRecordIndex + 1]);
    }
  };

  const renderCellValue = (record: BillingRecord, columnKey: string) => {
    switch (columnKey) {
      // Basic fields
      case 'status':
        const statusInfo = getStatusInfo(record);
        return (
          <div className="flex items-center space-x-2">
            {!statusInfo.hideCircle && (statusInfo.hollow ? (
              <Circle className={`h-3 w-3 ${statusInfo.color}`} strokeWidth={3} />
            ) : (
              <div className={`h-3 w-3 rounded-full ${statusInfo.fillColor}`} />
            ))}
            <span className={`text-[10px] font-bold tracking-tight ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {statusInfo.label}
            </span>
          </div>
        );
      case 'billingStatus':
        return record.billingStatus || 'Active';
      case 'accountNo':
        const viewersForAcc = viewers[record.applicationId] || [];
        return (
          <div className="flex items-center space-x-2 min-w-0">
            <span className="text-red-400">{record.applicationId}</span>
            {viewersForAcc.length > 0 && (
              <div className="flex flex-wrap gap-1 flex-shrink-0">
                {viewersForAcc.map((username: string) => (
                  <span 
                    key={username} 
                    className="text-[8px] px-1.5 py-0.5 rounded-full font-bold animate-pulse lowercase shadow-sm"
                    style={{
                      backgroundColor: colorPalette?.primary || '#7c3aed',
                      color: '#ffffff'
                    }}
                  >
                    {username} is viewing
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      case 'dateInstalled':
        return formatDate(record.dateInstalled);
      // Uppercased via CSS rather than .toUpperCase(): the underlying value is untouched, so
      // sorting, filtering, the CSV export and the tooltip all keep the real casing.
      case 'customerName':
        return <span className="uppercase" title={record.customerName}>{record.customerName}</span>;
      case 'address':
        return <span className="uppercase" title={record.address}>{record.address}</span>;
      case 'contactNumber':
        return record.contactNumber || '-';
      case 'emailAddress':
        return record.emailAddress || '-';
      case 'plan':
        return record.plan || '-';
      case 'balance':
        return `₱ ${record.balance.toFixed(2)}`;
      case 'username':
        return record.username || '-';
      case 'connectionType':
        return record.connectionType || '-';
      case 'routerModel':
        return record.routerModel || '-';
      case 'routerModemSN':
        return record.routerModemSN || '-';
      case 'lcpnap':
        return record.lcpnap || '-';
      case 'port':
        return record.port || '-';
      case 'vlan':
        return record.vlan || '-';
      case 'billingDay':
        return record.billingDay === 0 ? 'Every end of month' : (record.billingDay || '-');
      case 'totalPaid':
        return `₱ ${record.totalPaid?.toFixed(2) || '0.00'}`;
      case 'provider':
        return record.provider || '-';
      case 'lcp':
        return record.lcp || '-';
      case 'nap':
        return record.nap || '-';
      case 'modifiedBy':
        const rawMod = record.modifiedBy;
        return (rawMod && !isNaN(Number(rawMod))) ? (userEmailCache[rawMod] || rawMod) : (rawMod || '-');
      case 'modifiedDate':
        return formatDate(record.modifiedDate);
      case 'barangay':
        return record.barangay || '-';
      case 'city':
        return record.city || '-';
      case 'region':
        return record.region || '-';

      // Fields from BillingDetailRecord
      case 'lcpnapport':
        return (record as any).lcpnapport || '-';
      case 'usageType':
        return (record as any).usageType || '-';
      case 'referredBy':
        return (record as any).referredBy || '-';
      case 'secondContactNumber':
        return (record as any).secondContactNumber || '-';
      case 'mikrotikId':
        return (record as any).mikrotikId || '-';
      case 'sessionIP':
        return (record as any).sessionIP || '-';
      case 'housingStatus':
        return (record as any).housingStatus || '-';
      case 'addressCoordinates':
        return (record as any).addressCoordinates || '-';
      case 'location':
        return (record as any).location || '-';
      case 'sessionGroup':
        return record.sessionGroup || '-';
      case 'customerCreatedAt':
        return formatDate((record as any).customerCreatedAt);
      case 'billingAccountCreatedAt':
        return formatDate((record as any).billingAccountCreatedAt);
      case 'techCreatedAt':
        return formatDate((record as any).techCreatedAt);

      // Billing attributes. Derived through the same helpers the funnel filters use, so the
      // column, the filter and the details panel can never disagree about a record.
      case 'vatType':
        // Boolean wins; the legacy free-text column is only a fallback for older accounts.
        return deriveVatTypeLabel(record.vatEnabled, record.vatType) || '-';
      case 'generationType':
        return normalizeGenerationType(record.generationType) || '-';
      case 'expirationDate':
        // Prepaid only — a postpaid account has no rolling period to expire.
        return isPrepaidGeneration(record.generationType)
          ? (record.prepaidExpiration ? formatDate(record.prepaidExpiration) : '-')
          : '-';
      case 'vip':
        // No VIP flag exists on billing_accounts; VIP is the billing status (id 7).
        return deriveVipLabel(
          record.billing_status_id === VIP_BILLING_STATUS_ID ||
          String(record.billingStatus || '').trim().toLowerCase() === 'vip'
        );

      // Related records - placeholders
      case 'relatedInvoices':
      case 'relatedStatementOfAccount':
      case 'relatedDiscounts':
      case 'relatedStaggeredInstallation':
      case 'relatedStaggeredPayments':
      case 'relatedOverdues':
      case 'relatedDCNotices':
      case 'relatedServiceOrders':
      case 'relatedDisconnectedLogs':
      case 'relatedReconnectionLogs':
      case 'relatedChangeDueLogs':
      case 'relatedTransactions':
      case 'relatedDetailsUpdateLogs':
      case 'relatedAdvancedPayments':
      case 'relatedPaymentPortalLogs':
      case 'relatedInventoryLogs':
      case 'relatedOnlineStatus':
      case 'relatedBorrowedLogs':
      case 'relatedPlanChangeLogs':
      case 'relatedServiceChargeLogs':
      case 'relatedAdjustedAccountLogs':
      case 'relatedSecurityDeposits':
      case 'relatedApprovedTransactions':
      case 'relatedAttachments':
        return '-';

      // Computed fields
      case 'computedAddress':
        return (record as any).computedAddress ||
          (record.address ? <span className="uppercase">{record.address.length > 25 ? `${record.address.substring(0, 25)}...` : record.address}</span> : '-');
      case 'computedStatus':
        return (record as any).computedStatus ||
          `${record.status || 'Disconnected Offline'} | ₱ ${record.balance.toFixed(2)}`;
      case 'computedAccountNo':
        return (record as any).computedAccountNo ||
          <span>{record.applicationId} | <span className="uppercase">{record.customerName}</span>{record.address ? <> | <span className="uppercase">{record.address.length > 10 ? `${record.address.substring(0, 10)}...` : record.address}</span></> : ''}</span>;

      default:
        return '-';
    }
  };

  const handleExport = () => {
    if (!filteredBillingRecords || filteredBillingRecords.length === 0) return;

    const exportColumns = allColumns
      .filter(col => visibleColumns.includes(col.key))
      .sort((a, b) => {
        const indexA = columnOrder.indexOf(a.key);
        const indexB = columnOrder.indexOf(b.key);
        return indexA - indexB;
      });

    const getExportValue = (record: BillingRecord, columnKey: string) => {
      switch (columnKey) {
        case 'status':
          return getStatusInfo(record).label;
        case 'accountNo':
          return record.applicationId;
        // Both of these render as JSX (uppercased spans), which would export as "[object
        // Object]" — so the export reads the raw value, and keeps the original casing.
        case 'address':
          return record.address || '-';
        case 'customerName':
          return record.customerName || '-';
        case 'balance':
          return Number(record.balance ?? 0).toFixed(2);
        case 'totalPaid':
          return Number(record.totalPaid ?? 0).toFixed(2);
        default:
          return renderCellValue(record, columnKey);
      }
    };

    exportToCSV('customers_export', exportColumns, filteredBillingRecords, getExportValue);
  };

  const handleRefresh = async () => {
    try {
      setIsSilentRefreshing(true);
      // Use the context refresh function to silent refresh locally
      await refreshLatestData();
      
      if (selectedCustomerRef.current?.billingAccount?.accountNo) {
        const updatedCustomer = await getCustomerDetail(selectedCustomerRef.current.billingAccount.accountNo);
        setSelectedCustomer(updatedCustomer);
        setCustomerRefreshKey(prev => prev + 1);
      }
      
      setHasNewData(false);
    } catch (err) {
      console.error('Failed to refresh billing records:', err);
    } finally {
      setIsSilentRefreshing(false);
    }
  };

  const handleProcessOverdueNotifications = async () => {
    if (!window.confirm('Process overdue notifications?\n\nThis will:\n- Update overdue table\n- Send email with PDF attachments\n- Send SMS notifications\n\nContinue?')) {
      return;
    }

    setIsActionLoading(true);

    const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

    try {
      const response = await fetch(`${API_BASE_URL}/cron-test/process-overdue-notifications`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include'
      });

      const result = await response.json();

      if (!result.success) {
        alert('Overdue notification processing failed: ' + result.message);
        setError(result.message);
      } else {
        alert('✅ Overdue notifications processed successfully!\n\nCheck logs for details.');
        // Refresh data
        refreshLatestData();
      }
    } catch (err) {
      console.error('Processing failed:', err);
      alert('Processing failed: ' + (err as Error).message);
      setError('Processing failed. Please try again.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleProcessDisconnectionNotices = async () => {
    if (!window.confirm('Process disconnection notices?\n\nThis will:\n- Update disconnection notice table\n- Send email with PDF attachments\n- Send SMS notifications\n\nContinue?')) {
      return;
    }

    setIsActionLoading(true);

    const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

    try {
      const response = await fetch(`${API_BASE_URL}/cron-test/process-disconnection-notices`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include'
      });

      const result = await response.json();

      if (!result.success) {
        alert('Disconnection notice processing failed: ' + result.message);
        setError(result.message);
      } else {
        alert('✅ Disconnection notices processed successfully!\n\nCheck logs for details.');
        // Refresh data
        refreshLatestData();
      }
    } catch (err) {
      console.error('Processing failed:', err);
      alert('Processing failed: ' + (err as Error).message);
      setError('Processing failed. Please try again.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleGenerateSampleData = async () => {
    if (!window.confirm('Generate sample SOA and invoices for ALL accounts in database (regardless of billing day, status, or any restrictions)?\n\nThis will process EVERY account that has a date_installed value.\n\n✨ NEW: Includes PDF generation + Email queue + SMS notifications!\n\nContinue?')) {
      return;
    }

    setIsActionLoading(true);

    const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const generationDate = `${year}-${month}-${day}`;

    try {
      const response = await fetch(`${API_BASE_URL}/billing-generation/force-generate-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          generation_date: generationDate,
          send_notifications: true
        })
      });

      const result = await response.json();

      if (!result.success) {
        const errorDetails = result.data?.invoices?.errors || [];
        const soaErrors = result.data?.statements?.errors || [];
        const allErrors = [...errorDetails, ...soaErrors];

        if (allErrors.length > 0) {
          console.error('Generation errors:', allErrors);
          const firstError = allErrors[0];
          alert(`Generation failed for account ${firstError.account_no}: ${firstError.error}`);
        } else {
          alert(result.message || 'Generation failed');
        }
        setError(result.message);
        setIsActionLoading(false);
        return;
      }

      // Refresh data
      refreshLatestData();
      setError(null);

      const invoiceCount = result.data?.invoices?.success || 0;
      const soaCount = result.data?.statements?.success || 0;
      const accountCount = result.data?.total_accounts || 0;
      const invoiceErrors = result.data?.invoices?.failed || 0;
      const soaErrors = result.data?.statements?.failed || 0;

      // Count notifications
      const invoiceNotifications = result.data?.invoices?.notifications?.length || 0;
      const soaNotifications = result.data?.statements?.notifications?.length || 0;

      if (invoiceErrors > 0 || soaErrors > 0) {
        const errors = [
          ...(result.data?.invoices?.errors || []),
          ...(result.data?.statements?.errors || [])
        ];
        console.error('Generation errors:', errors);
        alert(`Generated ${invoiceCount} invoices and ${soaCount} statements for ${accountCount} accounts.\n\nFailed: ${invoiceErrors} invoices, ${soaErrors} statements.\n\nNotifications queued: ${invoiceNotifications + soaNotifications}\n\nCheck console for errors.`);
      } else {
        alert(`✅ Success!\n\nGenerated:\n- ${invoiceCount} invoices\n- ${soaCount} statements\n- ${accountCount} accounts processed\n\n📧 Notifications:\n- ${invoiceNotifications + soaNotifications} emails queued\n- ${invoiceNotifications + soaNotifications} SMS sent\n- ${invoiceNotifications + soaNotifications} PDFs created\n\n(All accounts with date_installed, regardless of billing day or status)`);
      }
    } catch (err) {
      console.error('Generation failed:', err);
      setError('Generation failed. Please try again.');
      alert('Generation failed: ' + (err as Error).message);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const newColumns = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      localStorage.setItem('customerTableVisibleColumns', JSON.stringify(newColumns));
      return newColumns;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map(col => col.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('customerTableVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('customerTableVisibleColumns', JSON.stringify([]));
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
    localStorage.setItem('customerTableColumnOrder', JSON.stringify(newOrder));
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

  const filteredColumns = allColumns
    .filter(col => visibleColumns.includes(col.key))
    .sort((a, b) => {
      const indexA = columnOrder.indexOf(a.key);
      const indexB = columnOrder.indexOf(b.key);
      return indexA - indexB;
    });

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
        } md:flex border-r flex-shrink-0 flex flex-col relative ${
          isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}
        style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}
      >
        <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
          <div className="flex items-center justify-between mb-1">
            <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Customers</h2>
          </div>
          <div className="mt-1">
            {/* Redundant dropdowns removed as requested */}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">

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
              <span>All Customers</span>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${selectedLocation === 'all'
                ? 'text-white'
                : isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                }`}
              style={selectedLocation === 'all' ? {
                backgroundColor: colorPalette?.primary || '#7c3aed'
              } : {}}
            >
              {statusTree.total}
            </span>
          </button>

          {/* Status Level (Flat with expansion) */}
          {statusTree.items.map((status) => {
            const style = getStatusInfo({ status: status.name, onlineStatus: status.name });
            const isSelected = selectedLocation === status.id;
            const isExpanded = expandedLocations.has(status.id);

            return (
              <div key={status.id}>
                <button
                  onClick={() => setSelectedLocation(status.id)}
                  className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                    }`}
                  style={isSelected ? {
                    backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                    color: colorPalette?.primary || '#7c3aed'
                  } : {}}
                >
                  <div className="flex items-center flex-1">
                    {!style.hideCircle && (style.hollow ? (
                      <Circle className={`h-4 w-4 mr-2.5 ${style.color}`} strokeWidth={3} />
                    ) : (
                      <div className={`h-3.5 w-3.5 rounded-full mr-2.5 ${style.fillColor}`} />
                    ))}
                    <span className={`font-bold uppercase tracking-tight text-xs ${isSelected ? '' : (isDarkMode ? 'text-gray-400' : 'text-gray-600')}`}>{status.name}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                      {status.count}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedLocations(prev => {
                          const next = new Set(prev);
                          if (next.has(status.id)) next.delete(status.id);
                          else next.add(status.id);
                          return next;
                        });
                      }}
                      className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-gray-500" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-gray-500" />
                      )}
                    </button>
                  </div>
                </button>

                {/* Recursive Rendering for Session Statuses or Billing Statuses */}
                {isExpanded && (status.sessionStatuses ? (
                  status.sessionStatuses.map((session) => {
                    const isSessionSelected = selectedLocation === session.id;
                    const isSessionExpanded = expandedLocations.has(session.id);
                    return (
                      <div key={session.id}>
                        <button
                          onClick={() => setSelectedLocation(session.id)}
                          className={`w-full flex items-center justify-between pl-8 pr-4 py-1.5 text-xs transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'}`}
                          style={isSessionSelected ? {
                            backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                            color: colorPalette?.primary || '#7c3aed'
                          } : {}}
                        >
                          <div className="flex items-center flex-1">
                            <span className="font-semibold">{session.name}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>
                              {session.count}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedLocations(prev => {
                                  const next = new Set(prev);
                                  if (next.has(session.id)) next.delete(session.id);
                                  else next.add(session.id);
                                  return next;
                                });
                              }}
                              className={`p-0.5 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                            >
                              {isSessionExpanded ? (
                                <ChevronDown className="h-3 w-3 text-gray-500" />
                              ) : (
                                <ChevronRight className="h-3 w-3 text-gray-500" />
                              )}
                            </button>
                          </div>
                        </button>

                        {/* Nested Billing Statuses under Session */}
                        {isSessionExpanded && session.bStatuses.map((billing) => {
                          const isBillingSelected = selectedLocation === billing.id;
                          const isBillingExpanded = expandedLocations.has(billing.id);
                          return (
                            <div key={billing.id}>
                              <button
                                onClick={() => setSelectedLocation(billing.id)}
                                className={`w-full flex items-center justify-between pl-12 pr-4 py-1.5 text-xs transition-colors ${isDarkMode ? 'text-gray-500 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'}`}
                                style={isBillingSelected ? {
                                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                  color: colorPalette?.primary || '#7c3aed'
                                } : {}}
                              >
                                <div className="flex items-center flex-1">
                                  <span>{billing.name}</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-300'}`}>
                                    {billing.count}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedLocations(prev => {
                                        const next = new Set(prev);
                                        if (next.has(billing.id)) next.delete(billing.id);
                                        else next.add(billing.id);
                                        return next;
                                      });
                                    }}
                                    className={`p-0.5 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                                  >
                                    {isBillingExpanded ? (
                                      <ChevronDown className="h-3 w-3 text-gray-500" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3 text-gray-500" />
                                    )}
                                  </button>
                                </div>
                              </button>

                              {/* Nested Barangays under Billing */}
                              {isBillingExpanded && billing.barangays.map((brgy) => {
                                const isBrgySelected = selectedLocation === brgy.id;
                                return (
                                  <button
                                    key={brgy.id}
                                    onClick={() => setSelectedLocation(brgy.id)}
                                    className={`w-full flex items-center justify-between pl-16 pr-4 py-1 text-[10px] transition-colors ${isDarkMode ? 'text-gray-600 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100'}`}
                                    style={isBrgySelected ? {
                                      backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                      color: colorPalette?.primary || '#7c3aed'
                                    } : {}}
                                  >
                                    <span>{brgy.name}</span>
                                    <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${isDarkMode ? 'bg-gray-800 text-gray-700' : 'bg-gray-50 text-gray-400'}`}>
                                      {brgy.count}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                ) : (
                  status.bStatuses.map((billing) => {
                    const isBillingSelected = selectedLocation === billing.id;
                    const isBillingExpanded = expandedLocations.has(billing.id);

                    return (
                      <div key={billing.id}>
                        <button
                          onClick={() => setSelectedLocation(billing.id)}
                          className={`w-full flex items-center justify-between pl-10 pr-4 py-1.5 text-xs transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
                            }`}
                          style={isBillingSelected ? {
                            backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                            color: colorPalette?.primary || '#7c3aed'
                          } : {}}
                        >
                          <div className="flex items-center flex-1">
                            <span>{billing.name}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>
                              {billing.count}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedLocations(prev => {
                                  const next = new Set(prev);
                                  if (next.has(billing.id)) next.delete(billing.id);
                                  else next.add(billing.id);
                                  return next;
                                });
                              }}
                              className={`p-0.5 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                            >
                              {isBillingExpanded ? (
                                <ChevronDown className="h-3 w-3 text-gray-500" />
                              ) : (
                                <ChevronRight className="h-3 w-3 text-gray-500" />
                              )}
                            </button>
                          </div>
                        </button>

                        {/* Nested Barangays */}
                        {isBillingExpanded && billing.barangays.map((brgy) => {
                          const isBrgySelected = selectedLocation === brgy.id;
                          return (
                            <button
                              key={brgy.id}
                              onClick={() => setSelectedLocation(brgy.id)}
                              className={`w-full flex items-center justify-between pl-16 pr-4 py-1 text-[10px] transition-colors ${isDarkMode ? 'text-gray-500 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'
                                }`}
                              style={isBrgySelected ? {
                                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                color: colorPalette?.primary || '#7c3aed'
                              } : {}}
                            >
                              <span>{brgy.name}</span>
                              <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-50 text-gray-300'}`}>
                                {brgy.count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
                ))}
              </div>
            );
          })}
        </div>

        {/* Resize Handle */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-10"
          onMouseDown={handleMouseDownSidebarResize}
          onMouseEnter={(e) => {
            if (colorPalette?.primary) {
              e.currentTarget.style.backgroundColor = colorPalette.primary;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '';
          }}
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
                    title="Back to Status Filters"
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
                    placeholder="Search customer records..."
                  />
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setIsFunnelFilterOpen(true)}
                  title={Object.keys(activeFilters).length > 0
                    ? `Active Filters:\n${Object.entries(activeFilters).map(([key, filter]: [string, any]) => {
                      const colName = (filterColumns as FilterColumn[]).find((c: FilterColumn) => c.key === key)?.label || key;
                      if (filter.type === 'text') {
                        if (key === 'billing_status_id') {
                          const status = billingStatuses.find(s => s.id.toString() === filter.value);
                          return `${colName}: ${status ? status.status_name : filter.value}`;
                        }
                        return `${colName}: ${filter.value}`;
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
                    : "Filter Customers"
                  }
                  className={`px-4 py-2 rounded text-sm transition-colors flex items-center flex-shrink-0 ${Object.keys(activeFilters).length > 0
                    ? 'text-red-500 hover:bg-red-500/10'
                    : isDarkMode
                      ? 'hover:bg-gray-700 text-white'
                      : 'hover:bg-gray-200 text-gray-900'
                    }`}
                >
                  <Filter className="h-5 w-5" />
                </button>
                {displayMode === 'table' && (
                  <div className="relative z-50 flex-shrink-0" ref={filterDropdownRef}>
                    <button
                      className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                        ? 'hover:bg-gray-700 text-white'
                        : 'hover:bg-gray-200 text-gray-900'
                        }`}
                      onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                      title="Column Visibility"
                    >
                      <Columns3 className="h-5 w-5" />
                    </button>
                    {filterDropdownOpen && (
                      <div className={`fixed mt-10 w-80 rounded shadow-lg z-50 max-h-96 flex flex-col -translate-x-[calc(100%-3.5rem)] ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
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
                              onMouseEnter={(e) => {
                                if (colorPalette?.accent) {
                                  e.currentTarget.style.color = colorPalette.accent;
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (colorPalette?.primary) {
                                  e.currentTarget.style.color = colorPalette.primary;
                                }
                              }}
                            >
                              Select All
                            </button>
                            <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>|</span>
                            <button
                              onClick={handleDeselectAllColumns}
                              className="text-xs"
                              style={{ color: colorPalette?.primary || '#7c3aed' }}
                              onMouseEnter={(e) => {
                                if (colorPalette?.accent) {
                                  e.currentTarget.style.color = colorPalette.accent;
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (colorPalette?.primary) {
                                  e.currentTarget.style.color = colorPalette.primary;
                                }
                              }}
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
                )}
                <div className="relative z-50 flex-shrink-0" ref={dropdownRef}>
                  <button
                    className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                      ? 'hover:bg-gray-700 text-white'
                      : 'hover:bg-gray-200 text-gray-900'
                      }`}
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                  >
                    <span>{displayMode === 'card' ? 'Card' : 'Table'}</span>
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {dropdownOpen && (
                    <div className={`fixed right-auto mt-1 w-36 rounded shadow-lg ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
                      }`}>
                      <button
                        onClick={() => {
                          setDisplayMode('card');
                          setDropdownOpen(false);
                        }}
                        className={`block w-full text-left px-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                          } ${displayMode === 'card' ? '' : isDarkMode ? 'text-white' : 'text-gray-900'}`}
                        style={displayMode === 'card' ? { color: colorPalette?.primary || '#7c3aed' } : {}}
                      >
                        Card View
                      </button>
                      <button
                        onClick={() => {
                          setDisplayMode('table');
                          setDropdownOpen(false);
                        }}
                        className={`block w-full text-left px-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                          } ${displayMode === 'table' ? '' : isDarkMode ? 'text-white' : 'text-gray-900'}`}
                        style={displayMode === 'table' ? { color: colorPalette?.primary || '#7c3aed' } : {}}
                      >
                        Table View
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleExport}
                  disabled={isLoading || filteredBillingRecords.length === 0}
                  title="Export to CSV"
                  className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border flex-shrink-0"
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: colorPalette?.primary || '#7c3aed',
                    color: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading && filteredBillingRecords.length > 0 && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading && filteredBillingRecords.length > 0) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <Download className="h-5 w-5" />
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={isLoading || !isFullyLoaded || isSilentRefreshing}
                  title={!isFullyLoaded ? `Loading records... (${billingRecords.length}/${totalCount})` : isSilentRefreshing ? "Checking for updates..." : "Refresh Records"}
                  className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: colorPalette?.primary || '#7c3aed',
                    color: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading && isFullyLoaded && !isSilentRefreshing && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading && isFullyLoaded && !isSilentRefreshing) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <RefreshCw className={`h-5 w-5 ${(isLoading || !isFullyLoaded || isSilentRefreshing) ? 'animate-spin' : ''}`} />
                  {hasNewData && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Active Funnel Filters Row - Placed "under" the search input row */}
            {Object.keys(activeFilters).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4 px-1">
                {Object.entries(activeFilters).map(([key, filter]: [string, any]) => {
                  const col = filterColumns.find(c => c.key === key);
                  const label = col ? col.label : key;

                  let displayValue = '';
                  if (filter.type === 'checklist' && Array.isArray(filter.value)) {
                    displayValue = filter.value.join(', ');
                  } else if (filter.type === 'text') {
                    displayValue = filter.value;
                  } else if (filter.type === 'number') {
                    if (filter.from && filter.to) displayValue = `${filter.from} - ${filter.to}`;
                    else if (filter.from) displayValue = `≥ ${filter.from}`;
                    else if (filter.to) displayValue = `≤ ${filter.to}`;
                  } else if (filter.type === 'date') {
                    if (filter.from && filter.to) displayValue = `${filter.from} to ${filter.to}`;
                    else if (filter.from) displayValue = `After ${filter.from}`;
                    else if (filter.to) displayValue = `Before ${filter.to}`;
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
                    localStorage.removeItem('customerFilters');
                  }}
                  className={`text-xs font-medium px-2 h-7 rounded-full transition-colors ${isDarkMode
                    ? 'text-gray-500 hover:text-white hover:bg-gray-800'
                    : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
              {isLoading ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  <div className="animate-pulse flex flex-col items-center">
                    <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                    <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                  </div>
                  <p className="mt-4">Loading customer records...</p>
                </div>
              ) : error ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                  <p>{error}</p>
                  <button
                    onClick={refreshLatestData}
                    className={`mt-4 px-4 py-2 rounded ${isDarkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}>
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {displayMode === 'card' ? (
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {paginatedRecords.length > 0 ? (
                        <div>
                          {paginatedRecords.map((record) => (
                            <div
                              key={record.id}
                              onClick={() => handleRecordClick(record)}
                              className={`px-4 py-3 cursor-pointer transition-colors border-b ${isDarkMode
                                ? 'hover:bg-gray-800 border-gray-800'
                                : 'hover:bg-gray-100 border-gray-200'
                                } ${selectedCustomer?.billingAccount?.accountNo === record.applicationId ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="text-red-400 font-medium text-sm mb-1 flex items-center flex-wrap gap-2">
                                    {/* Mobile card header — name and address uppercased to match the table view. */}
                                    <span>{record.applicationId} | <span className="uppercase">{record.customerName}</span> | <span className="uppercase">{record.address}</span></span>
                                    {(() => {
                                      const viewersForCard = viewers[record.applicationId] || [];
                                      return viewersForCard.length > 0 && (
                                        <div className="flex flex-wrap gap-1 flex-shrink-0">
                                          {viewersForCard.map((username: string) => (
                                            <span 
                                              key={username} 
                                              className="text-[8px] px-1.5 py-0.5 rounded-full font-bold animate-pulse lowercase shadow-sm"
                                              style={{
                                                backgroundColor: colorPalette?.primary || '#7c3aed',
                                                color: '#ffffff'
                                              }}
                                            >
                                              {username} is viewing
                                            </span>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  <div className={`text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                                    }`}>
                                    {/* Prepaid expiry sits between the status and the balance, shown
                                        as a countdown ("30 days left") rather than a raw date — the
                                        useful question is how long is left, not which date it lands on.
                                        The exact date stays available on hover. Post Paid accounts have
                                        no expiry, so the segment (and its separator) is omitted
                                        entirely rather than showing a blank. */}
                                    {record.status} | {(() => {
                                      const daysLeft = formatPrepaidDaysLeft(record.prepaidExpiration);
                                      if (!daysLeft) return null;
                                      return (
                                        <>
                                          <span title={`Prepaid expires ${formatDate(record.prepaidExpiration)}`}>
                                            {daysLeft}
                                          </span>
                                          {' | '}
                                        </>
                                      );
                                    })()}₱ {record.balance.toFixed(2)}
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2 ml-4 flex-shrink-0">
                                  {(() => {
                                    const statusInfo = getStatusInfo(record);
                                    return (
                                      <>
                                        {statusInfo.hollow ? (
                                          <Circle className={`h-3 w-3 ${statusInfo.color}`} strokeWidth={3} />
                                        ) : (
                                          <div className={`h-3 w-3 rounded-full ${statusInfo.fillColor}`} />
                                        )}
                                        <span className={`text-[10px] font-bold tracking-tight ${statusInfo.color}`}>
                                          {statusInfo.label}
                                        </span>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                          {filteredBillingRecords.length > 0
                            ? 'No customer records found matching your filters'
                            : (totalCount > billingRecords.length)
                              ? 'Loading more records... please wait.'
                              : 'No customer records found'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-full relative flex flex-col">
                      <div className="flex-1 overflow-auto">
                        <table ref={tableRef} className="w-max min-w-full text-sm border-separate border-spacing-0">
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
                                  className={`text-left py-3 px-3 font-normal ${column.width} whitespace-nowrap relative group cursor-move ${isDarkMode ? 'text-gray-400 bg-gray-800' : 'text-gray-600 bg-gray-100'
                                    } ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') : ''} ${draggedColumn === column.key ? 'opacity-50' : ''
                                    } ${dragOverColumn === column.key ? '' : ''
                                    }`}
                                  style={dragOverColumn === column.key ? {
                                    backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                    width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                                  } : {
                                    width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                                  }}
                                  onMouseEnter={() => setHoveredColumn(column.key)}
                                  onMouseLeave={() => setHoveredColumn(null)}
                                >
                                  <div className="flex items-center justify-between">
                                    <span>{column.label}</span>
                                    {(hoveredColumn === column.key || sortColumn === column.key) && (
                                      <button
                                        onClick={() => handleSort(column.key)}
                                        className="ml-2 transition-colors"
                                      >
                                        {sortColumn === column.key && sortDirection === 'desc' ? (
                                          <ArrowDown className="h-4 w-4" style={{ color: colorPalette?.accent || '#7c3aed' }} />
                                        ) : (
                                          <ArrowUp className="h-4 w-4 text-gray-400" style={{ color: hoveredColumn === column.key ? (colorPalette?.accent || '#7c3aed') : undefined }} />
                                        )}
                                      </button>
                                    )}
                                  </div>
                                  {index < filteredColumns.length - 1 && (
                                    <div
                                      className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize ${isDarkMode ? 'group-hover:bg-gray-600' : 'group-hover:bg-gray-300'
                                        }`}
                                      style={{
                                        '--hover-bg': colorPalette?.primary || '#7c3aed'
                                      } as React.CSSProperties}
                                      onMouseEnter={(e) => {
                                        if (colorPalette?.primary) {
                                          e.currentTarget.style.backgroundColor = colorPalette.primary;
                                        }
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = '';
                                      }}
                                      onMouseDown={(e) => handleMouseDownResize(e, column.key)}
                                    />
                                  )}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedRecords.length > 0 ? (
                              paginatedRecords.map((record) => (
                                <tr
                                  key={record.id}
                                  className={`border-b cursor-pointer transition-colors ${isDarkMode
                                    ? 'border-gray-800 hover:bg-gray-900'
                                    : 'border-gray-200 hover:bg-gray-50'
                                    } ${selectedCustomer?.billingAccount?.accountNo === record.applicationId ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
                                  onClick={() => handleRecordClick(record)}
                                >
                                  {filteredColumns.map((column, index) => (
                                    <td
                                      key={column.key}
                                      className={`py-4 px-3 ${isDarkMode ? 'text-white' : 'text-gray-900'
                                        } ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200') : ''}`}
                                      style={{
                                        width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                        maxWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                                      }}
                                    >
                                      <div className="truncate">
                                        {renderCellValue(record, column.key)}
                                      </div>
                                    </td>
                                  ))}
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={filteredColumns.length} className={`px-4 py-12 text-center border-b ${isDarkMode
                                  ? 'text-gray-400 border-gray-800'
                                  : 'text-gray-600 border-gray-200'
                                  }`}>
                                  {filteredBillingRecords.length > 0
                                    ? 'No customer records found matching your filters'
                                    : (totalCount > billingRecords.length)
                                      ? 'Loading more records... please wait.'
                                      : 'No customer records found'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {!isLoading && !error && filteredBillingRecords.length > 0 && (
              <PaginationControls
                totalPages={totalPages}
                itemsPerPage={itemsPerPage}
                setItemsPerPage={setItemsPerPage}
                isDarkMode={isDarkMode}
                currentPage={currentPage}
                totalDisplayCount={totalDisplayCount}
                handlePageChange={handlePageChange}
              />
            )}
          </div>
      </div>

      {
        (selectedCustomer || isLoadingDetails) && (
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
                billingRecord={{
                  ...convertCustomerDataToBillingDetail(selectedCustomer),
                  billingStatus: selectedBillingStatus || convertCustomerDataToBillingDetail(selectedCustomer).billingStatus || 'Active',
                  accountBalance: selectedAccountBalance ?? convertCustomerDataToBillingDetail(selectedCustomer).accountBalance ?? 0,
                  totalPaid: selectedTotalPaid ?? convertCustomerDataToBillingDetail(selectedCustomer).totalPaid ?? 0
                }}
                onlineStatusRecords={[]}
                onClose={handleCloseDetails}
                onRefresh={async () => {
                  try {
                    await refreshLatestData();
                    if (selectedCustomer?.billingAccount?.accountNo) {
                      const updatedCustomer = await getCustomerDetail(selectedCustomer.billingAccount.accountNo);
                      setSelectedCustomer(updatedCustomer);
                      if (updatedCustomer) {
                        const detail = convertCustomerDataToBillingDetail(updatedCustomer);
                        setSelectedAccountBalance(detail.accountBalance ?? null);
                        setSelectedTotalPaid(detail.totalPaid ?? null);
                        setSelectedBillingStatus(detail.billingStatus || '');
                      }
                      setCustomerRefreshKey(prev => prev + 1);
                    }
                  } catch (error) {
                    console.error('Failed to refresh customer data:', error);
                  }
                }}
                refreshKey={customerRefreshKey}
                onPrevious={currentRecordIndex > 0 ? handlePreviousRecord : undefined}
                onNext={currentRecordIndex !== -1 && currentRecordIndex < filteredBillingRecords.length - 1 ? handleNextRecord : undefined}
                onExpandSection={handleExpandSection}
              />
            ) : null}
          </div>
        )
      }

      <CustomerFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          setActiveFilters(filters);
          localStorage.setItem('customerFilters', JSON.stringify(filters));
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

      {/* Global Related Data Overlay */}
      <GlobalRelatedDataOverlay
        isOpen={overlayData.isOpen}
        onClose={() => setOverlayData(prev => ({ ...prev, isOpen: false }))}
        title={overlayData.title}
        data={overlayData.data}
        columns={overlayData.columns}
        count={overlayData.count}
        isDarkMode={isDarkMode}
      />
    </div >
  );
};

export default Customer;