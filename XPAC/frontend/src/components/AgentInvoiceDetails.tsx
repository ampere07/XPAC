import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Loader, DollarSign } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import RelatedDataTable from './RelatedDataTable';
import { AgentInvoiceRecord } from '../services/agentInvoiceService';

/**
 * The detail pane for one agent invoice.
 *
 * Built to the same pattern as InvoiceDetails: a resizable panel that sits
 * alongside the list rather than a modal over it, so a row can be opened, read
 * and stepped through without losing the list behind it. The header, the
 * drag-to-resize edge, the field rows and the collapsible related-data section
 * are all the billing Invoice pane's, so the two read as one screen.
 */

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
};

const peso = (amount?: number | null): string =>
  `₱${Number(amount || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;

/** The columns the referred-customer table shows, in RelatedDataTable's shape. */
const customerColumns = [
  { key: 'customer_name', label: 'Customer' },
  { key: 'referred_by_name', label: 'Referred By' },
  { key: 'installed_date', label: 'Installed', render: (v: any) => formatDate(v) },
  { key: 'unit_price', label: 'Unit Price', render: (v: any) => peso(v) },
  { key: 'quantity', label: 'Qty' },
  { key: 'total', label: 'Total', render: (v: any) => peso(v) },
];

interface AgentInvoiceDetailsProps {
  invoiceRecord: AgentInvoiceRecord;
  /** True while the full record (with its customers) is still being fetched. */
  isLoading?: boolean;
  /** True while a PDF is being produced for this invoice. */
  isPdfPending?: boolean;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onViewPdf?: () => void;
  onDownloadPdf?: () => void;
  /** Opens the payout modal for this invoice. Hidden when not provided. */
  onPayOut?: () => void;
}

const AgentInvoiceDetails: React.FC<AgentInvoiceDetailsProps> = ({
  invoiceRecord,
  isLoading = false,
  isPdfPending = false,
  onClose,
  onPrevious,
  onNext,
  onViewPdf,
  onDownloadPdf,
  onPayOut,
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(localStorage.getItem('theme') !== 'light');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  const [expandedCustomers, setExpandedCustomers] = useState(true);
  const [expandedModal, setExpandedModal] = useState(false);

  // Same resize behaviour as the billing Invoice pane: drag the left edge.
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(600);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') !== 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => { /* falls back below */ });
  }, []);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = detailsWidth;
  };

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: MouseEvent) => {
      // Dragging left widens the pane, so the delta is inverted.
      const next = startWidthRef.current + (startXRef.current - e.clientX);
      setDetailsWidth(Math.min(Math.max(next, 420), 1100));
    };
    const onUp = () => setIsResizing(false);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isResizing]);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const customers = invoiceRecord.customers || [];

  /** One label/value line, the same row the billing Invoice pane uses. */
  const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex justify-between items-center py-2">
      <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>{label}</span>
      <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{children}</span>
    </div>
  );

  return (
    <div
      className={`flex flex-col relative md:border-l overflow-hidden ${
        isMobile ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]' : 'h-full'
      } ${isDarkMode ? 'bg-gray-900 text-white border-white border-opacity-30' : 'bg-white text-gray-900 border-gray-300'}`}
      style={{ width: isMobile ? '100%' : `${detailsWidth}px` }}
    >
      {!isMobile && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50"
          style={{ backgroundColor: isResizing ? primaryColor : 'transparent' }}
          onMouseEnter={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = colorPalette?.accent || primaryColor; }}
          onMouseLeave={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = 'transparent'; }}
          onMouseDown={handleMouseDownResize}
        />
      )}

      {/* Header with invoice number and actions */}
      <div className={`px-4 py-3 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
        <span className="font-medium truncate">{invoiceRecord.invoice_number}</span>

        <div className="flex items-center space-x-2 flex-shrink-0">
          <div className="flex items-center overflow-hidden mr-1">
            <button
              onClick={(e) => { e.stopPropagation(); onPrevious?.(); }}
              disabled={!onPrevious}
              className={`p-2 transition-colors ${!onPrevious
                ? (isDarkMode ? 'text-gray-600 bg-gray-800' : 'text-gray-300 bg-gray-50')
                : (isDarkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900')}`}
              title="Previous Record"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onNext?.(); }}
              disabled={!onNext}
              className={`p-2 transition-colors ${!onNext
                ? (isDarkMode ? 'text-gray-600 bg-gray-800' : 'text-gray-300 bg-gray-50')
                : (isDarkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900')}`}
              title="Next Record"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'}`}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-24' : ''}`}>
        <div className="px-5 py-4">
          <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            <Row label="Invoice No.">{invoiceRecord.invoice_number}</Row>
            <Row label="Type">{invoiceRecord.invoice_type === 'team' ? 'Team' : 'Solo'}</Row>
            <Row label="Team / Agent">{invoiceRecord.billed_to}</Row>
            <Row label="Invoice Date">{formatDate(invoiceRecord.invoice_date)}</Row>
            <Row label="Billing Period">
              {formatDate(invoiceRecord.period_start)} – {formatDate(invoiceRecord.period_end)}
            </Row>
            <Row label="Total Clients Installed">{invoiceRecord.total_customers}</Row>
            <Row label="Unit Price">{peso(invoiceRecord.unit_price)}</Row>
            <Row label="Installation Fee">{peso(invoiceRecord.installation_fee)}</Row>
            <Row label="Total Amount">{peso(invoiceRecord.total_amount)}</Row>
            <Row label="Commission">{peso(invoiceRecord.commission)}</Row>
            <Row label="Subtotal">
              <span className="font-semibold">{peso(invoiceRecord.subtotal)}</span>
            </Row>
            <Row label="Status">
              <span className={
                invoiceRecord.status === 'Paid' ? 'text-green-500'
                  : invoiceRecord.status === 'Cancelled' ? 'text-red-500'
                    : invoiceRecord.status === 'Sent' ? 'text-orange-500'
                      : isDarkMode ? 'text-white' : 'text-gray-900'
              }>
                {invoiceRecord.status || 'Generated'}
              </span>
            </Row>
          </div>
        </div>
      </div>

      {/* Referred customers — the pane's related-data section */}
      <div className={`mt-auto border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button
            onClick={() => setExpandedCustomers(v => !v)}
            className={`w-full px-5 py-3 flex items-center justify-between ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
          >
            <div className="flex items-center space-x-2">
              <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Referred Customers</span>
              <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>
                {customers.length}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); setExpandedModal(true); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setExpandedModal(true); } }}
                className={`text-sm transition-colors hover:underline ${isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-500'}`}
              >
                Expand
              </span>
              <ChevronDown
                size={20}
                className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'} transition-transform ${expandedCustomers ? '' : '-rotate-90'}`}
              />
            </div>
          </button>

          {expandedCustomers && (
            <div className="px-5 pb-4 max-h-64 overflow-y-auto">
              {isLoading ? (
                <div className="py-8 flex justify-center">
                  <Loader className="h-5 w-5 animate-spin" style={{ color: primaryColor }} />
                </div>
              ) : (
                <RelatedDataTable data={customers} columns={customerColumns} isDarkMode={isDarkMode} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className={`px-5 py-3 border-t flex items-center justify-end gap-2 flex-shrink-0 ${isDarkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
        {/* Records that this invoice was settled. The payout form opens with
            the invoice number already in as its reference. */}
        {onPayOut && (
          <button
            onClick={onPayOut}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors flex items-center gap-2 mr-auto ${isDarkMode ? 'border-gray-700 text-gray-200 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            <DollarSign className="h-4 w-4" /> Pay Out
          </button>
        )}
        <button
          onClick={onViewPdf}
          disabled={isPdfPending}
          className={`px-3 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50 flex items-center gap-2 ${isDarkMode ? 'border-gray-700 text-gray-200 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
        >
          {isPdfPending ? <Loader className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} View PDF
        </button>
        <button
          onClick={onDownloadPdf}
          disabled={isPdfPending}
          className="px-3 py-2 rounded-lg text-sm text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
          style={{ backgroundColor: primaryColor }}
        >
          <Download className="h-4 w-4" /> Download
        </button>
      </div>

      {/* Expanded view of the customer list, matching the billing pane's */}
      {expandedModal && (
        <div className="absolute inset-0 flex flex-col" style={{ backgroundColor: isDarkMode ? '#111827' : '#ffffff', zIndex: 9999 }}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
            <div className="flex items-center space-x-3">
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                All Referred Customers
              </h2>
              <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>
                {customers.length} items
              </span>
            </div>
            <button
              onClick={() => setExpandedModal(false)}
              className={`p-2 rounded transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'}`}
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <RelatedDataTable data={customers} columns={customerColumns} isDarkMode={isDarkMode} fullContent />
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentInvoiceDetails;
