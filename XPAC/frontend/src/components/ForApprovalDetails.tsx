import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import LoadingModal from './common/LoadingModalGlobal';
import ApprovalConfirmationModal from '../modals/ApprovalConfirmationModal';
import { ColorPalette } from '../services/settingsColorPaletteService';
import { PaymentMethod } from '../services/paymentMethodService';
import { ForApprovalTransaction } from '../services/forApprovalService';
import { JobOrder } from '../types/jobOrder';
import { usePermissions } from '../hooks/usePermissions';
import { useTransactionApproval, canApproveTransaction } from '../hooks/useTransactionApproval';
import { useJobOrderApproval, canApproveJobOrder } from '../hooks/useJobOrderApproval';
import { useUserDirectory } from '../hooks/useUserDirectory';
import { resolveUserDisplayName } from '../utils/userDisplay';

/** A row from the For Approval queue, tagged with which list it came from. */
export type ForApprovalRecord =
  | { category: 'transactions'; transaction: ForApprovalTransaction }
  | { category: 'job-orders'; jobOrder: JobOrder };

/** Identity across refreshes, which hand back a fresh object for the same row. */
export const forApprovalRecordKey = (record: ForApprovalRecord): string =>
  record.category === 'transactions'
    ? `transaction:${record.transaction.id}`
    : `job-order:${record.jobOrder.id}`;

/** Placeholder for always-rendered fields that hold no value, as the Job Order pane writes it. */
const NOT_SET = 'Not Set';

/**
 * Backdrop for this panel's confirm and success dialogs.
 *
 * Portalled to document.body above the mobile panel root (`fixed inset-0 z-[9999]`), for the
 * reason TransactionListDetails gives for its own copy: a sibling dialog at the default z-50 is
 * painted behind that root and appears never to open.
 */
const DialogOverlay: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10030]">
      {children}
    </div>,
    document.body
  );

const formatMoney = (amount: number | string | null | undefined): string => {
  const value = typeof amount === 'number' ? amount : parseFloat(String(amount ?? '').replace(/[^0-9.-]/g, ''));
  const safe = Number.isFinite(value) ? value : 0;
  return `₱${safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (value?: string | null, includeTime = false): string => {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);

  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const datePart = `${mm}/${dd}/${date.getFullYear()}`;
  if (!includeTime) return datePart;

  const hours = date.getHours() % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${datePart} ${hours}:${minutes} ${date.getHours() >= 12 ? 'PM' : 'AM'}`;
};

const formatDuration = (start?: string | null, end?: string | null): string => {
  if (!start || !end) return '';
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return '';

  const parts = [];
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
};

/** Billing day 0 means "last day of the month", as the Job Order pane shows it. */
const formatBillingDay = (billingDay?: string | number | null): string => {
  if (billingDay === null || billingDay === undefined || billingDay === '') return '';
  const day = Number(billingDay);
  if (isNaN(day)) return '';
  if (day !== 0) return String(day);
  const now = new Date();
  return String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
};

const statusTone = (status?: string | null): string => {
  switch ((status || '').toLowerCase()) {
    case 'done':
    case 'completed':
      return 'text-green-500';
    case 'pending':
      return 'text-yellow-500';
    case 'processing':
    case 'in progress':
    case 'inprogress':
      return 'text-blue-500';
    case 'failed':
    case 'cancelled':
      return 'text-red-500';
    default:
      return 'text-gray-400';
  }
};

interface ForApprovalDetailsProps {
  record: ForApprovalRecord;
  onClose: () => void;
  /** Called the moment the record is approved, so the list and counts refresh behind the success dialog. */
  onApproved: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  /** Resolves a payment method stored by id on rows migrated from the old database. */
  paymentMethods: PaymentMethod[];
}

/**
 * The For Approval side panel: one transaction or job order, and its Approve button.
 *
 * Approving here is the same act as approving from the Transaction List or the Job Order page:
 * the button is drawn by the same rule (canApproveTransaction / canApproveJobOrder) and runs the
 * same approval (useTransactionApproval / useJobOrderApproval) — same endpoint, same validation,
 * same side effects, same messages. Only the presentation is this panel's own.
 */
