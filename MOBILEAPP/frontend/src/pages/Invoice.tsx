import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  Linking,
  StyleSheet,
} from 'react-native';
import { RefreshCw, FileText, ChevronLeft, ChevronRight } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import InvoiceDetails from '../components/InvoiceDetails';
import BillingDetails from '../components/CustomerDetails';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { paymentService, PendingPayment } from '../services/paymentService';
import { useInvoiceContext, InvoiceRecordUI } from '../contexts/InvoiceContext';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import { accountStatusFrom, sessionStatusFrom } from '../utils/onlineStatus';

const convertCustomerDataToBillingDetail = (customerData: CustomerDetailData): BillingDetailRecord => {
  return {
    id: customerData.billingAccount?.accountNo || '',
    applicationId: customerData.billingAccount?.accountNo || '',
    customerName: customerData.fullName,
    address: customerData.address,
    status: accountStatusFrom(customerData),
    balance: customerData.billingAccount?.accountBalance || 0,
    onlineStatus: sessionStatusFrom(customerData),
    cityId: null,
    regionId: null,
    timestamp: customerData.updatedAt || '',
    billingStatus: customerData.billingAccount?.billingStatusId ? `Status ${customerData.billingAccount.billingStatusId}` : '',
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
    referralContactNo: '',
    groupName: customerData.groupName || '',
    mikrotikId: '',
    sessionIp: customerData.technicalDetails?.ipAddress || '',
    houseFrontPicture: customerData.houseFrontPictureUrl || '',
    accountBalance: customerData.billingAccount?.accountBalance || 0,
    housingStatus: customerData.housingStatus || '',
    location: (customerData as any).location || '',
    addressCoordinates: customerData.addressCoordinates || '',
  };
};

const statusColor = (status: string) => {
  if (status === 'Unpaid') return '#ef4444';
  if (status === 'Paid') return '#22c55e';
  return '#eab308';
};

const peso = (v: number | undefined) => `₱ ${(v ?? 0).toFixed(2)}`;

