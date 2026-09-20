import React, { useState, useEffect } from 'react';
import { logsService } from '../services/userService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import GlobalSearch from './globalfunctions/GlobalSearch';

interface ActivityLog {
  log_id: number;
  level: 'info' | 'warning' | 'error' | 'debug';
  action: string;
  message: string;
  user_id?: number;
  target_user_id?: number;
  resource_type?: string;
  resource_id?: number;
  ip_address?: string;
  user_agent?: string;
  additional_data?: any;
  organization_id?: number;
  created_at: string;
  updated_at: string;
  user?: {
    user_id: number;
    username: string;
    full_name: string;
  };
  target_user?: {
    user_id: number;
    username: string;
    full_name: string;
  };
}

interface LogStats {
  total_logs: number;
  by_level: {
    info: number;
    warning: number;
    error: number;
    debug: number;
  };
  recent_actions: Array<{
    action: string;
    count: number;
  }>;
  active_users: Array<{
    user_id: number;
    activity_count: number;
    user?: {
      user_id: number;
      username: string;
      full_name: string;
    };
  }>;
}

const Logs: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showStats, setShowStats] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark');
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const levelColors = {
    info: 'text-blue-400 bg-blue-900',
    warning: 'text-yellow-400 bg-yellow-900',
    error: 'text-red-400 bg-red-900',
    debug: 'text-gray-400 bg-gray-700'
  };

  const loadLogs = async (page = 1) => {
    setLoading(true);
    try {
      const params = {
        page,
        per_page: 20,
        search: searchQuery || undefined,
        level: filterLevel !== 'all' ? filterLevel : undefined,
      };

      const response = await logsService.getLogs(params);
      if (response.success && response.data) {
        try {
          const authData = JSON.parse(localStorage.getItem('authData') || '{}');
          const userOrgId = authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;

          // Organization filter — mirrors applicationmanagement.tsx logic exactly
          const filteredLogs = response.data.filter((log: any) => {
            if (userOrgId) {
              return log.organization_id === userOrgId;
            } else {
              return !log.organization_id;
            }
          });

          setLogs(filteredLogs);
        } catch {
          setLogs(response.data);
        }
        if (response.pagination) {
          setCurrentPage(response.pagination.current_page);
          setTotalPages(response.pagination.last_page);
        }
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await logsService.getStats(7); // Last 7 days
      if (response.success && response.data) {
        setStats(response.data);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  useEffect(() => {
    loadLogs();
    loadStats();
  }, []);

  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      if (currentPage === 1) {
        loadLogs(1);
      } else {
        setCurrentPage(1);
        loadLogs(1);
      }
    }, 500);

    return () => clearTimeout(delayedSearch);
  }, [searchQuery, filterLevel]);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    loadLogs(newPage);
  };

  const handleExport = async () => {
    try {
      const response = await logsService.exportLogs({
        format: 'csv',
        level: filterLevel !== 'all' ? filterLevel : undefined,
        days: 30
      });

      const blob = new Blob([response], {
        type: 'text/csv'
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `activity_logs_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export logs:', error);
    }
  };

  const formatDateTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      const parts = formatter.formatToParts(date);
      const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
      
      return `${getPart('month')}/${getPart('day')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')} ${getPart('dayPeriod')}`;
    } catch (e) {
      return dateString;
    }
  };

  const formatAction = (action: string) => {
    return action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <div className={isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}>
      <div className="p-6">
        <div className="mb-8">
          <h2 className={`text-2xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>
            Activity Logs
          </h2>
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
            Monitor system activities and user actions
          </p>
        </div>

        {/* Stats Section */}
        {stats && (
          <div className="mb-6">
            <button
              onClick={() => setShowStats(!showStats)}
              className={isDarkMode ? 'text-blue-400 hover:text-blue-300 text-sm mb-4' : 'text-blue-600 hover:text-blue-700 text-sm mb-4'}
            >
              {showStats ? 'Hide Statistics' : 'Show Statistics (Last 7 Days)'}
            </button>

            {showStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className={`p-4 rounded ${isDarkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200'
                  }`}>
                  <div className={`text-2xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>{stats.total_logs}</div>
                  <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>Total Activities</div>
                </div>
                <div className={`p-4 rounded ${isDarkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200'
                  }`}>
                  <div className={`text-2xl font-semibold ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{stats.by_level.error}</div>
                  <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>Errors</div>
                </div>
                <div className={`p-4 rounded ${isDarkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200'
                  }`}>
                  <div className={`text-2xl font-semibold ${isDarkMode ? 'text-yellow-400' : 'text-yellow-600'
                    }`}>{stats.by_level.warning}</div>
                  <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>Warnings</div>
                </div>
                <div className={`p-4 rounded ${isDarkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200'
                  }`}>
                  <div className={`text-2xl font-semibold ${isDarkMode ? 'text-blue-400' : 'text-blue-600'
                    }`}>{stats.by_level.info}</div>
                  <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>Info</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center space-x-3 w-full overflow-x-auto scrollbar-none pb-1 -mb-1 mb-8">
          <div className="flex-1 min-w-[200px] flex-shrink-0">
            <GlobalSearch 
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search logs by message, action, or user..."
            />
          </div>

          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className={`px-4 py-3 rounded focus:outline-none flex-shrink-0 ${isDarkMode
              ? 'bg-gray-900 border border-gray-600 text-white focus:border-gray-400'
              : 'bg-white border border-gray-300 text-gray-900 focus:border-gray-500'
              }`}
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>

          <button
            onClick={handleExport}
            className={`px-6 py-3 rounded transition-colors text-sm font-medium flex-shrink-0 ${isDarkMode
              ? 'bg-gray-600 text-white hover:bg-gray-700'
              : 'bg-gray-500 text-white hover:bg-gray-600'
              }`}
          >
            Export Logs
          </button>
        </div>

        {/* Logs Table */}
        <div className={`rounded overflow-hidden ${isDarkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200'
          }`}>
          {loading ? (
            <div className={`p-8 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
              Loading logs...
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] md:min-w-full">
                  <thead>
                    <tr className={isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}>
                      <th className={`px-4 py-4 text-left text-sm font-medium border-b ${isDarkMode ? 'text-gray-300 border-gray-600' : 'text-gray-700 border-gray-200'
                        }`}>Time</th>
                      <th className={`px-4 py-4 text-left text-sm font-medium border-b ${isDarkMode ? 'text-gray-300 border-gray-600' : 'text-gray-700 border-gray-200'
                        }`}>Level</th>
                      <th className={`px-4 py-4 text-left text-sm font-medium border-b ${isDarkMode ? 'text-gray-300 border-gray-600' : 'text-gray-700 border-gray-200'
                        }`}>Action</th>
                      <th className={`px-4 py-4 text-left text-sm font-medium border-b ${isDarkMode ? 'text-gray-300 border-gray-600' : 'text-gray-700 border-gray-200'
                        }`}>User</th>
                      <th className={`px-4 py-4 text-left text-sm font-medium border-b ${isDarkMode ? 'text-gray-300 border-gray-600' : 'text-gray-700 border-gray-200'
                        }`}>Message</th>
                      <th className={`px-4 py-4 text-left text-sm font-medium border-b ${isDarkMode ? 'text-gray-300 border-gray-600' : 'text-gray-700 border-gray-200'
                        }`}>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className={`px-6 py-8 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                          No logs found
                        </td>
                      </tr>
                    ) : (
                      logs.map((log) => (
                        <tr key={log.log_id} className={`border-b ${isDarkMode ? 'border-gray-700 hover:bg-gray-750' : 'border-gray-200 hover:bg-gray-50'
                          }`}>
                          <td className={`px-4 py-4 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                            {formatDateTime(log.created_at)}
                          </td>
                          <td className="px-4 py-4 text-sm">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${levelColors[log.level]}`}>
                              {log.level.toUpperCase()}
                            </span>
                          </td>
                          <td className={`px-4 py-4 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>
                            {formatAction(log.action)}
                          </td>
                          <td className={`px-4 py-4 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>
                            {log.user ? log.user.username : 'System'}
                          </td>
                          <td className={`px-4 py-4 text-sm max-w-md truncate ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>
                            {log.message}
                          </td>
                          <td className={`px-4 py-4 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                            {log.ip_address || '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className={`p-4 border-t ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
                  }`}>
                  <div className="flex flex-col sm:flex-row items-center sm:justify-between gap-3">
                    <div className={`text-sm text-center sm:text-left ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                      Page {currentPage} of {totalPages}
                    </div>
                    <div className="flex gap-2 flex-wrap justify-center">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className={`px-3 py-1 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                          ? 'bg-gray-700 text-white hover:bg-gray-600'
                          : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                          }`}
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className={`px-3 py-1 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                          ? 'bg-gray-700 text-white hover:bg-gray-600'
                          : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                          }`}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Logs;
