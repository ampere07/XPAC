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
  ChevronRight,
} from 'lucide-react-native';
import { transactionService } from '../services/transactionService';
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
              const result = await transactionService.approveTransaction(transaction.id);
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

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: 60,
            paddingBottom: 12,
            backgroundColor: '#ffffff',
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
            gap: 8,
          }}
        >
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <X size={20} color="#374151" />
          </TouchableOpacity>
          {onPrevious && (
            <TouchableOpacity
              onPress={onPrevious}
              style={{ padding: 4, marginLeft: 4 }}
            >
              <ChevronRight size={18} color="#374151" style={{ transform: [{ rotate: '180deg' }] }} />
            </TouchableOpacity>
          )}
          {onNext && (
            <TouchableOpacity onPress={onNext} style={{ padding: 4 }}>
              <ChevronRight size={18} color="#374151" />
            </TouchableOpacity>
          )}
          <Text
            style={{ flex: 1, fontSize: 15, fontWeight: '600', color: '#111827' }}
            numberOfLines={1}
          >
            {accountNo} | {transaction.account?.customer?.full_name || '-'}
          </Text>
          {statusLower === 'pending' && (
            <TouchableOpacity
              onPress={handleApprove}
              disabled={loading}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: primary,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 6,
                gap: 4,
              }}
            >
              <CheckCircle size={14} color="#ffffff" />
              <Text style={{ color: '#ffffff', fontSize: 13 }}>Approve</Text>
            </TouchableOpacity>
          )}
        </View>

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
      </View>
    </Modal>
  );
};

export default TransactionListDetails;
