import React, { useState, useEffect } from 'react';
import { Filter, Plus, ChevronRight, X, Search } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface SMSBlastLog {
  id: string;
  messageId: string;
  recipientNumber: string;
  status: string;
  sentDate: string;
  deliveryDate?: string;
  failureReason?: string;
  provider: string;
  messageType: string;
  cost?: number;
  barangay?: string;
  city?: string;
  organization_id?: number;
}

const SMSBlastLogs: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [logs, setLogs] = useState<SMSBlastLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<SMSBlastLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<SMSBlastLog | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedProvider, setSelectedProvider] = useState<string>('All');
  const [selectedMessageType, setSelectedMessageType] = useState<string>('All');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const statusFilters = ['All', 'Delivered', 'Failed', 'Pending', 'Sent'];
  const providerFilters = ['All', 'Globe', 'Smart', 'DITO'];
  const messageTypeFilters = ['All', 'Customer Advisory', 'Maintenance Advisory', 'Network Advisory', 'Service Advisory'];

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
    const observer = new MutationObserver(() => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme !== 'light');
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    const theme = localStorage.getItem('theme');
    setIsDarkMode(theme !== 'light');

    return () => observer.disconnect();
  }, []);

  // Fetch SMS blast logs data
  useEffect(() => {
    const fetchSMSBlastLogs = async () => {
      try {
        setIsLoading(true);

        // This would be an API call in a real implementation
        // For now, we'll return an empty array to show "No items"
        setTimeout(() => {
          const mockData: SMSBlastLog[] = [];

          setLogs(mockData);
          setFilteredLogs(mockData);
          setIsLoading(false);
        }, 1000);
      } catch (err) {
        console.error('Failed to fetch SMS Blast logs:', err);
        setError('Failed to load SMS Blast logs. Please try again.');
        setLogs([]);
        setFilteredLogs([]);
        setIsLoading(false);
      }
    };

    fetchSMSBlastLogs();
  }, []);

  // Filter logs when filter criteria or search query changes
  useEffect(() => {
    if (logs.length === 0) return;

    const authData = JSON.parse(localStorage.getItem('authData') || '{}');
    const userOrgId = authData.organization_id;

    let filtered = logs.filter(log => {
      // Organization filter
      if (userOrgId && log.organization_id && log.organization_id !== userOrgId) {
        return false;
      }
      return true;
    });

    // Filter by status
    if (selectedStatus !== 'All') {
      filtered = filtered.filter(log => log.status === selectedStatus);
    }

    // Filter by provider
    if (selectedProvider !== 'All') {
      filtered = filtered.filter(log => log.provider === selectedProvider);
    }

    // Filter by message type
    if (selectedMessageType !== 'All') {
      filtered = filtered.filter(log => log.messageType === selectedMessageType);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(log =>
        log.recipientNumber.toLowerCase().includes(query) ||
        log.messageId.toLowerCase().includes(query) ||
        (log.failureReason && log.failureReason.toLowerCase().includes(query))
      );
    }

    setFilteredLogs(filtered);
  }, [logs, selectedStatus, selectedProvider, selectedMessageType, searchQuery]);

  const handleStatusFilter = (status: string) => {
    setSelectedStatus(status);
  };

  const handleProviderFilter = (provider: string) => {
    setSelectedProvider(provider);
  };

  const handleMessageTypeFilter = (type: string) => {
    setSelectedMessageType(type);
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleExport = () => {
    alert('Export logs clicked');
  };

  const handleLogClick = (log: SMSBlastLog) => {
    setSelectedLog(log);
  };

  const handleCloseDetails = () => {
    setSelectedLog(null);
  };

  return (
    <div className={`${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      } h-full flex overflow-hidden`}>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`p-4 border-b flex justify-between items-center ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`}>
          <h1 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>
            SMS Blast Logs
          </h1>
          <div className="flex items-center space-x-2">

          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                Loading SMS Blast logs...
              </div>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-red-500">{error}</div>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>No items</div>
            </div>
          ) : (
            <div className="h-full overflow-auto">
              <table className={`min-w-full divide-y ${isDarkMode ? 'divide-gray-700' : 'divide-gray-300'
                }`}>
                <thead className={isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}>
                  <tr>
                    <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                      message id
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      recipient
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      sent date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      provider
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      message type
                    </th>
                    <th scope="col" className="relative px-6 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? 'bg-gray-900 divide-gray-800' : 'bg-white divide-gray-200'
                  }`}>
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className={`cursor-pointer ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                      }`} onClick={() => handleLogClick(log)}>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                        }`}>
                        {log.messageId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {log.recipientNumber}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.status === 'Delivered' ? 'bg-green-900 text-green-200' :
                          log.status === 'Failed' ? 'bg-red-900 text-red-200' :
                            log.status === 'Pending' ? 'bg-yellow-900 text-yellow-200' :
                              'bg-blue-900 text-blue-200'
                          }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {log.sentDate}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {log.provider}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {log.messageType}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <ChevronRight className={`h-5 w-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Details panel that slides in from the right when a log is selected */}
      {selectedLog && (
        <div className={`w-full max-w-md border-l flex-shrink-0 relative ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`}>
          <div className="absolute top-4 right-4 z-10">
            <button
              onClick={handleCloseDetails}
              className={`transition-colors rounded p-1 ${isDarkMode
                ? 'text-gray-400 hover:text-white bg-gray-800'
                : 'text-gray-600 hover:text-gray-900 bg-gray-200'
                }`}
            >
              <X size={20} />
            </button>
          </div>
          <div className="p-6 h-full overflow-y-auto">
            <h2 className={`text-xl font-semibold mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              SMS Log Details
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className={`text-sm uppercase mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Message ID</h3>
                <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                  {selectedLog.messageId}
                </p>
              </div>

              <div>
                <h3 className="text-sm text-gray-400 uppercase mb-1">Recipient</h3>
                <p className="text-white">{selectedLog.recipientNumber}</p>
              </div>

              <div>
                <h3 className="text-sm text-gray-400 uppercase mb-1">Status</h3>
                <p className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${selectedLog.status === 'Delivered' ? 'bg-green-900 text-green-200' :
                  selectedLog.status === 'Failed' ? 'bg-red-900 text-red-200' :
                    selectedLog.status === 'Pending' ? 'bg-yellow-900 text-yellow-200' :
                      'bg-blue-900 text-blue-200'
                  }`}>
                  {selectedLog.status}
                </p>
              </div>

              <div>
                <h3 className="text-sm text-gray-400 uppercase mb-1">Sent Date</h3>
                <p className="text-white">{selectedLog.sentDate}</p>
              </div>

              {selectedLog.deliveryDate && (
                <div>
                  <h3 className="text-sm text-gray-400 uppercase mb-1">Delivery Date</h3>
                  <p className="text-white">{selectedLog.deliveryDate}</p>
                </div>
              )}

              <div>
                <h3 className="text-sm text-gray-400 uppercase mb-1">Provider</h3>
                <p className="text-white">{selectedLog.provider}</p>
              </div>

              <div>
                <h3 className="text-sm text-gray-400 uppercase mb-1">Message Type</h3>
                <p className="text-white">{selectedLog.messageType}</p>
              </div>

              {selectedLog.failureReason && (
                <div>
                  <h3 className="text-sm text-gray-400 uppercase mb-1">Failure Reason</h3>
                  <p className="text-white">{selectedLog.failureReason}</p>
                </div>
              )}

              {selectedLog.cost !== undefined && (
                <div>
                  <h3 className="text-sm text-gray-400 uppercase mb-1">Cost</h3>
                  <p className="text-white">₱{selectedLog.cost.toFixed(2)}</p>
                </div>
              )}

              {selectedLog.barangay && (
                <div>
                  <h3 className="text-sm text-gray-400 uppercase mb-1">Barangay</h3>
                  <p className="text-white">{selectedLog.barangay}</p>
                </div>
              )}

              {selectedLog.city && (
                <div>
                  <h3 className="text-sm text-gray-400 uppercase mb-1">City</h3>
                  <p className="text-white">{selectedLog.city}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SMSBlastLogs;