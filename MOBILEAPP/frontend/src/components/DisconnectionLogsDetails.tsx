import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { X, Info } from 'lucide-react-native';

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

interface DisconnectionRecord {
  id?: string;
  accountNo: string;
  customerName: string;
  address?: string;
  contactNumber?: string;
  emailAddress?: string;
  plan?: string;
  balance?: number;
  status?: string;
  disconnectionDate?: string;
  disconnectedBy?: string;
  reason?: string;
  remarks?: string;
  appliedDate?: string;
  reconnectionFee?: number;
  daysDisconnected?: number;
  disconnectionCode?: string;
  reconnectionDate?: string;
  reconnectedBy?: string;
  paymentStatus?: string;
  totalDue?: number;
  username?: string;
  sessionId?: string;
  date?: string;
  barangay?: string;
  city?: string;
  dateFormat?: string;
}

interface DisconnectionLogsDetailsProps {
  disconnectionRecord: DisconnectionRecord;
  onClose: () => void;
  isMobile?: boolean;
}

const DetailRow: React.FC<{ label: string; value: string; valueColor?: string; icon?: React.ReactNode }> = ({
  label,
  value,
  valueColor = '#111827',
  icon,
}) => (
  <View>
    <Text style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>{label}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ color: valueColor, fontSize: 14 }}>{value}</Text>
      {icon}
    </View>
  </View>
);

const DisconnectionLogsDetails: React.FC<DisconnectionLogsDetailsProps> = ({ disconnectionRecord, onClose }) => {
  const title = `${disconnectionRecord.accountNo} | ${disconnectionRecord.customerName} | ${disconnectionRecord.address || ''}`;

  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#f3f4f6',
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827', flex: 1, marginRight: 12 }} numberOfLines={1}>
          {title}
        </Text>
        <TouchableOpacity onPress={onClose} style={{ padding: 6, borderRadius: 6, backgroundColor: '#e5e7eb' }}>
          <X size={18} color="#374151" />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <DetailRow label="Account No." value={title} valueColor="#ef4444" />
        <DetailRow label="Session ID" value={disconnectionRecord.sessionId || '-'} />
        <DetailRow label="Disconnected By" value={disconnectionRecord.disconnectedBy || '-'} />
        <DetailRow label="Username" value={disconnectionRecord.username || '-'} />
        <DetailRow label="Date" value={formatDate(disconnectionRecord.date)} />
        <DetailRow label="Remarks" value={disconnectionRecord.remarks || '-'} />
        <DetailRow
          label="Barangay"
          value={disconnectionRecord.barangay || '-'}
          icon={<Info size={16} color="#6b7280" style={{ marginLeft: 8 }} />}
        />
        <DetailRow label="City" value={disconnectionRecord.city || '-'} />
        <DetailRow label="Date Format" value={formatDate(disconnectionRecord.dateFormat || disconnectionRecord.date)} />
      </ScrollView>
    </View>
  );
};

export default DisconnectionLogsDetails;
