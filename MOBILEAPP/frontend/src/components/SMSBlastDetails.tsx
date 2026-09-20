import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { X } from 'lucide-react-native';
import { ColorPalette } from '../services/settingsColorPaletteService';

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hh = String(hours).padStart(2, '0');
    return `${mm}/${dd}/${yyyy} ${hh}:${minutes} ${ampm}`;
  } catch (e) {
    return dateString;
  }
};

interface SMSBlastRecord {
  id?: string;
  title?: string;
  message: string;
  billing_day?: number | null;
  message_count?: number | null;
  credit_used?: string | null;
  modifiedDate: string;
  modifiedEmail: string;
  userEmail?: string;
  recipients?: number;
  status?: string;
  sentDate?: string;
  sentTime?: string;
  createdBy?: string;
  createdDate?: string;
  messageType?: string;
  isBulk?: boolean;
  isCritical?: boolean;
  targetGroup?: string;
  deliveryStatus?: string;
  deliveryRate?: number;
  failedCount?: number;
  remarks?: string;
  barangay?: string;
  city?: string;
  target_name?: string;
  target_type?: string;
}

interface SMSBlastDetailsProps {
  smsBlastRecord: SMSBlastRecord;
  onClose: () => void;
  isMobile?: boolean;
  isDarkMode?: boolean;
  colorPalette?: ColorPalette | null;
}

const SMSBlastDetails: React.FC<SMSBlastDetailsProps> = ({
  smsBlastRecord,
  onClose,
  colorPalette,
}) => {
  const primaryColor = colorPalette?.primary || '#7c3aed';

  const title =
    smsBlastRecord.target_name && smsBlastRecord.target_name !== 'N/A'
      ? `${smsBlastRecord.target_name} (${smsBlastRecord.target_type})`
      : smsBlastRecord.title || 'SMS BLAST LOG';

  const renderField = (label: string, value: any) => {
    if (value === null || value === undefined || value === '') return null;
    return (
      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingBottom: 12,
          marginBottom: 12,
        }}
      >
        <Text style={{ width: 130, fontSize: 13, color: '#6b7280' }}>{label}:</Text>
        <Text style={{ flex: 1, fontSize: 13, color: '#111827' }}>{String(value)}</Text>
      </View>
    );
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#f3f4f6',
        }}
      >
        <Text
          style={{ fontSize: 16, fontWeight: '600', color: '#111827', flex: 1, marginRight: 12 }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
          <X size={22} color="#6b7280" />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={{ flex: 1, backgroundColor: '#f9fafb' }}
        contentContainerStyle={{ padding: 16 }}
      >
        {renderField('Message', smsBlastRecord.message)}
        {renderField('Target Name', smsBlastRecord.target_name)}
        {renderField('Target Type', smsBlastRecord.target_type)}
        {renderField('Barangay', smsBlastRecord.barangay)}
        {renderField('City', smsBlastRecord.city)}
        {renderField('Billing Day', smsBlastRecord.billing_day)}
        {renderField('Recipient Count', smsBlastRecord.message_count)}
        {renderField('Credit Used', smsBlastRecord.credit_used)}
        {renderField('Modified Date', formatDate(smsBlastRecord.modifiedDate))}
        {renderField('Modified Email', smsBlastRecord.modifiedEmail)}
        {renderField('Created By', smsBlastRecord.userEmail)}
      </ScrollView>
    </Modal>
  );
};

export default SMSBlastDetails;