const ForApprovalDetails: React.FC<ForApprovalDetailsProps> = ({
  record, onClose, onApproved, onPrevious, onNext, isDarkMode, colorPalette, paymentMethods,
}) => {
  const { can } = usePermissions();
  const { approveTransaction } = useTransactionApproval();
  const { approveJobOrder } = useJobOrderApproval();
  const userDirectory = useUserDirectory();

  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  const [showConfirm, setShowConfirm] = useState(false);
  const [approving, setApproving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // The record approved from this panel. Its Approve button is replaced at once, so it cannot be
  // pressed again while the list behind the success dialog catches up.
  const [approvedKey, setApprovedKey] = useState<string | null>(null);

  const recordKey = forApprovalRecordKey(record);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // A different record is on screen: the previous one's error does not describe it.
  useEffect(() => {
    setError(null);
    setShowConfirm(false);
  }, [recordKey]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = startXRef.current - e.clientX;
      setDetailsWidth(Math.max(600, Math.min(1200, startWidthRef.current + diff)));
    };
    const handleMouseUp = () => setIsResizing(false);

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

  const isApproved = approvedKey === recordKey;
  const canApprove = !isApproved && (
    record.category === 'transactions'
      ? canApproveTransaction(record.transaction.status, can)
      : canApproveJobOrder(record.jobOrder, can)
  );

  const confirmApprove = async () => {
    setShowConfirm(false);
    if (approving) return;

    setApproving(true);
    setProgress(0);
    setError(null);

    try {
      const outcome = record.category === 'transactions'
        ? await approveTransaction(record.transaction.id, setProgress)
        : await approveJobOrder(record.jobOrder, setProgress);

      if (outcome.success) {
        setApprovedKey(recordKey);
        setSuccessMessage(outcome.message);
        onApproved();
      } else {
        setError(outcome.message);
      }
    } finally {
      setApproving(false);
      setProgress(0);
    }
  };

  const fieldRowClass = `flex py-2 min-w-0 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`;
  const labelClass = `w-40 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`;

  const renderField = (label: string, value: React.ReactNode, emphasize = false) => (
    <div className={fieldRowClass}>
      <div className={labelClass}>{label}</div>
      <div className={`flex-1 min-w-0 break-words ${emphasize ? 'font-bold text-lg' : 'text-sm'} ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
        {value === null || value === undefined || value === '' ? '-' : value}
      </div>
    </div>
  );

  const renderStatus = (label: string, status?: string | null) =>
    renderField(label, status ? <span className={`capitalize ${statusTone(status)}`}>{status}</span> : null);

  const renderLink = (label: string, url?: string | null) =>
    url ? (
      <div key={label} className={fieldRowClass}>
        <div className={labelClass}>{label}</div>
        <div className="flex-1 min-w-0">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-orange-500 hover:text-orange-400 hover:underline break-all inline-flex items-start"
            title={`Open ${label.toLowerCase()} in a new tab`}
          >
            <span>{url}</span>
            <ExternalLink size={12} className="ml-1 mt-1 flex-shrink-0" />
          </a>
        </div>
      </div>
    ) : null;

  const renderSection = (title: string, children: React.ReactNode) => (
    <div className="mb-4">
      <div className={`mt-4 mb-1 text-xs font-semibold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );

  const renderTransaction = (transaction: ForApprovalTransaction) => {
    const customer = transaction.account?.customer;
    const location = [customer?.address, customer?.barangay, customer?.city, customer?.region].filter(Boolean).join(', ');
    // Same resolution as the Transaction List pane: the relation, then a method stored by id,
    // then the raw value.
    const paymentMethod =
      transaction.payment_method_info?.payment_method ||
      paymentMethods.find(m => String(m.id) === String(transaction.payment_method))?.payment_method ||
      transaction.payment_method;

    return (
      <>
        {renderSection('Payment', (
          <>
            {renderField('Transaction ID', transaction.id)}
            {renderStatus('Status', transaction.status)}
            {renderField('Transaction Type', transaction.transaction_type)}
            {/* Only on agent-recorded payments, where Received Payment is these two added together. */}
            {transaction.collected_payment != null && renderField('Collected Payment', formatMoney(transaction.collected_payment))}
            {transaction.agent_collected != null && renderField('Agent Collected', formatMoney(transaction.agent_collected))}
            {renderField('Received Payment', formatMoney(transaction.received_payment), true)}
            {renderField('Payment Method', paymentMethod)}
            {renderField('Reference No.', transaction.reference_no)}
            {renderField('OR No.', transaction.or_no)}
            {renderField('Payment Date', formatDate(transaction.payment_date))}
            {renderField('Processed By', resolveUserDisplayName(transaction.processor?.email_address || transaction.processed_by_user, userDirectory))}
            {renderField('Remarks', transaction.remarks || 'No remarks')}
            {renderLink('Payment Proof', transaction.image_url)}
            {renderField('Created At', formatDate(transaction.created_at, true))}
            {renderField('Updated At', formatDate(transaction.updated_at, true))}
          </>
        ))}

        {renderSection('Account', (
          <>
            {renderField('Account No.', <span className="text-red-400 font-medium">{transaction.account?.account_no || transaction.account_no}</span>)}
            {renderField('Full Name', customer?.full_name)}
            {renderField('Contact No.', customer?.contact_number_primary)}
            {renderField('Address', location)}
            {renderField('Plan', customer?.desired_plan)}
            {renderField('Current Balance', formatMoney(transaction.account?.account_balance || 0))}
          </>
        ))}
      </>
    );
  };

  const renderJobOrder = (jobOrder: JobOrder) => {
    const fullName = [
      jobOrder.First_Name,
      jobOrder.Middle_Initial ? `${jobOrder.Middle_Initial}.` : '',
      jobOrder.Last_Name,
    ].filter(Boolean).join(' ').trim();
    const address = [
      jobOrder.Installation_Address || jobOrder.Address,
      jobOrder.Barangay,
      jobOrder.City,
      jobOrder.Region,
    ].filter(Boolean).join(', ');

    // VIP, VAT and withholding read exactly as the Job Order pane writes them.
    const vip = jobOrder.vip_enabled
      ? `Yes${jobOrder.vip_expiration ? ` — expires ${formatDate(jobOrder.vip_expiration)}` : ''}`
      : (jobOrder.vip_enabled === false ? 'No' : NOT_SET);
    const vat = jobOrder.vat_enabled === true || jobOrder.vat_enabled === false
      ? (jobOrder.vat_enabled ? 'VAT Included' : 'No VAT')
      : (jobOrder.vat_type || jobOrder.Vat_Type || NOT_SET);
    const withholding = jobOrder.withholding_enabled
      ? `${jobOrder.withholding_percentage ?? 0}%`
      : (jobOrder.withholding_enabled === false ? 'No' : NOT_SET);

    const items: Array<{ item_name: string; quantity: number }> = jobOrder.job_order_items || [];

    const attachments: Array<[string, string | null | undefined]> = [
      ['Client Signature', jobOrder.client_signature_url],
      ['Setup Image', jobOrder.setup_image_url],
      ['Speedtest Image', jobOrder.speedtest_image_url],
      ['Signed Contract', jobOrder.signed_contract_image_url],
      ['Box Reading', jobOrder.box_reading_image_url],
      ['Router Reading', jobOrder.router_reading_image_url],
      ['Port Label', jobOrder.port_label_image_url],
      ['House Front', jobOrder.house_front_picture_url],
      ['Client Tagging', jobOrder.client_tagging_url],
      ['Proof Image', jobOrder.proof_image_url],
    ];
    const presentAttachments = attachments.filter(([, url]) => !!url);

    return (
      <>
        {renderSection('Job Order', (
          <>
            {renderField('Job Order #', jobOrder.id)}
            {renderField('Timestamp', formatDate(jobOrder.Timestamp || jobOrder.created_at, true))}
            {renderStatus('Onsite Status', jobOrder.Onsite_Status)}
            {renderStatus('Billing Status', jobOrder.billing_status || jobOrder.Billing_Status)}
            {renderField('Status Remarks', jobOrder.Status_Remarks)}
            {renderField('Remarks', jobOrder.onsite_remarks)}
          </>
        ))}

        {renderSection('Customer', (
          <>
            {renderField('Full Name', fullName)}
            {renderField('Contact Number', jobOrder.Mobile_Number)}
            {renderField('Second Contact', jobOrder.Secondary_Mobile_Number)}
            {renderField('Email Address', jobOrder.Email_Address)}
            {renderField('Full Address', address)}
            {renderField('Landmark', jobOrder.installation_landmark)}
            {renderField('Coordinates', jobOrder.address_coordinates)}
            {jobOrder.Referred_By && jobOrder.Referred_By !== 'None' && renderField('Referred By', jobOrder.Referred_By)}
          </>
        ))}

        {renderSection('Plan & Billing', (
          <>
            {renderField('Plan', jobOrder.Desired_Plan)}
            {renderField('Billing Type', jobOrder.generation_type || NOT_SET)}
            {renderField('Billing Day', formatBillingDay(jobOrder.Billing_Day))}
            {renderField('VIP', vip)}
            {renderField('VAT', vat)}
            {renderField('Withholding', withholding)}
            {renderField('Installation Fee', jobOrder.Installation_Fee != null ? formatMoney(jobOrder.Installation_Fee) : null)}
          </>
        ))}

        {renderSection('Installation', (
          <>
            {renderField('Assigned Tech', resolveUserDisplayName(jobOrder.Assigned_Email, userDirectory))}
            {renderField('Visit By', jobOrder.visit_by)}
            {jobOrder.visit_with && jobOrder.visit_with !== 'None' && renderField('Visit With', jobOrder.visit_with)}
            {jobOrder.visit_with_other && jobOrder.visit_with_other !== 'None' && renderField('Visit With Other', jobOrder.visit_with_other)}
            {renderField('Date Installed', formatDate(jobOrder.date_installed))}
            {renderField('Start Time', formatDate(jobOrder.start_time, true))}
            {renderField('End Time', formatDate(jobOrder.end_time, true))}
            {renderField('Duration', formatDuration(jobOrder.start_time, jobOrder.end_time))}
            {renderField('Connection Type', jobOrder.connection_type)}
            {renderField('Router Model', jobOrder.router_model)}
            {renderField('Modem/Router SN', jobOrder.modem_router_sn)}
            {renderField('LCPNAP', jobOrder.lcpnap)}
            {renderField('Port', jobOrder.port)}
            {renderField('VLAN', jobOrder.vlan)}
            {renderField('PPPoE Username', jobOrder.Username || jobOrder.pppoe_username)}
            {renderField('IP Address', jobOrder.ip_address)}
            {renderField('Usage Type', jobOrder.usage_type)}
          </>
        ))}

        {renderSection('Items Used', items.length > 0 ? (
          <div className={`overflow-x-auto rounded border ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <table className={`min-w-full text-sm text-left ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              <thead className={isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'}>
                <tr>
                  <th className={`px-4 py-2 font-medium border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>Item Name</th>
                  <th className={`px-4 py-2 font-medium border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={index}>
                    <td className={`px-4 py-2 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>{item.item_name}</td>
                    <td className={`px-4 py-2 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={`text-sm italic py-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>No items recorded</div>
        ))}

        {renderSection('Attachments', presentAttachments.length > 0
          ? presentAttachments.map(([label, url]) => renderLink(label, url))
          : <div className={`text-sm italic py-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>No attachments</div>
        )}

        {renderSection('Record', (
          <>
            {renderField('Created By', resolveUserDisplayName(jobOrder.Created_By, userDirectory))}
            {renderField('Created At', formatDate(jobOrder.Created_At, true))}
            {renderField('Updated At', formatDate(jobOrder.Updated_At, true))}
          </>
        ))}
      </>
    );
  };

  const kindLabel = record.category === 'transactions' ? 'Transaction' : 'Job Order';
  const title = record.category === 'transactions'
    ? `${record.transaction.account?.account_no || record.transaction.account_no || '-'} | ${record.transaction.account?.customer?.full_name || '-'}`
    : ([record.jobOrder.First_Name, record.jobOrder.Last_Name].filter(Boolean).join(' ').trim() || `Job Order #${record.jobOrder.id}`);

  const navButtonClass = (enabled: boolean) =>
    `p-2 rounded transition-colors ${!enabled ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode
      ? 'text-gray-400 hover:text-white hover:bg-gray-700'
      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'}`;

  return (
    <>
      <LoadingModal
        isOpen={approving}
        type="loading"
        title="Processing Approval"
        message={record.category === 'transactions'
          ? 'Approving transaction...'
          : 'Approving job order and creating customer records...'}
        loadingPercentage={progress}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
      />

      <div
        className={`flex flex-col relative md:border-l overflow-hidden ${isMobile ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]' : 'h-full'} ${isDarkMode
          ? 'bg-gray-950 border-white border-opacity-30'
          : 'bg-white border-gray-300'}`}
        style={{ width: isMobile ? '100%' : `${detailsWidth}px` }}
      >
        {!isMobile && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50"
            style={{ backgroundColor: isResizing ? (colorPalette?.primary || '#7c3aed') : 'transparent' }}
            onMouseEnter={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = colorPalette?.accent || '#7c3aed'; }}
            onMouseLeave={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = 'transparent'; }}
            onMouseDown={handleMouseDownResize}
          />
        )}

        {/* Header */}
        <div className={`p-3 flex items-center justify-between border-b gap-3 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
          <div className="min-w-0 flex-1">
            <div className={`text-[10px] font-semibold uppercase tracking-widest ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {kindLabel}
            </div>
            <h2 className={`font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={title}>{title}</h2>
          </div>

          <div className="flex items-center space-x-2 flex-shrink-0">
            {canApprove && (
              <button
                onClick={() => setShowConfirm(true)}
                disabled={approving}
                className="flex items-center space-x-2 text-white px-3 py-1.5 rounded text-sm transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                style={{ backgroundColor: approving ? '#4b5563' : (colorPalette?.primary || '#22c55e') }}
                onMouseEnter={(e) => { if (!approving && colorPalette?.accent) e.currentTarget.style.backgroundColor = colorPalette.accent; }}
                onMouseLeave={(e) => { if (!approving && colorPalette?.primary) e.currentTarget.style.backgroundColor = colorPalette.primary; }}
              >
                <CheckCircle size={16} />
                <span>{approving ? 'Approving...' : 'Approve'}</span>
              </button>
            )}
            {isApproved && (
              <span className="flex items-center space-x-1 text-green-500 text-sm font-medium px-2">
                <CheckCircle size={16} />
                <span>Approved</span>
              </span>
            )}

            {(onPrevious || onNext) && (
              <div className="flex items-center">
                <button onClick={onPrevious} disabled={!onPrevious} className={navButtonClass(!!onPrevious)} title="Previous Record">
                  <ChevronLeft size={18} />
                </button>
                <button onClick={onNext} disabled={!onNext} className={navButtonClass(!!onNext)} title="Next Record">
                  <ChevronRight size={18} />
                </button>
              </div>
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
          <div className={`border p-3 m-3 rounded text-sm whitespace-pre-line ${isDarkMode
            ? 'bg-red-900 bg-opacity-20 border-red-700 text-red-400'
            : 'bg-red-100 border-red-300 text-red-900'}`}>
            {error}
          </div>
        )}

        {/* Content */}
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-24' : ''}`}>
          <div className={`mx-auto pb-4 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-white'}`}>
            {record.category === 'transactions'
              ? renderTransaction(record.transaction)
              : renderJobOrder(record.jobOrder)}
          </div>
        </div>

        {/* The Job Order page's own confirmation, one-to-one warning included. Inside the panel
            root, as on that page, so it stacks above the mobile panel. */}
        {record.category === 'job-orders' && (
          <ApprovalConfirmationModal
            isOpen={showConfirm}
            onClose={() => setShowConfirm(false)}
            onConfirm={confirmApprove}
            loading={approving}
          />
        )}
      </div>

      {/* The Transaction List pane's own confirmation, word for word. */}
      {record.category === 'transactions' && showConfirm && (
        <DialogOverlay>
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border transform transition-all duration-300 ${isDarkMode
            ? 'bg-gray-800 border-gray-700 shadow-2xl'
            : 'bg-white border-gray-300 shadow-xl'}`}>
            <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Confirm Approval</h3>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Are you sure you want to approve this transaction? This action will update the transaction status and account balance.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowConfirm(false)}
                className={`px-6 py-2.5 rounded font-medium transition-colors ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900'}`}
              >
                Cancel
              </button>
              <button
                onClick={confirmApprove}
                className="text-white px-6 py-2.5 rounded font-medium transition-all active:scale-95"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                onMouseEnter={(e) => { if (colorPalette?.accent) e.currentTarget.style.backgroundColor = colorPalette.accent; }}
                onMouseLeave={(e) => { if (colorPalette?.primary) e.currentTarget.style.backgroundColor = colorPalette.primary; }}
              >
                Confirm Approve
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}

      {successMessage && (
        <DialogOverlay>
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border transform transition-all duration-300 ${isDarkMode
            ? 'bg-gray-800 border-gray-700 shadow-2xl'
            : 'bg-white border-gray-300 shadow-xl'}`}>
            <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Success</h3>
            <p className={`mb-6 whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{successMessage}</p>
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setSuccessMessage(null);
                  onClose();
                }}
                className="text-white px-8 py-2.5 rounded font-medium transition-all active:scale-95"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                onMouseEnter={(e) => { if (colorPalette?.accent) e.currentTarget.style.backgroundColor = colorPalette.accent; }}
                onMouseLeave={(e) => { if (colorPalette?.primary) e.currentTarget.style.backgroundColor = colorPalette.primary; }}
              >
                Done
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}
    </>
  );
};

export default ForApprovalDetails;
