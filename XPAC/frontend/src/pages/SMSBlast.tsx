import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Search } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import SMSBlastDetails from '../components/SMSBlastDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AddSMSBlastModal from '../modals/AddSMSBlastModal';

interface SMSBlastRecord {
  id: string;
  target_name: string;
  target_type: string;
  barangay: string;
  city: string;
  message: string;
  billing_day: number | null;
  message_count: number | null;
  credit_used: string | null;
  modifiedDate: string;
  modifiedEmail: string;
  userEmail: string;
  organization_id?: number | null;
}

const SMSBlast: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  const [smsBlastRecords, setSmsBlastRecords] = useState<SMSBlastRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<SMSBlastRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSMSBlast, setSelectedSMSBlast] = useState<SMSBlastRecord | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [currentUserOrgId] = useState<number | null>(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
    } catch {
      return null;
    }
  });

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

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // API Base URL
  const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

  // Fetch SMS blast data
  const fetchSMSBlastData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/sms-blast`);
      const result = await response.json();

      if (result.status === 'success') {
        setSmsBlastRecords(result.data);
      } else {
        throw new Error(result.message || 'Failed to fetch records');
      }
    } catch (err: any) {
      console.error('Failed to fetch SMS Blast records:', err);
      setError(err.message || 'Failed to load SMS Blast records. Please try again.');
      setSmsBlastRecords([]);
    } finally {
      setIsLoading(false);
    }
  }, [API_BASE_URL]);

  useEffect(() => {
    fetchSMSBlastData();
  }, [fetchSMSBlastData]);

  useEffect(() => {
    let filtered = [...smsBlastRecords];

    // Organization filter — only show records matching the current user's org
    filtered = filtered.filter(record => {
      if (currentUserOrgId) {
        // User belongs to an org: only show records assigned to that same org
        return record.organization_id === currentUserOrgId;
      } else {
        // User has no org: only show records that have no org assigned
        const recordOrg = record.organization_id === undefined ? null : record.organization_id;
        return recordOrg === null;
      }
    });

    // Filter by search query
    if (searchQuery) {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      filtered = filtered.filter(record => {
        const checkValue = (val: any): boolean => {
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
        };

        return (
          checkValue(record.message) ||
          checkValue(record.modifiedEmail) ||
          checkValue(record.userEmail) ||
          checkValue(record.barangay) ||
          checkValue(record.city)
        );
      });
    }

    setFilteredRecords(filtered);
  }, [smsBlastRecords, searchQuery, currentUserOrgId]);

  const handleAddNew = () => {
    setIsAddModalOpen(true);
  };

  const handleRecordClick = (record: SMSBlastRecord) => {
    setSelectedSMSBlast(record);
  };

  const handleCloseDetails = () => {
    setSelectedSMSBlast(null);
  };

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`p-4 border-b flex justify-between items-center gap-3 overflow-x-auto scrollbar-none pb-1 -mb-1 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
          <h1 className={`text-xl font-semibold flex-shrink-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            SMS Blast
          </h1>
          <div className="flex items-center flex-1 max-w-md mx-4 flex-shrink-0">
            <GlobalSearch 
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search SMS logs..."
            />
          </div>
          <div className="flex items-center space-x-2 flex-shrink-0">
            <button
              onClick={handleAddNew}
              className="flex items-center space-x-1 text-white px-4 py-2 rounded transition-colors flex-shrink-0"
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
              <Plus size={18} />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Main content - List Style (Inspired by Customer.tsx) */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                Loading SMS Blast records...
              </div>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-red-500">{error}</div>
            </div>
          ) : (
            <div className="h-full overflow-auto">
              {filteredRecords.length > 0 ? (
                <div className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-100'}`}>
                  {filteredRecords.map((record) => (
                    <div
                      key={record.id}
                      onClick={() => handleRecordClick(record)}
                      className={`px-6 py-4 cursor-pointer transition-colors border-b ${isDarkMode
                        ? 'hover:bg-gray-800 border-gray-800'
                        : 'hover:bg-gray-100 border-gray-100'
                        } ${selectedSMSBlast?.id === record.id ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-50') : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div
                            className="font-bold text-sm mb-1"
                            style={{ color: colorPalette?.primary || '#7c3aed' }}
                          >
                            {record.target_name && record.target_name !== 'N/A'
                              ? (record.target_type && record.target_type !== 'N/A'
                                ? `${record.target_name} | ${record.target_type}`
                                : record.target_name)
                              : (record.target_type && record.target_type !== 'N/A'
                                ? record.target_type
                                : 'General Blast')}
                          </div>
                          <div className={`text-sm line-clamp-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'
                            }`}>
                            {record.message}
                          </div>
                        </div>
                        <div className="flex flex-col items-end space-y-0.5 ml-4 flex-shrink-0">
                          <div
                            className="text-sm font-bold"
                            style={{ color: colorPalette?.primary || '#7c3aed' }}
                          >
                            {record.message_count || 0} Sent
                          </div>
                          <div className={`text-[11px] font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            {record.modifiedDate}
                          </div>
                          <div className={`text-[10px] uppercase tracking-wider ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                            Modified by: {record.modifiedEmail}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col justify-center items-center h-full min-h-[400px]">
                  <div className={`mb-4 p-4 rounded-full ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
                    <Search size={48} className={isDarkMode ? 'text-gray-700' : 'text-gray-300'} />
                  </div>
                  <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    No SMS Blast records found
                  </p>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    Try adjusting your filters or search query
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Details panel that slides in from the right */}
      {selectedSMSBlast && (
        <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:flex-shrink-0 md:overflow-hidden">
          <SMSBlastDetails
            smsBlastRecord={selectedSMSBlast}
            onClose={handleCloseDetails}
            isMobile={isMobile}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
          />
        </div>
      )}

      <AddSMSBlastModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={fetchSMSBlastData}
      />
    </div>
  );
};

export default SMSBlast;