import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Search, ChevronDown, RefreshCw, Columns3, ArrowUp, ArrowDown, Menu, X, ArrowLeft, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import ApplicationVisitDetails from '../components/ApplicationVisitDetails';
import ApplicationVisitFunnelFilter, { FilterValues } from '../filter/ApplicationVisitFunnelFilter';
import { useApplicationVisitContext, type ApplicationVisit } from '../contexts/ApplicationVisitContext';
import { getApplication } from '../services/applicationService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { applyFilters } from '../utils/filterUtils';


interface LocationItem {
  id: string;
  name: string;
  count: number;
}

type DisplayMode = 'card' | 'table';

// All available columns from application_visits table
const allColumns = [
  { key: 'timestamp', label: 'Timestamp', width: 'min-w-40' },
  { key: 'fullName', label: 'Full Name', width: 'min-w-48' },
  { key: 'assignedEmail', label: 'Assigned Email', width: 'min-w-48' },
  { key: 'visitStatus', label: 'Visit Status', width: 'min-w-32' },
  { key: 'applicationStatus', label: 'Application Status', width: 'min-w-36' },
  { key: 'statusRemarks', label: 'Status Remarks', width: 'min-w-40' },
  { key: 'referredBy', label: 'Referred By', width: 'min-w-32' },
  { key: 'fullAddress', label: 'Full Address', width: 'min-w-56' },
  { key: 'visitBy', label: 'Visit By', width: 'min-w-32' },
  { key: 'visitWith', label: 'Visit With', width: 'min-w-32' },
  { key: 'visitWithOther', label: 'Visit With (Other)', width: 'min-w-32' },
  { key: 'visitRemarks', label: 'Visit Remarks', width: 'min-w-40' },
  { key: 'modifiedDate', label: 'Modified Date', width: 'min-w-40' },
  { key: 'modifiedBy', label: 'Modified By', width: 'min-w-32' },
  { key: 'firstName', label: 'First Name', width: 'min-w-32' },
  { key: 'middleInitial', label: 'Middle Initial', width: 'min-w-28' },
  { key: 'lastName', label: 'Last Name', width: 'min-w-32' },
  { key: 'region', label: 'Region', width: 'min-w-28' },
  { key: 'city', label: 'City', width: 'min-w-28' },
  { key: 'barangay', label: 'Barangay', width: 'min-w-32' },

  { key: 'choosePlan', label: 'Choose Plan', width: 'min-w-36' },
  { key: 'promo', label: 'Promo', width: 'min-w-28' },
  { key: 'houseFrontPicture', label: 'House Front Picture', width: 'min-w-48' },
  { key: 'image1', label: 'Image 1', width: 'min-w-48' },
  { key: 'image2', label: 'Image 2', width: 'min-w-48' },
  { key: 'image3', label: 'Image 3', width: 'min-w-48' },
  { key: 'applicationId', label: 'Application ID', width: 'min-w-32' },
  { key: 'createdAt', label: 'Created At', width: 'min-w-40' }
];

