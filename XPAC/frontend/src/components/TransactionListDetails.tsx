import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, ArrowRight, Maximize2, X, Phone, MessageSquare, Info,
  ExternalLink, Mail, Edit, Trash2, Receipt, CheckCircle,
  ChevronDown, ChevronRight, AlertCircle, CircleArrowRight, ChevronLeft, Printer
} from 'lucide-react';
import gowiserLogo from '../assets/gowiserlogo.png';
import { transactionService, TransactionReceipt } from '../services/transactionService';
import { relatedDataService } from '../services/relatedDataService';
import { getCustomerDetail, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import LoadingModal from './common/LoadingModalGlobal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { formUIService } from '../services/formUIService';
import RelatedDataTable from './RelatedDataTable';
import { relatedDataColumns } from '../config/relatedDataColumns';
import { useBillingStore } from '../store/billingStore';
import { API_BASE_URL } from '../config/api';
import TransactionRevertModal from '../modals/TransactionRevertModal';
import TransactionFormModal from '../modals/TransactionFormModal';
import ReceiptPreviewModal from '../modals/ReceiptPreviewModal';
import { ReceiptData } from '../utils/receiptTemplates';
import BillingDetails from './CustomerDetails';
import { BillingDetailRecord } from '../types/billing';
import { accountStatusFrom, sessionStatusFrom } from '../utils/onlineStatus';
import { usePermissions } from '../hooks/usePermissions';

// Company details printed in the Official Receipt header. These are static registration
// details (not stored in settings), so edit them here if the company info ever changes.
const RECEIPT_COMPANY = {
  name: 'XPAC CORPORATION',
  address: 'Sta. Maria, Zamboanga City, Zamboanga del Sur, Zamboanga Peninsula (Region IX)',
  tin: '654-854-244-00000',
  sec: '2023100122771-00',
  bpNo: 'BP-2024-13126-0',
  tel: '09531354666',
  email: 'admin@gowiser.ph',
};

interface Transaction {
  id: string;
  account_no: string;
  transaction_type: string;
  received_payment: number;
  payment_date: string;
  date_processed: string;
  processed_by_user: string;
  payment_method: string;
  reference_no: string;
  or_no: string;
  remarks: string;
  status: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  account_balance_before?: number;
  payment_method_info?: {
    id: number;
    payment_method: string;
  };
  account?: {
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
    billing_status_id?: number | null;
  };
  processor?: {
    email_address: string;
    full_name: string;
  };
  revert_request?: {
    id: number;
    status: string;
  };
  /**
   * Snapshot of the account's state taken at approval time, used by the revert to
   * restore it. One entry per affected table; `table` discriminates the shape.
   */
  updated_column?: Array<{
    table: string;
    account_no?: string;
    old_account_balance?: number;
    old_billing_status_id?: number | null;
    invoice_id?: number;
    invoice_date?: string;
    old_status?: string;
    old_received_payment?: number;
    // table === 'online_status'
    old_session_group?: string | null;
    old_session_status?: string | null;
    // table === 'billing_accounts_prepaid'
    was_prepaid?: boolean;
    old_generation_type?: string | null;
    old_prepaid_expires_at?: string | null;
    old_plan_id?: number | null;
    old_pending_plan_id?: number | null;
    old_pending_plan_effective_at?: string | null;
  }>;
}

/** The prepaid entry of an approval snapshot, if the transaction carries one. */
type PrepaidSnapshot = NonNullable<Transaction['updated_column']>[number];

const findPrepaidSnapshot = (
  updatedColumn: Transaction['updated_column']
): PrepaidSnapshot | null =>
  updatedColumn?.find(entry => entry.table === 'billing_accounts_prepaid') ?? null;

/** "Aug 29, 2026" from a stored 'Y-m-d H:i:s' value. */
const formatSnapshotDate = (raw?: string | null): string => {
  if (!raw) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw).trim());
  if (!m) return String(raw);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime())
    ? String(raw)
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Backdrop for this view's inline confirm/success dialogs.
 *
 * Portalled to document.body and raised above the mobile panel root, which is
 * `fixed inset-0 z-[9999]` in phone view. That establishes a stacking context
 * the sibling dialogs at the default z-50 could not win, so every confirmation
 * was painted behind the panel and appeared not to open at all. Portalling to
 * body puts the dialog outside every app container, the one placement that
 * cannot be trapped by an ancestor's stacking context, overflow or transform —
 * the same fix already applied to TransactionFormModal's overlays.
 */
const DialogOverlay: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10030]">
      {children}
    </div>,
    document.body
  );

