import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  Dimensions,
} from 'react-native';
import { X, CheckCircle, Info, CircleArrowRight } from 'lucide-react-native';
import LoadingModal from './common/LoadingModalGlobal';
import * as massRebateService from '../services/massRebateService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import apiClient from '../config/api';
import BillingDetails from './CustomerDetails';
import NotFoundModal from '../modals/NotFoundModal';

const convertCustomerDataToBillingDetail = (customerData: CustomerDetailData): BillingDetailRecord => {
  return {
    id: customerData.billingAccount?.accountNo || '',
    applicationId: customerData.billingAccount?.accountNo || '',
    customerName: customerData.fullName,
    address: customerData.address,
    status: customerData.billingAccount?.billingStatusId === 2 ? 'Active' : 'Inactive',
    balance: customerData.billingAccount?.accountBalance || 0,
    onlineStatus: customerData.billingAccount?.billingStatusId === 2 ? 'Online' : 'Offline',
    cityId: null,
    regionId: null,
    timestamp: customerData.updatedAt || '',
    billingStatus: customerData.billingAccount?.billingStatusId
      ? ({ 1: 'In Progress', 2: 'Active', 3: 'Suspended', 4: 'Cancelled', 5: 'Overdue', 6: 'Service Account' } as Record<number, string>)[customerData.billingAccount.billingStatusId] || `Status ${customerData.billingAccount.billingStatusId}`
      : '',
    dateInstalled: customerData.billingAccount?.dateInstalled || '',
    contactNumber: customerData.contactNumberPrimary,
    secondContactNumber: customerData.contactNumberSecondary || '',
    emailAddress: customerData.emailAddress || '',
    plan: customerData.desiredPlan || '',
    username: customerData.technicalDetails?.username || '',
    connectionType: customerData.technicalDetails?.connectionType || '',
    routerModel: customerData.technicalDetails?.routerModel || '',
    routerModemSN: customerData.technicalDetails?.routerModemSn || '',
    lcpnap: customerData.technicalDetails?.lcpnap || '',
    port: customerData.technicalDetails?.port || '',
    vlan: customerData.technicalDetails?.vlan || '',
    billingDay: customerData.billingAccount?.billingDay || 0,
    totalPaid: 0,
    provider: '',
    lcp: customerData.technicalDetails?.lcp || '',
    nap: customerData.technicalDetails?.nap || '',
    modifiedBy: '',
    modifiedDate: customerData.updatedAt || '',
    barangay: customerData.barangay || '',
    city: customerData.city || '',
    region: customerData.region || '',
    usageType: customerData.technicalDetails?.usageTypeId ? `Type ${customerData.technicalDetails.usageTypeId}` : '',
    referredBy: customerData.referredBy || '',
    referredByAgentId: customerData.referredByAgentId ?? null,
    referralContactNo: '',
    groupName: customerData.groupName || '',
    mikrotikId: '',
    sessionIp: customerData.technicalDetails?.ipAddress || '',
    houseFrontPicture: customerData.houseFrontPictureUrl || '',
    accountBalance: customerData.billingAccount?.accountBalance || 0,
    housingStatus: customerData.housingStatus || '',
    addressCoordinates: customerData.addressCoordinates || '',
    vip_expiration: (customerData.billingAccount as any)?.vip_expiration || '',
    vip_remarks: (customerData.billingAccount as any)?.vip_remarks || '',
  };
};

interface RebateUsage {
  id: number;
  rebates_id: number;
  account_no: string;
  status: string;
  month: string;
}

interface Rebate {
  id: number;
  number_of_dates: number;
  rebate_type: string;
  selected_rebate: string;
  month: string;
  status: string;
  created_by: string;
  modified_by: string | null;
  modified_date: string;
}