const ApplicationVisitPage: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedVisit, setSelectedVisit] = useState<ApplicationVisit | null>(null);
  const { applicationVisits, isLoading, error, refreshApplicationVisits, silentRefresh } = useApplicationVisitContext();
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('table');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('applicationVisitVisibleColumns');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (err) {
        console.error('Failed to load column visibility:', err);
      }
    }
    return allColumns.map(col => col.key);
  });
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(allColumns.map(col => col.key));
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [mobileView, setMobileView] = useState<'locations' | 'visits' | 'details'>('locations');
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<FilterValues>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 50;

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
    fetchColorPalette();
  }, []);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLocation, searchQuery, activeFilters, sortColumn, sortDirection]);

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

  const formatDate = (dateStr?: string): string => {
    if (!dateStr || dateStr === 'Not scheduled') return dateStr || 'Not scheduled';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
      return dateStr;
    }
  };

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        setUserRole(userData.role || '');
        setRoleId(userData.role_id || null);
      } catch (err) {
        // Error parsing auth data
      }
    }
  }, []);

  // Trigger silent refresh on mount to ensure data is fresh but no spinner if cached
  useEffect(() => {
    silentRefresh();
  }, [silentRefresh]);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      console.log('User idle for 15 minutes, auto-refreshing Application Visit data...');
      try {
        await silentRefresh();
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
  }, [silentRefresh]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshApplicationVisits();
    setIsRefreshing(false);
  };



  const handleVisitUpdate = async () => {
    await silentRefresh();
  };

  const locationItems: LocationItem[] = [
    {
      id: 'all',
      name: 'All',
      count: applicationVisits.length
    }
  ];

  const locationSet = new Set<string>();
  applicationVisits.forEach(visit => {
    const addressParts = visit.full_address.split(',');
    const city = addressParts.length > 3 ? addressParts[3].trim() : '';
    if (city) {
      locationSet.add(city.toLowerCase());
    }
  });
  const uniqueLocations = Array.from(locationSet);

  uniqueLocations.forEach(location => {
    if (location) {
      locationItems.push({
        id: location,
        name: location.charAt(0).toUpperCase() + location.slice(1),
        count: applicationVisits.filter(visit => {
          const addressParts = visit.full_address.split(',');
          const city = addressParts.length > 3 ? addressParts[3].trim() : '';
          return city.toLowerCase() === location;
        }).length
      });
    }
  });

  // Apply location and search filters first
  let filteredVisits = applicationVisits.filter(visit => {
    const addressParts = visit.full_address.split(',');
    const city = addressParts.length > 3 ? addressParts[3].trim().toLowerCase() : '';
    const matchesLocation = selectedLocation === 'all' || city === selectedLocation;

    const matchesSearch = searchQuery === '' ||
      visit.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      visit.full_address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (visit.assigned_email || '').toLowerCase().includes(searchQuery.toLowerCase());

    return matchesLocation && matchesSearch;
  });

  // Apply funnel filters
  filteredVisits = applyFilters(filteredVisits, activeFilters);

  const presortedVisits = [...filteredVisits].sort((a, b) => {
    const idA = parseInt(a.id) || 0;
    const idB = parseInt(b.id) || 0;
    return idB - idA;
  });

  const sortedVisits = [...presortedVisits].sort((a, b) => {
    if (!sortColumn) return 0;

    let aValue: any = '';
    let bValue: any = '';

    switch (sortColumn) {
      case 'timestamp':
        aValue = a.timestamp || '';
        bValue = b.timestamp || '';
        break;
      case 'fullName':
        aValue = a.full_name || '';
        bValue = b.full_name || '';
        break;
      case 'assignedEmail':
        aValue = a.assigned_email || '';
        bValue = b.assigned_email || '';
        break;
      case 'visitStatus':
        aValue = a.visit_status || '';
        bValue = b.visit_status || '';
        break;
      case 'applicationStatus':
        aValue = a.application_status || '';
        bValue = b.application_status || '';
        break;
      case 'statusRemarks':
        aValue = a.status_remarks || '';
        bValue = b.status_remarks || '';
        break;
      case 'referredBy':
        aValue = a.referred_by || '';
        bValue = b.referred_by || '';
        break;
      case 'fullAddress':
        aValue = a.full_address || '';
        bValue = b.full_address || '';
        break;
      case 'visitBy':
        aValue = a.visit_by || '';
        bValue = b.visit_by || '';
        break;
      case 'visitWith':
        aValue = a.visit_with || '';
        bValue = b.visit_with || '';
        break;
      case 'visitWithOther':
        aValue = a.visit_with_other || '';
        bValue = b.visit_with_other || '';
        break;
      case 'visitRemarks':
        aValue = a.visit_remarks || '';
        bValue = b.visit_remarks || '';
        break;
      case 'modifiedDate':
        aValue = a.updated_at || '';
        bValue = b.updated_at || '';
        break;
      case 'modifiedBy':
        aValue = a.updated_by_user_email || '';
        bValue = b.updated_by_user_email || '';
        break;
      case 'firstName':
        aValue = a.first_name || '';
        bValue = b.first_name || '';
        break;
      case 'middleInitial':
        aValue = a.middle_initial || '';
        bValue = b.middle_initial || '';
        break;
      case 'lastName':
        aValue = a.last_name || '';
        bValue = b.last_name || '';
        break;
      case 'region':
        aValue = a.region || '';
        bValue = b.region || '';
        break;
      case 'city':
        aValue = a.city || '';
        bValue = b.city || '';
        break;
      case 'barangay':
        aValue = a.barangay || '';
        bValue = b.barangay || '';
        break;

      case 'choosePlan':
        aValue = a.choose_plan || '';
        bValue = b.choose_plan || '';
        break;
      case 'promo':
        aValue = a.promo || '';
        bValue = b.promo || '';
        break;
      case 'applicationId':
        aValue = a.application_id || '';
        bValue = b.application_id || '';
        break;
      case 'createdAt':
        aValue = a.created_at || '';
        bValue = b.created_at || '';
        break;
      default:
        return 0;
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
    return 0;
  });

  // Derived paginated records
  const paginatedVisits = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedVisits.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedVisits, currentPage]);

  const totalPages = Math.ceil(sortedVisits.length / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleRowClick = async (visit: ApplicationVisit) => {
    try {
      if (!visit.application_status) {
        try {
          const applicationData = await getApplication(visit.application_id);

          const updatedVisit = {
            ...visit,
            application_status: applicationData.status || 'Pending'
          };

          setSelectedVisit(updatedVisit);
        } catch (err: any) {
          setSelectedVisit(visit);
        }
      } else {
        setSelectedVisit(visit);
      }
    } catch (err: any) {
      console.error('Failed to select visit:', err);
    }
  };

  const StatusText = ({ status, type }: { status: string; type: 'visit' | 'application' }) => {
    let textColor = '';

    if (type === 'visit') {
      switch (status.toLowerCase()) {
        case 'completed':
          textColor = 'text-green-400';
          break;
        case 'scheduled':
          textColor = 'text-green-400';
          break;
        case 'pending':
          textColor = 'text-orange-400';
          break;
        case 'cancelled':
          textColor = 'text-red-500';
          break;
        default:
          textColor = 'text-gray-400';
      }
    } else {
      switch (status.toLowerCase()) {
        case 'approved':
        case 'done':
        case 'schedule':
        case 'completed':
          textColor = 'text-green-400';
          break;
        case 'pending':
          textColor = 'text-orange-400';
          break;
        case 'under review':
        case 'in progress':
          textColor = 'text-blue-400';
          break;
        case 'rejected':
        case 'failed':
        case 'cancelled':
          textColor = 'text-red-500';
          break;
        case 'no facility':
          textColor = 'text-red-400';
          break;
        case 'no slot':
          textColor = 'text-purple-400';
          break;
        case 'duplicate':
          textColor = 'text-pink-400';
          break;
        default:
          textColor = 'text-gray-400';
      }
    }

    return (
      <span className={`${textColor} font-bold uppercase`}>
        {status}
      </span>
    );
  };

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const newColumns = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      localStorage.setItem('applicationVisitVisibleColumns', JSON.stringify(newColumns));
      return newColumns;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map(col => col.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('applicationVisitVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('applicationVisitVisibleColumns', JSON.stringify([]));
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

  const renderCellValue = (visit: ApplicationVisit, columnKey: string) => {
    switch (columnKey) {
      case 'timestamp':
        return formatDate(visit.timestamp);
      case 'fullName':
        return visit.full_name;
      case 'assignedEmail':
        return visit.assigned_email || 'Unassigned';
      case 'visitStatus':
        return visit.visit_status || 'Scheduled';
      case 'applicationStatus':
        return visit.application_status || 'Pending';
      case 'statusRemarks':
        return visit.status_remarks || 'No remarks';
      case 'referredBy':
        return visit.referred_by || 'None';
      case 'fullAddress':
        return visit.full_address || 'No address';
      case 'visitBy':
        return visit.visit_by || 'Unassigned';
      case 'visitWith':
        return visit.visit_with || 'None';
      case 'visitWithOther':
        return visit.visit_with_other || 'None';
      case 'visitRemarks':
        return visit.visit_remarks || 'No remarks';
      case 'modifiedDate':
        return formatDate(visit.updated_at);
      case 'modifiedBy':
        return visit.updated_by_user_email;
      case 'firstName':
        return visit.first_name || '-';
      case 'middleInitial':
        return visit.middle_initial || '-';
      case 'lastName':
        return visit.last_name || '-';
      case 'region':
        return visit.region || '-';
      case 'city':
        return visit.city || '-';
      case 'barangay':
        return visit.barangay || '-';

      case 'choosePlan':
        return visit.choose_plan || '-';
      case 'promo':
        return visit.promo || '-';
      case 'applicationId':
        return visit.application_id;
      case 'createdAt':
        return formatDate(visit.created_at);
      default:
        return '-';
    }
  };

  const renderCellDisplay = (visit: ApplicationVisit, columnKey: string) => {
    if (columnKey === 'visitStatus') {
      return <StatusText status={visit.visit_status || 'Scheduled'} type="visit" />;
    }
    if (columnKey === 'applicationStatus') {
      return <StatusText status={visit.application_status || 'Pending'} type="application" />;
    }
    return renderCellValue(visit, columnKey);
  };

  const handleLocationSelect = (locationId: string) => {
    setSelectedLocation(locationId);
    setMobileMenuOpen(false);
    setMobileView('visits');
  };

  const handleMobileBack = () => {
    if (mobileView === 'details') {
      setSelectedVisit(null);
      setMobileView('visits');
    } else if (mobileView === 'visits') {
      setMobileView('locations');
    }
  };

  const handleMobileRowClick = async (visit: ApplicationVisit) => {
    await handleRowClick(visit);
    setMobileView('details');
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden pb-16 md:pb-0 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      {/* Desktop Sidebar - Hidden on mobile */}
      {(userRole.toLowerCase() !== 'technician' && roleId !== 2) && (
        <div className={`hidden md:flex border-r flex-shrink-0 flex-col relative z-40 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`} style={{ width: `${sidebarWidth}px` }}>
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
            }`}>
            <div className="flex items-center justify-between mb-1">
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Application Visits</h2>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {locationItems.map((location) => (
              <button
                key={location.id}
                onClick={() => {
                  setSelectedLocation(location.id);
                }}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                  } ${selectedLocation === location.id
                    ? ''
                    : isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                style={selectedLocation === location.id ? {
                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                  color: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                <div className="flex items-center">
                  <FileText className="h-4 w-4 mr-2" />
                  <span className="capitalize">{location.name}</span>
                </div>
                {location.count > 0 && (
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${selectedLocation === location.id
                      ? 'text-white'
                      : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                      }`}
                    style={selectedLocation === location.id ? {
                      backgroundColor: colorPalette?.primary || '#7c3aed'
                    } : {}}
                  >
                    {location.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Resize Handle */}
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
      )}

      {/* Mobile Location View */}
      {mobileView === 'locations' && (
        <div className={`md:hidden flex-1 flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
          }`}>
          <div className={`p-4 border-b ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Application Visits</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {locationItems.map((location) => (
              <button
                key={location.id}
                onClick={() => handleLocationSelect(location.id)}
                className={`w-full flex items-center justify-between px-4 py-4 text-sm transition-colors border-b ${isDarkMode ? 'hover:bg-gray-800 border-gray-800' : 'hover:bg-gray-100 border-gray-200'
                  } ${selectedLocation === location.id ? '' : isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                style={selectedLocation === location.id ? {
                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                  color: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                <div className="flex items-center">
                  <FileText className="h-5 w-5 mr-3" />
                  <span className="capitalize text-base">{location.name}</span>
                </div>
                {location.count > 0 && (
                  <span
                    className="px-3 py-1 rounded-full text-sm"
                    style={selectedLocation === location.id ? {
                      backgroundColor: colorPalette?.primary || '#7c3aed',
                      color: 'white'
                    } : {
                      backgroundColor: isDarkMode ? '#374151' : '#d1d5db',
                      color: isDarkMode ? '#d1d5db' : '#4b5563'
                    }}
                  >
                    {location.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile Overlay Menu */}
      {mobileMenuOpen && userRole.toLowerCase() !== 'technician' && mobileView === 'visits' && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setMobileMenuOpen(false)} />
          <div className={`absolute inset-y-0 left-0 w-64 shadow-xl flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
            }`}>
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
              }`}>
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Filters</h2>
              <button onClick={() => setMobileMenuOpen(false)} className={isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}>
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {locationItems.map((location) => (
                <button
                  key={location.id}
                  onClick={() => handleLocationSelect(location.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-gray-800 ${selectedLocation === location.id
                    ? ''
                    : 'text-gray-300'
                    }`}
                  style={selectedLocation === location.id ? {
                    backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                    color: colorPalette?.primary || '#7c3aed'
                  } : {}}
                >
                  <div className="flex items-center">
                    <FileText className="h-4 w-4 mr-2" />
                    <span className="capitalize">{location.name}</span>
                  </div>
                  {location.count > 0 && (
                    <span
                      className={`px-2 py-1 rounded-full text-xs ${selectedLocation === location.id
                        ? 'text-white'
                        : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                        }`}
                      style={selectedLocation === location.id ? {
                        backgroundColor: colorPalette?.primary || '#7c3aed'
                      } : {}}
                    >
                      {location.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={`overflow-hidden flex-1 flex flex-col md:pb-0 relative z-30 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'
        } ${mobileView === 'locations' || mobileView === 'details' ? 'hidden md:flex' : ''}`}>
        <div className="flex flex-col h-full">
          <div className={`p-4 border-b flex-shrink-0 relative z-50 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="flex items-center space-x-3">
              {userRole.toLowerCase() !== 'technician' && mobileView === 'visits' && (
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className={`md:hidden p-2 rounded text-sm transition-colors flex items-center justify-center ${isDarkMode
                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                    }`}
                  aria-label="Open filter menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
              )}
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Search application visits..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full rounded pl-10 pr-4 py-2 focus:outline-none ${isDarkMode
                    ? 'bg-gray-800 text-white border border-gray-700'
                    : 'bg-white text-gray-900 border border-gray-300'
                    }`}
                  onFocus={(e) => {
                    if (colorPalette?.primary) {
                      e.currentTarget.style.borderColor = colorPalette.primary;
                      e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                    }
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                <Search className={`absolute left-3 top-2.5 h-4 w-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                  }`} />
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setIsFunnelFilterOpen(true)}
                  className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                    ? 'hover:bg-gray-700 text-white'
                    : 'hover:bg-gray-200 text-gray-900'
                    }`}
                >
                  <Filter className="h-5 w-5" />
                </button>
                {displayMode === 'table' && (
                  <div className="relative" ref={filterDropdownRef}>
                    <button
                      className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                        ? 'hover:bg-gray-800 text-white'
                        : 'hover:bg-gray-100 text-gray-900'
                        }`}
                      onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                    >
                      <Columns3 className="h-5 w-5" />
                    </button>
                    {filterDropdownOpen && (
                      <>
                        {/* Mobile Overlay */}
                        <div className="md:hidden fixed inset-0 z-50">
                          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setFilterDropdownOpen(false)} />
                          <div className={`absolute inset-x-4 top-20 bottom-4 rounded shadow-lg flex flex-col ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
                            }`}>
                            <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                              }`}>
                              <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                                }`}>Column Visibility</span>
                              <button onClick={() => setFilterDropdownOpen(false)} className={isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}>
                                <X className="h-5 w-5" />
                              </button>
                            </div>
                            <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                              }`}>
                              <button
                                onClick={handleSelectAllColumns}
                                className={`text-sm px-3 py-1 rounded transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
                                  }`}
                                style={{
                                  color: colorPalette?.primary || '#7c3aed'
                                }}
                              >
                                Select All
                              </button>
                              <button
                                onClick={handleDeselectAllColumns}
                                className={`text-sm px-3 py-1 rounded transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
                                  }`}
                                style={{
                                  color: colorPalette?.primary || '#7c3aed'
                                }}
                              >
                                Deselect All
                              </button>
                            </div>
                            <div className="overflow-y-auto flex-1">
                              {allColumns.map((column) => (
                                <label
                                  key={column.key}
                                  className={`flex items-center px-4 py-3 cursor-pointer text-sm border-b ${isDarkMode ? 'hover:bg-gray-700 text-white border-gray-700' : 'hover:bg-gray-100 text-gray-900 border-gray-200'
                                    }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={visibleColumns.includes(column.key)}
                                    onChange={() => handleToggleColumn(column.key)}
                                    className="mr-3 h-4 w-4 rounded border-gray-600 bg-gray-700 text-orange-600 focus:ring-orange-500 focus:ring-offset-gray-800"
                                  />
                                  <span>{column.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Desktop Dropdown */}
                        <div className={`hidden md:flex absolute top-full right-0 mt-2 w-80 rounded shadow-lg z-50 max-h-96 flex-col ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
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
                              <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>|</span>
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
                                className={`flex items-center px-4 py-2 cursor-pointer text-sm ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'
                                  }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={visibleColumns.includes(column.key)}
                                  onChange={() => handleToggleColumn(column.key)}
                                  className="mr-3 h-4 w-4 rounded border-gray-600 bg-gray-700 text-orange-600 focus:ring-orange-500 focus:ring-offset-gray-800"
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
                <div className="relative z-[100]" ref={dropdownRef}>
                  <button
                    className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                      ? 'hover:bg-gray-800 text-white'
                      : 'hover:bg-gray-100 text-gray-900'
                      }`}
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                  >
                    <span>{displayMode === 'card' ? 'Card' : 'Table'}</span>
                    <ChevronDown className="w-4 h-4 ml-1" />
                  </button>
                  {dropdownOpen && (
                    <div className={`absolute top-full right-0 mt-1 w-36 rounded shadow-lg border z-50 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
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
                  )}                </div>
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="text-white px-3 py-2 rounded text-sm flex items-center transition-colors"
                  style={{
                    backgroundColor: isRefreshing ? '#4b5563' : (colorPalette?.primary || '#7c3aed')
                  }}
                  onMouseEnter={(e) => {
                    if (!isRefreshing && colorPalette?.accent) {
                      e.currentTarget.style.backgroundColor = colorPalette.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isRefreshing && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = colorPalette.primary;
                    }
                  }}
                  title="Refresh application visits"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  <div className="animate-pulse flex flex-col items-center">
                    <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                    <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'
                      }`}></div>
                  </div>
                  <p className="mt-4">Loading application visits...</p>
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
                  <div className={`mt-4 p-4 rounded overflow-auto max-h-48 text-left ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'
                    }`}>
                    <pre className={`text-xs whitespace-pre-wrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                      {error}
                    </pre>
                  </div>
                </div>
              ) : displayMode === 'card' ? (
                paginatedVisits.length > 0 ? (
                  <div className="space-y-0">
                    {paginatedVisits.map((visit) => (
                      <div
                        key={visit.id}
                        onClick={() => window.innerWidth < 768 ? handleMobileRowClick(visit) : handleRowClick(visit)}
                        className={`px-4 py-3 cursor-pointer transition-colors border-b ${isDarkMode ? 'hover:bg-gray-800 border-gray-800' : 'hover:bg-gray-100 border-gray-200'
                          } ${selectedVisit?.id === visit.id ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium text-sm mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                              }`}>
                              {visit.full_name}
                            </div>
                            <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                              }`}>
                              {formatDate(visit.timestamp)} | {visit.full_address}
                            </div>
                          </div>
                          <div className="flex flex-col items-end space-y-1 ml-4 flex-shrink-0">
                            <StatusText status={visit.visit_status || 'Scheduled'} type="visit" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                    {applicationVisits.length > 0
                      ? 'No application visits found matching your filters'
                      : 'No application visits found. Create your first visit by scheduling from the Applications page.'}
                  </div>
                )
              ) : (
                <div className="overflow-x-auto overflow-y-hidden">
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
                            className={`text-left py-3 px-3 font-normal ${column.width} whitespace-nowrap relative group cursor-move ${isDarkMode ? 'text-gray-400 bg-gray-800' : 'text-gray-600 bg-gray-100'
                              } ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') : ''} ${draggedColumn === column.key ? 'opacity-50' : ''
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
                      {paginatedVisits.length > 0 ? (
                        paginatedVisits.map((visit) => (
                          <tr
                            key={visit.id}
                            className={`border-b cursor-pointer transition-colors ${isDarkMode ? 'border-gray-800 hover:bg-gray-900' : 'border-gray-200 hover:bg-gray-50'
                              } ${selectedVisit?.id === visit.id ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
                            onClick={() => window.innerWidth < 768 ? handleMobileRowClick(visit) : handleRowClick(visit)}
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
                                <div className="truncate" title={String(renderCellValue(visit, column.key))}>
                                  {renderCellDisplay(visit, column.key)}
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={filteredColumns.length} className={`px-4 py-12 text-center border-b ${isDarkMode ? 'text-gray-400 border-gray-800' : 'text-gray-600 border-gray-200'
                            }`}>
                            {applicationVisits.length > 0
                              ? 'No application visits found matching your filters'
                              : 'No application visits found. Create your first visit by scheduling from the Applications page.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {!isLoading && sortedVisits.length > 0 && totalPages > 1 && (
              <div className={`border-t p-4 flex items-center justify-between ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, sortedVisits.length)}</span> of <span className="font-medium">{sortedVisits.length}</span> results
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === 1
                      ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                      : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                      }`}
                  >
                    Previous
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
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedVisit && mobileView === 'details' && (
        <div className={`md:hidden flex-1 flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
          }`}>
          <ApplicationVisitDetails
            applicationVisit={selectedVisit}
            onClose={handleMobileBack}
            onUpdate={handleVisitUpdate}
            isMobile={true}
          />
        </div>
      )}

      {selectedVisit && mobileView !== 'details' && (
        <div className="hidden md:block flex-shrink-0 overflow-hidden">
          <ApplicationVisitDetails
            applicationVisit={selectedVisit}
            onClose={() => setSelectedVisit(null)}
            onUpdate={handleVisitUpdate}
            isMobile={false}
          />
        </div>
      )}

      <ApplicationVisitFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          setActiveFilters(filters);
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={activeFilters}
      />

      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default ApplicationVisitPage;