const Invoice: React.FC = () => {
  const { invoiceRecords, isLoading, error, silentRefresh } = useInvoiceContext();
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRecord, setSelectedRecord] = useState<InvoiceRecordUI | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [accountNo, setAccountNo] = useState<string>('');
  const [accountBalance, setAccountBalance] = useState<number>(0);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState<boolean>(false);
  const [showPaymentVerifyModal, setShowPaymentVerifyModal] = useState<boolean>(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [fullName, setFullName] = useState<string>('');
  const [showPaymentLinkModal, setShowPaymentLinkModal] = useState<boolean>(false);
  const [paymentLinkData, setPaymentLinkData] = useState<{ referenceNo: string; amount: number; paymentUrl: string } | null>(null);
  const [showPendingPaymentModal, setShowPendingPaymentModal] = useState<boolean>(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const dateItems: Array<{ date: string; id: string }> = useMemo(() => {
    const dates = new Set<string>();
    invoiceRecords.forEach((record) => {
      if (record.invoiceDate) dates.add(record.invoiceDate);
    });
    return [{ date: 'All', id: '' }, ...Array.from(dates).sort().reverse().map((d) => ({ date: d, id: d }))];
  }, [invoiceRecords]);

  useEffect(() => {
    (async () => {
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const user = JSON.parse(authData);
          setUserRole(user.role?.toLowerCase() || '');
          setAccountNo(user.username || '');
          const balance = parseFloat(user.account_balance || '0');
          setAccountBalance(balance);
          setPaymentAmount(balance > 0 ? balance : 100);
          setFullName(user.full_name || '');
        }
      } catch (err) {
        console.error('Error parsing auth data:', err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setColorPalette(await settingsColorPaletteService.getActive());
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    })();
  }, []);

  useEffect(() => {
    silentRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRecords = useMemo(() => {
    return invoiceRecords.filter((record) => {
      const matchesDate = selectedDate === 'All' || record.invoiceDate === selectedDate;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        searchQuery === '' ||
        record.fullName?.toLowerCase().includes(q) ||
        record.address?.toLowerCase().includes(q) ||
        record.accountNo.includes(searchQuery) ||
        record.id.includes(searchQuery) ||
        record.status.toLowerCase().includes(q) ||
        (record.transactionId && record.transactionId.toLowerCase().includes(q));
      return matchesDate && matchesSearch;
    });
  }, [invoiceRecords, selectedDate, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDate, searchQuery]);

  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRecords.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRecords, currentPage]);

  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  const handleRowPress = (record: InvoiceRecordUI) => {
    if (userRole !== 'customer') {
      setSelectedRecord(record);
      setSelectedCustomer(null);
    }
  };

  const handleViewCustomer = async (acct: string) => {
    setIsLoadingDetails(true);
    try {
      const detail = await getCustomerDetail(acct);
      if (detail) setSelectedCustomer(detail);
    } catch (err) {
      console.error('Error fetching customer details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await silentRefresh();
    setRefreshing(false);
  };

  const handlePayNow = async () => {
    setErrorMessage('');
    setIsPaymentProcessing(true);
    try {
      const pending = await paymentService.checkPendingPayment(accountNo);
      if (pending && pending.payment_url) {
        setPendingPayment(pending);
        setShowPendingPaymentModal(true);
      } else {
        setPaymentAmount(accountBalance > 0 ? accountBalance : 100);
        setShowPaymentVerifyModal(true);
      }
    } catch (err) {
      console.error('Error checking pending payment:', err);
      setPaymentAmount(accountBalance > 0 ? accountBalance : 100);
      setShowPaymentVerifyModal(true);
    } finally {
      setIsPaymentProcessing(false);
    }
  };

  const handleCloseVerifyModal = () => {
    setShowPaymentVerifyModal(false);
    setPaymentAmount(accountBalance);
  };

  const handleProceedToCheckout = async () => {
    if (paymentAmount < 1) {
      setErrorMessage('Payment amount must be at least ₱1.00');
      return;
    }
    if (isPaymentProcessing) return;
    setIsPaymentProcessing(true);
    setErrorMessage('');
    try {
      const response = await paymentService.createPayment(accountNo, paymentAmount);
      if (response.status === 'success' && response.payment_url) {
        setShowPaymentVerifyModal(false);
        setPaymentLinkData({
          referenceNo: response.reference_no || '',
          amount: response.amount || paymentAmount,
          paymentUrl: response.payment_url,
        });
        setShowPaymentLinkModal(true);
      } else {
        throw new Error(response.message || 'Failed to create payment link');
      }
    } catch (err: any) {
      console.error('Payment error:', err);
      setErrorMessage(err.message || 'Failed to create payment. Please try again.');
    } finally {
      setIsPaymentProcessing(false);
    }
  };

  const handleOpenPaymentLink = () => {
    if (paymentLinkData?.paymentUrl) {
      Linking.openURL(paymentLinkData.paymentUrl);
      setShowPaymentLinkModal(false);
      setPaymentLinkData(null);
    }
  };

  const handleResumePendingPayment = () => {
    if (pendingPayment && pendingPayment.payment_url) {
      Linking.openURL(pendingPayment.payment_url);
      setShowPendingPaymentModal(false);
      setPendingPayment(null);
    }
  };

  const handleCancelPendingPayment = () => {
    setShowPendingPaymentModal(false);
    setPendingPayment(null);
  };

  const renderItem = ({ item }: { item: InvoiceRecordUI }) => {
    const isCustomer = userRole === 'customer';
    return (
      <TouchableOpacity
        activeOpacity={isCustomer ? 1 : 0.7}
        onPress={() => handleRowPress(item)}
        style={styles.card}
      >
        <View style={styles.cardHeaderRow}>
          <Text style={styles.acctText}>{item.accountNo}</Text>
          <View style={[styles.statusPill, { backgroundColor: `${statusColor(item.status)}20` }]}>
            <Text style={[styles.statusText, { color: statusColor(item.status) }]}>{item.status}</Text>
          </View>
        </View>
        {!isCustomer && item.fullName ? <Text style={styles.nameText}>{item.fullName}</Text> : null}
        <View style={styles.metaRow}>
          <MetaItem label="Invoice Date" value={item.invoiceDate || '-'} />
          <MetaItem label="Due Date" value={item.dueDate || '-'} />
        </View>
        <View style={styles.metaRow}>
          <MetaItem label="Total Amount" value={peso(item.totalAmount)} valueColor="#111827" />
          <MetaItem label="Received" value={peso(item.receivedPayment)} />
        </View>
        {!isCustomer ? (
          <View style={styles.metaRow}>
            <MetaItem label="Invoice Balance" value={peso(item.invoiceBalance)} />
            <MetaItem label="Transaction ID" value={item.transactionId || 'NULL'} />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: isTablet ? 16 : 60 }]}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>Invoices</Text>
          <View style={styles.countPill}>
            <Text style={styles.countText}>{filteredRecords.length} records</Text>
          </View>
        </View>
        <View style={styles.headerControlsRow}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={false}
            colorPalette={colorPalette}
            placeholder="Search invoice records..."
          />
          {userRole === 'customer' ? (
            <TouchableOpacity
              onPress={handlePayNow}
              disabled={isPaymentProcessing}
              style={[styles.iconBtn, { backgroundColor: isPaymentProcessing ? '#6b7280' : primaryColor, paddingHorizontal: 14 }]}
            >
              <Text style={styles.payNowText}>{isPaymentProcessing ? '...' : 'Pay Now'}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={handleRefresh} disabled={isLoading} style={[styles.iconBtn, { backgroundColor: primaryColor }]}>
            {isLoading ? <ActivityIndicator size="small" color="#fff" /> : <RefreshCw size={16} color="#fff" />}
          </TouchableOpacity>
        </View>

        {/* Date filter chips (admin only) */}
        {userRole !== 'customer' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {dateItems.map((item, index) => {
              const active = selectedDate === item.date;
              return (
                <TouchableOpacity
                  key={index}
                  onPress={() => setSelectedDate(item.date)}
                  style={[styles.chip, active ? { backgroundColor: `${primaryColor}22`, borderColor: primaryColor } : null]}
                >
                  <FileText size={12} color={active ? primaryColor : '#6b7280'} />
                  <Text style={[styles.chipText, active ? { color: primaryColor, fontWeight: '600' } : null]}>{item.date}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {/* Body */}
      {isLoading && invoiceRecords.length === 0 ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.mutedText}>Loading invoice records...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={handleRefresh} style={[styles.retryBtn, { backgroundColor: primaryColor }]}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={paginatedRecords}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Text style={styles.mutedText}>No invoice records found matching your filters</Text>
            </View>
          }
          ListFooterComponent={
            totalPages > 1 ? (
              <View style={styles.pagination}>
                <TouchableOpacity onPress={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} style={styles.pageBtn}>
                  <ChevronLeft size={20} color={currentPage === 1 ? '#d1d5db' : primaryColor} />
                </TouchableOpacity>
                <Text style={styles.pageText}>
                  Page {currentPage} of {totalPages}
                </Text>
                <TouchableOpacity onPress={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} style={styles.pageBtn}>
                  <ChevronRight size={20} color={currentPage === totalPages ? '#d1d5db' : primaryColor} />
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* Invoice Detail Modal (admin) */}
      <Modal visible={!!selectedRecord && userRole !== 'customer'} animationType="slide" onRequestClose={() => setSelectedRecord(null)}>
        {selectedRecord ? (
          <InvoiceDetails
            invoiceRecord={selectedRecord as any}
            onViewCustomer={handleViewCustomer}
            onClose={() => setSelectedRecord(null)}
          />
        ) : null}
      </Modal>

      {/* Customer Detail Modal */}
      <Modal visible={!!selectedCustomer || isLoadingDetails} animationType="slide" onRequestClose={() => setSelectedCustomer(null)}>
        {isLoadingDetails ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={styles.mutedText}>Loading details...</Text>
          </View>
        ) : selectedCustomer ? (
          <BillingDetails
            billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
            onlineStatusRecords={[]}
            onClose={() => setSelectedCustomer(null)}
          />
        ) : null}
      </Modal>

      {/* Payment Verify Modal */}
      <Modal visible={showPaymentVerifyModal} transparent animationType="fade" onRequestClose={handleCloseVerifyModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Payment</Text>
            <View style={styles.modalInfoBox}>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Account:</Text>
                <Text style={styles.modalRowValueBold}>{fullName}</Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Current Balance:</Text>
                <Text style={[styles.modalRowValueBold, { color: accountBalance > 0 ? '#ef4444' : '#22c55e' }]}>₱{accountBalance.toFixed(2)}</Text>
              </View>
            </View>
            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorBoxText}>{errorMessage}</Text>
              </View>
            ) : null}
            <Text style={styles.inputLabel}>Payment Amount</Text>
            <TextInput
              value={String(paymentAmount)}
              onChangeText={(t) => setPaymentAmount(parseFloat(t) || 0)}
              keyboardType="numeric"
              style={styles.amountInput}
            />
            <Text style={styles.helperText}>
              {accountBalance > 0 ? `Outstanding balance: ₱${accountBalance.toFixed(2)}` : 'Minimum: ₱1.00'}
            </Text>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity onPress={handleCloseVerifyModal} disabled={isPaymentProcessing} style={[styles.modalBtn, styles.cancelBtn]}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleProceedToCheckout}
                disabled={isPaymentProcessing || paymentAmount < 1}
                style={[styles.modalBtn, { backgroundColor: isPaymentProcessing || paymentAmount < 1 ? '#6b7280' : primaryColor }]}
              >
                {isPaymentProcessing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.proceedBtnText}>PROCEED TO CHECKOUT</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pending Payment Modal */}
      <Modal visible={showPendingPaymentModal && !!pendingPayment} transparent animationType="fade" onRequestClose={handleCancelPendingPayment}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Transaction In Progress</Text>
            <View style={styles.modalInfoBox}>
              <Text style={styles.pendingText}>
                You have a pending payment ({pendingPayment?.reference_no}). The link is still active.
              </Text>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Amount:</Text>
                <Text style={[styles.modalRowValueBold, { color: primaryColor }]}>₱{pendingPayment?.amount?.toFixed(2) || '0.00'}</Text>
              </View>
            </View>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity onPress={handleCancelPendingPayment} style={[styles.modalBtn, styles.cancelBtn]}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleResumePendingPayment} style={[styles.modalBtn, { backgroundColor: primaryColor }]}>
                <Text style={styles.proceedBtnText}>Pay Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Payment Link Modal */}
      <Modal visible={showPaymentLinkModal && !!paymentLinkData} transparent animationType="fade" onRequestClose={() => setShowPaymentLinkModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Proceed to Payment Portal</Text>
            <View style={styles.modalInfoBox}>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Reference:</Text>
                <Text style={styles.modalRowValueBold}>{paymentLinkData?.referenceNo}</Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Amount:</Text>
                <Text style={[styles.modalRowValueBold, { color: primaryColor }]}>₱{paymentLinkData?.amount?.toFixed(2) || '0.00'}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleOpenPaymentLink} style={[styles.modalBtn, { backgroundColor: primaryColor }]}>
              <Text style={styles.proceedBtnText}>PROCEED</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const MetaItem: React.FC<{ label: string; value: string; valueColor?: string }> = ({ label, value, valueColor }) => (
  <View style={{ flex: 1 }}>
    <Text style={styles.metaLabel}>{label}</Text>
    <Text style={[styles.metaValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: { paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', gap: 10 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: '600', color: '#111827' },
  countPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#e5e7eb' },
  countText: { fontSize: 11, fontWeight: '500', color: '#6b7280' },
  headerControlsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: { padding: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  payNowText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipRow: { gap: 8, paddingVertical: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff' },
  chipText: { fontSize: 12, color: '#6b7280' },
  card: { backgroundColor: '#ffffff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb', gap: 8 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  acctText: { fontSize: 14, fontWeight: '700', color: '#ef4444' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '700' },
  nameText: { fontSize: 13, fontWeight: '600', color: '#111827' },
  metaRow: { flexDirection: 'row', gap: 12 },
  metaLabel: { fontSize: 10, fontWeight: '500', color: '#9ca3af' },
  metaValue: { fontSize: 12, fontWeight: '600', color: '#374151' },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 },
  mutedText: { color: '#6b7280', marginTop: 4 },
  errorText: { fontSize: 15, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '600' },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, paddingVertical: 16 },
  pageBtn: { padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff' },
  pageText: { fontSize: 13, color: '#374151' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 440, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center' },
  modalInfoBox: { backgroundColor: '#f3f4f6', borderRadius: 8, padding: 16, gap: 8 },
  modalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalRowLabel: { fontSize: 14, color: '#6b7280' },
  modalRowValueBold: { fontSize: 14, fontWeight: '700', color: '#111827' },
  pendingText: { fontSize: 13, color: '#374151', textAlign: 'center', marginBottom: 8 },
  errorBox: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 6, padding: 12 },
  errorBoxText: { color: '#ef4444', fontSize: 13, textAlign: 'center' },
  inputLabel: { fontSize: 14, fontWeight: '700', color: '#111827' },
  amountInput: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, fontSize: 18, fontWeight: '700', color: '#111827' },
  helperText: { fontSize: 12, color: '#6b7280', textAlign: 'right' },
  modalButtonRow: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { backgroundColor: '#e5e7eb' },
  cancelBtnText: { color: '#374151', fontWeight: '700' },
  proceedBtnText: { color: '#fff', fontWeight: '700' },
});

export default Invoice;
