import React, { useState, useEffect, useRef } from 'react';
import { ExternalLink, X, Info, CircleArrowRight, Loader, ChevronLeft, ChevronRight } from 'lucide-react';
import { planService, Plan } from '../services/planService';
import { getCustomerDetail, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { BillingDetailRecord } from '../types/billing';
import apiClient from '../config/api';

import { useSOAStore } from '../store/soaStore';
const PlanListDetails = React.lazy(() => import('./PlanListDetails'));
const CustomerDetails = React.lazy(() => import('./CustomerDetails'));
const NotFoundModal = React.lazy(() => import('../modals/NotFoundModal'));

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch (e) {
    return dateString;
  }
};

const isGoogleDriveLink = (url: string | null | undefined): boolean => {
  if (!url) return false;
  return url.includes('drive.google.com') || url.includes('docs.google.com');
};

interface SOARecord {
  id: string;
  statementDate: string;
  accountNo: string;
  dateInstalled: string;
  fullName: string;
  contactNumber: string;
  emailAddress: string;
  address: string;
  plan: string;
  provider?: string;
  balanceFromPreviousBill?: number;
  statementNo?: string;
  paymentReceived?: number;
  remainingBalance?: number;
  monthlyServiceFee?: number;
  serviceCharge?: number;
  rebate?: number;
  discounts?: number;
  staggered?: number;
  vat?: number;
  dueDate?: string;
  amountDue?: number;
  totalAmountDue?: number;
  deliveryStatus?: string;
  deliveryDate?: string;
  deliveredBy?: string;
  deliveryRemarks?: string;
  deliveryProof?: string;
  modifiedBy?: string;
  modifiedDate?: string;
  printLink?: string;
  barangay?: string;
  city?: string;
  region?: string;
}

interface SOADetailsProps {
  soaRecord: SOARecord;
  onViewCustomer?: (accountNo: string) => void;
  onClose?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const SOADetails: React.FC<SOADetailsProps> = ({ soaRecord, onViewCustomer, onClose, onPrevious, onNext }) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
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
  const [loadingPlanOverlay, setLoadingPlanOverlay] = useState(false);
  const [selectedPlanForOverlay, setSelectedPlanForOverlay] = useState<Plan | null>(null);

