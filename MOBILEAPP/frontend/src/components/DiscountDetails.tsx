import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  Mail,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  Info,
  CircleArrowRight,
  Loader,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { update } from '../services/discountService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';

const isDarkMode = false;

const formatDate = (dateString: string | null | undefined, includeTime: boolean = false): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
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
    return dateString;
  }
};

interface DiscountRecord {
  id?: string;
  fullName: string;
  accountNo: string;
  contactNumber: string;
  emailAddress: string;
  address: string;
  plan: string;
  provider: string;
  discountId: string;
  discountAmount: number;
  discountStatus: string;
  dateCreated: string;
  processedBy: string;
  processedDate: string;
  approvedBy: string;
  approvedByEmail?: string;
  modifiedBy: string;
  modifiedDate: string;
  userEmail: string;
  remarks: string;
  barangay?: string;
  city?: string;
  completeAddress?: string;
}

interface DiscountDetailsProps {
  discountRecord: DiscountRecord;
  onClose?: () => void;
  onApproveSuccess?: () => void;
  onViewCustomer?: (accountNo: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const DiscountDetails: React.FC<DiscountDetailsProps> = ({
  discountRecord,
  onClose,
  onApproveSuccess,
  onViewCustomer,
  onPrevious,
  onNext,
}) => {
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');
  const [showApproveButton, setShowApproveButton] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(false);

  const primary = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const userData = JSON.parse(authData);
          const userEmail = userData.email || '';
          setCurrentUserEmail(userEmail);
          const isApprovedByUser =
            discountRecord.approvedByEmail &&
            userEmail &&
            discountRecord.approvedByEmail === userEmail;
          const isPendingStatus = discountRecord.discountStatus === 'Pending';
          setShowApproveButton(!!(isApprovedByUser && isPendingStatus));
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    };
    loadAuth();
  }, [discountRecord.approvedByEmail, discountRecord.discountStatus]);

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

  const handleApprove = () => {
    setShowConfirmModal(true);
  };

  const handleConfirmApprove = async () => {
    if (!discountRecord.id) {
      Alert.alert('Error', 'Discount ID is missing');
      return;
    }

    setIsApproving(true);
    try {
      const response = await update(parseInt(discountRecord.id), { status: 'Unused' });
      if (response.success) {
        Alert.alert('Success', 'Discount approved successfully! Status updated to Unused.');
        setShowConfirmModal(false);
        if (onApproveSuccess) {
          onApproveSuccess();
        }
      } else {
        Alert.alert('Error', 'Failed to approve discount: ' + (response.message || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Error approving discount:', error);
      Alert.alert(
        'Error',
        'Error approving discount: ' +
          (error.response?.data?.message || error.message || 'Unknown error')
      );
    } finally {
      setIsApproving(false);
    }
  };

  const handleViewCustomer = async () => {
    const accNo = discountRecord.accountNo;
    if (!accNo || accNo === '-') return;
    try {
      setLoadingCustomer(true);
      const details = await getCustomerDetail(accNo);
      if (details) {
        // CustomerDetails is being migrated by another agent — navigate via onViewCustomer callback
        if (onViewCustomer) {
          onViewCustomer(accNo);
        }
      } else {
        Alert.alert('Not Found', 'Customer details not found.');
      }
    } catch (err) {
      console.error('Error finding customer', err);
    } finally {
      setLoadingCustomer(false);
    }
  };

  const rowStyle = {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  };

  const labelStyle = {
    fontSize: 13,
    color: '#6b7280',
    flexShrink: 0,
  };

  const valueStyle = {
    fontSize: 13,
    color: '#111827',
    textAlign: 'right' as const,
    flexShrink: 1,
    marginLeft: 8,
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#f9fafb',
        }}
      >
        <Text
          style={{ fontSize: 16, fontWeight: '600', color: '#111827', flex: 1 }}
          numberOfLines={1}
        >
          {discountRecord.fullName}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity
            onPress={onPrevious}
            disabled={!onPrevious}
            style={{ padding: 8, opacity: onPrevious ? 1 : 0.3 }}
          >
            <ChevronLeft size={18} color="#6b7280" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onNext}
            disabled={!onNext}
            style={{ padding: 8, opacity: onNext ? 1 : 0.3 }}
          >
            <ChevronRight size={18} color="#6b7280" />
          </TouchableOpacity>
          {showApproveButton && (
            <TouchableOpacity
              onPress={handleApprove}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 6,
                backgroundColor: primary,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Check size={14} color="#ffffff" />
              <Text style={{ color: '#ffffff', fontSize: 13 }}>Approve</Text>
            </TouchableOpacity>
          )}
          {onClose && (
            <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
              <X size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
        <View style={rowStyle}>
          <Text style={labelStyle}>Full Name</Text>
          <Text style={valueStyle}>{discountRecord.fullName}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Account No.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
            <Text
              style={{ fontSize: 12, color: '#ef4444', textAlign: 'right', flex: 1 }}
              numberOfLines={2}
            >
              {discountRecord.accountNo} | {discountRecord.fullName} | {discountRecord.completeAddress || discountRecord.address}
            </Text>
            <TouchableOpacity
              onPress={handleViewCustomer}
              disabled={loadingCustomer}
              style={{ marginLeft: 8, opacity: loadingCustomer ? 0.5 : 1 }}
            >
              {loadingCustomer ? (
                <ActivityIndicator size="small" color={primary} />
              ) : (
                <CircleArrowRight size={16} color="#6b7280" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Contact Number</Text>
          <Text style={valueStyle}>{discountRecord.contactNumber}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Email Address</Text>
          <Text style={[valueStyle, { maxWidth: '60%' }]} numberOfLines={1}>
            {discountRecord.emailAddress}
          </Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Address</Text>
          <Text style={valueStyle}>{discountRecord.address}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Plan</Text>
          <Text style={valueStyle}>{discountRecord.plan}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Provider</Text>
          <Text style={valueStyle}>{discountRecord.provider}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Discount ID</Text>
          <Text style={valueStyle}>{discountRecord.discountId}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Discount Amount</Text>
          <Text style={valueStyle}>₱{discountRecord.discountAmount.toFixed(2)}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Discount Status</Text>
          <Text style={valueStyle}>{discountRecord.discountStatus}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Date Created</Text>
          <Text style={valueStyle}>{formatDate(discountRecord.dateCreated, true)}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Processed By</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={valueStyle}>{discountRecord.processedBy}</Text>
            <Info size={14} color="#6b7280" style={{ marginLeft: 4 }} />
          </View>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Processed Date</Text>
          <Text style={valueStyle}>{formatDate(discountRecord.processedDate)}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Approved By</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={valueStyle}>{discountRecord.approvedBy}</Text>
            <Info size={14} color="#6b7280" style={{ marginLeft: 4 }} />
          </View>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Modified By</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={valueStyle}>{discountRecord.modifiedBy}</Text>
            <Info size={14} color="#6b7280" style={{ marginLeft: 4 }} />
          </View>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Modified Date</Text>
          <Text style={valueStyle}>{formatDate(discountRecord.modifiedDate, true)}</Text>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>User Email</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[valueStyle, { maxWidth: '75%' }]} numberOfLines={1}>
              {discountRecord.userEmail}
            </Text>
            <Mail size={14} color="#6b7280" style={{ marginLeft: 4 }} />
          </View>
        </View>

        <View style={rowStyle}>
          <Text style={labelStyle}>Remarks</Text>
          <Text style={valueStyle}>{discountRecord.remarks}</Text>
        </View>

        {discountRecord.barangay ? (
          <View style={rowStyle}>
            <Text style={labelStyle}>Barangay</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={valueStyle}>{discountRecord.barangay}</Text>
              <Info size={14} color="#6b7280" style={{ marginLeft: 4 }} />
            </View>
          </View>
        ) : null}

        {discountRecord.city ? (
          <View style={rowStyle}>
            <Text style={labelStyle}>City</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={valueStyle}>{discountRecord.city}</Text>
              <Info size={14} color="#6b7280" style={{ marginLeft: 4 }} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Confirm Approve Modal */}
      <Modal visible={showConfirmModal} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 12,
              padding: 24,
              width: '88%',
              borderWidth: 1,
              borderColor: '#e5e7eb',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>
                Confirm Approval
              </Text>
              <TouchableOpacity
                onPress={() => setShowConfirmModal(false)}
                disabled={isApproving}
              >
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <Text style={{ color: '#374151', marginBottom: 16 }}>
              Are you sure you want to approve this discount?
            </Text>

            <View
              style={{
                backgroundColor: '#f9fafb',
                borderRadius: 8,
                padding: 16,
                borderWidth: 1,
                borderColor: '#e5e7eb',
                marginBottom: 20,
                gap: 8,
              }}
            >
              {[
                { label: 'Account No:', value: discountRecord.accountNo },
                { label: 'Customer:', value: discountRecord.fullName },
                { label: 'Amount:', value: `₱${discountRecord.discountAmount.toFixed(2)}` },
                { label: 'Current Status:', value: discountRecord.discountStatus, color: '#f59e0b' },
                { label: 'New Status:', value: 'Unused', color: '#22c55e' },
              ].map(({ label, value, color }) => (
                <View
                  key={label}
                  style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                >
                  <Text style={{ color: '#6b7280', fontSize: 13 }}>{label}</Text>
                  <Text style={{ color: color || '#111827', fontSize: 13 }}>{value}</Text>
                </View>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowConfirmModal(false)}
                disabled={isApproving}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: '#e5e7eb',
                  alignItems: 'center',
                  opacity: isApproving ? 0.5 : 1,
                }}
              >
                <Text style={{ color: '#111827', fontWeight: '500' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmApprove}
                disabled={isApproving}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: isApproving ? '#4b5563' : primary,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                  opacity: isApproving ? 0.7 : 1,
                }}
              >
                {isApproving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Check size={16} color="#ffffff" />
                )}
                <Text style={{ color: '#ffffff', fontWeight: '500' }}>
                  {isApproving ? 'Approving...' : 'Confirm Approval'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default DiscountDetails;
