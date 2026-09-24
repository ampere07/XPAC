import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FileText, X, Columns3, ArrowUp, ArrowDown, Menu, Filter, RefreshCw, ChevronDown, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Download, Layers } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import ServiceOrderDetails from '../components/ServiceOrderDetails';
import ServiceOrderFunnelFilter, { allColumns as filterColumns } from '../filter/ServiceOrderFunnelFilter';
import SessionExpiredModal from '../components/SessionExpiredModal';
import { useServiceOrderStore, type ServiceOrder } from '../store/serviceOrderStore';
import { barangayService, Barangay } from '../services/barangayService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import pusher from '../services/pusherService';
import apiClient from '../config/api';
import { exportToCSV } from '../utils/exportUtils';
import { userService } from '../services/userService';
import { getUserDisplayName, resolveUserDisplayName } from '../utils/userDisplay';
import { User } from '../types/api';
import { concernsMatch } from '../utils/concernAliases';
import { useViewOptions } from '../hooks/useViewOptions';
import type { GroupableColumn } from '../services/viewOptionsService';
import ViewOptionsModal from '../components/tools/ViewOptionsModal';
import GroupTree from '../components/tools/GroupTree';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};




type DisplayMode = 'card' | 'table';

// Sidebar tree taxonomy. Both the counts and the row filter derive from these, so they cannot
// drift apart the way two hand-written copies of the same if/else chain would.
const BILLING_TYPES = [
  { id: 'prepaid', name: 'Prepaid' },
  { id: 'postpaid', name: 'Postpaid' },
  // Rendered only when it actually holds rows, so the branch totals still add up to the
  // All Service Orders count instead of quietly losing accounts with the field unset.
  { id: 'unspecified', name: '(Unspecified)' }
];

const STATUS_CATEGORIES = [
  { id: 'resolved', name: 'Resolved' },
  { id: 'failed', name: 'Failed' },
  { id: 'inprogress', name: 'In Progress' },
  { id: 'forvisit', name: 'For Visit' },
  { id: 'open', name: 'Open' },
  { id: 'cancelled', name: 'Cancelled' },
  // Catch-all for a support status this list does not name, rendered only when it
  // actually holds rows — the same treatment (Unspecified) gets above, and for the
  // same reason: a status with nowhere to sit was previously dropped from the branch
  // counts entirely, so Prepaid + Postpaid came to less than the All Service Orders
  // total and those rows could not be reached from the sidebar at all.
  { id: 'other', name: '(Other)' }
];

// Mirrors BillingAccount::PREPAID_ALIASES on the backend: production has held 'Pre Paid',
// 'PrePaid' and 'Prepaid', so match with spacing and dashes stripped rather than on an
// exact string.
const resolveBillingType = (generationType?: string): string => {
  const normalized = (generationType || '').toLowerCase().replace(/[\s-]/g, '');
  if (normalized === 'prepaid') return 'prepaid';
  if (normalized === 'postpaid') return 'postpaid';
  return 'unspecified';
};

const resolveStatusCategory = (supportStatus?: string): string => {
  const s = (supportStatus || '').toLowerCase().trim();
  if (s === 'resolved' || s === 'completed') return 'resolved';
  if (s === 'failed') return 'failed';
  if (s === 'in-progress' || s === 'in progress') return 'inprogress';
  if (s === 'for-visit' || s === 'for visit') return 'forvisit';
  if (s === 'pending' || s === 'open') return 'open';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  // Never '': every service order must land in some bucket, or it disappears from
  // the counts while still being included in the total above them.
  return 'other';
};

const resolveVisitKey = (visitStatus?: string): string => {
  const v = (visitStatus || '').toLowerCase().trim();
  let visitKey = v || 'empty';
  if (visitKey === 'completed') visitKey = 'done';
  if (visitKey === 'in progress') visitKey = 'inprogress';
  return visitKey;
};

const allColumns = [
  { key: 'timestamp', label: 'Timestamp', width: 'min-w-40' },
  { key: 'fullName', label: 'Full Name', width: 'min-w-40' },
  { key: 'contactNumber', label: 'Contact Number', width: 'min-w-36' },
  { key: 'fullAddress', label: 'Full Address', width: 'min-w-56' },
  // The three parts of the address as their own sortable columns. Placed next to
  // Full Address, which still shows the whole thing; these are for grouping and
  // sorting by area, which a single concatenated string cannot do.
  { key: 'barangay', label: 'Barangay', width: 'min-w-36' },
  { key: 'city', label: 'City', width: 'min-w-32' },
  { key: 'region', label: 'Region', width: 'min-w-32' },
  { key: 'concern', label: 'Concern', width: 'min-w-36' },
  { key: 'concernRemarks', label: 'Concern Remarks', width: 'min-w-48' },
  { key: 'requestedBy', label: 'Requested By', width: 'min-w-36' },
  { key: 'supportStatus', label: 'Support Status', width: 'min-w-32' },
  { key: 'assignedEmail', label: 'Assigned Tech', width: 'min-w-48' },
  { key: 'repairCategory', label: 'Repair Category', width: 'min-w-36' },
  { key: 'modifiedBy', label: 'Modified By', width: 'min-w-32' },
  { key: 'modifiedDate', label: 'Modified Date', width: 'min-w-40' },
  { key: 'startTime', label: 'Start Time', width: 'min-w-40' },
  { key: 'endTime', label: 'End Time', width: 'min-w-40' },
  { key: 'duration', label: 'Duration', width: 'min-w-28' },
  { key: 'visitStatus', label: 'Visit Status', width: 'min-w-32' }
];

/**
 * Columns added after `serviceOrderVisibleColumns` started being persisted.
 *
 * Anyone who has used the page has a saved array that predates these, so without
 * this they would be hidden for every existing user — the feature would look
 * missing rather than new.
 *
 * Deliberately an explicit list rather than "every key missing from the saved
 * array": a column can be absent because it is new, or because the user switched
 * it off, and those two are indistinguishable from the stored data alone.
 * Treating them alike would silently re-enable Start Time, End Time and Duration,
 * which are hidden by default, and undo anyone's own choices.
 *
 * Add to this list when introducing a column that existing users should see.
 */
const COLUMNS_ADDED_SINCE_LAST_RELEASE = ['barangay', 'city', 'region'];

interface ServiceOrderPageProps {
  /**
   * Service order to open on arrival, sent when a "Service Done" notification is
   * clicked. Empty for ordinary navigation.
   */
  autoOpenServiceOrderId?: string;
}

