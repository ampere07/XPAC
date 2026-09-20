import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  X,
  Info,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  XCircle,
  RotateCcw,
  Edit3,
  Trash2,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { transactionService } from '../services/transactionService';
import TransactionFormModal from '../modals/TransactionFormModal';
import TransactionRevertModal from '../modals/TransactionRevertModal';
import { usePermissions } from '../hooks/usePermissions';
import { relatedDataService } from '../services/relatedDataService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from './common/LoadingModalGlobal';

interface Transaction {
  id: string;
  account_no: string;
  transaction_type: string;
  received_payment: number;
  payment_date: string;
  date_processed: string;
  processed_by_user: string;
  payment_method: string | number | null;
  reference_no: string;
  or_no: string;
  remarks: string;
  status: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  account?: {
    id: number;
    account_no: string;
    customer?: {
      full_name?: string;
      contact_number_primary?: string;
      barangay?: string;
      city?: string;
      desired_plan?: string;
      address?: string;
      region?: string;
    };
    account_balance?: number;
  };
  payment_method_info?: { payment_method: string };
  processor?: { email_address?: string };
  /** Set once a revert request exists for this transaction; blocks filing a second. */
  revert_request?: unknown;
}

interface TransactionListDetailsProps {
  transaction: Transaction;
  onClose: () => void;
  onNavigate?: (section: string, extra?: string) => void;
  onViewCustomer?: (accountNo: string) => void;
  onApprovalSuccess?: () => void;
  paymentMethods?: Array<{ id: number | string; payment_method: string }>;
  onPrevious?: () => void;
  onNext?: () => void;
}

const isDarkMode = false;

