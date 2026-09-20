import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  Linking,
  StyleSheet,
} from 'react-native';
import { FileText } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import InvoiceDetails from '../components/InvoiceDetails';
import BillingDetails from '../components/CustomerDetails';
import { StandardPage, FieldCard } from '../components/common';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { paymentService, PendingPayment } from '../services/paymentService';
import { useInvoiceContext, InvoiceRecordUI } from '../contexts/InvoiceContext';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import InvoiceFunnelFilter, { FilterValues, allColumns as filterColumns } from '../filter/InvoiceFunnelFilter';
import { matchesFunnelFilters, activeFunnelKeys } from '../utils/funnelFilter';
import { exportToCSV } from '../utils/exportUtils';

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
    referredByAgentId: customerData.referredByAgentId ?? null,
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
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);
  const [funnelFilters, setFunnelFilters] = useState<FilterValues>({});
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
  const [itemsPerPage, setItemsPerPage] = useState(50);

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

  // InvoiceFunnelFilter names its columns the way InvoiceRecordUI spells its
  // fields, so a plain lookup covers almost all of them. The two dates are the
  // exception: the displayed value is already localised and Date() cannot be
  // trusted to read it back, so the raw column wins when the store kept one.
  const readFunnelValue = useCallback((record: any, key: string) => {
    if (key === 'invoiceDate') return record.invoiceDateRaw ?? record.invoiceDate;
    if (key === 'dueDate') return record.dueDateRaw ?? record.dueDate;
    return record[key];
  }, []);

  const activeFilterKeys = useMemo(() => activeFunnelKeys(funnelFilters as any), [funnelFilters]);

  // Same storage key as the web build's localStorage entry.
  useEffect(() => {
    AsyncStorage.getItem('invoiceFunnelFilters')
      .then(saved => { if (saved) setFunnelFilters(JSON.parse(saved)); })
      .catch(() => { });
  }, []);

  const persistFunnelFilters = useCallback(async (next: FilterValues) => {
    setFunnelFilters(next);
    try { await AsyncStorage.setItem('invoiceFunnelFilters', JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const removeFunnelFilter = useCallback((key: string) => {
    const next = { ...funnelFilters };
    delete next[key];
    persistFunnelFilters(next);
  }, [funnelFilters, persistFunnelFilters]);

  const describeFilter = (filter: any): string => {
    if (!filter) return '';
    if (filter.type === 'checklist') return `${(filter.value || []).length} selected`;
    if (filter.type === 'text') return String(filter.value ?? '');
    const from = filter.from ?? '';
    const to = filter.to ?? '';
    if (from && to) return `${from} - ${to}`;
    return String(from || to || '');
  };

  const filteredRecords = useMemo(() => {
    return invoiceRecords.filter((record) => {
      const matchesDate = selectedDate === 'All' || record.invoiceDate === selectedDate;
      const matchesFunnel =
        activeFilterKeys.length === 0 ||
        matchesFunnelFilters(record, funnelFilters as any, readFunnelValue);
      if (!matchesFunnel) return false;
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
  }, [invoiceRecords, selectedDate, searchQuery, funnelFilters, activeFilterKeys, readFunnelValue]);

  const handleExport = useCallback(async () => {
    if (filteredRecords.length === 0) return;

    // The columns the web export writes, in the same order.
    const cols = [
      { key: 'accountNo', label: 'Account No.' },
      { key: 'fullName', label: 'Full Name' },
      { key: 'contactNumber', label: 'Contact Number' },
      { key: 'emailAddress', label: 'Email Address' },
      { key: 'address', label: 'Address' },
      { key: 'plan', label: 'Plan' },
      { key: 'invoiceDate', label: 'Invoice Date' },
      { key: 'dueDate', label: 'Due Date' },
      { key: 'invoiceBalance', label: 'Invoice Balance' },
      { key: 'serviceCharge', label: 'Service Charge' },
      { key: 'rebate', label: 'Rebate' },
      { key: 'discounts', label: 'Discounts' },
      { key: 'staggered', label: 'Staggered' },
      { key: 'totalAmount', label: 'Total Amount' },
      { key: 'receivedPayment', label: 'Received Payment' },
      { key: 'status', label: 'Invoice Status' },
      { key: 'paymentPortalLogRef', label: 'Reference No.' },
      { key: 'transactionId', label: 'Transaction ID' },
    ];

    try {
      await exportToCSV('invoices_export', cols, filteredRecords, (record: any, key: string) => record[key]);
    } catch (err) {
      console.error('Invoice export failed:', err);
    }
  }, [filteredRecords]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDate, searchQuery]);

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

  return (
    <StandardPage<InvoiceRecordUI>
      data={filteredRecords}
      keyExtractor={(item) => item.id}
      renderItem={(item) => {
        const isCustomer = userRole === 'customer';
        return (
          <FieldCard
            title={[item.accountNo, !isCustomer && item.fullName ? item.fullName : null].filter(Boolean).join('  \u2014  ')}
            status={item.status}
            statusColor={statusColor(item.status)}
            onPress={isCustomer ? undefined : () => handleRowPress(item)}
            fields={[
              { label: 'Invoice Date', value: item.invoiceDate || '-' },
              { label: 'Due Date', value: item.dueDate || '-' },
              { label: 'Total Amount', value: peso(item.totalAmount) },
              { label: 'Received', value: peso(item.receivedPayment) },
              ...(isCustomer
                ? []
                : [
                    { label: 'Invoice Balance', value: peso(item.invoiceBalance) },
                    { label: 'Transaction ID', value: item.transactionId || 'NULL' },
                  ]),
            ]}
          />
        );
      }}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search invoice records..."
      // A customer sees their own invoices and pays them; the admin filters and
      // exports. Same page, same shell, different controls.
      onOpenFunnel={userRole !== 'customer' ? () => setIsFunnelFilterOpen(true) : undefined}
      activeFilterCount={activeFilterKeys.length}
      chips={activeFilterKeys.map((filterKey) => ({
        key: filterKey,
        label: (filterColumns.find((c: any) => c.key === filterKey) as any)?.label || filterKey,
        value: describeFilter((funnelFilters as any)[filterKey]),
      }))}
      onRemoveChip={removeFunnelFilter}
      onClearChips={() => persistFunnelFilters({})}
      onExport={userRole !== 'customer' ? handleExport : undefined}
      exportDisabled={isLoading || filteredRecords.length === 0}
      onRefresh={handleRefresh}
      refreshDisabled={isLoading}
      isRefreshing={isLoading}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      isLoading={isLoading && invoiceRecords.length === 0}
      loadingText="Loading invoice records..."
      error={error}
      onRetry={handleRefresh}
      emptyText="No invoice records found matching your filters"
      currentPage={currentPage}
      onPageChange={handlePageChange}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={(n) => { setItemsPerPage(n); setCurrentPage(1); }}
      colorPalette={colorPalette}
      header={
        userRole !== 'customer' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', flexGrow: 0 }}
            contentContainerStyle={[styles.chipRow, { paddingHorizontal: 16, paddingVertical: 8 }]}
          >
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
        ) : null
      }
      toolbarActions={
        userRole === 'customer' ? (
          <TouchableOpacity
            onPress={handlePayNow}
            disabled={isPaymentProcessing}
            style={[styles.iconBtn, { height: 38, backgroundColor: isPaymentProcessing ? '#6b7280' : primaryColor, paddingHorizontal: 14 }]}
          >
            <Text style={styles.payNowText}>{isPaymentProcessing ? '...' : 'Pay Now'}</Text>
          </TouchableOpacity>
        ) : null
      }
    >
      <Modal visible={!!selectedRecord && userRole !== 'customer'} animationType="slide" onRequestClose={() => setSelectedRecord(null)}>
        {selectedRecord ? (
          <InvoiceDetails
            invoiceRecord={selectedRecord as any}
            onViewCustomer={handleViewCustomer}
            onClose={() => setSelectedRecord(null)}
          />
        ) : null}
      </Modal>

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

      <InvoiceFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(next) => {
          persistFunnelFilters(next);
          setIsFunnelFilterOpen(false);
          setCurrentPage(1);
        }}
        currentFilters={funnelFilters}
      />
    </StandardPage>
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
