import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Loader2, RefreshCw, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, Download, Columns3, ArrowUp, ArrowDown } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useWorkOrderStore } from '../store/workOrderStore';
import { WorkOrder } from '../types/workOrder';
import WorkOrderDetails from '../components/WorkOrderDetails';
import AssignWorkOrderModal from '../modals/AssignWorkOrderModal';
import pusher from '../services/pusherService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { exportToCSV } from '../utils/exportUtils';
import { isAgentUser } from '../utils/agentReferral';
import {
  buildTechnicianLockedWorkOrderIds,
  isTechnicianUser,
  sortWorkOrdersForTechnician,
  TECHNICIAN_LOCKED_MESSAGE
} from '../utils/technicianWorkOrderAccess';
import { authFetch } from '../config/api';
import { usePermissions } from '../hooks/usePermissions';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

const WorkOrderPage: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  const [searchQuery, setSearchQuery] = useState('');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { workOrders, isLoading, fetchWorkOrders, fetchUpdates, error } = useWorkOrderStore();
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const selectedWorkOrderRef = useRef<WorkOrder | null>(null);

  useEffect(() => {
    selectedWorkOrderRef.current = selectedWorkOrder;
  }, [selectedWorkOrder]);

  // Auto-update selectedWorkOrder when workOrders list updates (from Pusher or Refresh)
  useEffect(() => {
    if (selectedWorkOrderRef.current && workOrders.length > 0) {
      const updatedMatch = workOrders.find(r => r.id === selectedWorkOrderRef.current?.id);
      if (updatedMatch && JSON.stringify(updatedMatch) !== JSON.stringify(selectedWorkOrderRef.current)) {
        setSelectedWorkOrder(updatedMatch);
      }
    }
  }, [workOrders]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [deletingItems, setDeletingItems] = useState<Set<number>>(new Set());
  const [mobileView, setMobileView] = useState<'orders' | 'details'>('orders');
  const [hasNewData, setHasNewData] = useState<boolean>(false);

  const [globalModal, setGlobalModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: ''
  });

  const showGlobalModal = (
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning', 
    title: string, 
    message: string,
    onConfirm?: () => void
  ) => {
    setGlobalModal({
      isOpen: true,
      type,
      title,
      message,
      onConfirm
    });
  };

  const closeGlobalModal = () => {
    setGlobalModal(prev => ({ ...prev, isOpen: false }));
  };

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      // If we move to desktop view, ensure we are not stuck in mobile 'details' view
      if (!mobile && mobileView === 'details') {
        setMobileView('orders');
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileView]);

  const { can } = usePermissions();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [userRole, setUserRole] = useState<number | null>(null);
  const [userRoleName, setUserRoleName] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [userName, setUserName] = useState<string>('');

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const parsed = JSON.parse(authData);
        setUserRole(parsed.role_id || parsed.roleId || null);
        setUserRoleName(parsed.role || parsed.role_name || '');
        setUserEmail(parsed.email_address || parsed.email || '');
        setUserName(`${parsed.first_name || ''} ${parsed.last_name || ''}`.trim() || parsed.username || '');
        setCurrentUserOrgId(parsed.organization_id || parsed.user?.organization_id || parsed.organization?.id || parsed.user?.organization?.id || null);
      } catch (e) { }
    }
  }, []);

  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
    } catch {
      return null;
    }
  });
  const [displayMode, setDisplayMode] = useState<'card' | 'table'>(() => {
    const saved = localStorage.getItem('workOrderDisplayMode');
    return (saved as 'card' | 'table') || 'card';
  });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('workOrderVisibleColumns');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (err) {
        console.error('Failed to load work order visible columns:', err);
      }
    }
    return ['id', 'instructions', 'work_category', 'work_status', 'assign_to', 'requested_date'];
  });
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('workOrderColumnOrder');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (err) {
        console.error('Failed to load work order column order:', err);
      }
    }
    return [
      'id', 'instructions', 'work_category', 'work_status', 'assign_to', 'report_to',
      'requested_by', 'requested_date', 'remarks', 'updated_by', 'updated_date'
    ];
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('workOrderColumnWidths');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load work order column widths:', err);
      }
    }
    return {};
  });
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnDropdownOpen, setColumnDropdownOpen] = useState(false);
  const columnDropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const tableScrollRef = useRef<HTMLDivElement>(null);

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
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') !== 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setIsDarkMode(localStorage.getItem('theme') !== 'light');
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetchWorkOrders(1, 1000, '', '');
  }, [fetchWorkOrders]);

  // Real-time updates via Pusher/Soketi
  useEffect(() => {
    let lastRefreshTime = 0;
    const DEBOUNCE_MS = 10000; // Minimum 10s between Pusher-triggered refreshes

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
      const now = Date.now();
      if (now - lastRefreshTime < DEBOUNCE_MS) {
        return;
      }
      lastRefreshTime = now;

      try {
        await fetchWorkOrders(1, 1000, '', '');
      } catch (err) {
        console.error('[WorkOrder Soketi] Failed to refresh data:', err);
      }
    };

    const workOrderChannel = pusher.subscribe('work-orders');

    workOrderChannel.bind('pusher:subscription_succeeded', () => {
    });
    workOrderChannel.bind('pusher:subscription_error', (error: any) => {
      console.error('[WorkOrder Soketi] Subscription error:', error);
    });

    workOrderChannel.bind('work-order-updated', handleUpdate);

    // Re-subscribe on reconnection
    const stateHandler = (states: { previous: string; current: string }) => {
      if (states.current === 'connected' && workOrderChannel.subscribed !== true) {
        pusher.subscribe('work-orders');
      }
    };
    pusher.connection.bind('state_change', stateHandler);

    return () => {
      workOrderChannel.unbind('pusher:subscription_succeeded');
      workOrderChannel.unbind('pusher:subscription_error');
      workOrderChannel.unbind('work-order-updated', handleUpdate);
      pusher.connection.unbind('state_change', stateHandler);
      pusher.unsubscribe('work-orders');
    };
  }, [fetchWorkOrders, currentUserOrgId]);

  // Polling for updates every 3 seconds - Incremental fetch
  useEffect(() => {
    const POLLING_INTERVAL = 3000; // 3 seconds
    const intervalId = setInterval(async () => {
      try {
        await fetchUpdates('');
      } catch (err) {
        console.error('[WorkOrder Page] Polling failed:', err);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [fetchUpdates]);


  const handleDelete = (workOrder: WorkOrder) => {
    showGlobalModal(
      'confirm',
      'Confirm Deletion',
      `Are you sure you want to permanently delete this work order?`,
      () => executeDelete(workOrder)
    );
  };

  const executeDelete = async (workOrder: WorkOrder) => {
    closeGlobalModal();
    
    setDeletingItems(prev => new Set(prev).add(workOrder.id));
    showGlobalModal('loading', 'Deleting', 'Removing work order from system...');

    try {
      const response = await authFetch(`${API_BASE_URL}/work-orders/${workOrder.id}`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        await fetchWorkOrders(1, 1000, '', '');
        showGlobalModal('success', 'Deleted', 'Work order deleted successfully');
      } else {
        showGlobalModal('error', 'Delete Failed', data.message || 'Failed to delete work order');
      }
    } catch (error: any) {
      console.error('Error deleting work order:', error);
      showGlobalModal('error', 'Error', error.message || 'An unexpected error occurred during deletion');
    } finally {
      setDeletingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(workOrder.id);
        return newSet;
      });
    }
  };

  const handleEdit = (workOrder: WorkOrder) => {
    setSelectedWorkOrder(workOrder);
    if (window.innerWidth >= 768) {
      setMobileView('orders');
    } else {
      setMobileView('details');
    }
  };

  const handleMobileBack = () => {
    if (mobileView === 'details') {
      setSelectedWorkOrder(null);
      setMobileView('orders');
    }
  };

  // Agents have read-only access to their assigned work orders — they cannot raise new
  // ones, matching the mobile app where the "add" action is hidden for them.
  const isAgentView = isAgentUser(userRoleName, userRole);

  // Raising or reassigning a work order, as opposed to working one already
  // assigned to you. Keyed on the permission rather than on "is this an agent",
  // so a custom role gets the same treatment and so the button agrees with the
  // API — /api/work-orders writes require this same key.
  const canManageWorkOrders = can('work-order.manage');

  const handleAddNew = () => {
    if (!canManageWorkOrders) return;
    setSelectedWorkOrder(null);
    setShowAssignModal(true);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
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
      return dateString;
    }
  };

  /**
   * Technicians only — narrower than the OSP/agent check below. The queue
   * ordering and the lock are for the role that actually carries the work out.
   */
  const isTechnician = isTechnicianUser(userRoleName, userRole);

  const filteredWorkOrders = useMemo(() => {
    let filtered = workOrders;

    // Organization filter — only show records matching the current user's org
    filtered = filtered.filter((wo: WorkOrder) => {
      if (currentUserOrgId) {
        // User belongs to an org: only show work orders assigned to that same org
        return wo.organization_id === currentUserOrgId;
      } else {
        // User has no org: only show work orders that have no org assigned
        return !wo.organization_id;
      }
    });

    // Apply role-based filtering for OSP (6) and Agent (4): they only see work orders
    // assigned to them, matching the mobile app.
    if (Number(userRole) === 6 || isAgentUser(userRoleName, userRole)) {
      filtered = filtered.filter(wo => {
        // Find if user is assigned - assign_to can be either name or email
        const targetAssign = (wo.assign_to || '').toLowerCase().trim();
        const meEmail = userEmail.toLowerCase().trim();
        const meName = userName.toLowerCase().trim();
        return (!!meEmail && targetAssign === meEmail) || (!!meName && targetAssign === meName);
      });
    }

    if (searchQuery) {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      filtered = filtered.filter(wo => {
        const checkValue = (val: any): boolean => {
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
        };

        return (
          checkValue(wo.instructions) ||
          checkValue(wo.report_to) ||
          checkValue(wo.assign_to) ||
          checkValue(wo.requested_by)
        );
      });
    }

    // Technicians read their list in the order they work it: In Progress oldest
    // first, then other active work, with Done / Failed / On Hold at the end.
    // Every other role keeps the API's requested_date-descending order.
    if (isTechnician) {
      return sortWorkOrdersForTechnician(filtered);
    }

    return filtered;
  }, [workOrders, userRole, userRoleName, userEmail, userName, searchQuery, currentUserOrgId, isTechnician]);

  /**
   * The work orders a technician may not open yet.
   *
   * Built from the whole store set, not the filtered or paginated view, so
   * searching, filtering or paging can never change whose turn it is. The util
   * narrows to the records actually assigned to this technician — the work order
   * API returns the whole organisation, unlike job and service orders, and this
   * page does not narrow it for technicians either.
   */
  const technicianLockedIds = useMemo(() => {
    if (!isTechnician) return new Set<string>();
    return buildTechnicianLockedWorkOrderIds(workOrders, { email: userEmail, fullName: userName });
  }, [isTechnician, workOrders, userEmail, userName]);

  const isWorkOrderLocked = (wo: WorkOrder): boolean =>
    technicianLockedIds.has(String(wo.id));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, itemsPerPage]);

  const totalPages = Math.ceil(filteredWorkOrders.length / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  // Scroll to top on page change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

  const paginatedWorkOrders = useMemo(() => {
    return filteredWorkOrders.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage
    );
  }, [filteredWorkOrders, currentPage, itemsPerPage]);

  const PaginationControls = () => {
    if (filteredWorkOrders.length === 0) return null;

    return (
      <div className={`border-t p-4 flex flex-col md:flex-row items-center md:justify-between gap-3 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200 shadow-lg'}`}>
        <div className={`flex flex-col sm:flex-row items-center gap-3 text-xs text-center sm:text-left ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          <div className="flex items-center gap-2">
            <span>Show</span>
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
            <span>entries</span>
          </div>
          <div>
            Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredWorkOrders.length)}</span> of <span className="font-medium">{filteredWorkOrders.length}</span> results
          </div>
        </div>
        <div className="flex items-center flex-wrap justify-center gap-1">
          <button
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
            className={`p-1.5 rounded transition-colors ${currentPage === 1
              ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
              : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
              }`}
            title="First Page"
          >
            <ChevronsLeft size={14} />
          </button>

          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className={`p-1.5 rounded transition-colors ${currentPage === 1
              ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
              : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
              }`}
          >
            <ChevronLeft size={14} />
          </button>

          <div className="flex items-center space-x-1">
            <span className={`px-2 text-xs font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Page {currentPage} of {totalPages}
            </span>
          </div>

          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages || totalPages <= 1}
            className={`p-1.5 rounded transition-colors ${currentPage === totalPages || totalPages <= 1
              ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
              : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
              }`}
          >
            <ChevronRight size={14} />
          </button>

          <button
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages || totalPages <= 1}
            className={`p-1.5 rounded transition-colors ${currentPage === totalPages || totalPages <= 1
              ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
              : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
              }`}
            title="Last Page"
          >
            <ChevronsRight size={14} />
          </button>
        </div>
      </div>
    );
  };

  const getStatusColor = (status?: string) => {
    if (!status) return isDarkMode ? 'text-gray-500' : 'text-gray-400';
    switch (status.toLowerCase()) {
      case 'completed': return 'text-green-500';
      case 'in progress': return 'text-blue-500';
      case 'failed':
      case 'cancelled': return 'text-red-500';
      case 'pending':
      case 'scheduled': return isDarkMode ? 'text-gray-400' : 'text-gray-500';
      default: return isDarkMode ? 'text-gray-500' : 'text-gray-400';
    }
  };

  const handleRefresh = async () => {
    setHasNewData(false);
    await fetchWorkOrders(1, 1000, '', '');
  };

  const workOrderColumns = [
    { key: 'id', label: 'ID', width: 'min-w-20' },
    { key: 'instructions', label: 'Instructions', width: 'min-w-64' },
    { key: 'work_category', label: 'Work Category', width: 'min-w-40' },
    { key: 'work_status', label: 'Status', width: 'min-w-32' },
    { key: 'assign_to', label: 'Assigned To', width: 'min-w-40' },
    { key: 'report_to', label: 'Report To', width: 'min-w-40' },
    { key: 'requested_by', label: 'Requested By', width: 'min-w-40' },
    { key: 'requested_date', label: 'Requested Date', width: 'min-w-40' },
    { key: 'remarks', label: 'Remarks', width: 'min-w-64' },
    { key: 'updated_by', label: 'Updated By', width: 'min-w-40' },
    { key: 'updated_date', label: 'Updated Date', width: 'min-w-40' },
  ];

  const filteredColumns = useMemo(() => {
    return workOrderColumns
      .filter(col => visibleColumns.includes(col.key))
      .sort((a, b) => {
        const indexA = columnOrder.indexOf(a.key);
        const indexB = columnOrder.indexOf(b.key);
        return indexA - indexB;
      });
  }, [visibleColumns, columnOrder]);

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const next = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      localStorage.setItem('workOrderVisibleColumns', JSON.stringify(next));
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = workOrderColumns.map(col => col.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('workOrderVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('workOrderVisibleColumns', JSON.stringify([]));
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
    localStorage.setItem('workOrderColumnOrder', JSON.stringify(newOrder));
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
      const newWidth = Math.max(80, startWidthRef.current + diff);
      setColumnWidths(prev => {
        const next = { ...prev, [resizingColumn]: newWidth };
        localStorage.setItem('workOrderColumnWidths', JSON.stringify(next));
        return next;
      });
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
      if (columnDropdownRef.current && !columnDropdownRef.current.contains(event.target as Node)) {
        setColumnDropdownOpen(false);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sortedWorkOrders = useMemo(() => {
    if (!sortColumn) return filteredWorkOrders;
    return [...filteredWorkOrders].sort((a, b) => {
      let aValue: any = (a as any)[sortColumn];
      let bValue: any = (b as any)[sortColumn];
      if (typeof aValue === 'string') aValue = aValue.toLowerCase();
      if (typeof bValue === 'string') bValue = bValue.toLowerCase();
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredWorkOrders, sortColumn, sortDirection]);

  const handleExport = () => {
    if (!filteredWorkOrders || filteredWorkOrders.length === 0) return;

    const getExportValue = (record: WorkOrder, columnKey: string) => {
      switch (columnKey) {
        case 'id': return record.id;
        case 'instructions': return record.instructions || '-';
        case 'work_category': return record.work_category || '-';
        case 'work_status': return record.work_status || '-';
        case 'assign_to': return record.assign_to || '-';
        case 'report_to': return record.report_to || '-';
        case 'requested_by': return record.requested_by || '-';
        case 'requested_date': return formatDate(record.requested_date);
        case 'remarks': return record.remarks || '-';
        case 'updated_by': return record.updated_by || '-';
        case 'updated_date': return formatDate(record.updated_date);
        default: return '-';
      }
    };

    exportToCSV('work_orders_export', workOrderColumns, filteredWorkOrders, getExportValue);
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className={`overflow-hidden flex-1 flex flex-col md:pb-0 ${mobileView === 'details' ? 'hidden md:flex' : ''}`}>
        <div className="flex flex-col h-full">
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center justify-between space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
              <div className="flex items-center space-x-3 flex-1 min-w-[250px] flex-shrink-0">
                <div className="flex-1 w-full flex-shrink-0">
                  <GlobalSearch
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    isDarkMode={isDarkMode}
                    colorPalette={colorPalette}
                    placeholder="Search Work Orders"
                  />
                </div>
              </div>
              <div className="flex items-center space-x-2 flex-shrink-0">
                {displayMode === 'table' && (
                  <div className="relative z-50 flex-shrink-0" ref={columnDropdownRef}>
                    <button
                      className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                        ? 'hover:bg-gray-800 text-white'
                        : 'hover:bg-gray-100 text-gray-900'
                        }`}
                      onClick={() => setColumnDropdownOpen(!columnDropdownOpen)}
                      title="Column Visibility"
                    >
                      <Columns3 className="h-5 w-5" />
                    </button>
                    {columnDropdownOpen && (
                      <div className={`fixed mt-10 w-80 border rounded shadow-lg z-50 max-h-96 flex flex-col -translate-x-[calc(100%-3.5rem)] ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                        }`}>
                        <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                          }`}>
                          <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>Column Visibility</span>
                          <div className="flex space-x-2">
                            <button
                              onClick={handleSelectAllColumns}
                              className="text-xs transition-colors"
                              style={{ color: colorPalette?.primary || '#7c3aed' }}
                              onMouseEnter={(e) => { if (colorPalette?.accent) { e.currentTarget.style.color = colorPalette.accent; } }}
                              onMouseLeave={(e) => { if (colorPalette?.primary) { e.currentTarget.style.color = colorPalette.primary; } }}
                            >
                              Select All
                            </button>
                            <span className="text-gray-600">|</span>
                            <button
                              onClick={handleDeselectAllColumns}
                              className="text-xs transition-colors"
                              style={{ color: colorPalette?.primary || '#7c3aed' }}
                              onMouseEnter={(e) => { if (colorPalette?.accent) { e.currentTarget.style.color = colorPalette.accent; } }}
                              onMouseLeave={(e) => { if (colorPalette?.primary) { e.currentTarget.style.color = colorPalette.primary; } }}
                            >
                              Deselect All
                            </button>
                          </div>
                        </div>
                        <div className="overflow-y-auto flex-1">
                          {workOrderColumns.map((column) => (
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
                    className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                      ? 'hover:bg-gray-800 text-white'
                      : 'hover:bg-gray-100 text-gray-900'
                      }`}
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                  >
                    <span>{displayMode === 'card' ? 'Card' : 'Table'}</span>
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {dropdownOpen && (
                    <div className={`fixed right-auto mt-1 w-36 border rounded shadow-lg ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                      }`}>
                      <button
                        onClick={() => {
                          setDisplayMode('card');
                          localStorage.setItem('workOrderDisplayMode', 'card');
                          setDropdownOpen(false);
                        }}
                        className={`block w-full text-left px-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                          }`}
                        style={displayMode === 'card' ? { color: colorPalette?.primary || '#7c3aed' } : { color: isDarkMode ? '#ffffff' : '#111827' }}
                      >
                        Card View
                      </button>
                      <button
                        onClick={() => {
                          setDisplayMode('table');
                          localStorage.setItem('workOrderDisplayMode', 'table');
                          setDropdownOpen(false);
                        }}
                        className={`block w-full text-left px-4 py-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                          }`}
                        style={displayMode === 'table' ? { color: colorPalette?.primary || '#7c3aed' } : { color: isDarkMode ? '#ffffff' : '#111827' }}
                      >
                        Table View
                      </button>
                    </div>
                  )}
                </div>
                {canManageWorkOrders && (
                  <button
                    onClick={handleAddNew}
                    className="px-4 py-2 text-white rounded-lg flex items-center gap-2 transition-all font-medium text-xs active:scale-95 shadow-sm flex-shrink-0"
                    style={{
                      backgroundColor: colorPalette?.primary || '#7c3aed'
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    <span className="hidden md:inline">Add Work Order</span>
                  </button>
                )}
                <button
                  onClick={handleExport}
                  disabled={isLoading || filteredWorkOrders.length === 0}
                  title="Export to CSV"
                  className="relative flex-shrink-0 p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: colorPalette?.primary || '#7c3aed',
                    color: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading && filteredWorkOrders.length > 0 && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading && filteredWorkOrders.length > 0) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <Download className="h-5 w-5" />
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={isLoading}
                  title="Refresh List"
                  className="relative flex-shrink-0 p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: colorPalette?.primary || '#7c3aed',
                    color: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <RefreshCw
                    className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`}
                    style={{
                      color: colorPalette?.primary || '#7c3aed'
                    }}
                  />
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

          <div className="flex-1 overflow-auto custom-scrollbar" ref={scrollRef}>
            {isLoading && workOrders.length === 0 ? (
              <div className="flex justify-center items-center py-20">
                <Loader2 className={`h-8 w-8 animate-spin ${isDarkMode ? 'text-white' : 'text-gray-900'}`} />
              </div>
            ) : error ? (
              <div className="text-center py-20 text-red-500 font-bold whitespace-pre-wrap px-4">{error}</div>
            ) : displayMode === 'card' ? (
              <div className="flex-1 overflow-auto custom-scrollbar" ref={scrollRef}>
                {paginatedWorkOrders.length > 0 ? (
                  <div>
                    {paginatedWorkOrders.map((wo) => {
                      const locked = isWorkOrderLocked(wo);
                      return (
                      <div
                        key={wo.id}
                        className={`border-b group transition-colors ${locked
                          ? `cursor-not-allowed opacity-50 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`
                          : `cursor-pointer ${isDarkMode ? 'bg-gray-900 border-gray-800 hover:bg-gray-800/50' : 'bg-white border-gray-200 hover:bg-gray-50'}`}`}
                        title={locked ? TECHNICIAN_LOCKED_MESSAGE : undefined}
                        aria-disabled={locked}
                        onClick={() => {
                          if (locked) return;
                          handleEdit(wo);
                        }}
                      >
                        <div className="px-4 py-3 flex items-center justify-between">
                          <div className="flex-1 min-w-0 pr-4">
                            <h3 className={`font-medium text-sm uppercase tracking-wide transition-transform duration-200 ${locked ? '' : 'group-hover:translate-x-1'} ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {wo.instructions || `WORK ORDER #${wo.id}`}
                              {locked && (
                                <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                                  Locked
                                </span>
                              )}
                            </h3>
                            <div className={`flex items-center gap-4 mt-1 text-[10px] uppercase font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              {wo.work_category && (
                                <span>Category: {wo.work_category}</span>
                              )}
                              <span>Requested Date: {formatDate(wo.requested_date)}</span>
                              <span>Report To: {wo.report_to || 'Pending'}</span>
                            </div>
                          </div>
                          <span className={`text-xs font-bold uppercase tracking-wide whitespace-nowrap ${
                            wo.work_status?.toLowerCase() === 'completed' || wo.work_status?.toLowerCase() === 'done'
                              ? 'text-green-500'
                              : wo.work_status?.toLowerCase() === 'in progress'
                                ? 'text-blue-500'
                                : wo.work_status?.toLowerCase() === 'failed' || wo.work_status?.toLowerCase() === 'cancelled'
                                  ? 'text-red-500'
                                  : isDarkMode ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                            {(wo.work_status || 'Scheduled').toUpperCase()}
                          </span>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={`text-center py-20 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    No work orders found
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col">
                <div className="flex-1 overflow-auto custom-scrollbar" ref={tableScrollRef}>
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead>
                      <tr className={`sticky top-0 z-20 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-100 border-gray-200'}`}>
                        {filteredColumns.map((column, index) => (
                          <th
                            key={column.key}
                            draggable
                            onDragStart={(e) => handleDragStart(e, column.key)}
                            onDragOver={(e) => handleDragOver(e, column.key)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, column.key)}
                            onDragEnd={handleDragEnd}
                            className={`text-left py-3 px-3 font-semibold uppercase tracking-wider text-[10px] border-b relative group cursor-move whitespace-nowrap ${
                              isDarkMode ? 'text-gray-400 border-gray-700' : 'text-gray-600 border-gray-200'
                            } ${draggedColumn === column.key ? 'opacity-30' : ''} ${dragOverColumn === column.key ? 'bg-purple-500/10' : ''}`}
                            style={{ width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined }}
                          >
                            <div className="flex items-center justify-between">
                              <span>{column.label}</span>
                              <button onClick={() => handleSort(column.key)} className="ml-1 opacity-40 hover:opacity-100 transition-opacity">
                                {sortColumn === column.key ? (
                                  sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                                ) : (
                                  <ArrowUp className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                            {index < filteredColumns.length - 1 && (
                              <div
                                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-purple-500/50"
                                onMouseDown={(e) => handleMouseDownResize(e, column.key)}
                              />
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedWorkOrders.map((wo) => {
                        const locked = isWorkOrderLocked(wo);
                        return (
                        <tr
                          key={wo.id}
                          onClick={() => {
                            if (locked) return;
                            handleEdit(wo);
                          }}
                          title={locked ? TECHNICIAN_LOCKED_MESSAGE : undefined}
                          aria-disabled={locked}
                          className={`transition-colors border-b ${locked
                            ? `cursor-not-allowed opacity-50 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`
                            : `cursor-pointer ${isDarkMode ? 'hover:bg-gray-800/50 border-gray-800' : 'hover:bg-gray-50 border-gray-100'}`
                          } ${selectedWorkOrder?.id === wo.id && !locked ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
                        >
                          {filteredColumns.map((column) => (
                            <td
                              key={column.key}
                              className={`py-3 px-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
                              style={{
                                width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                maxWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                              }}
                            >
                              <div className="truncate">
                                {(() => {
                                  const val = (wo as any)[column.key];
                                  if (column.key === 'requested_date' || column.key === 'updated_date') return formatDate(val);
                                  if (column.key === 'work_status') {
                                    return (
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                        val?.toLowerCase() === 'completed' || val?.toLowerCase() === 'done' ? 'bg-green-500/10 text-green-500' : 
                                        val?.toLowerCase() === 'in progress' ? 'bg-blue-500/10 text-blue-500' :
                                        val?.toLowerCase() === 'failed' || val?.toLowerCase() === 'cancelled' ? 'bg-red-500/10 text-red-500' :
                                        'bg-gray-500/10 text-gray-500'
                                      }`}>
                                        {val || 'Scheduled'}
                                      </span>
                                    );
                                  }
                                  return val || '-';
                                })()}
                              </div>
                            </td>
                          ))}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          {!isLoading && filteredWorkOrders.length > 0 && <PaginationControls />}
        </div>
      </div>

      {selectedWorkOrder && (
        <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:flex-shrink-0 md:overflow-hidden">
          <WorkOrderDetails
            workOrder={selectedWorkOrder}
            onClose={() => {
              setSelectedWorkOrder(null);
              setMobileView('orders');
            }}
            onRefresh={handleRefresh}
            isMobile={isMobile}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
          />
        </div>
      )}

      {showAssignModal && (
        <AssignWorkOrderModal
          isOpen={showAssignModal}
          onClose={() => setShowAssignModal(false)}
          onSave={() => {
            setShowAssignModal(false);
            fetchWorkOrders(1, 1000, '', '');
          }}
          onRefresh={() => fetchWorkOrders(1, 1000, '', '')}
        />
      )}

      <LoadingModalGlobal
        isOpen={globalModal.isOpen}
        type={globalModal.type}
        title={globalModal.title}
        message={globalModal.message}
        onConfirm={globalModal.onConfirm || closeGlobalModal}
        onCancel={closeGlobalModal}
        colorPalette={colorPalette}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};

export default WorkOrderPage;
