import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { X, Info, ChevronDown, ChevronRight } from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { relatedDataService } from '../services/relatedDataService';

const isDarkMode = false;

interface InvoiceRecord {
  id: string;
  invoiceDate: string;
  invoiceStatus: string;
  accountNo: string;
  fullName: string;
  contactNumber: string;
  emailAddress: string;
  address: string;
  plan: string;
  dateInstalled?: string;
  provider?: string;
  invoiceNo?: string;
  invoiceBalance?: number;
  otherCharges?: number;
  totalAmountDue?: number;
  dueDate?: string;
  invoicePayment?: number;
  paymentMethod?: string;
  dateProcessed?: string;
  processedBy?: string;
  remarks?: string;
  vat?: number;
  amountDue?: number;
  balanceFromPreviousBill?: number;
  paymentReceived?: number;
  remainingBalance?: number;
  monthlyServiceFee?: number;
  staggeredPaymentsCount?: number;
}

interface InvoiceDetailsProps {
  invoiceRecord: InvoiceRecord;
  onViewCustomer?: (accountNo: string) => void;
  onClose?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

interface StaggeredPayment {
  id: string | number;
  amount?: number;
  status?: string;
  due_date?: string;
  [key: string]: any;
}

const Row: React.FC<{ label: string; value: string | React.ReactNode; valueColor?: string }> = ({
  label,
  value,
  valueColor,
}) => (
  <View
    style={{
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
    }}
  >
    <Text style={{ color: '#6b7280', fontSize: 13, flex: 1 }}>{label}</Text>
    {typeof value === 'string' ? (
      <Text
        style={{
          color: valueColor || '#111827',
          fontSize: 13,
          fontWeight: '500',
          flex: 1,
          textAlign: 'right',
        }}
        numberOfLines={2}
      >
        {value}
      </Text>
    ) : (
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{value}</View>
    )}
  </View>
);

const InvoiceDetails: React.FC<InvoiceDetailsProps> = ({
  invoiceRecord,
  onViewCustomer,
  onClose,
  onPrevious,
  onNext,
}) => {
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [expandedStaggered, setExpandedStaggered] = useState(false);
  const [relatedStaggered, setRelatedStaggered] = useState<StaggeredPayment[]>([]);
  const [staggeredCount, setStaggeredCount] = useState(0);
  const [expandedModal, setExpandedModal] = useState(false);
  const [fullRelatedStaggered, setFullRelatedStaggered] = useState<StaggeredPayment[]>([]);
  const [loadingStaggered, setLoadingStaggered] = useState(false);

  const primary = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  useEffect(() => {
    if (!invoiceRecord.accountNo) return;
    setLoadingStaggered(true);
    relatedDataService
      .getRelatedStaggered(invoiceRecord.accountNo)
      .then((result: any) => {
        const data = result.data || [];
        setFullRelatedStaggered(data);
        setRelatedStaggered(data.slice(0, 5));
        setStaggeredCount(result.count || 0);
      })
      .catch(() => {
        setRelatedStaggered([]);
        setFullRelatedStaggered([]);
        setStaggeredCount(0);
      })
      .finally(() => setLoadingStaggered(false));
  }, [invoiceRecord.accountNo]);

  const statusColor =
    invoiceRecord.invoiceStatus === 'Paid'
      ? '#22c55e'
      : invoiceRecord.invoiceStatus === 'Unpaid'
      ? '#ef4444'
      : '#f59e0b';

  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff', borderLeftWidth: 1, borderLeftColor: '#e5e7eb' }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: '#f9fafb',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {onPrevious && (
            <TouchableOpacity onPress={onPrevious} style={{ padding: 4 }}>
              <ChevronRight size={18} color="#6b7280" style={{ transform: [{ rotate: '180deg' }] }} />
            </TouchableOpacity>
          )}
          {onNext && (
            <TouchableOpacity onPress={onNext} style={{ padding: 4 }}>
              <ChevronRight size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>
            {invoiceRecord.invoiceNo || invoiceRecord.id}
          </Text>
        </View>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
            <X size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {/* Invoice Info */}
        <Row label="Invoice No." value={invoiceRecord.invoiceNo || invoiceRecord.id} />

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: '#f3f4f6',
          }}
        >
          <Text style={{ color: '#6b7280', fontSize: 13, flex: 1 }}>Account No.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
            <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '500', flexShrink: 1 }} numberOfLines={2}>
              {invoiceRecord.accountNo} | {invoiceRecord.fullName}
            </Text>
            {onViewCustomer && (
              <TouchableOpacity
                onPress={() => onViewCustomer(invoiceRecord.accountNo)}
                style={{ marginLeft: 6, padding: 4 }}
              >
                <Info size={16} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Row label="Full Name" value={invoiceRecord.fullName} />
        <Row label="Invoice Date" value={invoiceRecord.invoiceDate} />
        <Row label="Contact Number" value={invoiceRecord.contactNumber} />
        <Row label="Email Address" value={invoiceRecord.emailAddress} />
        <Row label="Plan" value={invoiceRecord.plan} />
        <Row label="Provider" value={invoiceRecord.provider || 'SWITCH'} />
        <Row label="Remarks" value={invoiceRecord.remarks || 'System Generated'} />
        <Row
          label="Invoice Balance"
          value={`₱${(invoiceRecord.invoiceBalance ?? 0).toFixed(2)}`}
        />
        <Row
          label="Invoice Status"
          value={
            <Text style={{ color: statusColor, fontSize: 13, fontWeight: '600' }}>
              {invoiceRecord.invoiceStatus || 'Unpaid'}
            </Text>
          }
        />
        <Row
          label="Others and Basic Charges"
          value={`₱${(invoiceRecord.otherCharges ?? 0).toFixed(2)}`}
        />
        <Row
          label="Total Amount"
          value={`₱${(invoiceRecord.totalAmountDue ?? 0).toFixed(2)}`}
        />
        <Row
          label="Invoice Payment"
          value={`₱${(invoiceRecord.invoicePayment ?? 0).toFixed(2)}`}
        />
        <Row label="Due Date" value={invoiceRecord.dueDate || '-'} />

        {/* Related Staggered Payments */}
        <View
          style={{
            marginTop: 16,
            borderWidth: 1,
            borderColor: '#e5e7eb',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <TouchableOpacity
            onPress={() => setExpandedStaggered(!expandedStaggered)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 12,
              backgroundColor: '#f9fafb',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#111827' }}>
                Related Staggered Payments
              </Text>
              <View
                style={{
                  backgroundColor: '#e5e7eb',
                  borderRadius: 10,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ fontSize: 11, color: '#374151', fontWeight: '600' }}>{staggeredCount}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {staggeredCount > 0 && (
                <TouchableOpacity onPress={() => setExpandedModal(true)}>
                  <Text style={{ fontSize: 12, color: primary }}>View All</Text>
                </TouchableOpacity>
              )}
              {expandedStaggered ? (
                <ChevronDown size={18} color="#6b7280" />
              ) : (
                <ChevronRight size={18} color="#6b7280" />
              )}
            </View>
          </TouchableOpacity>

          {loadingStaggered && (
            <View style={{ padding: 12, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={primary} />
            </View>
          )}

          {expandedStaggered && !loadingStaggered && (
            <View style={{ padding: 12 }}>
              {relatedStaggered.length === 0 ? (
                <Text style={{ color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
                  No staggered payments found
                </Text>
              ) : (
                relatedStaggered.map((item, idx) => (
                  <View
                    key={item.id ?? idx}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingVertical: 6,
                      borderBottomWidth: idx < relatedStaggered.length - 1 ? 1 : 0,
                      borderBottomColor: '#f3f4f6',
                    }}
                  >
                    <Text style={{ color: '#6b7280', fontSize: 12 }}>
                      #{item.id} — {item.due_date || '-'}
                    </Text>
                    <Text style={{ color: '#111827', fontSize: 12, fontWeight: '500' }}>
                      {item.amount != null ? `₱${Number(item.amount).toFixed(2)}` : '-'}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: item.status === 'Paid' ? '#22c55e' : '#ef4444',
                      }}
                    >
                      {item.status || '-'}
                    </Text>
                  </View>
                ))
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Expanded Staggered Modal */}
      <Modal visible={expandedModal} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
              backgroundColor: '#f9fafb',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>
              All Related Staggered Payments ({staggeredCount})
            </Text>
            <TouchableOpacity onPress={() => setExpandedModal(false)} style={{ padding: 6 }}>
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {fullRelatedStaggered.length === 0 ? (
              <Text style={{ color: '#6b7280', textAlign: 'center', marginTop: 32 }}>
                No staggered payments found
              </Text>
            ) : (
              fullRelatedStaggered.map((item, idx) => (
                <View
                  key={item.id ?? idx}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: '#f3f4f6',
                  }}
                >
                  <Text style={{ color: '#6b7280', fontSize: 13 }}>
                    #{item.id} — {item.due_date || '-'}
                  </Text>
                  <Text style={{ color: '#111827', fontSize: 13, fontWeight: '500' }}>
                    {item.amount != null ? `₱${Number(item.amount).toFixed(2)}` : '-'}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: item.status === 'Paid' ? '#22c55e' : '#ef4444',
                    }}
                  >
                    {item.status || '-'}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

export default InvoiceDetails;
