import React, { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Columns3, Download, ArrowUp, ArrowDown, X
} from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { useTableColumns } from './globalfunctions/useTableColumns';
import { useRadiusQueueStore } from '../store/radiusQueueStore';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { RadiusQueueRecord } from '../services/radiusQueueService';
import { exportToCSV } from '../utils/exportUtils';

/**
 * The RADIUS operation queue.
 *
 * Every RADIUS call the system could not complete when it was needed — a
 * disconnect, a reconnect, a credential change — is parked in
 * radius_operation_queue and retried. This is that queue, read only: what is
 * waiting, how many times it has been tried, and what the server last said.
 *
 * Laid out as Data Logs is, deliberately — same header block, same column
 * chooser, same drag/sort/resize behaviour through useTableColumns, same
 * pagination footer. Somebody who knows that page knows this one.
 */

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

const allColumns = [
  { key: 'id', label: 'ID', width: 'min-w-16' },
  { key: 'account_no', label: 'Account No.', width: 'min-w-40' },
  { key: 'operation', label: 'Operation', width: 'min-w-44' },
  { key: 'status', label: 'Status', width: 'min-w-32' },
  { key: 'attempts', label: 'Attempts', width: 'min-w-28' },
  { key: 'source_type', label: 'Source', width: 'min-w-44' },
  { key: 'source_id', label: 'Source ID', width: 'min-w-28' },
  { key: 'last_error', label: 'Last Error', width: 'min-w-[340px]' },
  { key: 'params', label: 'Params', width: 'min-w-[340px]' },
  { key: 'next_retry_at', label: 'Next Retry', width: 'min-w-44' },
  { key: 'completed_at', label: 'Completed At', width: 'min-w-44' },
  { key: 'created_at', label: 'Created At', width: 'min-w-44' },
  { key: 'created_by', label: 'Created By', width: 'min-w-48' },
  { key: 'updated_at', label: 'Updated At', width: 'min-w-44' },
];

/**
 * "accountNumber" -> "Account Number", "new_username" -> "New Username".
 *
 * The queue's params are written by several different callers, some in camelCase
 * and some in snake_case, so both are handled rather than assuming one.
 */
const humaniseKey = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\S/g, c => c.toUpperCase());

