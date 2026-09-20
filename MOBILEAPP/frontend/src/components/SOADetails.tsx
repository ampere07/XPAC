import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  Modal,
  StyleSheet,
} from 'react-native';
import { ExternalLink, X, Info } from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface SOARecord {
  id: string;
  statementDate: string;
  accountNo: string;
  dateInstalled: string;
  fullName: string;
  contactNumber: string;
  emailAddress: string;
  address: string;
  plan: string;
  provider?: string;
  balanceFromPreviousBill?: number;
  statementNo?: string;
  paymentReceived?: number;
  remainingBalance?: number;
  monthlyServiceFee?: number;
  otherCharges?: number;
  vat?: number;
  dueDate?: string;
  amountDue?: number;
  totalAmountDue?: number;
  deliveryStatus?: string;
  deliveryDate?: string;
  deliveredBy?: string;
  deliveryRemarks?: string;
  deliveryProof?: string;
  modifiedBy?: string;
  modifiedDate?: string;
  printLink?: string;
  barangay?: string;
  city?: string;
  region?: string;
}

interface SOADetailsProps {
  soaRecord: SOARecord;
  onViewCustomer?: (accountNo: string) => void;
  onClose?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const isDarkMode = false;

const SOADetails: React.FC<SOADetailsProps> = ({ soaRecord, onViewCustomer, onClose, onPrevious, onNext }) => {
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  const primary = colorPalette?.primary || '#7c3aed';

  const handleOpenLink = () => {
    if (soaRecord.printLink) {
      Linking.openURL(soaRecord.printLink).catch(() => {});
    }
  };

  const Row = ({ label, value }: { label: string; value?: string | number }) => (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value ?? '-'}</Text>
    </View>
  );

  return (
    <Modal animationType="slide" transparent={false} visible onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {soaRecord.accountNo} | {soaRecord.fullName}
            </Text>
            <Text style={[styles.headerSub]} numberOfLines={1}>
              {soaRecord.address?.split(',')[0] || ''}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {onPrevious && (
              <TouchableOpacity style={styles.iconBtn} onPress={onPrevious}>
                <Text style={{ color: primary, fontSize: 18 }}>{'<'}</Text>
              </TouchableOpacity>
            )}
            {onNext && (
              <TouchableOpacity style={styles.iconBtn} onPress={onNext}>
                <Text style={{ color: primary, fontSize: 18 }}>{'>'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.iconBtn, !soaRecord.printLink && { opacity: 0.4 }]}
              onPress={handleOpenLink}
              disabled={!soaRecord.printLink}
            >
              <ExternalLink size={18} color={primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={onClose}>
              <X size={18} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Body */}
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={styles.section}>
            <Row label="Statement No." value={soaRecord.statementNo || `2509180${soaRecord.id}`} />
            <Row label="Full Name" value={soaRecord.fullName} />
            <Row label="Statement Date" value={soaRecord.statementDate} />

            {/* Account No with View Customer button */}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Account No.</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                <Text style={[styles.rowValue, { color: '#ef4444', flexShrink: 1, marginRight: 4 }]} numberOfLines={1}>
                  {soaRecord.accountNo}
                </Text>
                {onViewCustomer && (
                  <TouchableOpacity onPress={() => onViewCustomer(soaRecord.accountNo)}>
                    <Info size={16} color="#6b7280" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <Row label="Date Installed" value={soaRecord.dateInstalled} />
            <Row label="Contact Number" value={soaRecord.contactNumber} />
            <Row label="Email Address" value={soaRecord.emailAddress} />

            {/* Plan with info icon */}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Plan</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.rowValue}>{soaRecord.plan}</Text>
                <Info size={16} color="#6b7280" style={{ marginLeft: 4 }} />
              </View>
            </View>

            {/* Provider */}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Provider</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.rowValue}>{soaRecord.provider || 'SWITCH'}</Text>
                <Info size={16} color="#6b7280" style={{ marginLeft: 4 }} />
              </View>
            </View>

            <Row label="Balance from Previous Bill" value={`₱${soaRecord.balanceFromPreviousBill?.toFixed(2) || '0.00'}`} />
            <Row label="Payment Received from Previous Bill" value={`₱${soaRecord.paymentReceived?.toFixed(2) || '0.00'}`} />
            <Row label="Remaining Balance from Previous Bill" value={`₱${soaRecord.remainingBalance?.toFixed(2) || '0.00'}`} />
            <Row label="Monthly Service Fee" value={`₱${soaRecord.monthlyServiceFee?.toFixed(2) || '624.11'}`} />
            <Row label="Others and Basic Charges" value={`₱${soaRecord.otherCharges?.toFixed(2) || '0.00'}`} />
            <Row label="VAT" value={`₱${soaRecord.vat?.toFixed(2) || '74.89'}`} />
            <Row label="Due Date" value={soaRecord.dueDate || '9/30/2025'} />
            <Row label="Amount Due" value={`₱${soaRecord.amountDue?.toFixed(2) || '699.00'}`} />
            <Row label="Total Amount Due" value={`₱${soaRecord.totalAmountDue?.toFixed(2) || '699.00'}`} />

            {soaRecord.deliveryStatus ? (
              <Row label="Delivery Status" value={soaRecord.deliveryStatus} />
            ) : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  headerSub: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },
  iconBtn: {
    padding: 8,
  },
  body: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  rowLabel: {
    fontSize: 13,
    color: '#6b7280',
    flex: 1,
    marginRight: 8,
  },
  rowValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
    textAlign: 'right',
    flexShrink: 1,
  },
});

export default SOADetails;
