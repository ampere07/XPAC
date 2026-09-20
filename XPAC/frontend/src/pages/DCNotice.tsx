import React, { useState, useEffect, useRef } from 'react';
import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight ,X, Menu, Globe, Calendar, ChevronDown, RefreshCw, ArrowUp, ArrowDown, Columns3, Download } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useDCNoticeContext } from '../contexts/DCNoticeContext';
import pusher from '../services/pusherService';
import { DCNotice } from '../services/dcNoticeService';
import { exportToCSV } from '../utils/exportUtils';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

const allColumns = [
  { key: 'id', label: 'ID', width: 'min-w-20' },
  { key: 'account_no', label: 'Account No', width: 'min-w-36' },
  { key: 'full_name', label: 'Customer Name', width: 'min-w-48' },
  { key: 'dc_notice_date', label: 'DC Notice Date', width: 'min-w-36' },
  { key: 'invoice_id', label: 'Invoice ID', width: 'min-w-28' },
  { key: 'plan', label: 'Plan', width: 'min-w-36' },
  { key: 'contact_number', label: 'Contact', width: 'min-w-36' },
  { key: 'email_address', label: 'Email', width: 'min-w-48' },
  { key: 'address', label: 'Address', width: 'min-w-64' },
];

const DCNoticePage: React.FC = () => {
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const { dcNoticeRecords, isLoading, error, refreshDCNoticeRecords, silentRefresh, isFullyLoaded } = useDCNoticeContext();
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [dcNoticeDateFrom, setDcNoticeDateFrom] = useState<string>('');
  const [dcNoticeDateTo, setDcNoticeDateTo] = useState<string>('');
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState<boolean>(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
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

  // Auto-navigate to list view when selectedDate or dcNoticeDate changes on mobile
  useEffect(() => {
    if (isMobile && (selectedDate !== 'All' || dcNoticeDateFrom || dcNoticeDateTo)) {
      setMobileViewMode('list');
    }
  }, [selectedDate, dcNoticeDateFrom, dcNoticeDateTo, isMobile]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Column management states
  const [sortColumn, setSortColumn] = useState<string | null>('dc_notice_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('dcNoticeColumnOrder');
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
    const saved = localStorage.getItem('dcNoticeVisibleColumns');
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

  // Reset page when search or date filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDate, itemsPerPage, dcNoticeDateFrom, dcNoticeDateTo]);

  // Scroll to top on page change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

  const userOrgId = React.useMemo(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
    } catch {
      return null;
    }
  }, []);

  // 1. Initial search filtering (Global filtered set for sidebar counts)
  const globalFilteredRecords = React.useMemo(() => {
    let filtered = dcNoticeRecords;

    // Organization filter — mirrors applicationmanagement.tsx logic exactly
    if (userOrgId) {
      filtered = filtered.filter((record: DCNotice) => record.organization_id === userOrgId);
    } else {
      filtered = filtered.filter((record: DCNotice) => !record.organization_id);
    }

    if (searchQuery) {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      
      filtered = filtered.filter(record => {
        // Only check fields that are actually displayed or relevant for searching
        const searchableText = [
          record.id,
          record.account_no,
          record.full_name,
          record.invoice_id,
          record.plan,
          record.contact_number,
          record.email_address,
          record.address,
          record.dc_notice_date
        ].filter(Boolean).join(' ').toLowerCase();
        
        return searchableText.includes(normalizedQuery);
      });
    }

    // Apply sidebar date range filters for DC notice date
    if (dcNoticeDateFrom || dcNoticeDateTo) {
      filtered = filtered.filter(record => {
        if (!record.dc_notice_date) return false;

        const dateValue = new Date(record.dc_notice_date).getTime();
        if (isNaN(dateValue)) return false;

        if (dcNoticeDateFrom) {
          const fromDate = new Date(dcNoticeDateFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (dateValue < fromDate.getTime()) return false;
        }

        if (dcNoticeDateTo) {
          const toDate = new Date(dcNoticeDateTo);
          toDate.setHours(23, 59, 59, 999);
          if (dateValue > toDate.getTime()) return false;
        }

        return true;
      });
    }

    return filtered;
  }, [dcNoticeRecords, searchQuery, dcNoticeDateFrom, dcNoticeDateTo]);

  // Derive date items from context data instead of fetching separately or static
  const dateItems = React.useMemo(() => {
    const dateCounts: Record<string, number> = {};
    const dates = new Map<string, string>(); // Formatted -> Raw

    globalFilteredRecords.forEach(record => {
      if (record.dc_notice_date) {
        const date = new Date(record.dc_notice_date);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yyyy = date.getFullYear();
        const formatted = `${mm}/${dd}/${yyyy}`;
        dateCounts[formatted] = (dateCounts[formatted] || 0) + 1;
        dates.set(formatted, record.dc_notice_date);
      }
    });

    const sortedDates = Array.from(dates.entries())
      .sort((a, b) => {
        const timeA = new Date(a[1]).getTime();
        const timeB = new Date(b[1]).getTime();
        return timeB - timeA; // Descending
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

  // Trigger silent refresh on mount to ensure data is fresh but no spinner if cached
  useEffect(() => {
    silentRefresh();
  }, [silentRefresh]);

  // Pusher/Soketi connection for real-time DC notice updates
  useEffect(() => {
    const handleUpdate = async (data: any) => {
      setHasNewData(true);
      try {
        await silentRefresh();
      } catch (err) {
        console.error('[DCNotice Soketi] Failed to refresh data:', err);
      }
    };

    const dcNoticeChannel = pusher.subscribe('dc-notices');

    dcNoticeChannel.bind('dc-notice-updated', handleUpdate);

    return () => {
      dcNoticeChannel.unbind('dc-notice-updated', handleUpdate);
      pusher.unsubscribe('dc-notices');
    };
  }, [silentRefresh]);

  // Polling for updates every 3 seconds
  useEffect(() => {
    const POLLING_INTERVAL = 30000; // 30 seconds - increased to reduce load for 25k+ records
    const intervalId = setInterval(async () => {
      try {
        await silentRefresh();
      } catch (err) {
        console.error('[DCNotice Page] Polling failed:', err);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [silentRefresh]);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
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

  // Initialize column order and visibility
  useEffect(() => {
    if (allColumns.length > 0) {
      if (columnOrder.length === 0) {
        const defaultOrder = allColumns.map(col => col.key);
        setColumnOrder(defaultOrder);
        localStorage.setItem('dcNoticeColumnOrder', JSON.stringify(defaultOrder));
      }
      if (visibleColumns.length === 0) {
        const defaultVisible = ['id', 'account_no', 'full_name', 'dc_notice_date', 'invoice_id'];
        setVisibleColumns(defaultVisible);
        localStorage.setItem('dcNoticeVisibleColumns', JSON.stringify(defaultVisible));
      }
    }
  }, [allColumns.length, columnOrder.length, visibleColumns.length]);

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const next = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      localStorage.setItem('dcNoticeVisibleColumns', JSON.stringify(next));
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map(col => col.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('dcNoticeVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('dcNoticeVisibleColumns', JSON.stringify([]));
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
    localStorage.setItem('dcNoticeColumnOrder', JSON.stringify(newOrder));
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

  const filteredRecords = React.useMemo(() => {
    let filtered = globalFilteredRecords.filter(record => {
      if (selectedDate === 'All') return true;
      if (!record.dc_notice_date) return false;
      const recordDateFormatted = new Date(record.dc_notice_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return recordDateFormatted === selectedDate;
    });

    // Sorting logic
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue: any = (a as any)[sortColumn] || '';
        let bValue: any = (b as any)[sortColumn] || '';

        // Handle numeric/date values
        if (sortColumn === 'id' || sortColumn === 'invoice_id') {
          aValue = Number(aValue) || 0;
          bValue = Number(bValue) || 0;
        } else if (sortColumn === 'dc_notice_date') {
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
    if (filteredRecords.length === 0) return null;

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
            Showing <span className="font-medium">{filteredRecords.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredRecords.length)}</span> of <span className="font-medium">{filteredRecords.length}</span> results
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
              Page {currentPage} of {totalPages || 1}
            </span>
          </div>

          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages || totalPages === 0}
            className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === totalPages || totalPages === 0
              ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
              : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
              }`}
          >
            <ChevronRight size={16} />
          </button>

          <button
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages || totalPages === 0}
            className={`p-1 rounded transition-colors ${currentPage === totalPages || totalPages === 0
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

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  };

  const renderCellValue = (record: DCNotice, columnKey: string) => {
    switch (columnKey) {
      case 'id':
        return record.id;
      case 'account_no':
        return record.account_no || '-';
      case 'full_name':
        return record.full_name || '-';
      case 'dc_notice_date':
        return formatDate(record.dc_notice_date);
      case 'invoice_id':
        return record.invoice_id || '-';
      case 'plan':
        return record.plan || '-';
      case 'contact_number':
        return record.contact_number || '-';
      case 'email_address':
        return record.email_address || '-';
      case 'address':
        return record.address || '-';

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

    exportToCSV('dc_notice_export', exportColumns, filteredRecords, renderCellValue);
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      {/* Sidebar Container */}
      <div
        onClick={() => {
          if (isMobile) {
            setMobileViewMode('list');
          }
        }}
        className={`${
          mobileViewMode === 'sidebar' ? 'flex w-full' : 'hidden'
        } md:flex border-r flex-shrink-0 flex flex-col relative ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`} style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}>
        <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
          <div className="flex items-center justify-between mb-1">
            <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>DC Notice</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Date Range Filter Section */}
          <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                DC Notice Date Range
              </span>
              {(dcNoticeDateFrom || dcNoticeDateTo) && (
                <button
                  onClick={() => {
                    setDcNoticeDateFrom('');
                    setDcNoticeDateTo('');
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
                  value={dcNoticeDateFrom}
                  onChange={(e) => setDcNoticeDateFrom(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={dcNoticeDateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
              <div className="relative">
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                <input
                  type="date"
                  value={dcNoticeDateTo}
                  onChange={(e) => setDcNoticeDateTo(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={dcNoticeDateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
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

          {/* DC Notice Month Dropdown */}
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
                <span className="font-medium">DC Notice Month</span>
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

      <div className={`${
        mobileViewMode === 'list' || !isMobile ? 'flex-1 flex flex-col' : 'hidden'
      } overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="flex flex-col h-full">
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
                    placeholder="Search DC Notice records..."
                  />
                </div>
              </div>
              <div className="relative z-50 flex-shrink-0" ref={filterDropdownRef}>
                <button
                  className={`px-4 py-2 rounded text-sm transition-colors flex items-center ${isDarkMode
                    ? 'hover:bg-gray-700 text-white bg-gray-800 border-gray-700'
                    : 'hover:bg-gray-200 text-gray-900 bg-white border border-gray-300'
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
                title={!isFullyLoaded ? "Loading records..." : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
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
                  <p className="mt-4">Loading DC Notice records...</p>
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
                                } ${column.width || ''} ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') : ''
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
                            className={`border-b transition-colors ${isDarkMode
                              ? 'border-gray-800 hover:bg-gray-800'
                              : 'border-gray-200 hover:bg-gray-50'
                              }`}
                          >
                            {filteredColumns.map((column, index) => (
                              <td
                                key={column.key}
                                className={`py-4 px-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                                  } ${column.width || ''} ${index < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200') : ''
                                  }`}
                                style={{
                                  width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                  minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                                }}
                              >
                                {renderCellValue(record, column.key)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className={`h-full flex items-center justify-center ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                  No items
                </div>
              )}
            </div>
            {!isLoading && !error && filteredRecords.length > 0 && <PaginationControls />}
          </div>
        </div>
      </div>

    </div>
  );
};

export default DCNoticePage;
