import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FileText, X, Columns3, ArrowUp, ArrowDown, Menu, Filter, RefreshCw, ChevronDown, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Download } from 'lucide-react';
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
import { User } from '../types/api';
import {
  buildTechnicianLockedServiceOrderIds,
  isTechnicianUser,
  sortServiceOrdersForTechnician,
  TECHNICIAN_LOCKED_MESSAGE
} from '../utils/technicianServiceOrderAccess';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};




// Concerns are free text, so the same concern arrives in whatever casing and
// spacing the encoder used ("For Pullout" vs "for pullout"). Grouping on the raw
// string splits one concern into several sidebar rows, so every comparison goes
// through this key instead.
const concernKeyOf = (concern?: string | null) => {
  const trimmed = (concern || '').replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.toLowerCase() : '(no concern)';
};

type DisplayMode = 'card' | 'table';

const allColumns = [
  { key: 'timestamp', label: 'Timestamp', width: 'min-w-40' },
  { key: 'fullName', label: 'Full Name', width: 'min-w-40' },
  { key: 'contactNumber', label: 'Contact Number', width: 'min-w-36' },
  { key: 'fullAddress', label: 'Full Address', width: 'min-w-56' },
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
  { key: 'visitStatus', label: 'Visit Status', width: 'min-w-32' },
  { key: 'visitStatusDate', label: 'Visit Status Date', width: 'min-w-36' }
];

// Export-only column, deliberately absent from allColumns.
//
// The table does not show an account number and the column picker cannot turn
// one on, but an exported row is read away from the app — in a spreadsheet, or
// by someone matching it against billing — where the account number is the only
// thing that identifies the subscriber. So the export always leads with it,
// whatever the picker is set to.
const EXPORT_ACCOUNT_COLUMN = { key: 'accountNumber', label: 'Account No' };

// Columns the table starts with unticked. Timing detail most desks do not want
// in the way; the column picker turns them on.
const DEFAULT_HIDDEN_COLUMNS = ['startTime', 'endTime', 'duration'];

// Columns added after the column picker shipped, and the note recording that
// each has been shown once.
//
// A saved visibility list holds only the columns that were visible when it was
// written, so a column added later is indistinguishable from one the user
// deliberately hid. Naming the new ones here reveals each exactly once — the
// adoption note is written at the same time, so unticking it afterwards sticks.
// An entry can be deleted a release or two later, once every browser has seen it.
const RECENTLY_ADDED_COLUMNS = ['visitStatusDate'];
const COLUMN_ADOPTION_KEY = 'serviceOrderAdoptedColumns';

const adoptNewColumns = (saved: string[]): string[] => {
  let adopted: string[] = [];
  try {
    const raw = localStorage.getItem(COLUMN_ADOPTION_KEY);
    if (raw) adopted = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read adopted columns:', err);
  }

  const pending = RECENTLY_ADDED_COLUMNS.filter(
    key => !adopted.includes(key) && !saved.includes(key)
  );
  if (pending.length === 0) return saved;

  const next = [...saved, ...pending];
  try {
    localStorage.setItem('serviceOrderVisibleColumns', JSON.stringify(next));
    localStorage.setItem(COLUMN_ADOPTION_KEY, JSON.stringify([...adopted, ...pending]));
  } catch (err) {
    console.error('Failed to record adopted columns:', err);
  }
  return next;
};

