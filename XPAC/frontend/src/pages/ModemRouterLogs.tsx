import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Download,
  Eye,
  FileText,
  Filter,
  History,
  Layers,
  Loader2,
  MapPin,
  RefreshCw,
  Router,
  Search,
  Tag,
  User,
  Wrench,
  X,
} from 'lucide-react';
import {
  modemRouterLogsService,
  type ModemRouterLogRecord,
  type ModemRouterLogSummary,
} from '../services/modemRouterLogsService';
import { settingsColorPaletteService, type ColorPalette } from '../services/settingsColorPaletteService';

interface ModemRouterLogsProps {
  isDarkMode?: boolean;
}

const EVENT_TYPE_BADGES: Record<string, { label: string; bg: string; text: string; border: string }> = {
  'Installation': {
    label: 'Installation',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-500',
    border: 'border-emerald-500/30',
  },
  'Pullout': {
    label: 'Pullout',
    bg: 'bg-rose-500/15',
    text: 'text-rose-500',
    border: 'border-rose-500/30',
  },
  'Router Replacement (Removed)': {
    label: 'Replace (Removed)',
    bg: 'bg-amber-500/15',
    text: 'text-amber-500',
    border: 'border-amber-500/30',
  },
  'Router Replacement (Installed)': {
    label: 'Replace (Installed)',
    bg: 'bg-blue-500/15',
    text: 'text-blue-500',
    border: 'border-blue-500/30',
  },
  'Transfer / Relocation': {
    label: 'Relocation',
    bg: 'bg-purple-500/15',
    text: 'text-purple-500',
    border: 'border-purple-500/30',
  },
};

