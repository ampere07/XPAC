import React, { useState, useEffect, useRef } from 'react';
import { Mail, ExternalLink, Check, ChevronLeft, ChevronRight, Maximize2, X, Info } from 'lucide-react';
import { update } from '../services/discountService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getCustomerDetail, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import { CircleArrowRight, Loader } from 'lucide-react';
import { accountStatusFrom, sessionStatusFrom } from '../utils/onlineStatus';

const CustomerDetails = React.lazy(() => import('./CustomerDetails'));
const NotFoundModal = React.lazy(() => import('../modals/NotFoundModal'));

const formatDate = (dateString: string | null | undefined, includeTime: boolean = false): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
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
    return dateString;
  }
};

interface DiscountRecord {
  id?: string;
  fullName: string;
  accountNo: string;
  contactNumber: string;
  emailAddress: string;
  address: string;
  plan: string;
  provider: string;
  discountId: string;
  discountAmount: number;
  discountStatus: string;
  dateCreated: string;
  processedBy: string;
  processedDate: string;
  approvedBy: string;
  approvedByEmail?: string;
  modifiedBy: string;
  modifiedDate: string;
  userEmail: string;
  remarks: string;
  barangay?: string;
  city?: string;
  completeAddress?: string;
}

interface DiscountDetailsProps {
  discountRecord: DiscountRecord;
  onClose?: () => void;
  onApproveSuccess?: () => void;
  onViewCustomer?: (accountNo: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const DiscountDetails: React.FC<DiscountDetailsProps> = ({ discountRecord, onClose, onApproveSuccess, onViewCustomer, onPrevious, onNext }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');
  const [showApproveButton, setShowApproveButton] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  // Overlay states
  const [loadingCustomerOverlay, setLoadingCustomerOverlay] = useState(false);
  const [selectedCustomerForOverlay, setSelectedCustomerForOverlay] = useState<BillingDetailRecord | null>(null);
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null);

  const hasActiveOverlay = selectedCustomerForOverlay || loadingCustomerOverlay;

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        const userEmail = userData.email || '';
        setCurrentUserEmail(userEmail);

        const isApprovedByUser = discountRecord.approvedByEmail && userEmail && discountRecord.approvedByEmail === userEmail;
        const isPendingStatus = discountRecord.discountStatus === 'Pending';

        setShowApproveButton(isApprovedByUser && isPendingStatus);
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    }
  }, [discountRecord.approvedByEmail, discountRecord.discountStatus]);

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

  const handleApprove = () => {
    setShowConfirmModal(true);
  };

  const handleConfirmApprove = async () => {
    if (!discountRecord.id) {
      alert('Discount ID is missing');
      return;
    }

    setIsApproving(true);

    try {
      const response = await update(parseInt(discountRecord.id), {
        status: 'Unused'
      });

      if (response.success) {
        alert('Discount approved successfully! Status updated to Unused.');
        setShowConfirmModal(false);
        if (onApproveSuccess) {
          onApproveSuccess();
        }
      } else {
        alert('Failed to approve discount: ' + (response.message || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Error approving discount:', error);
      alert('Error approving discount: ' + (error.response?.data?.message || error.message || 'Unknown error'));
    } finally {
      setIsApproving(false);
    }
  };

  const handleCancelApprove = () => {
    setShowConfirmModal(false);
  };

  return (
    <div className={`flex flex-col relative md:border-l overflow-hidden ${
      isMobile ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]' : 'h-full'
    } ${isDarkMode
      ? 'bg-gray-900 text-white border-white border-opacity-30'
      : 'bg-white text-gray-900 border-gray-300'
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
      <div className={`px-4 py-3 flex items-center justify-between border-b ${isDarkMode
        ? 'bg-gray-800 border-gray-700'
        : 'bg-gray-100 border-gray-200'
        }`}>
        <h1 className={`text-lg font-semibold truncate pr-4 min-w-0 flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>
          {discountRecord.fullName}
        </h1>

        <div className="flex items-center space-x-2 flex-shrink-0">
          <div className="flex items-center overflow-hidden mr-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPrevious?.();
              }}
              disabled={!onPrevious}
              className={`p-2 transition-colors ${!onPrevious
                ? (isDarkMode ? 'text-gray-600 bg-gray-800' : 'text-gray-300 bg-gray-50')
                : (isDarkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900')
                }`}
              title="Previous Record"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onNext?.();
              }}
              disabled={!onNext}
              className={`p-2 transition-colors ${!onNext
                ? (isDarkMode ? 'text-gray-600 bg-gray-800' : 'text-gray-300 bg-gray-50')
                : (isDarkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900')
                }`}
              title="Next Record"
            >

              <ChevronRight size={18} />
            </button>
          </div>
          {showApproveButton && (
            <button
              onClick={handleApprove}
              className="px-3 py-1 rounded text-sm transition-colors flex items-center space-x-1 text-white"
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
              <Check size={16} />
              <span>Approve</span>
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
              }`}>
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-24' : ''}`}>
        <div className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-200'
          }`}>
          <div className="px-5 py-4">
            <div className="flex justify-between items-center py-2 gap-4">
              <span className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Full Name</span>
              <span className={`text-right truncate max-w-[60%] ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={discountRecord.fullName}>{discountRecord.fullName}</span>
            </div>

            <div className="flex justify-between items-center py-2 gap-4">
              <span className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Account No.</span>
              <div className="flex items-center min-w-0 pr-1">
                <span className="text-red-500 truncate text-right text-xs" title={`${discountRecord.accountNo} | ${discountRecord.fullName} | ${discountRecord.completeAddress || discountRecord.address}`}>
                  {discountRecord.accountNo} | {discountRecord.fullName} | {discountRecord.completeAddress || discountRecord.address}
                </span>
                <button
                  onClick={async () => {
                    const accNo = discountRecord.accountNo;
                    if (!accNo || accNo === '-') return;
                    try {
                      setLoadingCustomerOverlay(true);
                      const details = await getCustomerDetail(accNo);
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
                  className={`ml-2 p-1 rounded transition-colors flex-shrink-0 ${loadingCustomerOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                  title="View Customer Details"
                  disabled={loadingCustomerOverlay}
                >
                  {loadingCustomerOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Contact Number</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.contactNumber}</span>
            </div>

            <div className="flex justify-between items-center py-2 gap-4">
              <span className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Email Address</span>
              <span className={`text-right truncate max-w-[60%] ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={discountRecord.emailAddress}>{discountRecord.emailAddress}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Address</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.address}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Plan</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.plan}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Provider</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.provider}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Discount ID</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.discountId}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Discount Amount</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>₱{discountRecord.discountAmount.toFixed(2)}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Discount Status</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.discountStatus}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Date Created</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{formatDate(discountRecord.dateCreated, true)}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Processed By</span>
              <div className="flex items-center">
                <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.processedBy}</span>
                <Info size={16} className={`ml-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                  }`} />
              </div>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Processed Date</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{formatDate(discountRecord.processedDate)}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Approved By</span>
              <div className="flex items-center">
                <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.approvedBy}</span>
                <Info size={16} className={`ml-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                  }`} />
              </div>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Modified By</span>
              <div className="flex items-center">
                <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.modifiedBy}</span>
                <Info size={16} className={`ml-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                  }`} />
              </div>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Modified Date</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{formatDate(discountRecord.modifiedDate, true)}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>User Email</span>
              <div className="flex items-center">
                <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.userEmail}</span>
                <Mail size={16} className={`ml-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                  }`} />
              </div>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Remarks</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.remarks}</span>
            </div>

            {discountRecord.barangay && (
              <div className="flex justify-between items-center py-2">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Barangay</span>
                <div className="flex items-center">
                  <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.barangay}</span>
                  <Info size={16} className={`ml-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                    }`} />
                </div>
              </div>
            )}

            {discountRecord.city && (
              <div className="flex justify-between items-center py-2">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>City</span>
                <div className="flex items-center">
                  <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.city}</span>
                  <Info size={16} className={`ml-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                    }`} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-200'
            }`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Confirm Approval</h2>
              <button
                onClick={handleCancelApprove}
                disabled={isApproving}
                className={`transition-colors disabled:opacity-50 ${isDarkMode
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-6">
              <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Are you sure you want to approve this discount?
              </p>
              <div className={`p-4 rounded border space-y-2 ${isDarkMode
                ? 'bg-gray-900 border-gray-700'
                : 'bg-gray-100 border-gray-200'
                }`}>
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Account No:</span>
                  <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.accountNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Customer:</span>
                  <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{discountRecord.fullName}</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Amount:</span>
                  <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>₱{discountRecord.discountAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Current Status:</span>
                  <span className="text-yellow-400">{discountRecord.discountStatus}</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>New Status:</span>
                  <span className="text-green-400">Unused</span>
                </div>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleCancelApprove}
                disabled={isApproving}
                className={`flex-1 px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-300 hover:bg-gray-400 text-gray-900'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmApprove}
                disabled={isApproving}
                className="flex-1 px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-white"
                style={{
                  backgroundColor: isApproving ? '#4b5563' : (colorPalette?.primary || '#7c3aed')
                }}
                onMouseEnter={(e) => {
                  if (!isApproving && colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isApproving && colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = colorPalette.primary;
                  }
                }}
              >
                {isApproving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Approving...
                  </>
                ) : (
                  <>
                    <Check size={16} className="mr-2" />
                    Confirm Approval
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
};

export default DiscountDetails;