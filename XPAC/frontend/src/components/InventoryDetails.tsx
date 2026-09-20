import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, Trash2, X, FileText, Copy, Printer, ChevronLeft, ChevronRight as ChevronRightNav, Maximize2, AlertTriangle, Wrench, Edit, Settings, ExternalLink } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { relatedDataService } from '../services/relatedDataService';
import RelatedDataTable from './RelatedDataTable';
import { relatedDataColumns } from '../config/relatedDataColumns';
import InventoryLogsFormModal from '../modals/InventoryLogsFormModal';
import { InventoryItem as FullInventoryItem } from '../services/inventoryItemService';


interface InventoryItem {
  item_name: string;
  item_description?: string;
  supplier?: string;
  quantity_alert?: number;
  image?: string;
  category?: string;
  item_id?: number;
  modified_by?: string;
  modified_date?: string;
  user_email?: string;
  created_at?: string;
  updated_at?: string;
  organization_id?: number | null;
}

interface InventoryLog {
  id: string;
  date: string;
  item_quantity: number;
  requested_by: string;
  requested_with: string;
  status?: string;
  account_no?: string;
  remarks?: string;
  log_type?: string;
}


interface JobOrder {
  id: string;
  jobOrderNumber: string;
  date: string;
  assignedTo: string;
  quantity: number;
  status: string;
}

interface ServiceOrder {
  id: string;
  serviceOrderNumber: string;
  date: string;
  technician: string;
  quantity: number;
  status: string;
}

interface DefectiveLog {
  id: string;
  date: string;
  reportedBy: string;
  quantity: number;
  defectType: string;
  description: string;
}

interface InventoryDetailsProps {
  item: InventoryItem;
  inventoryLogs?: InventoryLog[];
  jobOrders?: JobOrder[];
  serviceOrders?: ServiceOrder[];
  defectiveLogs?: DefectiveLog[];
  totalStockIn?: number;
  totalStockAvailable?: number;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (item: InventoryItem) => void;
  onClose?: () => void;
  onRefresh?: () => void;
}

