import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, ArrowRight, Maximize2, X, Info, ExternalLink, CheckCircle
} from 'lucide-react';
import LoadingModal from './common/LoadingModalGlobal';
import * as massRebateService from '../services/massRebateService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getCustomerDetail, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import { CircleArrowRight, Loader } from 'lucide-react';
import apiClient from '../config/api';

const CustomerDetails = React.lazy(() => import('./CustomerDetails'));
const NotFoundModal = React.lazy(() => import('../modals/NotFoundModal'));

interface RebateUsage {
  id: number;
  rebates_id: number;
  account_no: string;
  status: string;
  month: string;
}

interface Rebate {
  id: number;
  number_of_dates: number;
  rebate_type: string;
  selected_rebate: string;
  month: string;
  status: string;
  created_by: string;
  modified_by: string | null;
  modified_date: string;
}

interface RebateDetailsProps {
  rebate: Rebate;
  onClose: () => void;
  onViewCustomer?: (accountNo: string) => void;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

const RebateDetails: React.FC<RebateDetailsProps> = ({ rebate, onClose, onViewCustomer }) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [rebateUsages, setRebateUsages] = useState<RebateUsage[]>([]);
  const [usagesLoading, setUsagesLoading] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Overlay states
  const [loadingCustomerOverlay, setLoadingCustomerOverlay] = useState(false);
  const [selectedCustomerForOverlay, setSelectedCustomerForOverlay] = useState<BillingDetailRecord | null>(null);
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null);

  const hasActiveOverlay = selectedCustomerForOverlay || loadingCustomerOverlay;

  const canApprove = rebate.status.toLowerCase() === 'pending';

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetchRebateUsages();
  }, [rebate.id]);

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

  const fetchRebateUsages = async () => {
    try {
      setUsagesLoading(true);
      const response = await apiClient.get<ApiResponse<RebateUsage[]>>(`/rebates-usage?rebates_id=${rebate.id}`);
      const data = response.data;

      if (data.success) {
        setRebateUsages(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch rebate usages:', err);
    } finally {
      setUsagesLoading(false);
    }
  };

  const formatDate = (dateStr?: string, includeTime: boolean = false): string => {
    if (!dateStr) return 'No date';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();

      if (includeTime) {
        let hours = date.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${mm}/${dd}/${yyyy} ${hours}:${minutes}:${seconds} ${ampm}`;
      }

      return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
      return dateStr;
    }
  };

  const handleApproveRebate = async () => {
    if (!window.confirm('Are you sure you want to approve this rebate? This will change the status to Unused and the rebate will become available for use.')) {
      return;
    }

    try {
      setLoading(true);
      setLoadingPercentage(0);
      setError(null);

      setLoadingPercentage(20);

      const result = await massRebateService.update(rebate.id, { status: 'Unused' });

      setLoadingPercentage(60);

      if (result.success) {
        setLoadingPercentage(100);

        rebate.status = result.data?.status || 'Unused';

        await new Promise(resolve => setTimeout(resolve, 500));

        setSuccessMessage('Rebate approved successfully. Status changed to Unused.');
        setShowSuccessModal(true);
      } else {
        setError(result.message || 'Failed to approve rebate');
      }
    } catch (err: any) {
      setError(`Failed to approve rebate: ${err.message}`);
      console.error('Approve rebate error:', err);
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };



  const getDisplayText = () => {
    return `${rebate.rebate_type.toUpperCase()} | ${rebate.selected_rebate} | ${rebate.month}`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'unused':
        return 'text-green-500';
      case 'used':
        return 'text-red-500';
      case 'pending':
        return 'text-yellow-500';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <>
      <LoadingModal
        isOpen={loading}
        type="loading"
        title="Processing Rebate"
        message="Processing rebate..."
        loadingPercentage={loadingPercentage}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
      />

      <div className={`flex flex-col relative md:border-l overflow-hidden ${
        isMobile ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]' : 'h-full'
      } ${isDarkMode
        ? 'bg-gray-950 border-white border-opacity-30'
        : 'bg-white border-gray-300'
        }`} style={{ width: isMobile ? '100%' : `${detailsWidth}px` }}>
        {!isMobile && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50"
            onMouseDown={handleMouseDownResize}
            style={{
              backgroundColor: isResizing ? (colorPalette?.primary || '#7c3aed') : 'transparent'
            }}
            onMouseEnter={(e) => {
              if (!isResizing && colorPalette?.accent) {
                e.currentTarget.style.backgroundColor = colorPalette.accent;
              }
            }}
            onMouseLeave={(e) => {
              if (!isResizing) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          />
        )}
        <div className={`p-3 flex items-center justify-between border-b ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-gray-100 border-gray-200'
          }`}>
          <div className="flex items-center min-w-0 flex-1">
            <h2 className={`font-medium truncate pr-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{getDisplayText()}</h2>
            {loading && <div className="ml-3 animate-pulse text-orange-500 text-sm flex-shrink-0">Loading...</div>}
          </div>

          <div className="flex items-center space-x-3">
            {canApprove && (
              <button
                onClick={handleApproveRebate}
                disabled={loading}
                className="flex items-center space-x-2 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded text-sm transition-colors"
                style={{
                  backgroundColor: loading ? '#4b5563' : (colorPalette?.primary || '#7c3aed')
                }}
                onMouseEnter={(e) => {
                  if (!loading && colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = colorPalette.primary;
                  }
                }}
              >
                <CheckCircle size={16} />
                <span>{loading ? 'Processing...' : 'Approve'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div className={`border p-3 m-3 rounded ${isDarkMode
            ? 'bg-red-900 bg-opacity-20 border-red-700 text-red-400'
            : 'bg-red-100 border-red-300 text-red-900'
            }`}>
            {error}
          </div>
        )}

        <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-24' : ''}`}>
          <div className={`mx-auto py-1 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-white'
            }`}>
            <div className="space-y-1">
              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Rebate ID</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{rebate.id}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Rebate Type</div>
                <div className={`flex-1 capitalize flex items-center ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                  {rebate.rebate_type}
                  <button className={isDarkMode ? 'ml-2 text-gray-400 hover:text-white' : 'ml-2 text-gray-600 hover:text-gray-900'}>
                    <Info size={16} />
                  </button>
                </div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Selected Rebate</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{rebate.selected_rebate}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Month</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{rebate.month}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Number of Days</div>
                <div className={`flex-1 font-bold text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{rebate.number_of_dates}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Status</div>
                <div className="flex-1">
                  <div className={`capitalize font-medium ${getStatusColor(rebate.status)}`}>
                    {rebate.status}
                  </div>
                </div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Created By</div>
                <div className={`flex-1 flex items-center ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                  {rebate.created_by || '-'}
                  <button className={isDarkMode ? 'ml-2 text-gray-400 hover:text-white' : 'ml-2 text-gray-600 hover:text-gray-900'}>
                    <Info size={16} />
                  </button>
                </div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Approved By</div>
                <div className={`flex-1 flex items-center ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                  {rebate.modified_by || '-'}
                  {rebate.modified_by && (
                    <button className={isDarkMode ? 'ml-2 text-gray-400 hover:text-white' : 'ml-2 text-gray-600 hover:text-gray-900'}>
                      <Info size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Modified Date</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{formatDate(rebate.modified_date, true)}</div>
              </div>
            </div>
          </div>

          <div className={`mx-auto px-4 mt-4 ${isDarkMode ? 'bg-gray-950' : 'bg-white'
            }`}>
            <div className={`pt-4 ${isDarkMode ? 'border-t border-gray-800' : 'border-t border-gray-300'
              }`}>
              <div className="flex items-center mb-4">
                <h3 className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>Affected Accounts</h3>
                <span className={`ml-2 text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'
                  }`}>
                  {rebateUsages.length}
                </span>
              </div>

              {usagesLoading ? (
                <div className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  <div className="animate-pulse">Loading accounts...</div>
                </div>
              ) : rebateUsages.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className={`min-w-full text-sm ${isDarkMode ? 'divide-y divide-gray-700' : 'divide-y divide-gray-300'
                    }`}>
                    <thead className={isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}>
                      <tr>
                        <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>Account No</th>
                        <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>Status</th>
                        <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>Month</th>
                      </tr>
                    </thead>
                    <tbody className={isDarkMode ? 'bg-gray-900 divide-y divide-gray-800' : 'bg-white divide-y divide-gray-300'}>
                      {rebateUsages.map((usage) => (
                        <tr key={usage.id} className={isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}>
                          <td className={`px-4 py-3 whitespace-nowrap flex items-center ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                            }`}>
                            {usage.account_no}
                            <button
                              onClick={async () => {
                                const accNo = usage.account_no;
                                if (!accNo || accNo === '-') return;
                                try {
                                  setLoadingCustomerOverlay(true);
                                  const details = await getCustomerDetail(String(accNo));
                                  if (details) {
                                    setSelectedCustomerForOverlay(convertCustomerDataToBillingDetail(details));
                                  } else {
                                    setNotFoundMessage('Customer details not found.');
                                  }
                                } catch (err) {
                                  console.error('Error finding customer', err);
                                } finally {
                                  setLoadingCustomerOverlay(false);
                                }
                              }}
                              className={`ml-2 p-1 rounded transition-colors ${loadingCustomerOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                              title="View Customer Details"
                              disabled={loadingCustomerOverlay}
                            >
                              {loadingCustomerOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={14} />}
                            </button>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`capitalize ${getStatusColor(usage.status)}`}>
                              {usage.status}
                            </span>
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                            }`}>{usage.month}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  No affected accounts found
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Embedded Overlays */}
      {hasActiveOverlay && (
        <div className="absolute inset-0 z-50 bg-white dark:bg-gray-900 overflow-hidden flex flex-col h-full w-full">
          {loadingCustomerOverlay && (
            <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
              <div className="flex flex-col items-center gap-3">
                <p className="loading-dots pt-4 text-sm font-medium">Loading Customer Details</p>
              </div>
            </div>
          )}
          {selectedCustomerForOverlay && (
            <React.Suspense fallback={
              <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
                <div className="flex flex-col items-center gap-3">
                  <p className="loading-dots pt-4 text-sm font-medium">Loading Customer Overlay</p>
                </div>
              </div>
            }>
              <div className="w-full h-full relative border-0">
                <CustomerDetails
                  billingRecord={selectedCustomerForOverlay}
                  onClose={() => setSelectedCustomerForOverlay(null)}
                />
              </div>
            </React.Suspense>
          )}
        </div>
      )}

      {/* Not Found Modal */}
      <React.Suspense fallback={null}>
        <NotFoundModal
          isOpen={!!notFoundMessage}
          onClose={() => setNotFoundMessage(null)}
          message={notFoundMessage || ''}
        />
      </React.Suspense>

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-300'
            }`}>
            <h3 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Success</h3>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>{successMessage}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  if (onClose) {
                    onClose();
                  }
                }}
                className="text-white px-6 py-2 rounded transition-colors"
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
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RebateDetails;
