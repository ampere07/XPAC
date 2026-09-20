import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Columns3, ArrowUp, ArrowDown, Menu, X, RefreshCw, ChevronLeft ,Filter, ChevronsLeft, ChevronsRight, Globe, Calendar, Download } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import JobOrderDetails from '../components/JobOrderDetails';
import GlobalRelatedDataOverlay from '../components/GlobalRelatedDataOverlay';
import JobOrderFunnelFilter, { FilterValues, allColumns as filterColumns } from '../filter/JobOrderFunnelFilter';
import SessionExpiredModal from '../components/SessionExpiredModal';
import { useJobOrderStore } from '../store/jobOrderStore';
import { getBillingStatuses, BillingStatus } from '../services/lookupService';
import { JobOrder } from '../types/jobOrder';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import pusher from '../services/pusherService';
import apiClient from '../config/api';
import { exportToCSV } from '../utils/exportUtils';
import { userService } from '../services/userService';
import { User } from '../types/api';
import { agentJobOrderBand, createAgentReferralMatcher, isAgentUser } from '../utils/agentReferral';
import {
  buildTechnicianLockedJobOrderIds,
  isTechnicianUser,
  sortJobOrdersForTechnician,
  TECHNICIAN_LOCKED_MESSAGE
} from '../utils/technicianJobOrderAccess';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

interface LocationItem {
  id: string;
  name: string;
  count: number;
}

type DisplayMode = 'card' | 'table';

const allColumns = [
  { key: 'timestamp', label: 'Timestamp', width: 'min-w-40' },
  { key: 'dateInstalled', label: 'Date Installed', width: 'min-w-36' },
  { key: 'referredBy', label: 'Referred By', width: 'min-w-32' },
  { key: 'fullName', label: 'Full Name of Client', width: 'min-w-48' },
  { key: 'address', label: 'Full Address of Client', width: 'min-w-56' },
  { key: 'onsiteStatus', label: 'Onsite Status', width: 'min-w-32' },
  { key: 'billingStatus', label: 'Billing Status', width: 'min-w-32' },
  { key: 'assignedEmail', label: 'Assigned Tech', width: 'min-w-48' },
  { key: 'billingDay', label: 'Billing Day', width: 'min-w-28' },
  { key: 'installationFee', label: 'Installation Fee', width: 'min-w-32' },
  { key: 'modifiedBy', label: 'Modified By', width: 'min-w-32' },
  { key: 'modifiedDate', label: 'Modified Date', width: 'min-w-40' },
  { key: 'modemRouterSN', label: 'Modem/Router SN', width: 'min-w-36' },
  { key: 'routerModel', label: 'Router Model', width: 'min-w-32' },
  { key: 'groupName', label: 'Group Name', width: 'min-w-32' },
  { key: 'lcpnap', label: 'LCPNAP', width: 'min-w-28' },
  { key: 'port', label: 'PORT', width: 'min-w-24' },
  { key: 'vlan', label: 'VLAN', width: 'min-w-24' },
  { key: 'username', label: 'Username', width: 'min-w-32' },
  { key: 'ipAddress', label: 'IP Address', width: 'min-w-32' },
  { key: 'connectionType', label: 'Connection Type', width: 'min-w-36' },
  { key: 'usageType', label: 'Usage Type', width: 'min-w-32' },
  { key: 'usernameStatus', label: 'Username Status', width: 'min-w-32' },
  { key: 'visitBy', label: 'Visit By', width: 'min-w-32' },
  { key: 'visitWith', label: 'Visit With', width: 'min-w-32' },
  { key: 'visitWithOther', label: 'Visit With Other', width: 'min-w-32' },
  { key: 'onsiteRemarks', label: 'Onsite Remarks', width: 'min-w-40' },
  { key: 'statusRemarks', label: 'Status Remarks', width: 'min-w-40' },
  { key: 'addressCoordinates', label: 'Address Coordinates', width: 'min-w-40' },
  { key: 'contractLink', label: 'Contract Link', width: 'min-w-48' },
  { key: 'clientSignatureUrl', label: 'Client Signature URL', width: 'min-w-48' },
  { key: 'setupImageUrl', label: 'Setup Image URL', width: 'min-w-48' },
  { key: 'speedtestImageUrl', label: 'Speedtest Image URL', width: 'min-w-48' },
  { key: 'signedContractImageUrl', label: 'Signed Contract Image URL', width: 'min-w-48' },
  { key: 'boxReadingImageUrl', label: 'Box Reading Image URL', width: 'min-w-48' },
  { key: 'routerReadingImageUrl', label: 'Router Reading Image URL', width: 'min-w-48' },
  { key: 'portLabelImageUrl', label: 'Port Label Image URL', width: 'min-w-48' },
  { key: 'houseFrontPictureUrl', label: 'House Front Picture URL', width: 'min-w-48' },
  { key: 'createdAt', label: 'Created At', width: 'min-w-40' },
  { key: 'createdByUserEmail', label: 'Created By User Email', width: 'min-w-48' },
  { key: 'updatedAt', label: 'Updated At', width: 'min-w-40' },
  { key: 'updatedByUserEmail', label: 'Updated By User Email', width: 'min-w-48' },
  { key: 'pppoeUsername', label: 'PPPoE Username', width: 'min-w-36' },
  { key: 'pppoePassword', label: 'PPPoE Password', width: 'min-w-36' },
  { key: 'location', label: 'Location', width: 'min-w-40' },
  { key: 'contractTemplate', label: 'Contract Template', width: 'min-w-36' },
  { key: 'firstName', label: 'First Name', width: 'min-w-32' },
  { key: 'middleInitial', label: 'Middle Initial', width: 'min-w-28' },
  { key: 'lastName', label: 'Last Name', width: 'min-w-32' },
  { key: 'contactNumber', label: 'Contact Number', width: 'min-w-36' },
  { key: 'secondContactNumber', label: 'Second Contact Number', width: 'min-w-40' },
  { key: 'emailAddress', label: 'Email Address', width: 'min-w-48' },
  { key: 'region', label: 'Region', width: 'min-w-28' },
  { key: 'city', label: 'City', width: 'min-w-28' },
  { key: 'barangay', label: 'Barangay', width: 'min-w-32' },
  { key: 'choosePlan', label: 'Choose Plan', width: 'min-w-36' },
  { key: 'startTimestamp', label: 'Start Timestamp', width: 'min-w-40' },
  { key: 'endTimestamp', label: 'End Timestamp', width: 'min-w-40' },
  { key: 'duration', label: 'Duration', width: 'min-w-28' }
];

/**
 * The columns an agent sees: their referral's customer, address, billing detail
 * and current status. Technical provisioning and documents are not included.
 */
const AGENT_COLUMNS = [
  'timestamp',
  'referredBy',
  'fullName',
  'contactNumber',
  'emailAddress',
  'address',
  'installationFee',
  'billingStatus',
  'billingDay',
  'dateInstalled',
  'onsiteStatus',
];

/**
 * The signed-in user's identity, read straight out of storage.
 *
 * Used to seed state before the first render so an agent's list is filtered from
 * the very first paint. Returns blanks when nothing is stored, which reads as
 * "not an agent" and leaves the unfiltered behaviour other roles rely on.
 */
