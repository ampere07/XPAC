import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Info,
  ChevronDown,
} from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { relatedDataService } from '../services/relatedDataService';

interface PaymentPortalDetailsProps {
  record: {
    id: string;
    reference_no: string;
    account_id: number | string;
    total_amount: number;
    date_time: string;
    checkout_id: string;
    status: string;
    transaction_status: string;
    ewallet_type?: string;
    payment_channel?: string;
    type?: string;
    payment_url?: string;
    json_payload?: string;
    callback_payload?: string;
    created_at?: string;
    updated_at?: string;
    accountNo?: string;
    fullName?: string;
    contactNo?: string;
    accountBalance?: number;
    provider?: string;
    city?: string;
    barangay?: string;
    address?: string;
    plan?: string;
    [key: string]: any;
  };
  onClose: () => void;
  onViewCustomer?: (accountNo: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const isDarkMode = false;

const formatCurrency = (amount: number) => `₱${Number(amount || 0).toFixed(2)}`;

const getStatusColor = (status: string): string => {
  const s = (status || '').toLowerCase();
  if (s === 'completed' || s === 'success' || s === 'approved' || s === 'paid') return '#22c55e';
  if (s === 'pending') return '#eab308';
  if (s === 'processing') return '#3b82f6';
  if (s === 'failed' || s === 'cancelled') return '#ef4444';
  return '#6b7280';
};

const ROW_BORDER = '#e5e7eb';
const LABEL_COLOR = '#6b7280';
const VALUE_COLOR = '#111827';
const BG = '#ffffff';

interface DetailRowProps {
  label: string;
  value?: string | null;
  valueColor?: string;
  action?: React.ReactNode;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value, valueColor, action }) => (
  <View style={{
    flexDirection: 'row', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: ROW_BORDER,
    alignItems: 'flex-start',
  }}>
    <Text style={{ width: 140, fontSize: 14, color: LABEL_COLOR }}>{label}</Text>
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
      <Text style={{ fontSize: 14, color: valueColor || VALUE_COLOR, flexShrink: 1 }}>
        {value || 'N/A'}
      </Text>
      {action}
    </View>
  </View>
);

const PaymentPortalDetails: React.FC<PaymentPortalDetailsProps> = ({
  record,
  onClose,
  onViewCustomer,
  onPrevious,
  onNext,
}) => {
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [expandedInvoices, setExpandedInvoices] = useState(false);
  const [relatedInvoices, setRelatedInvoices] = useState<any[]>([]);
  const [invoicesCount, setInvoicesCount] = useState(0);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  useEffect(() => {
    const loadPalette = async () => {
      try {
        const p = await settingsColorPaletteService.getActive();
        setColorPalette(p);
      } catch {}
    };
    loadPalette();
  }, []);

  useEffect(() => {
    const fetchInvoices = async () => {
      const accountNo = record.accountNo || record.account_id;
      if (!accountNo) return;
      setInvoicesLoading(true);
      try {
        const result = await relatedDataService.getRelatedInvoices(String(accountNo));
        setRelatedInvoices((result.data || []).slice(0, 5));
        setInvoicesCount(result.count || 0);
      } catch {
        setRelatedInvoices([]);
        setInvoicesCount(0);
      } finally {
        setInvoicesLoading(false);
      }
    };
    fetchInvoices();
  }, [record.accountNo, record.account_id]);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const displayTitle = `${record.accountNo || record.account_id} | ${record.fullName || 'Unknown'}`;

  return (
    <Modal
      visible
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: BG }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingVertical: 12,
          backgroundColor: '#f3f4f6', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
          paddingTop: 60,
        }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={20} color="#6b7280" />
          </TouchableOpacity>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: '#111827', marginLeft: 12 }} numberOfLines={1}>
            {displayTitle}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {onPrevious && (
              <TouchableOpacity onPress={onPrevious} style={{ padding: 4 }}>
                <ChevronLeft size={20} color="#6b7280" />
              </TouchableOpacity>
            )}
            {onNext && (
              <TouchableOpacity onPress={onNext} style={{ padding: 4 }}>
                <ChevronRight size={20} color="#6b7280" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          {/* Core details */}
          <DetailRow label="Reference No" value={record.reference_no} />

          <View style={{
            flexDirection: 'row', paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: ROW_BORDER, alignItems: 'flex-start',
          }}>
            <Text style={{ width: 140, fontSize: 14, color: LABEL_COLOR }}>Account No</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 14, color: '#ef4444', fontWeight: '600', flexShrink: 1 }}>
                {record.accountNo || record.account_id} | {record.fullName || 'Unknown'} | {record.address || 'Address not available'}
              </Text>
              {onViewCustomer && (
                <TouchableOpacity
                  onPress={() => {
                    const acc = record.accountNo || record.account_id;
                    if (acc) onViewCustomer(String(acc));
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <Info size={16} color="#6b7280" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <DetailRow label="Contact No" value={record.contactNo} />
          <DetailRow label="Account Balance" value={formatCurrency(record.accountBalance || 0)} />
          <DetailRow label="Total Amount" value={formatCurrency(record.total_amount || 0)} />
          <DetailRow label="Date Time" value={record.date_time} />
          <DetailRow label="Checkout ID" value={record.checkout_id} />

          <View style={{
            flexDirection: 'row', paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: ROW_BORDER, alignItems: 'flex-start',
          }}>
            <Text style={{ width: 140, fontSize: 14, color: LABEL_COLOR }}>Status</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: getStatusColor(record.status || ''), textTransform: 'capitalize' }}>
              {record.status || 'N/A'}
            </Text>
          </View>

          <View style={{
            flexDirection: 'row', paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: ROW_BORDER, alignItems: 'flex-start',
          }}>
            <Text style={{ width: 140, fontSize: 14, color: LABEL_COLOR }}>Transaction Status</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: getStatusColor(record.transaction_status || ''), textTransform: 'capitalize' }}>
              {record.transaction_status || 'N/A'}
            </Text>
          </View>

          <DetailRow label="E-Wallet Type" value={record.ewallet_type} />
          <DetailRow label="Payment Channel" value={record.payment_channel} />
          <DetailRow label="Type" value={record.type} />
          <DetailRow label="Plan" value={record.plan || 'N/A'} />
          <DetailRow label="Name" value={record.fullName} />
          <DetailRow label="Barangay" value={record.barangay} />
          <DetailRow label="City" value={record.city} />

          {/* Related Invoices */}
          <View style={{ marginTop: 16, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <TouchableOpacity
              onPress={() => setExpandedInvoices(!expandedInvoices)}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                padding: 16, backgroundColor: '#f9fafb',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }}>Related Invoices</Text>
                <View style={{ backgroundColor: '#e5e7eb', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 12, color: '#374151' }}>{invoicesCount}</Text>
                </View>
              </View>
              <ChevronDown size={20} color="#6b7280" style={{ transform: [{ rotate: expandedInvoices ? '180deg' : '0deg' }] }} />
            </TouchableOpacity>

            {expandedInvoices && (
              <View style={{ padding: 12 }}>
                {invoicesLoading ? (
                  <ActivityIndicator size="small" color={primaryColor} />
                ) : relatedInvoices.length === 0 ? (
                  <Text style={{ textAlign: 'center', color: '#6b7280', fontSize: 14, paddingVertical: 12 }}>No invoices found</Text>
                ) : (
                  relatedInvoices.map((inv, i) => (
                    <View key={i} style={{
                      flexDirection: 'row', justifyContent: 'space-between',
                      paddingVertical: 8, borderBottomWidth: i < relatedInvoices.length - 1 ? 1 : 0,
                      borderBottomColor: '#f3f4f6',
                    }}>
                      <Text style={{ fontSize: 13, color: '#6b7280', flex: 1 }}>
                        {inv.invoice_no || inv.id || `Invoice ${i + 1}`}
                      </Text>
                      <Text style={{ fontSize: 13, color: '#111827', fontWeight: '500' }}>
                        {inv.amount ? formatCurrency(Number(inv.amount)) : (inv.status || 'N/A')}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
};

export default PaymentPortalDetails;