const getEventBadge = (eventType: string) => {
  if (EVENT_TYPE_BADGES[eventType]) {
    return EVENT_TYPE_BADGES[eventType];
  }
  if (eventType.toLowerCase().includes('pullout')) {
    return EVENT_TYPE_BADGES['Pullout'];
  }
  if (eventType.toLowerCase().includes('replace')) {
    return eventType.toLowerCase().includes('installed')
      ? EVENT_TYPE_BADGES['Router Replacement (Installed)']
      : EVENT_TYPE_BADGES['Router Replacement (Removed)'];
  }
  if (eventType.toLowerCase().includes('install')) {
    return EVENT_TYPE_BADGES['Installation'];
  }
  return {
    label: eventType,
    bg: 'bg-gray-500/15',
    text: 'text-gray-400',
    border: 'border-gray-500/30',
  };
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const ModemRouterLogs: React.FC<ModemRouterLogsProps> = ({ isDarkMode: isDarkModeProp }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof isDarkModeProp === 'boolean') return isDarkModeProp;
    const theme = localStorage.getItem('theme');
    return theme === 'dark' || theme === null;
  });

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  // Filters & query
  const [search, setSearch] = useState<string>('');
  const [activeSnFilter, setActiveSnFilter] = useState<string>('');
  const [eventType, setEventType] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(50);

  // Data & loading
  const [logs, setLogs] = useState<ModemRouterLogRecord[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [lastPage, setLastPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [summary, setSummary] = useState<ModemRouterLogSummary | null>(null);

  // Modal / Timeline Drawer
  const [selectedRecord, setSelectedRecord] = useState<ModemRouterLogRecord | null>(null);
  const [timelineSn, setTimelineSn] = useState<string | null>(null);
  const [timelineLogs, setTimelineLogs] = useState<ModemRouterLogRecord[]>([]);
  const [timelineLoading, setTimelineLoading] = useState<boolean>(false);

  // Dark mode listener
  useEffect(() => {
    if (typeof isDarkModeProp === 'boolean') {
      setIsDarkMode(isDarkModeProp);
      return;
    }
    const checkTheme = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [isDarkModeProp]);

  // Color palette
  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  // Fetch summary counters
  const loadSummary = useCallback(async () => {
    try {
      const sum = await modemRouterLogsService.getSummary();
      setSummary(sum);
    } catch (e) {
      console.error('Failed to load summary', e);
    }
  }, []);

  // Fetch logs
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await modemRouterLogsService.getLogs({
        search: activeSnFilter ? '' : search,
        sn: activeSnFilter || undefined,
        event_type: eventType,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
        per_page: perPage,
      });

      setLogs(response.data);
      setTotal(response.meta.total);
      setLastPage(response.meta.last_page);
    } catch (e) {
      console.error('Failed to load modem router logs', e);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [search, activeSnFilter, eventType, dateFrom, dateTo, page, perPage]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // View timeline for an SN
  const handleOpenTimeline = useCallback(async (sn: string) => {
    setTimelineSn(sn);
    setTimelineLoading(true);
    try {
      const history = await modemRouterLogsService.getTimelineBySn(sn);
      setTimelineLogs(history);
    } catch (e) {
      console.error('Failed to load timeline for SN', sn, e);
      setTimelineLogs([]);
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  const handleFilterBySn = (sn: string) => {
    setActiveSnFilter(sn);
    setSearch('');
    setPage(1);
  };

  const handleClearSnFilter = () => {
    setActiveSnFilter('');
    setPage(1);
  };

  const exportToCsv = () => {
    if (logs.length === 0) return;
    const headers = [
      'Date',
      'Serial Number (SN)',
      'Model',
      'Event Type',
      'Description',
      'Account No',
      'Customer Name',
      'Address',
      'LCP/NAP',
      'Port',
      'Technician',
      'Status',
      'Remarks',
    ];

    const rows = logs.map((row) => [
      `"${row.event_date}"`,
      `"${row.sn}"`,
      `"${row.model || ''}"`,
      `"${row.event_type}"`,
      `"${(row.description || '').replace(/"/g, '""')}"`,
      `"${row.account_no || ''}"`,
      `"${(row.customer_name || '').replace(/"/g, '""')}"`,
      `"${(row.address || '').replace(/"/g, '""')}"`,
      `"${row.lcpnap || ''}"`,
      `"${row.port || ''}"`,
      `"${(row.technician || '').replace(/"/g, '""')}"`,
      `"${row.status || ''}"`,
      `"${(row.remarks || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `modem_router_logs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Theme constants
  const bgCard = isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200';
  const textPrimary = isDarkMode ? 'text-gray-100' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const inputBg = isDarkMode ? 'bg-gray-950 border-gray-800 text-gray-100' : 'bg-white border-gray-300 text-gray-900';
  const rowHover = isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50';

  return (
    <div className={`p-4 md:p-6 min-h-screen space-y-5 ${isDarkMode ? 'bg-gray-950 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
              <Router className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Modem / Router Logs</h1>
              <p className={`text-xs ${textMuted}`}>
                Complete lifecycle movement tracking of all modem and router serial numbers
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              loadLogs();
              loadSummary();
            }}
            disabled={loading}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${bgCard} ${textPrimary} hover:opacity-90 disabled:opacity-50 cursor-pointer`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={exportToCsv}
            disabled={logs.length === 0}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${bgCard} ${textPrimary} hover:opacity-90 disabled:opacity-50 cursor-pointer`}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className={`p-3.5 rounded-xl border ${bgCard} shadow-xs`}>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-medium ${textMuted}`}>Total Movements</span>
              <Activity className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-xl font-bold mt-1.5 font-mono">{summary.total_movements.toLocaleString()}</div>
          </div>

          <div className={`p-3.5 rounded-xl border ${bgCard} shadow-xs`}>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-medium ${textMuted}`}>Active Serials</span>
              <Tag className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-xl font-bold mt-1.5 font-mono text-sky-400">{summary.unique_serials.toLocaleString()}</div>
          </div>

          <div className={`p-3.5 rounded-xl border ${bgCard} shadow-xs`}>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-medium ${textMuted}`}>Installations</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl font-bold mt-1.5 font-mono text-emerald-400">
              {summary.total_installations.toLocaleString()}
            </div>
          </div>

          <div className={`p-3.5 rounded-xl border ${bgCard} shadow-xs`}>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-medium ${textMuted}`}>Pullouts</span>
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-xl font-bold mt-1.5 font-mono text-rose-400">{summary.total_pullouts.toLocaleString()}</div>
          </div>

          <div className={`p-3.5 rounded-xl border ${bgCard} shadow-xs`}>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-medium ${textMuted}`}>Replacements</span>
              <Wrench className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl font-bold mt-1.5 font-mono text-amber-400">{summary.total_replacements.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Main Filter & Table Card */}
      <div className={`rounded-xl border shadow-xs overflow-hidden ${bgCard}`}>
        {/* Navigation Tabs */}
        <div className={`flex items-center gap-2 p-2 border-b overflow-x-auto ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          {[
            { id: 'all', label: 'All Movements', icon: Layers },
            { id: 'installation', label: 'Installations', icon: CheckCircle2 },
            { id: 'pullout', label: 'Pullouts', icon: AlertTriangle },
            { id: 'replacement', label: 'Replacements', icon: Wrench },
            { id: 'transfer', label: 'Relocations / Transfers', icon: MapPin },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = eventType === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setEventType(tab.id);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : `${textMuted} hover:text-gray-200 hover:bg-gray-800/40`
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Toolbar: Search, Date Pickers, Active SN indicator */}
        <div className={`p-3.5 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          {activeSnFilter && (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/25">
              <div className="flex items-center gap-2 text-xs">
                <Tag className="w-4 h-4 text-indigo-400" />
                <span>
                  Filtering all movements for Serial Number:{' '}
                  <span className="font-mono font-bold text-indigo-400">{activeSnFilter}</span>
                </span>
              </div>
              <button
                onClick={handleClearSnFilter}
                className="px-2 py-1 rounded text-xs font-medium text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Clear SN Filter
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center gap-2.5">
            {/* Search input */}
            <div className="relative flex-1 w-full">
              <Search className={`absolute left-3 top-2.5 w-4 h-4 ${textMuted}`} />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by SN, Account No, Customer, Technician, Location, Remarks..."
                disabled={!!activeSnFilter}
                className={`w-full pl-9 pr-8 py-2 rounded-lg border text-xs ${inputBg} disabled:opacity-50`}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className={`absolute right-2.5 top-2.5 ${textMuted} hover:text-gray-200`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Date range pickers */}
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-36">
                <Calendar className={`absolute left-2.5 top-2.5 w-3.5 h-3.5 ${textMuted}`} />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className={`w-full pl-8 pr-2 py-1.5 rounded-lg border text-xs ${inputBg}`}
                  title="From Date"
                />
              </div>
              <span className={`text-xs ${textMuted}`}>to</span>
              <div className="relative flex-1 sm:w-36">
                <Calendar className={`absolute left-2.5 top-2.5 w-3.5 h-3.5 ${textMuted}`} />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className={`w-full pl-8 pr-2 py-1.5 rounded-lg border text-xs ${inputBg}`}
                  title="To Date"
                />
              </div>
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                    setPage(1);
                  }}
                  className={`p-1.5 rounded-lg border ${textMuted} hover:text-gray-200 hover:bg-gray-800`}
                  title="Clear dates"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto min-h-[350px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className={`text-xs ${textMuted}`}>Loading modem / router movement logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <Router className={`w-10 h-10 ${textMuted} opacity-40`} />
              <p className="text-sm font-medium">No modem/router movements found</p>
              <p className={`text-xs ${textMuted}`}>Try broadening your search or adjusting the filters.</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className={`border-b text-[11px] uppercase tracking-wider font-semibold ${isDarkMode ? 'bg-gray-950/60 border-gray-800 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  <th className="px-3.5 py-3">Date & Time</th>
                  <th className="px-3.5 py-3">Serial Number (SN)</th>
                  <th className="px-3.5 py-3">Event Type</th>
                  <th className="px-3.5 py-3">Subscriber / Account</th>
                  <th className="px-3.5 py-3">Location & LCP/NAP</th>
                  <th className="px-3.5 py-3">Technician</th>
                  <th className="px-3.5 py-3">Status</th>
                  <th className="px-3.5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'divide-gray-800/70' : 'divide-gray-200'}`}>
                {logs.map((row) => {
                  const badge = getEventBadge(row.event_type);
                  return (
                    <tr key={row.id} className={`transition-colors ${rowHover}`}>
                      {/* Date */}
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <div className="font-medium">{formatDate(row.event_date)}</div>
                        <div className={`text-[10px] ${textMuted}`}>{row.source_type === 'job_order' ? `JO #${row.reference_id}` : `SO #${row.reference_id}`}</div>
                      </td>

                      {/* Serial Number */}
                      <td className="px-3.5 py-2.5">
                        <button
                          onClick={() => handleFilterBySn(row.sn)}
                          className="font-mono text-xs font-semibold text-indigo-400 hover:underline flex items-center gap-1.5 cursor-pointer text-left"
                          title="Click to view all movements for this SN"
                        >
                          <Router className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          <span>{row.sn}</span>
                        </button>
                        {row.model && <div className={`text-[10px] mt-0.5 ${textMuted}`}>{row.model}</div>}
                      </td>

                      {/* Event Type */}
                      <td className="px-3.5 py-2.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-medium whitespace-nowrap ${badge.bg} ${badge.text} ${badge.border}`}>
                          {badge.label}
                        </span>
                        <div className={`text-[11px] mt-1 max-w-[200px] truncate ${textMuted}`} title={row.description}>
                          {row.description}
                        </div>
                      </td>

                      {/* Subscriber / Account */}
                      <td className="px-3.5 py-2.5">
                        <div className="font-medium">{row.customer_name ?? '—'}</div>
                        <div className={`text-[10px] font-mono ${textMuted}`}>Acct: {row.account_no ?? '—'}</div>
                      </td>

                      {/* Location & LCP/NAP */}
                      <td className="px-3.5 py-2.5">
                        <div className="max-w-[220px] truncate text-[11px]" title={row.address || ''}>
                          {row.address ?? '—'}
                        </div>
                        {(row.lcpnap || row.port) && (
                          <div className={`text-[10px] mt-0.5 font-mono ${textMuted}`}>
                            {row.lcpnap} {row.port ? `· ${row.port}` : ''}
                          </div>
                        )}
                      </td>

                      {/* Technician */}
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 shrink-0 opacity-60" />
                          <span>{row.technician ?? '—'}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                            row.status?.toLowerCase() === 'done' || row.status?.toLowerCase() === 'completed'
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : row.status?.toLowerCase() === 'failed'
                              ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                          }`}
                        >
                          {row.status ?? 'Logged'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenTimeline(row.sn)}
                            className="px-2 py-1 rounded text-[11px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25 flex items-center gap-1 cursor-pointer"
                            title="View full device movement history"
                          >
                            <History className="w-3 h-3" />
                            Timeline
                          </button>
                          <button
                            onClick={() => setSelectedRecord(row)}
                            className={`p-1 rounded text-xs hover:bg-gray-800 ${textMuted} hover:text-gray-100 cursor-pointer`}
                            title="Inspect movement details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Bar */}
        <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 p-3 border-t text-xs ${isDarkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-600'}`}>
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
              className={`px-2 py-1 rounded border text-xs ${inputBg}`}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="ml-2">
              Showing {total === 0 ? 0 : (page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total.toLocaleString()} movements
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page <= 1 || loading}
              className={`p-1.5 rounded border ${bgCard} disabled:opacity-40 cursor-pointer`}
              title="First Page"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className={`p-1.5 rounded border ${bgCard} disabled:opacity-40 cursor-pointer`}
              title="Previous Page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono text-xs">
              Page {page} of {Math.max(1, lastPage)}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              disabled={page >= lastPage || loading}
              className={`p-1.5 rounded border ${bgCard} disabled:opacity-40 cursor-pointer`}
              title="Next Page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPage(lastPage)}
              disabled={page >= lastPage || loading}
              className={`p-1.5 rounded border ${bgCard} disabled:opacity-40 cursor-pointer`}
              title="Last Page"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Movement Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className={`w-full max-w-lg rounded-xl border shadow-xl p-5 ${bgCard} ${textPrimary}`}>
            <div className="flex items-center justify-between pb-3 border-b border-gray-700/50">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                  <Router className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Modem / Router Movement Details</h3>
                  <p className={`text-[11px] ${textMuted}`}>Serial: <span className="font-mono text-indigo-400">{selectedRecord.sn}</span></p>
                </div>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className={`p-1 rounded-lg hover:bg-gray-800 ${textMuted} cursor-pointer`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded-lg border ${isDarkMode ? 'bg-gray-950/60 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                  <span className={`block text-[10px] uppercase font-semibold ${textMuted}`}>Event Date</span>
                  <span className="font-medium text-xs mt-0.5 block">{formatDate(selectedRecord.event_date)}</span>
                </div>

                <div className={`p-3 rounded-lg border ${isDarkMode ? 'bg-gray-950/60 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                  <span className={`block text-[10px] uppercase font-semibold ${textMuted}`}>Event Type</span>
                  <span className="font-medium text-xs mt-0.5 block">{selectedRecord.event_type}</span>
                </div>

                <div className={`p-3 rounded-lg border ${isDarkMode ? 'bg-gray-950/60 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                  <span className={`block text-[10px] uppercase font-semibold ${textMuted}`}>Reference</span>
                  <span className="font-medium text-xs mt-0.5 block">
                    {selectedRecord.source_type === 'job_order' ? `Job Order #${selectedRecord.reference_id}` : `Service Order #${selectedRecord.reference_id}`}
                  </span>
                </div>

                <div className={`p-3 rounded-lg border ${isDarkMode ? 'bg-gray-950/60 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                  <span className={`block text-[10px] uppercase font-semibold ${textMuted}`}>Device Model</span>
                  <span className="font-medium text-xs mt-0.5 block">{selectedRecord.model || 'Standard ONT/ONU'}</span>
                </div>
              </div>

              <div className={`p-3 rounded-lg border space-y-2 ${isDarkMode ? 'bg-gray-950/60 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] uppercase font-semibold ${textMuted}`}>Subscriber / Location</span>
                  <span className="font-mono text-[11px] text-indigo-400">Acct: {selectedRecord.account_no ?? 'N/A'}</span>
                </div>
                <div className="font-medium">{selectedRecord.customer_name ?? '—'}</div>
                <div className={`text-xs ${textMuted}`}>{selectedRecord.address ?? '—'}</div>
                {(selectedRecord.lcpnap || selectedRecord.port) && (
                  <div className="font-mono text-[11px] text-indigo-300">
                    {selectedRecord.lcpnap} {selectedRecord.port ? `· Port: ${selectedRecord.port}` : ''}
                  </div>
                )}
              </div>

              <div className={`p-3 rounded-lg border space-y-1.5 ${isDarkMode ? 'bg-gray-950/60 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                <span className={`block text-[10px] uppercase font-semibold ${textMuted}`}>Technician & Remarks</span>
                <div className="flex items-center gap-1.5 font-medium">
                  <User className="w-3.5 h-3.5 opacity-60" />
                  <span>{selectedRecord.technician ?? 'Unassigned'}</span>
                </div>
                {selectedRecord.remarks && (
                  <p className={`text-[11px] mt-1 italic ${textMuted}`}>"{selectedRecord.remarks}"</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-gray-700/50">
              <button
                onClick={() => {
                  const sn = selectedRecord.sn;
                  setSelectedRecord(null);
                  handleOpenTimeline(sn);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 cursor-pointer"
              >
                <History className="w-3.5 h-3.5" />
                View Full Device Timeline
              </button>
              <button
                onClick={() => setSelectedRecord(null)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${isDarkMode ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-100'} cursor-pointer`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SN Lifecycle Timeline Drawer */}
      {timelineSn && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs">
          <div className={`w-full max-w-xl h-full shadow-2xl flex flex-col border-l ${isDarkMode ? 'bg-gray-900 border-gray-800 text-gray-100' : 'bg-white border-gray-200 text-gray-900'}`}>
            <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Device Movement Lifecycle</h3>
                  <p className="text-xs font-mono text-indigo-400">SN: {timelineSn}</p>
                </div>
              </div>
              <button
                onClick={() => setTimelineSn(null)}
                className={`p-1.5 rounded-lg hover:bg-gray-800 ${textMuted} cursor-pointer`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {timelineLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  <p className={`text-xs ${textMuted}`}>Fetching complete history for {timelineSn}...</p>
                </div>
              ) : timelineLogs.length === 0 ? (
                <div className="text-center py-20">
                  <p className="text-xs font-medium">No recorded movements found for this serial number.</p>
                </div>
              ) : (
                <div className="relative pl-6 border-l-2 border-indigo-500/30 space-y-6 my-2">
                  {timelineLogs.map((item, idx) => {
                    const badge = getEventBadge(item.event_type);
                    return (
                      <div key={item.id || idx} className="relative">
                        {/* Dot indicator on timeline */}
                        <div
                          className={`absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full border-2 ${
                            idx === 0
                              ? 'bg-indigo-500 border-indigo-300 ring-4 ring-indigo-500/20'
                              : isDarkMode
                              ? 'bg-gray-800 border-gray-600'
                              : 'bg-gray-200 border-gray-400'
                          }`}
                        />

                        <div className={`p-3.5 rounded-xl border space-y-2 ${bgCard}`}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${badge.bg} ${badge.text} ${badge.border}`}>
                              {badge.label}
                            </span>
                            <span className={`text-[11px] font-mono ${textMuted}`}>
                              {formatDate(item.event_date)}
                            </span>
                          </div>

                          <div className="text-xs font-semibold">{item.description}</div>

                          <div className="text-xs space-y-1">
                            {item.customer_name && (
                              <div className="flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                <span className="font-medium">{item.customer_name}</span>
                                {item.account_no && <span className={`text-[10px] ${textMuted}`}>({item.account_no})</span>}
                              </div>
                            )}

                            {item.address && (
                              <div className="flex items-center gap-1.5">
                                <MapPin className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                <span className={`text-[11px] ${textMuted}`}>{item.address}</span>
                              </div>
                            )}

                            {(item.lcpnap || item.port) && (
                              <div className={`text-[10px] pl-5 font-mono ${textMuted}`}>
                                {item.lcpnap} {item.port ? `· ${item.port}` : ''}
                              </div>
                            )}

                            {item.technician && (
                              <div className="flex items-center gap-1.5">
                                <Wrench className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                <span className={`text-[11px] ${textMuted}`}>Handled by: {item.technician}</span>
                              </div>
                            )}

                            {item.remarks && (
                              <div className={`text-[11px] pl-5 italic ${textMuted}`}>
                                "{item.remarks}"
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-gray-700/30 flex items-center justify-between text-[10px]">
                            <span className={textMuted}>
                              {item.source_type === 'job_order' ? `Job Order #${item.reference_id}` : `Service Order #${item.reference_id}`}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded font-medium ${
                                item.status?.toLowerCase() === 'done' || item.status?.toLowerCase() === 'completed'
                                  ? 'text-emerald-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              Status: {item.status ?? 'Logged'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-700/50 flex items-center justify-between">
              <span className={`text-xs ${textMuted}`}>
                Total logged events: <span className="font-bold">{timelineLogs.length}</span>
              </span>
              <button
                onClick={() => setTimelineSn(null)}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModemRouterLogs;
