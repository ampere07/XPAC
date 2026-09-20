import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Dimensions } from 'react-native';
import { X, Info } from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

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

interface ReconnectionRecord {
  id?: string;
  accountNo: string;
  customerName: string;
  address?: string;
  contactNumber?: string;
  emailAddress?: string;
  plan?: string;
  balance?: number;
  status?: string;
  reconnectionDate?: string;
  reconnectedBy?: string;
  reason?: string;
  remarks?: string;
  appliedDate?: string;
  reconnectionFee?: number;
  daysDisconnected?: number;
  reconnectionCode?: string;
  username?: string;
  sessionId?: string;
  date?: string;
  barangay?: string;
  city?: string;
  dateFormat?: string;
}

interface ReconnectionLogsDetailsProps {
  reconnectionRecord: ReconnectionRecord;
  onClose: () => void;
  isMobile?: boolean;
}

const isDarkMode = false;

const Row: React.FC<{ label: string; value: React.ReactNode; valueColor?: string; showInfo?: boolean }> = ({
  label,
  value,
  valueColor,
  showInfo,
}) => (
  <View style={{ marginBottom: 16 }}>
    <Text style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280', marginBottom: 4 }}>
      {label}
    </Text>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ fontSize: 14, color: valueColor || '#111827', flexShrink: 1 }}>{value}</Text>
      {showInfo && <Info size={16} color="#6b7280" style={{ marginLeft: 8 }} />}
    </View>
  </View>
);

const ReconnectionLogsDetails: React.FC<ReconnectionLogsDetailsProps> = ({ reconnectionRecord, onClose }) => {
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

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

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const title = `${reconnectionRecord.accountNo} | ${reconnectionRecord.customerName} | ${reconnectionRecord.address || ''}`;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: '#ffffff',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '92%',
            flex: isTablet ? undefined : 1,
            marginTop: isTablet ? 40 : 0,
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
              backgroundColor: '#f9fafb',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
            }}
          >
            <Text
              style={{ fontSize: 16, fontWeight: '600', color: '#111827', flex: 1, paddingRight: 12 }}
              numberOfLines={1}
            >
              {title}
            </Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 6, borderRadius: 8, backgroundColor: '#f1f5f9' }}>
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <Row
              label="Account No."
              value={`${reconnectionRecord.accountNo} | ${reconnectionRecord.customerName} | ${reconnectionRecord.address || ''}`}
              valueColor="#ef4444"
            />
            <Row label="Session ID" value={reconnectionRecord.sessionId || '-'} />
            <Row label="Reconnected By" value={reconnectionRecord.reconnectedBy || '-'} />
            <Row label="Username" value={reconnectionRecord.username || '-'} />
            <Row label="Date" value={formatDate(reconnectionRecord.date)} />
            <Row label="Plan" value={reconnectionRecord.plan || '-'} showInfo />
            <Row
              label="Reconnection Fee"
              value={`₱${reconnectionRecord.reconnectionFee !== undefined ? reconnectionRecord.reconnectionFee.toFixed(2) : '0.00'}`}
            />
            <Row label="Remarks" value={reconnectionRecord.remarks || '-'} />
            <Row label="Barangay" value={reconnectionRecord.barangay || '-'} showInfo />
            <Row label="City" value={reconnectionRecord.city || '-'} showInfo />
            <Row label="Date Format" value={formatDate(reconnectionRecord.dateFormat || reconnectionRecord.date)} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default ReconnectionLogsDetails;
