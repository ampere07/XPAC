import { Mail, Circle, ChevronLeft, ChevronRight, ChevronDown, RefreshCw, ChevronsLeft, ChevronsRight, ArrowUp, ArrowDown, Columns3, X } from 'lucide-react';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import apiClient from '../config/api';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { useTableColumns } from './globalfunctions/useTableColumns';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

interface EmailLog {
  id: number;
  organization_id?: number | null;
  account_no?: string | null;
  recipient_email: string;
  cc?: string | null;
  bcc?: string | null;
  subject?: string | null;
  body_html?: string | null;
  attachment_path?: string | null;
  status: string;
  sent_at?: string | null;
  attempts?: number | null;
  error_message?: string | null;
  email_sender?: string | null;
  sender_name?: string | null;
  created_at?: string | null;
}

interface StatusItem {
  id: string;
  name: string;
  count: number;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  sent: { label: 'Sent', color: '#22c55e' },
  pending: { label: 'Pending', color: '#eab308' },
  failed: { label: 'Failed', color: '#ef4444' },
};

const EmailLogs: React.FC = () => {
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<EmailLog | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const [statementDateFrom, setStatementDateFrom] = useState<string>('');
  const [statementDateTo, setStatementDateTo] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  const [mobileViewMode, setMobileViewMode] = useState<'sidebar' | 'list'>('sidebar');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(setColorPalette)
      .catch(err => console.error('Failed to fetch color palette:', err));
  }, []);

  useEffect(() => {
    const checkDarkMode = () => setIsDarkMode(localStorage.getItem('theme') === 'dark');
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // All available columns for the table
  const allColumns = [
    { key: 'date', label: 'Date', width: 'min-w-48' },
    { key: 'recipient_email', label: 'Recipient', width: 'min-w-56' },
    { key: 'email_sender', label: 'Sender', width: 'min-w-48' },
    { key: 'subject', label: 'Subject', width: 'min-w-56' },
    { key: 'account_no', label: 'Account No.', width: 'min-w-32' },
    { key: 'status', label: 'Status', width: 'min-w-28' },
    { key: 'attempts', label: 'Attempts', width: 'min-w-24' },
    { key: 'cc', label: 'CC', width: 'min-w-40' },
    { key: 'bcc', label: 'BCC', width: 'min-w-40' },
    { key: 'sent_at', label: 'Sent At', width: 'min-w-48' },
  ];

  const {
    visibleColumns,
    displayedColumns,
    sortColumn,
    sortDirection,
    columnWidths,
    draggedColumn,
    dragOverColumn,
    filterDropdownOpen,
    setFilterDropdownOpen,
    filterDropdownRef,
    handleSort,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleMouseDownResize,
    handleToggleColumn,
    handleSelectAllColumns,
    handleDeselectAllColumns,
  } = useTableColumns({
    storageKeyPrefix: 'emailLogsTable',
    allColumns,
    defaultVisibleColumns: ['date', 'recipient_email', 'email_sender', 'subject', 'account_no', 'status'],
  });

  const fetchLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.get<any>('/email-queue', {
        params: { per_page: 1000 },
      });

      // Laravel paginator returns { data: [...] }
      const data = response.data?.data ?? response.data ?? [];
      setLogs(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Failed to fetch email logs:', err);
      setError('Failed to load email logs. Please try again.');
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatus, statementDateFrom, statementDateTo, selectedDate]);

  // Recursive search across all fields
  const checkValue = (obj: any, query: string): boolean => {
    if (!obj || query === '') return query === '';
    if (typeof obj === 'string') return obj.toLowerCase().includes(query.toLowerCase());
    if (typeof obj === 'number') return obj.toString().includes(query);
    if (Array.isArray(obj)) return obj.some((item) => checkValue(item, query));
    if (typeof obj === 'object') return Object.values(obj).some((value) => checkValue(value, query));
    return false;
  };

  const getLogDate = (log: EmailLog) => log.sent_at || log.created_at || '';

  const formatDateTime = (dateStr?: string | null): string => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
      const parts = formatter.formatToParts(date);
      const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
      return `${getPart('month')}/${getPart('day')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')} ${getPart('dayPeriod')}`;
    } catch {
      return dateStr;
    }
  };

  // Records matching the global filters (search + date range) but NOT status/month
  const globalFilteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = searchQuery === '' || checkValue(log, searchQuery);
      let matchesDateRange = true;
      if (statementDateFrom || statementDateTo) {
        const dateValue = new Date(getLogDate(log)).getTime();
        if (isNaN(dateValue)) {
          matchesDateRange = false;
        } else {
          if (statementDateFrom) {
            const fromDate = new Date(statementDateFrom).setHours(0, 0, 0, 0);
            if (dateValue < fromDate) matchesDateRange = false;
          }
          if (statementDateTo) {
            const toDate = new Date(statementDateTo).setHours(23, 59, 59, 999);
            if (dateValue > toDate) matchesDateRange = false;
          }
        }
      }
      return matchesSearch && matchesDateRange;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, searchQuery, statementDateFrom, statementDateTo]);

  // Sidebar resize handlers
  useEffect(() => {
    if (!isResizingSidebar) return;
    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - sidebarStartXRef.current;
      setSidebarWidth(Math.max(200, Math.min(500, sidebarStartWidthRef.current + diff)));
    };
    const handleMouseUp = () => setIsResizingSidebar(false);
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

  // Status sidebar items
  const statusItems: StatusItem[] = useMemo(() => {
    const filtered = globalFilteredLogs.filter(log => {
      const month = getLogDate(log).substring(0, 7);
      return selectedDate === 'All' || month === selectedDate;
    });
    const counts = new Map<string, number>();
    filtered.forEach(log => {
      const s = (log.status || 'unknown').toLowerCase();
      counts.set(s, (counts.get(s) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([id, count]) => ({
      id,
      name: STATUS_META[id]?.label || id,
      count,
    }));
  }, [globalFilteredLogs, selectedDate]);

  const dateItems = useMemo(() => {
    const filtered = globalFilteredLogs.filter(log =>
      selectedStatus === 'all' || (log.status || '').toLowerCase() === selectedStatus
    );
    const counts: Record<string, number> = {};
    const months = new Set<string>();
    filtered.forEach(log => {
      const month = getLogDate(log).substring(0, 7);
      if (month) {
        counts[month] = (counts[month] || 0) + 1;
        months.add(month);
      }
    });
    const sortedMonths = Array.from(months).sort().reverse().map(month => ({ date: month, count: counts[month] }));
    return { all: filtered.length, dates: sortedMonths };
  }, [globalFilteredLogs, selectedStatus]);

  // Final filtered + sorted records
  const filteredLogs = useMemo(() => {
    let filtered = logs.filter(log => {
      const matchesStatus = selectedStatus === 'all' || (log.status || '').toLowerCase() === selectedStatus;
      const matchesSearch = searchQuery === '' || checkValue(log, searchQuery);
      let matchesDateRange = true;
      if (statementDateFrom || statementDateTo) {
        const dateValue = new Date(getLogDate(log)).getTime();
        if (isNaN(dateValue)) {
          matchesDateRange = false;
        } else {
          if (statementDateFrom) {
            const fromDate = new Date(statementDateFrom).setHours(0, 0, 0, 0);
            if (dateValue < fromDate) matchesDateRange = false;
          }
          if (statementDateTo) {
            const toDate = new Date(statementDateTo).setHours(23, 59, 59, 999);
            if (dateValue > toDate) matchesDateRange = false;
          }
        }
      }
      const month = getLogDate(log).substring(0, 7);
      const matchesMonth = selectedDate === 'All' || month === selectedDate;
      return matchesStatus && matchesSearch && matchesDateRange && matchesMonth;
    });

    if (sortColumn) {
      const numericCols = ['attempts'];
      const dateCols = ['date', 'sent_at'];
      filtered = [...filtered].sort((a, b) => {
        const getVal = (t: EmailLog) => {
          switch (sortColumn) {
            case 'date': return getLogDate(t);
            case 'recipient_email': return t.recipient_email || '';
            case 'email_sender': return t.email_sender || t.sender_name || '';
            case 'subject': return t.subject || '';
            case 'account_no': return t.account_no || '';
            case 'status': return t.status || '';
            case 'attempts': return Number(t.attempts) || 0;
            case 'cc': return t.cc || '';
            case 'bcc': return t.bcc || '';
            case 'sent_at': return t.sent_at || '';
            default: return '';
          }
        };
        let aVal: any = getVal(a);
        let bVal: any = getVal(b);
        if (dateCols.includes(sortColumn)) {
          aVal = new Date(aVal || '').getTime() || 0;
          bVal = new Date(bVal || '').getTime() || 0;
        } else if (!numericCols.includes(sortColumn)) {
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
        }
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, selectedStatus, searchQuery, statementDateFrom, statementDateTo, selectedDate, sortColumn, sortDirection]);

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredLogs, currentPage]);

  const statusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    const color = STATUS_META[s]?.color || '#3b82f6';
    return (
      <div className="flex items-center space-x-2">
        <Circle className="h-3 w-3" style={{ color, fill: color }} />
        <span className="text-xs" style={{ color }}>{STATUS_META[s]?.label || status}</span>
      </div>
    );
  };

  const renderCellValue = (log: EmailLog, columnKey: string) => {
    switch (columnKey) {
      case 'date': return formatDateTime(getLogDate(log));
      case 'recipient_email': return <span className="text-red-400">{log.recipient_email}</span>;
      case 'email_sender': return log.email_sender || log.sender_name || '-';
      case 'subject': return <span title={log.subject || ''}>{log.subject || '-'}</span>;
      case 'account_no': return log.account_no || '-';
      case 'status': return statusBadge(log.status);
      case 'attempts': return log.attempts ?? 0;
      case 'cc': return log.cc || '-';
      case 'bcc': return log.bcc || '-';
      case 'sent_at': return formatDateTime(log.sent_at);
      default: return '-';
    }
  };

  return (
    <div className={`h-full flex overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Sidebar */}
      <div
        className={`${
          isMobile
            ? mobileViewMode === 'sidebar' ? 'flex w-full' : 'hidden'
            : 'flex-shrink-0 flex flex-col border-r relative'
        } transition-all duration-300 ease-in-out ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}
        style={!isMobile ? { width: `${sidebarWidth}px` } : undefined}
      >
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between shadow-sm ${isDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50/50 border-gray-100'}`}>
          <h2 className={`text-lg font-semibold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Email Logs
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* Date Range Filter */}
          <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Date Range</span>
              {(statementDateFrom || statementDateTo) && (
                <button
                  onClick={() => { setStatementDateFrom(''); setStatementDateTo(''); }}
                  className="text-[10px] font-bold uppercase tracking-wider hover:underline"
                  style={{ color: colorPalette?.primary || '#7c3aed' }}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="space-y-2">
              <div>
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>From</label>
                <input
                  type="date"
                  value={statementDateFrom}
                  onChange={(e) => setStatementDateFrom(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  style={statementDateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
              <div>
                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                <input
                  type="date"
                  value={statementDateTo}
                  onChange={(e) => setStatementDateTo(e.target.value)}
                  className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  style={statementDateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                />
              </div>
            </div>
          </div>

          {/* All Records */}
          <button
            onClick={() => { setSelectedStatus('all'); setSelectedDate('All'); if (isMobile) setMobileViewMode('list'); }}
            className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} ${selectedStatus === 'all' && selectedDate === 'All' ? '' : isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
            style={selectedStatus === 'all' && selectedDate === 'All' ? {
              backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(124, 58, 237, 0.2)',
              color: colorPalette?.primary || '#7c3aed'
            } : {}}
          >
            <div className="flex items-center"><span>All Records</span></div>
            <span
              className={`px-2 py-1 rounded text-xs transition-colors ${selectedStatus === 'all' && selectedDate === 'All' ? 'text-white' : isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-400'}`}
              style={selectedStatus === 'all' && selectedDate === 'All' ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
            >
              {globalFilteredLogs.length}
            </span>
          </button>

          {/* Month Dropdown */}
          <div className={`p-0 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-100'}`}>
            <button
              onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
              className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-700'}`}
            >
              <span className="font-medium">Month</span>
              <div className="flex items-center space-x-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>{dateItems.dates.length}</span>
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isDateDropdownOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {isDateDropdownOpen && (
              <div className={`${isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50/50 shadow-inner'}`}>
                {dateItems.dates.map((item, index) => (
                  <button
                    key={index}
                    onClick={() => { setSelectedDate(item.date); if (isMobile) setMobileViewMode('list'); }}
                    className={`w-full flex items-center justify-between px-6 py-2.5 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} ${selectedDate === item.date ? '' : isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}
                    style={selectedDate === item.date ? {
                      backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(124, 58, 237, 0.2)',
                      color: colorPalette?.primary || '#7c3aed', fontWeight: 500
                    } : {}}
                  >
                    <span className="truncate">{item.date}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${selectedDate === item.date ? 'text-white' : isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-500'}`}
                      style={selectedDate === item.date ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                    >
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status list */}
          <div className="py-2">
            {statusItems.map((status) => (
              <button
                key={status.id}
                onClick={() => { setSelectedStatus(status.id); if (isMobile) setMobileViewMode('list'); }}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${selectedStatus === status.id ? '' : isDarkMode ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'}`}
                style={selectedStatus === status.id ? {
                  backgroundColor: `${colorPalette?.primary || '#7c3aed'}33`,
                  color: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                <div className="flex items-center">
                  <Mail className="h-4 w-4 mr-2" />
                  <span className="capitalize">{status.name}</span>
                </div>
                {status.count > 0 && (
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${selectedStatus === status.id ? 'text-white' : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
                    style={selectedStatus === status.id ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                  >
                    {status.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {isMobile && (
            <div className="p-4 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setMobileViewMode('list')}
                className="w-full py-2.5 px-4 rounded-lg text-white font-medium text-sm transition-colors text-center block"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              >
                View Records
              </button>
            </div>
          )}
        </div>

        {!isMobile && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-10"
            style={{ backgroundColor: isResizingSidebar ? (colorPalette?.primary || '#7c3aed') : 'transparent' }}
            onMouseEnter={(e) => { if (!isResizingSidebar && colorPalette?.primary) e.currentTarget.style.backgroundColor = colorPalette.primary; }}
            onMouseLeave={(e) => { if (!isResizingSidebar) e.currentTarget.style.backgroundColor = 'transparent'; }}
            onMouseDown={handleMouseDownSidebarResize}
          />
        )}
      </div>

      {/* Main panel */}
      <div className={`${isMobile && mobileViewMode !== 'list' ? 'hidden' : 'flex-1'} overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
        <div className="flex flex-col h-full">
          {/* Toolbar */}
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center space-x-3 w-full overflow-x-auto scrollbar-none pb-1 -mb-1">
              {isMobile && mobileViewMode === 'list' && (
                <button
                  onClick={() => setMobileViewMode('sidebar')}
                  className={`p-2 rounded-lg transition-colors flex-shrink-0 ${isDarkMode ? 'hover:bg-gray-800 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'}`}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              <div className="flex-1 min-w-[200px] flex-shrink-0">
                <GlobalSearch
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  isDarkMode={isDarkMode}
                  colorPalette={colorPalette}
                  placeholder="Search email logs..."
                />
              </div>
              <div className="relative flex-shrink-0" ref={filterDropdownRef}>
                <button
                  onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                  title="Column Visibility"
                  className={`p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm border flex-shrink-0 ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-700' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
                  style={{ borderColor: colorPalette?.primary || '#7c3aed', color: colorPalette?.primary || '#7c3aed' }}
                >
                  <Columns3 className="h-5 w-5" />
                </button>
                {filterDropdownOpen && (
                  <div className={`absolute right-0 mt-2 w-56 rounded-lg shadow-xl border flex flex-col max-h-80 z-[100] ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                    <div className={`p-3 border-b flex justify-between items-center ${isDarkMode ? 'border-gray-700 bg-gray-900/50' : 'border-gray-100 bg-gray-50'}`}>
                      <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Column Visibility</span>
                      <div className="flex space-x-2">
                        <button onClick={handleSelectAllColumns} className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>Select All</button>
                        <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>|</span>
                        <button onClick={handleDeselectAllColumns} className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>Deselect All</button>
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {allColumns.map((column) => (
                        <label key={column.key} className={`flex items-center px-4 py-2 cursor-pointer text-sm ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}>
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
                onClick={fetchLogs}
                disabled={isLoading}
                title="Refresh Records"
                className="p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 flex-shrink-0"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed', color: isDarkMode ? '#111827' : '#ffffff' }}
              >
                <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-hidden">
            <div className="h-full overflow-y-auto">
              {isLoading ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <div className="animate-pulse flex flex-col items-center">
                    <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                    <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                  </div>
                  <p className="mt-4">Loading email logs...</p>
                </div>
              ) : error ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                  <p>{error}</p>
                  <button onClick={fetchLogs} className={`mt-4 text-white px-4 py-2 rounded ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-500 hover:bg-gray-600'}`}>Retry</button>
                </div>
              ) : (
                <div className="overflow-x-auto overflow-y-hidden">
                  <table className="w-max min-w-full text-sm border-separate border-spacing-0">
                    <thead>
                      <tr className={`border-b sticky top-0 z-10 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
                        {displayedColumns.map((column, index) => (
                          <th
                            key={column.key}
                            draggable
                            onDragStart={(e) => handleDragStart(e, column.key)}
                            onDragOver={(e) => handleDragOver(e, column.key)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, column.key)}
                            onDragEnd={handleDragEnd}
                            onClick={() => handleSort(column.key)}
                            className={`group relative text-left py-3 px-3 font-normal whitespace-nowrap cursor-pointer select-none transition-colors ${isDarkMode ? 'text-gray-400 bg-gray-850 hover:bg-gray-700' : 'text-gray-600 bg-gray-50 hover:bg-gray-100'} ${index < displayedColumns.length - 1 ? isDarkMode ? 'border-r border-gray-700' : 'border-r border-gray-200' : ''} ${dragOverColumn === column.key ? (isDarkMode ? 'border-l-2 border-orange-500' : 'border-l-2 border-orange-600') : ''} ${draggedColumn === column.key ? 'opacity-50' : ''}`}
                            style={{
                              width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                              minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                            }}
                          >
                            <div className="flex items-center space-x-1">
                              <span>{column.label}</span>
                              {sortColumn === column.key && (sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
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
                      {paginatedLogs.length > 0 ? (
                        paginatedLogs.map((log) => (
                          <tr
                            key={log.id}
                            className={`border-b cursor-pointer transition-colors ${isDarkMode ? 'border-gray-800 hover:bg-gray-900' : 'border-gray-200 hover:bg-gray-50'} ${selectedLog?.id === log.id ? isDarkMode ? 'bg-gray-800' : 'bg-gray-100' : ''}`}
                            onClick={() => setSelectedLog(log)}
                          >
                            {displayedColumns.map((column, index) => (
                              <td
                                key={column.key}
                                className={`py-4 px-3 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'} ${index < displayedColumns.length - 1 ? isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200' : ''}`}
                                style={{
                                  width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                                  minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                                }}
                              >
                                {renderCellValue(log, column.key)}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={displayedColumns.length} className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            No email logs found matching your filters
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Pagination */}
          {!isLoading && !error && filteredLogs.length > 0 && (
            <div className={`p-4 border-t flex flex-col sm:flex-row items-center sm:justify-between gap-3 ${isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-400' : 'bg-white border-gray-200 text-gray-600'}`}>
              <div className="text-sm text-center sm:text-left">
                Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredLogs.length)}</span> of <span className="font-medium">{filteredLogs.length}</span> records
              </div>
              <div className="flex items-center space-x-2 flex-wrap justify-center">
                <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className={`p-2 rounded border transition-colors ${isDarkMode ? 'border-gray-700 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent' : 'border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent'}`} title="First Page"><ChevronsLeft size={16} /></button>
                <button onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))} disabled={currentPage === 1} className={`p-2 rounded border transition-colors ${isDarkMode ? 'border-gray-700 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent' : 'border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent'}`} title="Previous Page"><ChevronLeft size={16} /></button>
                <div className="text-sm font-medium px-2 whitespace-nowrap">Page {currentPage} of {totalPages || 1}</div>
                <button onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages || totalPages === 0} className={`p-2 rounded border transition-colors ${isDarkMode ? 'border-gray-700 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent' : 'border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent'}`} title="Next Page"><ChevronRight size={16} /></button>
                <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages || totalPages === 0} className={`p-2 rounded border transition-colors ${isDarkMode ? 'border-gray-700 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent' : 'border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent'}`} title="Last Page"><ChevronsRight size={16} /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Details slide-over */}
      {selectedLog && (
        <div className={`fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:flex-shrink-0 md:w-full md:max-w-md border-l ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="absolute top-4 right-4 z-10">
            <button
              onClick={() => setSelectedLog(null)}
              className={`transition-colors rounded p-1 ${isDarkMode ? 'text-gray-400 hover:text-white bg-gray-800' : 'text-gray-600 hover:text-gray-900 bg-gray-200'}`}
            >
              <X size={20} />
            </button>
          </div>
          <div className="p-6 h-full overflow-y-auto">
            <h2 className={`text-xl font-semibold mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Email Log Details</h2>
            <div className="space-y-4">
              {[
                ['Recipient', selectedLog.recipient_email],
                ['Sender', selectedLog.email_sender || selectedLog.sender_name || '-'],
                ['Account No', selectedLog.account_no || '-'],
                ['CC', selectedLog.cc || '-'],
                ['BCC', selectedLog.bcc || '-'],
                ['Attempts', String(selectedLog.attempts ?? 0)],
                ['Sent At', formatDateTime(selectedLog.sent_at || selectedLog.created_at)],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <h3 className={`text-sm uppercase mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{label}</h3>
                  <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>{value}</p>
                </div>
              ))}
              <div>
                <h3 className={`text-sm uppercase mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Status</h3>
                {statusBadge(selectedLog.status)}
              </div>
              <div>
                <h3 className={`text-sm uppercase mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Subject</h3>
                <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>{selectedLog.subject || '-'}</p>
              </div>
              {selectedLog.body_html && (
                <div>
                  <h3 className={`text-sm uppercase mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Body</h3>
                  <div
                    className={`text-sm rounded p-3 max-h-60 overflow-auto ${isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-800'}`}
                    dangerouslySetInnerHTML={{ __html: selectedLog.body_html }}
                  />
                </div>
              )}
              {selectedLog.error_message && (
                <div>
                  <h3 className="text-sm text-red-400 uppercase mb-1">Error</h3>
                  <p className="text-red-300 whitespace-pre-wrap">{selectedLog.error_message}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailLogs;
