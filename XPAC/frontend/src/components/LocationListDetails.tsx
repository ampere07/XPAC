import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Edit, Trash2 
} from 'lucide-react';
import RelatedDataTable from './RelatedDataTable';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface LocationItem {
  id: number;
  name: string;
  type: 'city' | 'region' | 'borough' | 'location';
  parentId?: number;
  parentName?: string;
  cityId?: number;
  regionId?: number;
  boroughId?: number;
  modifiedBy?: string;
  modifiedAt?: string;
}

interface LocationListDetailsProps {
  location: LocationItem;
  onClose: () => void;
  onEdit: (location: LocationItem) => void;
  onDelete: (location: LocationItem) => void;
  /** Whether the viewer may use each control. The Location List decides. */
  canEdit?: boolean;
  canDelete?: boolean;
  isMobile?: boolean;
}

const LocationListDetails: React.FC<LocationListDetailsProps> = ({ 
  location, 
  onClose, 
  onEdit, 
  onDelete,
  canEdit = true,
  canDelete = true,
  isMobile = false 
}) => {
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  // Related data state
  const [relatedApplications, setRelatedApplications] = useState<any[]>([]);
  const [relatedJobOrders, setRelatedJobOrders] = useState<any[]>([]);
  const [relatedCustomers, setRelatedCustomers] = useState<any[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  // Pagination state
  const [pages, setPages] = useState<Record<string, number>>({});

  const handlePageChange = (sectionKey: string, newPage: number) => {
    setPages(prev => ({ ...prev, [sectionKey]: newPage }));
  };

  const defaultFields = [
    'name',
    'type',
    'parent',
    'id',
    'modifiedBy',
    'modifiedAt'
  ];

  const fieldOrder: string[] = defaultFields;

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
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const diff = startXRef.current - e.clientX;
      const newWidth = Math.max(400, Math.min(1200, startWidthRef.current + diff));

      setDetailsWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Fetch related data
  useEffect(() => {
    const fetchRelatedData = async () => {
      if (!location.id) return;
      try {
        setLoadingRelated(true);
        // We'll use the same API endpoint structure if it exists, but usually locations might have different endpoints.
        // For now, let's try a generic related data endpoint for locations.
        const response = await apiClient.get<{ success: boolean; data: any }>(`/locations/${location.type}/${location.id}/related`);
        if (response.data?.success) {
          setRelatedApplications(response.data.data?.applications || []);
          setRelatedJobOrders(response.data.data?.job_orders || []);
          setRelatedCustomers(response.data.data?.customers || []);
        }
      } catch (err) {
        console.error('Error fetching location related data:', err);
        // Fallback to empty if not implemented yet
        setRelatedApplications([]);
        setRelatedJobOrders([]);
        setRelatedCustomers([]);
      } finally {
        setLoadingRelated(false);
      }
    };

    fetchRelatedData();
  }, [location.id, location.type]);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = detailsWidth;
  };

  const getLocationTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      city: 'City',
      region: 'Region',
      borough: 'Barangay',
      location: 'Location'
    };
    return labels[type] || type;
  };

  const getParentTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      city: 'Region', 
      borough: 'City', 
      location: 'Barangay'
    };
    return labels[type] || 'Parent';
  };

  const getFieldLabel = (fieldKey: string): string => {
    const labels: Record<string, string> = {
      name: 'Location Name',
      type: 'Location Type',
      parent: getParentTypeLabel(location.type),
      id: 'ID',
      modifiedBy: 'Modified By',
      modifiedAt: 'Modified At'
    };
    return labels[fieldKey] || fieldKey;
  };

  const renderFieldContent = (fieldKey: string) => {
    let label = getFieldLabel(fieldKey);
    let value: any = '-';

    switch (fieldKey) {
      case 'name':
        value = location.name;
        break;
      case 'type':
        value = getLocationTypeLabel(location.type);
        break;
      case 'parent':
        if (!location.parentName) return null;
        value = location.parentName;
        break;
      case 'id':
        value = location.id;
        break;
      case 'modifiedBy':
        value = location.modifiedBy || '-';
        break;
      case 'modifiedAt':
        value = location.modifiedAt ? new Date(location.modifiedAt).toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        }).replace(',', '') : '-';
        break;
      default:
        return null;
    }

    return (
      <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className={`w-40 text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {label}:
        </div>
        <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{value}</div>
      </div>
    );
  };

  const renderRelatedSection = (
    title: string,
    sectionKey: string,
    data: any[],
    columns: any[]
  ) => {
    const currentPage = pages[sectionKey] || 1;
    const ITEMS_PER_PAGE = 5;
    const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE);
    const paginatedData = data.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

    return (
      <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className={`w-full px-6 py-4 flex items-center justify-between`}>
          <div className="flex items-center space-x-2">
            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              {title}
            </span>
            <span 
              className={`text-xs px-2 py-1 rounded`}
              style={{
                backgroundColor: isDarkMode ? (colorPalette?.primary ? `${colorPalette.primary}33` : '#374151') : (colorPalette?.primary ? `${colorPalette.primary}22` : '#e5e7eb'),
                color: colorPalette?.primary || (isDarkMode ? '#fff' : '#111827')
              }}
            >
              {loadingRelated ? '...' : data.length}
            </span>
          </div>
        </div>

        <div className="px-6 pb-4">
          {loadingRelated ? (
            <div 
              className={`text-center py-4 text-sm animate-pulse`}
              style={{ color: colorPalette?.primary || '#f97316' }}
            >
              Loading...
            </div>
          ) : data.length > 0 ? (
            <div className="flex flex-col">
              <div className="overflow-x-auto">
                <RelatedDataTable
                  data={paginatedData}
                  columns={columns}
                  isDarkMode={isDarkMode}
                />
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-end py-3 mt-2">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handlePageChange(sectionKey, currentPage - 1)}
                      disabled={currentPage === 1}
                      className={`px-3 py-1 rounded text-sm font-medium disabled:opacity-50 transition-colors ${
                        isDarkMode 
                          ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:hover:bg-gray-800' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:hover:bg-gray-200'
                      }`}
                    >
                      Back
                    </button>
                    <div className={`px-3 py-1 flex items-center text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Page {currentPage} of {totalPages}
                    </div>
                    <button
                      onClick={() => handlePageChange(sectionKey, currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className={`px-3 py-1 rounded text-sm font-medium disabled:opacity-50 transition-colors ${
                        isDarkMode 
                          ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:hover:bg-gray-800' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:hover:bg-gray-200'
                      }`}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className={`text-center py-4 text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              No items found
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`h-full flex flex-col overflow-hidden ${!isMobile ? 'md:border-l' : ''} relative w-full md:w-auto ${
        isDarkMode ? 'bg-gray-950 border-white border-opacity-30' : 'bg-gray-50 border-gray-300'
      }`}
      style={!isMobile && window.innerWidth >= 768 ? { width: `${detailsWidth}px` } : undefined}
    >
      {!isMobile && (
        <div
          className={`hidden md:block absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50 ${
            isDarkMode ? 'hover:bg-orange-500' : 'hover:bg-orange-600'
          }`}
          onMouseDown={handleMouseDownResize}
        />
      )}

      {/* Header */}
      <div className={`p-3 flex items-center justify-between border-b ${
        isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center">
          <h2 className={isDarkMode ? 'text-white font-medium' : 'text-gray-900 font-medium'}>{location.name}</h2>
        </div>

        <div className="flex items-center space-x-3">
          {canDelete && (
          <button
            onClick={() => onDelete(location)}
            className={`p-1.5 rounded hover:bg-red-500/10 text-red-500 transition-colors`}
            title="Delete"
          >
            <Trash2 size={18} />
          </button>
          )}
          
          {canEdit && (
          <button
            onClick={() => onEdit(location)}
            className="p-1.5 rounded text-white flex items-center space-x-1 transition-colors"
            style={{ backgroundColor: colorPalette?.primary || '#dc2626' }}
          >
            <Edit size={16} />
            <span className="text-sm">Edit</span>
          </button>
          )}

          <button
            onClick={onClose}
            className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto w-full h-full relative">
        <div className={`max-w-2xl mx-auto py-6 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
          <div className="space-y-4">
            {fieldOrder.map((fieldKey) => (
              <React.Fragment key={fieldKey}>
                {renderFieldContent(fieldKey)}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className={`border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className={`px-4 py-3 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
            <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Related References
            </h3>
          </div>

          {renderRelatedSection(
            'Related Applications',
            'applications',
            relatedApplications,
            [
              { 
                key: 'customer_name', 
                label: 'Customer', 
                render: (_: any, row: any) => {
                  const parts = [row.first_name, row.middle_initial, row.last_name].filter(Boolean);
                  return parts.length > 0 ? parts.join(' ') : (row.customer_name || '-');
                } 
              },
              { key: 'status', label: 'Status', render: (val: any) => val || '-' },
              { key: 'created_at', label: 'Date', render: (val: any) => val ? val.split('T')[0] : '-' }
            ]
          )}

          {renderRelatedSection(
            'Related Job Orders',
            'jobOrders',
            relatedJobOrders,
            [
              { 
                key: 'customer_name', 
                label: 'Customer', 
                render: (_: any, row: any) => {
                  const app = row.application;
                  if (app) {
                    const parts = [app.first_name, app.middle_initial, app.last_name].filter(Boolean);
                    return parts.length > 0 ? parts.join(' ') : '-';
                  }
                  return row.customer_name || '-';
                } 
              },
              { key: 'status', label: 'Status', render: (val: any) => val || '-' },
              { key: 'timestamp', label: 'Date', render: (val: any) => val ? val.split('T')[0] : '-' }
            ]
          )}
          
          {renderRelatedSection(
            'Subscribed Customers',
            'customers',
            relatedCustomers,
            [
              { 
                key: 'full_name', 
                label: 'Full Name', 
                render: (val: any, row: any) => {
                  if (val) return val;
                  const parts = [row.first_name, row.middle_initial, row.last_name].filter(Boolean);
                  return parts.length > 0 ? parts.join(' ') : '-';
                }
              },
              { key: 'email_address', label: 'Email', render: (val: any) => val || '-' }
            ]
          )}
        </div>
      </div>
    </div>
  );
};

export default LocationListDetails;