interface RebateDetailsProps {
  rebate: Rebate;
  onClose: () => void;
  onViewCustomer?: (accountNo: string) => void;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

const isDarkMode = false;

const RebateDetails: React.FC<RebateDetailsProps> = ({ rebate, onClose, onViewCustomer }) => {
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [rebateUsages, setRebateUsages] = useState<RebateUsage[]>([]);
  const [usagesLoading, setUsagesLoading] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [loadingCustomerOverlay, setLoadingCustomerOverlay] = useState(false);
  const [selectedCustomerForOverlay, setSelectedCustomerForOverlay] = useState<BillingDetailRecord | null>(null);
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null);
  const [currentRebateStatus, setCurrentRebateStatus] = useState(rebate.status);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  const canApprove = currentRebateStatus.toLowerCase() === 'pending';

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(p => setColorPalette(p))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchRebateUsages();
  }, [rebate.id]);

  const fetchRebateUsages = async () => {
    try {
      setUsagesLoading(true);
      const response = await apiClient.get<ApiResponse<RebateUsage[]>>(`/rebates-usage?rebates_id=${rebate.id}`);
      const data = response.data;
      if (data.success) {
        setRebateUsages(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch rebate usages:', err);
    } finally {
      setUsagesLoading(false);
    }
  };

  const formatDate = (dateStr?: string, includeTime: boolean = false): string => {
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

  const handleApproveRebate = () => {
    Alert.alert(
      'Approve Rebate',
      'Are you sure you want to approve this rebate? This will change the status to Unused and the rebate will become available for use.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              setLoading(true);
              setLoadingPercentage(0);
              setError(null);
              setLoadingPercentage(20);

              const result = await massRebateService.update(rebate.id, { status: 'Unused' });
              setLoadingPercentage(60);

              if (result.success) {
                setLoadingPercentage(100);
                setCurrentRebateStatus(result.data?.status || 'Unused');
                await new Promise(resolve => setTimeout(resolve, 500));
                setSuccessMessage('Rebate approved successfully. Status changed to Unused.');
                setShowSuccessModal(true);
              } else {
                setError(result.message || 'Failed to approve rebate');
              }
            } catch (err: any) {
              setError(`Failed to approve rebate: ${err.message}`);
              console.error('Approve rebate error:', err);
            } finally {
              setLoading(false);
              setLoadingPercentage(0);
            }
          }
        }
      ]
    );
  };

  const getDisplayText = () => {
    return `${rebate.rebate_type.toUpperCase()} | ${rebate.selected_rebate} | ${rebate.month}`;
  };

  const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'unused': return '#22c55e';
      case 'used': return '#ef4444';
      case 'pending': return '#eab308';
      default: return '#9ca3af';
    }
  };

  const rowStyle = {
    flexDirection: 'row' as const,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    alignItems: 'flex-start' as const,
  };

  const labelStyle = {
    width: 140,
    fontSize: 13,
    color: '#6b7280',
  };

  const valueStyle = {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  };

  if (selectedCustomerForOverlay) {
    return (
      <Modal visible animationType="slide" onRequestClose={() => setSelectedCustomerForOverlay(null)}>
        <BillingDetails
          billingRecord={selectedCustomerForOverlay}
          onlineStatusRecords={[]}
          onClose={() => setSelectedCustomerForOverlay(null)}
        />
      </Modal>
    );
  }

  return (
    <View style={{
      flex: 1,
      backgroundColor: '#ffffff',
      paddingTop: isTablet ? 16 : 60,
    }}>
      <LoadingModal
        isOpen={loading}
        type="loading"
        title="Processing Rebate"
        message="Processing rebate..."
        loadingPercentage={loadingPercentage}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
      />

      {/* Header */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#f3f4f6',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
      }}>
        <Text style={{
          fontSize: 15,
          fontWeight: '600',
          color: '#111827',
          flex: 1,
          marginRight: 8,
        }} numberOfLines={1}>
          {getDisplayText()}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {canApprove && (
            <TouchableOpacity
              onPress={handleApproveRebate}
              disabled={loading}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: loading ? '#4b5563' : primaryColor,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 6,
                gap: 4,
                opacity: loading ? 0.6 : 1,
              }}
            >
              <CheckCircle size={14} color="#ffffff" />
              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '500' }}>
                {loading ? 'Processing...' : 'Approve'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      {error ? (
        <View style={{
          margin: 12,
          padding: 12,
          backgroundColor: '#fee2e2',
          borderRadius: 6,
          borderWidth: 1,
          borderColor: '#fca5a5',
        }}>
          <Text style={{ color: '#7f1d1d', fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Detail fields */}
        <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
          <View style={rowStyle}>
            <Text style={labelStyle}>Rebate ID</Text>
            <Text style={valueStyle}>{rebate.id}</Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>Rebate Type</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[valueStyle, { textTransform: 'capitalize' }]}>{rebate.rebate_type}</Text>
              <Info size={14} color="#9ca3af" style={{ marginLeft: 6 }} />
            </View>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>Selected Rebate</Text>
            <Text style={valueStyle}>{rebate.selected_rebate}</Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>Month</Text>
            <Text style={valueStyle}>{rebate.month}</Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>Number of Days</Text>
            <Text style={[valueStyle, { fontWeight: 'bold', fontSize: 16 }]}>{rebate.number_of_dates}</Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>Status</Text>
            <Text style={[valueStyle, { color: getStatusColor(currentRebateStatus), fontWeight: '600', textTransform: 'capitalize' }]}>
              {currentRebateStatus}
            </Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>Created By</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={valueStyle}>{rebate.created_by || '-'}</Text>
              <Info size={14} color="#9ca3af" style={{ marginLeft: 6 }} />
            </View>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>Approved By</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={valueStyle}>{rebate.modified_by || '-'}</Text>
              {rebate.modified_by ? <Info size={14} color="#9ca3af" style={{ marginLeft: 6 }} /> : null}
            </View>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>Modified Date</Text>
            <Text style={valueStyle}>{formatDate(rebate.modified_date, true)}</Text>
          </View>
        </View>

        {/* Affected Accounts */}
        <View style={{
          marginTop: 16,
          paddingHorizontal: 16,
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          paddingTop: 16,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }}>
              Affected Accounts
            </Text>
            <View style={{
              marginLeft: 8,
              backgroundColor: '#d1d5db',
              borderRadius: 10,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}>
              <Text style={{ fontSize: 11, color: '#111827', fontWeight: '600' }}>
                {rebateUsages.length}
              </Text>
            </View>
          </View>

          {usagesLoading ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator color={primaryColor} />
              <Text style={{ marginTop: 8, color: '#6b7280', fontSize: 13 }}>Loading accounts...</Text>
            </View>
          ) : rebateUsages.length > 0 ? (
            <View>
              {/* Header row */}
              <View style={{
                flexDirection: 'row',
                backgroundColor: '#f3f4f6',
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 6,
                marginBottom: 4,
              }}>
                <Text style={{ flex: 2, fontSize: 11, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase' }}>Account No</Text>
                <Text style={{ flex: 1, fontSize: 11, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase' }}>Status</Text>
                <Text style={{ flex: 1, fontSize: 11, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase' }}>Month</Text>
              </View>
              {rebateUsages.map((usage) => (
                <View key={usage.id} style={{
                  flexDirection: 'row',
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: '#e5e7eb',
                  alignItems: 'center',
                }}>
                  <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, color: '#111827', marginRight: 4 }}>{usage.account_no}</Text>
                    <TouchableOpacity
                      disabled={loadingCustomerOverlay}
                      onPress={async () => {
                        const accNo = usage.account_no;
                        if (!accNo || accNo === '-') return;
                        try {
                          setLoadingCustomerOverlay(true);
                          const details = await getCustomerDetail(String(accNo));
                          if (details) {
                            setSelectedCustomerForOverlay(convertCustomerDataToBillingDetail(details));
                          } else {
                            setNotFoundMessage('Customer details not found.');
                          }
                        } catch (err) {
                          console.error('Error finding customer', err);
                        } finally {
                          setLoadingCustomerOverlay(false);
                        }
                      }}
                      style={{ opacity: loadingCustomerOverlay ? 0.5 : 1 }}
                    >
                      {loadingCustomerOverlay
                        ? <ActivityIndicator size="small" color={primaryColor} />
                        : <CircleArrowRight size={14} color={primaryColor} />
                      }
                    </TouchableOpacity>
                  </View>
                  <Text style={{
                    flex: 1,
                    fontSize: 13,
                    color: getStatusColor(usage.status),
                    fontWeight: '500',
                    textTransform: 'capitalize',
                  }}>
                    {usage.status}
                  </Text>
                  <Text style={{ flex: 1, fontSize: 13, color: '#111827' }}>{usage.month}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <Text style={{ color: '#9ca3af', fontSize: 14 }}>No affected accounts found</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSuccessModal(false)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}>
          <View style={{
            backgroundColor: '#ffffff',
            borderRadius: 12,
            padding: 24,
            width: '100%',
            maxWidth: 400,
            borderWidth: 1,
            borderColor: '#e5e7eb',
          }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 12 }}>
              Success
            </Text>
            <Text style={{ fontSize: 14, color: '#374151', marginBottom: 20 }}>
              {successMessage}
            </Text>
            <View style={{ alignItems: 'flex-end' }}>
              <TouchableOpacity
                onPress={() => {
                  setShowSuccessModal(false);
                  onClose();
                }}
                style={{
                  backgroundColor: primaryColor,
                  paddingHorizontal: 20,
                  paddingVertical: 8,
                  borderRadius: 6,
                }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Not Found Modal */}
      <NotFoundModal
        isOpen={!!notFoundMessage}
        onClose={() => setNotFoundMessage(null)}
        message={notFoundMessage || ''}
      />
    </View>
  );
};

export default RebateDetails;
