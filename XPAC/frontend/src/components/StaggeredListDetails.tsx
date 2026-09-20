import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, ArrowRight, Maximize2, X, Info,
  ExternalLink, CheckCircle, Loader2, CircleArrowRight, Loader, ChevronLeft, ChevronRight
} from 'lucide-react';
import { staggeredInstallationService } from '../services/staggeredInstallationService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getCustomerDetail, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';

const CustomerDetails = React.lazy(() => import('./CustomerDetails'));
const NotFoundModal = React.lazy(() => import('../modals/NotFoundModal'));

interface StaggeredInstallation {
  id: string;
  account_no: string;
  staggered_install_no: string;
  staggered_date: string;
  staggered_balance: number;
  months_to_pay: number;
  monthly_payment: number;
  modified_by: string;
  modified_date: string;
  user_email: string;
  remarks: string;
  status: string;
  month1: string | null;
  month2: string | null;
  month3: string | null;
  month4: string | null;
  month5: string | null;
  month6: string | null;
  month7: string | null;
  month8: string | null;
  month9: string | null;
  month10: string | null;
  month11: string | null;
  month12: string | null;
  created_at: string;
  updated_at: string;
  billing_account?: {
    id: number;
    account_no: string;
    customer: {
      full_name: string;
      contact_number_primary: string;
      barangay: string;
      city: string;
      desired_plan: string;
      address: string;
      region: string;
    };
    account_balance: number;
  };
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface StaggeredListDetailsProps {
  staggered: StaggeredInstallation;
  onClose: () => void;
  onViewCustomer?: (accountNo: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const StaggeredListDetails: React.FC<StaggeredListDetailsProps> = ({ staggered, onClose, onViewCustomer, onPrevious, onNext }) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  // Overlay states
  const [loadingCustomerOverlay, setLoadingCustomerOverlay] = useState(false);
  const [selectedCustomerForOverlay, setSelectedCustomerForOverlay] = useState<BillingDetailRecord | null>(null);
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null);

  const hasActiveOverlay = selectedCustomerForOverlay || loadingCustomerOverlay;


  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        setCurrentUserEmail(userData.email || '');
      } catch (error) {
        console.error('Failed to parse auth data:', error);
      }
    }
  }, []);

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

  const formatCurrency = (amount: number | string) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return `₱${numAmount.toFixed(2)}`;
  };

  const formatDate = (dateStr?: string | null, includeTime: boolean = false): string => {
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

  const handleApproveStaggered = async () => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Approve Staggered Installation',
      message: 'Are you sure you want to approve this staggered installation? This will deduct the staggered balance from the account and apply it to unpaid invoices.',
      onConfirm: async () => {
        setModal({
          isOpen: true,
          type: 'loading',
          title: 'Approving...',
          message: 'Approving staggered installation...'
        });

        setLoadingPercentage(0);
        const progressInterval = setInterval(() => {
          setLoadingPercentage(prev => {
            if (prev >= 95) return 95;
            return prev + 5;
          });
        }, 200);

        try {
          const result = await staggeredInstallationService.approve(staggered.id);
          clearInterval(progressInterval);

          if (result.success) {
            setLoadingPercentage(100);
            await new Promise(resolve => setTimeout(resolve, 500));
            staggered.status = 'Active';
            setModal({
              isOpen: true,
              type: 'success',
              title: 'Success',
              message: result.message || 'Staggered installation approved successfully',
              onConfirm: () => {
                setModal(prev => ({ ...prev, isOpen: false }));
                onClose();
              }
            });
          } else {
            setModal({
              isOpen: true,
              type: 'error',
              title: 'Error',
              message: result.message || 'Failed to approve staggered installation'
            });
          }
        } catch (err: any) {
          clearInterval(progressInterval);
          setModal({
            isOpen: true,
            type: 'error',
            title: 'Error',
            message: `Failed to approve staggered installation: ${err.message || 'Unknown error'}`
          });
        }
      },
      onCancel: () => setModal(prev => ({ ...prev, isOpen: false }))
    });
  };

  const getAccountDisplayText = () => {
    const accountNo = staggered.billing_account?.account_no || staggered.account_no || '-';
    const fullName = staggered.billing_account?.customer?.full_name || '-';
    const address = staggered.billing_account?.customer?.address || '';
    const barangay = staggered.billing_account?.customer?.barangay || '';
    const city = staggered.billing_account?.customer?.city || '';
    const region = staggered.billing_account?.customer?.region || '';

    const location = [address, barangay, city, region].filter(Boolean).join(', ');
    return `${accountNo} | ${fullName}${location ? ` | ${location}` : ''}`;
  };

  const getMonthPayments = (): Array<{ month: number; invoiceId: string }> => {
    const months: Array<{ month: number; invoiceId: string }> = [];
    for (let i = 1; i <= 12; i++) {
      const monthKey = `month${i}` as keyof StaggeredInstallation;
      const value = staggered[monthKey];
      if (typeof value === 'string' && value) {
        months.push({ month: i, invoiceId: value });
      }
    }
    return months;
  };

  return (
    <>
      {modal.type === 'loading' && modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
          <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <Loader2
              className="w-20 h-20 animate-spin"
              style={{ color: colorPalette?.primary || '#7c3aed' }}
            />
            <div className="text-center">
              <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{loadingPercentage}%</p>
            </div>
          </div>
        </div>
      )}

      <div className={`flex flex-col overflow-hidden border-l relative ${isDarkMode
        ? 'bg-gray-950 border-white border-opacity-30'
        : 'bg-white border-gray-300'
        }`} style={{ width: `${detailsWidth}px`, height: '100%' }}>
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
        <div className={`p-3 flex items-center justify-between border-b ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-gray-100 border-gray-200'
          }`}>
          <div className="flex items-center min-w-0 flex-1">
            <h2 className={`font-medium truncate pr-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{getAccountDisplayText()}</h2>
            {loading && <div className="ml-3 animate-pulse text-orange-500 text-sm flex-shrink-0">Loading...</div>}
          </div>

          <div className="flex items-center space-x-3">
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
            {staggered.status.toLowerCase() === 'pending' &&
              currentUserEmail &&
              staggered.modified_by.toLowerCase() === currentUserEmail.toLowerCase() && (
                <button
                  onClick={handleApproveStaggered}
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
                  <span>{loading ? 'Approving...' : 'Approve'}</span>
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


        <div className="flex-1 overflow-y-auto">
          <div className={`mx-auto py-1 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-white'
            }`}>
            <div className="space-y-1">
              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Staggered ID</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.id}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Install No.</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.staggered_install_no}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Account No.</div>
                <div className="text-red-400 flex-1 font-medium flex items-center">
                  {staggered.billing_account?.account_no || staggered.account_no || '-'}
                  <button
                    onClick={async () => {
                      const accNo = staggered.billing_account?.account_no || staggered.account_no;
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
                    {loadingCustomerOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
                  </button>
                </div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Full Name</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.billing_account?.customer?.full_name || '-'}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Contact No.</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.billing_account?.customer?.contact_number_primary || '-'}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Staggered Balance</div>
                <div className={`flex-1 font-bold text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{formatCurrency(staggered.staggered_balance)}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Monthly Payment</div>
                <div className={`flex-1 font-bold text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{formatCurrency(staggered.monthly_payment)}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Months to Pay</div>
                <div className={isDarkMode ? 'text-white flex-1' : 'text-gray-900 flex-1'}>
                  <span className={`font-bold ${staggered.months_to_pay === 0 ? 'text-green-500' : 'text-orange-400'}`}>
                    {staggered.months_to_pay}
                  </span>
                  <span className={`ml-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                    {staggered.months_to_pay === 0 ? 'Completed' : `${staggered.months_to_pay} month${staggered.months_to_pay !== 1 ? 's' : ''} remaining`}
                  </span>
                </div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Staggered Date</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{formatDate(staggered.staggered_date)}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Modified By</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.modified_by || '-'}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>User Email</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.user_email || '-'}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Remarks</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.remarks || 'No remarks'}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Status</div>
                <div className="flex-1">
                  <div className={`capitalize ${staggered.status.toLowerCase() === 'active' ? 'text-green-500' :
                    staggered.status.toLowerCase() === 'pending' ? 'text-yellow-500' :
                      staggered.status.toLowerCase() === 'completed' ? 'text-blue-500' :
                        'text-gray-400'
                    }`}>
                    {staggered.status}
                  </div>
                </div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Barangay</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.billing_account?.customer?.barangay || '-'}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>City</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.billing_account?.customer?.city || '-'}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Region</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.billing_account?.customer?.region || '-'}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Plan</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{staggered.billing_account?.customer?.desired_plan || '-'}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Account Balance</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{formatCurrency(staggered.billing_account?.account_balance || 0)}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Modified At</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{formatDate(staggered.modified_date, true)}</div>
              </div>

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Updated At</div>
                <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{formatDate(staggered.updated_at, true)}</div>
              </div>
            </div>
          </div>

          <div className={`mx-auto px-4 mt-4 ${isDarkMode ? 'bg-gray-950' : 'bg-white'
            }`}>
            <div className={`pt-4 ${isDarkMode ? 'border-t border-gray-800' : 'border-t border-gray-300'
              }`}>
              <div className="flex items-center mb-4">
                <h3 className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>Monthly Payment History</h3>
                <span className={`ml-2 text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'
                  }`}>
                  {getMonthPayments().length}
                </span>
              </div>
              {getMonthPayments().length > 0 ? (
                <div className="space-y-2">
                  {getMonthPayments().map((payment) => (
                    <div key={payment.month} className={`flex items-center justify-between p-3 rounded ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'
                      }`}>
                      <div className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                        <span className="font-medium">Month {payment.month}</span>
                      </div>
                      <div className={`flex items-center space-x-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                        <span>Invoice ID: {payment.invoiceId}</span>
                        <ExternalLink size={14} className="text-orange-500 cursor-pointer hover:text-orange-400" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  No payment history yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Embedded Overlays */}
        {hasActiveOverlay && (
          <div className={`absolute inset-0 z-50 overflow-hidden flex flex-col h-full w-full ${isDarkMode ? 'bg-gray-950' : 'bg-white'}`}>
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

      {modal.isOpen && modal.type !== 'loading' && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
          <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{modal.title}</h3>
            <p className={`mb-6 whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{modal.message}</p>
            <div className="flex items-center justify-end gap-3">
              {modal.type === 'confirm' ? (
                <>
                  <button
                    onClick={modal.onCancel}
                    className={`px-4 py-2 rounded transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={modal.onConfirm}
                    className="px-4 py-2 text-white rounded transition-colors"
                    style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                    onMouseEnter={(e) => {
                      if (colorPalette?.accent) {
                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                    }}
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    if (modal.onConfirm) {
                      modal.onConfirm();
                    } else {
                      setModal(prev => ({ ...prev, isOpen: false }));
                    }
                  }}
                  className="px-4 py-2 text-white rounded transition-colors"
                  style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                  onMouseEnter={(e) => {
                    if (colorPalette?.accent) {
                      e.currentTarget.style.backgroundColor = colorPalette.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                  }}
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StaggeredListDetails;
