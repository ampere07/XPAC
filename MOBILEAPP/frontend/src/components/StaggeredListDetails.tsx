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
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  CircleArrowRight,
  Loader,
  ExternalLink,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { staggeredInstallationService } from '../services/staggeredInstallationService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import BillingDetails from './CustomerDetails';
import NotFoundModal from '../modals/NotFoundModal';

const convertCustomerDataToBillingDetail = (customerData: CustomerDetailData): BillingDetailRecord => {
  return {
    id: customerData.billingAccount?.accountNo || '',
    applicationId: customerData.billingAccount?.accountNo || '',
    accountNo: customerData.billingAccount?.accountNo || '',
    account_no: customerData.billingAccount?.accountNo || '',
    customerName: customerData.fullName,
    firstName: customerData.firstName,
    lastName: customerData.lastName,
    middleInitial: customerData.middleInitial,
    address: customerData.address,
    status: customerData.billingAccount?.billingStatusName || (customerData.billingAccount?.billingStatusId === 2 ? 'Active' : 'Inactive'),
    balance: customerData.billingAccount?.accountBalance || 0,
    onlineStatus: (customerData as any).onlineSessionStatus || 'Empty',
    cityId: null,
    regionId: null,
    timestamp: customerData.updatedAt || '',
    billingStatus: customerData.billingAccount?.billingStatusName || (customerData.billingAccount?.billingStatusId
      ? ({ 1: 'In Progress', 2: 'Active', 3: 'Suspended', 4: 'Cancelled', 5: 'Overdue', 6: 'Service Account' } as Record<number, string>)[customerData.billingAccount.billingStatusId] || `Status ${customerData.billingAccount.billingStatusId}`
      : ''),
    dateInstalled: customerData.billingAccount?.dateInstalled || '',
    contactNumber: customerData.contactNumberPrimary,
    secondContactNumber: customerData.contactNumberSecondary || '',
    emailAddress: customerData.emailAddress || '',
    email: customerData.emailAddress || '',
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
    accountNoCustomer: (customerData as any).accountNoCustomer,
    proofOfBillingUrl: (customerData as any).proofOfBillingUrl,
    governmentValidIdUrl: (customerData as any).governmentValidIdUrl,
    secondGovernmentValidIdUrl: (customerData as any).secondGovernmentValidIdUrl,
    documentAttachmentUrl: (customerData as any).documentAttachmentUrl,
    otherIspBillUrl: (customerData as any).otherIspBillUrl,
    customerCreatedAt: (customerData as any).createdAt,
    customerUpdatedAt: customerData.updatedAt,
    customerUpdatedBy: (customerData as any).updatedBy,
    billingAccountCreatedAt: (customerData.billingAccount as any)?.createdAt,
    billingAccountUpdatedAt: (customerData.billingAccount as any)?.updatedAt,
    billingAccountCreatedBy: (customerData.billingAccount as any)?.createdBy,
    billingAccountUpdatedBy: (customerData.billingAccount as any)?.updatedBy,
    balanceUpdateDate: (customerData.billingAccount as any)?.balanceUpdateDate,
    techCreatedAt: (customerData.technicalDetails as any)?.createdAt,
    techUpdatedAt: (customerData.technicalDetails as any)?.updatedAt,
    techCreatedBy: (customerData.technicalDetails as any)?.createdBy,
    techUpdatedBy: (customerData.technicalDetails as any)?.updatedBy,
    usernameStatus: (customerData.technicalDetails as any)?.usernameStatus,
    vip_expiration: (customerData.billingAccount as any)?.vip_expiration || '',
    vip_remarks: (customerData.billingAccount as any)?.vip_remarks || '',
  };
};