/** A params value as text. Nulls and blanks read as "(empty)" rather than vanishing. */
const formatParamValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(v => formatParamValue(v)).join(', ') : '(empty)';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humaniseKey(k)}: ${formatParamValue(v)}`)
      .join(' · ');
  }
  return String(value);
};

/**
 * The params column/panel as label/value pairs.
 *
 * Returns null when the value is not an object — a bare string or a malformed
 * payload is shown as it stands rather than being forced into rows.
 */
const paramEntries = (params: string | null): Array<[string, string]> | null => {
  if (!params) return null;

  try {
    const parsed = JSON.parse(params);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    return Object.entries(parsed as Record<string, unknown>)
      .map(([k, v]) => [humaniseKey(k), formatParamValue(v)] as [string, string]);
  } catch {
    return null;
  }
};

/** The statuses the queue carries, for the filter and the status pill. */
const STATUS_OPTIONS = ['pending', 'success', 'failed', 'cancelled'];

const RadiusQueue: React.FC = () => {
  const { queueRecords, isLoading, error, fetchQueueRecords, refreshQueueRecords } = useRadiusQueueStore();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => document.documentElement.classList.contains('dark'));
  const [selectedRow, setSelectedRow] = useState<RadiusQueueRecord | null>(null);

  const {
    visibleColumns,
    displayedColumns,
    sortColumn,
    sortDirection,
    columnWidths,
    draggedColumn,
    dragOverColumn,
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
    storageKeyPrefix: 'radiusQueue',
    allColumns,
    defaultVisibleColumns: ['id', 'account_no', 'operation', 'status', 'attempts', 'last_error', 'next_retry_at', 'updated_at'],
  });

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(setColorPalette)
      .catch(err => console.error('Failed to fetch color palette:', err));
  }, []);

  useEffect(() => {
    const checkDarkMode = () => setIsDarkMode(document.documentElement.classList.contains('dark'));
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetchQueueRecords();
  }, [fetchQueueRecords]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const userOrgId = useMemo(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || null;
    } catch {
      return null;
    }
  }, []);

  const filteredRows = useMemo(() => {
    let filtered = queueRecords.filter((row) => {
      // Organisation scope: a user inside an organisation sees that
      // organisation's entries, a global user sees the unscoped ones.
      if (userOrgId) {
        if (row.organization_id !== userOrgId) return false;
      } else if (row.organization_id) {
        return false;
      }

      if (statusFilter !== 'all' && (row.status || '').toLowerCase() !== statusFilter) return false;

      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return [
          row.id, row.account_no, row.operation, row.status, row.source_type,
          row.source_id, row.last_error ?? '', row.params ?? '', row.created_by,
        ].some(v => String(v ?? '').toLowerCase().includes(q));
      }

      return true;
    });

    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        const pick = (row: RadiusQueueRecord) => (row as any)[sortColumn] ?? '';
        let aVal: any = pick(a);
        let bVal: any = pick(b);

        if (['next_retry_at', 'completed_at', 'created_at', 'updated_at'].includes(sortColumn)) {
          aVal = aVal ? new Date(aVal).getTime() || 0 : 0;
          bVal = bVal ? new Date(bVal).getTime() || 0 : 0;
        } else if (['attempts', 'id', 'source_id'].includes(sortColumn)) {
          aVal = Number(aVal) || 0;
          bVal = Number(bVal) || 0;
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
  }, [queueRecords, statusFilter, searchQuery, userOrgId, sortColumn, sortDirection]);

  const handleExport = () => {
    if (!filteredRows.length) return;

    exportToCSV('radius_queue_export', displayedColumns, filteredRows, (record: RadiusQueueRecord, key: string) => {
      if (key === 'attempts') return `${record.attempts} / ${record.max_attempts}`;
      return (record as any)[key] ?? '';
    });
  };

  /** Status pill, coloured by how much attention the row needs. */
  const statusPill = (status: string) => {
    const tone: Record<string, string> = {
      pending: isDarkMode ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-50 text-amber-700',
      success: isDarkMode ? 'bg-emerald-900/40 text-emerald-300' : 'bg-emerald-50 text-emerald-700',
      failed: isDarkMode ? 'bg-rose-900/40 text-rose-300' : 'bg-rose-50 text-rose-700',
      cancelled: isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
        tone[(status || '').toLowerCase()] || (isDarkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700')
      }`}>
        {status || '-'}
      </span>
    );
  };

  const renderCellValue = (row: RadiusQueueRecord, columnKey: string) => {
    switch (columnKey) {
      case 'id':
        return <span className={`text-xs font-bold ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>{row.id}</span>;
      case 'account_no':
        return <span className="text-xs font-semibold">{row.account_no || '-'}</span>;
      case 'operation':
        return (
          <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            {(row.operation || '-').replace(/_/g, ' ')}
          </span>
        );
      case 'status':
        return statusPill(row.status);
      case 'attempts': {
        // Exhausted attempts are the rows somebody has to act on, so they are
        // called out rather than left to be counted by eye.
        const exhausted = row.attempts >= row.max_attempts;
        return (
          <span className={`text-xs font-semibold ${exhausted ? 'text-rose-500' : isDarkMode ? 'text-slate-200' : 'text-gray-900'}`}>
            {row.attempts} / {row.max_attempts}
          </span>
        );
      }
      case 'source_type':
        return <span className="text-xs">{(row.source_type || '-').replace(/_/g, ' ')}</span>;
      case 'last_error':
        return row.last_error
          ? <span className="text-xs break-words">{row.last_error}</span>
          : '-';
      case 'params': {
        const entries = paramEntries(row.params);

        if (!entries) return row.params ? <span className="text-xs break-all opacity-80">{row.params}</span> : '-';

        return (
          <ul className="text-xs space-y-0.5">
            {entries.map(([label, value]) => (
              <li key={label} className="break-words">
                <span className={`font-semibold ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{label}:</span>{' '}
                <span className={`break-all ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{value}</span>
              </li>
            ))}
          </ul>
        );
      }
      default:
        return (row as any)[columnKey] || '-';
    }
  };

  const totalPages = Math.ceil(filteredRows.length / itemsPerPage);
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredRows.slice(start, start + itemsPerPage);
  }, [filteredRows, currentPage, itemsPerPage]);

  const activeColor = colorPalette?.primary || '#6366f1';

  return (
    <div className={`h-full flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className="w-full flex-1 flex flex-col overflow-hidden">

        {/* Header block */}
        <div className={`px-6 py-4 border-b flex items-center space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-300'}`}>
          <div className="flex items-center mr-2 whitespace-nowrap flex-shrink-0">
            <span className={`text-sm font-bold uppercase tracking-wider ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Radius Queue
            </span>
          </div>

          <div className="flex-1 min-w-[200px] flex-shrink-0">
            <GlobalSearch
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search account, operation, error..."
            />
          </div>

          {/* Column visibility */}
          <div className="relative flex-shrink-0" ref={columnsDropdownRef}>
            <button
              onClick={() => setColumnsDropdownOpen(!columnsDropdownOpen)}
              title="Column Visibility"
              className={`px-4 py-2 rounded text-sm transition-colors flex items-center flex-shrink-0 ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-200 text-gray-900 border border-gray-300'}`}
            >
              <Columns3 className="h-5 w-5" />
            </button>
            {columnsDropdownOpen && (
              <div className={`absolute top-full right-0 mt-2 w-80 rounded shadow-lg z-50 max-h-[70vh] flex flex-col ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
                <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Column Visibility</span>
                  <div className="flex space-x-2">
                    <button onClick={handleSelectAllColumns} className="text-xs" style={{ color: activeColor }}>Select All</button>
                    <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>|</span>
                    <button onClick={handleDeselectAllColumns} className="text-xs" style={{ color: activeColor }}>Deselect All</button>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 p-2 space-y-1">
                  {allColumns.map((column) => (
                    <label
                      key={column.key}
                      className={`flex items-center px-3 py-1.5 cursor-pointer text-xs rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(column.key)}
                        onChange={() => handleToggleColumn(column.key)}
                        className={`mr-3 h-4 w-4 rounded ${isDarkMode ? 'border-gray-600 bg-gray-700 focus:ring-offset-gray-800' : 'border-gray-300 bg-white focus:ring-offset-white'}`}
                        style={{ accentColor: activeColor }}
                      />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all cursor-pointer focus:outline-none flex-shrink-0 ${statusFilter !== 'all'
                ? 'text-red-500 border-red-500/50 focus:border-red-500'
                : isDarkMode
                  ? 'bg-gray-900 border-gray-800 text-white hover:bg-gray-800'
                  : 'bg-white border-gray-300 text-gray-900 hover:bg-gray-100'
              }`}
            style={{ height: '38px' }}
          >
            <option value="all" className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>All Statuses</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s} className={isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>

          {/* Export to CSV */}
          <button
            onClick={handleExport}
            disabled={isLoading || filteredRows.length === 0}
            title="Export to CSV"
            className="p-2 rounded-lg transition-all duration-200 flex items-center justify-center border disabled:opacity-50 flex-shrink-0"
            style={{ backgroundColor: isDarkMode ? '#111827' : '#ffffff', borderColor: activeColor, color: activeColor }}
            onMouseEnter={(e) => { if (!isLoading && filteredRows.length) e.currentTarget.style.backgroundColor = hexToRgba(activeColor, 0.1); }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? '#111827' : '#ffffff'; }}
          >
            <Download className="h-5 w-5" />
          </button>

          {/* Refresh */}
          <button
            onClick={() => refreshQueueRecords()}
            disabled={isLoading}
            title="Refresh Queue"
            className="p-2 rounded-lg transition-all duration-200 flex items-center justify-center border disabled:opacity-50 flex-shrink-0"
            style={{ backgroundColor: isDarkMode ? '#111827' : '#ffffff', borderColor: activeColor, color: activeColor }}
            onMouseEnter={(e) => { if (!isLoading) e.currentTarget.style.backgroundColor = hexToRgba(activeColor, 0.1); }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? '#111827' : '#ffffff'; }}
          >
            <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="py-24 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 mx-auto mb-4" style={{ borderColor: activeColor }}></div>
              <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Loading the radius queue...</p>
            </div>
          ) : error ? (
            <div className="py-24 text-center">
              <p className="text-red-500 font-bold mb-4">{error}</p>
              <button
                onClick={() => refreshQueueRecords()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl"
              >
                Retry
              </button>
            </div>
          ) : paginatedRows.length > 0 ? (
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
                        minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
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
                {paginatedRows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedRow(row)}
                    className={`border-b cursor-pointer transition-colors ${isDarkMode ? 'border-gray-800/80 hover:bg-gray-800/30' : 'border-gray-200 hover:bg-gray-100/30'}`}
                    title="Click to see the full params and error"
                  >
                    {displayedColumns.map((column, index) => (
                      <td
                        key={column.key}
                        className={`py-4 px-6 align-top text-xs ${
                          column.key === 'last_error' || column.key === 'params' ? 'max-w-[450px]' : ''
                        } ${
                          ['id', 'status', 'attempts', 'next_retry_at', 'completed_at', 'created_at', 'updated_at'].includes(column.key) ? 'whitespace-nowrap' : ''
                        } ${isDarkMode ? 'text-slate-200' : 'text-gray-900'} ${
                          index < displayedColumns.length - 1
                            ? isDarkMode ? 'border-r border-gray-850' : 'border-r border-gray-200'
                            : ''
                        }`}
                        style={{
                          width: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
                          minWidth: columnWidths[column.key] ? `${columnWidths[column.key]}px` : undefined,
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
              <p className={`text-sm ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>No queued radius operations found matching your filters</p>
            </div>
          )}
        </div>

        {/* Pagination footer */}
        {!isLoading && !error && filteredRows.length > 0 && (
          <div className={`border-t p-4 flex flex-col md:flex-row items-center md:justify-between gap-3 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className={`flex flex-col sm:flex-row items-center gap-4 text-sm text-center md:text-left ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
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
                Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredRows.length)}</span> of <span className="font-medium">{filteredRows.length}</span> results
              </div>
            </div>
            <div className="flex items-center space-x-2 flex-wrap justify-center">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} title="First Page"
                className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === 1
                  ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                  : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}>
                <ChevronsLeft size={16} />
              </button>
              <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} title="Previous Page"
                className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === 1
                  ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                  : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}>
                <ChevronLeft size={16} />
              </button>
              <span className={`px-2 text-sm whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Page {currentPage} of {totalPages}
              </span>
              <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} title="Next Page"
                className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === totalPages
                  ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                  : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}>
                <ChevronRight size={16} />
              </button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} title="Last Page"
                className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === totalPages
                  ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                  : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}>
                <ChevronsRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Row detail: the full params and error, which the cells truncate */}
      {selectedRow && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedRow(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-3xl max-h-[85vh] rounded-xl shadow-2xl overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}
          >
            <div className={`px-5 py-4 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-bold uppercase tracking-wider truncate">
                  #{selectedRow.id} · {(selectedRow.operation || '').replace(/_/g, ' ')}
                </span>
                {statusPill(selectedRow.status)}
              </div>
              <button
                onClick={() => setSelectedRow(null)}
                className={`p-1.5 rounded flex-shrink-0 ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                {[
                  ['Account No.', selectedRow.account_no || '-'],
                  ['Attempts', `${selectedRow.attempts} / ${selectedRow.max_attempts}`],
                  ['Source', `${(selectedRow.source_type || '').replace(/_/g, ' ')} #${selectedRow.source_id}`],
                  ['Next Retry', selectedRow.next_retry_at || '-'],
                  ['Completed At', selectedRow.completed_at || '-'],
                  ['Created At', selectedRow.created_at || '-'],
                  ['Created By', selectedRow.created_by || '-'],
                  ['Updated At', selectedRow.updated_at || '-'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className={`uppercase tracking-wide ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{label}</div>
                    <div className="font-medium mt-0.5 break-words">{value}</div>
                  </div>
                ))}
              </div>

              {selectedRow.last_error && (
                <div>
                  <div className={`text-xs uppercase tracking-wide mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Last Error</div>
                  <pre className={`text-xs whitespace-pre-wrap break-words rounded-lg p-3 ${isDarkMode ? 'bg-rose-950/40 text-rose-200' : 'bg-rose-50 text-rose-800'}`}>
                    {selectedRow.last_error}
                  </pre>
                </div>
              )}

              {selectedRow.params && (
                <div>
                  <div className={`text-xs uppercase tracking-wide mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Params</div>
                  {(() => {
                    const entries = paramEntries(selectedRow.params);

                    // Not an object we can read as fields — show it as it stands
                    // rather than pretending it has none.
                    if (!entries) {
                      return (
                        <div className={`text-xs break-all rounded-lg p-3 ${isDarkMode ? 'bg-gray-800 text-slate-200' : 'bg-gray-100 text-gray-800'}`}>
                          {selectedRow.params}
                        </div>
                      );
                    }

                    return (
                      <div className={`rounded-lg divide-y ${isDarkMode ? 'bg-gray-800 divide-gray-700' : 'bg-gray-100 divide-gray-200'}`}>
                        {entries.map(([label, value]) => (
                          <div key={label} className="flex items-start justify-between gap-4 px-3 py-2 text-xs">
                            <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>{label}</span>
                            <span className={`text-right break-all font-medium ${
                              value === '(empty)'
                                ? isDarkMode ? 'text-gray-500 italic' : 'text-gray-400 italic'
                                : isDarkMode ? 'text-slate-100' : 'text-gray-900'
                            }`}>
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RadiusQueue;
