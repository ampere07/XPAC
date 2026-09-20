import React, { useState, useEffect, useRef } from 'react';
import { ChevronsLeft, ChevronsRight, X, RefreshCw , ChevronLeft, ChevronRight, Download, Menu } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import RebateFormModal from '../modals/RebateFormModal';
import RebateDetails from '../components/RebateDetails';
import apiClient from '../config/api';
import pusher from '../services/pusherService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { exportToCSV } from '../utils/exportUtils';
import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import { usePermissions } from '../hooks/usePermissions';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

interface RebateRecord {
  id: number;
  number_of_dates: number;
  rebate_type: string;
  selected_rebate: string;
  month: string;
  status: string;
  created_by: string;
  modified_by: string | null;
  modified_date: string;
  organization_id?: number | null;
}

const Rebate: React.FC = () => {
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [rebateRecords, setRebateRecords] = useState<RebateRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
  const isFullyLoaded = !isLoading;
  const [selectedRebate, setSelectedRebate] = useState<RebateRecord | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
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

  // Auto-navigate to list view when selectedDate changes on mobile
  useEffect(() => {
    if (isMobile && selectedDate !== 'All') {
      setMobileViewMode('list');
    }
  }, [selectedDate, isMobile]);

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
        console.error('Error parsing auth data in Rebate:', error);
      }
    }
  }, []);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
  const { can: hasPermission } = usePermissions();

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

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // 1. Initial search filtering (Global filtered set for sidebar counts)
  const globalFilteredRecords = React.useMemo(() => {
    const authData = JSON.parse(localStorage.getItem('authData') || '{}');
    const userOrgId = authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;

    let filtered = rebateRecords;

    // Organization filter — mirrors applicationmanagement.tsx logic exactly
    if (userOrgId) {
      // User belongs to an org: only show records assigned to that same org
      filtered = filtered.filter((record: RebateRecord) => record.organization_id === userOrgId);
    } else {
      // User has no org: only show records that have no org assigned
      filtered = filtered.filter((record: RebateRecord) => !record.organization_id);
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

    return filtered;
  }, [rebateRecords, searchQuery]);

  // Derive date items from context data instead of fetching separately or static
  const dateItems = React.useMemo(() => {
    const monthCounts: Record<string, number> = {};
    const months = new Set<string>();

    globalFilteredRecords.forEach(record => {
      if (record.month) {
        monthCounts[record.month] = (monthCounts[record.month] || 0) + 1;
        months.add(record.month);
      }
    });

    // Sort months (assuming standard month/year format or chronological)
    const sortedMonths = Array.from(months)
      .sort((a, b) => {
        // Simple sort, could be improved if months are in specific formats
        return b.localeCompare(a);
      })
      .map(month => ({
        date: month,
        count: monthCounts[month]
      }));

    return {
      all: globalFilteredRecords.length,
      dates: sortedMonths
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
    fetchRebateData();
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

  // Pusher/Soketi connection for real-time rebate updates
  useEffect(() => {
    const handleUpdate = async (data: any) => {
      setHasNewData(true);
      try {
        const response = await apiClient.get<RebateRecord[]>('/rebates');
        setRebateRecords(response.data);
      } catch (err) {
        console.error('[Rebate Soketi] Failed to refresh data:', err);
      }
    };

    const rebateChannel = pusher.subscribe('rebates');

    rebateChannel.bind('rebate-updated', handleUpdate);

    return () => {
      rebateChannel.unbind('rebate-updated', handleUpdate);
      pusher.unsubscribe('rebates');
    };
  }, []);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      try {
        const response = await apiClient.get<RebateRecord[]>('/rebates');
        setRebateRecords(response.data);
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
  }, []);

  const fetchRebateData = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.get<RebateRecord[]>('/rebates');
      setRebateRecords(response.data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch Rebate records:', err);
      setError('Failed to load Rebate records. Please try again.');
      setRebateRecords([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setHasNewData(false);
      setIsRefreshingManual(true);
      const response = await apiClient.get<RebateRecord[]>('/rebates');
      setRebateRecords(response.data);
      setError(null);
    } catch (err) {
      console.error('Failed to refresh Rebate records:', err);
    } finally {
      setIsRefreshingManual(false);
    }
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
    return globalFilteredRecords.filter(record => {
      if (selectedDate === 'All') return true;
      return record.month === selectedDate;
    });
  }, [globalFilteredRecords, selectedDate]);

  // Reset page when search or date filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDate, itemsPerPage]);

  // Scroll to top on page change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

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

  const rebateColumns = [
    { key: 'id', label: 'ID' },
    { key: 'rebate_type', label: 'Rebate Type' },
    { key: 'selected_rebate', label: 'Selected Rebate' },
    { key: 'month', label: 'Month' },
    { key: 'number_of_dates', label: 'Number of Dates' },
    { key: 'status', label: 'Status' },
    { key: 'modified_by', label: 'Approved By' },
    { key: 'modified_date', label: 'Modified Date' },
  ];

  const handleExport = () => {
    if (!filteredRecords || filteredRecords.length === 0) return;

    const getExportValue = (record: RebateRecord, columnKey: string) => {
      switch (columnKey) {
        case 'id': return record.id;
        case 'rebate_type': return record.rebate_type || '-';
        case 'selected_rebate': return record.selected_rebate || '-';
        case 'month': return record.month || '-';
        case 'number_of_dates': return record.number_of_dates;
        case 'status': return record.status || '-';
        case 'modified_by': return record.modified_by || '-';
        case 'modified_date': return formatDate(record.modified_date, true);
        default: return '-';
      }
    };

    exportToCSV('rebate_export', rebateColumns, filteredRecords, getExportValue);
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
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
              }`}>Rebates</h2>
            {hasPermission('mass-rebate.add') && (
              <div>
                <button
                  className="flex items-center space-x-1 text-white px-3 py-1 rounded text-sm transition-colors"
                  onClick={() => setIsModalOpen(true)}
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

          {/* Date Levels */}
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
                    placeholder="Search Rebate records..."
                  />
                </div>
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
                  <p className="mt-4">Loading Rebate records...</p>
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
              ) : filteredRecords.length > 0 ? (
                <table className={`min-w-full divide-y text-sm ${isDarkMode ? 'divide-gray-700' : 'divide-gray-200'
                  }`}>
                  <thead className={`sticky top-0 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'
                    }`}>
                    <tr>
                      <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>ID</th>
                      <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>Rebate Type</th>
                      <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>Selected Rebate</th>
                      <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>Month</th>
                      <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>Number of Dates</th>
                      <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>Status</th>
                      <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>Approved By</th>
                      <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>Modified Date</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode ? 'bg-gray-900 divide-gray-800' : 'bg-white divide-gray-200'
                    }`}>
                    {paginatedRecords.map((record) => (
                      <tr
                        key={record.id}
                        onClick={() => setSelectedRebate(record)}
                        className={`cursor-pointer ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
                          }`}
                      >
                        <td className={`px-4 py-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                          }`}>{record.id}</td>
                        <td className={`px-4 py-3 whitespace-nowrap capitalize ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                          }`}>{record.rebate_type}</td>
                        <td className={`px-4 py-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                          }`}>{record.selected_rebate}</td>
                        <td className={`px-4 py-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                          }`}>{record.month}</td>
                        <td className={`px-4 py-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                          }`}>{record.number_of_dates}</td>
                        <td className={`px-4 py-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                          }`}>{record.status}</td>
                        <td className={`px-4 py-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                          }`}>{record.modified_by || '-'}</td>
                        <td className={`px-4 py-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                          }`}>{formatDate(record.modified_date, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={`h-full flex flex-col items-center justify-center ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                  <h1 className="text-2xl mb-4" style={{ color: colorPalette?.primary || '#7c3aed' }}>Rebate Component</h1>
                  <p className="text-lg">No Rebate records found</p>
                </div>
              )}
            </div>
            {!isLoading && !error && filteredRecords.length > 0 && <PaginationControls />}
          </div>
        </div>
      </div>

      {selectedRebate && (
        <div className="flex-shrink-0 overflow-hidden">
          <RebateDetails
            rebate={selectedRebate as any}
            onClose={() => {
              setSelectedRebate(null);
              handleRefresh();
            }}
            onViewCustomer={handleViewCustomer}
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

      <RebateFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={() => {
          setIsModalOpen(false);
          handleRefresh();
        }}
      />
    </div>
  );
};

export default Rebate;