interface TransactionListDetailsProps {
  transaction: Transaction;
  onClose: () => void;
  onNavigate?: (section: string, extra?: string) => void;
  onViewCustomer?: (accountNo: string) => void;
  onApprovalSuccess?: () => void;
  paymentMethods?: { id: number, payment_method: string }[];
  onPrevious?: () => void;
  onNext?: () => void;
}

const TransactionListDetails: React.FC<TransactionListDetailsProps> = ({
  transaction, onClose, onNavigate, onViewCustomer, onApprovalSuccess, paymentMethods, onPrevious, onNext
}) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [showRevertRequestModal, setShowRevertRequestModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showFailedConfirmModal, setShowFailedConfirmModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [preparingReceipt, setPreparingReceipt] = useState(false);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  const [loadingCustomerOverlay, setLoadingCustomerOverlay] = useState(false);
  const [selectedCustomerForOverlay, setSelectedCustomerForOverlay] = useState<BillingDetailRecord | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [receiptLogoUrl, setReceiptLogoUrl] = useState<string | null>(null);
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

  // Related invoices state

  const [relatedInvoices, setRelatedInvoices] = useState<any[]>([]);
  const [fullRelatedInvoices, setFullRelatedInvoices] = useState<any[]>([]);
  const [invoicesCount, setInvoicesCount] = useState(0);
  const [expandedModalSection, setExpandedModalSection] = useState<string | null>(null);

  const { can } = usePermissions();

  // One answer for every role, from config/permissions.ts: the seeded role's
  // table (as the web draws it) or a custom role's server-resolved list.
  const hasPermission = (permission: string): boolean => can(permission);

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

  // Receipt logo: use the same DB-configured logo shown in the Header (form_ui.logo_url),
  // served through the image proxy exactly like Header does. Falls back to the bundled
  // asset in handlePrintReceipt() when no logo is configured.
  useEffect(() => {
    const fetchReceiptLogo = async () => {
      try {
        const config = await formUIService.getConfig();
        if (config && config.logo_url) {
          setReceiptLogoUrl(`${API_BASE_URL}/proxy/image?url=${encodeURIComponent(config.logo_url)}`);
        } else {
          setReceiptLogoUrl(null);
        }
      } catch (err) {
        console.error('Failed to fetch receipt logo:', err);
        setReceiptLogoUrl(null);
      }
    };

    fetchReceiptLogo();
  }, []);

  // Fetch related invoices when account number changes
  useEffect(() => {
    const fetchRelatedInvoices = async () => {
      if (!transaction.account_no) {
        return;
      }

      const accountNo = transaction.account_no;

      try {
        const result = await relatedDataService.getRelatedInvoices(accountNo);
        // Store full data for modal view
        setFullRelatedInvoices(result.data || []);
        // Limit to 5 latest items for dropdown display
        setRelatedInvoices((result.data || []).slice(0, 5));
        setInvoicesCount(result.count || 0);
      } catch (error) {
        console.error('Error fetching invoices:', error);
        setRelatedInvoices([]);
        setFullRelatedInvoices([]);
        setInvoicesCount(0);
      }
    };

    fetchRelatedInvoices();
  }, [transaction.account_no]);

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

  const { refreshLatestData } = useBillingStore();

  const handleOpenCustomerOverlay = async () => {
    const accNo = transaction.account?.account_no || transaction.account_no;
    if (!accNo || accNo === '-') return;

    try {
      setLoadingCustomerOverlay(true);
      const details = await getCustomerDetail(accNo);
      if (details) {
        setSelectedCustomerForOverlay(convertCustomerDataToBillingDetail(details));
      } else {
        alert('Customer details not found.');
      }
    } catch (err) {
      console.error('Error finding customer', err);
      alert('Error fetching customer details.');
    } finally {
      setLoadingCustomerOverlay(false);
    }
  };

  const hasActiveOverlay = selectedCustomerForOverlay || loadingCustomerOverlay;

  /**
   * Money as "₱1234.56". Unchanged formatting — only the parsing in front of it is new.
   *
   * Anything that is not a number becomes 0. `received_payment` is NULL on some rows carried
   * over from the old database, and its decimal cast means it can also arrive as a string
   * carrying thousands separators — both used to reach toFixed() as NaN and print the literal
   * "₱NaN" on the slip and in the detail panel.
   */
  const formatCurrency = (amount: number | string | null | undefined) => {
    const numAmount =
      typeof amount === 'number'
        ? amount
        : parseFloat(String(amount ?? '').replace(/[^0-9.-]/g, ''));

    return `₱${(Number.isFinite(numAmount) ? numAmount : 0).toFixed(2)}`;
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

  const handleApproveTransaction = () => {
    setShowConfirmModal(true);
  };

  const handleRevertTransaction = () => {
    setShowRevertModal(true);
  };

  const handleRevertRequest = () => {
    setShowRevertRequestModal(true);
  };

  const handleDeleteTransaction = () => {
    setShowDeleteModal(true);
  };

  const confirmApprove = async () => {
    setShowConfirmModal(false);


    try {
      setLoading(true);
      setLoadingPercentage(0);
      setError(null);

      setLoadingPercentage(20);

      let currentUserEmail = '';
      try {
        const authData = localStorage.getItem('authData');
        if (authData) {
          const parsed = JSON.parse(authData);
          currentUserEmail = parsed.email_address || parsed.email || parsed.user?.email_address || parsed.user?.email || '';
        }
      } catch (err) {
        console.error('Error getting current user email:', err);
      }

      const result = await transactionService.approveTransaction(transaction.id, currentUserEmail);

      setLoadingPercentage(60);

      if (result.success) {
        setLoadingPercentage(100);

        const status = result.data?.status || 'Done';
        transaction.status = status;

        // Auto-refresh customer data
        try {
          await refreshLatestData();
        } catch (refreshErr) {
          console.error('Failed to auto-refresh customer data:', refreshErr);
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        setSuccessMessage(`Transaction approved successfully. Status: ${status}`);
        setShowSuccessModal(true);
        if (onApprovalSuccess) {
          onApprovalSuccess();
        }
      } else {
        setError(result.message || 'Failed to approve transaction');
      }
    } catch (err: any) {
      setError(`Failed to approve transaction: ${err.message}`);
      console.error('Approve transaction error:', err);
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const confirmRevert = async () => {
    setShowRevertModal(false);

    try {
      setLoading(true);
      setLoadingPercentage(0);
      setError(null);

      setLoadingPercentage(20);

      let currentUserEmail = '';
      try {
        const authData = localStorage.getItem('authData');
        if (authData) {
          const parsed = JSON.parse(authData);
          currentUserEmail = parsed.email_address || parsed.email || parsed.user?.email_address || parsed.user?.email || '';
        }
      } catch (err) {
        console.error('Error getting current user email:', err);
      }

      const result = await transactionService.revertTransaction(transaction.id, currentUserEmail);

      setLoadingPercentage(60);

      if (result.success) {
        setLoadingPercentage(100);

        const status = result.data?.status || 'Pending';
        transaction.status = status;

        // Auto-refresh customer data
        try {
          await refreshLatestData();
        } catch (refreshErr) {
          console.error('Failed to auto-refresh customer data:', refreshErr);
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        setSuccessMessage(`Transaction reverted successfully. Status: ${status}`);
        setShowSuccessModal(true);
        if (onApprovalSuccess) {
          onApprovalSuccess(); // Re-use the same callback to refresh lists
        }
      } else {
        setError(result.message || 'Failed to revert transaction');
      }
    } catch (err: any) {
      setError(`Failed to revert transaction: ${err.message}`);
      console.error('Revert transaction error:', err);
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  }; const confirmMarkAsFailed = async () => {
    setShowFailedConfirmModal(false);

    try {
      setLoading(true);
      setError(null);

      const result = await transactionService.updateStatus(transaction.id, 'Failed');

      if (result.success) {
        transaction.status = 'Failed';
        setSuccessMessage('Transaction marked as failed successfully');
        setShowSuccessModal(true);
        if (onApprovalSuccess) {
          onApprovalSuccess();
        }
      } else {
        setError(result.message || 'Failed to update transaction status');
      }
    } catch (err: any) {
      setError(`Failed to mark as failed: ${err.message || err}`);
      console.error('Mark as failed error:', err);
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    setShowDeleteModal(false);

    try {
      setLoading(true);
      setLoadingPercentage(0);
      setError(null);

      const result = await transactionService.deleteTransaction(transaction.id);

      if (result.success) {
        setSuccessMessage('Transaction deleted successfully');
        setShowSuccessModal(true);
        if (onApprovalSuccess) {
          onApprovalSuccess(); // Refresh the parent list
        }
      } else {
        setError(result.message || 'Failed to delete transaction');
      }
    } catch (err: any) {
      setError(`Failed to delete transaction: ${err.message || err}`);
      console.error('Delete transaction error:', err);
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const getAccountDisplayText = () => {
    const accountNo = transaction.account?.account_no || '-';
    const fullName = transaction.account?.customer?.full_name || '-';
    const address = transaction.account?.customer?.address || '';
    const barangay = transaction.account?.customer?.barangay || '';
    const city = transaction.account?.customer?.city || '';
    const region = transaction.account?.customer?.region || '';

    const location = [address, barangay, city, region].filter(Boolean).join(', ');
    return `${accountNo} | ${fullName}${location ? ` | ${location}` : ''}`;
  };

  const renderField = (label: string, value: any, hasInfo: boolean = false, isBold: boolean = false) => (
    <div className={`flex py-2 min-w-0 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
      }`}>
      <div className={`w-40 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
        }`}>{label}</div>
      <div className={`flex-1 flex items-center min-w-0 ${isBold ? 'font-bold text-lg' : ''} ${isDarkMode ? 'text-white' : 'text-gray-900'
        }`}>
        <span className="truncate min-w-0" title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}>
          {value || '-'}
        </span>
        {hasInfo && (
          <button className={`ml-2 flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}>
            <Info size={16} />
          </button>
        )}
      </div>
    </div>
  );

  const handleExpandModalOpen = (sectionKey: string) => {
    setExpandedModalSection(sectionKey);
  };

  const handleExpandModalClose = () => {
    setExpandedModalSection(null);
  };

  /**
   * Statuses that mean the money was never collected, so there is nothing to receipt.
   *
   * Mirrors TransactionReceiptFormatter::UNSETTLED_STATUSES — keep the two in step.
   *
   * An exclusion list rather than a check for 'Done'. The current vocabulary is
   * Pending/Done/Processing/Cancelled/Failed, but rows migrated from the old database also
   * carry 'Approved', 'Completed', 'Paid' and NULL. Gating on 'Done' hid the print button on
   * every one of them, which is exactly the reprint a customer walks in asking for. A blank
   * status counts as settled: it only occurs on migrated history, where the row exists
   * because the payment was taken.
   */
  const UNSETTLED_STATUSES = [
    'pending', 'processing', 'cancelled', 'canceled', 'failed',
    'void', 'voided', 'reverted', 'declined',
  ];

  const isReceiptPrintable = !UNSETTLED_STATUSES.includes(
    (transaction.status || '').trim().toLowerCase()
  );

  /** First value that survives a trim, or undefined when there is none. */
  const firstFilled = (...values: Array<unknown>): string | undefined => {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text !== '') return text;
    }
    return undefined;
  };

  /**
   * Resolve the human-readable payment method the same way the detail field does.
   *
   * The column holds two different things depending on when the row was written: the method
   * NAME on rows written by this system, and the payment_methods row ID on rows migrated from
   * the old database. Both are looked up. A numeric value that matches no known method is
   * dropped rather than printed — "Payment Method: 3" on a receipt is worse than a dash,
   * because it reads as a real value.
   */
  const getPaymentMethodName = (): string => {
    const fromRelation = firstFilled(transaction.payment_method_info?.payment_method);
    if (fromRelation) return fromRelation;

    const raw = firstFilled(transaction.payment_method);
    if (!raw) return '-';

    const matched = paymentMethods?.find(m => String(m.id) === raw || String(m.payment_method) === raw);
    if (matched?.payment_method) return matched.payment_method;

    return /^\d+$/.test(raw) ? '-' : raw;
  };

  /**
   * Assemble the printable receipt payload for this transaction.
   *
   * The markup itself lives in utils/receiptTemplates so the preview, the print
   * output and the PDF export all render from one source instead of the HTML
   * being built inline here (which made a faithful preview impossible).
   *
   * Deliberately carries a disclaimer stating it cannot be used to claim input
   * tax, so it must not be presented as a BIR Official Receipt.
   *
   * `remote` is the backend's resolved projection (see TransactionReceiptFormatter) and wins
   * wherever it has a value, because it can reach data this component cannot: a transaction
   * migrated from the old database often has no hydrated `account` relation — closed accounts
   * and account numbers that picked up padding in the export both break the join — which
   * takes the customer name, contact and address with it. The local derivation stays as the
   * fallback so the slip still prints when that call fails.
   */
  const buildReceiptData = (remote?: TransactionReceipt | null): ReceiptData => {
    const customer = transaction.account?.customer;
    const location = [customer?.address, customer?.barangay, customer?.city, customer?.region]
      .filter(Boolean).join(', ');

    // created_at last: migrated rows routinely carry neither payment date, and a slip reading
    // "No date" is a slip the cashier has to apologise for.
    const paidAt = firstFilled(
      remote?.paid_at,
      transaction.date_processed,
      transaction.payment_date,
      transaction.created_at,
    );

    const timeStr = (() => {
      if (!paidAt) return '-';
      const d = new Date(paidAt);
      if (isNaN(d.getTime())) return '-';
      let h = d.getHours();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
    })();

    const plan = firstFilled(remote?.plan, customer?.desired_plan);
    const planText = plan ? ` (${plan})` : '';

    const amount = remote && Number.isFinite(remote.amount)
      ? remote.amount
      : transaction.received_payment;

    return {
      company: RECEIPT_COMPANY,
      // Prefer the DB-configured logo (same one the Header shows); fall back to the bundled asset.
      logoSrc: receiptLogoUrl || gowiserLogo,
      receiptNo: firstFilled(
        remote?.receipt_no,
        transaction.or_no,
        transaction.reference_no,
        transaction.id,
      ) ?? '-',
      dateStr: paidAt ? formatDate(paidAt) : '-',
      timeStr,
      customerName: firstFilled(remote?.customer_name, customer?.full_name) ?? '-',
      // The transaction's OWN account_no before the relation's: the column is always
      // populated, the relation is what goes missing on migrated rows.
      accountNo: firstFilled(
        remote?.account_no,
        transaction.account_no,
        transaction.account?.account_no,
      ) ?? '-',
      contact: firstFilled(remote?.contact, customer?.contact_number_primary) ?? '-',
      address: firstFilled(remote?.address, location) ?? '',
      description: `${firstFilled(remote?.description, transaction.transaction_type) ?? 'Payment'}${planText}`,
      amount: formatCurrency(amount ?? 0),
      paymentMethod: firstFilled(remote?.payment_method, getPaymentMethodName()) ?? '-',
      referenceNo: firstFilled(remote?.reference_no, transaction.reference_no),
      processedBy: firstFilled(
        remote?.processed_by,
        transaction.processed_by_user,
        transaction.approved_by,
      ),
    };
  };

  /**
   * Opens the preview instead of printing straight away, so the cashier can pick the paper
   * format and check the slip before committing it to a thermal roll.
   *
   * The backend projection is fetched first but never blocks: on any failure the preview
   * opens on the locally derived payload instead. Enrichment that can stop a receipt being
   * printed is worse than no enrichment.
   */
  const handlePrintReceipt = async () => {
    if (preparingReceipt) return;

    setPreparingReceipt(true);

    let remote: TransactionReceipt | null = null;

    try {
      const result = await transactionService.getTransactionReceipt(transaction.id);
      remote = result.data;
    } catch (err) {
      console.error('[TransactionListDetails] Receipt enrichment failed, using local data:', err);
    }

    try {
      setReceiptData(buildReceiptData(remote));
      setShowReceiptPreview(true);
    } finally {
      setPreparingReceipt(false);
    }
  };

  return (
    <>
      <LoadingModal
        isOpen={loading}
        type="loading"
        title="Processing Transaction"
        message="Approving transaction..."
        loadingPercentage={loadingPercentage}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
      />

      <div className={`flex flex-col relative md:border-l overflow-hidden ${isMobile ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]' : 'h-full'
        } ${isDarkMode
          ? 'bg-gray-950 border-white border-opacity-30'
          : 'bg-white border-gray-300'
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
            {hasPermission('transaction-list.approve') && (transaction.status || '').toLowerCase() === 'pending' && (
              <button
                onClick={handleApproveTransaction}
                disabled={loading}
                className="flex items-center space-x-2 text-white px-3 py-1.5 rounded text-sm transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: loading ? '#4b5563' : (colorPalette?.primary || '#22c55e')
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
            {(transaction.status || '').toLowerCase() === 'pending' && (
              <button
                onClick={() => setShowFailedConfirmModal(true)}
                disabled={loading}
                className="flex items-center space-x-2 bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
              >
                <AlertCircle size={16} />
                <span>Mark as Failed</span>
              </button>
            )}
            {hasPermission('transaction-list.revert-request') && (transaction.status || '').toLowerCase() === 'done' && !transaction.revert_request && (
              <button
                onClick={handleRevertRequest}
                disabled={loading}
                className="flex items-center space-x-2 text-white px-3 py-1.5 rounded text-sm transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: loading ? '#4b5563' : (colorPalette?.primary || '#f59e0b')
                }}
                onMouseEnter={(e) => {
                  if (!loading && colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  } else if (!loading) {
                    e.currentTarget.style.backgroundColor = '#d97706';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#f59e0b';
                  }
                }}
              >
                <span>Revert Request</span>
              </button>
            )}
            {(transaction.status || '').toLowerCase() === 'pending' && (
              <button
                onClick={() => setShowEditModal(true)}
                disabled={loading}
                className="p-1.5 rounded text-gray-400 hover:gray-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Edit Transaction"
              >
                <Edit size={16} />
              </button>
            )}
            {(transaction.status || '').toLowerCase() === 'pending' &&
              hasPermission('transaction-list.delete') && (
                <button
                  onClick={handleDeleteTransaction}
                  disabled={loading}
                  className="p-1.5 rounded text-red-500 hover:text-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete Transaction"
                >
                  <Trash2 size={16} />
                </button>
              )}

            {/* Print Official Receipt — for any transaction whose money was collected */}
            {isReceiptPrintable && (
              <button
                onClick={handlePrintReceipt}
                disabled={loading || preparingReceipt}
                className={`p-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                  }`}
                title={preparingReceipt ? 'Preparing receipt…' : 'Print Receipt'}
              >
                <Printer size={16} />
              </button>
            )}

            {/* Navigation Chevrons */}
            {(onPrevious || onNext) && (
              <div className="flex items-center">
                <button
                  onClick={onPrevious}
                  disabled={!onPrevious}
                  className={`p-2 rounded transition-colors ${!onPrevious ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode
                    ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  title="Previous Record"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={onNext}
                  disabled={!onNext}
                  className={`p-2 rounded transition-colors ${!onNext ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode
                    ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  title="Next Record"
                >
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
              {renderField('Transaction ID', transaction.id)}

              <div className={`flex py-2 min-w-0 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Account No.</div>
                <div className="text-red-400 flex-1 font-medium flex items-center min-w-0">
                  <span className="truncate min-w-0" title={transaction.account?.account_no || '-'}>
                    {transaction.account?.account_no || '-'}
                  </span>
                  <button
                    onClick={handleOpenCustomerOverlay}
                    className={`ml-2 p-1 rounded flex-shrink-0 transition-colors ${loadingCustomerOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-800 hover:text-white' : 'hover:bg-gray-200 hover:text-gray-900'} ${hasActiveOverlay ? (colorPalette?.primary ? 'text-[' + colorPalette.primary + ']' : 'text-black dark:text-white') : (isDarkMode ? 'text-gray-400' : 'text-gray-600')}`}
                    title="View Customer Details"
                    disabled={loadingCustomerOverlay}
                  >
                    <CircleArrowRight size={16} />
                  </button>
                </div>
              </div>

              {renderField('Full Name', transaction.account?.customer?.full_name)}
              {renderField('Contact No.', transaction.account?.customer?.contact_number_primary)}
              {renderField('Transaction Type', transaction.transaction_type)}
              {renderField('Received Payment', formatCurrency(transaction.received_payment), false, true)}
              {renderField('Payment Date', formatDate(transaction.payment_date))}
              {renderField('Date Processed', formatDate(transaction.date_processed, true))}
              {renderField('Processed By', transaction.processor?.email_address || transaction.processed_by_user, true)}
              {renderField('Approved By', transaction.approved_by, true)}
              {renderField('Payment Method',
                transaction.payment_method_info?.payment_method ||
                (paymentMethods?.find(m => String(m.id) === String(transaction.payment_method))?.payment_method) ||
                transaction.payment_method,
                true)}
              {renderField('Reference No.', transaction.reference_no)}
              {renderField('OR No.', transaction.or_no)}
              {renderField('Remarks', transaction.remarks || 'No remarks')}

              <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                }`}>
                <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Status</div>
                <div className="flex-1">
                  <div className={`capitalize ${(transaction.status || '').toLowerCase() === 'done' ? 'text-green-500' :
                    (transaction.status || '').toLowerCase() === 'pending' ? 'text-yellow-500' :
                      (transaction.status || '').toLowerCase() === 'processing' ? 'text-blue-500' :
                        (transaction.status || '').toLowerCase() === 'failed' ? 'text-red-500' :
                          'text-gray-400'
                    }`}>
                    {transaction.status || 'Unknown'}
                  </div>
                </div>
              </div>

              {renderField('Barangay', transaction.account?.customer?.barangay, true)}
              {renderField('City', transaction.account?.customer?.city)}
              {renderField('Region', transaction.account?.customer?.region)}
              {renderField('Plan', transaction.account?.customer?.desired_plan, true)}
              {renderField('Balance Before', formatCurrency(transaction.account_balance_before || 0))}
              {renderField('Current Balance', formatCurrency(transaction.account?.account_balance || 0))}

              {transaction.image_url && (
                <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
                  }`}>
                  <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>Payment Proof</div>
                  <div className={isDarkMode ? 'text-white flex-1' : 'text-gray-900 flex-1'}>
                    <div className="mt-2 relative group cursor-pointer" onClick={() => { if (transaction.image_url) window.open(transaction.image_url, '_blank'); }}>
                      <img
                        src={transaction.image_url && transaction.image_url.includes('drive.google.com')
                          ? `${API_BASE_URL}/proxy/image?url=${encodeURIComponent(transaction.image_url)}`
                          : (transaction.image_url || '')}
                        alt="Payment Proof"
                        className="w-full h-auto max-h-48 object-contain rounded border border-gray-700"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div className="mt-1 text-xs text-orange-500 hover:text-orange-400 flex items-center">
                        View Full Image <ExternalLink size={12} className="ml-1" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {renderField('Created At', formatDate(transaction.created_at, true))}
              {renderField('Updated At', formatDate(transaction.updated_at, true))}
            </div>
          </div>

          <div className={`mx-auto px-4 mt-4 ${isDarkMode ? 'bg-gray-950' : 'bg-white'
            }`}>
            <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
              }`}>
              <div className={`w-full px-6 py-4 flex items-center justify-between`}>
                <div className="flex items-center space-x-2">
                  <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>Related Invoices</span>
                  <span className={`text-xs px-2 py-1 rounded ${isDarkMode
                    ? 'bg-gray-600 text-white'
                    : 'bg-gray-300 text-gray-900'
                    }`}>{invoicesCount}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExpandModalOpen('invoices');
                    }}
                    className={`text-sm transition-colors hover:underline ${isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-500'
                      }`}
                  >
                    Expand
                  </button>
                </div>
              </div>


              <div className="px-6 pb-4">
                <RelatedDataTable
                  data={relatedInvoices}
                  columns={relatedDataColumns.invoices}
                  isDarkMode={isDarkMode}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Expanded Modal for Related Data */}
        {expandedModalSection && (
          <div className="absolute inset-0 flex flex-col" style={{ backgroundColor: isDarkMode ? '#111827' : '#ffffff', zIndex: 9999 }}>
            {/* Modal Header */}
            <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
              }`}>
              <div className="flex items-center space-x-3">
                <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                  All Related Invoices
                </h2>
                <span className={`text-xs px-2 py-1 rounded ${isDarkMode
                  ? 'bg-gray-600 text-white'
                  : 'bg-gray-300 text-gray-900'
                  }`}>
                  {invoicesCount} items
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
            <div className="flex-1 overflow-y-auto p-6">
              <RelatedDataTable
                data={fullRelatedInvoices}
                columns={relatedDataColumns.invoices}
                isDarkMode={isDarkMode}
              />
            </div>
          </div>
        )}

        {/* Embedded Overlays */}
        {hasActiveOverlay && (
          <div className="absolute inset-0 z-[100] bg-white dark:bg-gray-900 overflow-hidden flex flex-col h-full w-full">
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
                  <BillingDetails
                    billingRecord={selectedCustomerForOverlay}
                    onClose={() => setSelectedCustomerForOverlay(null)}
                  />
                </div>
              </React.Suspense>
            )}
          </div>
        )}
      </div>

      {showSuccessModal && (
        <DialogOverlay>
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border transform transition-all duration-300 ${isDarkMode
            ? 'bg-gray-800 border-gray-700 shadow-2xl'
            : 'bg-white border-gray-300 shadow-xl'
            }`}>
            <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Success</h3>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>{successMessage}</p>
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  if (onClose) {
                    onClose();
                  }
                }}
                className="text-white px-8 py-2.5 rounded font-medium transition-all active:scale-95"
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
                Done
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}

      {showConfirmModal && (
        <DialogOverlay>
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border transform transition-all duration-300 ${isDarkMode
            ? 'bg-gray-800 border-gray-700 shadow-2xl'
            : 'bg-white border-gray-300 shadow-xl'
            }`}>
            <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Confirm Approval</h3>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>Are you sure you want to approve this transaction? This action will update the transaction status and account balance.</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className={`px-6 py-2.5 rounded font-medium transition-colors ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={confirmApprove}
                className="text-white px-6 py-2.5 rounded font-medium transition-all active:scale-95"
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
                Confirm Approve
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}

      {showRevertModal && (
        <DialogOverlay>
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border transform transition-all duration-300 ${isDarkMode
            ? 'bg-gray-800 border-gray-700 shadow-2xl'
            : 'bg-white border-gray-300 shadow-xl'
            }`}>
            <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Confirm Reversion</h3>
            <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>Are you sure you want to revert this transaction? This will add the payment amount back to the account balance and mark paid invoices as unpaid.</p>

            {/* Prepaid rollback preview.
                Reverting a prepaid payment also takes back the service period and plan the
                payment bought — a materially different outcome from a postpaid revert, and
                one the operator should see BEFORE confirming rather than discover after the
                customer is cut off. Values come from the snapshot captured at approval, so
                this is exactly what the revert will write back. */}
            {(() => {
              const prepaid = findPrepaidSnapshot(transaction.updated_column);
              if (!prepaid?.was_prepaid) return null;

              const rows: Array<[string, string]> = [
                ['Prepaid expiry', formatSnapshotDate(prepaid.old_prepaid_expires_at)],
              ];
              if (prepaid.old_plan_id != null) {
                rows.push(['Plan', `#${prepaid.old_plan_id}`]);
              }
              if (prepaid.old_pending_plan_id != null) {
                rows.push([
                  'Pending plan change',
                  `#${prepaid.old_pending_plan_id}`
                  + (prepaid.old_pending_plan_effective_at
                    ? ` on ${formatSnapshotDate(prepaid.old_pending_plan_effective_at)}`
                    : ''),
                ]);
              }

              return (
                <div className={`mb-6 rounded-lg border p-3 ${isDarkMode
                  ? 'bg-amber-950/30 border-amber-800/60'
                  : 'bg-amber-50 border-amber-300'
                  }`}>
                  <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${isDarkMode ? 'text-amber-300' : 'text-amber-800'
                    }`}>
                    Prepaid customer — service will also roll back
                  </p>
                  <p className={`text-xs mb-2 ${isDarkMode ? 'text-amber-200/80' : 'text-amber-900'}`}>
                    These will be restored to their values from before the payment was approved,
                    which may disconnect the customer:
                  </p>
                  <div className="space-y-1">
                    {rows.map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-3 text-xs">
                        <span className={isDarkMode ? 'text-amber-200/70' : 'text-amber-800'}>{label}</span>
                        <span className={`font-semibold text-right ${isDarkMode ? 'text-amber-100' : 'text-amber-900'}`}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* A transaction approved before prepaid capture existed cannot have its prepaid
                state restored. Say so plainly instead of implying a clean rollback. */}
            {!findPrepaidSnapshot(transaction.updated_column) && (
              <div className={`mb-6 rounded-lg border p-3 text-xs ${isDarkMode
                ? 'bg-gray-900/60 border-gray-700 text-gray-400'
                : 'bg-gray-50 border-gray-300 text-gray-600'
                }`}>
                This transaction was approved before prepaid state was recorded, so its prepaid
                expiry and plan cannot be restored automatically. The balance and invoices will
                still be reverted.
              </div>
            )}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowRevertModal(false)}
                className={`px-6 py-2.5 rounded font-medium transition-colors ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={confirmRevert}
                className="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded font-medium transition-all active:scale-95"
              >
                Confirm Revert
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}

      {showDeleteModal && (
        <DialogOverlay>
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border transform transition-all duration-300 ${isDarkMode
            ? 'bg-gray-800 border-gray-700 shadow-2xl'
            : 'bg-white border-gray-300 shadow-xl'
            }`}>
            <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Confirm Deletion</h3>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>Are you sure you want to delete this transaction? This action cannot be undone. Only pending or reverted transactions can be deleted.</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className={`px-6 py-2.5 rounded font-medium transition-colors ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded font-medium transition-all active:scale-95"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}

      <TransactionRevertModal
        isOpen={showRevertRequestModal}
        onClose={() => setShowRevertRequestModal(false)}
        transactionId={transaction.id}
        onSuccess={() => {
          setShowRevertRequestModal(false);
          if (onApprovalSuccess) onApprovalSuccess();
        }}
      />

      {showFailedConfirmModal && (
        <DialogOverlay>
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 border transform transition-all duration-300 ${isDarkMode
            ? 'bg-gray-800 border-gray-700 shadow-2xl'
            : 'bg-white border-gray-300 shadow-xl'
            }`}>
            <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Confirm Mark as Failed</h3>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>Are you sure you want to mark this transaction as failed? This will update the status and you will not be able to approve it later unless reverted or reset.</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowFailedConfirmModal(false)}
                className={`px-6 py-2.5 rounded font-medium transition-colors ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={confirmMarkAsFailed}
                className="bg-red-500 hover:bg-red-600 text-white px-6 py-2.5 rounded font-medium transition-all active:scale-95"
              >
                Confirm Failed
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}

      {showEditModal && (
        <TransactionFormModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          onSave={() => {
            setShowEditModal(false);
            if (onApprovalSuccess) onApprovalSuccess();
          }}
          billingRecord={{
            applicationId: transaction.account?.account_no || transaction.account_no,
            customerName: transaction.account?.customer?.full_name || '-',
            contactNumber: transaction.account?.customer?.contact_number_primary || '-',
            plan: transaction.account?.customer?.desired_plan || '-',
            accountBalance: transaction.account?.account_balance || 0
          }}
          initialTransactionData={transaction}
        />
      )}

      {/* Opens on the 80mm thermal slip — that is what a cashier prints; the A4
          invoice is the deliberate opt-in for when a customer asks for one. */}
      <ReceiptPreviewModal
        isOpen={showReceiptPreview}
        onClose={() => setShowReceiptPreview(false)}
        data={receiptData}
        isDarkMode={isDarkMode}
        initialFormat="pos80"
      />
    </>
  );
};

export default TransactionListDetails;