const InventoryDetails: React.FC<InventoryDetailsProps> = ({
  item,
  inventoryLogs = [
    {
      id: '1',
      date: '2023-11-27T14:07:58',
      item_quantity: 4,
      requested_by: 'None',
      requested_with: 'None',
      status: 'STOCK-IN',
      log_type: 'Stock In'
    }
  ],
  jobOrders = [],
  serviceOrders = [],
  defectiveLogs = [],
  totalStockIn = 4,
  totalStockAvailable = 4,
  onEdit,
  onDelete,
  onClose,
  onRefresh
}) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    inventoryLogs: true,
    jobOrders: true,
    serviceOrders: true,
    defectiveLogs: true
  });
  const [expandedModalSection, setExpandedModalSection] = useState<string | null>(null);
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [showColumnVisibility, setShowColumnVisibility] = useState(false);

  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);


  // Related data counts
  const [inventoryLogsCount, setInventoryLogsCount] = useState(inventoryLogs.length);
  const [jobOrdersCount, setJobOrdersCount] = useState(jobOrders.length);
  const [serviceOrdersCount, setServiceOrdersCount] = useState(serviceOrders.length);
  const [defectiveLogsCount, setDefectiveLogsCount] = useState(defectiveLogs.length);

  // Related data
  const [inventoryLogsData, setInventoryLogsData] = useState<any[]>(inventoryLogs);
  const [jobOrdersData, setJobOrdersData] = useState<any[]>(jobOrders);
  const [serviceOrdersData, setServiceOrdersData] = useState<any[]>(serviceOrders);
  const [defectiveLogsData, setDefectiveLogsData] = useState<any[]>(defectiveLogs);

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

  // Fetch related data when item_id changes
  const fetchRelatedData = useCallback(async () => {
    if (!item.item_id) {
      return;
    }

    const itemId = item.item_id;

    // Fetch all related data
    const fetchPromises = [
      { key: 'inventoryLogs', fn: relatedDataService.getRelatedInventoryLogs, setState: setInventoryLogsData, setCount: setInventoryLogsCount },
      { key: 'defectiveLogs', fn: relatedDataService.getRelatedDefectiveLogs, setState: setDefectiveLogsData, setCount: setDefectiveLogsCount },
      { key: 'jobOrders', fn: relatedDataService.getRelatedJobOrdersByItem, setState: setJobOrdersData, setCount: setJobOrdersCount },
      { key: 'serviceOrders', fn: relatedDataService.getRelatedServiceOrdersByItem, setState: setServiceOrdersData, setCount: setServiceOrdersCount }
    ];

    for (const { key, fn, setState, setCount } of fetchPromises) {
      try {
        const result = await fn(itemId);
        setState(result.data || []);
        setCount(result.count || 0);
      } catch (error) {
        console.error(`❌ Error fetching ${key}:`, error);
        setState([]);
        setCount(0);
      }
    }
  }, [item.item_id]);

  useEffect(() => {
    fetchRelatedData();
  }, [fetchRelatedData]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const diff = startXRef.current - e.clientX;
      const newWidth = Math.max(600, Math.min(1200, startWidthRef.current + diff));

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

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = detailsWidth;
  };

  const toggleSection = (section: string) => {
    // Keep it always open
    setExpandedSections(prev => ({
      ...prev,
      [section]: true
    }));
  };

  const handleExpandModalOpen = (section: string) => {
    setExpandedModalSection(section);
  };

  const handleExpandModalClose = () => {
    setExpandedModalSection(null);
  };

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      let hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const hh = String(hours).padStart(2, '0');
      return `${mm}/${dd}/${yyyy} ${hh}:${minutes} ${ampm}`;
    } catch (e) {
      return dateString;
    }
  };

  const getDriveDirectUrl = (url: string | undefined) => {
    if (!url) return '';

    // Check for Google Drive URLs
    if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
      let fileId = '';

      // Try to match /d/ID pattern
      const matchD = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (matchD && matchD[1]) {
        fileId = matchD[1];
      }

      // If not found, try id=ID pattern
      if (!fileId) {
        const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (matchId && matchId[1]) {
          fileId = matchId[1];
        }
      }

      if (fileId) {
        // Use thumbnail endpoint which is more reliable for images
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
      }
    }

    return url;
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(item);
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      if (window.confirm(`Are you sure you want to delete "${item.item_name}"?`)) {
        onDelete(item);
      }
    }
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    }
  };

  const renderField = (label: string, value: any) => (
    <div className="flex justify-between items-center py-2">
      <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{label}</span>
      <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{value || '-'}</span>
    </div>
  );

  return (
    <div className={`h-full flex flex-col border-l relative ${isDarkMode
      ? 'bg-gray-900 text-white border-white border-opacity-30'
      : 'bg-white text-gray-900 border-gray-300'
      }`} style={{ width: `${detailsWidth}px` }}>

      {/* Expanded Modal for Related Data */}
      {expandedModalSection && (
        <div className="absolute inset-0 flex flex-col" style={{ backgroundColor: isDarkMode ? '#111827' : '#ffffff', zIndex: 9999 }}>
          {/* Modal Header */}
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
            }`}>
            <div className="flex items-center space-x-3">
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                {expandedModalSection === 'inventoryLogs' && 'All Related Inventory Logs'}
                {expandedModalSection === 'jobOrders' && 'All Related Job Orders'}
                {expandedModalSection === 'serviceOrders' && 'All Related Service Orders'}
                {expandedModalSection === 'defectiveLogs' && 'All Related Defective Logs'}
              </h2>
              <span className={`text-xs px-2 py-1 rounded ${isDarkMode
                ? 'bg-gray-600 text-white'
                : 'bg-gray-300 text-gray-900'
                }`}>
                {expandedModalSection === 'inventoryLogs' && inventoryLogsCount}
                {expandedModalSection === 'jobOrders' && jobOrdersCount}
                {expandedModalSection === 'serviceOrders' && serviceOrdersCount}
                {expandedModalSection === 'defectiveLogs' && defectiveLogsCount} items
              </span>
            </div>
            <button
              onClick={handleExpandModalClose}
              className={`p-2 rounded transition-colors ${isDarkMode
                ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                }`}
            >
              <X size={20} />
            </button>
          </div>
          {/* Modal Content */}
          <div className="flex-1 overflow-auto p-6">
            <RelatedDataTable
              data={
                expandedModalSection === 'inventoryLogs' ? inventoryLogsData :
                    expandedModalSection === 'jobOrders' ? jobOrdersData :
                      expandedModalSection === 'serviceOrders' ? serviceOrdersData :
                        defectiveLogsData
              }
              columns={
                expandedModalSection === 'inventoryLogs' ? relatedDataColumns.inventoryLogs :
                    expandedModalSection === 'jobOrders' ? relatedDataColumns.jobOrders :
                      expandedModalSection === 'serviceOrders' ? relatedDataColumns.serviceOrders :
                        relatedDataColumns.defectiveLogs
              }
              isDarkMode={isDarkMode}
            />
          </div>
        </div>
      )}

      {/* Resizer */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50"
        style={{
          backgroundColor: isResizing ? (colorPalette?.primary || '#7c3aed') : 'transparent'
        }}
        onMouseEnter={(e) => {
          if (!isResizing) {
            e.currentTarget.style.backgroundColor = colorPalette?.accent || '#7c3aed';
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizing) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
        onMouseDown={handleMouseDownResize}
      />

      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between border-b ${isDarkMode
        ? 'bg-gray-800 border-gray-700'
        : 'bg-gray-100 border-gray-200'
        }`}>
        <h1 className={`text-lg font-semibold truncate pr-4 min-w-0 flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>
          {item.category || 'EVENT'} | {item.item_name} | ID: {item.item_id}
        </h1>
        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            onClick={handleEdit}
            className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
              }`}
          >
            <Edit size={18} />
          </button>
          <button
            onClick={() => setIsLogsModalOpen(true)}
            className="px-3 py-1 rounded text-sm transition-colors text-white"
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
            Stock In/Out
          </button>
          <div className="relative">
            <button
              onClick={() => setShowColumnVisibility(!showColumnVisibility)}
              className={`p-2 rounded transition-colors ${isDarkMode
                ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                }`}
              title="Settings"
            >
              <Settings size={18} />
            </button>
          </div>
          <button
            onClick={handleClose}
            className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
              }`}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {/* Item Image */}
        <div className={`h-64 flex items-center justify-center border-b overflow-hidden ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-gray-100 border-gray-200'
          }`}>
          {item.image ? (
            <img
              src={getDriveDirectUrl(item.image)}
              alt={item.item_name}
              className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
              onClick={() => window.open(item.image)}
            />
          ) : (
            <div className="text-center">
              <AlertTriangle size={48} className={isDarkMode ? 'text-gray-600' : 'text-gray-400'} />
            </div>
          )}
        </div>

        {/* Item Information */}
        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <h3 className={`font-semibold text-sm mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Item Details</h3>
            {renderField('Category', item.category)}
            {renderField('Item Name', item.item_name)}
            {renderField('Item ID', item.item_id)}
            {renderField('Quantity Alert', item.quantity_alert)}
            <div className="space-y-1 py-2">
              <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Item Description</span>
              <p className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{item.item_description || '-'}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className={`font-semibold text-sm mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Modification History</h3>
            {renderField('Modified By', item.modified_by)}
            {renderField('User Email', item.user_email)}
            {renderField('Created At', item.created_at ? formatDate(item.created_at) : '-')}
            {renderField('Last Modified', item.modified_date ? formatDate(item.modified_date) : '-')}
          </div>
        </div>

        {/* Related Sections */}
        <div className={`border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          {/* Related Inventory Logs */}
          <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className={`w-full px-6 py-4 flex items-center justify-between ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}>
              <div className="flex items-center space-x-2">
                <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Related Inventory Logs</span>
                <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>{inventoryLogsCount}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleExpandModalOpen('inventoryLogs'); }}
                  className={`text-sm transition-colors hover:underline ${isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-500'}`}
                >
                  Expand
                </button>
                <div className="flex items-center">
                  <ChevronDown size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
                </div>
              </div>
            </div>
            {expandedSections.inventoryLogs && (
              <div className="px-6 pb-4">
                <RelatedDataTable
                  data={inventoryLogsData.slice(0, 5)}
                  columns={relatedDataColumns.inventoryLogs}
                  isDarkMode={isDarkMode}
                />
                <div className="flex justify-end mt-2">
                  <button onClick={() => setIsLogsModalOpen(true)} className={isDarkMode ? 'text-red-400 hover:text-red-300 text-sm' : 'text-red-600 hover:text-red-700 text-sm'}>Add</button>
                </div>
              </div>
            )}
          </div>


          {/* Related Job Orders */}
          <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className={`w-full px-6 py-4 flex items-center justify-between ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}>
              <div className="flex items-center space-x-2">
                <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Related Job Orders</span>
                <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>{jobOrdersCount}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleExpandModalOpen('jobOrders'); }}
                  className={`text-sm transition-colors hover:underline ${isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-500'}`}
                >
                  Expand
                </button>
                <div className="flex items-center">
                  <ChevronDown size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
                </div>
              </div>
            </div>
            {expandedSections.jobOrders && (
              <div className="px-6 pb-4">
                <RelatedDataTable
                  data={jobOrdersData.slice(0, 5)}
                  columns={relatedDataColumns.jobOrders}
                  isDarkMode={isDarkMode}
                />
              </div>
            )}
          </div>

          {/* Related Service Orders */}
          <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className={`w-full px-6 py-4 flex items-center justify-between ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}>
              <div className="flex items-center space-x-2">
                <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Related Service Orders</span>
                <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>{serviceOrdersCount}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleExpandModalOpen('serviceOrders'); }}
                  className={`text-sm transition-colors hover:underline ${isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-500'}`}
                >
                  Expand
                </button>
                <div className="flex items-center">
                  <ChevronDown size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
                </div>
              </div>
            </div>
            {expandedSections.serviceOrders && (
              <div className="px-6 pb-4">
                <RelatedDataTable
                  data={serviceOrdersData.slice(0, 5)}
                  columns={relatedDataColumns.serviceOrders}
                  isDarkMode={isDarkMode}
                />
              </div>
            )}
          </div>

          {/* Related Defective Logs */}
          <div className={`${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
            <div className={`w-full px-6 py-4 flex items-center justify-between ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}>
              <div className="flex items-center space-x-2">
                <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Related Defective Logs</span>
                <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>{defectiveLogsCount}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleExpandModalOpen('defectiveLogs'); }}
                  className={`text-sm transition-colors hover:underline ${isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-500'}`}
                >
                  Expand
                </button>
                <div className="flex items-center">
                  <ChevronDown size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
                </div>
              </div>
            </div>
            {expandedSections.defectiveLogs && (
              <div className="px-6 pb-4">
                <RelatedDataTable
                  data={defectiveLogsData.slice(0, 5)}
                  columns={relatedDataColumns.defectiveLogs}
                  isDarkMode={isDarkMode}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <InventoryLogsFormModal
        isOpen={isLogsModalOpen}
        onClose={() => setIsLogsModalOpen(false)}
        selectedItem={{
          id: item.item_id || 0,
          item_name: item.item_name,
          item_description: item.item_description,
          image_url: item.image
        }}
        onSuccess={() => {
          fetchRelatedData();
          if (onRefresh) onRefresh();
        }}
      />
    </div>
  );
};

export default InventoryDetails;