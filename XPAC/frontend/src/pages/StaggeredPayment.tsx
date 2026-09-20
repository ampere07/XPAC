import React, { useState, useEffect, useRef } from 'react';
import { ChevronsLeft, ChevronsRight, X, Menu, Globe, Calendar, RefreshCw , ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Columns3, Download } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import StaggeredListDetails from '../components/StaggeredListDetails';
import StaggeredInstallationFormModal from '../modals/StaggeredInstallationFormModal';
import { useStaggeredPaymentContext, StaggeredInstallation } from '../contexts/StaggeredPaymentContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import pusher from '../services/pusherService';
import apiClient from '../config/api';
import SessionExpiredModal from '../components/SessionExpiredModal';
import { exportToCSV } from '../utils/exportUtils';
import { usePermissions } from '../hooks/usePermissions';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

const allColumns = [
  { key: 'staggered_install_no', label: 'ID', width: 'min-w-28' },
  { key: 'account_no', label: 'Account No', width: 'min-w-36' },
  { key: 'full_name', label: 'Customer Name', width: 'min-w-48' },
  { key: 'staggered_date', label: 'Date', width: 'min-w-36' },
  { key: 'staggered_balance', label: 'Total Amount', width: 'min-w-32' },
  { key: 'monthly_payment', label: 'Monthly', width: 'min-w-28' },
  { key: 'months_to_pay', label: 'Months', width: 'min-w-24' },
  { key: 'status', label: 'Status', width: 'min-w-28' },
  { key: 'plan', label: 'Plan', width: 'min-w-36' },
  { key: 'address', label: 'Address', width: 'min-w-64' },
  { key: 'remarks', label: 'Remarks', width: 'min-w-48' },
];