const TransactionListDetails: React.FC<TransactionListDetailsProps> = ({
  transaction,
  onClose,
  onNavigate,
  onViewCustomer,
  onApprovalSuccess,
  paymentMethods = [],
  onPrevious,
  onNext,
}) => {
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [showRevertRequestModal, setShowRevertRequestModal] = useState(false);
  const { can } = usePermissions();
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [expandedInvoices, setExpandedInvoices] = useState(false);
  const [relatedInvoices, setRelatedInvoices] = useState<any[]>([]);
  const [invoicesCount, setInvoicesCount] = useState(0);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  const accountNo = transaction.account?.account_no || transaction.account_no || '';

  useEffect(() => {
    if (!accountNo) return;
    relatedDataService.getRelatedInvoices(accountNo)
      .then((result) => {
        setRelatedInvoices((result.data || []).slice(0, 5));
        setInvoicesCount(result.count || 0);
      })
      .catch(() => {
        setRelatedInvoices([]);
        setInvoicesCount(0);
      });
  }, [accountNo]);

  const primary = colorPalette?.primary || '#7c3aed';

  const formatCurrency = (amount: number | string | null | undefined): string => {
    if (amount === null || amount === undefined || amount === '') return '₱0.00';
    const n = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(n)) return '₱0.00';
    return `₱${n.toFixed(2)}`;
  };

  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return 'No date';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      let hours = date.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      const min = String(date.getMinutes()).padStart(2, '0');
      const sec = String(date.getSeconds()).padStart(2, '0');
      return `${mm}/${dd}/${yyyy} ${hours}:${min}:${sec} ${ampm}`;
    } catch {
      return dateStr;
    }
  };

  const getPaymentMethodName = (): string => {
    if (transaction.payment_method_info?.payment_method) {
      return transaction.payment_method_info.payment_method;
    }
    if (!transaction.payment_method) return '-';
    const pm = paymentMethods.find(m => String(m.id) === String(transaction.payment_method));
    return pm ? pm.payment_method : String(transaction.payment_method);
  };

  /** The email the API records against approve/revert, same lookup as the web build. */
  const getCurrentUserEmail = async (): Promise<string> => {
    try {
      const authData = await AsyncStorage.getItem('authData');
      if (!authData) return '';
      const parsed = JSON.parse(authData);
      return parsed.email_address || parsed.email || parsed.user?.email_address || parsed.user?.email || '';
    } catch (err) {
      console.error('Error getting current user email:', err);
      return '';
    }
  };

  const [showEditModal, setShowEditModal] = useState(false);

  const handleApprove = () => {
    Alert.alert(
      'Confirm Approval',
      'Are you sure you want to approve this transaction?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              setLoading(true);
              setLoadingPercentage(30);
              const result = await transactionService.approveTransaction(transaction.id, await getCurrentUserEmail());
              setLoadingPercentage(80);
              if (result.success) {
                setLoadingPercentage(100);
                setTimeout(() => {
                  setLoading(false);
                  Alert.alert('Success', `Transaction approved. Status: ${result.data?.status || 'Done'}`);
                  onApprovalSuccess?.();
                }, 400);
              } else {
                setLoading(false);
                Alert.alert('Error', result.message || 'Failed to approve transaction');
              }
            } catch (err: any) {
              setLoading(false);
              Alert.alert('Error', `Failed to approve: ${err.message}`);
            }
          },
        },
      ]
    );
  };

  const handleMarkAsFailed = () => {
    Alert.alert(
      'Mark as Failed',
      'Are you sure you want to mark this transaction as failed? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark as Failed',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              setLoadingPercentage(40);
              const result = await transactionService.updateStatus(transaction.id, 'Failed');
              setLoadingPercentage(100);
              setLoading(false);
              if (result.success !== false) {
                Alert.alert('Success', 'Transaction marked as failed');
                onApprovalSuccess?.();
              } else {
                Alert.alert('Error', result.message || 'Failed to update transaction status');
              }
            } catch (err: any) {
              setLoading(false);
              Alert.alert('Error', `Failed to update status: ${err.message || err}`);
            }
          },
        },
      ]
    );
  };

  /**
   * Opens the revert request form.
   *
   * This used to call transactionService.revertTransaction() straight away, which
   * reversed the payment on the spot and skipped the approval workflow the Revert
   * Requests screen exists to serve. The web build routes the same button through
   * this form — it files a request at status 'pending' for someone else to approve
   * — and its direct-revert path is dead code, so the two now behave the same way.
   */
  const handleRevertRequest = () => {
    setShowRevertRequestModal(true);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Transaction',
      'Are you sure you want to delete this transaction? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              setLoadingPercentage(40);
              const result = await transactionService.deleteTransaction(transaction.id);
              setLoadingPercentage(100);
              setLoading(false);
              if ((result as any)?.success !== false) {
                Alert.alert('Success', 'Transaction deleted successfully');
                onApprovalSuccess?.();
                onClose();
              } else {
                Alert.alert('Error', (result as any)?.message || 'Failed to delete transaction');
              }
            } catch (err: any) {
              setLoading(false);
              Alert.alert('Error', `Failed to delete: ${err.message || err}`);
            }
          },
        },
      ]
    );
  };

  const statusLower = (transaction.status || '').toLowerCase();
  const statusColor =
    statusLower === 'done' || statusLower === 'completed' ? '#22c55e' :
    statusLower === 'pending' ? '#eab308' :
    statusLower === 'processing' ? '#3b82f6' :
    statusLower === 'failed' || statusLower === 'cancelled' ? '#ef4444' :
    '#6b7280';

  const renderField = (label: string, value: string | React.ReactNode, bold = false) => (
    <View
      style={{
        flexDirection: 'row',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        alignItems: 'flex-start',
      }}
    >
      <Text style={{ width: 140, fontSize: 13, color: '#6b7280', flexShrink: 0 }}>{label}</Text>
      {typeof value === 'string' ? (
        <Text style={{ flex: 1, fontSize: 13, color: '#111827', fontWeight: bold ? '700' : '400' }}>
          {value || '-'}
        </Text>
      ) : (
        <View style={{ flex: 1 }}>{value}</View>
      )}
    </View>
  );

  // Header icons live here instead, as circle-and-label actions like ApplicationDetails.
  // Availability mirrors the web screen: approve/fail only while pending, revert once done.
  const quickActions: {
    key: string;
    label: string;
    Icon: any;
    onPress: () => void;
    tone?: 'danger';
  }[] = [
    ...(onPrevious ? [{ key: 'prev', label: 'Previous', Icon: ChevronLeft, onPress: onPrevious }] : []),
    ...(onNext ? [{ key: 'next', label: 'Next', Icon: ChevronRight, onPress: onNext }] : []),
    ...(statusLower === 'pending'
      ? [
          { key: 'approve', label: 'Approve', Icon: CheckCircle, onPress: handleApprove },
          { key: 'failed', label: 'Mark Failed', Icon: XCircle, onPress: handleMarkAsFailed, tone: 'danger' as const },
        ]
      : []),
    // Same three conditions as the web: the permission key, a completed
    // transaction, and no request already filed against it.
    ...((statusLower === 'done' || statusLower === 'completed')
      && can('transaction-list.revert-request')
      && !transaction.revert_request
      ? [{ key: 'revert', label: 'Revert Request', Icon: RotateCcw, onPress: handleRevertRequest, tone: 'danger' as const }]
      : []),
    { key: 'edit', label: 'Edit', Icon: Edit3, onPress: () => setShowEditModal(true) },
    { key: 'delete', label: 'Delete', Icon: Trash2, onPress: handleDelete, tone: 'danger' as const },
  ];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
        {/* Header — back arrow, centred name, same shape as ApplicationDetails */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 12,
            paddingTop: 60,
            backgroundColor: '#ffffff',
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, position: 'relative' }}>
            <TouchableOpacity onPress={onClose} style={{ position: 'absolute', left: 0, zIndex: 10 }}>
              <ChevronLeft size={28} color="#4b5563" />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 }}>
              <Text
                style={{ fontSize: 20, fontWeight: '500', color: '#111827', textAlign: 'center' }}
                numberOfLines={1}
              >
                {transaction.account?.customer?.full_name || accountNo || '-'}
              </Text>
            </View>
          </View>
          {loading && <ActivityIndicator size="small" color={primary} />}
        </View>

        {/* Quick actions */}
        {quickActions.length > 0 && (
          <View
            style={{
              paddingVertical: 12,
              backgroundColor: '#f3f4f6',
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
            }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 8,
                flexGrow: 1,
              }}
            >
              {quickActions.map(({ key, label, Icon, onPress, tone }) => (
                <TouchableOpacity
                  key={key}
                  style={{ flexDirection: 'column', alignItems: 'center', padding: 8, borderRadius: 6, minWidth: 76 }}
                  onPress={onPress}
                  disabled={loading}
                >
                  <View
                    style={{
                      padding: 8,
                      borderRadius: 9999,
                      backgroundColor: loading ? '#9ca3af' : tone === 'danger' ? '#dc2626' : primary,
                    }}
                  >
                    <Icon size={18} color="#ffffff" />
                  </View>
                  <Text style={{ fontSize: 12, marginTop: 4, color: '#374151' }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16 }}
        >
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 10,
              padding: 16,
              borderWidth: 1,
              borderColor: '#e5e7eb',
              marginBottom: 16,
            }}
          >
            {renderField('Transaction ID', String(transaction.id))}
            {renderField(
              'Account No.',
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: '#ef4444', fontWeight: '500', fontSize: 13 }}>
                  {accountNo || '-'}
                </Text>
                {accountNo ? (
                  <TouchableOpacity
                    onPress={() => {
                      if (onViewCustomer && accountNo) {
                        onViewCustomer(accountNo);
                      } else {
                        onNavigate?.('customer', accountNo);
                      }
                    }}
                    style={{ marginLeft: 8 }}
                  >
                    <Info size={14} color="#6b7280" />
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
            {renderField('Full Name', transaction.account?.customer?.full_name || '-')}
            {renderField('Contact No.', transaction.account?.customer?.contact_number_primary || '-')}
            {renderField('Transaction Type', transaction.transaction_type || '-')}
            {renderField(
              'Received Payment',
              formatCurrency(transaction.received_payment),
              true
            )}
            {renderField('Payment Date', formatDate(transaction.payment_date))}
            {renderField('Date Processed', formatDate(transaction.date_processed))}
            {renderField(
              'Processed By',
              transaction.processor?.email_address || transaction.processed_by_user || '-'
            )}
            {renderField('Payment Method', getPaymentMethodName())}
            {renderField('Reference No.', transaction.reference_no || '-')}
            {renderField('OR No.', transaction.or_no || '-')}
            {renderField('Remarks', transaction.remarks || 'No remarks')}
            {renderField(
              'Status',
              <Text
                style={{ fontSize: 13, color: statusColor, textTransform: 'capitalize' }}
              >
                {transaction.status || 'Unknown'}
              </Text>
            )}
            {renderField('Barangay', transaction.account?.customer?.barangay || '-')}
            {renderField('City', transaction.account?.customer?.city || '-')}
            {renderField('Region', transaction.account?.customer?.region || '-')}
            {renderField('Plan', transaction.account?.customer?.desired_plan || '-')}
            {renderField('Account Balance', formatCurrency(transaction.account?.account_balance || 0))}
            {renderField('Approved By', transaction.approved_by || '-')}
            {renderField('Created At', formatDate(transaction.created_at))}
            {renderField('Updated At', formatDate(transaction.updated_at))}
          </View>

          {/* Related Invoices */}
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: '#e5e7eb',
              marginBottom: 24,
              overflow: 'hidden',
            }}
          >
            <TouchableOpacity
              onPress={() => setExpandedInvoices(v => !v)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingVertical: 14,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontWeight: '600', fontSize: 14, color: '#111827' }}>
                  Related Invoices
                </Text>
                <View style={{ backgroundColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 12, color: '#374151' }}>{invoicesCount}</Text>
                </View>
              </View>
              {expandedInvoices
                ? <ChevronDown size={18} color="#6b7280" />
                : <ChevronRight size={18} color="#6b7280" />}
            </TouchableOpacity>

            {expandedInvoices && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                {relatedInvoices.length === 0 ? (
                  <Text style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', paddingVertical: 8 }}>
                    No related invoices found
                  </Text>
                ) : (
                  relatedInvoices.map((inv: any, idx: number) => (
                    <View
                      key={idx}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        paddingVertical: 8,
                        borderBottomWidth: idx < relatedInvoices.length - 1 ? 1 : 0,
                        borderBottomColor: '#e5e7eb',
                      }}
                    >
                      <Text style={{ fontSize: 12, color: '#6b7280' }}>
                        {inv.invoice_date || inv.created_at ? formatDate(inv.invoice_date || inv.created_at) : `Invoice ${idx + 1}`}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#111827', fontWeight: '500' }}>
                        {formatCurrency(inv.amount || inv.total_amount || 0)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        </ScrollView>

        <LoadingModalGlobal
          isOpen={loading}
          type="loading"
          title="Approving"
          message="Approving transaction..."
          loadingPercentage={loadingPercentage}
          isDarkMode={false}
          colorPalette={colorPalette}
        />

        {/* Edit — same record shape the web passes */}
        {showEditModal && (
          <TransactionFormModal
            isOpen={showEditModal}
            onClose={() => setShowEditModal(false)}
            onSave={() => {
              setShowEditModal(false);
              onApprovalSuccess?.();
            }}
            billingRecord={{
              applicationId: transaction.account?.account_no || transaction.account_no,
              customerName: transaction.account?.customer?.full_name || '-',
              contactNumber: transaction.account?.customer?.contact_number_primary || '-',
              plan: transaction.account?.customer?.desired_plan || '-',
              address: transaction.account?.customer?.address || '',
              accountBalance: transaction.account?.account_balance || 0,
            }}
            initialTransactionData={transaction}
          />
        )}

        <TransactionRevertModal
          isOpen={showRevertRequestModal}
          onClose={() => setShowRevertRequestModal(false)}
          transactionId={transaction.id}
          onSuccess={() => {
            setShowRevertRequestModal(false);
            onApprovalSuccess?.();
          }}
        />
      </View>
    </Modal>
  );
};

export default TransactionListDetails;