const ServiceOrderPage: React.FC<ServiceOrderPageProps> = ({ autoOpenServiceOrderId }) => {
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

  const formatDateTime = (dateStr?: string | null): string => {
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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedServiceOrder, setSelectedServiceOrder] = useState<ServiceOrder | null>(null);
  const selectedServiceOrderRef = useRef<ServiceOrder | null>(null);
  const { serviceOrders, isLoading, error, silentRefresh, fetchUpdates, fetchServiceOrders, isFullyLoaded, totalCount } = useServiceOrderStore();
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [agentName, setAgentName] = useState<string>('');
  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(true);
  // service_orders persists the actor as an email string. Built once from the users
  // already loaded for this page, so labelling rows by name costs no extra request.
  const userDirectory = useMemo(() => {
    return users.reduce<Record<string, string>>((directory, user) => {
      const email = (user?.email_address || '').trim().toLowerCase();
      const displayName = getUserDisplayName(user);
      if (email && displayName && displayName.toLowerCase() !== email) {
        directory[email] = displayName;
      }
      return directory;
    }, {});
  }, [users]);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('table');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('serviceOrderVisibleColumns');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Reveal only the columns listed as new — see the constant's note on why
          // this cannot be "everything missing from the saved array". Columns the
          // user switched off stay off.
          const added = COLUMNS_ADDED_SINCE_LAST_RELEASE.filter(key => !parsed.includes(key));

          return added.length > 0 ? [...parsed, ...added] : parsed;
        }
      } catch (err) {
        console.error('Failed to load column visibility:', err);
      }
    }
    return allColumns
      .map(col => col.key)
      .filter(key => key !== 'startTime' && key !== 'endTime' && key !== 'duration');
  });
  const [technicianEmail, setTechnicianEmail] = useState<string | undefined>(undefined);
  const [sortColumn, setSortColumn] = useState<string | null>('timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('serviceOrderColumnOrder');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // A key missing from this list sorts by indexOf() === -1, which would put
          // every newly added column to the far LEFT of the table, ahead of
          // Timestamp. So each one is spliced in behind the neighbour it follows in
          // allColumns — Barangay lands after Full Address rather than at either
          // edge — while any order the user dragged for themselves is preserved.
          const merged = [...parsed];

          allColumns.forEach((col, index) => {
            if (merged.includes(col.key)) return;

            // Walk back to the nearest preceding column already in the list.
            // Iterating allColumns in order means Barangay is placed first, so City
            // then finds Barangay and Region finds City, keeping the three together.
            let insertAt = merged.length;

            for (let prev = index - 1; prev >= 0; prev--) {
              const found = merged.indexOf(allColumns[prev].key);

              if (found !== -1) {
                insertAt = found + 1;
                break;
              }
            }

            merged.splice(insertAt, 0, col.key);
          });

          return merged;
        }
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
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);

  // Download options. The button used to export immediately; it now opens a chooser
  // so the plain row export and the concern summary can live side by side.
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState<boolean>(false);
  const [downloadMode, setDownloadMode] = useState<'default' | 'report'>('default');
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

  const broadCastViewing = useCallback(async (serviceOrderId: string, action: 'started_viewing' | 'stopped_viewing') => {
    try {
      const response = await apiClient.post('/service-orders/broadcast-viewing', {
        service_order_id: serviceOrderId,
        action: action
      });

      if ((response.data as any).success) {
        // Broadcast successful
      } else {
        console.error('[Presence] Failed to broadcast viewing:', (response.data as any).message);
      }
    } catch (error) {
      console.error('[Presence] Error broadcasting viewing:', error);
    }
  }, []);
  const [activeFilters, setActiveFilters] = useState<any>(() => {
    const saved = localStorage.getItem('serviceOrderFilters');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    }
    return {};
  });

  const removeFilter = (key: string) => {
    const newFilters = { ...activeFilters };
    delete newFilters[key];
    setActiveFilters(newFilters);
    localStorage.setItem('serviceOrderFilters', JSON.stringify(newFilters));
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

  // Pagination State - Managed by store
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);


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
  }, [selectedLocation, searchQuery, activeFilters, sortColumn, sortDirection, itemsPerPage]);

  // Scroll to top on page change
  useEffect(() => {
    if (displayMode === 'card' && cardScrollRef.current) {
      cardScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (displayMode === 'table' && tableScrollRef.current) {
      tableScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage, displayMode]);

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
    selectedServiceOrderRef.current = selectedServiceOrder;
  }, [selectedServiceOrder]);

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
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        setUserRole(userData.role || '');
        setRoleId(userData.role_id || null);
        if (userData.role && userData.role.toLowerCase() === 'technician' && userData.email) {
          setTechnicianEmail(userData.email);
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    }
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

  // Fetch lookup data
  useEffect(() => {
    const fetchLookupData = async () => {
      try {
        const [barangaysRes] = await Promise.all([
          barangayService.getAll()
        ]);
        setBarangays(barangaysRes.success ? barangaysRes.data : []);
      } catch (err) {
        console.error('Failed to fetch lookup data:', err);
      }
    };

    fetchLookupData();
  }, []);

  // Reset selected location if regions/cities/barangays change and selected location is no longer valid
  // Reset selected location if regions/cities/barangays change and selected location is no longer valid
  useEffect(() => {
    // Logic removed as it depended on undefined variables. 
    // SelectedLocation is now mainly derived from status which is stable.
  }, [selectedLocation]);

  // Fetch initial data if empty
  useEffect(() => {
    if (serviceOrders.length === 0) {
      fetchServiceOrders();
    }
  }, [fetchServiceOrders, serviceOrders.length]);

  // Real-time updates via Pusher/Soketi
  useEffect(() => {
    const handleUpdate = async (data: any) => {
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
        console.error('[ServiceOrder Soketi] Failed to refresh data:', err);
      }
    };

    const serviceOrderChannel = pusher.subscribe('service-orders');

    serviceOrderChannel.bind('pusher:subscription_succeeded', () => {
    });
    serviceOrderChannel.bind('pusher:subscription_error', (error: any) => {
      console.error('[ServiceOrder Soketi] Subscription error:', error);
    });

    serviceOrderChannel.bind('service-order-updated', handleUpdate);

    // Re-subscribe on reconnection
    const stateHandler = (states: { previous: string; current: string }) => {
      if (states.current === 'connected' && serviceOrderChannel.subscribed !== true) {
        pusher.subscribe('service-orders');
      }
    };
    pusher.connection.bind('state_change', stateHandler);

    return () => {
      serviceOrderChannel.unbind('pusher:subscription_succeeded');
      serviceOrderChannel.unbind('pusher:subscription_error');
      serviceOrderChannel.unbind('service-order-updated', handleUpdate);
      pusher.connection.unbind('state_change', stateHandler);
      pusher.unsubscribe('service-orders');
    };
  }, [technicianEmail, silentRefresh]);

  // Presence channel for knowing who's viewing what
  useEffect(() => {
    const presenceChannel = pusher.subscribe('presence-service-orders-presence');

    presenceChannel.bind('viewing-update', (data: { serviceOrderId: string; username: string; action: string }) => {
      setViewers(prev => {
        const username = data.username;
        const currentViewers = prev[data.serviceOrderId] || [];
        if (data.action === 'started_viewing') {
          if (!currentViewers.includes(username)) {
            return { ...prev, [data.serviceOrderId]: [...currentViewers, username] };
          }
        } else if (data.action === 'stopped_viewing') {
          return { ...prev, [data.serviceOrderId]: currentViewers.filter(name => name !== username) };
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
            newState[id] = (newState[id] || []).filter(name => name !== identifier);
          });
          return newState;
        });
      }
    });

    presenceChannel.bind('pusher:subscription_succeeded', (members: any) => {
    });

    presenceChannel.bind('pusher:member_added', (member: any) => {
      // If we are currently viewing a service order, broadcast it so the new member knows
      if (selectedServiceOrderRef.current) {
        broadCastViewing(String(selectedServiceOrderRef.current.id), 'started_viewing');
      }
    });

    return () => {
      presenceChannel.unbind('viewing-update');
      presenceChannel.unbind('pusher:member_removed');
      presenceChannel.unbind('pusher:subscription_succeeded');
      pusher.unsubscribe('presence-service-orders-presence');
    };
  }, []);

  // Sync viewing status when selectedServiceOrder changes
  useEffect(() => {
    if (selectedServiceOrder) {
      broadCastViewing(String(selectedServiceOrder.id), 'started_viewing');
      
      return () => {
        broadCastViewing(String(selectedServiceOrder.id), 'stopped_viewing');
      };
    }
  }, [selectedServiceOrder, broadCastViewing]);

  // Polling for updates every 3 seconds - Incremental fetch
  useEffect(() => {
    const POLLING_INTERVAL = 3000; // 3 seconds
    const intervalId = setInterval(async () => {
      try {
        await fetchUpdates(technicianEmail);
      } catch (err) {
        console.error('[ServiceOrder Page] Polling failed:', err);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [technicianEmail, fetchUpdates]);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      try {
        await fetchUpdates(technicianEmail);
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
  }, [technicianEmail, silentRefresh, fetchUpdates]);

  // Update selectedServiceOrder with fresh data after refresh
  useEffect(() => {
    if (selectedServiceOrder) {
      const updatedOrder = serviceOrders.find(order => order.id === selectedServiceOrder.id);
      if (updatedOrder && JSON.stringify(updatedOrder) !== JSON.stringify(selectedServiceOrder)) {
        setSelectedServiceOrder(updatedOrder);
      }
    }
  }, [serviceOrders, selectedServiceOrder]);

  const handleRefresh = async () => {
    setIsRefreshingManual(true);
    setHasNewData(false);
    setCurrentPage(1);
    try {
      await fetchServiceOrders(true);
    } finally {
      setIsRefreshingManual(false);
    }
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

  const getVal = useCallback((item: ServiceOrder, key: string): any => {
    switch (key) {
      case 'id': return item.id;
      case 'ticketId': return item.ticketId ?? (item as any).ticket_id ?? '';
      case 'accountNumber': return item.accountNumber ?? (item as any).account_no ?? '';
      case 'fullName': return item.fullName;
      case 'contactNumber': return item.contactNumber;
      case 'emailAddress': return item.emailAddress;
      case 'fullAddress': return item.fullAddress ?? (item as any).full_address ?? '';
      case 'plan': return item.plan;
      case 'username': return item.username ?? (item as any).username ?? '';
      case 'pppoePassword': return item.pppoePassword ?? (item as any).pppoe_password ?? '';
      case 'lcp': return item.lcp;
      case 'nap': return item.nap;
      case 'port': return item.port;
      case 'vlan': return item.vlan;
      case 'oldLcpnap': return item.oldLcpnap;
      case 'newLcp': return item.newLcp;
      case 'newNap': return item.newNap;
      case 'newPort': return item.newPort;
      case 'newVlan': return item.newVlan;
      case 'newLcpnap': return item.newLcpnap;
      case 'supportStatus': return item.supportStatus ?? (item as any).support_status ?? '';
      case 'visitStatus': return item.visitStatus;
      case 'timestamp': return item.timestamp;
      case 'dateInstalled': return item.dateInstalled;
      case 'modifiedBy': return item.modifiedBy ?? (item as any).updated_by_user ?? (item as any).Updated_By_User ?? '';
      case 'modifiedDate': return item.modifiedDate ?? item.rawUpdatedAt ?? (item as any).updated_at ?? (item as any).Updated_At ?? '';
      // Sorted by what the cell shows, so these mirror renderCellValue.
      case 'assignedEmail': return resolveUserDisplayName(item.assignedEmail, userDirectory, '-');
      case 'requestedBy': return resolveUserDisplayName(item.requestedBy, userDirectory);
      case 'serviceCharge': return item.serviceCharge;
      case 'routerModel': return item.routerModel;
      case 'routerModemSN': return item.routerModemSN ?? (item as any).router_modem_sn ?? '';
      case 'referredBy': return item.referredBy;
      case 'status': return item.status;
      case 'billingDay': return item.billingDay ?? (item as any).billing_day ?? '';
      case 'repairCategory': return item.repairCategory ?? (item as any).repair_category ?? '';
      case 'visitRemarks': return item.visitRemarks ?? (item as any).visit_remarks ?? '';
      case 'supportRemarks': return item.supportRemarks ?? (item as any).support_remarks ?? '';
      case 'priorityLevel': return item.priorityLevel ?? (item as any).priority_level ?? '';
      case 'newRouterSn': return item.newRouterSn ?? (item as any).new_router_sn ?? '';
      case 'newPlan': return item.newPlan ?? (item as any).new_plan ?? '';
      case 'contactAddress': return item.contactAddress ?? (item as any).contact_address ?? '';
      case 'provider': return item.provider ?? (item as any).group_name ?? '';
      case 'concern': return item.concern ?? (item as any).concern ?? '';
      case 'concernRemarks': return item.concernRemarks ?? (item as any).concern_remarks ?? '';
      case 'visitBy': return item.visitBy ?? (item as any).visit_by_user ?? '';
      case 'visitWith': return item.visitWith ?? (item as any).visit_with ?? '';
      case 'visitWithOther': return item.visitWithOther ?? (item as any).visit_with_other ?? '';
      case 'houseFrontPicture': return item.houseFrontPicture ?? (item as any).house_front_picture_url ?? '';
      case 'barangay': return item.barangay ?? '';
      case 'city': return item.city ?? '';
      case 'region': return item.region ?? '';
      case 'pulloutRouterModel': return item.pulloutRouterModel ?? '';
      case 'pulloutRouterSN': return item.pulloutRouterSN ?? '';
      case 'nameAddress': return item.nameAddress ?? '';
      case 'usageType': return item.usageType ?? '';
      case 'startTime': return item.start_time;
      case 'endTime': return item.end_time;
      case 'duration': return calculateDuration(item.start_time, item.end_time);
      default: {
        const val = (item as any)[key];
        return val !== undefined && val !== null ? val : '';
      }
    }
  }, [userDirectory]);

  // 1. Initial search and funnel filtering (Global filtered set for sidebar counts)
  const globalFilteredServiceOrders = useMemo(() => {
    const isTechnician = roleId === 2 || userRole.toLowerCase() === 'technician';

    let filtered = serviceOrders.filter(serviceOrder => {
      // Organization filter — only show records matching the current user's org
      if (currentUserOrgId) {
        // User belongs to an org: only show service orders assigned to that same org
        if (serviceOrder.organization_id !== currentUserOrgId) {
          return false;
        }
      } else {
        // User has no org: only show service orders that have no org assigned
        if (serviceOrder.organization_id) {
          return false;
        }
      }

      // 1. Technician 7-Day Filter for 'Resolved' tickets
      if (isTechnician) {
        const supportStatus = (serviceOrder.supportStatus || '').toLowerCase().trim();
        if (supportStatus === 'resolved') {
          const updatedAt = serviceOrder.rawUpdatedAt;
          if (updatedAt) {
            const updatedDate = new Date(updatedAt);
            if (!isNaN(updatedDate.getTime())) {
              const sevenDaysAgo = new Date();
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
              if (updatedDate < sevenDaysAgo) {
                return false;
              }
            }
          }
        }
      }

      // 2. Search filter
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') {
          return Object.values(val).some(v => checkValue(v));
        }
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };

      const matchesSearch = searchQuery === '' || checkValue(serviceOrder);

      // 3. Funnel filter
      let matchesFunnel = true;
      if (activeFilters && Object.keys(activeFilters).length > 0) {
        for (const [key, filter] of Object.entries(activeFilters)) {
          const typedFilter = filter as any;
          const orderValue = getVal(serviceOrder, key);

          if (typedFilter.type === 'text' && typedFilter.value !== undefined && typedFilter.value !== '') {
            if (!String(orderValue || '').toLowerCase().includes(String(typedFilter.value).toLowerCase())) {
              matchesFunnel = false;
              break;
            }
          }
          else if (typedFilter.type === 'number') {
            const numValue = parseFloat(String(orderValue));
            if (!isNaN(numValue)) {
              if (typedFilter.from !== undefined && typedFilter.from !== '' && numValue < parseFloat(typedFilter.from)) {
                matchesFunnel = false;
                break;
              }
              if (typedFilter.to !== undefined && typedFilter.to !== '' && numValue > parseFloat(typedFilter.to)) {
                matchesFunnel = false;
                break;
              }
            } else if ((typedFilter.from !== undefined && typedFilter.from !== '') || (typedFilter.to !== undefined && typedFilter.to !== '')) {
              matchesFunnel = false;
              break;
            }
          }
          else if (typedFilter.type === 'date') {
            if (orderValue) {
              const normalizeDate = (d: any, isEnd: boolean = false) => {
                if (!d) return NaN;
                let s = String(d).trim().replace(' ', 'T');
                if (s.length === 10) {
                  s = isEnd ? `${s}T23:59:59.999` : `${s}T00:00:00`;
                } else if (s.length === 16) {
                  s = isEnd ? `${s}:59.999` : `${s}:00`;
                }
                return new Date(s).getTime();
              };

              const dateValue = normalizeDate(orderValue);
              if (!isNaN(dateValue)) {
                if (typedFilter.from) {
                  const fromDate = normalizeDate(typedFilter.from, false);
                  if (!isNaN(fromDate) && dateValue < fromDate) { matchesFunnel = false; break; }
                }
                if (typedFilter.to) {
                  const toDate = normalizeDate(typedFilter.to, true);
                  if (!isNaN(toDate) && dateValue > toDate) { matchesFunnel = false; break; }
                }
              } else {
                matchesFunnel = false; break;
              }
            } else if (typedFilter.from || typedFilter.to) {
              matchesFunnel = false; break;
            }
          }
          else if (typedFilter.type === 'checklist' && typedFilter.value && Array.isArray(typedFilter.value) && typedFilter.value.length > 0) {
            const normalizedValue = String(orderValue || '').toLowerCase().trim();

            if (key === 'barangay' || key === 'city' || key === 'region') {
              const address = String(serviceOrder.fullAddress || '').toLowerCase();
              const isMatch = typedFilter.value.some((opt: string) => {
                const filterVal = String(opt).toLowerCase().trim();

                // The API now returns barangay/city/region separately, so match the
                // field itself when it has a value. The options come from the same
                // customer columns, so they are exact — and an exact match cannot
                // mistake a barangay for a city that shares its name, which scanning
                // the concatenated address did.
                if (normalizedValue) {
                  return normalizedValue === filterVal;
                }

                // Only for records whose field is blank, where the address text is
                // the sole evidence of where the job is.
                return address.includes(filterVal);
              });
              if (!isMatch) { matchesFunnel = false; break; }
            } else if (key === 'concern') {
              // "For Pullout" and "Pullout" are one concern and the filter offers a
              // single option for them, so the row has to be compared through the same
              // alias — an exact match would return only half of them.
              const isMatch = typedFilter.value.some((opt: string) => concernsMatch(orderValue, opt));
              if (!isMatch) { matchesFunnel = false; break; }
            } else {
              const isMatch = typedFilter.value.some((opt: string) => {
                const filterVal = String(opt).toLowerCase().trim();
                return normalizedValue === filterVal;
              });
              if (!isMatch) { matchesFunnel = false; break; }
            }
          }
        }
      }

      return matchesSearch && matchesFunnel;
    });

    return filtered;
  }, [serviceOrders, searchQuery, activeFilters, userRole, roleId, getVal, currentUserOrgId]);

  const groupableColumns: Array<GroupableColumn<ServiceOrder>> = useMemo(
    () => [
      {
        key: 'billingType',
        label: 'Billing Type',
        value: (row) => {
          const type = resolveBillingType(row.generationType);
          return type === 'prepaid' ? 'Prepaid' : type === 'postpaid' ? 'Postpaid' : '(Unspecified)';
        },
      },
      {
        key: 'supportStatus',
        label: 'Support Status',
        value: (row) => row.supportStatus || '(Blank)',
      },
      {
        key: 'visitStatus',
        label: 'Visit Status',
        value: (row) => row.visitStatus || '(Blank)',
      },
      {
        key: 'assignedEmail',
        label: 'Assigned Tech',
        value: (row) => resolveUserDisplayName(row.assignedEmail, userDirectory, '(Unassigned)'),
      },
      {
        key: 'concern',
        label: 'Concern',
        value: (row) => row.concern || '(Blank)',
      },
      {
        key: 'repairCategory',
        label: 'Repair Category',
        value: (row) => row.repairCategory || '(Blank)',
      },
      {
        key: 'barangay',
        label: 'Barangay',
        value: (row) => row.barangay || '(Blank)',
      },
      {
        key: 'city',
        label: 'City',
        value: (row) => row.city || '(Blank)',
      },
      {
        key: 'region',
        label: 'Region',
        value: (row) => row.region || '(Blank)',
      },
      {
        key: 'requestedBy',
        label: 'Requested By',
        value: (row) => resolveUserDisplayName(row.requestedBy, userDirectory, '(Blank)'),
      },
      {
        key: 'modifiedBy',
        label: 'Modified By',
        value: (row) => resolveUserDisplayName(row.modifiedBy, userDirectory, '(Blank)'),
      },
    ],
    [userDirectory]
  );

  const grouping = useViewOptions('service_orders', groupableColumns, globalFilteredServiceOrders);
  const [isViewOptionsModalOpen, setIsViewOptionsModalOpen] = useState(false);

  // Invalidate selected location when group levels change
  const groupSignature = grouping.options.groupBy.join('|');
  useEffect(() => {
    setSelectedLocation('all');
  }, [groupSignature]);

  const sortSignature = JSON.stringify(grouping.sortRules);
  useEffect(() => {
    if (!grouping.loaded || grouping.sortRules.length === 0) return;
    const first = grouping.sortRules[0];
    if (first) {
      setSortColumn(first.key);
      setSortDirection(first.direction);
    }
  }, [grouping.loaded, sortSignature]);

  const locationItems = useMemo(() => {
    const tree: Record<string, {
      count: number,
      statuses: Record<string, {
        count: number,
        visits: Record<string, {
          count: number,
          barangays: Record<string, number>
        }>
      }>
    }> = {};

    BILLING_TYPES.forEach(g => {
      tree[g.id] = { count: 0, statuses: {} };
      STATUS_CATEGORIES.forEach(c => {
        tree[g.id].statuses[c.id] = { count: 0, visits: {} };
      });
    });

    globalFilteredServiceOrders.forEach(so => {
      const genNode = tree[resolveBillingType(so.generationType)];
      const catNode = genNode.statuses[resolveStatusCategory(so.supportStatus)];

      // The billing type is counted first and unconditionally: its badge has to equal
      // the number of rows clicking it produces, and that must hold even if a status
      // somehow resolves to a category that is not in the list.
      genNode.count++;

      if (!catNode) return;
      catNode.count++;

      const visitKey = resolveVisitKey(so.visitStatus);
      if (!catNode.visits[visitKey]) {
        catNode.visits[visitKey] = { count: 0, barangays: {} };
      }
      const visitNode = catNode.visits[visitKey];
      visitNode.count++;

      const address = (so.fullAddress || '').toLowerCase();
      let matchedBrgy = 'Unknown';
      const foundBrgy = barangays.find(b => address.includes(b.barangay.toLowerCase()));
      if (foundBrgy) {
        matchedBrgy = foundBrgy.barangay;
      }

      visitNode.barangays[matchedBrgy] = (visitNode.barangays[matchedBrgy] || 0) + 1;
    });

    return {
      items: BILLING_TYPES
        .filter(g => g.id !== 'unspecified' || tree[g.id].count > 0)
        .map(g => ({
          id: `gen:${g.id}`,
          name: g.name,
          count: tree[g.id].count,
          statuses: STATUS_CATEGORIES
            .filter(c => c.id !== 'other' || tree[g.id].statuses[c.id].count > 0)
            .map(c => ({
            id: `gen:${g.id}:status:${c.id}`,
            statusId: c.id,
            name: c.name,
            count: tree[g.id].statuses[c.id].count,
            visits: Object.entries(tree[g.id].statuses[c.id].visits).sort().map(([vKey, vData]) => {
              let vName = vKey;
              if (vKey === 'done') vName = 'Done';
              else if (vKey === 'inprogress') vName = 'In Progress';
              else if (vKey === 'reschedule') vName = 'Reschedule';
              else if (vKey === 'empty') vName = '(Empty)';
              else vName = vKey.charAt(0).toUpperCase() + vKey.slice(1);

              return {
                id: `gen:${g.id}:status:${c.id}:visit:${vKey}`,
                name: vName,
                originalKey: vKey,
                count: vData.count,
                barangays: Object.entries(vData.barangays).sort().map(([bName, bCount]) => ({
                  id: `gen:${g.id}:status:${c.id}:visit:${vKey}:brgy:${bName}`,
                  name: bName,
                  count: bCount
                }))
              };
            })
          }))
        })),
      total: globalFilteredServiceOrders.length
    };
  }, [globalFilteredServiceOrders, barangays]);

  const filteredServiceOrders = useMemo(() => {
    let filtered = grouping.isGrouped
      ? grouping.filterByGroup(globalFilteredServiceOrders, selectedLocation)
      : globalFilteredServiceOrders.filter(serviceOrder => {
          if (selectedLocation === 'all') return true;

          // Node ids are the path down the sidebar tree:
          // gen:<billingType>[:status:<category>[:visit:<visitKey>[:brgy:<barangay>]]]
          if (selectedLocation.startsWith('gen:')) {
            const parts = selectedLocation.split(':');

            if (resolveBillingType(serviceOrder.generationType) !== parts[1]) return false;

            if (parts.length > 2 && parts[2] === 'status') {
              if (resolveStatusCategory(serviceOrder.supportStatus) !== parts[3]) return false;

              if (parts.length > 4 && parts[4] === 'visit') {
                if (resolveVisitKey(serviceOrder.visitStatus) !== parts[5]) return false;

                if (parts.length > 6 && parts[6] === 'brgy') {
                  const brgyName = parts[7];
                  const address = (serviceOrder.fullAddress || '').toLowerCase();
                  let matchedBrgy = 'Unknown';
                  const foundBrgy = barangays.find(b => address.includes(b.barangay.toLowerCase()));
                  if (foundBrgy) matchedBrgy = foundBrgy.barangay;

                  if (matchedBrgy !== brgyName) return false;
                }
              }
            }
            return true;
          }
          return false;
        });

    filtered.sort((a, b) => {
      // 1. Prioritize 'timestamp' as requested, fallback to 'createdAt'
      const dateA = a.timestamp || a.createdAt || '';
      const dateB = b.timestamp || b.createdAt || '';
      
      const timeA = dateA ? new Date(dateA).getTime() : 0;
      const timeB = dateB ? new Date(dateB).getTime() : 0;
      
      if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
        return timeB - timeA;
      }
      
      // 2. Fallback to ID comparison (numeric logic to ensure latest ID is first)
      const idA = parseInt(String(a.id).replace(/\D/g, '')) || 0;
      const idB = parseInt(String(b.id).replace(/\D/g, '')) || 0;
      return idB - idA;
    });

    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue = getVal(a, sortColumn);
        let bValue = getVal(b, sortColumn);

        // Special handling for date columns to ensure accurate chronological sorting
        const dateFields = ['timestamp', 'modifiedDate', 'dateInstalled', 'startTime', 'endTime', 'modified_at', 'created_at', 'rawUpdatedAt'];
        if (dateFields.includes(sortColumn)) {
          const timeA = aValue ? new Date(String(aValue).replace(' ', 'T')).getTime() : 0;
          const timeB = bValue ? new Date(String(bValue).replace(' ', 'T')).getTime() : 0;
          
          if (!isNaN(timeA) && !isNaN(timeB)) {
            if (timeA !== timeB) {
              return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
            }
          }
        }

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
  }, [globalFilteredServiceOrders, grouping, selectedLocation, sortColumn, sortDirection, barangays, getVal]);

  // Derived paginated records
  const paginatedServiceOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredServiceOrders.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredServiceOrders, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredServiceOrders.length / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const StatusText = ({ status, type }: { status?: string, type: 'support' | 'visit' }) => {
    if (!status) return <span className="text-gray-400">-</span>;

    let textColor = '';

    if (type === 'support') {
      switch (status.toLowerCase()) {
        case 'resolved':
        case 'completed':
          textColor = 'text-green-400';
          break;
        case 'in-progress':
        case 'in progress':
          textColor = 'text-blue-400';
          break;
        case 'open':
        case 'pending':
          textColor = 'text-orange-400';
          break;
        case 'closed':
        case 'cancelled':
          textColor = 'text-gray-400';
          break;
        default:
          textColor = 'text-gray-400';
      }
    } else {
      switch (status.toLowerCase()) {
        case 'completed':
          textColor = 'text-green-400';
          break;
        // Split out of the blue group: sharing a colour with "In Progress"
        // made the two indistinguishable in the table.
        case 'reschedule':
          textColor = 'text-purple-400';
          break;
        case 'scheduled':
        case 'in progress':
          textColor = 'text-blue-400';
          break;
        case 'pending':
          textColor = 'text-orange-400';
          break;
        case 'cancelled':
        case 'failed':
          textColor = 'text-red-500';
          break;
        default:
          textColor = 'text-gray-400';
      }
    }

    return (
      <span className={`${textColor} font-bold uppercase`}>
        {status === 'in-progress' ? 'In Progress' : status}
      </span>
    );
  };

  const handleRowClick = (serviceOrder: ServiceOrder) => {
    setSelectedServiceOrder(serviceOrder);
  };

  /**
   * Open the service order a notification pointed at.
   *
   * Goes through handleRowClick so it opens exactly as a real click does. Tracked
   * by id so it fires once: without this, closing the panel would reopen it on the
   * next render and the list could never be reached again.
   */
  const autoOpenedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoOpenServiceOrderId) {
      autoOpenedIdRef.current = null;
      return;
    }
    if (autoOpenedIdRef.current === autoOpenServiceOrderId) return;

    const target = serviceOrders.find(order => String(order.id) === String(autoOpenServiceOrderId));

    // Wait for the list rather than fetching separately, so the opened record is the
    // same object the list holds and stays in sync with refreshes.
    if (!target) return;

    autoOpenedIdRef.current = autoOpenServiceOrderId;
    handleRowClick(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenServiceOrderId, serviceOrders]);

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const next = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      localStorage.setItem('serviceOrderVisibleColumns', JSON.stringify(next));
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map(col => col.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('serviceOrderVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('serviceOrderVisibleColumns', JSON.stringify([]));
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
    localStorage.setItem('serviceOrderColumnOrder', JSON.stringify(newOrder));
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

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setMobileViewMode('list');
      } else {
        const authData = localStorage.getItem('authData');
        let isTech = false;
        if (authData) {
          try {
            const userData = JSON.parse(authData);
            isTech = userData.role?.toLowerCase() === 'technician' || String(userData.role_id) === '2';
          } catch {}
        }
        setMobileViewMode(isTech ? 'list' : 'sidebar');
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarStartXRef.current = e.clientX;
    sidebarStartWidthRef.current = sidebarWidth;
  };

  const filteredColumns = allColumns
    .filter(col => visibleColumns.includes(col.key))
    .sort((a, b) => {
      // A key absent from columnOrder sorts last, not first. Raw indexOf returns -1,
      // which would place an unordered column ahead of Timestamp at the left edge.
      // The stored order is migrated on load, so this is a backstop.
      const indexA = columnOrder.indexOf(a.key);
      const indexB = columnOrder.indexOf(b.key);
      return (indexA === -1 ? Infinity : indexA) - (indexB === -1 ? Infinity : indexB);
    });

  const renderCellValue = (serviceOrder: ServiceOrder, columnKey: string) => {
    switch (columnKey) {
      case 'timestamp':
        return serviceOrder.timestamp;
      case 'supportStatus':
        return <StatusText status={serviceOrder.supportStatus} type="support" />;
      case 'visitStatus':
        return <StatusText status={serviceOrder.visitStatus} type="visit" />;
      case 'fullName':
        return (
          <div className="flex items-center space-x-2 overflow-hidden">
            <span className="truncate">{serviceOrder.fullName}</span>
            {viewers[String(serviceOrder.id)] && viewers[String(serviceOrder.id)].length > 0 && (
              <div className="flex flex-wrap gap-1 ml-1 flex-shrink-0">
                {viewers[String(serviceOrder.id)].map((username: string) => (
                  <span 
                    key={username} 
                    className="text-[9px] px-1.5 py-0.5 rounded-full font-bold animate-pulse lowercase shadow-sm"
                    style={{
                      backgroundColor: colorPalette?.primary || '#f97316',
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
      case 'contactNumber':
        return serviceOrder.contactNumber;
      case 'fullAddress':
        return <span title={serviceOrder.fullAddress}>{serviceOrder.fullAddress}</span>;
      case 'concern':
        return serviceOrder.concern;
      case 'concernRemarks':
        return serviceOrder.concernRemarks || '-';
      case 'requestedBy':
        return resolveUserDisplayName(serviceOrder.requestedBy, userDirectory, '-');
      case 'assignedEmail':
        return resolveUserDisplayName(serviceOrder.assignedEmail, userDirectory, '-');
      case 'repairCategory':
        return serviceOrder.repairCategory || '-';
      // Explicit cases are required: the default arm below returns '-', so a column
      // added without one renders an empty table of dashes rather than the data.
      case 'barangay':
        return serviceOrder.barangay || '-';
      case 'city':
        return serviceOrder.city || '-';
      case 'region':
        return serviceOrder.region || '-';
      case 'modifiedBy':
        return serviceOrder.modifiedBy || '-';
      case 'modifiedDate':
        return serviceOrder.modifiedDate;
      case 'startTime':
        return formatDateTime(serviceOrder.start_time);
      case 'endTime':
        return formatDateTime(serviceOrder.end_time);
      case 'duration':
        return calculateDuration(serviceOrder.start_time, serviceOrder.end_time);
      default:
        return '-';
    }
  };

  /**
   * The row-per-service-order export. Unchanged — it is what the Download button
   * has always produced, and is still the default choice in the chooser.
   */
  const exportDefaultCsv = () => {
    if (!filteredServiceOrders || filteredServiceOrders.length === 0) return;

    const exportColumns = allColumns
      .filter(col => visibleColumns.includes(col.key))
      .sort((a, b) => {
        // Same -1 guard as filteredColumns, so the CSV column order matches the
        // table's rather than hoisting an unordered column to the first field.
        const indexA = columnOrder.indexOf(a.key);
        const indexB = columnOrder.indexOf(b.key);
        return (indexA === -1 ? Infinity : indexA) - (indexB === -1 ? Infinity : indexB);
      });

    const getExportValue = (so: ServiceOrder, columnKey: string) => {
      switch (columnKey) {
        case 'timestamp': return so.timestamp || '-';
        case 'supportStatus': return so.supportStatus || '-';
        case 'visitStatus': return so.visitStatus || '-';
        case 'fullName': return so.fullName || '-';
        case 'contactNumber': return so.contactNumber || '-';
        case 'fullAddress': return so.fullAddress || '-';
        case 'concern': return so.concern || '-';
        case 'concernRemarks': return so.concernRemarks || '-';
        case 'requestedBy': return resolveUserDisplayName(so.requestedBy, userDirectory, '-');
        case 'assignedEmail': return resolveUserDisplayName(so.assignedEmail, userDirectory, '-');
        case 'repairCategory': return so.repairCategory || '-';
        // A separate switch from renderCellValue, with its own '-' default, so these
        // have to be listed here too or the CSV exports a column of dashes.
        case 'barangay': return so.barangay || '-';
        case 'city': return so.city || '-';
        case 'region': return so.region || '-';
        case 'modifiedBy': return so.modifiedBy || '-';
        case 'modifiedDate': return so.modifiedDate || '-';
        case 'startTime': return formatDateTime(so.start_time) || '-';
        case 'endTime': return formatDateTime(so.end_time) || '-';
        case 'duration': return calculateDuration(so.start_time, so.end_time) || '-';
        default: return '-';
      }
    };

    exportToCSV('service_orders_export', exportColumns, filteredServiceOrders, getExportValue);
  };

  /** Label used when a service order records no concern or no status. */
  const UNSPECIFIED = 'Unspecified';

  /**
   * Counts of service orders per concern, broken down by support status.
   *
   * Built from filteredServiceOrders, the same set the default export uses, so the
   * report always describes what is on screen — a report that ignored the active
   * filters would quietly disagree with the table beside it.
   *
   * Support status rather than visit status: it is the lifecycle the question is
   * about (Resolved / Pending / In Progress / Cancelled), whereas visit status only
   * records how a single visit went.
   */
  const concernReport = useMemo(() => {
    const rows = filteredServiceOrders || [];

    const byConcern = new Map<string, Map<string, number>>();
    const statusesSeen = new Set<string>();

    for (const so of rows) {
      const concern = (so.concern || '').trim() || UNSPECIFIED;
      const status = (so.supportStatus || '').trim() || UNSPECIFIED;

      if (!byConcern.has(concern)) byConcern.set(concern, new Map());
      const statuses = byConcern.get(concern)!;
      statuses.set(status, (statuses.get(status) || 0) + 1);
      statusesSeen.add(status);
    }

    const groups = Array.from(byConcern.entries())
      .map(([concern, statuses]) => ({
        concern,
        // Largest first, so the dominant status for a concern reads first; ties
        // fall back to the status name for a stable order between exports.
        statuses: Array.from(statuses.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([status, count]) => ({ status, count })),
        total: Array.from(statuses.values()).reduce((sum, n) => sum + n, 0),
      }))
      .sort((a, b) => a.concern.localeCompare(b.concern));

    return {
      groups,
      grandTotal: groups.reduce((sum, g) => sum + g.total, 0),
      statusCount: statusesSeen.size,
    };
  }, [filteredServiceOrders]);

  /**
   * The concern summary as CSV, through the same exportToCSV the row export uses so
   * both files share one escaping and filename convention.
   *
   * Flat Concern/Status/Count rows with a Total line per concern rather than an
   * indented tree: it opens correctly in a spreadsheet and can be pivoted, which an
   * indented layout cannot.
   */
  const exportConcernReport = () => {
    if (concernReport.groups.length === 0) return;

    const reportRows: Array<{ concern: string; status: string; count: number | string }> = [];

    concernReport.groups.forEach((group, index) => {
      // A blank line between groups, so the concerns read as separate blocks.
      if (index > 0) reportRows.push({ concern: '', status: '', count: '' });

      // The concern is named once, on its own line, rather than repeated beside
      // every status — the statuses below it are already understood to belong to it.
      reportRows.push({ concern: group.concern, status: '', count: '' });

      group.statuses.forEach(({ status, count }) => {
        reportRows.push({ concern: '', status, count });
      });

      reportRows.push({ concern: '', status: 'Total', count: group.total });
    });

    reportRows.push({ concern: '', status: '', count: '' });
    reportRows.push({ concern: 'OVERALL TOTAL', status: '', count: concernReport.grandTotal });

    exportToCSV(
      'service_orders_concern_report',
      [
        { key: 'concern', label: 'Concern' },
        { key: 'status', label: 'Status' },
        { key: 'count', label: 'Count' },
      ],
      reportRows,
      (row, key) => (row as any)[key]
    );
  };

  /** Runs whichever mode the chooser is on, then closes it. */
  const handleConfirmDownload = () => {
    if (downloadMode === 'report') exportConcernReport();
    else exportDefaultCsv();

    setIsDownloadModalOpen(false);
  };

  return (
    <div className={`${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      } h-full flex flex-col md:flex-row overflow-hidden`}>
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
                Service Orders
              </h2>
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
              className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
              style={selectedLocation === 'all' ? {
                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                color: colorPalette?.primary || '#7c3aed',
                fontWeight: 500
              } : {
                color: isDarkMode ? '#d1d5db' : '#374151'
              }}
            >
              <div className="flex items-center">
                <span>All Service Orders</span>
              </div>
              <span
                className={`px-2 py-1 rounded text-xs transition-colors ${selectedLocation === 'all'
                  ? 'text-white'
                  : isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'
                  }`}
                style={selectedLocation === 'all' ? {
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                {locationItems.total}
              </span>
            </button>
            {grouping.isGrouped ? (
              <GroupTree
                nodes={grouping.tree}
                selectedId={selectedLocation}
                onSelect={(id) => {
                  setSelectedLocation(id);
                  if (isMobile) {
                    setMobileViewMode('list');
                  }
                }}
                expanded={expandedLocations}
                onToggleExpand={toggleLocationExpansion}
                isDarkMode={isDarkMode}
                accent={colorPalette?.primary || '#7c3aed'}
              />
            ) : (
              /* Billing Type Level */
              locationItems.items.map((billingType) => {
              const isBillingTypeExpanded = expandedLocations.has(billingType.id);

              const getStatusColor = (val: string) => {
                switch (val) {
                  case 'resolved': return 'text-green-500';
                  case 'failed': return 'text-red-500';
                  case 'inprogress': return 'text-blue-500';
                  case 'forvisit': return 'text-purple-500';
                  case 'open': return 'text-orange-500';
                  case 'pending': return 'text-gray-500';
                  default: return 'text-gray-500';
                }
              };

              return (
                <div key={billingType.id}>
                  <button
                    onClick={() => {
                      setSelectedLocation(billingType.id);
                      if (isMobile) {
                        setMobileViewMode('list');
                      }
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                    style={selectedLocation === billingType.id ? {
                      backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                      color: colorPalette?.primary || '#7c3aed'
                    } : {
                      color: isDarkMode ? '#d1d5db' : '#374151'
                    }}
                  >
                    <span className="font-semibold flex-1 text-left">{billingType.name}</span>
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${selectedLocation === billingType.id
                          ? 'text-white'
                          : isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'
                          }`}
                        style={selectedLocation === billingType.id ? {
                          backgroundColor: colorPalette?.primary || '#7c3aed'
                        } : {}}
                      >
                        {billingType.count}
                      </span>
                      <button
                        onClick={(e) => toggleLocationExpansion(e, billingType.id)}
                        className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                      >
                        {isBillingTypeExpanded ? (
                          <ChevronDown className={`h-4 w-4 ${selectedLocation === billingType.id ? 'text-current' : 'text-gray-400'}`} />
                        ) : (
                          <ChevronRight className={`h-4 w-4 ${selectedLocation === billingType.id ? 'text-current' : 'text-gray-400'}`} />
                        )}
                      </button>
                    </div>
                  </button>

                  {/* Status Level */}
                  {isBillingTypeExpanded && billingType.statuses.map((category) => {
                    const isExpanded = expandedLocations.has(category.id);

                    return (
                      <div key={category.id}>
                        <button
                          onClick={() => {
                            setSelectedLocation(category.id);
                            if (isMobile) {
                              setMobileViewMode('list');
                            }
                          }}
                          className={`w-full flex items-center justify-between pl-8 pr-4 py-2.5 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                          style={selectedLocation === category.id ? {
                            backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                            color: colorPalette?.primary || '#7c3aed',
                            fontWeight: 500
                          } : {
                            color: isDarkMode ? '#d1d5db' : '#374151'
                          }}
                        >
                          <div className="flex items-center flex-1">
                            <div className={`h-2.5 w-2.5 rounded-full mr-3 ${getStatusColor(category.statusId).replace('text-', 'bg-')}`} />
                            <span className={`font-medium ${selectedLocation === category.id ? '' : isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{category.name}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            {category.count > 0 && (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${selectedLocation === category.id
                                ? 'text-white'
                                : isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'
                                }`}
                                style={selectedLocation === category.id ? {
                                  backgroundColor: colorPalette?.primary || '#7c3aed'
                                } : {}}>
                                {category.count}
                              </span>
                            )}
                            <button
                              onClick={(e) => toggleLocationExpansion(e, category.id)}
                              className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                            >
                              {isExpanded ? (
                                <ChevronDown className={`h-4 w-4 ${selectedLocation === category.id ? 'text-current' : 'text-gray-400'}`} />
                              ) : (
                                <ChevronRight className={`h-4 w-4 ${selectedLocation === category.id ? 'text-current' : 'text-gray-400'}`} />
                              )}
                            </button>
                          </div>
                        </button>

                        {/* Visit Status Level */}
                        {isExpanded && category.visits.map((visit) => {
                          const isVisitExpanded = expandedLocations.has(visit.id);

                          return (
                            <div key={visit.id}>
                              <button
                                onClick={() => {
                                  setSelectedLocation(visit.id);
                                  if (isMobile) {
                                    setMobileViewMode('list');
                                  }
                                }}
                                className={`w-full flex items-center justify-between pl-14 pr-4 py-2 text-xs transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                                style={selectedLocation === visit.id ? {
                                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                  color: colorPalette?.primary || '#7c3aed'
                                } : {
                                  color: isDarkMode ? '#9ca3af' : '#4b5563'
                                }}
                              >
                                <span className="truncate flex-1 text-left">{visit.name}</span>
                                <div className="flex items-center space-x-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${selectedLocation === visit.id
                                    ? 'text-white'
                                    : isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'
                                    }`}
                                    style={selectedLocation === visit.id ? {
                                      backgroundColor: colorPalette?.primary || '#7c3aed'
                                    } : {}}>
                                    {visit.count}
                                  </span>
                                  <button
                                    onClick={(e) => toggleLocationExpansion(e, visit.id)}
                                    className={`p-0.5 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                                  >
                                    {isVisitExpanded ? (
                                      <ChevronDown className={`h-3.5 w-3.5 ${selectedLocation === visit.id ? 'text-current' : 'text-gray-500'}`} />
                                    ) : (
                                      <ChevronRight className={`h-3.5 w-3.5 ${selectedLocation === visit.id ? 'text-current' : 'text-gray-500'}`} />
                                    )}
                                  </button>
                                </div>
                              </button>

                              {/* Barangay Level */}
                              {isVisitExpanded && visit.barangays.map((brgy) => {
                                return (
                                  <button
                                    key={brgy.id}
                                    onClick={() => {
                                      setSelectedLocation(brgy.id);
                                      if (isMobile) {
                                        setMobileViewMode('list');
                                      }
                                    }}
                                    className={`w-full flex items-center justify-between pl-20 pr-4 py-1.5 text-[10px] transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                                    style={selectedLocation === brgy.id ? {
                                      backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                      color: colorPalette?.primary || '#7c3aed',
                                      fontWeight: 'bold'
                                    } : {
                                      color: isDarkMode ? '#6b7280' : '#4b5563'
                                    }}
                                  >
                                    <span className="truncate flex-1 text-left">{brgy.name}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${selectedLocation === brgy.id
                                      ? 'text-white'
                                      : isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400'
                                      }`}
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
              );
            })
          )}
          </div>

          {/* View Options & Mobile controls */}
          <div className={`p-3 border-t flex-shrink-0 space-y-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <button
              onClick={() => setIsViewOptionsModalOpen(true)}
              title="Group by one or more columns, set the sort order, and colour each value"
              className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded border text-xs font-medium transition-colors ${
                isDarkMode
                  ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              View Options
              {grouping.levels.length > 0 && (
                <span
                  className="text-[10px] font-bold px-1.5 rounded text-white"
                  style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                >
                  {grouping.levels.length}
                </span>
              )}
            </button>

            {/* View Records Button for mobile */}
            {isMobile && (
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
            )}
          </div>

          {/* Resize Handle for desktop */}
          {!isMobile && (
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-orange-500 transition-colors z-10"
              onMouseDown={handleMouseDownSidebarResize}
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
                    placeholder="Search service orders..."
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
                    : "Filter Service Orders"
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
                {displayMode === 'table' && (
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
                      <div
                        style={{ top: columnMenuPos?.top ?? 0, right: columnMenuPos?.right ?? 8 }}
                        className={`fixed w-80 border rounded shadow-lg z-[100] max-h-96 flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                        }`}>
                        <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                          }`}>
                          <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>Column Visibility</span>
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
                                className={`mr-3 h-4 w-4 rounded text-orange-600 focus:ring-orange-500 ${isDarkMode
                                  ? 'border-gray-600 bg-gray-700 focus:ring-offset-gray-800'
                                  : 'border-gray-300 bg-white focus:ring-offset-white'
                                  }`}
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
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {dropdownOpen && (
                    <div
                      style={{ top: viewMenuPos?.top ?? 0, left: viewMenuPos?.left ?? 0 }}
                      className={`fixed w-36 border rounded shadow-lg z-[100] ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                      }`}>
                      <button
                        onClick={() => {
                          setDisplayMode('card');
                          setDropdownOpen(false);
                        }}
                        className={`block w-full text-left px-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                          }`}
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
                          setDisplayMode('table');
                          setDropdownOpen(false);
                        }}
                        className={`block w-full text-left px-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                          }`}
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
                  onClick={() => {
                    // Always reopens on the default choice: the chooser should not
                    // remember that the last export was a report and silently give a
                    // different file to the next person who clicks Download.
                    setDownloadMode('default');
                    setIsDownloadModalOpen(true);
                  }}
                  disabled={isLoading || filteredServiceOrders.length === 0}
                  title="Download"
                  className="relative flex-shrink-0 p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: colorPalette?.primary || '#7c3aed',
                    color: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading && filteredServiceOrders.length > 0 && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading && filteredServiceOrders.length > 0) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <Download className="h-5 w-5" />
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={isLoading || !isFullyLoaded || isRefreshingManual}
                  title={!isFullyLoaded ? `Loading records... (${serviceOrders.length}/${totalCount})` : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
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
            </div></div>

          {/* Active Funnel Filters Row */}
          {activeFilters && Object.keys(activeFilters).length > 0 && (
            <div className={`px-4 py-2 border-b flex flex-wrap items-center gap-2 overflow-x-auto no-scrollbar ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Active Filters:
              </span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(activeFilters).map(([key, filter]: [string, any]) => {
                  const column = filterColumns.find(c => c.key === key);
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
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFilter(key);
                        }}
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
                    localStorage.removeItem('serviceOrderFilters');
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
              {(isLoading || isLoadingUsers) ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <div className="animate-pulse flex flex-col items-center">
                    <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                    <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                  </div>
                  <p className="mt-4">Loading service orders...</p>
                </div>
              ) : error ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                  <p>{error}</p>
                  <button
                    onClick={handleRefresh}
                    className={`mt-4 px-4 py-2 rounded text-white ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-400 hover:bg-gray-500'}`}>
                    Retry
                  </button>
                </div>
              ) : displayMode === 'card' ? (
                paginatedServiceOrders.length > 0 ? (
                  <div className="space-y-0">
                    {paginatedServiceOrders.map((serviceOrder) => (
                      <div
                        key={serviceOrder.id}
                        onClick={() => handleRowClick(serviceOrder)}
                        className={`px-4 py-3 cursor-pointer transition-colors border-b ${isDarkMode
                          ? `hover:bg-gray-800 border-gray-800 ${selectedServiceOrder?.id === serviceOrder.id ? 'bg-gray-800' : ''}`
                          : `hover:bg-gray-100 border-gray-200 ${selectedServiceOrder?.id === serviceOrder.id ? 'bg-gray-100' : ''}`
                          }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium text-sm mb-1 flex items-center space-x-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                              }`}>
                              <span>{serviceOrder.fullName}</span>
                              {viewers[String(serviceOrder.id)] && viewers[String(serviceOrder.id)].length > 0 && (
                                <div className="flex flex-wrap gap-1 ml-1 flex-shrink-0">
                                  {viewers[String(serviceOrder.id)].map((username: string) => (
                                    <span 
                                      key={username} 
                                      className="text-[9px] px-1.5 py-0.5 rounded-full font-bold animate-pulse lowercase shadow-sm"
                                      style={{
                                        backgroundColor: colorPalette?.primary || '#f97316',
                                        color: '#ffffff'
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
                              {serviceOrder.timestamp} | {serviceOrder.fullAddress}
                            </div>
                          </div>
                          <div className="flex flex-col items-end space-y-1 ml-4 flex-shrink-0">
                            <StatusText status={serviceOrder.supportStatus} type="support" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                    No service orders found matching your filters
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
                                } ${dragOverColumn === column.key ? 'bg-orange-500 bg-opacity-20' : ''
                                }`}
                              style={{ width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined }}
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
                                      <ArrowDown className="h-4 w-4 text-orange-400" />
                                    ) : (
                                      <ArrowUp className="h-4 w-4 text-gray-400 hover:text-orange-400" />
                                    )}
                                  </button>
                                )}
                              </div>
                              {index < filteredColumns.length - 1 && (
                                <div
                                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-orange-500 group-hover:bg-gray-600"
                                  onMouseDown={(e) => handleMouseDownResize(e, column.key)}
                                />
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedServiceOrders.length > 0 ? (
                          paginatedServiceOrders.map((serviceOrder) => (
                            <tr
                              key={serviceOrder.id}
                              className={`border-b cursor-pointer transition-colors ${isDarkMode
                                ? `border-gray-800 hover:bg-gray-900 ${selectedServiceOrder?.id === serviceOrder.id ? 'bg-gray-800' : ''}`
                                : `border-gray-200 hover:bg-gray-100 ${selectedServiceOrder?.id === serviceOrder.id ? 'bg-gray-100' : ''}`
                                }`}
                              onClick={() => handleRowClick(serviceOrder)}
                            >
                              {filteredColumns.map((column, index) => (
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
                                  <div className="truncate">
                                    {renderCellValue(serviceOrder, column.key)}
                                  </div>
                                </td>
                              ))}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={filteredColumns.length} className={`px-4 py-12 text-center border-b ${isDarkMode ? 'text-gray-400 border-gray-800' : 'text-gray-600 border-gray-200'
                              }`}>
                              No service orders found matching your filters
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
            {!isLoading && filteredServiceOrders.length > 0 && (
              <div className={`border-t p-4 flex flex-col md:flex-row items-center md:justify-between gap-3 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                <div className={`flex flex-col sm:flex-row items-center gap-3 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <div className="flex items-center gap-2">
                    <span className="hidden sm:inline">Show</span>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => setItemsPerPage(Number(e.target.value))}
                      className={`px-2 py-1 rounded border focus:outline-none text-xs transition-colors ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white focus:border-orange-500'
                        : 'bg-white border-gray-300 text-gray-900 focus:border-orange-500'
                        }`}
                    >
                      {[10, 25, 50, 100].map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                    <span className="hidden sm:inline">entries</span>
                  </div>
                  <div>
                    Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredServiceOrders.length)}</span> of <span className="font-medium">{filteredServiceOrders.length}</span> results
                  </div>
                </div>
                <div className="flex items-center flex-wrap justify-center gap-1">
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
                    <span className={`px-2 text-sm whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {currentPage} / {totalPages || 1}
                    </span>
                  </div>

                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || totalPages <= 1}
                    className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === totalPages || totalPages <= 1
                      ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                      : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                      }`}
                  >
                    <ChevronRight size={16} />
                  </button>

                  <button
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages || totalPages <= 1}
                    className={`p-1 rounded transition-colors ${currentPage === totalPages || totalPages <= 1
                      ? (isDarkMode ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 cursor-not-allowed')
                      : (isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100')
                      }`}
                    title="Last Page"
                  >
                    <ChevronsRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedServiceOrder && (
        <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:flex-shrink-0 md:overflow-hidden">
          <ServiceOrderDetails
            serviceOrder={selectedServiceOrder}
            onClose={() => setSelectedServiceOrder(null)}
            onRefresh={fetchUpdates}
            isMobile={isMobile}
          />
        </div>
      )}

      <ServiceOrderFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          setActiveFilters(filters);
          localStorage.setItem('serviceOrderFilters', JSON.stringify(filters));
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={activeFilters}
      />

      {/* ── Download options ─────────────────────────────────────────────── */}
      {isDownloadModalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[100] p-4"
          onClick={() => setIsDownloadModalOpen(false)}
        >
          <div
            className={`relative rounded-lg shadow-2xl w-full max-w-md ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}
            // The backdrop closes the chooser; a click inside it must not.
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Download
              </h2>
              <button
                onClick={() => setIsDownloadModalOpen(false)}
                className={`p-1 rounded transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-3">
              {[
                {
                  value: 'default' as const,
                  title: 'Default Download',
                  description: `All ${filteredServiceOrders.length.toLocaleString()} service order${filteredServiceOrders.length === 1 ? '' : 's'} currently shown, one row each.`,
                },
                {
                  value: 'report' as const,
                  title: 'Data Report',
                  description: concernReport.groups.length > 0
                    ? `Counts grouped by concern and status — ${concernReport.groups.length} concern${concernReport.groups.length === 1 ? '' : 's'}, ${concernReport.grandTotal.toLocaleString()} record${concernReport.grandTotal === 1 ? '' : 's'} in total.`
                    : 'No service orders to summarise.',
                },
              ].map(option => {
                const isSelected = downloadMode === option.value;
                // The report needs at least one grouped row; the default export needs
                // at least one service order. Either way, offering a choice that would
                // produce an empty file is worse than showing it as unavailable.
                const isDisabled = option.value === 'report' && concernReport.groups.length === 0;

                return (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 p-4 rounded-lg border transition-all ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${isDarkMode ? 'bg-gray-900/40' : 'bg-white'}`}
                    style={{
                      borderColor: isSelected
                        ? (colorPalette?.primary || '#7c3aed')
                        : (isDarkMode ? '#374151' : '#e5e7eb'),
                      backgroundColor: isSelected
                        ? hexToRgba(colorPalette?.primary || '#7c3aed', isDarkMode ? 0.15 : 0.06)
                        : undefined,
                    }}
                  >
                    <input
                      type="radio"
                      name="downloadMode"
                      value={option.value}
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={() => setDownloadMode(option.value)}
                      className="mt-1 h-4 w-4 flex-shrink-0"
                      style={{ accentColor: colorPalette?.primary || '#7c3aed' }}
                    />
                    <div className="min-w-0">
                      <div className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {option.title}
                      </div>
                      <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {option.description}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className={`flex justify-end gap-3 px-6 py-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <button
                onClick={() => setIsDownloadModalOpen(false)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDarkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDownload}
                disabled={downloadMode === 'report' && concernReport.groups.length === 0}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Options Modal */}
      <ViewOptionsModal
        isOpen={isViewOptionsModalOpen}
        onClose={() => setIsViewOptionsModalOpen(false)}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        title="Service Orders"
        columns={groupableColumns}
        options={grouping.options}
        distinctValues={grouping.distinctValues}
        colorFor={grouping.colorFor}
        onSave={grouping.save}
        onReset={grouping.reset}
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

export default ServiceOrderPage;