const ServiceOrderPage: React.FC = () => {
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
  const [displayMode, setDisplayMode] = useState<DisplayMode>('table');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('serviceOrderVisibleColumns');
    if (saved) {
      try {
        return adoptNewColumns(JSON.parse(saved));
      } catch (err) {
        console.error('Failed to load column visibility:', err);
      }
    }
    return allColumns
      .map(col => col.key)
      .filter(key => !DEFAULT_HIDDEN_COLUMNS.includes(key));
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
        // A saved order is a rearrangement of every column that existed when it
        // was written, hidden ones included, so anything missing from it is
        // genuinely new. Append it — left out, its indexOf below is -1 and it
        // would sort ahead of Timestamp.
        const parsed: string[] = JSON.parse(saved);
        const missing = allColumns.map(col => col.key).filter(key => !parsed.includes(key));
        return [...parsed, ...missing];
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
        // Technicians land on their queue in the order they are expected to work
        // it, which the presort applies when no column sort is set. Clicking a
        // column header still sorts, for them as for everyone else.
        if (isTechnicianUser(userData.role, userData.role_id)) {
          setSortColumn(null);
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
      // Already "YYYY-MM-DD", which sorts correctly as a string.
      case 'visitStatusDate': return item.visitStatusDate;
      case 'timestamp': return item.timestamp;
      case 'dateInstalled': return item.dateInstalled;
      case 'modifiedBy': return item.modifiedBy ?? (item as any).updated_by_user ?? '';
      case 'modifiedDate': return item.modifiedDate ?? (item as any).updated_at ?? '';
      case 'assignedEmail':
        const email = item.assignedEmail || '';
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
      case 'requestedBy': return item.requestedBy;
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
  }, []);

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
              const dateValue = new Date(orderValue).getTime();
              if (!isNaN(dateValue)) {
                if (typedFilter.from) {
                  const fromDate = new Date(typedFilter.from).getTime();
                  if (dateValue < fromDate) { matchesFunnel = false; break; }
                }
                if (typedFilter.to) {
                  const toDate = new Date(typedFilter.to).getTime();
                  if (dateValue > toDate + 86400000) { matchesFunnel = false; break; }
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
              // For location fields, also check fullAddress as fallback
              const address = String(serviceOrder.fullAddress || '').toLowerCase();
              const isMatch = typedFilter.value.some((opt: string) => {
                const filterVal = String(opt).toLowerCase().trim();
                return normalizedValue === filterVal || normalizedValue.includes(filterVal) || address.includes(filterVal);
              });
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

  const locationItems = useMemo(() => {
    const categories = [
      { id: 'resolved', name: 'Resolved' },
      { id: 'failed', name: 'Failed' },
      { id: 'inprogress', name: 'In Progress' },
      { id: 'forvisit', name: 'For Visit' },
      { id: 'open', name: 'Open' }
    ];

    // status -> visit status -> barangay -> concern. Each level is a count of
    // the level beneath it, so a branch can be read without opening it.
    const tree: Record<string, {
      count: number,
      visits: Record<string, {
        count: number,
        barangays: Record<string, {
          count: number,
          // Keyed by concernKeyOf(); `labels` tallies the raw spellings so the
          // row can be shown with the one that actually occurs most.
          concerns: Record<string, { count: number, labels: Record<string, number> }>
        }>
      }>
    }> = {};

    categories.forEach(c => {
      tree[c.id] = { count: 0, visits: {} };
    });

    globalFilteredServiceOrders.forEach(so => {
      const s = (so.supportStatus || '').toLowerCase().trim();
      const v = (so.visitStatus || '').toLowerCase().trim();

      let category = '';
      if (s === 'resolved' || s === 'completed') category = 'resolved';
      else if (s === 'failed') category = 'failed';
      else if (s === 'in-progress' || s === 'in progress') category = 'inprogress';
      else if (s === 'for-visit' || s === 'for visit') category = 'forvisit';
      else if (s === 'pending' || s === 'open') category = 'open';
      else category = '';

      const catNode = tree[category];
      if (catNode) {
        catNode.count++;

        // A resolved ticket with no visit status is a finished visit that was
        // never stamped, so it counts as Done instead of getting its own
        // '(Empty)' branch. Only Resolved does this — under the other statuses
        // a blank still means the visit is unaccounted for.
        let visitKey = v || (category === 'resolved' ? 'done' : 'empty');
        if (visitKey === 'completed') visitKey = 'done';
        if (visitKey === 'in progress') visitKey = 'inprogress';

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

        if (!visitNode.barangays[matchedBrgy]) {
          visitNode.barangays[matchedBrgy] = { count: 0, concerns: {} };
        }
        const brgyNode = visitNode.barangays[matchedBrgy];
        brgyNode.count++;

        // Blank concerns are grouped rather than dropped: a barangay's rows must
        // add up to its own count, or the branch reads as if records went
        // missing when it is opened.
        const concernLabel = (so.concern || '').replace(/\s+/g, ' ').trim() || '(No concern)';
        const concernKey = concernKeyOf(so.concern);
        if (!brgyNode.concerns[concernKey]) {
          brgyNode.concerns[concernKey] = { count: 0, labels: {} };
        }
        const concernNode = brgyNode.concerns[concernKey];
        concernNode.count++;
        concernNode.labels[concernLabel] = (concernNode.labels[concernLabel] || 0) + 1;
      }
    });

    return {
      items: categories.map(c => ({
        id: `status:${c.id}`,
        name: c.name,
        count: tree[c.id].count,
        visits: Object.entries(tree[c.id].visits).sort().map(([vKey, vData]) => {
          let vName = vKey;
          if (vKey === 'done') vName = 'Done';
          else if (vKey === 'inprogress') vName = 'In Progress';
          else if (vKey === 'reschedule') vName = 'Reschedule';
          // A blank visit status means different things per status, so it is named
          // for what it means rather than for being blank. Under For Visit the
          // ticket is waiting to be scheduled — nothing has gone wrong with it, and
          // "(Empty)" reads like missing data rather than a real queue. Elsewhere it
          // still means the visit is genuinely unaccounted for.
          else if (vKey === 'empty') vName = c.id === 'forvisit' ? 'Not Assigned' : '(Empty)';
          else vName = vKey.charAt(0).toUpperCase() + vKey.slice(1);

          return {
            id: `status:${c.id}:visit:${vKey}`,
            name: vName,
            originalKey: vKey,
            count: vData.count,
            barangays: Object.entries(vData.barangays).sort().map(([bName, bData]) => ({
              id: `status:${c.id}:visit:${vKey}:brgy:${bName}`,
              name: bName,
              count: bData.count,
              concerns: Object.entries(bData.concerns).sort(([a], [b]) => a.localeCompare(b)).map(([cKey, cData]) => {
                // Show the spelling most of the rows actually use; ties keep the
                // one seen first.
                const displayName = Object.entries(cData.labels)
                  .reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];

                return {
                  id: `status:${c.id}:visit:${vKey}:brgy:${bName}:concern:${cKey}`,
                  name: displayName,
                  count: cData.count
                };
              })
            }))
          };
        })
      })),
      total: globalFilteredServiceOrders.length
    };
  }, [globalFilteredServiceOrders, barangays]);

  const isTechnician = isTechnicianUser(userRole, roleId);

  /**
   * The service orders a technician may not open yet.
   *
   * Built from their whole accessible set — the API already scopes it to them —
   * and NOT from the filtered or paginated view, so searching, filtering or
   * paging can never change which record counts as their next one.
   */
  const technicianLockedIds = useMemo(() => {
    if (!isTechnician) return new Set<string>();
    return buildTechnicianLockedServiceOrderIds(serviceOrders);
  }, [isTechnician, serviceOrders]);

  const isServiceOrderLocked = (serviceOrder: ServiceOrder): boolean =>
    technicianLockedIds.has(String(serviceOrder.id));

  const filteredServiceOrders = useMemo(() => {
    let filtered = globalFilteredServiceOrders.filter(serviceOrder => {
      if (selectedLocation === 'all') return true;

      // Extract location match logic
      if (selectedLocation.startsWith('status:')) {
        const parts = selectedLocation.split(':');
        const catId = parts[1];

        const s = (serviceOrder.supportStatus || '').toLowerCase().trim();
        const v = (serviceOrder.visitStatus || '').toLowerCase().trim();

        let category = '';
        if (s === 'resolved' || s === 'completed') category = 'resolved';
        else if (s === 'failed') category = 'failed';
        else if (s === 'in-progress' || s === 'in progress') category = 'inprogress';
        else if (s === 'for-visit' || s === 'for visit') category = 'forvisit';
        else if (s === 'pending' || s === 'open') category = 'open';
        else category = '';

        if (category !== catId) return false;

        if (parts.length > 2 && parts[2] === 'visit') {
          const visitKeyFilter = parts[3];
          // Same rule the counts are built with, so a Resolved > Done branch
          // opens exactly the rows it counted.
          let visitKey = v || (category === 'resolved' ? 'done' : 'empty');
          if (visitKey === 'completed') visitKey = 'done';
          if (visitKey === 'in progress') visitKey = 'inprogress';

          if (visitKey !== visitKeyFilter) return false;

          if (parts.length > 4 && parts[4] === 'brgy') {
            const brgyName = parts[5];
            const address = (serviceOrder.fullAddress || '').toLowerCase();
            let matchedBrgy = 'Unknown';
            const foundBrgy = barangays.find(b => address.includes(b.barangay.toLowerCase()));
            if (foundBrgy) matchedBrgy = foundBrgy.barangay;

            if (matchedBrgy !== brgyName) return false;

            // The concern is the deepest level. Its name can itself contain a
            // colon, so the remainder is rejoined rather than read as parts[7] —
            // splitting on every colon would silently drop half the name and
            // match nothing.
            if (parts.length > 6 && parts[6] === 'concern') {
              const concernKeyFilter = parts.slice(7).join(':');

              if (concernKeyOf(serviceOrder.concern) !== concernKeyFilter) return false;
            }
          }
        }
        return true;
      }
      return false;
    });

    // Technicians read their list in the order they work it: In Progress oldest
    // first, then other active work, with Done / Reschedule / Failed at the end.
    // Every other role keeps the newest-first default untouched.
    if (isTechnician) {
      filtered = sortServiceOrdersForTechnician(filtered);
    } else {
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
    }

    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue = getVal(a, sortColumn);
        let bValue = getVal(b, sortColumn);

        // Special handling for date columns to ensure accurate chronological sorting
        const dateFields = ['timestamp', 'modifiedDate', 'dateInstalled', 'startTime', 'endTime', 'modified_at', 'created_at', 'rawUpdatedAt'];
        if (dateFields.includes(sortColumn)) {
          const timeA = aValue ? new Date(aValue).getTime() : 0;
          const timeB = bValue ? new Date(bValue).getTime() : 0;
          
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
  }, [globalFilteredServiceOrders, selectedLocation, sortColumn, sortDirection, barangays, getVal, isTechnician]);

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
        case 'scheduled':
        case 'reschedule':
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
      const indexA = columnOrder.indexOf(a.key);
      const indexB = columnOrder.indexOf(b.key);
      return indexA - indexB;
    });

  const renderCellValue = (serviceOrder: ServiceOrder, columnKey: string) => {
    switch (columnKey) {
      case 'timestamp':
        return serviceOrder.timestamp;
      case 'supportStatus':
        return <StatusText status={serviceOrder.supportStatus} type="support" />;
      case 'visitStatus':
        return <StatusText status={serviceOrder.visitStatus} type="visit" />;
      case 'visitStatusDate':
        return serviceOrder.visitStatusDate || '-';
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
        return serviceOrder.requestedBy || '-';
      case 'assignedEmail':
        const assignEmail = serviceOrder.assignedEmail || '';
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
      case 'repairCategory':
        return serviceOrder.repairCategory || '-';
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

  const handleExport = () => {
    if (!filteredServiceOrders || filteredServiceOrders.length === 0) return;

    const pickedColumns = allColumns
      .filter(col => visibleColumns.includes(col.key))
      .sort((a, b) => {
        const indexA = columnOrder.indexOf(a.key);
        const indexB = columnOrder.indexOf(b.key);
        return indexA - indexB;
      });

    // Account No first, then the picked columns in the order the table shows
    // them. Filtered rather than blindly prepended so the column cannot appear
    // twice if it is ever added to allColumns.
    const exportColumns = [
      EXPORT_ACCOUNT_COLUMN,
      ...pickedColumns.filter(col => col.key !== EXPORT_ACCOUNT_COLUMN.key),
    ];

    const getExportValue = (so: ServiceOrder, columnKey: string) => {
      switch (columnKey) {
        // The API has been seen sending either spelling, so both are read —
        // the same fallback getVal() uses for the rest of the page.
        case 'accountNumber': return so.accountNumber || (so as any).account_no || '-';
        case 'timestamp': return so.timestamp || '-';
        case 'supportStatus': return so.supportStatus || '-';
        case 'visitStatus': return so.visitStatus || '-';
        case 'visitStatusDate': return so.visitStatusDate || '-';
        case 'fullName': return so.fullName || '-';
        case 'contactNumber': return so.contactNumber || '-';
        case 'fullAddress': return so.fullAddress || '-';
        case 'concern': return so.concern || '-';
        case 'concernRemarks': return so.concernRemarks || '-';
        case 'requestedBy': return so.requestedBy || '-';
        case 'assignedEmail':
          const exportEmail = so.assignedEmail || '';
          if (!exportEmail) return '-';
          const exportUser = users.find(u => (u.email_address || '').toLowerCase() === exportEmail.toLowerCase());
          if (exportUser) {
            const fullName = [
              exportUser.first_name || '',
              exportUser.middle_initial ? `${exportUser.middle_initial}.` : '',
              exportUser.last_name || ''
            ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            return fullName || exportEmail;
          }
          return exportEmail;
        case 'repairCategory': return so.repairCategory || '-';
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
            {/* Status Level */}
            {locationItems.items.map((category) => {
              const isSelected = selectedLocation === category.id || selectedLocation.startsWith(`${category.id}:`);
              const isExpanded = expandedLocations.has(category.id);

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
                <div key={category.id}>
                  <button
                    onClick={() => {
                      setSelectedLocation(category.id);
                      if (isMobile) {
                        setMobileViewMode('list');
                      }
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                    style={selectedLocation === category.id ? {
                      backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                      color: colorPalette?.primary || '#7c3aed',
                      fontWeight: 500
                    } : {
                      color: isDarkMode ? '#d1d5db' : '#374151'
                    }}
                  >
                    <div className="flex items-center flex-1">
                      <div className={`h-2.5 w-2.5 rounded-full mr-3 ${getStatusColor(category.id.split(':')[1]).replace('text-', 'bg-')}`} />
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
                    const isVisitSelected = selectedLocation === visit.id || selectedLocation.startsWith(`${visit.id}:`);
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
                          className={`w-full flex items-center justify-between pl-10 pr-4 py-2 text-xs transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
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

                        {/* Barangay Level — expandable, with its concerns beneath */}
                        {isVisitExpanded && visit.barangays.map((brgy) => {
                          const isBrgyExpanded = expandedLocations.has(brgy.id);

                          return (
                            <div key={brgy.id}>
                              <button
                                onClick={() => {
                                  setSelectedLocation(brgy.id);
                                  if (isMobile) {
                                    setMobileViewMode('list');
                                  }
                                }}
                                className={`w-full flex items-center justify-between pl-16 pr-4 py-1.5 text-[10px] transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                                style={selectedLocation === brgy.id ? {
                                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                  color: colorPalette?.primary || '#7c3aed',
                                  fontWeight: 'bold'
                                } : {
                                  color: isDarkMode ? '#6b7280' : '#4b5563'
                                }}
                              >
                                <span className="truncate flex-1 text-left">{brgy.name}</span>
                                <div className="flex items-center space-x-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${selectedLocation === brgy.id
                                    ? 'text-white'
                                    : isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400'
                                    }`}
                                    style={selectedLocation === brgy.id ? {
                                      backgroundColor: colorPalette?.primary || '#7c3aed'
                                    } : {}}>
                                    {brgy.count}
                                  </span>
                                  {/* Only offered where there is something to
                                      open, so a leaf does not carry a chevron
                                      that does nothing. */}
                                  {brgy.concerns.length > 0 && (
                                    <button
                                      onClick={(e) => toggleLocationExpansion(e, brgy.id)}
                                      className={`p-0.5 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                                    >
                                      {isBrgyExpanded ? (
                                        <ChevronDown className={`h-3 w-3 ${selectedLocation === brgy.id ? 'text-current' : 'text-gray-500'}`} />
                                      ) : (
                                        <ChevronRight className={`h-3 w-3 ${selectedLocation === brgy.id ? 'text-current' : 'text-gray-500'}`} />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </button>

                              {/* Concern Level */}
                              {isBrgyExpanded && brgy.concerns.map((concern) => (
                                <button
                                  key={concern.id}
                                  onClick={() => {
                                    setSelectedLocation(concern.id);
                                    if (isMobile) {
                                      setMobileViewMode('list');
                                    }
                                  }}
                                  className={`w-full flex items-center justify-between pl-24 pr-4 py-1.5 text-[10px] transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                                  style={selectedLocation === concern.id ? {
                                    backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                    color: colorPalette?.primary || '#7c3aed',
                                    fontWeight: 'bold'
                                  } : {
                                    color: isDarkMode ? '#6b7280' : '#4b5563'
                                  }}
                                  title={concern.name}
                                >
                                  <span className="truncate flex-1 text-left">{concern.name}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${selectedLocation === concern.id
                                    ? 'text-white'
                                    : isDarkMode ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400'
                                    }`}
                                    style={selectedLocation === concern.id ? {
                                      backgroundColor: colorPalette?.primary || '#7c3aed'
                                    } : {}}>
                                    {concern.count}
                                  </span>
                                </button>
                              ))}
                            </div>
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
                  onClick={handleExport}
                  disabled={isLoading || filteredServiceOrders.length === 0}
                  title="Export to CSV"
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
                    {paginatedServiceOrders.map((serviceOrder) => {
                      const locked = isServiceOrderLocked(serviceOrder);
                      return (
                      <div
                        key={serviceOrder.id}
                        onClick={() => {
                          if (locked) return;
                          handleRowClick(serviceOrder);
                        }}
                        title={locked ? TECHNICIAN_LOCKED_MESSAGE : undefined}
                        aria-disabled={locked}
                        className={`px-4 py-3 transition-colors border-b ${locked
                          ? `cursor-not-allowed opacity-50 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`
                          : `cursor-pointer ${isDarkMode
                            ? `hover:bg-gray-800 border-gray-800 ${selectedServiceOrder?.id === serviceOrder.id ? 'bg-gray-800' : ''}`
                            : `hover:bg-gray-100 border-gray-200 ${selectedServiceOrder?.id === serviceOrder.id ? 'bg-gray-100' : ''}`}`
                          }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium text-sm mb-1 flex items-center space-x-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                              }`}>
                              <span>{serviceOrder.fullName}</span>
                              {locked && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                                  Locked
                                </span>
                              )}
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
                      );
                    })}
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
                          paginatedServiceOrders.map((serviceOrder) => {
                            const locked = isServiceOrderLocked(serviceOrder);
                            return (
                            <tr
                              key={serviceOrder.id}
                              className={`border-b transition-colors ${locked
                                ? `cursor-not-allowed opacity-50 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`
                                : `cursor-pointer ${isDarkMode
                                  ? `border-gray-800 hover:bg-gray-900 ${selectedServiceOrder?.id === serviceOrder.id ? 'bg-gray-800' : ''}`
                                  : `border-gray-200 hover:bg-gray-100 ${selectedServiceOrder?.id === serviceOrder.id ? 'bg-gray-100' : ''}`}`
                                }`}
                              title={locked ? TECHNICIAN_LOCKED_MESSAGE : undefined}
                              aria-disabled={locked}
                              onClick={() => {
                                if (locked) return;
                                handleRowClick(serviceOrder);
                              }}
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
                                  <div className="truncate flex items-center justify-between">
                                    <span className="truncate">{renderCellValue(serviceOrder, column.key)}</span>
                                    {column.key === 'fullName' && locked && (
                                      <span className={`ml-2 flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                                        Locked
                                      </span>
                                    )}
                                  </div>
                                </td>
                              ))}
                            </tr>
                            );
                          })
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
            isTechnicianLocked={isServiceOrderLocked(selectedServiceOrder)}
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