const storedAuth = (): { role: string; roleId: string | number | null; id: number | null; fullName: string; email: string } => {
  const empty = { role: '', roleId: null, id: null, fullName: '', email: '' };

  try {
    const raw = localStorage.getItem('authData');
    if (!raw) return empty;

    const userData = JSON.parse(raw);

    // The login payload exposes full_name; fall back to the name parts for
    // older sessions, matching how the rest of the agent screens build it.
    let fullName: string = userData.full_name || '';
    if (!fullName) {
      const middleInitial = userData.middle_initial ? String(userData.middle_initial).trim() : '';
      fullName = [
        userData.first_name || '',
        middleInitial ? `${middleInitial}.` : '',
        userData.last_name || ''
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    return {
      role: userData.role || '',
      roleId: userData.role_id || null,
      // Referrals made through the picker are stored as this id, not a name.
      id: userData.id ?? userData.user_id ?? null,
      fullName,
      email: userData.email || userData.email_address || '',
    };
  } catch {
    return empty;
  }
};

/**
 * A status word in the colour its state calls for.
 *
 * At module scope on purpose. Declared inside the page, every render built a
 * new component type, so React could not match it against the previous one and
 * tore down and rebuilt every status in the table instead of leaving it alone.
 */
const StatusText = React.memo(({ status, type }: { status?: string | null, type: 'onsite' | 'billing' }) => {
  if (!status) return <span className="text-gray-400">-</span>;

  let textColor = '';

  if (type === 'onsite') {
    switch (status.toLowerCase()) {
      case 'done':
      case 'completed':
        textColor = 'text-green-400';
        break;
      case 'reschedule':
        textColor = 'text-blue-400';
        break;
      case 'inprogress':
      case 'in progress':
        textColor = 'text-blue-400';
        break;
      case 'pending':
        textColor = 'text-orange-400';
        break;
      case 'failed':
      case 'cancelled':
        textColor = 'text-red-500';
        break;
      default:
        textColor = 'text-gray-400';
    }
  } else {
    switch (status.toLowerCase()) {
      case 'done':
      case 'active':
      case 'completed':
      case 'vip':
      case 'service account':
        textColor = 'text-green-400';
        break;
      case 'pending':
      case 'in progress':
        textColor = 'text-orange-400';
        break;
      case 'suspended':
      case 'overdue':
      case 'cancelled':
      case 'blacklisted':
      case 'pullout':
        textColor = 'text-red-500';
        break;
      case 'freeze':
        textColor = 'text-blue-400';
        break;
      case 'inactive':
        textColor = 'text-gray-400';
        break;
      default:
        textColor = 'text-gray-400';
    }
  }

  return (
    <span className={`${textColor} font-bold uppercase`}>
      {status === 'inprogress' ? 'In Progress' : status}
    </span>
  );
});

const JobOrderPage: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
    } catch {
      return null;
    }
  });
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrder | null>(null);
  const selectedJobOrderRef = useRef<JobOrder | null>(null);
  const { jobOrders, isLoading, error, fetchJobOrders, refreshJobOrders, silentRefresh, hasMore, fetchUpdates, isFullyLoaded, totalCount } = useJobOrderStore();
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [billingStatuses, setBillingStatuses] = useState<BillingStatus[]>([]);
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  // Resolved from storage synchronously, before the first paint.
  //
  // Reading this in an effect instead meant the first render had no identity, so
  // the agent filter below was skipped and every job order in the organisation
  // was painted for a frame before being replaced by the agent's own. Local
  // storage is synchronous, so there is no reason to wait.
  //
  // Held as constants rather than state: who is signed in cannot change while
  // the page is mounted, so there is nothing to set and no re-render to cause.
  const { role: userRole, roleId, id: agentUserId, fullName: agentName, email: agentEmail } = useMemo(storedAuth, []);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(true);
  // Card on a phone, table on a desktop — and whatever was last chosen after
  // that. The table is `w-max`, so opening it on a phone put the whole list
  // behind a sideways scroll; the card view carries the same rows in a column
  // that fits. Kept in localStorage the way Work Order keeps its own.
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    const saved = localStorage.getItem('jobOrderDisplayMode');
    if (saved === 'card' || saved === 'table') return saved;
    return window.innerWidth < 768 ? 'card' : 'table';
  });

  const chooseDisplayMode = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode);
    localStorage.setItem('jobOrderDisplayMode', mode);
  }, []);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    // Agents get their own column set, chosen here rather than in an effect so
    // the table does not paint the full administrator layout first.
    const auth = storedAuth();
    if (isAgentUser(auth.role, auth.roleId)) {
      return AGENT_COLUMNS;
    }

    const saved = localStorage.getItem('jobOrderVisibleColumns');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load column visibility:', err);
      }
    }
    return ['timestamp', 'dateInstalled', 'referredBy', 'fullName', 'address', 'onsiteStatus', 'billingStatus', 'assignedEmail', 'billingDay', 'installationFee', 'modifiedBy', 'modifiedDate'];
  });
  const isTechnician = isTechnicianUser(userRole, roleId);
  const isAgentViewer = isAgentUser(userRole, roleId);
  // Technicians land on their queue in the order they are expected to work it —
  // oldest first — which the presort below applies when no column sort is set.
  // Everyone else keeps the newest-first default. Sorting a column still works
  // for both.
  const [sortColumn, setSortColumn] = useState<string | null>(isTechnician ? null : 'timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('jobOrderColumnOrder');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load column order:', err);
      }
    }
    return allColumns.map(col => col.key);
  });
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [mobileViewMode, setMobileViewMode] = useState<'sidebar' | 'list'>('sidebar');
  const [technicianEmail, setTechnicianEmail] = useState<string | undefined>(undefined);
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);
  const [dateInstalledFrom, setDateInstalledFrom] = useState<string>('');
  const [dateInstalledTo, setDateInstalledTo] = useState<string>('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  // Trigger buttons for the fixed-position dropdowns (the toolbar clips overflow,
  // so these menus render `fixed` and must be anchored to the button's screen rect).
  const columnBtnRef = useRef<HTMLButtonElement>(null);
  const viewBtnRef = useRef<HTMLButtonElement>(null);
  const [columnMenuPos, setColumnMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [viewMenuPos, setViewMenuPos] = useState<{ top: number; left: number } | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const cardScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [viewers, setViewers] = useState<Record<string, string[]>>({});
  const [activeFilters, setActiveFilters] = useState<any>(() => {
    const saved = localStorage.getItem('jobOrderFilters');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    }
    return {};
  });

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

  const removeFilter = (key: string) => {
    const newFilters = { ...activeFilters };
    delete newFilters[key];
    setActiveFilters(newFilters);
    localStorage.setItem('jobOrderFilters', JSON.stringify(newFilters));
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

  useEffect(() => {
    if (error && (String(error).includes('401') || String(error).includes('status code 401'))) {
      setShowSessionExpired(true);
    }
  }, [error]);

  // No need for internal currentPage as it's managed by store
  const [itemsPerPage, setItemsPerPage] = useState(25);

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

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLocation, searchQuery, activeFilters, sortColumn, sortDirection, itemsPerPage, dateInstalledFrom, dateInstalledTo]);

  // Scroll to top on page change
  useEffect(() => {
    if (displayMode === 'card' && cardScrollRef.current) {
      cardScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (displayMode === 'table' && tableScrollRef.current) {
      tableScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage, displayMode]);

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

  const formatDate = (dateStr?: string | null): string => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      let hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const hh = String(hours).padStart(2, '0');
      return `${mm}/${dd}/${yyyy} ${hh}:${minutes} ${ampm}`;
    } catch (e) {
      return '-';
    }
  };

  const formatOnlyDate = (dateStr?: string | null): string => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
      return '-';
    }
  };

  const formatDateTime = (dateStr?: string | null): string => {
    return formatDate(dateStr);
  };

  const calculateDuration = (start?: string | null, end?: string | null): string => {
    if (!start || !end) return '-';
    try {
      const startTime = new Date(start);
      const endTime = new Date(end);
      const diffMs = endTime.getTime() - startTime.getTime();

      if (diffMs < 0) return 'Invalid duration';

      const diffHrs = Math.floor(diffMs / 3600000);
      const diffMins = Math.floor((diffMs % 3600000) / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      const parts = [];
      if (diffHrs > 0) parts.push(`${diffHrs}h`);
      if (diffMins > 0) parts.push(`${diffMins}m`);
      if (diffSecs > 0 || parts.length === 0) parts.push(`${diffSecs}s`);

      return parts.join(' ');
    } catch (e) {
      return '-';
    }
  };

  const getLastDayOfMonth = (): number => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return lastDay.getDate();
  };

  const formatPrice = (price?: number | null): string => {
    if (price === null || price === undefined || price === 0) return '-';
    return `₱${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };


  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme !== 'light');
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    const theme = localStorage.getItem('theme');
    setIsDarkMode(theme !== 'light');

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    selectedJobOrderRef.current = selectedJobOrder;
  }, [selectedJobOrder]);

  // The identity itself is resolved synchronously above, so this only has to
  // cover the technician case, which does not affect what is painted first.
  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (!authData) return;

    try {
      const userData = JSON.parse(authData);
      const isTechnician = (userData.role && userData.role.toLowerCase() === 'technician')
        || String(userData.role_id) === '2';

      if (isTechnician && userData.email) {
        setTechnicianEmail(userData.email);
      }
    } catch (error) {
      console.error('Failed to parse auth data:', error);
    }
  }, []);

  // Fetch billing statuses
  useEffect(() => {
    const fetchLookupData = async () => {
      try {
        const billingStatusesData = await getBillingStatuses();
        setBillingStatuses(billingStatusesData || []);
      } catch (err) {
        console.error('Failed to fetch lookup data:', err);
      }
    };

    fetchLookupData();
  }, []);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setIsLoadingUsers(true);
        const response = await userService.getAllUsers();
        if (response.success && response.data) {
          setUsers(response.data);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      } finally {
        setIsLoadingUsers(false);
      }
    };
    fetchUsers();
  }, []);

  useEffect(() => {
    // Use silentRefresh on mount to check for updates without showing a spinner if we already have data
    silentRefresh(technicianEmail);
  }, [silentRefresh, technicianEmail]);

  // Pusher/Soketi connection for real-time job order updates
  useEffect(() => {
    const handleJobOrderUpdate = async (data: any) => {
      // Check organization_id against current user's org
      if (currentUserOrgId) {
        // User has an org — only accept updates that match it
        if (data.organization_id !== currentUserOrgId) {
          return;
        }
      } else {
        // User has no org — only accept updates with no org
        if (data.organization_id) {
          return;
        }
      }

      setHasNewData(true);
      try {
        await silentRefresh(technicianEmail);
      } catch (err) {
        console.error('[JobOrder Soketi] Failed to refresh data:', err);
      }
    };

    const jobChannel = pusher.subscribe('job-orders');
    const appChannel = pusher.subscribe('applications');

    // Subscription success/error handlers
    const channels = [
      { channel: jobChannel, name: 'job-orders' },
      { channel: appChannel, name: 'applications' }
    ];
    channels.forEach(({ channel, name }) => {
      channel.bind('pusher:subscription_succeeded', () => {
      });
      channel.bind('pusher:subscription_error', (error: any) => {
        console.error(`[JobOrder Soketi] Subscription error on ${name}:`, error);
      });
    });

    jobChannel.bind('job-order-done', handleJobOrderUpdate);
    appChannel.bind('new-application', handleJobOrderUpdate);

    // Presence channel for viewing updates
    const presenceChannel = pusher.subscribe('presence-job-orders-presence');

    presenceChannel.bind('pusher:subscription_succeeded', (members: any) => {
    });

    presenceChannel.bind('viewing-update', (data: { jobOrderId: string; username: string; action: 'started_viewing' | 'stopped_viewing' }) => {
      setViewers(prev => {
        const next = { ...prev };
        const currentViewers = next[data.jobOrderId] || [];

        if (data.action === 'started_viewing') {
          if (!currentViewers.includes(data.username)) {
            next[data.jobOrderId] = [...currentViewers, data.username];
          }
        } else {
          next[data.jobOrderId] = currentViewers.filter(name => name !== data.username);
          if (next[data.jobOrderId].length === 0) {
            delete next[data.jobOrderId];
          }
        }
        return next;
      });
    });

    presenceChannel.bind('pusher:member_added', (member: any) => {
      // If we are currently viewing a job order, broadcast it so the new member knows
      if (selectedJobOrderRef.current) {
        apiClient.post('/job-orders/broadcast-viewing', {
          job_order_id: selectedJobOrderRef.current.id,
          action: 'started_viewing'
        }).catch(err => console.error('[JobOrder Presence] Failed to re-broadcast viewing state:', err));
      }
    });

    presenceChannel.bind('pusher:member_removed', (member: any) => {
      const username = member.info?.username;
      if (username) {
        setViewers(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(id => {
            next[id] = next[id].filter(name => name !== username);
            if (next[id].length === 0) delete next[id];
          });
          return next;
        });
      }
    });

    // Re-subscribe on reconnection
    const stateHandler = (states: { previous: string; current: string }) => {
      if (states.current === 'connected') {
        if (jobChannel.subscribed !== true) pusher.subscribe('job-orders');
        if (appChannel.subscribed !== true) pusher.subscribe('applications');
        if (presenceChannel.subscribed !== true) pusher.subscribe('presence-job-orders-presence');
      }
    };
    pusher.connection.bind('state_change', stateHandler);

    return () => {
      channels.forEach(({ channel }) => {
        channel.unbind('pusher:subscription_succeeded');
        channel.unbind('pusher:subscription_error');
      });
      jobChannel.unbind('job-order-done', handleJobOrderUpdate);
      appChannel.unbind('new-application', handleJobOrderUpdate);
      presenceChannel.unbind('viewing-update');
      presenceChannel.unbind('pusher:member_removed');
      pusher.connection.unbind('state_change', stateHandler);
      pusher.unsubscribe('job-orders');
      pusher.unsubscribe('applications');
      pusher.unsubscribe('presence-job-orders-presence');
    };
  }, [silentRefresh, technicianEmail]);

  // Polling for updates every 3 seconds - Incremental fetch
  useEffect(() => {
    const POLLING_INTERVAL = 3000; // 3 seconds
    const intervalId = setInterval(async () => {
      try {
        await fetchUpdates(technicianEmail);
      } catch (err) {
        console.error('[JobOrder Page] Polling failed:', err);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [fetchUpdates, technicianEmail]);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      try {
        await silentRefresh(technicianEmail);
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
  }, [silentRefresh, technicianEmail]);


  const accessibleJobOrders = useMemo(() => {
    // First filter by organization — only show records matching the current user's org
    let filtered = jobOrders.filter((jo: JobOrder) => {
      if (currentUserOrgId) {
        // User belongs to an org: only show jobs assigned to that same org
        return jo.organization_id === currentUserOrgId;
      } else {
        // User has no org: only show jobs that have no org assigned
        return !jo.organization_id;
      }
    });

    // Then filter by agent if applicable.
    //
    // An agent sees every referral they own, however long ago it was raised —
    // there is no date cut-off, and finished ones are kept rather than dropped:
    // they read at the bottom of the list (see sortedJobOrders) so the work
    // still in flight leads.
    //
    // Matching mirrors the mobile app: tolerant of middle names, or an exact
    // email match. The identity check is deliberately INSIDE the agent branch
    // rather than guarding it: an agent whose name and email are somehow both
    // missing must see nothing, never everyone's job orders.
    if (isAgentUser(userRole, roleId)) {
      if (!agentName && !agentEmail && agentUserId === null) return [];

      // Built once for the whole scan rather than per row — see
      // createAgentReferralMatcher.
      const ownsReferral = createAgentReferralMatcher(agentName, agentEmail, agentUserId);
      return filtered.filter((jo: JobOrder) => ownsReferral(jo.Referred_By || jo.referred_by || ''));
    }
    return filtered;
  }, [jobOrders, userRole, roleId, agentUserId, agentName, agentEmail, currentUserOrgId]);

  // Update selectedJobOrder with fresh data after refresh
  useEffect(() => {
    if (selectedJobOrder) {
      const updatedOrder = accessibleJobOrders.find(order => order.id === selectedJobOrder.id);
      if (updatedOrder && JSON.stringify(updatedOrder) !== JSON.stringify(selectedJobOrder)) {
        setSelectedJobOrder(updatedOrder);
      }
    }
  }, [accessibleJobOrders]);

  const getClientFullName = (jobOrder: JobOrder): string => {
    return [
      jobOrder.First_Name || jobOrder.first_name || '',
      jobOrder.Middle_Initial || jobOrder.middle_initial ? (jobOrder.Middle_Initial || jobOrder.middle_initial) + '.' : '',
      jobOrder.Last_Name || jobOrder.last_name || ''
    ].filter(Boolean).join(' ').trim() || '-';
  };

  const getClientFullAddress = (jobOrder: JobOrder): string => {
    const addressParts = [
      jobOrder.Address || jobOrder.address || jobOrder.Installation_Address || jobOrder.installation_address,
      jobOrder.Location || jobOrder.location,
      jobOrder.Barangay || jobOrder.barangay,
      jobOrder.City || jobOrder.city,
      jobOrder.Region || jobOrder.region
    ].filter(Boolean);

    return addressParts.length > 0 ? addressParts.join(', ') : '-';
  };

  // Cleanup viewing status on unmount
  useEffect(() => {
    return () => {
      if (selectedJobOrder) {
        apiClient.post('/job-orders/broadcast-viewing', {
          job_order_id: selectedJobOrder.id,
          action: 'stopped_viewing'
        }).catch((err: any) => {
          if (err.response) {
            console.error('[Presence] Error response data during unmount:', err.response.data);
          }
        });
      }
    };
  }, [selectedJobOrder]);

  const handleRefresh = async () => {
    setIsRefreshingManual(true);
    setHasNewData(false);
    const authData = localStorage.getItem('authData');
    let email: string | undefined;
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        if ((userData.role && userData.role.toLowerCase() === 'technician' || String(userData.role_id) === '2') && userData.email) {
          email = userData.email;
        }
      } catch (err) { }
    }
    setCurrentPage(1);
    try {
      await refreshJobOrders(email);
    } finally {
      setIsRefreshingManual(false);
    }
  };

  // Helper function to apply funnel filters
  const getVal = (jo: JobOrder, key: string) => {
    switch (key) {
      case 'timestamp': return jo.Timestamp || jo.timestamp || '';
      case 'application_id': return jo.Application_ID || jo.application_id || '';
      case 'billingStatus': return jo.billing_status || jo.Billing_Status || '';
      case 'onsiteStatus': return jo.Onsite_Status || jo.onsite_status || '';
      case 'dateInstalled': return jo.Date_Installed || jo.date_installed || '';
      case 'installationFee': return jo.Installation_Fee || jo.installation_fee || 0;
      case 'billingDay': return jo.Billing_Day ?? jo.billing_day ?? 0;
      case 'modemRouterSN': return jo.Modem_Router_SN || jo.modem_router_sn || '';
      case 'routerModel': return jo.Router_Model || jo.router_model || '';
      case 'groupName': return jo.group_name || jo.Group_Name || '';
      case 'lcpnap': return jo.LCPNAP || jo.lcpnap || '';
      case 'port': return jo.PORT || jo.Port || jo.port || '';
      case 'vlan': return jo.VLAN || jo.vlan || '';
      case 'username': return jo.Username || jo.username || '';
      case 'ipAddress': return jo.IP_Address || jo.ip_address || jo.IP || jo.ip || '';
      case 'connectionType': return jo.Connection_Type || jo.connection_type || '';
      case 'usageType': return jo.Usage_Type || jo.usage_type || '';
      case 'usernameStatus': return jo.username_status || jo.Username_Status || '';
      case 'visitBy': return jo.Visit_By || jo.visit_by || '';
      case 'visitWith': return jo.Visit_With || jo.visit_with || '';
      case 'visitWithOther': return jo.Visit_With_Other || jo.visit_with_other || '';
      case 'onsiteRemarks': return jo.Onsite_Remarks || jo.onsite_remarks || '';
      case 'statusRemarks': return jo.Status_Remarks || jo.status_remarks || '';
      case 'fullName': return getClientFullName(jo);
      case 'emailAddress': return jo.Email_Address || jo.email_address || jo.Applicant_Email_Address || jo.applicant_email_address || '';
      case 'referredBy': return jo.Referred_By || jo.referred_by || '';
      case 'contactNumber': return jo.Contact_Number || jo.contact_number || jo.Mobile_Number || jo.mobile_number || '';
      case 'barangay': return jo.Barangay || jo.barangay || '';
      case 'city': return jo.City || jo.city || '';
      case 'region': return jo.Region || jo.region || '';
      case 'choosePlan': return jo.Choose_Plan || jo.Desired_Plan || jo.choose_plan || jo.desired_plan || '';
      case 'contractTemplate': return jo.Contract_Template || jo.contract_template || (jo as any).contract_link || '';
      case 'Account_No': return jo.Account_No || jo.Account_Number || jo.account_no || jo.account_number || '';
      case 'houseFrontPictureUrl': return jo.house_front_picture_url || jo.House_Front_Picture || '';
      case 'address': return getClientFullAddress(jo);
      case 'assignedEmail': 
        const email = jo.Assigned_Email || jo.assigned_email || '';
        if (!email) return '-';
        const user = users.find(u => (u.email_address || '').toLowerCase() === email.toLowerCase());
        if (user) {
          const fullName = [
            user.first_name || '',
            user.middle_initial ? `${user.middle_initial}.` : '',
            user.last_name || ''
          ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
          return fullName || email;
        }
        return email;
      case 'createdAt': return jo.created_at || jo.Created_At || '';
      case 'updatedAt': return jo.updated_at || jo.Updated_At || '';
      case 'lcp': return jo.LCP || jo.lcp || '';
      case 'nap': return jo.NAP || jo.nap || '';
      case 'startTimestamp': return jo.StartTimeStamp || jo.start_timestamp || jo.start_time || '';
      case 'endTimestamp': return jo.EndTimeStamp || jo.end_timestamp || jo.end_time || '';
      case 'duration':
        const start = jo.start_time || jo.StartTimeStamp || jo.start_timestamp;
        const end = jo.end_time || jo.EndTimeStamp || jo.end_timestamp;
        return calculateDuration(start, end);
      case 'firstName': return jo.First_Name || jo.first_name || '';
      case 'middleInitial': return jo.Middle_Initial || jo.middle_initial || '';
      case 'lastName': return jo.Last_Name || jo.last_name || '';
      case 'applicantEmailAddress': return jo.Applicant_Email_Address || jo.applicant_email_address || jo.Email_Address || jo.email_address || '';
      case 'remarks': return jo.remarks || jo.Remarks || jo.onsite_remarks || '';
      case 'status': return jo.status || jo.Status || '';
      case 'provider': return jo.provider || jo.Provider || '';
      case 'lcpnapport': return jo.lcpnapport || jo.LCPNAPPORT || '';
      case 'ownership': return jo.ownership || jo.Ownership || '';
      case 'addressCoordinates': return jo.address_coordinates || jo.Address_Coordinates || '';
      case 'computedTime': return jo.computed_time || jo._ComputedTime || (jo as any).computedTime || '';
      case 'modifiedBy': return jo.Modified_By || jo.modified_by || jo.updated_by_user_email || '';
      case 'modifiedDate': return jo.Modified_Date || jo.modified_date || jo.updated_at || '';
      default: return (jo as any)[key] || '';
    }
  };

  const applyFunnelFilters = (orders: JobOrder[], filters: any): JobOrder[] => {
    if (!filters || Object.keys(filters).length === 0) return orders;

    return orders.filter(order => {
      return Object.entries(filters).every(([key, filter]: [string, any]) => {
        const orderValue = getVal(order, key);

        let match = true;
        if (filter.type === 'text') {
          if (!filter.value) match = true;
          else {
            const value = String(orderValue || '').toLowerCase();
            match = value.includes(filter.value.toLowerCase());
          }
        } else if (filter.type === 'number') {
          const numValue = Number(orderValue);
          if (isNaN(numValue)) match = false;
          else if (filter.from !== undefined && filter.from !== '' && numValue < Number(filter.from)) match = false;
          else if (filter.to !== undefined && filter.to !== '' && numValue > Number(filter.to)) match = false;
          else match = true;
        } else if (filter.type === 'checklist') {
          if (!filter.value || filter.value.length === 0) match = true;
          else {
            const valStr = String(orderValue || '').toLowerCase();
            match = filter.value.some((v: string) => {
              const filterVal = String(v).toLowerCase();
              return valStr === filterVal;
            });
          }
        } else if (filter.type === 'date') {
          if (!orderValue) match = false;
          else {
            const normalizeDate = (d: any, isEnd: boolean = false) => {
              let s = String(d).trim().replace(' ', 'T');
              if (s.length === 10) {
                s = isEnd ? `${s}T23:59:59.999` : `${s}T00:00:00`;
              }
              return new Date(s).getTime();
            };

            const orderTime = normalizeDate(orderValue);
            const fromTime = filter.from ? normalizeDate(filter.from) : null;
            const toTime = filter.to ? normalizeDate(filter.to, true) : null;

            if (fromTime && orderTime < fromTime) match = false;
            else if (toTime && orderTime > toTime) match = false;
            else match = true;
          }
        }

        return match;
      });
    });
  };

  // 1. Initial search and funnel filtering (Global filtered set for sidebar counts)
  const globalFilteredJobOrders = useMemo(() => {
    let filtered = accessibleJobOrders.filter((jobOrder: JobOrder) => {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') {
          return Object.values(val).some(v => checkValue(v));
        }
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };

      return searchQuery === '' || checkValue(jobOrder);
    });

    // Apply sidebar date range filters for date installed
    if (dateInstalledFrom || dateInstalledTo) {
      filtered = filtered.filter(record => {
        const dateValueStr = record.Date_Installed || record.date_installed;
        if (!dateValueStr) return false;

        const dateValue = new Date(dateValueStr).getTime();
        if (isNaN(dateValue)) return false;

        if (dateInstalledFrom) {
          const fromDate = new Date(dateInstalledFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (dateValue < fromDate.getTime()) return false;
        }

        if (dateInstalledTo) {
          const toDate = new Date(dateInstalledTo);
          toDate.setHours(23, 59, 59, 999);
          if (dateValue > toDate.getTime()) return false;
        }

        return true;
      });
    }

    return applyFunnelFilters(filtered, activeFilters);
  }, [accessibleJobOrders, searchQuery, activeFilters, dateInstalledFrom, dateInstalledTo]);

  // Derive statusItems components from the search-filtered set
  const statusItems = useMemo(() => {
    const statuses = [
      { name: 'Done', value: 'done' },
      { name: 'Failed', value: 'failed' },
      { name: 'In Progress', value: 'inprogress' },
      { name: 'Reschedule', value: 'reschedule' },
      { name: 'Empty', value: 'empty' }
    ];

    const tree: Record<string, { count: number, billingStatuses: Record<string, { count: number, barangays: Record<string, number> }> }> = {};
    statuses.forEach(s => {
      tree[s.value] = { count: 0, billingStatuses: {} };
    });

    globalFilteredJobOrders.forEach((job: JobOrder) => {
      let onsite = (job.Onsite_Status || job.onsite_status || '').toLowerCase().trim();

      // Normalize onsite status
      if (onsite === 'completed' || onsite === 'finish' || onsite === 'done') onsite = 'done';
      else if (onsite === 'in progress' || onsite === 'inprogress') onsite = 'inprogress';
      else if (onsite === 'cancelled' || onsite === 'failed') onsite = 'failed';
      else if (onsite === 'reschedule') onsite = 'reschedule';
      else onsite = 'empty';

      if (tree[onsite]) {
        tree[onsite].count++;
        const billing = job.billing_status || job.Billing_Status || 'Pending';
        const brgy = job.Barangay || job.barangay || 'No Barangay';

        if (!tree[onsite].billingStatuses[billing]) {
          tree[onsite].billingStatuses[billing] = { count: 0, barangays: {} };
        }
        tree[onsite].billingStatuses[billing].count++;
        tree[onsite].billingStatuses[billing].barangays[brgy] = (tree[onsite].billingStatuses[billing].barangays[brgy] || 0) + 1;
      }
    });

    return {
      items: statuses.map(s => ({
        id: `status:${s.value}`,
        name: s.name,
        count: tree[s.value].count,
        billingStatuses: Object.entries(tree[s.value].billingStatuses).sort().map(([bName, bData]) => ({
          id: `status:${s.value}:billing:${bName}`,
          name: bName,
          count: bData.count,
          barangays: Object.entries(bData.barangays).sort().map(([brgyName, brgyCount]) => ({
            id: `status:${s.value}:billing:${bName}:brgy:${brgyName}`,
            name: brgyName,
            count: brgyCount
          }))
        }))
      })),
      total: globalFilteredJobOrders.length
    };
  }, [globalFilteredJobOrders]);

  const sortedJobOrders = useMemo(() => {
    let filtered = globalFilteredJobOrders.filter((jobOrder: JobOrder) => {
      if (selectedLocation === 'all') return true;

      if (selectedLocation.startsWith('status:')) {
        const parts = selectedLocation.split(':');
        const onsiteValue = parts[1];
        let appOnsite = (jobOrder.Onsite_Status || jobOrder.onsite_status || '').toLowerCase().trim();

        if (appOnsite === 'completed' || appOnsite === 'finish' || appOnsite === 'done') appOnsite = 'done';
        else if (appOnsite === 'in progress' || appOnsite === 'inprogress') appOnsite = 'inprogress';
        else if (appOnsite === 'cancelled' || appOnsite === 'failed') appOnsite = 'failed';
        else if (appOnsite === 'reschedule') appOnsite = 'reschedule';
        else appOnsite = 'empty';

        if (appOnsite !== onsiteValue) return false;

        // Check sub-billing status
        if (parts.length > 2 && parts[2] === 'billing') {
          const billingValue = parts[3];
          const recordBilling = jobOrder.billing_status || jobOrder.Billing_Status || 'Pending';
          if (recordBilling !== billingValue) return false;

          // Check sub-barangay
          if (parts.length > 4 && parts[4] === 'brgy') {
            const brgyName = parts[5];
            const recordBrgy = jobOrder.Barangay || jobOrder.barangay || 'No Barangay';
            if (recordBrgy !== brgyName) return false;
          }
        }
        return true;
      }
      return true;
    });

    // Technicians read their list in the order they work it: In Progress oldest
    // first, then other active work, with Done / Reschedule / Failed at the end.
    //
    // Agents read theirs by status band — In Progress, then Reschedule, then
    // Failed, with Done last — and newest first inside each band, so the visits
    // still happening lead and the finished installations sit at the bottom.
    //
    // Every other role keeps the newest-first default untouched.
    //
    // The sort keys are worked out once per job order and remembered, rather
    // than inside the comparator: a comparator runs O(n log n) times, so parsing
    // each timestamp there meant parsing the same handful of dates over and over
    // — thousands of Date constructions to order a few hundred rows. The band an
    // agent's row falls in is cached the same way.
    const timeKeys = new Map<JobOrder, number>();
    const timeOf = (jo: JobOrder): number => {
      let key = timeKeys.get(jo);
      if (key === undefined) {
        key = new Date(getVal(jo, 'timestamp') || 0).getTime();
        timeKeys.set(jo, key);
      }
      return key;
    };

    const idKeys = new Map<JobOrder, number>();
    const idOf = (jo: JobOrder): number => {
      let key = idKeys.get(jo);
      if (key === undefined) {
        key = parseInt(String(jo.id)) || 0;
        idKeys.set(jo, key);
      }
      return key;
    };

    const byRecency = (a: JobOrder, b: JobOrder) => {
      const timeA = timeOf(a);
      const timeB = timeOf(b);
      if (timeA !== timeB) return timeB - timeA;
      return idOf(b) - idOf(a);
    };

    const presorted = isTechnician
      ? sortJobOrdersForTechnician(filtered)
      : isAgentViewer
        ? (() => {
          const bands = new Map<JobOrder, number>();
          for (const jo of filtered) bands.set(jo, agentJobOrderBand(jo));

          return [...filtered].sort((a, b) => {
            const bandA = bands.get(a) ?? 0;
            const bandB = bands.get(b) ?? 0;
            if (bandA !== bandB) return bandA - bandB;
            return byRecency(a, b);
          });
        })()
        : [...filtered].sort(byRecency);

    if (sortColumn) {
      return [...presorted].sort((a, b) => {
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
    return presorted;
  }, [globalFilteredJobOrders, selectedLocation, sortColumn, sortDirection, isTechnician, isAgentViewer]);

  /**
   * The job orders a technician may not open yet.
   *
   * Built from their whole accessible set — the API already scopes it to them —
   * and NOT from the filtered or paginated view, so searching, filtering or
   * paging can never change which job order counts as the oldest.
   */
  const technicianLockedIds = useMemo(() => {
    if (!isTechnician) return new Set<string>();
    return buildTechnicianLockedJobOrderIds(accessibleJobOrders);
  }, [isTechnician, accessibleJobOrders]);

  const isJobOrderLocked = (jobOrder: JobOrder): boolean =>
    technicianLockedIds.has(String(jobOrder.id));

  const currentJobOrderIndex = useMemo(() => {
    if (!selectedJobOrder || !sortedJobOrders) return -1;
    return sortedJobOrders.findIndex(r => r.id === selectedJobOrder.id);
  }, [sortedJobOrders, selectedJobOrder]);

  // Record-to-record navigation skips whatever the viewer cannot open, so the
  // arrows never land on a locked job order — and read as disabled once there is
  // nothing left to reach in that direction.
  const nextOpenRecordIndex = (step: 1 | -1): number => {
    if (currentJobOrderIndex < 0) return -1;
    for (let i = currentJobOrderIndex + step; i >= 0 && i < sortedJobOrders.length; i += step) {
      if (!isJobOrderLocked(sortedJobOrders[i])) return i;
    }
    return -1;
  };

  const previousRecordIndex = nextOpenRecordIndex(-1);
  const nextRecordIndex = nextOpenRecordIndex(1);

  const handlePreviousRecord = () => {
    if (previousRecordIndex >= 0) {
      handleRowClick(sortedJobOrders[previousRecordIndex]);
    }
  };

  const handleNextRecord = () => {
    if (nextRecordIndex >= 0) {
      handleRowClick(sortedJobOrders[nextRecordIndex]);
    }
  };

  // Derived paginated records
  const paginatedJobOrders = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedJobOrders.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedJobOrders, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedJobOrders.length / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleLocationSelect = (locationId: string) => {
    setSelectedLocation(locationId);
    if (window.innerWidth < 768) {
      setMobileViewMode('list');
    }
  };


  const handleMobileRowClick = async (jobOrder: JobOrder) => {
    setSelectedJobOrder(jobOrder);

    // Broadcast that this user started viewing this record
    try {
      await apiClient.post('/job-orders/broadcast-viewing', {
        job_order_id: jobOrder.id,
        action: 'started_viewing'
      });
    } catch (err: any) {
      console.error('[Presence] Failed to broadcast viewing (Mobile):', err);
      if (err.response) {
        console.error('[Presence] Mobile Row Error response data:', err.response.data);
      }
    }
  };

  const handleRowClick = async (jobOrder: JobOrder) => {
    setSelectedJobOrder(jobOrder);

    // Broadcast that this user started viewing this record
    try {
      await apiClient.post('/job-orders/broadcast-viewing', {
        job_order_id: jobOrder.id,
        action: 'started_viewing'
      });
    } catch (err: any) {
      console.error('[Presence] Failed to broadcast viewing:', err);
      if (err.response) {
        console.error('[Presence] Row Click Error response data:', err.response.data);
      }
    }
  };

  const handleCloseDetails = async () => {
    if (selectedJobOrder) {
      try {
        await apiClient.post('/job-orders/broadcast-viewing', {
          job_order_id: selectedJobOrder.id,
          action: 'stopped_viewing'
        });
      } catch (err: any) {
        if (err.response) {
          console.error('[Presence] Error response data:', err.response.data);
        }
      }
    }
    setSelectedJobOrder(null);
  };

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns((prev: string[]) => {
      const next = prev.includes(columnKey)
        ? prev.filter((key: string) => key !== columnKey)
        : [...prev, columnKey];
      localStorage.setItem('jobOrderVisibleColumns', JSON.stringify(next));
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map(col => col.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('jobOrderVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('jobOrderVisibleColumns', JSON.stringify([]));
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

  const filteredColumns = allColumns
    .filter(col => visibleColumns.includes(col.key))
    .sort((a, b) => {
      const indexA = columnOrder.indexOf(a.key);
      const indexB = columnOrder.indexOf(b.key);
      return indexA - indexB;
    });

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
    localStorage.setItem('jobOrderColumnOrder', JSON.stringify(newOrder));
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

      setColumnWidths((prev: Record<string, number>) => ({
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

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setMobileViewMode('list');
      } else {
        const authData = localStorage.getItem('authData');
        let landOnList = false;
        if (authData) {
          try {
            const userData = JSON.parse(authData);
            const isTech = userData.role?.toLowerCase() === 'technician' || String(userData.role_id) === '2';
            // Technicians and agents go straight to their records on a phone — the same
            // as the mobile app, where neither role sees the filter panel first. Agents
            // can still reach the filters via the toolbar button.
            landOnList = isTech || isAgentUser(userData.role, userData.role_id);
          } catch {}
        }
        setMobileViewMode(landOnList ? 'list' : 'sidebar');
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isMobile && (dateInstalledFrom || dateInstalledTo)) {
      setMobileViewMode('list');
    }
  }, [dateInstalledFrom, dateInstalledTo, isMobile]);

  const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarStartXRef.current = e.clientX;
    sidebarStartWidthRef.current = sidebarWidth;
  };

  const getValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'string' && value.trim().toLowerCase() === 'null') return '-';
    return value;
  };

  const renderCellValue = (jobOrder: JobOrder, columnKey: string): React.ReactNode => {
    switch (columnKey) {
      case 'timestamp':
        return formatDateTime(jobOrder.Timestamp || jobOrder.timestamp);
      case 'dateInstalled':
        return formatOnlyDate(jobOrder.Date_Installed || jobOrder.date_installed);
      case 'installationFee':
        return formatPrice(jobOrder.Installation_Fee || jobOrder.installation_fee);
      case 'billingDay':
        const billingDay = jobOrder.Billing_Day ?? jobOrder.billing_day;
        if (billingDay === null || billingDay === undefined) return '-';
        const dayValue = Number(billingDay);
        if (isNaN(dayValue)) return '-';
        return dayValue === 0 ? String(getLastDayOfMonth()) : String(dayValue);
      case 'billingStatus':
        return <StatusText status={jobOrder.billing_status || jobOrder.Billing_Status} type="billing" />;
      case 'modemRouterSN':
        return getValue(jobOrder.Modem_Router_SN || jobOrder.modem_router_sn);
      case 'routerModel':
        return getValue(jobOrder.Router_Model || jobOrder.router_model);
      case 'groupName':
        return getValue(jobOrder.group_name || jobOrder.Group_Name);
      case 'lcpnap':
        return getValue(jobOrder.LCPNAP || jobOrder.lcpnap);
      case 'port':
        return getValue(jobOrder.PORT || jobOrder.Port || jobOrder.port);
      case 'vlan':
        return getValue(jobOrder.VLAN || jobOrder.vlan);
      case 'username':
        return getValue(jobOrder.Username || jobOrder.username);
      case 'ipAddress':
        return getValue(jobOrder.IP_Address || jobOrder.ip_address || jobOrder.IP || jobOrder.ip);
      case 'connectionType':
        return getValue(jobOrder.Connection_Type || jobOrder.connection_type);
      case 'usageType':
        return getValue(jobOrder.Usage_Type || jobOrder.usage_type);
      case 'usernameStatus':
        return getValue(jobOrder.username_status || jobOrder.Username_Status);
      case 'visitBy':
        return getValue(jobOrder.Visit_By || jobOrder.visit_by);
      case 'visitWith':
        return getValue(jobOrder.Visit_With || jobOrder.visit_with);
      case 'visitWithOther':
        return getValue(jobOrder.Visit_With_Other || jobOrder.visit_with_other);
      case 'onsiteStatus':
        return <StatusText status={jobOrder.Onsite_Status || jobOrder.onsite_status} type="onsite" />;
      case 'onsiteRemarks':
        return getValue(jobOrder.Onsite_Remarks || jobOrder.onsite_remarks);
      case 'statusRemarks':
        return getValue(jobOrder.Status_Remarks || jobOrder.status_remarks);
      case 'addressCoordinates':
        return getValue(jobOrder.Address_Coordinates || jobOrder.address_coordinates);
      case 'contractLink':
        return getValue(jobOrder.Contract_Link || jobOrder.contract_link);
      case 'clientSignatureUrl':
        return getValue(
          jobOrder.client_signature_url ||
          jobOrder.Client_Signature_URL ||
          jobOrder.client_signature_image_url ||
          jobOrder.Client_Signature_Image_URL
        );
      case 'setupImageUrl':
        return getValue(
          jobOrder.setup_image_url ||
          jobOrder.Setup_Image_URL ||
          jobOrder.Setup_Image_Url
        );
      case 'speedtestImageUrl':
        return getValue(
          jobOrder.speedtest_image_url ||
          jobOrder.Speedtest_Image_URL ||
          jobOrder.speedtest_image ||
          jobOrder.Speedtest_Image
        );
      case 'signedContractImageUrl':
        return getValue(
          jobOrder.signed_contract_image_url ||
          jobOrder.Signed_Contract_Image_URL ||
          jobOrder.signed_contract_url ||
          jobOrder.Signed_Contract_URL
        );
      case 'boxReadingImageUrl':
        return getValue(
          jobOrder.box_reading_image_url ||
          jobOrder.Box_Reading_Image_URL ||
          jobOrder.box_reading_url ||
          jobOrder.Box_Reading_URL
        );
      case 'routerReadingImageUrl':
        return getValue(
          jobOrder.router_reading_image_url ||
          jobOrder.Router_Reading_Image_URL ||
          jobOrder.router_reading_url ||
          jobOrder.Router_Reading_URL
        );
      case 'portLabelImageUrl':
        return getValue(
          jobOrder.port_label_image_url ||
          jobOrder.Port_Label_Image_URL ||
          jobOrder.port_label_url ||
          jobOrder.Port_Label_URL
        );
      case 'houseFrontPictureUrl':
        return getValue(
          jobOrder.house_front_picture_url ||
          jobOrder.House_Front_Picture_URL ||
          jobOrder.house_front_picture ||
          jobOrder.House_Front_Picture
        );
      case 'createdAt':
        return formatDateTime(jobOrder.created_at || jobOrder.Created_At);
      case 'createdByUserEmail':
        return getValue(jobOrder.created_by_user_email || jobOrder.Created_By_User_Email);
      case 'updatedAt':
        return formatDateTime(jobOrder.updated_at || jobOrder.Updated_At);
      case 'updatedByUserEmail':
        return getValue(jobOrder.updated_by_user_email || jobOrder.Updated_By_User_Email);
      case 'assignedEmail':
        const assignEmail = jobOrder.Assigned_Email || jobOrder.assigned_email || '';
        if (!assignEmail) return '-';
        const assignedUser = users.find(u => (u.email_address || '').toLowerCase() === assignEmail.toLowerCase());
        if (assignedUser) {
          const fullName = [
            assignedUser.first_name || '',
            assignedUser.middle_initial ? `${assignedUser.middle_initial}.` : '',
            assignedUser.last_name || ''
          ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
          return fullName || assignEmail;
        }
        return assignEmail;
      case 'pppoeUsername':
        return getValue(jobOrder.PPPoE_Username || jobOrder.pppoe_username);
      case 'pppoePassword':
        return getValue(jobOrder.PPPoE_Password || jobOrder.pppoe_password);
      case 'fullName':
        return getClientFullName(jobOrder);
      case 'address':
        return getClientFullAddress(jobOrder);
      case 'contractTemplate':
        return getValue(jobOrder.Contract_Template || jobOrder.contract_template);
      case 'modifiedBy':
        return getValue(jobOrder.Modified_By || jobOrder.modified_by);
      case 'modifiedDate':
        return formatDateTime(jobOrder.Modified_Date || jobOrder.modified_date);
      case 'firstName':
        return getValue(jobOrder.First_Name || jobOrder.first_name);
      case 'middleInitial':
        return getValue(jobOrder.Middle_Initial || jobOrder.middle_initial);
      case 'lastName':
        return getValue(jobOrder.Last_Name || jobOrder.last_name);
      case 'contactNumber':
        return getValue(jobOrder.Contact_Number || jobOrder.Mobile_Number || jobOrder.contact_number || jobOrder.mobile_number);
      case 'secondContactNumber':
        return getValue(jobOrder.Second_Contact_Number || jobOrder.Secondary_Mobile_Number || jobOrder.second_contact_number || jobOrder.secondary_mobile_number);
      case 'emailAddress':
        return getValue(jobOrder.Email_Address || jobOrder.Applicant_Email_Address || jobOrder.email_address || jobOrder.applicant_email_address);
      case 'region':
        return getValue(jobOrder.Region || jobOrder.region);
      case 'city':
        return getValue(jobOrder.City || jobOrder.city);
      case 'barangay':
        return getValue(jobOrder.Barangay || jobOrder.barangay);
      case 'location':
        return getValue(jobOrder.Location || jobOrder.location);

      case 'choosePlan':
        return getValue(jobOrder.Choose_Plan || jobOrder.Desired_Plan || jobOrder.choose_plan || jobOrder.desired_plan);
      case 'referredBy':
        return getValue(jobOrder.Referred_By || jobOrder.referred_by);
      case 'startTimestamp':
        return formatDateTime(jobOrder.StartTimeStamp || jobOrder.start_timestamp || jobOrder.start_time);
      case 'endTimestamp':
        return formatDateTime(jobOrder.EndTimeStamp || jobOrder.end_timestamp || jobOrder.end_time);
      case 'duration':
        const start = jobOrder.start_time || jobOrder.StartTimeStamp || jobOrder.start_timestamp;
        const end = jobOrder.end_time || jobOrder.EndTimeStamp || jobOrder.end_timestamp;
        return getValue(calculateDuration(start, end));
    }
  };

  const handleExport = () => {
    if (!sortedJobOrders || sortedJobOrders.length === 0) return;

    const exportColumns = allColumns
      .filter(col => visibleColumns.includes(col.key))
      .sort((a, b) => {
        const indexA = columnOrder.indexOf(a.key);
        const indexB = columnOrder.indexOf(b.key);
        return indexA - indexB;
      });

    exportToCSV('job_orders_export', exportColumns, sortedJobOrders, renderCellValue);
  };

  const renderCellDisplay = (jobOrder: JobOrder, columnKey: string) => {
    if (columnKey === 'fullName') {
      const viewersForJO = viewers[String(jobOrder.id)] || [];
      return (
        <div className="flex flex-col">
          <span className="font-medium">{renderCellValue(jobOrder, columnKey)}</span>
          {viewersForJO.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {viewersForJO.map((username: string) => (
                <span 
                  key={username} 
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse lowercase shadow-sm"
                  style={{
                    backgroundColor: colorPalette?.primary || '#7c3aed',
                    color: isDarkMode ? '#111827' : '#ffffff'
                  }}
                >
                  {username} is viewing
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }
    return renderCellValue(jobOrder, columnKey);
  };

  return (
    <div className={`${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      } h-full flex flex-col md:flex-row overflow-hidden relative`}>


      {/* Sidebar */}
      {userRole.toLowerCase() !== 'technician' && (
        <div
          className={`${
            mobileViewMode === 'sidebar' ? 'flex w-full' : 'hidden'
          } md:flex border-r flex-shrink-0 flex-col relative ${
            isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`}
          style={!isMobile ? { width: `${sidebarWidth}px` } : undefined}
        >
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-center mb-1">
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Job Orders
              </h2>
            </div>
          </div>

          {/* Date Range Filter Section */}
          <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Date Installed Range
              </span>
              {(dateInstalledFrom || dateInstalledTo) && (
                <button
                  onClick={() => {
                    setDateInstalledFrom('');
                    setDateInstalledTo('');
                  }}
                  className="text-[10px] font-bold uppercase tracking-wider hover:underline"
                  style={{ color: colorPalette?.primary || '#7c3aed' }}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>From</label>
                <input
                  type="date"
                  value={dateInstalledFrom}
                  onChange={(e) => setDateInstalledFrom(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={dateInstalledFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
              <div className="relative">
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                <input
                  type="date"
                  value={dateInstalledTo}
                  onChange={(e) => setDateInstalledTo(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={dateInstalledTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* All Level */}
            <button
              onClick={() => {
                setSelectedLocation('all');
                if (isMobile) {
                  setMobileViewMode('list');
                }
              }}
              className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${
                isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
              }`}
              style={selectedLocation === 'all' ? {
                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                color: colorPalette?.primary || '#7c3aed',
                fontWeight: 500
              } : {
                color: isDarkMode ? '#d1d5db' : '#374151'
              }}
            >
              <div className="flex items-center">
                <span>All Job Orders</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-xs transition-colors ${selectedLocation === 'all'
                  ? 'text-white'
                  : isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'
                  }`}
                style={selectedLocation === 'all' ? {
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                {statusItems.total}
              </span>
            </button>

            {/* Status Items */}
            {statusItems.items.map((status) => {
              const isSelected = selectedLocation === status.id || selectedLocation.startsWith(`${status.id}:`);
              const isExpanded = expandedStatuses.has(status.id);
              const getStatusColor = (val: string) => {
                switch (val) {
                  case 'done': return 'text-green-500';
                  case 'failed': return 'text-red-500';
                  case 'inprogress': return 'text-blue-500';
                  case 'reschedule': return 'text-purple-500';
                  case 'empty': return 'text-gray-500';
                  default: return 'text-gray-500';
                }
              };
              const statusValue = status.id.split(':')[1];

              return (
                <div key={status.id}>
                  <button
                    onClick={() => {
                      setSelectedLocation(status.id);
                      if (isMobile) {
                        setMobileViewMode('list');
                      }
                    }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                      }`}
                    style={selectedLocation === status.id ? {
                      backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                      color: colorPalette?.primary || '#7c3aed'
                    } : {}}
                  >
                    <div className="flex items-center flex-1">
                      <div className={`h-2.5 w-2.5 rounded-full mr-3 ${getStatusColor(statusValue).replace('text-', 'bg-')}`} />
                      <span className={`font-medium ${selectedLocation === status.id ? '' : isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{status.name}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {status.count > 0 && (
                        <span className={`px-2 py-0.5 rounded text-xs transition-colors ${selectedLocation === status.id ? 'text-white bg-white/20' : isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'}`}
                          style={selectedLocation === status.id ? {
                            backgroundColor: colorPalette?.primary || '#7c3aed'
                          } : {}}>
                          {status.count}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedStatuses(prev => {
                            const next = new Set(prev);
                            if (next.has(status.id)) next.delete(status.id);
                            else next.add(status.id);
                            return next;
                          });
                        }}
                        className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className={`h-4 w-4 ${selectedLocation === status.id ? 'text-current' : 'text-gray-400'}`} />
                        ) : (
                          <ChevronRight className={`h-4 w-4 ${selectedLocation === status.id ? 'text-current' : 'text-gray-400'}`} />
                        )}
                      </button>
                    </div>
                  </button>

                  {/* Billing Statuses */}
                  {isExpanded && status.billingStatuses.map((billing) => {
                    const isBillingSelected = selectedLocation === billing.id || selectedLocation.startsWith(`${billing.id}:`);
                    const isBillingExpanded = expandedStatuses.has(billing.id);
                    return (
                      <div key={billing.id}>
                        <button
                          onClick={() => {
                            setSelectedLocation(billing.id);
                            if (isMobile) {
                              setMobileViewMode('list');
                            }
                          }}
                          className={`w-full flex items-center justify-between pl-10 pr-4 py-2 text-xs transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                            }`}
                          style={selectedLocation === billing.id ? {
                            backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                            color: colorPalette?.primary || '#7c3aed'
                          } : {
                            color: isDarkMode ? '#9ca3af' : '#4b5563'
                          }}
                        >
                          <span className="truncate flex-1 text-left">{billing.name}</span>
                          <div className="flex items-center space-x-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${selectedLocation === billing.id ? 'text-white bg-white/20' : isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'}`}
                              style={selectedLocation === billing.id ? {
                                backgroundColor: colorPalette?.primary || '#7c3aed'
                              } : {}}>
                              {billing.count}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedStatuses(prev => {
                                  const next = new Set(prev);
                                  if (next.has(billing.id)) next.delete(billing.id);
                                  else next.add(billing.id);
                                  return next;
                                });
                              }}
                              className={`p-0.5 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                            >
                              {isBillingExpanded ? (
                                <ChevronDown className={`h-3.5 w-3.5 ${selectedLocation === billing.id ? 'text-current' : 'text-gray-500'}`} />
                              ) : (
                                <ChevronRight className={`h-3.5 w-3.5 ${selectedLocation === billing.id ? 'text-current' : 'text-gray-500'}`} />
                              )}
                            </button>
                          </div>
                        </button>

                        {/* Barangays */}
                        {isBillingExpanded && billing.barangays.map((brgy) => {
                          const isBrgySelected = selectedLocation === brgy.id;
                          return (
                            <button
                              key={brgy.id}
                              onClick={() => {
                                setSelectedLocation(brgy.id);
                                if (isMobile) {
                                  setMobileViewMode('list');
                                }
                              }}
                              className={`w-full flex items-center justify-between pl-16 pr-4 py-1.5 text-[10px] transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                                }`}
                              style={selectedLocation === brgy.id ? {
                                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                color: colorPalette?.primary || '#7c3aed',
                                fontWeight: 'bold'
                              } : {
                                color: isDarkMode ? '#6b7280' : '#4b5563'
                              }}
                            >
                              <span className="truncate flex-1 text-left">{brgy.name}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${selectedLocation === brgy.id ? 'text-white bg-white/20' : isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400'}`}
                                style={selectedLocation === brgy.id ? {
                                  backgroundColor: colorPalette?.primary || '#7c3aed'
                                } : {}}>
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
            })}
          </div>

          {/* View Records Button for mobile */}
          {isMobile && (
            <div className={`p-4 border-t flex-shrink-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMobileViewMode('list');
                }}
                className="w-full py-2 px-4 rounded text-white text-xs font-semibold"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              >
                View Records
              </button>
            </div>
          )}

          {/* Resize Handle for desktop */}
          {!isMobile && (
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-10"
              onMouseDown={handleMouseDownSidebarResize}
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
            />
          )}
        </div>
      )}

      {/* Main Content */}
      <div className={`${
        mobileViewMode === 'list' || !isMobile || userRole.toLowerCase() === 'technician' ? 'flex-1 flex flex-col' : 'hidden'
      } overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
        <div className="flex flex-col h-full">
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center justify-between space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
              <div className="flex items-center space-x-3 flex-1 min-w-[250px] flex-shrink-0">
                {userRole.toLowerCase() !== 'technician' && mobileViewMode === 'list' && (
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
                <div className="flex-1 w-full flex-shrink-0">
                  <GlobalSearch 
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    isDarkMode={isDarkMode}
                    colorPalette={colorPalette}
                    placeholder="Search job orders..."
                  />
                </div>
              </div>
              <div className="flex items-center space-x-2 flex-shrink-0">
                <button
                  onClick={() => setIsFunnelFilterOpen(true)}
                  title={activeFilters && Object.keys(activeFilters).length > 0
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
                      return colName;
                    }).join('\n')}`
                    : "Filter Job Orders"
                  }
                  className={`flex-shrink-0 px-4 py-2 rounded text-sm transition-colors flex items-center ${activeFilters && Object.keys(activeFilters).length > 0
                    ? 'text-red-500 hover:bg-red-500/10'
                    : isDarkMode
                      ? 'hover:bg-gray-700 text-white'
                      : 'hover:bg-gray-200 text-gray-900'
                    }`}
                >
                  <Filter className="h-5 w-5" />
                </button>
                {!(userRole.toLowerCase() === 'agent' || String(roleId) === '4') && displayMode === 'table' && (
                  <div className="relative z-50 flex-shrink-0" ref={filterDropdownRef}>
                    <button
                      ref={columnBtnRef}
                      className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                        ? 'hover:bg-gray-800 text-white'
                        : 'hover:bg-gray-100 text-gray-900'
                        }`}
                      onClick={() => {
                        if (!filterDropdownOpen && columnBtnRef.current) {
                          const r = columnBtnRef.current.getBoundingClientRect();
                          setColumnMenuPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
                        }
                        setFilterDropdownOpen(!filterDropdownOpen);
                      }}
                      title="Column Visibility"
                    >
                      <Columns3 className="h-5 w-5" />
                    </button>
                    {filterDropdownOpen && (
                      <>
                        {/* Mobile Overlay */}
                        <div className="md:hidden fixed inset-0 z-50">
                          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setFilterDropdownOpen(false)} />
                          <div className={`absolute inset-x-4 top-20 bottom-4 border rounded shadow-lg flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                            }`}>
                            <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                              }`}>
                              <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                                }`}>
                                Column Visibility
                              </span>
                              <button
                                onClick={() => setFilterDropdownOpen(false)}
                                className={isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}
                              >
                                <X className="h-5 w-5" />
                              </button>
                            </div>
                            <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                              }`}>
                              <button
                                onClick={handleSelectAllColumns}
                                className="text-sm px-3 py-1 rounded transition-colors"
                                style={{
                                  color: colorPalette?.primary || '#7c3aed',
                                  backgroundColor: isDarkMode ? '#374151' : '#e5e7eb'
                                }}
                              >
                                Select All
                              </button>
                              <button
                                onClick={handleDeselectAllColumns}
                                className="text-sm px-3 py-1 rounded transition-colors"
                                style={{
                                  color: colorPalette?.primary || '#7c3aed',
                                  backgroundColor: isDarkMode ? '#374151' : '#e5e7eb'
                                }}
                              >
                                Deselect All
                              </button>
                            </div>
                            <div className="overflow-y-auto flex-1">
                              {allColumns.map((column) => (
                                <label
                                  key={column.key}
                                  className={`flex items-center px-4 py-3 cursor-pointer text-sm border-b ${isDarkMode
                                    ? 'hover:bg-gray-700 text-white border-gray-700'
                                    : 'hover:bg-gray-100 text-gray-900 border-gray-200'
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
                                    style={{ accentColor: colorPalette?.primary || '#7c3aed' }}
                                  />
                                  <span>{column.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Desktop Dropdown */}
                        <div
                          style={{ top: columnMenuPos?.top ?? 0, right: columnMenuPos?.right ?? 8 }}
                          className={`hidden md:flex fixed w-80 border rounded shadow-lg z-[100] max-h-96 flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                          }`}>
                          <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                            }`}>
                            <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                              }`}>
                              Column Visibility
                            </span>
                            <div className="flex space-x-2">
                              <button
                                onClick={handleSelectAllColumns}
                                className="text-xs transition-colors"
                                style={{
                                  color: colorPalette?.primary || '#7c3aed'
                                }}
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
                              <span className="text-gray-600">|</span>
                              <button
                                onClick={handleDeselectAllColumns}
                                className="text-xs transition-colors"
                                style={{
                                  color: colorPalette?.primary || '#7c3aed'
                                }}
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
                                  className={`mr-3 h-4 w-4 rounded ${isDarkMode ? 'border-gray-600 bg-gray-700 focus:ring-offset-gray-800' : 'border-gray-300 bg-white focus:ring-offset-white'}`}
                                  style={{ accentColor: colorPalette?.primary || '#7c3aed' }}
                                />
                                <span>{column.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div className="relative z-50 flex-shrink-0" ref={dropdownRef}>
                  <button
                    ref={viewBtnRef}
                    className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                      ? 'hover:bg-gray-800 text-white'
                      : 'hover:bg-gray-100 text-gray-900'
                      }`}
                    onClick={() => {
                      if (!dropdownOpen && viewBtnRef.current) {
                        const r = viewBtnRef.current.getBoundingClientRect();
                        setViewMenuPos({ top: r.bottom + 4, left: r.left });
                      }
                      setDropdownOpen(!dropdownOpen);
                    }}
                  >
                    <span>{displayMode === 'card' ? 'Card' : 'Table'}</span>
                    <ChevronDown className="w-4 h-4 ml-1" />
                  </button>
                  {dropdownOpen && (
                    <div
                      style={{ top: viewMenuPos?.top ?? 0, left: viewMenuPos?.left ?? 0 }}
                      className={`fixed w-36 border rounded shadow-lg z-[100] ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                      }`}>
                      <button
                        onClick={() => {
                          chooseDisplayMode('card');
                          setDropdownOpen(false);
                        }}
                        className={`block w-full text-left px-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                        style={displayMode === 'card' ? {
                          color: colorPalette?.primary || '#7c3aed'
                        } : {
                          color: isDarkMode ? '#ffffff' : '#111827'
                        }}
                      >
                        Card View
                      </button>
                      <button
                        onClick={() => {
                          chooseDisplayMode('table');
                          setDropdownOpen(false);
                        }}
                        className={`block w-full text-left px-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                        style={displayMode === 'table' ? {
                          color: colorPalette?.primary || '#7c3aed'
                        } : {
                          color: isDarkMode ? '#ffffff' : '#111827'
                        }}
                      >
                        Table View
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleExport}
                  disabled={isLoading || sortedJobOrders.length === 0}
                  title="Export to CSV"
                  className="relative flex-shrink-0 p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
                  style={{ 
                    backgroundColor: '#ffffff',
                    borderColor: colorPalette?.primary || '#7c3aed',
                    color: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading && sortedJobOrders.length > 0 && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading && sortedJobOrders.length > 0) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <Download className="h-5 w-5" />
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={isLoading || !isFullyLoaded || isRefreshingManual}
                  title={!isFullyLoaded ? `Loading records... (${jobOrders.length}/${totalCount})` : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
                  className="relative flex-shrink-0 p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
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
                      : String(filter.value);
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
                    localStorage.removeItem('jobOrderFilters');
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
            <div className={`flex-1 ${displayMode === 'table' ? 'overflow-hidden' : 'overflow-y-auto'}`} ref={cardScrollRef}>
              {/* Subtle loading bar when data is partially loaded */}
              {!isFullyLoaded && jobOrders.length > 0 && (
                <div className={`w-full h-1 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'} overflow-hidden`}>
                  <div
                    className="h-full bg-blue-500 animate-pulse"
                    style={{ width: totalCount > 0 ? `${Math.min((jobOrders.length / totalCount) * 100, 95)}%` : '50%', transition: 'width 0.5s ease' }}
                  />
                </div>
              )}
              {((isLoading || isLoadingUsers) && jobOrders.length === 0) ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  <div className="animate-pulse flex flex-col items-center">
                    <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                    <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                  </div>
                  <p className="mt-4">Loading job orders...</p>
                </div>
              ) : error ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'
                  }`}>
                  <p>{error}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className={`mt-4 px-4 py-2 rounded text-white ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-400 hover:bg-gray-500'
                      }`}>
                    Retry
                  </button>
                </div>
              ) : displayMode === 'card' ? (
                paginatedJobOrders.length > 0 ? (
                  <div className="space-y-0">
                    {paginatedJobOrders.map((jobOrder) => {
                      const locked = isJobOrderLocked(jobOrder);
                      return (
                      <div
                        key={jobOrder.id}
                        onClick={() => {
                          if (locked) return;
                          window.innerWidth < 768 ? handleMobileRowClick(jobOrder) : handleRowClick(jobOrder);
                        }}
                        title={locked ? TECHNICIAN_LOCKED_MESSAGE : undefined}
                        aria-disabled={locked}
                        className={`px-4 py-3 transition-colors border-b ${locked
                          ? `cursor-not-allowed opacity-50 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`
                          : `cursor-pointer ${isDarkMode
                            ? `hover:bg-gray-800 border-gray-800 ${selectedJobOrder?.id === jobOrder.id ? 'bg-gray-800' : ''}`
                            : `hover:bg-gray-100 border-gray-200 ${selectedJobOrder?.id === jobOrder.id ? 'bg-gray-100' : ''}`}`
                          }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <div className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                {getClientFullName(jobOrder)}
                              </div>
                              {locked && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                                  Locked
                                </span>
                              )}
                              {(viewers[String(jobOrder.id)] || []).length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {(viewers[String(jobOrder.id)] || []).map((username: string) => (
                                    <span 
                                      key={username}
                                      className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold animate-pulse lowercase shadow-sm`}
                                      style={{ 
                                        backgroundColor: colorPalette?.primary || '#7c3aed',
                                        color: isDarkMode ? '#111827' : '#ffffff'
                                      }}
                                    >
                                      {username} is viewing
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                              }`}>
                              {formatDate(jobOrder.Timestamp || jobOrder.timestamp)} | {getClientFullAddress(jobOrder)}
                            </div>
                          </div>
                          <div className="flex flex-col items-end space-y-1 ml-4 flex-shrink-0">
                            <StatusText status={jobOrder.Onsite_Status || jobOrder.onsite_status} type="onsite" />
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                    No job orders found matching your filters
                  </div>
                )
              ) : (
                <div className="h-full relative flex flex-col">
                  <div className="flex-1 overflow-auto" ref={tableScrollRef}>
                    <table ref={tableRef} className="w-max min-w-full text-sm border-separate border-spacing-0">
                      <thead>
                        <tr className={`border-b sticky top-0 z-10 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-100'
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
                              className={`text-left py-3 px-3 font-normal ${column.width} whitespace-nowrap relative group cursor-move ${isDarkMode
                                ? `text-gray-400 bg-gray-800 ${index < filteredColumns.length - 1 ? 'border-r border-gray-700' : ''}`
                                : `text-gray-600 bg-gray-100 ${index < filteredColumns.length - 1 ? 'border-r border-gray-200' : ''}`
                                } ${draggedColumn === column.key ? 'opacity-50' : ''
                                } ${dragOverColumn === column.key ? '' : ''
                                }`}
                              style={{
                                width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                ...(dragOverColumn === column.key ? {
                                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)'
                                } : {})
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
                                      <ArrowDown
                                        className="h-4 w-4"
                                        style={{
                                          color: colorPalette?.primary || '#7c3aed'
                                        }}
                                      />
                                    ) : (
                                      <ArrowUp
                                        className="h-4 w-4 text-gray-400 transition-colors"
                                        style={{
                                          color: hoveredColumn === column.key ? (colorPalette?.primary || '#7c3aed') : undefined
                                        }}
                                      />
                                    )}
                                  </button>
                                )}
                              </div>
                              {index < filteredColumns.length - 1 && (
                                <div
                                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize group-hover:bg-gray-600"
                                  style={{
                                    backgroundColor: hoveredColumn === column.key ? (colorPalette?.primary || '#7c3aed') : undefined
                                  }}
                                  onMouseDown={(e) => handleMouseDownResize(e, column.key)}
                                />
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedJobOrders.length > 0 ? (
                          paginatedJobOrders.map((jobOrder) => {
                            const locked = isJobOrderLocked(jobOrder);
                            return (
                            <tr
                              key={jobOrder.id}
                              className={`border-b transition-colors ${locked
                                ? `cursor-not-allowed opacity-50 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`
                                : `cursor-pointer ${isDarkMode
                                  ? `border-gray-800 hover:bg-gray-900 ${selectedJobOrder?.id === jobOrder.id ? 'bg-gray-800' : ''}`
                                  : `border-gray-200 hover:bg-gray-100 ${selectedJobOrder?.id === jobOrder.id ? 'bg-gray-100' : ''}`}`
                                }`}
                              title={locked ? TECHNICIAN_LOCKED_MESSAGE : undefined}
                              aria-disabled={locked}
                              onClick={() => {
                                if (locked) return;
                                window.innerWidth < 768 ? handleMobileRowClick(jobOrder) : handleRowClick(jobOrder);
                              }}
                            >
                              {filteredColumns.map((column, index) => {
                                const cellValue = renderCellValue(jobOrder, column.key);
                                return (
                                  <td
                                    key={column.key}
                                    className={`py-4 px-3 ${isDarkMode
                                      ? `text-white ${index < filteredColumns.length - 1 ? 'border-r border-gray-800' : ''}`
                                      : `text-gray-900 ${index < filteredColumns.length - 1 ? 'border-r border-gray-200' : ''}`
                                      }`}
                                    style={{
                                      width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                      maxWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                                    }}
                                  >
                                    <div className="truncate flex items-center justify-between" title={typeof cellValue === 'string' ? cellValue : undefined}>
                                      <span className="truncate">{cellValue}</span>
                                      {column.key === 'fullName' && locked && (
                                        <span className={`ml-2 flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                                          Locked
                                        </span>
                                      )}
                                      {column.key === 'fullName' && viewers[String(jobOrder.id)]?.length > 0 && (
                                        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                                          {viewers[String(jobOrder.id)].map(username => (
                                            <div 
                                              key={username}
                                              className={`flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold animate-pulse shadow-sm lowercase whitespace-nowrap`}
                                              style={{ 
                                                backgroundColor: colorPalette?.primary || '#7c3aed',
                                                color: isDarkMode ? '#111827' : '#ffffff'
                                              }}
                                              title={`${username} is viewing this`}
                                            >
                                              {username} is viewing
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={filteredColumns.length} className={`px-4 py-12 text-center border-b ${isDarkMode ? 'text-gray-400 border-gray-800' : 'text-gray-600 border-gray-200'
                              }`}>
                              {jobOrders.length > 0
                                ? 'No job orders found matching your filters'
                                : 'No job orders found. Create your first job order.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {sortedJobOrders.length > 0 && (
              <div className={`border-t p-3 flex flex-col md:flex-row items-center md:justify-between gap-3 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                <div className={`flex items-center gap-3 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <div className="flex items-center gap-2">
                    <span className="hidden sm:inline">Show</span>
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
                    <span className="hidden sm:inline">entries</span>
                  </div>
                  <span className="hidden sm:inline">
                    Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, sortedJobOrders.length)}</span> of <span className="font-medium">{sortedJobOrders.length}</span> results
                  </span>
                  <span className="sm:hidden text-xs">
                    {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, sortedJobOrders.length)} / {sortedJobOrders.length}
                  </span>
                </div>
                <div className="flex items-center flex-wrap justify-center gap-1">
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
                    className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === 1
                      ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                      : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                      }`}
                  >
                    <ChevronLeft size={16} />
                  </button>

                  <span className={`px-2 text-sm whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {currentPage} / {totalPages || 1}
                  </span>

                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || totalPages <= 1}
                    className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === totalPages || totalPages <= 1
                      ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                      : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                      }`}
                  >
                    <ChevronRight size={16} />
                  </button>

                  <button
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages || totalPages <= 1}
                    className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === totalPages || totalPages <= 1
                      ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                      : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                      }`}
                    title="Last Page"
                  >
                    <ChevronsRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedJobOrder && (
        <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:flex-shrink-0 md:overflow-hidden">
          <JobOrderDetails
            jobOrder={selectedJobOrder}
            isTechnicianLocked={isJobOrderLocked(selectedJobOrder)}
            onClose={handleCloseDetails}
            onRefresh={() => fetchUpdates(technicianEmail)}
            isMobile={isMobile}
            onPrevious={previousRecordIndex >= 0 ? handlePreviousRecord : undefined}
            onNext={nextRecordIndex >= 0 ? handleNextRecord : undefined}
            onExpandSection={handleExpandSection}
          />
        </div>
      )}

      <JobOrderFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters: any) => {
          setActiveFilters(filters);
          localStorage.setItem('jobOrderFilters', JSON.stringify(filters));
          setIsFunnelFilterOpen(false);
          setCurrentPage(1);
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
    </div>
  );
};

export default JobOrderPage;