  const [loadingCustomerOverlay, setLoadingCustomerOverlay] = useState(false);
  const [selectedCustomerForOverlay, setSelectedCustomerForOverlay] = useState<BillingDetailRecord | null>(null);
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null);

  // PDF generation states
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [currentPrintLink, setCurrentPrintLink] = useState<string | undefined>(soaRecord.printLink);
  const { refreshSingleRecord } = useSOAStore();

  useEffect(() => {
    setCurrentPrintLink(soaRecord.printLink);
    setPdfError(null);
    setSelectedPlanForOverlay(null);
    setSelectedCustomerForOverlay(null);
    setNotFoundMessage(null);
  }, [soaRecord.id, soaRecord.printLink]);

  const hasActiveOverlay = selectedPlanForOverlay || selectedCustomerForOverlay || loadingPlanOverlay || loadingCustomerOverlay;

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
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

  const handleOpenGDrive = async () => {
    const linkToCheck = currentPrintLink || soaRecord.printLink;

    // If already a Google Drive link, just open it
    if (isGoogleDriveLink(linkToCheck)) {
      window.open(linkToCheck, '_blank', 'noopener,noreferrer');
      return;
    }

    // Otherwise, generate a new PDF
    try {
      setIsGeneratingPdf(true);
      setPdfError(null);

      const response = await apiClient.post<{ success: boolean; print_link?: string; message?: string; error?: string }>(
        `/soa/${soaRecord.id}/generate-pdf`
      );

      if (response.data.success && response.data.print_link) {
        setCurrentPrintLink(response.data.print_link);
        setIsGeneratingPdf(false);
        // Silently refresh the record in the store to update the list view
        try {
          await refreshSingleRecord(soaRecord.id);
        } catch (refreshErr) {
          console.error('Failed to refresh single record after PDF generation:', refreshErr);
        }
        // Open the newly generated PDF in a new tab
        window.open(response.data.print_link, '_blank', 'noopener,noreferrer');
      } else {
        setIsGeneratingPdf(false);
        setPdfError(response.data.message || 'Failed to generate PDF');
      }
    } catch (err: any) {
      console.error('Error generating SOA PDF:', err);
      setIsGeneratingPdf(false);
      setPdfError(err?.response?.data?.message || err?.message || 'Failed to generate PDF. Please try again.');
    }
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
      )}
      <div className={`px-4 py-3 flex items-center justify-between border-b ${isDarkMode
        ? 'bg-gray-800 border-gray-700'
        : 'bg-gray-100 border-gray-200'
        }`}>
        <h1 className={`text-lg font-semibold truncate pr-4 min-w-0 flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>
          {soaRecord.accountNo} | {soaRecord.fullName} | {soaRecord.address ? soaRecord.address.split(',')[0] : 'N/A'}
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
          <button
            onClick={handleOpenGDrive}
            disabled={isGeneratingPdf}
            className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            title={isGoogleDriveLink(currentPrintLink || soaRecord.printLink) ? 'Open SOA in Google Drive' : 'Generate SOA PDF & Open in Google Drive'}
          >
            {isGeneratingPdf ? <Loader size={18} className="animate-spin" /> : <ExternalLink size={18} />}
          </button>
          <button
            onClick={onClose}
            className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
              }`}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-24' : ''}`}>
        <div className={isDarkMode ? 'divide-y divide-gray-800' : 'divide-y divide-gray-300'}>
          <div className="px-5 py-4">
            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Statement No.</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{soaRecord.statementNo || soaRecord.id}</span>
            </div>

            <div className="flex justify-between items-center py-2 gap-4">
              <span className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Full Name</span>
              <span className={`text-right truncate max-w-[60%] ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={soaRecord.fullName}>{soaRecord.fullName}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Statement Date</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{formatDate(soaRecord.statementDate)}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Account No.</span>
              <div className="flex items-center gap-2">
                <span className="text-red-500">
                  {soaRecord.accountNo}
                </span>
                <button
                  onClick={async () => {
                    try {
                      setLoadingCustomerOverlay(true);
                      const details = await getCustomerDetail(soaRecord.accountNo);
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
                  className={`p-1 rounded transition-colors ${loadingCustomerOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                  title="View Customer Details"
                  disabled={loadingCustomerOverlay}
                >
                  {loadingCustomerOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Date Installed</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{formatDate(soaRecord.dateInstalled)}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Contact Number</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{soaRecord.contactNumber}</span>
            </div>

            <div className="flex justify-between items-center py-2 gap-4">
              <span className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Email Address</span>
              <span className={`text-right truncate max-w-[60%] ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={soaRecord.emailAddress}>{soaRecord.emailAddress}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Plan</span>
              <div className="flex items-center gap-2">
                <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{soaRecord.plan}</span>
                <button
                  onClick={async () => {
                    if (!soaRecord.plan || soaRecord.plan === '-') return;
                    try {
                      setLoadingPlanOverlay(true);
                      const allPlans = (await planService.getAllPlans()) || [];
                      const match = allPlans.find((p: Plan) =>
                        p.name.toLowerCase() === soaRecord.plan.toLowerCase() ||
                        p.name.toLowerCase().includes(soaRecord.plan.toLowerCase()) ||
                        soaRecord.plan.toLowerCase().includes(p.name.toLowerCase())
                      );
                      if (match) {
                        setSelectedPlanForOverlay(match);
                      } else {
                        setNotFoundMessage('Plan details not found.');
                      }
                    } catch (err) {
                      console.error('Error finding plan', err);
                    } finally {
                      setLoadingPlanOverlay(false);
                    }
                  }}
                  className={`p-1 rounded transition-colors ${loadingPlanOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                  title="View Plan Details"
                  disabled={loadingPlanOverlay || !soaRecord.plan || soaRecord.plan === '-'}
                >
                  {loadingPlanOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Balance from Previous Bill</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.balanceFromPreviousBill || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Payment Received from Previous Bill</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{soaRecord.paymentReceived || '0'}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Remaining Balance from Previous Bill</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.remainingBalance || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Monthly Service Fee</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.monthlyServiceFee || 624.11).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Service Charge</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.serviceCharge || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Rebate</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.rebate || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Discounts</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.discounts || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Staggered</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.staggered || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>VAT</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.vat || 74.89).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>DUE DATE</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{formatDate(soaRecord.dueDate)}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>AMOUNT DUE</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.amountDue || 699.00).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>TOTAL AMOUNT DUE</span>
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>
                ₱{Number(soaRecord.totalAmountDue || 699.00).toFixed(2)}
              </span>
            </div>

            {soaRecord.deliveryStatus && (
              <div className="flex justify-between items-center py-2">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Delivery Status</span>
                <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{soaRecord.deliveryStatus}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Embedded Overlays */}
      {hasActiveOverlay && (
        <div className="absolute inset-0 z-50 bg-white dark:bg-gray-900 overflow-hidden flex flex-col h-full w-full">
          {loadingPlanOverlay && (
            <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
              <div className="flex flex-col items-center gap-3">
                <p className="loading-dots pt-4">Loading Plan Details</p>
              </div>
            </div>
          )}
          {loadingCustomerOverlay && (
            <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
              <div className="flex flex-col items-center gap-3">
                <p className="loading-dots pt-4">Loading Customer Details</p>
              </div>
            </div>
          )}
          {selectedPlanForOverlay && (
            <React.Suspense fallback={
              <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
                <div className="flex flex-col items-center gap-3">
                  <p className="loading-dots pt-4">Loading Plan Overlay</p>
                </div>
              </div>
            }>
              <div className="w-full h-full relative border-0">
                <PlanListDetails
                  plan={selectedPlanForOverlay}
                  onClose={() => setSelectedPlanForOverlay(null)}
                  isMobile={isMobile}
                />
              </div>
            </React.Suspense>
          )}
          {selectedCustomerForOverlay && (
            <React.Suspense fallback={
              <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
                <div className="flex flex-col items-center gap-3">
                  <p className="loading-dots pt-4">Loading Customer Overlay</p>
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

      {/* PDF Generation Loading Modal */}
      {isGeneratingPdf && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50">
          <div className={`rounded-xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
            }`}>
            <div className="flex justify-center mb-4">
              <Loader className="w-10 h-10 animate-spin" style={{ color: colorPalette?.primary || '#7c3aed' }} />
            </div>
            <h3 className="text-lg font-semibold mb-2">Generating PDF</h3>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Creating SOA PDF and uploading to Google Drive...
            </p>
            <p className={`text-xs mt-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              This may take a few moments
            </p>
          </div>
        </div>
      )}

      {/* PDF Error Modal */}
      {pdfError && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50">
          <div className={`rounded-xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
            }`}>
            <div className="flex justify-center mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <X className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <h3 className="text-lg font-semibold mb-2">PDF Generation Failed</h3>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {pdfError}
            </p>
            <button
              onClick={() => setPdfError(null)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
            >
              Close
            </button>
          </div>
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

export default SOADetails;