interface StaggeredInstallation {
  id: string;
  account_no: string;
  staggered_install_no: string;
  staggered_date: string;
  staggered_balance: number;
  months_to_pay: number;
  monthly_payment: number;
  modified_by: string;
  modified_date: string;
  user_email: string;
  remarks: string;
  status: string;
  month1: string | null;
  month2: string | null;
  month3: string | null;
  month4: string | null;
  month5: string | null;
  month6: string | null;
  month7: string | null;
  month8: string | null;
  month9: string | null;
  month10: string | null;
  month11: string | null;
  month12: string | null;
  created_at: string;
  updated_at: string;
  billing_account?: {
    id: number;
    account_no: string;
    customer: {
      full_name: string;
      contact_number_primary: string;
      barangay: string;
      city: string;
      desired_plan: string;
      address: string;
      region: string;
    };
    account_balance: number;
  };
}

interface StaggeredListDetailsProps {
  staggered: StaggeredInstallation;
  onClose: () => void;
  onViewCustomer?: (accountNo: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const StaggeredListDetails: React.FC<StaggeredListDetailsProps> = ({
  staggered,
  onClose,
  onViewCustomer,
  onPrevious,
  onNext,
}) => {
  const isDarkMode = false;
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');

  // Overlay states
  const [loadingCustomerOverlay, setLoadingCustomerOverlay] = useState(false);
  const [selectedCustomerForOverlay, setSelectedCustomerForOverlay] = useState<BillingDetailRecord | null>(null);
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null);

  const primary = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
    AsyncStorage.getItem('authData').then(raw => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setCurrentUserEmail(parsed.email || '');
        } catch {}
      }
    });
  }, []);

  const formatCurrency = (amount: number | string) => {
    const n = typeof amount === 'string' ? parseFloat(amount) : amount;
    return `₱${(isNaN(n) ? 0 : n).toFixed(2)}`;
  };

  const formatDate = (dateStr?: string | null, includeTime = false): string => {
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
        hours = hours % 12 || 12;
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${mm}/${dd}/${yyyy} ${hours}:${minutes}:${seconds} ${ampm}`;
      }
      return `${mm}/${dd}/${yyyy}`;
    } catch {
      return dateStr;
    }
  };

  const getAccountDisplayText = () => {
    const accountNo = staggered.billing_account?.account_no || staggered.account_no || '-';
    const fullName = staggered.billing_account?.customer?.full_name || '-';
    const address = staggered.billing_account?.customer?.address || '';
    const barangay = staggered.billing_account?.customer?.barangay || '';
    const city = staggered.billing_account?.customer?.city || '';
    const region = staggered.billing_account?.customer?.region || '';
    const location = [address, barangay, city, region].filter(Boolean).join(', ');
    return `${accountNo} | ${fullName}${location ? ` | ${location}` : ''}`;
  };

  const getMonthPayments = (): Array<{ month: number; invoiceId: string }> => {
    const months: Array<{ month: number; invoiceId: string }> = [];
    for (let i = 1; i <= 12; i++) {
      const monthKey = `month${i}` as keyof StaggeredInstallation;
      const value = staggered[monthKey];
      if (typeof value === 'string' && value) {
        months.push({ month: i, invoiceId: value });
      }
    }
    return months;
  };

  const handleApproveStaggered = () => {
    Alert.alert(
      'Approve Staggered Installation',
      'Are you sure you want to approve this staggered installation? This will deduct the staggered balance from the account and apply it to unpaid invoices.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setLoading(true);
            setLoadingPercentage(0);
            const progressInterval = setInterval(() => {
              setLoadingPercentage(prev => {
                if (prev >= 95) return 95;
                return prev + 5;
              });
            }, 200);
            try {
              const result = await staggeredInstallationService.approve(staggered.id);
              clearInterval(progressInterval);
              setLoadingPercentage(100);
              if (result.success) {
                Alert.alert('Success', result.message || 'Staggered installation approved successfully', [
                  { text: 'OK', onPress: onClose },
                ]);
              } else {
                Alert.alert('Error', result.message || 'Failed to approve staggered installation');
              }
            } catch (err: any) {
              clearInterval(progressInterval);
              Alert.alert('Error', `Failed to approve: ${err.message || 'Unknown error'}`);
            } finally {
              setLoading(false);
              setLoadingPercentage(0);
            }
          },
        },
      ]
    );
  };

  const handleViewCustomerOverlay = async () => {
    const accNo = staggered.billing_account?.account_no || staggered.account_no;
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
  };

  const canApprove =
    staggered.status.toLowerCase() === 'pending' &&
    currentUserEmail &&
    staggered.modified_by.toLowerCase() === currentUserEmail.toLowerCase();

  const statusColor = (s: string) => {
    switch (s.toLowerCase()) {
      case 'active': return '#22c55e';
      case 'pending': return '#eab308';
      case 'completed': return '#3b82f6';
      default: return '#9ca3af';
    }
  };

  const RowItem = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={{
      flexDirection: 'row',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    }}>
      <Text style={{ width: 140, fontSize: 13, color: '#6b7280' }}>{label}</Text>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {/* Loading overlay */}
      {loading && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 100,
        }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 32, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={primary} />
            <Text style={{ marginTop: 16, fontSize: 28, fontWeight: 'bold', color: '#111827' }}>
              {loadingPercentage}%
            </Text>
          </View>
        </View>
      )}

      <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
        {/* Header */}
        <View style={{
          backgroundColor: '#f3f4f6',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingTop: 60,
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '500', color: '#111827' }} numberOfLines={2}>
                {getAccountDisplayText()}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity onPress={onPrevious} disabled={!onPrevious}
                style={{ padding: 6, opacity: onPrevious ? 1 : 0.3 }}>
                <ChevronLeft size={20} color="#374151" />
              </TouchableOpacity>
              <TouchableOpacity onPress={onNext} disabled={!onNext}
                style={{ padding: 6, opacity: onNext ? 1 : 0.3 }}>
                <ChevronRight size={20} color="#374151" />
              </TouchableOpacity>
              {canApprove && (
                <TouchableOpacity
                  onPress={handleApproveStaggered}
                  disabled={loading}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: primary,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                    gap: 4,
                    opacity: loading ? 0.5 : 1,
                  }}
                >
                  <CheckCircle size={14} color="#ffffff" />
                  <Text style={{ color: '#ffffff', fontSize: 13 }}>Approve</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          {/* Details */}
          <View style={{ backgroundColor: '#ffffff', borderRadius: 8, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e5e7eb' }}>
            <RowItem label="Staggered ID">
              <Text style={{ color: '#111827' }}>{staggered.id}</Text>
            </RowItem>
            <RowItem label="Install No.">
              <Text style={{ color: '#111827' }}>{staggered.staggered_install_no}</Text>
            </RowItem>
            <RowItem label="Account No.">
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: '#f87171', fontWeight: '500', marginRight: 8 }}>
                  {staggered.billing_account?.account_no || staggered.account_no || '-'}
                </Text>
                <TouchableOpacity
                  onPress={handleViewCustomerOverlay}
                  disabled={loadingCustomerOverlay}
                  style={{ opacity: loadingCustomerOverlay ? 0.5 : 1 }}
                >
                  {loadingCustomerOverlay
                    ? <ActivityIndicator size="small" color={primary} />
                    : <CircleArrowRight size={16} color={primary} />}
                </TouchableOpacity>
              </View>
            </RowItem>
            <RowItem label="Full Name">
              <Text style={{ color: '#111827' }}>{staggered.billing_account?.customer?.full_name || '-'}</Text>
            </RowItem>
            <RowItem label="Contact No.">
              <Text style={{ color: '#111827' }}>{staggered.billing_account?.customer?.contact_number_primary || '-'}</Text>
            </RowItem>
            <RowItem label="Staggered Balance">
              <Text style={{ color: '#111827', fontWeight: 'bold', fontSize: 16 }}>
                {formatCurrency(staggered.staggered_balance)}
              </Text>
            </RowItem>
            <RowItem label="Monthly Payment">
              <Text style={{ color: '#111827', fontWeight: 'bold', fontSize: 16 }}>
                {formatCurrency(staggered.monthly_payment)}
              </Text>
            </RowItem>
            <RowItem label="Months to Pay">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{
                  fontWeight: 'bold',
                  color: staggered.months_to_pay === 0 ? '#22c55e' : '#f97316',
                }}>
                  {staggered.months_to_pay}
                </Text>
                <Text style={{ color: '#6b7280', fontSize: 13 }}>
                  {staggered.months_to_pay === 0
                    ? 'Completed'
                    : `${staggered.months_to_pay} month${staggered.months_to_pay !== 1 ? 's' : ''} remaining`}
                </Text>
              </View>
            </RowItem>
            <RowItem label="Staggered Date">
              <Text style={{ color: '#111827' }}>{formatDate(staggered.staggered_date)}</Text>
            </RowItem>
            <RowItem label="Modified By">
              <Text style={{ color: '#111827' }}>{staggered.modified_by || '-'}</Text>
            </RowItem>
            <RowItem label="User Email">
              <Text style={{ color: '#111827' }}>{staggered.user_email || '-'}</Text>
            </RowItem>
            <RowItem label="Remarks">
              <Text style={{ color: '#111827' }}>{staggered.remarks || 'No remarks'}</Text>
            </RowItem>
            <RowItem label="Status">
              <Text style={{ color: statusColor(staggered.status), textTransform: 'capitalize' }}>
                {staggered.status}
              </Text>
            </RowItem>
            <RowItem label="Barangay">
              <Text style={{ color: '#111827' }}>{staggered.billing_account?.customer?.barangay || '-'}</Text>
            </RowItem>
            <RowItem label="City">
              <Text style={{ color: '#111827' }}>{staggered.billing_account?.customer?.city || '-'}</Text>
            </RowItem>
            <RowItem label="Region">
              <Text style={{ color: '#111827' }}>{staggered.billing_account?.customer?.region || '-'}</Text>
            </RowItem>
            <RowItem label="Plan">
              <Text style={{ color: '#111827' }}>{staggered.billing_account?.customer?.desired_plan || '-'}</Text>
            </RowItem>
            <RowItem label="Account Balance">
              <Text style={{ color: '#111827' }}>{formatCurrency(staggered.billing_account?.account_balance || 0)}</Text>
            </RowItem>
            <RowItem label="Modified At">
              <Text style={{ color: '#111827' }}>{formatDate(staggered.modified_date, true)}</Text>
            </RowItem>
            <RowItem label="Updated At">
              <Text style={{ color: '#111827' }}>{formatDate(staggered.updated_at, true)}</Text>
            </RowItem>
          </View>

          {/* Monthly Payment History */}
          <View style={{ backgroundColor: '#ffffff', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }}>Monthly Payment History</Text>
              <View style={{
                marginLeft: 8, backgroundColor: '#e5e7eb', borderRadius: 10,
                paddingHorizontal: 8, paddingVertical: 2,
              }}>
                <Text style={{ fontSize: 12, color: '#111827' }}>{getMonthPayments().length}</Text>
              </View>
            </View>
            {getMonthPayments().length > 0 ? (
              getMonthPayments().map((payment) => (
                <View key={payment.month} style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  padding: 12, borderRadius: 6, backgroundColor: '#f3f4f6', marginBottom: 8,
                }}>
                  <Text style={{ fontWeight: '500', color: '#374151' }}>Month {payment.month}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: '#6b7280', fontSize: 13 }}>Invoice ID: {payment.invoiceId}</Text>
                    <ExternalLink size={14} color="#f97316" />
                  </View>
                </View>
              ))
            ) : (
              <Text style={{ color: '#6b7280', textAlign: 'center', paddingVertical: 24 }}>
                No payment history yet
              </Text>
            )}
          </View>
        </ScrollView>
      </View>

      {/* Customer overlay modal */}
      {selectedCustomerForOverlay && (
        <Modal visible animationType="slide" onRequestClose={() => setSelectedCustomerForOverlay(null)}>
          <BillingDetails
            billingRecord={selectedCustomerForOverlay}
            onlineStatusRecords={[]}
            onClose={() => setSelectedCustomerForOverlay(null)}
          />
        </Modal>
      )}

      <NotFoundModal
        isOpen={!!notFoundMessage}
        onClose={() => setNotFoundMessage(null)}
        message={notFoundMessage || ''}
      />
    </Modal>
  );
};

export default StaggeredListDetails;
