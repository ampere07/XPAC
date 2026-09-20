import React, { useState, useEffect } from 'react';
import { fileLogService, FileLogEntry, FileLogPagination } from '../services/fileLogService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { Search, Filter, RefreshCw, FileText, AlertCircle } from 'lucide-react';

interface FileLogViewerProps {
  type: 'smartolt' | 'radius';
  title: string;
}

const FileLogViewer: React.FC<FileLogViewerProps> = ({ type, title }) => {
  const [logs, setLogs] = useState<FileLogEntry[]>([]);
  const [pagination, setPagination] = useState<FileLogPagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [meta, setMeta] = useState<any>(null);

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

  const loadLogs = async (page = 1) => {
    setLoading(true);
    try {
      const params = {
        page,
        per_page: 50,
        search: searchQuery || undefined,
      };

      const response = await fileLogService.getLogs(type, params);
      if (response.success) {
        setLogs(response.data);
        setPagination(response.pagination);
        setMeta(response.meta);
        setCurrentPage(response.pagination.current_page);
      }
    } catch (error) {
      console.error(`Failed to load ${type} logs:`, error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs(1);
  }, [type]);

  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      loadLogs(1);
    }, 500);

    return () => clearTimeout(delayedSearch);
  }, [searchQuery]);

  const handlePageChange = (newPage: number) => {
    loadLogs(newPage);
  };

  const levelColors: { [key: string]: string } = {
    info: 'text-blue-400 bg-blue-900/30',
    warning: 'text-yellow-400 bg-yellow-900/30',
    error: 'text-red-400 bg-red-900/30',
    debug: 'text-gray-400 bg-gray-700/30'
  };

  const getLevelColor = (level: string) => {
    const l = level.toLowerCase();
    if (l.includes('error')) return levelColors.error;
    if (l.includes('warning')) return levelColors.warning;
    if (l.includes('debug')) return levelColors.debug;
    return levelColors.info;
  };

  return (
    <div className={`p-6 ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className={`text-2xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            {title}
          </h2>
        </div>
        <div className="flex items-center space-x-3 w-full md:w-auto overflow-x-auto scrollbar-none pb-1 -mb-1">
          <div className="flex-1 min-w-[200px] md:w-72 flex-shrink-0">
            <GlobalSearch
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search log messages..."
            />
          </div>
          <button
            onClick={() => loadLogs(currentPage)}
            className={`flex items-center gap-2 px-4 py-2 rounded transition-colors text-sm font-medium flex-shrink-0 ${
              isDarkMode ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
            }`}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className={`rounded-lg overflow-hidden border shadow-lg ${
        isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-300'
      }`}>
        <div className="flex items-center px-4 py-2 border-b bg-opacity-50 select-none bg-gray-800 border-gray-700">
          <div className="flex gap-1.5 mr-4">
            <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
          </div>
          <span className="text-xs font-mono text-gray-400 uppercase tracking-widest">{title} Output</span>
        </div>

        <div className={`p-4 font-mono text-sm overflow-x-auto min-h-[400px] max-h-[65vh] select-text scrollbar-thin ${
          isDarkMode ? 'text-gray-300' : 'text-gray-800'
        }`} style={{ whiteSpace: 'pre-wrap' }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full py-20 text-gray-500">
              <RefreshCw className="h-8 w-8 animate-spin mb-3 opacity-30" />
              <div className="animate-pulse">Attaching to stream...</div>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20 text-gray-500">
              <div className="opacity-20 mb-2">&gt; No logs available</div>
              <div className="text-xs opacity-40">Ready for data...</div>
            </div>
          ) : (
            logs.map((entry, idx) => (
              <div key={idx} className="flex gap-4 py-0.5 leading-relaxed">
                <span className="text-gray-600 select-none w-8 text-right flex-shrink-0">{(pagination?.from || 0) + idx}</span>
                <div className="flex-1">
                  <span className="text-blue-500/70 mr-2">[{entry.datetime}]</span>
                  <span className={`${
                    entry.level.includes('error') ? 'text-red-400' : 
                    entry.level.includes('warning') ? 'text-yellow-400' : 
                    'text-green-400'
                  } font-bold mr-2 uppercase`}>
                    {entry.level}:
                  </span>
                  <span>{entry.message}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {pagination && pagination.last_page > 1 && (
          <div className={`px-6 py-3 flex flex-col sm:flex-row items-center sm:justify-between gap-3 border-t ${
            isDarkMode ? 'bg-gray-800/50 border-gray-800' : 'bg-gray-100 border-gray-300'
          }`}>
            <div className="text-xs font-mono text-gray-500 text-center sm:text-left">
              [ PAGE {pagination.current_page} OF {pagination.last_page} ] TOTAL: {pagination.total}
            </div>
            <div className="flex gap-4 flex-wrap justify-center">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1 || loading}
                className="text-xs font-mono text-blue-400 hover:text-blue-300 disabled:text-gray-600 transition-colors uppercase tracking-widest"
              >
                &lt;&lt; PREV
              </button>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === pagination.last_page || loading}
                className="text-xs font-mono text-blue-400 hover:text-blue-300 disabled:text-gray-600 transition-colors uppercase tracking-widest"
              >
                NEXT &gt;&gt;
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileLogViewer;
