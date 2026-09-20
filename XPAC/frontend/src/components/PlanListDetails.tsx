import React, { useState, useEffect, useRef } from 'react';
import {
  X, Settings, ChevronDown, ChevronRight as ChevronRightIcon
} from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import RelatedDataTable from './RelatedDataTable';
import apiClient from '../config/api';

import ApplicationDetails from './ApplicationDetails';
import JobOrderDetails from './JobOrderDetails';
import CustomerDetails from './CustomerDetails';
import { getApplication } from '../services/applicationService';
import { getJobOrder, JobOrderData } from '../services/jobOrderService';
import { getBillingRecordDetails, BillingDetailRecord } from '../services/billingService';
import { Application } from '../types/application';

interface Plan {
  id: number;
  name: string;
  description?: string;
  price?: number;
  is_active?: boolean;
  modified_date?: string;
  modified_by?: string | number;
  created_at?: string;
  updated_at?: string;
}

interface PlanListDetailsProps {
  plan: Plan;
  onClose: () => void;
  isMobile?: boolean;
  onNavigate?: (section: string, extra?: string) => void;
}

const PlanListDetails: React.FC<PlanListDetailsProps> = ({ plan, onClose, isMobile = false, onNavigate }) => {
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  // States for related child details overlays
  const [selectedApplicationForDetails, setSelectedApplicationForDetails] = useState<Application | null>(null);
  const [selectedJobOrderForDetails, setSelectedJobOrderForDetails] = useState<JobOrderData | null>(null);
  const [selectedCustomerForDetails, setSelectedCustomerForDetails] = useState<BillingDetailRecord | null>(null);
  const [loadingDetailsOverlay, setLoadingDetailsOverlay] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Related data state
  const [relatedApplications, setRelatedApplications] = useState<any[]>([]);
  const [relatedJobOrders, setRelatedJobOrders] = useState<any[]>([]);
  const [relatedCustomers, setRelatedCustomers] = useState<any[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

  // No longer using collapsible state for sections


  // Pagination for Collapsible sections
  const [pages, setPages] = useState<Record<string, number>>({});

  const handlePageChange = (sectionKey: string, newPage: number) => {
    setPages(prev => ({ ...prev, [sectionKey]: newPage }));
  };

  const FIELD_VISIBILITY_KEY = 'planListDetailsFieldVisibility';
  const FIELD_ORDER_KEY = 'planListDetailsFieldOrder';

  const defaultFields = [
    'name',
    'description',
    'price',
    'isActive',
    'createdAt',
    'modifiedBy',
    'modifiedDate',
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

  // Fetch related data from backend
  useEffect(() => {
    const fetchRelatedData = async () => {
      if (!plan.id) return;
      try {
        setLoadingRelated(true);
        const response = await apiClient.get<{ success: boolean; data: any; counts: any }>(`/plans/${plan.id}/related`);
        if (response.data?.success) {
          setRelatedApplications(response.data.data?.applications || []);
          setRelatedJobOrders(response.data.data?.job_orders || []);
          setRelatedCustomers(response.data.data?.customers || []);
        }
      } catch (err) {
        console.error('Error fetching plan related data:', err);
      } finally {
        setLoadingRelated(false);
      }
    };

    fetchRelatedData();
  }, [plan.id]);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = detailsWidth;
  };

  const formatDate = (dateStr: string | undefined): string => {
    if (!dateStr) return 'Not available';
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

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP'
    }).format(price);
  };

  const getFieldLabel = (fieldKey: string): string => {
    const labels: Record<string, string> = {
      name: 'Plan Name',
      description: 'Description',
      price: 'Price',
      isActive: 'Status',
      createdAt: 'Created At',
      modifiedBy: 'Modified By',
      modifiedDate: 'Modified Date'
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

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (dropIndex: number) => {
    if (draggedIndex === null) return;
    const newOrder = [...fieldOrder];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, removed);
    setFieldOrder(newOrder);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const resetFieldSettings = () => {
    const allVisible: Record<string, boolean> = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
    setFieldVisibility(allVisible);
    setFieldOrder(defaultFields);
  };

  // Section toggle removed as per request to keep it static

  const renderFieldContent = (fieldKey: string) => {
    if (!fieldVisibility[fieldKey]) return null;

    switch (fieldKey) {
      case 'name':
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Plan Name:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{plan.name}</div>
          </div>
        );

      case 'description':
        if (!plan.description) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Description:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{plan.description}</div>
          </div>
        );

      case 'price':
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Price:</div>
            <div className={`flex-1 font-semibold text-green-500`}>
              {formatPrice(plan.price || 0)}
            </div>
          </div>
        );

      case 'isActive':
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Status:</div>
            <div className={`flex-1 capitalize`}>
              {plan.is_active !== false ? (
                <span className="text-xs px-2 py-1 rounded bg-green-800 text-green-400">Active</span>
              ) : (
                <span className="text-xs px-2 py-1 rounded bg-red-800 text-red-400">Inactive</span>
              )}
            </div>
          </div>
        );

      case 'createdAt':
        if (!plan.created_at) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Created At:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{formatDate(plan.created_at)}</div>
          </div>
        );

      case 'modifiedBy':
        if (!plan.modified_by) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Modified By:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{plan.modified_by || 'System'}</div>
          </div>
        );

      case 'modifiedDate':
        if (!plan.modified_date && !plan.updated_at) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Modified Date:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{formatDate(plan.modified_date || plan.updated_at)}</div>
          </div>
        );

      default:
        return null;
    }
  };

  const renderRelatedSection = (
    title: string,
    sectionKey: string,
    data: any[],
    columns: any[],
    onRowClick?: (row: any) => void
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
            <span className={`text-xs px-2 py-1 rounded ${
              isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'
            }`}>
              {loadingRelated ? '...' : data.length}
            </span>
          </div>
        </div>

        <div className="px-6 pb-4">
          {loadingRelated ? (
            <div className={`text-center py-4 text-sm ${isDarkMode ? 'text-orange-500' : 'text-orange-600'} animate-pulse`}>
              Loading...
            </div>
          ) : data.length > 0 ? (
            <div className="flex flex-col">
              <RelatedDataTable
                data={paginatedData}
                columns={columns}
                isDarkMode={isDarkMode}
                onRowClick={onRowClick}
              />
              {totalPages > 1 && (
                <div className={`flex items-center justify-end py-3 mt-2`}>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handlePageChange(sectionKey, currentPage - 1)}
                      disabled={currentPage === 1}
                      className={`px-3 py-1 rounded text-sm font-medium disabled:opacity-50 ${
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
                      className={`px-3 py-1 rounded text-sm font-medium disabled:opacity-50 ${
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

  const handleApplicationRowClick = async (row: any) => {
    try {
      setLoadingDetailsOverlay(true);
      const app = await getApplication(row.id);
      setSelectedApplicationForDetails(app);
    } catch (e) {
      console.error('Failed to load application details', e);
    } finally {
      setLoadingDetailsOverlay(false);
    }
  };

  const handleJobOrderRowClick = async (row: any) => {
    try {
      setLoadingDetailsOverlay(true);
      const res = await getJobOrder(row.id);
      if (res.success && res.data) {
        setSelectedJobOrderForDetails(res.data);
      }
    } catch (e) {
      console.error('Failed to load job order details', e);
    } finally {
      setLoadingDetailsOverlay(false);
    }
  };

  const handleCustomerRowClick = async (row: any) => {
    if (!row.account_no && !row.id) return;
    try {
      setLoadingDetailsOverlay(true);
      const idToFetch = row.account_no || row.id;
      const res = await getBillingRecordDetails(idToFetch);
      if (res) {
        setSelectedCustomerForDetails(res);
      } else {
        console.error('No billing details found for this customer');
      }
    } catch (e) {
      console.error('Failed to load customer details', e);
    } finally {
      setLoadingDetailsOverlay(false);
    }
  };

  const hasActiveOverlay = loadingDetailsOverlay || selectedApplicationForDetails || selectedJobOrderForDetails || selectedCustomerForDetails;

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

          {/* Render Overlays If Active */}
          {hasActiveOverlay && (
            <div className="absolute inset-0 z-50 bg-white dark:bg-gray-900 overflow-hidden flex flex-col h-full w-full">
              {loadingDetailsOverlay && (
                <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
                  <div className="flex flex-col items-center gap-3">
                    <p className="loading-dots pt-4">Loading Details</p>
                  </div>
                </div>
              )}
              {selectedApplicationForDetails && (
                <div className="w-full h-full relative">
                  <ApplicationDetails
                    application={selectedApplicationForDetails}
                    onClose={() => setSelectedApplicationForDetails(null)}
                  />
                </div>
              )}
              {selectedJobOrderForDetails && (
                <div className="w-full h-full relative">
                  <JobOrderDetails
                    jobOrder={selectedJobOrderForDetails}
                    onClose={() => setSelectedJobOrderForDetails(null)}
                    onRefresh={async () => {}}
                    isMobile={isMobile}
                  />
                </div>
              )}
              {selectedCustomerForDetails && (
                <div className="w-full h-full relative">
                  <CustomerDetails
                    billingRecord={selectedCustomerForDetails}
                    onClose={() => setSelectedCustomerForDetails(null)}
                    onRefresh={async () => {}}
                  />
                </div>
              )}
            </div>
          )}

          {/* Normal PlanListDetails Content - Hidden when overlay is active */}
          <div className={hasActiveOverlay ? 'hidden' : 'block h-full flex flex-col'}>
            <div className={`p-3 flex items-center justify-between border-b ${
              isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}>
              <div className="flex items-center">
                <h2 className={isDarkMode ? 'text-white font-medium' : 'text-gray-900 font-medium'}>{plan.name}</h2>
                {loading && <div className={`ml-3 animate-pulse text-sm ${isDarkMode ? 'text-orange-500' : 'text-orange-600'}`}>Loading...</div>}
              </div>

              <div className="flex items-center space-x-3">
                <div className="relative">
                  <button
                    onClick={() => setShowFieldSettings(!showFieldSettings)}
                    className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
                    title="Field Settings"
                  >
                    <Settings size={16} />
                  </button>
                  {showFieldSettings && (
                    <div className={`absolute right-0 mt-2 w-80 rounded-lg shadow-lg border z-50 max-h-96 overflow-y-auto ${isDarkMode
                      ? 'bg-gray-800 border-gray-700'
                      : 'bg-white border-gray-200'
                      }`}>
                      <div className={`px-4 py-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                        }`}>
                        <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>Field Visibility & Order</h3>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={selectAllFields}
                            className="text-blue-600 hover:text-blue-700 text-xs"
                          >
                            Show All
                          </button>
                          <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                          <button
                            onClick={deselectAllFields}
                            className="text-blue-600 hover:text-blue-700 text-xs"
                          >
                            Hide All
                          </button>
                          <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                          <button
                            onClick={resetFieldSettings}
                            className="text-blue-600 hover:text-blue-700 text-xs"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                      <div className="p-2">
                        <div className={`text-xs mb-2 px-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                          Drag to reorder fields
                        </div>
                        {fieldOrder.map((fieldKey, index) => (
                          <div
                            key={fieldKey}
                            draggable
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDrop(index)}
                            onDragEnd={handleDragEnd}
                            className={`flex items-center space-x-2 px-2 py-1.5 rounded cursor-move transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                              } ${draggedIndex === index
                                ? isDarkMode ? 'bg-gray-600' : 'bg-gray-200'
                                : ''
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={fieldVisibility[fieldKey]}
                              onChange={() => toggleFieldVisibility(fieldKey)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                              }`}>☰</span>
                            <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                              }`}>
                              {getFieldLabel(fieldKey)}
                            </span>
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

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto w-full h-full relative">
              {/* Plan Detail Fields */}
              <div className={`max-w-2xl mx-auto py-6 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <div className="space-y-4">
                  {fieldOrder.map((fieldKey) => (
                    <React.Fragment key={fieldKey}>
                      {renderFieldContent(fieldKey)}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Related References Section */}
              <div className={`border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className={`px-4 py-3 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
                  <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Related References
                  </h3>
                </div>

                {/* Related Applications */}
                {renderRelatedSection(
                  'Related Applications',
                  'applications',
                  relatedApplications,
                  [
                    { key: 'first_name', label: 'First Name', render: (val: any) => val || '-' },
                    { key: 'id', label: 'ID', render: (val: any) => val || '-' },
                    { 
                      key: 'created_at', 
                      label: 'Timestamp', 
                      render: (val: any) => val ? (typeof val === 'string' ? (val.includes('T') ? val.split('T')[0] : (val.includes(' ') ? val.split(' ')[0] : val)) : val) : '-' 
                    },
                    { key: 'email_address', label: 'Email Address', render: (val: any) => val || '-' },
                    { key: 'region', label: 'Region', render: (val: any) => val || '-' },
                    { key: 'city', label: 'City', render: (val: any) => val || '-' },
                    { key: 'barangay', label: 'Barangay', render: (val: any) => val || '-' },
                    { key: 'referred_by', label: 'Referred By', render: (val: any) => val || '-' },
                    { key: 'middle_initial', label: 'Middle Initial', render: (val: any) => val || '-' },
                    { key: 'last_name', label: 'Last Name', render: (val: any) => val || '-' },
                    { key: 'installation_address', label: 'Address', render: (val: any) => val || '-' },
                    { key: 'landmark', label: 'Landmark', render: (val: any) => val || '-' },
                    { key: 'desired_plan', label: 'Desired Plan', render: (val: any) => val || '-' },
                    { key: 'usage_type', label: 'Usage Type', render: (val: any) => val || '-' },
                    { key: 'ownership', label: 'Ownership', render: (val: any) => val || '-' },
                    { 
                      key: 'terms_agreed', 
                      label: 'I Agree', 
                      render: (val: any) => {
                        if (val === 1 || val === true || val === '1' || val === 'yes' || val === 'Yes' || val === 'Agreed') return 'Yes';
                        if (val === 0 || val === false || val === '0') return 'No';
                        return val ? String(val) : '-';
                      } 
                    },
                    { key: 'applying_for', label: 'Applying For', render: (val: any) => val || '-' },
                    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
                    { key: 'visit_by', label: 'Visit By', render: (val: any) => val || '-' },
                    { key: 'visit_with', label: 'Visit With', render: (val: any) => val || '-' },
                    { key: 'visit_with_other', label: 'Visit With Other', render: (val: any) => val || '-' },
                    { key: 'remarks', label: 'Remarks', render: (val: any) => val || '-' },
                    { key: 'updated_by', label: 'Modified By', render: (val: any) => val || '-' },
                    { key: 'updated_at', label: 'Modified Date', render: (val: any) => val ? (typeof val === 'string' ? (val.includes('T') ? val.split('T')[0] : (val.includes(' ') ? val.split(' ')[0] : val)) : val) : '-' },
                    { key: 'full_name', label: 'Full Name', render: (val: any) => val || '-' },
                    { 
                      key: '_computed_time', 
                      label: 'Computed Time', 
                      render: (val: any, row: any) => {
                        const time = row.create_time || (row.created_at && typeof row.created_at === 'string' ? (row.created_at.includes('T') ? row.created_at.split('T')[1].substring(0, 8) : (row.created_at.includes(' ') ? row.created_at.split(' ')[1].substring(0, 8) : null)) : null);
                        return time || '-';
                      }
                    },
                    { key: '_full_address', label: 'Full Address', render: (val: any, row: any) => {
                        const parts = [row.installation_address, row.barangay, row.city, row.region].filter(Boolean);
                        return parts.length > 0 ? parts.join(', ') : '-';
                    }},
                    { key: 'job_orders_count', label: 'Related Job Orders', render: (val: any) => val ?? '-' }
                  ],
                  handleApplicationRowClick
                )}

                {/* Related Job Orders */}
                {renderRelatedSection(
                  'Related Job Orders',
                  'jobOrders',
                  relatedJobOrders,
                  [
                    { key: 'onsite_status', label: 'Onsite Status', render: (val: any) => val || '-' },
                    { key: 'customer_name', label: 'Full Name of Client', render: (val: any) => val || '-' },
                    { key: 'computed_full_address', label: 'Full Address of Client', render: (val: any) => val || '-' },
                    { key: 'timestamp', label: 'TImestamp', render: (val: any) => val ? (val.includes('T') ? val.split('T')[0] : (val.includes(' ') ? val.split(' ')[0] : val)) : '-' },
                    { key: 'email_address', label: 'Email Address', render: (val: any) => val || '-' },
                    { key: 'referred_by', label: 'Referred by:', render: (val: any) => val || '-' },
                    { key: 'first_name', label: 'FIrst Name', render: (val: any) => val || '-' },
                    { key: 'last_name', label: 'Last Name', render: (val: any) => val || '-' },
                    { key: 'mobile_number', label: 'Contact Number', render: (val: any) => val || '-' },
                    { key: 'installation_address', label: 'Address', render: (val: any) => val || '-' },
                    { key: 'barangay', label: 'Barangay', render: (val: any) => val || '-' },
                    { key: 'city', label: 'City', render: (val: any) => val || '-' },
                    { key: 'region', label: 'Region', render: (val: any) => val || '-' },
                    { key: 'desired_plan', label: 'Choose Plan', render: (val: any) => val || '-' },
                    { key: 'visit_remarks', label: 'Remarks', render: (val: any) => val || '-' },
                    { key: 'installation_fee', label: 'Installation Fee', render: (val: any) => val !== null ? val : '-' },
                    { key: '_contract_template', label: 'Contract Template', render: (_: any, row: any) => row.contract_link || '-' },
                    { key: 'billing_day', label: 'Billing Day', render: (val: any) => val !== null ? val : '-' },
                    { key: 'status_remarks', label: 'JO Remarks', render: (val: any) => val || '-' },
                    { key: 'status', label: 'Status', render: (val: any) => val || '-' },
                    { key: 'modem_router_sn', label: 'Modem SN', render: (val: any) => val || '-' },
                    { key: 'provider', label: 'Provider', render: (val: any) => val || '-' },
                    { key: 'lcp', label: 'LCP', render: (val: any, row: any) => {
                        if (row.lcpnap) {
                            return row.lcpnap; // Wait, actually I don't have separate lcp/nap readily queried. I return the joined lcpnap.
                        }
                        return '-';
                    }},
                    { key: 'nap', label: 'NAP', render: (val: any, row: any) => {
                        if (row.lcpnap) return row.lcpnap; // LCPNAP usually combines both
                        return '-';
                    }},
                    { key: 'port', label: 'PORT', render: (val: any) => val || '-' },
                    { key: 'vlan', label: 'VLAN', render: (val: any) => val || '-' },
                    { key: 'username', label: 'Username', render: (val: any) => val || '-' },
                    { key: 'computed_visit_by', label: 'Visit By', render: (val: any) => val || '-' },
                    { key: 'visit_with', label: 'VIsit WIth', render: (val: any) => val || '-' },
                    { key: 'visit_with_other', label: 'Visit WIth(other)', render: (val: any) => val || '-' },
                    { key: 'onsite_remarks', label: 'Onsite Remarks', render: (val: any) => val || '-' },
                    { key: 'modified_by', label: 'Modified By', render: (val: any) => val || '-' },
                    { key: 'updated_at', label: 'Modified Date', render: (val: any) => val ? (val.includes('T') ? val.split('T')[0] : (val.includes(' ') ? val.split(' ')[0] : val)) : '-' },
                    { key: 'contract_link', label: 'Contract Link', render: (val: any) => val || '-' },
                    { key: 'connection_type', label: 'Connection Type', render: (val: any) => val || '-' },
                    { key: 'assigned_email', label: 'Assigned Email', render: (val: any) => val || '-' },
                    { key: 'setup_image_url', label: 'Setup Image', render: (val: any) => val || '-' },
                    { key: 'start_time', label: 'Start Time', render: (val: any) => val ? (val.includes('T') ? val.replace('T', ' ').substring(0, 19) : val) : '-' },
                    { key: 'end_time', label: 'End TIme', render: (val: any) => val ? (val.includes('T') ? val.replace('T', ' ').substring(0, 19) : val) : '-' },
                    { key: 'duration', label: 'Duration', render: (val: any) => val || '-' },
                    { key: 'id', label: 'id', render: (val: any) => val || '-' },
                    { key: 'lcpnap', label: 'LCPNAP', render: (val: any) => val || '-' },
                    { key: 'billing_status', label: 'Billing Status', render: (val: any) => val || '-' },
                    { key: 'router_model', label: 'Router Model', render: (val: any) => val || '-' },
                    { key: 'date_installed', label: 'Date Installed', render: (val: any) => val ? (val.includes('T') ? val.split('T')[0] : (val.includes(' ') ? val.split(' ')[0] : val)) : '-' },
                    { key: 'client_signature_url', label: 'Client Signature', render: (val: any) => val || '-' },
                    { key: 'ip_address', label: 'IP', render: (val: any) => val || '-' },
                    { key: 'signed_contract_image_url', label: 'Signed Contract Image', render: (val: any) => val || '-' },
                    { key: 'lcpnapport', label: 'LCPNAPPORT', render: (val: any) => val || '-' },
                    { key: 'usage_type_id', label: 'Usage Type', render: (val: any, row: any) => row.usage_type || val || '-' },
                    { key: 'ownership', label: 'Ownership', render: (val: any) => val || '-' },
                    { key: 'account_no', label: 'Account No,', render: (val: any) => val || '-' },
                    { key: '_computed_time', label: '_Computed Time', render: (_: any, row: any) => {
                        const val = row.timestamp;
                        return val ? (val.includes('T') ? val.replace('T', ' ').substring(0, 19) : val) : '-';
                    }}
                  ],
                  handleJobOrderRowClick
                )}

                {/* Subscribed Customers */}
                {renderRelatedSection(
                  'Subscribed Customers',
                  'customers',
                  relatedCustomers,
                  [
                    { key: 'full_name', label: 'Full Name', render: (val: any) => val || '-' },
                    { key: 'email_address', label: 'Email', render: (val: any) => val || '-' },
                    { key: 'contact_number_primary', label: 'Contact', render: (val: any) => val || '-' },
                    { key: 'address', label: 'Address', render: (val: any) => val ? val.split(',')[0] : '-' },
                    {
                      key: 'created_at',
                      label: 'Joined',
                      render: (val: any) => val ? (typeof val === 'string' ? (val.includes('T') ? val.split('T')[0] : (val.includes(' ') ? val.split(' ')[0] : val)) : val) : '-'
                    }
                  ],
                  handleCustomerRowClick
                )}
              </div>
            </div>
          </div>
    </div>
  );
};

export default PlanListDetails;
