import React, { useState, useEffect, useRef } from 'react';
import {
  X, ExternalLink, Edit, Settings, Loader
} from 'lucide-react';
import { WorkOrder, WorkOrderDetailsProps } from '../types/workOrder';
import { ColorPalette } from '../services/settingsColorPaletteService';
import AssignWorkOrderModal from '../modals/AssignWorkOrderModal';
import { enableWorkOrderForTechnician } from '../services/workOrderService';
import { isClosedForTechnicianQueue, isTechnicianEnabled } from '../utils/technicianWorkOrderAccess';

interface WorkOrderDetailsComponentProps extends WorkOrderDetailsProps {
  isDarkMode?: boolean;
  colorPalette?: ColorPalette | null;
}

const WorkOrderDetails: React.FC<WorkOrderDetailsComponentProps> = ({
  workOrder,
  onClose,
  onRefresh,
  isMobile = false,
  isDarkMode = true,
  colorPalette
}) => {
  const [localIsMobile, setLocalIsMobile] = useState<boolean>(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => {
      setLocalIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const activeIsMobile = isMobile || localIsMobile;

  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isEnablingTechnician, setIsEnablingTechnician] = useState(false);
  const [enableTechnicianError, setEnableTechnicianError] = useState<string | null>(null);
  const [enableTechnicianNotice, setEnableTechnicianNotice] = useState<string | null>(null);
  /**
   * Local echo of technician_enabled after a successful enable.
   *
   * The list refresh is what makes the change permanent everywhere; this only
   * keeps the button honest in the moment between the two. Cleared whenever a
   * different work order is opened so it can never leak across records.
   */
  const [technicianEnabledOverride, setTechnicianEnabledOverride] = useState<boolean | null>(null);

  const FIELD_VISIBILITY_KEY = 'workOrderDetailsFieldVisibility';
  const FIELD_ORDER_KEY = 'workOrderDetailsFieldOrder';

  const defaultFields = [
    'id',
    'workStatus',
    'workCategory',
    'instructions',
    'reportTo',
    'assignTo',
    'remarks',
    'requestedBy',
    'requestedDate',
    'updatedBy',
    'updatedDate',
    'image_1',
    'image_2',
    'image_3',
    'signature'
  ];

  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(FIELD_VISIBILITY_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
    return defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
  });

  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(FIELD_ORDER_KEY);
    return saved ? JSON.parse(saved) : defaultFields;
  });

  useEffect(() => {
    localStorage.setItem(FIELD_VISIBILITY_KEY, JSON.stringify(fieldVisibility));
  }, [fieldVisibility]);

  useEffect(() => {
    localStorage.setItem(FIELD_ORDER_KEY, JSON.stringify(fieldOrder));
  }, [fieldOrder]);

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        setUserRole(userData.role?.toLowerCase() || '');
        setRoleId(userData.role_id || null);
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    }
  }, []);

  // ── Technician queue release ────────────────────────────────────────────────
  // Technicians work their work orders In Progress first and oldest first within
  // that: everything else active is greyed out until either the work ahead of it
  // moves forward or an administrator releases one early. This is that release.

  const isAdminUser = (): boolean => {
    const lowerRole = (userRole || '').toLowerCase().trim();
    return lowerRole === 'administrator' || lowerRole === 'superadmin' || roleId === 1 || roleId === 7;
  };

  const technicianEnabled = technicianEnabledOverride ?? isTechnicianEnabled(workOrder);

  // Offered for administrators on any work order still in a technician's queue.
  // One the queue already skips is not blocking anything, so there is nothing to
  // release.
  // Offered for administrators on any record a technician still owes work on,
  // including one that is deferred — that is precisely the case where they cannot
  // pick it back up on their own. Only work that is finished, failed or cancelled
  // has nothing left to release.
  const shouldShowEnableTechnicianButton = () =>
    isAdminUser() && !!workOrder && !isClosedForTechnicianQueue(workOrder);

  const handleEnableTechnicianClick = async () => {
    if (isEnablingTechnician || technicianEnabled) return;

    if (!workOrder?.id) {
      setEnableTechnicianError('Cannot enable work order: Missing ID');
      return;
    }

    setEnableTechnicianError(null);
    setEnableTechnicianNotice(null);
    setIsEnablingTechnician(true);

    try {
      const response = await enableWorkOrderForTechnician(workOrder.id);

      if (response?.success) {
        setTechnicianEnabledOverride(true);
        setEnableTechnicianNotice('Work order enabled. The technician can now start it.');
        if (onRefresh) {
          onRefresh();
        }
      } else {
        setEnableTechnicianError((response as any)?.message || 'Failed to enable work order for the technician');
      }
    } catch (err: any) {
      setEnableTechnicianError(
        err.response?.data?.message || err.message || 'Failed to enable work order for the technician'
      );
    } finally {
      setIsEnablingTechnician(false);
    }
  };

  // A different record is a different lock state.
  useEffect(() => {
    setTechnicianEnabledOverride(null);
    setEnableTechnicianError(null);
    setEnableTechnicianNotice(null);
  }, [workOrder?.id]);

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

  const convertGDriveUrl = (url?: string | null): string => {
    if (!url) return '';
    if (url.includes('drive.google.com/file/d/')) {
      const parts = url.split('/d/');
      if (parts.length > 1) {
        const fileId = parts[1].split('/')[0];
        return `https://drive.google.com/uc?export=view&id=${fileId}`;
      }
    }
    return url;
  };

  const formatDate = (dateStr?: string | null): string => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
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
      return dateStr;
    }
  };

  const getStatusColor = (status?: string): string => {
    if (!status) return 'text-gray-500 bg-gray-500/10 border-gray-500/20';
    switch (status.toLowerCase()) {
      case 'completed': return 'text-green-500 bg-green-500/10 border-green-500/20';
      case 'in progress': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      case 'failed':
      case 'cancelled': return 'text-red-500 bg-red-500/10 border-red-500/20';
      case 'pending': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
      default: return 'text-gray-500 bg-gray-500/10 border-gray-500/20';
    }
  };

  const getFieldLabel = (fieldKey: string): string => {
    const labels: Record<string, string> = {
      id: 'Work Order ID',
      workStatus: 'Work Status',
      workCategory: 'Work Category',
      instructions: 'Instructions',
      reportTo: 'Report To',
      assignTo: 'Assign To',
      remarks: 'Remarks',
      requestedBy: 'Requested By',
      requestedDate: 'Requested Date',
      updatedBy: 'Updated By',
      updatedDate: 'Updated Date',
      image_1: 'Image 1',
      image_2: 'Image 2',
      image_3: 'Image 3',
      signature: 'Signature'
    };
    return labels[fieldKey] || fieldKey;
  };

  const toggleFieldVisibility = (field: string) => {
    setFieldVisibility((prev: Record<string, boolean>) => ({ ...prev, [field]: !prev[field] }));
  };

  const selectAllFields = () => {
    const allVisible: Record<string, boolean> = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
    setFieldVisibility(allVisible);
  };

  const deselectAllFields = () => {
    const allHidden: Record<string, boolean> = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: false }), {});
    setFieldVisibility(allHidden);
  };

  const resetFieldSettings = () => {
    const defaultVisibility: Record<string, boolean> = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
    setFieldVisibility(defaultVisibility);
    setFieldOrder(defaultFields);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;

    const newOrder = [...fieldOrder];
    const draggedItem = newOrder[draggedIndex];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);

    setFieldOrder(newOrder);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const renderFieldContent = (fieldKey: string) => {
    if (!fieldVisibility[fieldKey] || !workOrder) return null;

    const baseFieldClass = `flex flex-col sm:flex-row border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`;
    const labelClass = `w-full sm:w-1/3 text-sm mb-1 sm:mb-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`;
    const valueClass = `flex-1 sm:pl-4 font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`;

    switch (fieldKey) {
      case 'id':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Work Order ID:</div>
            <div className={valueClass}>#{workOrder.id}</div>
          </div>
        );

      case 'workStatus':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Work Status:</div>
            <div className={`flex-1 sm:pl-4`}>
              <span className={`px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(workOrder.work_status)}`}>
                {workOrder.work_status || 'Pending'}
              </span>
            </div>
          </div>
        );

      case 'workCategory':
        if (!workOrder.work_category || workOrder.work_category === 'N/A') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Work Category:</div>
            <div className={valueClass}>{workOrder.work_category}</div>
          </div>
        );

      case 'instructions':
        if (!workOrder.instructions || workOrder.instructions === 'N/A') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Instructions:</div>
            <div
              className={`${valueClass} truncate`}
              title={workOrder.instructions}
            >
              {workOrder.instructions}
            </div>
          </div>
        );

      case 'reportTo':
        if (!workOrder.report_to || workOrder.report_to === 'N/A') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Report To:</div>
            <div className={valueClass}>{workOrder.report_to}</div>
          </div>
        );

      case 'assignTo':
        if (!workOrder.assign_to || workOrder.assign_to === 'Unassigned') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Assign To:</div>
            <div className={valueClass}>{workOrder.assign_to}</div>
          </div>
        );

      case 'remarks':
        if (!workOrder.remarks || workOrder.remarks === 'None') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Remarks:</div>
            <div className={valueClass}>{workOrder.remarks}</div>
          </div>
        );

      case 'requestedBy':
        if (!workOrder.requested_by || workOrder.requested_by === 'N/A') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Requested By:</div>
            <div className={valueClass}>{workOrder.requested_by}</div>
          </div>
        );

      case 'requestedDate':
        if (!workOrder.requested_date) return null;
        const reqDate = formatDate(workOrder.requested_date);
        if (reqDate === 'N/A') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Requested Date:</div>
            <div className={valueClass}>{reqDate}</div>
          </div>
        );

      case 'updatedBy':
        if (!workOrder.updated_by || workOrder.updated_by === 'N/A') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Updated By:</div>
            <div className={valueClass}>{workOrder.updated_by}</div>
          </div>
        );

      case 'updatedDate':
        if (!workOrder.updated_date) return null;
        const updDate = formatDate(workOrder.updated_date);
        if (updDate === 'N/A') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Updated Date:</div>
            <div className={valueClass}>{updDate}</div>
          </div>
        );

      case 'image_1':
      case 'image_2':
      case 'image_3':
      case 'signature':
        {
          const fieldValue = workOrder[fieldKey];
          if (!fieldValue) return null;
          const imageUrl = convertGDriveUrl(fieldValue);

          return (
            <div className={baseFieldClass}>
              <div className={labelClass}>{getFieldLabel(fieldKey)}:</div>
              <div className={valueClass}>
                <div className={`mt-2 rounded-lg border overflow-hidden max-w-sm ${isDarkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-100'}`}>
                  <img
                    src={imageUrl}
                    alt={getFieldLabel(fieldKey)}
                    className="w-full h-auto object-contain cursor-pointer transition-transform hover:scale-105"
                    onClick={() => window.open(fieldValue, '_blank')}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = 'https://via.placeholder.com/400x300?text=Image+Not+Found';
                    }}
                  />
                  <div className={`px-3 py-2 text-xs flex items-center justify-between ${isDarkMode ? 'bg-gray-800/50' : 'bg-gray-200/50'}`}>
                    <span className="truncate flex-1 mr-2 opacity-60">View on Google Drive</span>
                    <a
                      href={fieldValue}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:text-blue-400 flex items-center"
                    >
                      <ExternalLink size={12} className="mr-1" />
                      Link
                    </a>
                  </div>
                </div>
              </div>
            </div>
          );
        }

      default:
        return null;
    }
  };

  if (!workOrder) return null;

  return (
    <div
      className={`${
        activeIsMobile
          ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]'
          : 'h-full flex flex-col overflow-hidden md:border-l relative w-full md:w-auto transition-all duration-300'
      } flex flex-col overflow-hidden ${
        isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}
      style={!activeIsMobile && window.innerWidth >= 768 ? { width: `${detailsWidth}px` } : undefined}
    >
      {!activeIsMobile && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-orange-500 hover:w-1.5 transition-all z-50"
          onMouseDown={handleMouseDownResize}
          style={{ backgroundColor: isResizing ? '#7c3aed' : 'transparent' }}
        />
      )}

        {/* Header */}
        <div className={`px-4 sm:px-6 py-4 flex items-center justify-between border-b flex-shrink-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          <div className="flex-1 min-w-0 pr-4">
            <h2 className={`text-lg sm:text-xl font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Work Order #{workOrder.id}
            </h2>
            <p
              className={`text-xs sm:text-sm truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
              title={workOrder.instructions || undefined}
            >
              {workOrder.instructions}
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {shouldShowEnableTechnicianButton() && (
              <button
                className={`px-3 py-1 rounded-sm flex items-center text-sm md:text-base font-medium whitespace-nowrap ${technicianEnabled
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                onClick={handleEnableTechnicianClick}
                disabled={technicianEnabled || isEnablingTechnician}
                title={technicianEnabled
                  ? 'The technician can already start this work order'
                  : 'Let the technician start this work order without finishing the work ahead of it first'}
              >
                {isEnablingTechnician && <Loader className="h-3 w-3 mr-1 animate-spin" />}
                <span>{technicianEnabled ? 'Enabled' : (isEnablingTechnician ? 'Enabling...' : 'Enable')}</span>
              </button>
            )}

            <button
              className="text-white px-3 py-1 rounded-sm flex items-center transition-colors text-sm md:text-base font-medium"
              style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              onMouseEnter={(e) => {
                if (colorPalette?.accent) e.currentTarget.style.backgroundColor = colorPalette.accent;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
              }}
              onClick={() => setIsEditModalOpen(true)}
            >
              <span>Edit</span>
            </button>

            <div className="relative">
              <button
                onClick={() => setShowFieldSettings(!showFieldSettings)}
                className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
                title="Field Settings"
              >
                <Settings size={16} />
              </button>
              {showFieldSettings && (
                <div className={`absolute right-0 mt-2 w-80 rounded-lg shadow-lg border z-50 max-h-96 overflow-y-auto ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                  <div className={`px-4 py-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Field Visibility & Order</h3>
                    <div className="flex items-center space-x-2">
                      <button onClick={selectAllFields} className="text-blue-600 hover:text-blue-700 text-xs">Show All</button>
                      <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                      <button onClick={deselectAllFields} className="text-blue-600 hover:text-blue-700 text-xs">Hide All</button>
                      <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                      <button onClick={resetFieldSettings} className="text-blue-600 hover:text-blue-700 text-xs">Reset</button>
                    </div>
                  </div>
                  <div className="p-2">
                    <div className={`text-xs mb-2 px-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Drag to reorder fields</div>
                    {fieldOrder.map((fieldKey, index) => (
                      <div
                        key={fieldKey}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(index)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center space-x-2 px-2 py-1.5 rounded cursor-move transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${draggedIndex === index ? isDarkMode ? 'bg-gray-600' : 'bg-gray-200' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={fieldVisibility[fieldKey]}
                          onChange={() => toggleFieldVisibility(fieldKey)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>☰</span>
                        <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{getFieldLabel(fieldKey)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {enableTechnicianError && (
          <div className={`mx-4 sm:mx-6 mt-3 p-3 rounded flex-shrink-0 ${isDarkMode
            ? 'bg-red-900 bg-opacity-20 border border-red-700 text-red-400'
            : 'bg-red-100 border border-red-300 text-red-700'
            }`}>
            {enableTechnicianError}
          </div>
        )}

        {enableTechnicianNotice && (
          <div className={`mx-4 sm:mx-6 mt-3 p-3 rounded flex-shrink-0 ${isDarkMode
            ? 'bg-emerald-900 bg-opacity-20 border border-emerald-700 text-emerald-400'
            : 'bg-emerald-50 border border-emerald-300 text-emerald-700'
            }`}>
            {enableTechnicianNotice}
          </div>
        )}

        {/* Content */}
        <div className={`flex-1 overflow-y-auto w-full ${activeIsMobile ? 'pb-24' : ''}`}>
          <div className={`max-w-2xl mx-auto py-6 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
            <div className="space-y-4">
              {fieldOrder.map((fieldKey) => (
                <React.Fragment key={fieldKey}>
                  {renderFieldContent(fieldKey)}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      {isEditModalOpen && (
        <AssignWorkOrderModal
          isOpen={isEditModalOpen}
          isEditMode={true}
          workOrder={workOrder}
          onClose={() => setIsEditModalOpen(false)}
          onSave={() => {
            setIsEditModalOpen(false);
            if (onRefresh) onRefresh();
          }}
          onRefresh={() => {
            setIsEditModalOpen(false);
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </div>
  );
};

export default WorkOrderDetails;
