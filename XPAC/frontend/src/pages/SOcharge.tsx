import React, { useState, useEffect, useRef } from 'react';
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Menu, ChevronDown, RefreshCw, ArrowUp, ArrowDown, Columns3, Download } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useSOChargeStore, SOChargeRecord } from '../store/soChargeStore';
import pusher from '../services/pusherService';
import { exportToCSV } from '../utils/exportUtils';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

const allColumns = [
  { key: 'id', label: 'ID', width: 'min-w-20' },
  { key: 'account_no', label: 'Account No', width: 'min-w-36' },
  { key: 'date', label: 'Date', width: 'min-w-36' },
  { key: 'type', label: 'Type', width: 'min-w-48' },
  { key: 'amount', label: 'Amount', width: 'min-w-28' },
  { key: 'source', label: 'Source', width: 'min-w-28' },
  { key: 'remarks', label: 'Remarks', width: 'min-w-64' },
];

const SOChargePage: React.FC = () => {
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const { chargeRecords, totalCount, isLoading, error, fetchChargeRecords, refreshChargeRecords, silentRefresh } = useSOChargeStore();
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState<boolean>(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Column management states
  const [sortColumn, setSortColumn] = useState<string | null>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('soChargeColumnOrder');
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
    const saved = localStorage.getItem('soChargeVisibleColumns');
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

  // Reset page when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDate, itemsPerPage, dateFrom, dateTo]);

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

  // Initial search filtering
  const globalFilteredRecords = React.useMemo(() => {
    let filtered = chargeRecords;

    // Organization filter — mirrors applicationmanagement.tsx logic exactly
    if (userOrgId) {
      filtered = filtered.filter((record) => record.organization_id === userOrgId);
    } else {
      filtered = filtered.filter((record) => !record.organization_id);
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

    // Apply date range filters
    if (dateFrom || dateTo) {
      filtered = filtered.filter(record => {
        if (!record.date) return false;

        const dateValue = new Date(record.date).getTime();
        if (isNaN(dateValue)) return false;

        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (dateValue < fromDate.getTime()) return false;
        }

        if (dateTo) {
          const toDate = new Date(dateTo);
          toDate.setHours(23, 59, 59, 999);
          if (dateValue > toDate.getTime()) return false;
        }

        return true;
      });
    }

    return filtered;
  }, [chargeRecords, searchQuery, dateFrom, dateTo, userOrgId]);

  // Derive date items for sidebar
  const dateItems = React.useMemo(() => {
    const dateCounts: Record<string, number> = {};
    const dates = new Map<string, string>();

    globalFilteredRecords.forEach(record => {
      if (record.date) {
        const date = new Date(record.date);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        const formatted = `${mm}/${yyyy}`; // Group by Month/Year
        dateCounts[formatted] = (dateCounts[formatted] || 0) + 1;
        dates.set(formatted, record.date);
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
    fetchChargeRecords();
  }, [fetchChargeRecords]);

  // Pusher listener
  useEffect(() => {
    const handleUpdate = async (data: any) => {
      setHasNewData(true);
      try {
        await silentRefresh();
      } catch (err) {
        console.error('[SOCharge Soketi] Failed to refresh data:', err);
      }
    };

    const serviceOrderChannel = pusher.subscribe('service-orders');
    serviceOrderChannel.bind('service-order-updated', handleUpdate);

    const chargeLogChannel = pusher.subscribe('service-charges');
    chargeLogChannel.bind('charge-updated', handleUpdate);

    return () => {
      serviceOrderChannel.unbind('service-order-updated', handleUpdate);
      pusher.unsubscribe('service-orders');
      chargeLogChannel.unbind('charge-updated', handleUpdate);
      pusher.unsubscribe('service-charges');
    };
  }, [silentRefresh]);

  // Initialize column order and visibility
  useEffect(() => {
    if (allColumns.length > 0 && columnOrder.length === 0) {
      setColumnOrder(allColumns.map(col => col.key));
      setVisibleColumns(['id', 'account_no', 'date', 'type', 'amount']);
    }
  }, [columnOrder.length]);

  const handleToggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const next = prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey];
      localStorage.setItem('soChargeVisibleColumns', JSON.stringify(next));
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    const allKeys = allColumns.map(col => col.key);
    setVisibleColumns(allKeys);
    localStorage.setItem('soChargeVisibleColumns', JSON.stringify(allKeys));
  };

  const handleDeselectAllColumns = () => {
    setVisibleColumns([]);
    localStorage.setItem('soChargeVisibleColumns', JSON.stringify([]));
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
    localStorage.setItem('soChargeColumnOrder', JSON.stringify(newOrder));
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

  const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarStartXRef.current = e.clientX;
    sidebarStartWidthRef.current = sidebarWidth;
  };

  useEffect(() => {
    if (!isResizingSidebar) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar) return;
      const diff = e.clientX - sidebarStartXRef.current;
      const newWidth = Math.max(200, Math.min(500, sidebarStartWidthRef.current + diff));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizingSidebar(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

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
      if (!record.date) return false;
      const date = new Date(record.date);
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      const formatted = `${mm}/${yyyy}`;
      return formatted === selectedDate;
    });

    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue: any = (a as any)[sortColumn] || '';
        let bValue: any = (b as any)[sortColumn] || '';

        if (sortColumn === 'amount') {
          aValue = Number(aValue) || 0;
          bValue = Number(bValue) || 0;
        } else if (sortColumn === 'date') {
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

  const totalDisplayCount = filteredRecords.length;
  const totalPages = Math.ceil(totalDisplayCount / itemsPerPage);

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
            Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, totalDisplayCount)}</span> of <span className="font-medium">{totalDisplayCount}</span> results
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={() => handlePageChange(1)} disabled={currentPage === 1} className={`p-1 rounded transition-colors ${currentPage === 1 ? 'text-gray-600 cursor-not-allowed' : (isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100')}`}>
            <ChevronsLeft className="h-5 w-5" />
          </button>
          <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === 1 ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}>
            <ChevronLeft size={16} />
          </button>
          <span className={`px-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Page {currentPage} of {totalPages}</span>
          <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === totalPages ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}>
            <ChevronRight size={16} />
          </button>
          <button onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} className={`p-1 rounded transition-colors ${currentPage === totalPages ? 'text-gray-600 cursor-not-allowed' : (isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100')}`}>
            <ChevronsRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  };

  const renderCellValue = (record: SOChargeRecord, columnKey: string) => {
    switch (columnKey) {
      case 'id': return record.display_id;
      case 'account_no': return record.account_no || '-';
      case 'date': return formatDate(record.date);
      case 'type': return record.type || '-';
      case 'amount': return `₱ ${record.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
      case 'source': return record.source || '-';
      case 'remarks': return record.remarks || '-';
      default: return '-';
    }
  };

  const handleExport = () => {
    if (!filteredRecords.length) return;
    const exportColumns = allColumns.filter(col => visibleColumns.includes(col.key)).sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key));
    const getExportValue = (record: SOChargeRecord, columnKey: string) => renderCellValue(record, columnKey);
    exportToCSV('so_charge_export', exportColumns, filteredRecords, getExportValue);
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden pb-16 md:pb-0 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Sidebar */}
      <div className={`hidden md:flex border-r flex-shrink-0 flex flex-col relative ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`} style={{ width: `${sidebarWidth}px` }}>
        <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>SO Charges</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Date Range Filter */}
          <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Date Range</span>
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[10px] font-bold uppercase tracking-wider hover:underline" style={{ color: colorPalette?.primary || '#7c3aed' }}>Clear</button>
              )}
            </div>
            <div className="space-y-2">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`} style={dateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}} />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`} style={dateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}} />
            </div>
          </div>

          {/* All Records */}
          <button onClick={() => setSelectedDate('All')} className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} ${selectedDate === 'All' ? '' : (isDarkMode ? 'text-gray-300' : 'text-gray-700')}`} style={selectedDate === 'All' ? { backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)', color: colorPalette?.primary || '#7c3aed' } : {}}>
            <span>All Records</span>
            <span className={`px-2 py-1 rounded text-xs ${selectedDate === 'All' ? 'text-white' : (isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500')}`} style={selectedDate === 'All' ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}>{dateItems.all}</span>
          </button>

          {/* Grouped Dates Dropdown */}
          <div className={`p-0 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-100'}`}>
            <button onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)} className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-700'}`}>
              <span className="font-medium">Billing Month</span>
              <div className="flex items-center space-x-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>{dateItems.dates.length}</span>
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isDateDropdownOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {isDateDropdownOpen && (
              <div className={isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50/50 shadow-inner'}>
                {dateItems.dates.map((item, index) => (
                  <button key={index} onClick={() => setSelectedDate(item.date)} className={`w-full flex items-center justify-between px-6 py-2.5 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} ${selectedDate === item.date ? '' : (isDarkMode ? 'text-gray-400' : 'text-gray-600')}`} style={selectedDate === item.date ? { backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)', color: colorPalette?.primary || '#7c3aed' } : {}}>
                    <span>{item.date}</span>
                    <span className="text-xs opacity-60">{item.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/30 transition-colors" onMouseDown={handleMouseDownSidebarResize} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className={`p-4 border-b ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`}>
          <div className="flex flex-col space-y-3">
            <div className="flex items-center justify-between space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
              <div className="flex items-center space-x-3 flex-1 min-w-[250px]">
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className={`md:hidden p-2 rounded-lg transition-colors flex items-center justify-center flex-shrink-0 border ${isDarkMode ? 'hover:bg-gray-800 text-gray-400 border-gray-700' : 'hover:bg-gray-100 text-gray-600 border-gray-300'
                    }`}
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="flex-1 w-full">
                  <GlobalSearch
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    isDarkMode={isDarkMode}
                    colorPalette={colorPalette}
                    placeholder="Search SO charges..."
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 flex-shrink-0">
                <div className="relative z-[100]" ref={filterDropdownRef}>
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
                    <div className={`fixed mt-10 w-80 rounded shadow-lg z-[100] max-h-[70vh] flex flex-col -translate-x-[calc(100%-2.5rem)] ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
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
                  disabled={isLoading || isRefreshingManual}
                  title={isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
                  className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: colorPalette?.primary || '#7c3aed',
                    color: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading && !isRefreshingManual && colorPalette?.primary) {
                      e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading && !isRefreshingManual) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <RefreshCw className={`h-5 w-5 ${(isLoading || isRefreshingManual) ? 'animate-spin' : ''}`} />
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

        <div className="flex-1 overflow-auto" ref={scrollRef}>
          <div className="min-h-full">
            {isLoading && !isRefreshingManual ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500"><RefreshCw className="animate-spin mb-4" size={32} /><p>Loading records...</p></div>
            ) : error ? (
              <div className="px-4 py-12 text-center text-red-500"><p>{error}</p><button onClick={handleRefresh} className="mt-4 px-4 py-2 bg-gray-700 text-white rounded">Retry</button></div>
            ) : paginatedRecords.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-max min-w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className={`sticky top-0 z-10 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                      {filteredColumns.map((col, idx) => (
                        <th key={col.key} draggable onDragStart={e => handleDragStart(e, col.key)} onDragOver={e => handleDragOver(e, col.key)} onDrop={e => handleDrop(e, col.key)} onClick={() => handleSort(col.key)} className={`relative text-left py-3 px-3 font-normal whitespace-nowrap cursor-pointer transition-colors ${isDarkMode ? 'text-gray-400 border-gray-700 hover:bg-gray-700' : 'text-gray-600 border-gray-200 hover:bg-gray-200'} ${idx < filteredColumns.length - 1 ? 'border-r' : ''}`} style={{ width: columnWidths[col.key] ? `${columnWidths[col.key]}px` : undefined }}>
                          <div className="flex items-center space-x-1"><span>{col.label}</span>{sortColumn === col.key && (sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}</div>
                          <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover:opacity-100" onMouseDown={e => handleMouseDownResize(e, col.key)} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode ? 'bg-gray-900 divide-gray-800' : 'bg-white divide-gray-200'}`}>
                    {paginatedRecords.map(record => (
                      <tr key={record.id} className={`hover:bg-gray-800/30 transition-colors`}>
                        {filteredColumns.map((col, idx) => (
                          <td key={col.key} className={`py-4 px-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'} ${idx < filteredColumns.length - 1 ? (isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200') : ''}`}>{renderCellValue(record, col.key)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-full py-12 text-center text-gray-500"><p>No charge records found.</p></div>
            )}
          </div>
        </div>
        {!isLoading && filteredRecords.length > 0 && <PaginationControls />}
      </div>
    </div>
  );
};

export default SOChargePage;
