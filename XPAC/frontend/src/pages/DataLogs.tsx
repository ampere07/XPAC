import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  RefreshCw, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Database, Filter, Columns3, Download, ArrowUp, ArrowDown, X
} from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { useTableColumns } from './globalfunctions/useTableColumns';
import { useDataLogsStore } from '../store/dataLogsStore';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { DataLogRecord } from '../services/dataLogsService';
import { exportToCSV } from '../utils/exportUtils';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

const allColumns = [
  { key: 'log_type', label: 'Log Type', width: 'min-w-44' },
  { key: 'id', label: 'ID', width: 'min-w-16' },
  { key: 'old_details', label: 'Old Details', width: 'min-w-[340px]' },
  { key: 'new_details', label: 'New Details', width: 'min-w-[340px]' },
  { key: 'created_at', label: 'Created At', width: 'min-w-44' },
  { key: 'created_by', label: 'Created By', width: 'min-w-48' },
  { key: 'updated_at', label: 'Updated At', width: 'min-w-44' },
  { key: 'updated_by', label: 'Updated By', width: 'min-w-48' },
];

const DataLogs: React.FC = () => {
  const { logRecords, isLoading, error, fetchLogRecords, refreshLogRecords } = useDataLogsStore();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [logTypeFilter, setLogTypeFilter] = useState<string>('all');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => document.documentElement.classList.contains('dark'));
  const [selectedCompareLog, setSelectedCompareLog] = useState<DataLogRecord | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const {
    visibleColumns,
    displayedColumns,
    columnOrder,
    sortColumn,
    sortDirection,
    columnWidths,
    draggedColumn,
    dragOverColumn,
    resizingColumn,
    filterDropdownOpen: columnsDropdownOpen,
    setFilterDropdownOpen: setColumnsDropdownOpen,
    filterDropdownRef: columnsDropdownRef,
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
    storageKeyPrefix: 'dataLogs',
    allColumns,
    defaultVisibleColumns: ['log_type', 'id', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  });

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);

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
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  // Load records on mount
  useEffect(() => {
    fetchLogRecords();
  }, [fetchLogRecords]);

  // Reset pagination when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, logTypeFilter]);

  const userOrgId = useMemo(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
    } catch {
      return null;
    }
  }, []);

  // Client-side instant live filtering
  const filteredLogs = useMemo(() => {
    let filtered = logRecords.filter((row) => {
      // Organization filter — mirrors applicationmanagement.tsx logic exactly
      if (userOrgId) {
        if ((row as any).organization_id !== userOrgId) return false;
      } else {
        if ((row as any).organization_id) return false;
      }
      // Filter by log type
      if (logTypeFilter !== 'all') {
        const rowType = row.log_type.toLowerCase();
        const filter = logTypeFilter.toLowerCase();

        if (filter === 'service_order' && !rowType.includes('service order') && !rowType.includes('serviceorders') && !rowType.includes('serviceorder')) return false;
        if (filter === 'job_order' && !rowType.includes('job order') && !rowType.includes('joborders') && !rowType.includes('joborder')) return false;
        if (filter === 'application' && !rowType.includes('application')) return false;
        if (filter === 'customer_details' && !rowType.includes('customer details')) return false;
        if (filter === 'billing_details' && !rowType.includes('billing details')) return false;
        if (filter === 'technical_details' && !rowType.includes('technical details')) return false;
        if (filter === 'other' && (
          rowType.includes('service order') || rowType.includes('serviceorders') || rowType.includes('serviceorder') ||
          rowType.includes('job order') || rowType.includes('joborders') || rowType.includes('joborder') ||
          rowType.includes('application') ||
          rowType.includes('customer details') ||
          rowType.includes('billing details') ||
          rowType.includes('technical details')
        )) return false;
      }

      // Filter by search query
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchType = row.log_type.toLowerCase().includes(q);
        const matchId = row.id.toLowerCase().includes(q);
        const matchCreatedBy = row.created_by.toLowerCase().includes(q);
        const matchUpdatedBy = row.updated_by.toLowerCase().includes(q);
        const matchOld = row.old_details ? row.old_details.toLowerCase().includes(q) : false;
        const matchNew = row.new_details ? row.new_details.toLowerCase().includes(q) : false;
        return matchType || matchId || matchCreatedBy || matchUpdatedBy || matchOld || matchNew;
      }

      return true;
    });

    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        const getVal = (t: any) => {
          switch (sortColumn) {
            case 'log_type': return t.log_type || '';
            case 'id': return t.id || '';
            case 'old_details': return typeof t.old_details === 'string' ? t.old_details : JSON.stringify(t.old_details || '');
            case 'new_details': return typeof t.new_details === 'string' ? t.new_details : JSON.stringify(t.new_details || '');
            case 'created_at': return t.created_at || '';
            case 'created_by': return t.created_by || '';
            case 'updated_at': return t.updated_at || '';
            case 'updated_by': return t.updated_by || '';
            default: return '';
          }
        };
        let aVal = getVal(a);
        let bVal = getVal(b);
        if (sortColumn === 'created_at' || sortColumn === 'updated_at') {
          aVal = aVal ? new Date(aVal).getTime() || 0 : 0;
          bVal = bVal ? new Date(bVal).getTime() || 0 : 0;
        } else {
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
        }
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [logRecords, logTypeFilter, searchQuery, userOrgId, sortColumn, sortDirection]);





  const handleExport = () => {
    if (!filteredLogs || filteredLogs.length === 0) return;

    const exportColumns = displayedColumns;
    const getExportValue = (record: DataLogRecord, columnKey: string) => {
      switch (columnKey) {
        case 'old_details':
          return record.old_details ? JSON.stringify(record.old_details) : '';
        case 'new_details':
          return record.new_details ? JSON.stringify(record.new_details) : '';
        default:
          return (record as any)[columnKey] || '';
      }
    };

    exportToCSV('data_logs_export', exportColumns, filteredLogs, getExportValue);
  };

  const renderDetailsJson = (val: any, row: DataLogRecord, columnKey: 'old_details' | 'new_details') => {
    if (!val) return '-';

    try {
      const parseData = (v: any) => {
        if (!v) return {};
        const parsed = typeof v === 'string' ? JSON.parse(v) : v;
        return parsed.data || parsed;
      };

      const data = parseData(val);
      const otherKey = columnKey === 'old_details' ? 'new_details' : 'old_details';
      const otherData = parseData(row[otherKey]);

      const oldData = parseData(row.old_details);
      const newData = parseData(row.new_details);

      const allKeys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)]))
        .filter(k => k !== 'type')
        .sort();

      if (allKeys.length === 0) return '-';

      const formatValue = (v: any, keyName?: string) => {
        if (v === null || v === undefined || v === '') return '(empty)';
        
        if (keyName && keyName.toLowerCase() === 'technicians') {
          const logType = row.log_type?.toLowerCase() || '';
          if (logType.includes('service order') || logType.includes('jo order') || logType.includes('job order') || logType.includes('serviceorder') || logType.includes('joborder')) {
            let arr = v;
            if (typeof v === 'string' && v.startsWith('[') && v.endsWith(']')) {
              try { arr = JSON.parse(v); } catch(e) {}
            }
            if (Array.isArray(arr)) {
              const filtered = arr.filter(t => t !== 'None' && t !== null && t !== '');
              return filtered.length > 0 ? filtered.join(', ') : '(empty)';
            }
          }
        }

        if (typeof v === 'object') {
          try {
            return JSON.stringify(v).replace(/[{}"]/g, '').replace(/:/g, ': ').replace(/,/g, ', ');
          } catch (e) {
            return '[Complex Object]';
          }
        }
        return String(v);
      };

      return (
        <ul className="text-xs w-full break-words max-h-[180px] overflow-y-auto overflow-x-hidden p-1 custom-scroll space-y-0.5">
          {allKeys.map((k) => {
            const v = data[k];
            const v_other = otherData[k];
            const displayKey = k.replace(/_/g, ' ')
              .split(' ')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');

            return (
              <li key={k} className="mb-0.5 grid grid-cols-1 grid-rows-1">
                <div className="invisible row-start-1 col-start-1 pointer-events-none" aria-hidden="true">
                  <span className="font-semibold">{displayKey}:</span>{' '}
                  <span className="break-all">{formatValue(v, k)}</span>
                </div>
                <div className="invisible row-start-1 col-start-1 pointer-events-none" aria-hidden="true">
                  <span className="font-semibold">{displayKey}:</span>{' '}
                  <span className="break-all">{formatValue(v_other, k)}</span>
                </div>

                <div className="row-start-1 col-start-1">
                  <span className={`font-semibold ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{displayKey}:</span>{' '}
                  <span className={`opacity-95 break-all ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{formatValue(v, k)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      );
    } catch (e) {
      return <span className={`text-xs break-all ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{String(val)}</span>;
    }
  };

  const renderCellValue = (row: DataLogRecord, columnKey: string) => {
    switch (columnKey) {
      case 'log_type':
        return (
          <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            {row.log_type}
          </span>
        );
      case 'id':
        return (
          <span className={`text-xs font-bold ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
            {row.id}
          </span>
        );
      case 'old_details':
        return renderDetailsJson(row.old_details, row, 'old_details');
      case 'new_details':
        return renderDetailsJson(row.new_details, row, 'new_details');
      case 'created_at':
        return row.created_at || '-';
      case 'created_by':
        return row.created_by || '-';
      case 'updated_at':
        return row.updated_at || '-';
      case 'updated_by':
        return row.updated_by || '-';
      default:
        return '-';
    }
  };

  // Pagination logic
  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredLogs, currentPage]);

  const activeColor = colorPalette?.primary || '#6366f1';

  return (
    <div className={`h-full flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}`}>

      {/* Main Glassmorphism container */}
      <div className="w-full flex-1 flex flex-col overflow-hidden">

        {/* Header Block matching PaymentPortal.tsx */}
        <div className={`px-6 py-4 border-b flex items-center space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-300'
          }`}>
          {/* Title Label */}
          <div className="flex items-center mr-2 whitespace-nowrap flex-shrink-0">
            <span className={`text-sm font-bold uppercase tracking-wider ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Data Logs
            </span>
          </div>

          {/* Expanded Search Input */}
          <div className="flex-1 min-w-[200px] flex-shrink-0">
            <GlobalSearch
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search data logs..."
            />
          </div>

          {/* Column Visibility Dropdown */}
          <div className="relative flex-shrink-0" ref={columnsDropdownRef}>
            <button
              onClick={() => setColumnsDropdownOpen(!columnsDropdownOpen)}
              title="Column Visibility"
              className={`px-4 py-2 rounded text-sm transition-colors flex items-center flex-shrink-0 ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-200 text-gray-900 border border-gray-300'
                }`}
            >
              <Columns3 className="h-5 w-5" />
            </button>
            {columnsDropdownOpen && (
              <div className={`absolute top-full right-0 mt-2 w-80 rounded shadow-lg z-50 max-h-[70vh] flex flex-col ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
                }`}>
                <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Column Visibility</span>
                  <div className="flex space-x-2">
                    <button onClick={handleSelectAllColumns} className="text-xs" style={{ color: activeColor }}>
                      Select All
                    </button>
                    <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>|</span>
                    <button onClick={handleDeselectAllColumns} className="text-xs" style={{ color: activeColor }}>
                      Deselect All
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 p-2 space-y-1">
                  {allColumns.map((column) => (
                    <label
                      key={column.key}
                      className={`flex items-center px-3 py-1.5 cursor-pointer text-xs rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(column.key)}
                        onChange={() => handleToggleColumn(column.key)}
                        className={`mr-3 h-4 w-4 rounded ${isDarkMode ? 'border-gray-600 bg-gray-700 focus:ring-offset-gray-800' : 'border-gray-300 bg-white focus:ring-offset-white'
                          }`}
                        style={{ accentColor: activeColor }}
                      />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Log Type select filter */}
          <select
            value={logTypeFilter}
            onChange={(e) => setLogTypeFilter(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all cursor-pointer focus:outline-none flex-shrink-0 ${logTypeFilter !== 'all'
                ? 'text-red-500 border-red-500/50 focus:border-red-500'
                : isDarkMode
                  ? 'bg-gray-900 border-gray-800 text-white hover:bg-gray-800'
                  : 'bg-white border-gray-300 text-gray-900 hover:bg-gray-100'
              }`}
            style={{
              height: '38px'
            }}
          >
            <option value="all" className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>All Log Types</option>
            <option value="service_order" className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>Service Orders</option>
            <option value="job_order" className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>JobOrders</option>
            <option value="application" className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>Applications</option>
            <option value="customer_details" className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>Customer Details</option>
            <option value="billing_details" className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>Billing Details</option>
            <option value="technical_details" className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>Technical Details</option>
            <option value="other" className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>Other System Logs</option>
          </select>

          {/* Export to CSV Button */}
          <button
            onClick={handleExport}
            disabled={isLoading || filteredLogs.length === 0}
            title="Export to CSV"
            className="p-2 rounded-lg transition-all duration-200 flex items-center justify-center border disabled:opacity-50 flex-shrink-0"
            style={{
              backgroundColor: isDarkMode ? '#111827' : '#ffffff',
              borderColor: activeColor,
              color: activeColor
            }}
            onMouseEnter={(e) => {
              if (!isLoading && filteredLogs.length > 0) {
                e.currentTarget.style.backgroundColor = hexToRgba(activeColor, 0.1);
              }
            }}
            onMouseLeave={(e) => {
              if (!isLoading && filteredLogs.length > 0) {
                e.currentTarget.style.backgroundColor = isDarkMode ? '#111827' : '#ffffff';
              }
            }}
          >
            <Download className="h-5 w-5" />
          </button>

          {/* Refresh Button */}
          <button
            onClick={() => refreshLogRecords()}
            disabled={isLoading}
            title="Refresh Logs"
            className="p-2 rounded-lg transition-all duration-200 flex items-center justify-center border disabled:opacity-50 flex-shrink-0"
            style={{
              backgroundColor: isDarkMode ? '#111827' : '#ffffff',
              borderColor: activeColor,
              color: activeColor
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.backgroundColor = hexToRgba(activeColor, 0.1);
              }
            }}
            onMouseLeave={(e) => {
              if (!isLoading) {
                e.currentTarget.style.backgroundColor = isDarkMode ? '#111827' : '#ffffff';
              }
            }}
          >
            <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Content/Table Block */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="py-24 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 mx-auto mb-4" style={{ borderColor: activeColor }}></div>
              <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Loading consolidated logs...</p>
            </div>
          ) : error ? (
            <div className="py-24 text-center">
              <p className="text-red-500 font-bold mb-4">{error}</p>
              <button
                onClick={() => refreshLogRecords()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl"
              >
                Retry
              </button>
            </div>
          ) : paginatedLogs.length > 0 ? (
            <table className="w-full min-w-max text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className={`${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-100 border-gray-300'} border-b`}>
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
                      className={`group relative py-3 px-6 text-xs font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none transition-colors ${
                        isDarkMode ? 'text-white bg-gray-900 hover:bg-gray-800' : 'text-gray-900 bg-gray-100 hover:bg-gray-200'
                      } ${index < displayedColumns.length - 1
                        ? isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-300'
                        : ''
                      } ${dragOverColumn === column.key ? (isDarkMode ? 'border-l-2 border-orange-500' : 'border-l-2 border-orange-600') : ''} ${draggedColumn === column.key ? 'opacity-50' : ''}`}
                      style={{
                        width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                        minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                      }}
                    >
                      <div className="flex items-center space-x-1">
                        <span>{column.label}</span>
                        {sortColumn === column.key && (
                          sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                        )}
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
                {paginatedLogs.map((row) => (
                  <tr
                    key={`${row.log_type}-${row.id}`}
                    onClick={() => setSelectedCompareLog(row)}
                    className={`border-b cursor-pointer transition-colors hover:bg-slate-500/5 ${isDarkMode ? 'border-gray-800/80 hover:bg-gray-800/30' : 'border-gray-200 hover:bg-gray-100/30'
                      }`}
                    title="Click to compare details"
                  >
                    {displayedColumns.map((column, index) => (
                      <td
                        key={column.key}
                        className={`py-4 px-6 align-top text-xs ${
                          column.key === 'created_by' || column.key === 'updated_by' ? 'max-w-[180px] truncate' : ''
                        } ${
                          column.key === 'old_details' || column.key === 'new_details' ? 'max-w-[450px]' : ''
                        } ${
                          column.key === 'log_type' || column.key === 'created_at' || column.key === 'updated_at' ? 'whitespace-nowrap' : ''
                        } ${isDarkMode ? 'text-slate-200' : 'text-gray-900'} ${
                          index < displayedColumns.length - 1
                            ? isDarkMode ? 'border-r border-gray-850' : 'border-r border-gray-200'
                            : ''
                        }`}
                        title={column.key === 'created_by' ? row.created_by : column.key === 'updated_by' ? row.updated_by : undefined}
                        style={{
                          width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                          minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined
                        }}
                      >
                        {renderCellValue(row, column.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-24 text-center">
              <p className={`text-sm ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>No data logs found matching your filters</p>
            </div>
          )}
        </div>

        {/* Pagination Footer */}
        {!isLoading && !error && filteredLogs.length > 0 && (
          <div className={`border-t p-4 flex flex-col md:flex-row items-center md:justify-between gap-3 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className={`flex flex-col sm:flex-row items-center gap-4 text-sm text-center md:text-left ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className={`px-2 py-1 rounded border focus:outline-none text-xs transition-colors ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white focus:border-orange-500'
                      : 'bg-white border-gray-300 text-gray-900 focus:border-orange-500'
                    }`}
                >
                  {[10, 25, 50, 100].map(v => (
                    <option key={v} value={v} className={isDarkMode ? 'bg-gray-850 text-white' : 'bg-white text-gray-900'}>{v}</option>
                  ))}
                </select>
                <span>entries</span>
              </div>
              <div>
                Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredLogs.length)}</span> of <span className="font-medium">{filteredLogs.length}</span> results
              </div>
            </div>
            <div className="flex items-center space-x-2 flex-wrap justify-center">
              <button
                onClick={() => setCurrentPage(1)}
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
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === 1
                  ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                  : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                  }`}
                title="Previous Page"
              >
                <ChevronLeft size={16} />
              </button>

              <div className="flex items-center space-x-1">
                <span className={`px-2 text-sm whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Page {currentPage} of {totalPages}
                </span>
              </div>

              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === totalPages
                  ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                  : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                  }`}
                title="Next Page"
              >
                <ChevronRight size={16} />
              </button>

              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === totalPages
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

      {/* Comparison Modal */}
      {selectedCompareLog && (
        <DetailsCompareModal
          row={selectedCompareLog}
          onClose={() => setSelectedCompareLog(null)}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
        />
      )}
    </div>
  );
};

interface DetailsCompareModalProps {
  row: DataLogRecord;
  onClose: () => void;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
}

const DetailsCompareModal: React.FC<DetailsCompareModalProps> = ({
  row,
  onClose,
  isDarkMode,
  colorPalette
}) => {
  const parseData = (v: any) => {
    if (!v) return {};
    try {
      const parsed = typeof v === 'string' ? JSON.parse(v) : v;
      return parsed.data || parsed;
    } catch (e) {
      return {};
    }
  };

  const oldData = parseData(row.old_details);
  const newData = parseData(row.new_details);

  const allKeys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)]))
    .filter(k => k !== 'type')
    .sort();

  const formatValue = (v: any, keyName?: string) => {
    if (v === null || v === undefined || v === '') return '(empty)';

    if (keyName && keyName.toLowerCase() === 'technicians') {
      const logType = row.log_type?.toLowerCase() || '';
      if (logType.includes('service order') || logType.includes('jo order') || logType.includes('job order') || logType.includes('serviceorder') || logType.includes('joborder')) {
        let arr = v;
        if (typeof v === 'string' && v.startsWith('[') && v.endsWith(']')) {
          try { arr = JSON.parse(v); } catch(e) {}
        }
        if (Array.isArray(arr)) {
          const filtered = arr.filter(t => t !== 'None' && t !== null && t !== '');
          return filtered.length > 0 ? filtered.join(', ') : '(empty)';
        }
      }
    }

    if (typeof v === 'object') {
      try {
        return JSON.stringify(v, null, 2);
      } catch (e) {
        return '[Complex Object]';
      }
    }
    return String(v);
  };

  const activeColor = colorPalette?.primary || '#6366f1';

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div 
        className={`w-full max-w-5xl rounded-2xl shadow-2xl border flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
          isDarkMode ? 'bg-gray-900 border-gray-800 text-white shadow-black/50' : 'bg-white border-gray-200 text-gray-900 shadow-gray-400/30'
        }`}
      >
        {/* Header */}
        <div className={`p-6 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-800 bg-gray-950/40' : 'border-gray-100 bg-gray-50/50'}`}>
          <div>
            <div className="flex items-center space-x-2">
              <span 
                className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white"
                style={{ backgroundColor: activeColor }}
              >
                {row.log_type}
              </span>
              <span className={`text-xs font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                ID: {row.id}
              </span>
            </div>
            <h3 className={`text-lg font-bold mt-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Data Log Comparison
            </h3>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-xl transition-all ${
              isDarkMode ? 'hover:bg-gray-800 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-950'
            }`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Metadata Info Panel */}
        <div className={`px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs border-b ${isDarkMode ? 'border-gray-800 bg-gray-900/50' : 'border-gray-100 bg-gray-50/20'}`}>
          <div>
            <span className={`block font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Created At</span>
            <span className="font-semibold">{row.created_at || '-'}</span>
          </div>
          <div>
            <span className={`block font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Created By</span>
            <span className="font-semibold truncate block" title={row.created_by}>{row.created_by || '-'}</span>
          </div>
          <div>
            <span className={`block font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Updated At</span>
            <span className="font-semibold">{row.updated_at || '-'}</span>
          </div>
          <div>
            <span className={`block font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Updated By</span>
            <span className="font-semibold truncate block" title={row.updated_by}>{row.updated_by || '-'}</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scroll">
          {allKeys.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              No details available for comparison.
            </div>
          ) : (
            <div className={`border rounded-xl overflow-hidden ${isDarkMode ? 'border-gray-800' : 'border-gray-250'} overflow-x-auto`}>
              <table className="w-full min-w-[600px] md:min-w-full text-left border-collapse table-fixed">
                <thead>
                  <tr className={`border-b text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'bg-gray-950/60 border-gray-800 text-slate-400' : 'bg-gray-100 border-gray-250 text-slate-600'}`}>
                    <th className="py-3 px-4 w-1/4">Field</th>
                    <th className="py-3 px-4 w-3/8">Old Value</th>
                    <th className="py-3 px-4 w-3/8">New Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/10">
                  {allKeys.map((k) => {
                    const oldVal = oldData[k];
                    const newVal = newData[k];
                    const isChanged = oldVal !== newVal;
                    const displayKey = k.replace(/_/g, ' ')
                      .split(' ')
                      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(' ');

                    return (
                      <tr 
                        key={k} 
                        className={`text-xs transition-colors hover:bg-slate-500/5 ${
                          isChanged
                            ? isDarkMode ? 'bg-orange-500/5 hover:bg-orange-500/10' : 'bg-orange-500/5 hover:bg-orange-500/10'
                            : ''
                        }`}
                      >
                        <td className={`py-3 px-4 font-semibold break-words align-top ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                          {displayKey}
                        </td>
                        <td className={`py-3 px-4 break-words align-top font-mono ${
                          isChanged 
                            ? isDarkMode 
                              ? 'text-red-400 bg-red-950/20 border-r border-red-900/10' 
                              : 'text-red-700 bg-red-50 border-r border-red-100' 
                            : isDarkMode ? 'text-slate-400' : 'text-slate-600'
                        }`}>
                          {formatValue(oldVal, k)}
                        </td>
                        <td className={`py-3 px-4 break-words align-top font-mono ${
                          isChanged 
                            ? isDarkMode 
                              ? 'text-green-400 bg-green-950/20' 
                              : 'text-green-700 bg-green-50' 
                            : isDarkMode ? 'text-slate-400' : 'text-slate-600'
                        }`}>
                          {formatValue(newVal, k)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DataLogs;