const StaggeredPayment: React.FC = () => {
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStaggered, setSelectedStaggered] = useState<StaggeredInstallation | null>(null);


  const selectedStaggeredRef = useRef<StaggeredInstallation | null>(null);
  const { staggeredRecords, isLoading, error, refreshStaggeredRecords, silentRefresh, isFullyLoaded } = useStaggeredPaymentContext();
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Column management states
  const [sortColumn, setSortColumn] = useState<string | null>('staggered_date');
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

  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isStaggeredFormModalOpen, setIsStaggeredFormModalOpen] = useState<boolean>(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [staggeredDateFrom, setStaggeredDateFrom] = useState<string>('');
  const [staggeredDateTo, setStaggeredDateTo] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [viewers, setViewers] = useState<Record<string, string[]>>({});
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
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
        console.error('Error parsing auth data in StaggeredPayment:', error);
      }
    }
  }, []);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
  const { can: hasPermission } = usePermissions();

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

  const formatCurrency = (amount: number | string) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return `₱${numAmount.toFixed(2)}`;
  };

  const formatDate = (dateStr?: string, includeTime: boolean = false): string => {
    if (!dateStr) return 'No date';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();

      if (includeTime) {
        let hours = date.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${mm}/${dd}/${yyyy} ${hours}:${minutes}:${seconds} ${ampm}`;
      }

      return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
      return dateStr;
    }
  };

  const globalFilteredRecords = React.useMemo(() => {
    const authData = JSON.parse(localStorage.getItem('authData') || '{}');
    const userOrgId = authData.organization_id;

    let filtered = staggeredRecords;

    if (userOrgId) {
      filtered = filtered.filter((record: StaggeredInstallation) => !record.organization_id || record.organization_id === userOrgId);
    }

    if (searchQuery) {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') {
          return Object.values(val).some(v => checkValue(v));
        }
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };

      filtered = filtered.filter(record => checkValue(record));
    }

    if (staggeredDateFrom || staggeredDateTo) {
      filtered = filtered.filter(record => {
        if (!record.staggered_date) return false;

        const dateValue = new Date(record.staggered_date).getTime();
        if (isNaN(dateValue)) return false;

        if (staggeredDateFrom) {
          const fromDate = new Date(staggeredDateFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (dateValue < fromDate.getTime()) return false;
        }

        if (staggeredDateTo) {
          const toDate = new Date(staggeredDateTo);
          toDate.setHours(23, 59, 59, 999);
          if (dateValue > toDate.getTime()) return false;
        }

        return true;
      });
    }

    return filtered;
  }, [staggeredRecords, searchQuery, staggeredDateFrom, staggeredDateTo]);

  const dateItems = React.useMemo(() => {
    const dateCounts: Record<string, number> = {};
    const dates = new Map<string, string>();

    globalFilteredRecords.forEach(record => {
      if (record.staggered_date) {
        const formatted = new Date(record.staggered_date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
        dateCounts[formatted] = (dateCounts[formatted] || 0) + 1;
        dates.set(formatted, record.staggered_date);
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
    selectedStaggeredRef.current = selectedStaggered;
  }, [selectedStaggered]);

  // Auto-update selectedStaggered when staggeredRecords list updates (from Pusher or Refresh)
  useEffect(() => {
    if (selectedStaggeredRef.current && staggeredRecords.length > 0) {
      const updatedMatch = staggeredRecords.find(r => r.id === selectedStaggeredRef.current?.id);
      if (updatedMatch && JSON.stringify(updatedMatch) !== JSON.stringify(selectedStaggeredRef.current)) {
        setSelectedStaggered(updatedMatch);
      }
    }
  }, [staggeredRecords]);

  useEffect(() => {
    const presenceChannel = pusher.subscribe('presence-staggered-installations-presence');

    presenceChannel.bind('viewing-update', (data: { staggeredId: string; username: string; action: string }) => {
      setViewers(prev => {
        const username = data.username;
        const currentViewers = prev[data.staggeredId] || [];
        if (data.action === 'started_viewing') {
          if (!currentViewers.includes(username)) {
            return { ...prev, [data.staggeredId]: [...currentViewers, username] };
          }
        } else if (data.action === 'stopped_viewing') {
          return { ...prev, [data.staggeredId]: currentViewers.filter(name => name !== username) };
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

    presenceChannel.bind('pusher:member_added', (member: any) => {
      if (selectedStaggeredRef.current) {
        broadCastViewing(String(selectedStaggeredRef.current.id), 'started_viewing');
      }
    });

    return () => {
      presenceChannel.unbind_all();
      pusher.unsubscribe('presence-staggered-installations-presence');
    };
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
    silentRefresh();
  }, [silentRefresh]);

  useEffect(() => {
    const handleUpdate = async (data: any) => {
      setHasNewData(true);
      try {
        await silentRefresh();
      } catch (err) {
        console.error('[Staggered Soketi] Failed to refresh data:', err);
      }
    };

    const staggeredChannel = pusher.subscribe('staggered');

    staggeredChannel.bind('staggered-updated', handleUpdate);

    return () => {
      staggeredChannel.unbind('staggered-updated', handleUpdate);
      pusher.unsubscribe('staggered');
    };
  }, [silentRefresh]);

  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000;
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      try {
        await silentRefresh();
      } catch (err) {
        console.error('Idle refresh failed:', err);
      }
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

    startTimer();

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [silentRefresh]);

  useEffect(() => {
    if (allColumns.length > 0) {
      setColumnOrder(allColumns.map(col => col.key));
      setVisibleColumns(['staggered_install_no', 'account_no', 'full_name', 'staggered_date', 'staggered_balance', 'monthly_payment', 'months_to_pay', 'status']);
    }
  }, []);

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const newColumns = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      return newColumns;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map(col => col.key);
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

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingColumn) return;

      const diff = e.clientX - startXRef.current;
      const newWidth = Math.max(80, startWidthRef.current + diff);

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

  const handleRefresh = async () => {
    setHasNewData(false);
    setIsRefreshingManual(true);
    try {
      await silentRefresh();
    } finally {
      setIsRefreshingManual(false);
    }
  };

  const broadCastViewing = async (id: string, action: string) => {
    try {
      await apiClient.post('/staggered-installations/broadcast-viewing', {
        staggered_id: id,
        action: action
      });
    } catch (err) {
      console.error('[Presence] Failed to broadcast viewing:', err);
    }
  };

  const handleRowClick = (record: StaggeredInstallation) => {
    if (selectedStaggered && selectedStaggered.id !== record.id) {
      broadCastViewing(String(selectedStaggered.id), 'stopped_viewing');
    }
    
    if (selectedStaggered?.id !== record.id) {
      broadCastViewing(String(record.id), 'started_viewing');
    }

    setSelectedStaggered(record);
    setSelectedCustomer(null);
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

  const filteredRecords = React.useMemo(() => {
    let filtered = globalFilteredRecords.filter(record => {
      if (selectedDate === 'All') return true;
      if (!record.staggered_date) return false;
      const recordDateFormatted = new Date(record.staggered_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      return recordDateFormatted === selectedDate;
    });

    if (sortColumn) {
      filtered = [...filtered].sort((a: any, b: any) => {
        let aValue: any;
        let bValue: any;

        if (sortColumn === 'full_name') {
          aValue = a.billing_account?.customer?.full_name || '';
          bValue = b.billing_account?.customer?.full_name || '';
        } else if (sortColumn === 'plan') {
          aValue = a.billing_account?.customer?.desired_plan || '';
          bValue = b.billing_account?.customer?.desired_plan || '';
        } else if (sortColumn === 'address') {
          aValue = a.billing_account?.customer?.address || '';
          bValue = b.billing_account?.customer?.address || '';
        } else {
          aValue = a[sortColumn] || '';
          bValue = b[sortColumn] || '';
        }

        if (sortColumn === 'staggered_balance' || sortColumn === 'monthly_payment' || sortColumn === 'months_to_pay') {
          aValue = Number(aValue) || 0;
          bValue = Number(bValue) || 0;
        } else if (sortColumn === 'staggered_date' || sortColumn === 'updated_at' || sortColumn === 'modified_date') {
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

  const currentStaggeredIndex = React.useMemo(() => {
    if (!selectedStaggered || !filteredRecords) return -1;
    return filteredRecords.findIndex(r => r.id === selectedStaggered.id);
  }, [filteredRecords, selectedStaggered]);

  const handlePreviousRecord = () => {
    if (currentStaggeredIndex > 0) {
      const prevRecord = filteredRecords[currentStaggeredIndex - 1];
      handleRowClick(prevRecord);
    }
  };

  const handleNextRecord = () => {
    if (currentStaggeredIndex >= 0 && currentStaggeredIndex < filteredRecords.length - 1) {
      const nextRecord = filteredRecords[currentStaggeredIndex + 1];
      handleRowClick(nextRecord);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDate, itemsPerPage, staggeredDateFrom, staggeredDateTo]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

  useEffect(() => {
    return () => {
      if (selectedStaggered) {
        broadCastViewing(String(selectedStaggered.id), 'stopped_viewing');
      }
    };
  }, [selectedStaggered]);

  const paginatedRecords = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRecords.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRecords, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const PaginationControls = () => {
    if (totalPages <= 1) return null;

    return (
      <div className={`flex items-center justify-between px-4 py-3 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className={`flex items-center gap-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
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
            Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredRecords.length)}</span> of <span className="font-medium">{filteredRecords.length}</span> results
          </span>
        </div>
        <div className="flex items-center space-x-2">
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

  const StatusBadge = ({ status }: { status: string }) => {
    let colorClass = '';

    switch (status.toLowerCase()) {
      case 'active':
        colorClass = 'text-green-500';
        break;
      case 'pending':
        colorClass = 'text-yellow-500';
        break;
      case 'completed':
        colorClass = 'text-blue-500';
        break;
      default:
        colorClass = 'text-gray-400';
    }

    return (
      <span className={`${colorClass} capitalize`}>
        {status}
      </span>
    );
  };

  const renderCellValue = (record: StaggeredInstallation, columnKey: string) => {
    switch (columnKey) {
      case 'staggered_install_no':
        return record.staggered_install_no;
      case 'account_no':
        return <span className="text-red-400 font-medium">{record.account_no || '-'}</span>;
      case 'full_name':
        return record.billing_account?.customer?.full_name || '-';
      case 'staggered_date':
        return formatDate(record.staggered_date);
      case 'staggered_balance':
        return formatCurrency(record.staggered_balance);
      case 'monthly_payment':
        return formatCurrency(record.monthly_payment);
      case 'months_to_pay':
        return <span className={record.months_to_pay === 0 ? 'text-green-500 font-bold' : 'font-bold'} style={record.months_to_pay !== 0 ? { color: colorPalette?.accent || '#7c3aed' } : {}}>{record.months_to_pay}</span>;
      case 'status':
        return <StatusBadge status={record.status} />;
      case 'plan':
        return record.billing_account?.customer?.desired_plan || '-';
      case 'address':
        return record.billing_account?.customer?.address || '-';
      case 'remarks':
        return record.remarks || '-';
      case 'modified_by':
        return record.modified_by || '-';
      case 'modified_date':
        return formatDate(record.modified_date, true);
      case 'updated_at':
        return formatDate(record.updated_at, true);
      default:
        return '-';
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

    const getExportValue = (record: StaggeredInstallation, columnKey: string) => {
      switch (columnKey) {
        case 'account_no':
          return record.account_no || '-';
        case 'full_name':
          return record.billing_account?.customer?.full_name || '-';
        case 'staggered_date':
          return formatDate(record.staggered_date);
        case 'staggered_balance':
          return formatCurrency(record.staggered_balance);
        case 'monthly_payment':
          return formatCurrency(record.monthly_payment);
        case 'months_to_pay':
          return record.months_to_pay;
        case 'status':
          return record.status || '-';
        case 'plan':
          return record.billing_account?.customer?.desired_plan || '-';
        case 'address':
          return record.billing_account?.customer?.address || '-';
        case 'remarks':
          return record.remarks || '-';
        default:
          return renderCellValue(record, columnKey);
      }
    };

    exportToCSV('staggered_payment_export', exportColumns, filteredRecords, getExportValue);
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

  const handleOpenStaggeredFormModal = () => {
    setIsStaggeredFormModalOpen(true);
  };

  const handleCloseStaggeredFormModal = () => {
    setIsStaggeredFormModalOpen(false);
  };

  const handleSaveStaggered = async (formData: any) => {
    try {
      await handleRefresh();
      handleCloseStaggeredFormModal();
    } catch (error) {
      console.error('Error saving staggered installation:', error);
    }
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden pb-16 md:pb-0 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      <div className={`hidden md:flex border-r flex-shrink-0 flex flex-col relative ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`} style={{ width: `${sidebarWidth}px` }}>
        <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
          <div className="flex items-center justify-between mb-1">
            <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Staggered</h2>
            {hasPermission('staggered-payment.add') && (
              <div>
                <button
                  className="flex items-center space-x-1 text-white px-3 py-1 rounded text-sm transition-colors"
                  onClick={handleOpenStaggeredFormModal}
                  style={{
                    backgroundColor: colorPalette?.primary || '#7c3aed'
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
                  <span className="font-bold">+</span>
                  <span>Add</span>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Staggered Date Range
              </span>
              {(staggeredDateFrom || staggeredDateTo) && (
                <button
                  onClick={() => {
                    setStaggeredDateFrom('');
                    setStaggeredDateTo('');
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
                  value={staggeredDateFrom}
                  onChange={(e) => setStaggeredDateFrom(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={staggeredDateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
              <div className="relative">
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                <input
                  type="date"
                  value={staggeredDateTo}
                  onChange={(e) => setStaggeredDateTo(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={staggeredDateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
            </div>
          </div>

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

          {dateItems.dates.map((item, index) => (
            <button
              key={index}
              onClick={() => setSelectedDate(item.date)}
              className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                } ${selectedDate === item.date
                  ? ''
                  : isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              style={selectedDate === item.date ? {
                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                color: colorPalette?.primary || '#7c3aed'
              } : {}}
            >
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <span>{item.date}</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${selectedDate === item.date
                  ? 'text-white'
                  : isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'
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
      </div>

      <div className={`overflow-hidden flex-1 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'
        }`}>
        <div className="flex flex-col h-full">
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="flex flex-col space-y-3">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className={`md:hidden p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'
                    }`}
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="flex items-center space-x-2 flex-1">
                  <GlobalSearch 
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    isDarkMode={isDarkMode}
                    colorPalette={colorPalette}
                    placeholder="Search Staggered records..."
                  />
                  <div className="relative" ref={filterDropdownRef}>
                    <button
                      className={`p-2 rounded-lg transition-colors flex items-center justify-center border shadow-sm ${isDarkMode
                        ? 'hover:bg-gray-700 text-white bg-gray-800 border-gray-700'
                        : 'hover:bg-gray-200 text-gray-900 bg-white border-gray-300'
                        }`}
                      onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                      title="Column Visibility"
                    >
                      <Columns3 className="h-5 w-5" />
                    </button>
                    {filterDropdownOpen && (
                      <div className={`absolute top-full right-0 mt-2 w-80 rounded shadow-lg z-50 max-h-[70vh] flex flex-col ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
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
                    disabled={isLoading || filteredRecords.length === 0}
                    title="Export to CSV"
                    className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
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
                    title={!isFullyLoaded ? "Loading records..." : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
                    className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
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
                  <p className="mt-4">Loading Staggered Payment records...</p>
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
              ) : paginatedRecords.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
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
                        {paginatedRecords.map((record) => (
                          <tr
                            key={record.id}
                            onClick={() => handleRowClick(record)}
                            className={`border-b transition-colors cursor-pointer ${selectedStaggered?.id === record.id
                              ? (isDarkMode ? 'bg-gray-800' : 'bg-blue-50')
                              : (isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50')
                              }`}
                          >
                            {filteredColumns.map((column, index) => (
                              <td
                                key={column.key}
                                className={`py-4 px-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                                  } ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200') : ''
                                  }`}
                                style={{
                                  width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                  minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : (column.width === 'min-w-max' ? 'max-content' : undefined)
                                }}
                              >
                                <div className="flex items-center space-x-2">
                                  {renderCellValue(record, column.key)}
                                  {column.key === 'staggered_install_no' && viewers[String(record.id)] && viewers[String(record.id)].length > 0 && (
                                    <div className="flex -space-x-1 overflow-hidden" title={`Being viewed by: ${viewers[String(record.id)].join(', ')}`}>
                                      {viewers[String(record.id)].map((viewer: string, i: number) => (
                                        <div
                                          key={i}
                                          className="inline-block h-4 w-4 rounded-full ring-1 ring-white dark:ring-gray-800 bg-gray-500 flex items-center justify-center text-[8px] text-white"
                                        >
                                          {viewer.charAt(0).toUpperCase()}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className={`h-full flex flex-col items-center justify-center ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                  <h1 className="text-2xl mb-4">Staggered Payment</h1>
                  <p className="text-lg">No payment records found</p>
                </div>
              )}
            </div>
            {!isLoading && !error && filteredRecords.length > 0 && <PaginationControls />}
          </div>
        </div>

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
      </div>

      {selectedStaggered && (
        <div className="flex-shrink-0 overflow-hidden">
          <StaggeredListDetails
            staggered={selectedStaggered as any}
            onClose={() => setSelectedStaggered(null)}
            onViewCustomer={handleViewCustomer}
            onPrevious={currentStaggeredIndex > 0 ? handlePreviousRecord : undefined}
            onNext={currentStaggeredIndex < filteredRecords.length - 1 ? handleNextRecord : undefined}
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
            />
          ) : null}
        </div>
      )}

      <StaggeredInstallationFormModal
        isOpen={isStaggeredFormModalOpen}
        onClose={handleCloseStaggeredFormModal}
        onSave={handleSaveStaggered}
      />

      {/* Mobile Overlay Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setMobileMenuOpen(false)} />
          <div className={`absolute inset-y-0 left-0 w-64 shadow-xl flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
            }`}>
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
              }`}>
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Categories</h2>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className={isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* All Level */}
              <button
                onClick={() => {
                  setSelectedDate('All');
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors border-b ${isDarkMode ? 'hover:bg-gray-800 border-gray-800' : 'hover:bg-gray-100 border-gray-200'}`}
                style={selectedDate === 'All' ? {
                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                  color: colorPalette?.primary || '#7c3aed',
                  fontWeight: 500
                } : {
                  color: isDarkMode ? '#d1d5db' : '#374151'
                }}
              >
                <div className="flex items-center">
                  <Globe className="h-4 w-4 mr-2" />
                  <span>All Records</span>
                </div>
                <span className="px-2 py-1 rounded-full text-xs bg-gray-700 text-gray-300">
                  {dateItems.all}
                </span>
              </button>

              {/* Mobile Date Range Filter Section */}
              <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    Staggered Date Range
                  </span>
                  {(staggeredDateFrom || staggeredDateTo) && (
                    <button
                      onClick={() => {
                        setStaggeredDateFrom('');
                        setStaggeredDateTo('');
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
                      value={staggeredDateFrom}
                      onChange={(e) => setStaggeredDateFrom(e.target.value)}
                      className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      style={staggeredDateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                    />
                  </div>
                  <div className="relative">
                    <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                    <input
                      type="date"
                      value={staggeredDateTo}
                      onChange={(e) => setStaggeredDateTo(e.target.value)}
                      className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      style={staggeredDateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                    />
                  </div>
                </div>
              </div>

              {/* Date Categories */}
              {dateItems.dates.map((item, index) => (
                <button
                  key={index}
                  onClick={() => {
                    setSelectedDate(item.date);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors border-b ${isDarkMode ? 'hover:bg-gray-800 border-gray-800' : 'hover:bg-gray-100 border-gray-200'}`}
                  style={selectedDate === item.date ? {
                    backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                    color: colorPalette?.primary || '#7c3aed',
                    fontWeight: 500
                  } : {
                    color: isDarkMode ? '#d1d5db' : '#374151'
                  }}
                >
                  <div className="flex items-center">
                    <Calendar className="h-4 w-4 mr-2" />
                    <span>{item.date}</span>
                  </div>
                  <span className="px-2 py-1 rounded-full text-xs bg-gray-700 text-gray-300">
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
};

export default StaggeredPayment;
