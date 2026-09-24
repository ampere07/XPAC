import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  useWindowDimensions,
  Alert,
  Linking,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  RefreshCw,
  X,
} from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import SOADetails from '../components/SOADetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { paymentService, PendingPayment } from '../services/paymentService';
import { useSOAStore, SOARecordUI } from '../store/soaStore';
import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import { exportToCSV } from '../utils/exportUtils';
import { accountStatusFrom, sessionStatusFrom } from '../utils/onlineStatus';

// ─── Constants ──────────────────────────────────────────────────────────────
const isDarkMode = false;
const BG = '#f9fafb';
const CARD = '#ffffff';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const ITEMS_PER_PAGE = 25;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const convertCustomerDataToBillingDetail = (customerData: CustomerDetailData): BillingDetailRecord => ({
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
  billingStatus: customerData.billingAccount?.billingStatusId
    ? ({ 1: 'In Progress', 2: 'Active', 3: 'Suspended', 4: 'Cancelled', 5: 'Overdue', 6: 'Service Account' }[customerData.billingAccount.billingStatusId] || `Status ${customerData.billingAccount.billingStatusId}`)
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
});

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return dateString;
  }
};

const fmt = (amount: number) => `₱ ${(amount ?? 0).toFixed(2)}`;

// ─── Main Component ───────────────────────────────────────────────────────────
const SOA: React.FC = () => {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const { soaRecords, totalCount, isLoading, error, fetchSOARecords, refreshSOARecords, pollLatestUpdates } = useSOAStore();
  const isFullyLoaded = totalCount === 0 || soaRecords.length >= totalCount;

  // ── State ──
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [accountNo, setAccountNo] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');
  const [accountBalance, setAccountBalance] = useState<number>(0);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [statementDateFrom, setStatementDateFrom] = useState<string>('');
  const [statementDateTo, setStatementDateTo] = useState<string>('');
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState<boolean>(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState<boolean>(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | null>('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);

  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Payment state
  const [isPaymentProcessing, setIsPaymentProcessing] = useState<boolean>(false);
  const [showPaymentVerifyModal, setShowPaymentVerifyModal] = useState<boolean>(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [showPaymentLinkModal, setShowPaymentLinkModal] = useState<boolean>(false);
  const [paymentLinkData, setPaymentLinkData] = useState<{ referenceNo: string; amount: number; paymentUrl: string } | null>(null);
  const [showPendingPaymentModal, setShowPendingPaymentModal] = useState<boolean>(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [paymentInput, setPaymentInput] = useState<string>('');

  const primary = colorPalette?.primary || '#7c3aed';

  // ── Init ──
  useEffect(() => { fetchSOARecords(); }, [fetchSOARecords]);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('authData').then(raw => {
      if (!raw) return;
      try {
        const user = JSON.parse(raw);
        setUserRole(user.role?.toLowerCase() || '');
        setAccountNo(user.username || '');
        const bal = parseFloat(user.account_balance || '0');
        setAccountBalance(bal);
        setPaymentAmount(bal > 0 ? bal : 100);
        setPaymentInput(String(bal > 0 ? bal : 100));
        setFullName(user.full_name || '');
      } catch {}
    });
  }, []);

  // 15-min interval refresh (replaces pusher + idle logic)
  useEffect(() => {
    const interval = setInterval(() => {
      pollLatestUpdates().catch(() => {});
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [pollLatestUpdates]);

  // ── Derived data ──
  const userOrgId = useMemo(() => {
    // org filter is async — we read synchronously from store, org filtering handled via records
    // For simplicity we allow all records to show (org filtered server-side)
    return null;
  }, []);

  const globalFilteredRecords = useMemo(() => {
    let filtered = soaRecords.filter((record: SOARecordUI) => {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      if (searchQuery === '') return true;
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return Object.values(val).some(v => checkValue(v));
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };
      return checkValue(record);
    });

    // Date range filter
    if (statementDateFrom || statementDateTo) {
      filtered = filtered.filter(record => {
        const dateStr = record.statementDateRaw || record.statementDate;
        if (!dateStr) return false;
        const dateValue = new Date(dateStr).getTime();
        if (isNaN(dateValue)) return false;
        if (statementDateFrom) {
          const from = new Date(statementDateFrom);
          from.setHours(0, 0, 0, 0);
          if (dateValue < from.getTime()) return false;
        }
        if (statementDateTo) {
          const to = new Date(statementDateTo);
          to.setHours(23, 59, 59, 999);
          if (dateValue > to.getTime()) return false;
        }
        return true;
      });
    }

    return filtered;
  }, [soaRecords, searchQuery, statementDateFrom, statementDateTo]);

  const dateItems = useMemo(() => {
    const dateCounts: Record<string, number> = {};
    const dates = new Map<string, string>();
    globalFilteredRecords.forEach((record: SOARecordUI) => {
      if (record.statementDate && record.statementDate !== 'N/A') {
        dateCounts[record.statementDate] = (dateCounts[record.statementDate] || 0) + 1;
        dates.set(record.statementDate, record.statementDateRaw || record.statementDate);
      }
    });
    const sortedDates = Array.from(dates.entries())
      .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime())
      .map(([formatted]) => ({ date: formatted, count: dateCounts[formatted] }));
    return { all: globalFilteredRecords.length, dates: sortedDates };
  }, [globalFilteredRecords]);

  const filteredRecords = useMemo(() => {
    let filtered = globalFilteredRecords.filter((r: SOARecordUI) =>
      selectedDate === 'All' || r.statementDate === selectedDate
    );
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        const numericCols = ['balanceFromPreviousBill','paymentReceivedPrevious','remainingBalancePrevious','monthlyServiceFee','serviceCharge','rebate','discounts','staggered','vat','amountDue','totalAmountDue'];
        let aVal: any = (a as any)[sortColumn] || '';
        let bVal: any = (b as any)[sortColumn] || '';
        if (numericCols.includes(sortColumn)) {
          aVal = Number(aVal) || 0;
          bVal = Number(bVal) || 0;
        } else if (['statementDate','dueDate','createdAt','updatedAt'].includes(sortColumn)) {
          aVal = sortColumn === 'statementDate' ? (a.statementDateRaw || a.statementDate || '') : aVal;
          bVal = sortColumn === 'statementDate' ? (b.statementDateRaw || b.statementDate || '') : bVal;
          aVal = new Date(aVal).getTime() || 0;
          bVal = new Date(bVal).getTime() || 0;
        } else {
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
        }
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return filtered;
  }, [globalFilteredRecords, selectedDate, sortColumn, sortDirection]);

  const totalPages = Math.ceil(filteredRecords.length / ITEMS_PER_PAGE);

  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredRecords.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredRecords, currentPage]);

  const currentSOAIndex = useMemo(() => {
    if (!selectedRecordId) return -1;
    return filteredRecords.findIndex(r => r.id === selectedRecordId);
  }, [filteredRecords, selectedRecordId]);

  const selectedRecord = useMemo(() => {
    if (!selectedRecordId) return null;
    return soaRecords.find(r => r.id === selectedRecordId) || null;
  }, [soaRecords, selectedRecordId]);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [selectedDate, searchQuery, statementDateFrom, statementDateTo]);

  // ── Handlers ──
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await pollLatestUpdates(); } finally { setRefreshing(false); }
  }, [pollLatestUpdates]);

  const handleRefresh = async () => {
    setIsRefreshingManual(true);
    try { await pollLatestUpdates(); } finally { setIsRefreshingManual(false); }
  };

  const handleRowPress = (record: SOARecordUI) => {
    if (userRole !== 'customer') {
      setSelectedRecordId(record.id);
      setSelectedCustomer(null);
    }
  };

  const handleViewCustomer = async (accNo: string) => {
    setIsLoadingDetails(true);
    try {
      const detail = await getCustomerDetail(accNo);
      if (detail) setSelectedCustomer(detail);
    } catch {}
    finally { setIsLoadingDetails(false); }
  };

  const handlePreviousRecord = () => {
    if (currentSOAIndex > 0) setSelectedRecordId(filteredRecords[currentSOAIndex - 1].id);
  };

  const handleNextRecord = () => {
    if (currentSOAIndex >= 0 && currentSOAIndex < filteredRecords.length - 1)
      setSelectedRecordId(filteredRecords[currentSOAIndex + 1].id);
  };

  const handleDownloadPDF = (printLink?: string) => {
    if (printLink) Linking.openURL(printLink).catch(() => {});
  };

  const handleExport = async () => {
    if (!filteredRecords.length) return;
    const cols = [
      { key: 'statementDate', label: 'Statement Date' },
      { key: 'accountNo', label: 'Account No' },
      { key: 'fullName', label: 'Full Name' },
      { key: 'plan', label: 'Plan' },
      { key: 'amountDue', label: 'Amount Due' },
      { key: 'totalAmountDue', label: 'Total Amount Due' },
      { key: 'dueDate', label: 'Due Date' },
      { key: 'printLink', label: 'Print Link' },
    ];
    const getValue = (record: SOARecordUI, key: string) => {
      if (key === 'amountDue') return fmt(record.amountDue);
      if (key === 'totalAmountDue') return fmt(record.totalAmountDue);
      return (record as any)[key] || '-';
    };
    await exportToCSV('soa_records_export', cols, filteredRecords, getValue);
  };

  // Payment handlers
  const handlePayNow = async () => {
    setErrorMessage('');
    setIsPaymentProcessing(true);
    try {
      const currentBalance = await paymentService.getAccountBalance(accountNo);
      setAccountBalance(currentBalance);
      const pending = await paymentService.checkPendingPayment(accountNo);
      if (pending && pending.payment_url) {
        setPendingPayment(pending);
        setShowPendingPaymentModal(true);
      } else {
        const amt = currentBalance > 0 ? currentBalance : 100;
        setPaymentAmount(amt);
        setPaymentInput(String(amt));
        setShowPaymentVerifyModal(true);
      }
    } catch {
      const amt = accountBalance > 0 ? accountBalance : 100;
      setPaymentAmount(amt);
      setPaymentInput(String(amt));
      setShowPaymentVerifyModal(true);
    } finally {
      setIsPaymentProcessing(false);
    }
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
    } catch (e: any) {
      setErrorMessage(e.message || 'Failed to create payment. Please try again.');
    } finally {
      setIsPaymentProcessing(false);
    }
  };

  const handleOpenPaymentLink = () => {
    if (paymentLinkData?.paymentUrl) {
      Linking.openURL(paymentLinkData.paymentUrl).catch(() => {});
      setShowPaymentLinkModal(false);
      setPaymentLinkData(null);
    }
  };

  const handleResumePendingPayment = () => {
    if (pendingPayment?.payment_url) {
      Linking.openURL(pendingPayment.payment_url).catch(() => {});
      setShowPendingPaymentModal(false);
      setPendingPayment(null);
    }
  };

  // ── Render item ──
  const renderSOACard = ({ item }: { item: SOARecordUI }) => {
    const isSelected = item.id === selectedRecordId;
    return (
      <TouchableOpacity
        onPress={() => handleRowPress(item)}
        style={[
          styles.card,
          isSelected && { borderLeftWidth: 3, borderLeftColor: primary },
        ]}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.fullName}</Text>
            <Text style={[styles.cardSub, { color: '#ef4444' }]}>{item.accountNo}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.cardAmount, { color: primary }]}>{fmt(item.totalAmountDue)}</Text>
            <Text style={styles.cardDate}>{item.statementDate}</Text>
          </View>
        </View>

        <View style={styles.cardRow}>
          <Text style={styles.cardRowLabel}>Plan</Text>
          <Text style={styles.cardRowValue}>{item.plan || '-'}</Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardRowLabel}>Due Date</Text>
          <Text style={styles.cardRowValue}>{item.dueDate || '-'}</Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardRowLabel}>Amount Due</Text>
          <Text style={styles.cardRowValue}>{fmt(item.amountDue)}</Text>
        </View>

        {item.printLink ? (
          <TouchableOpacity
            onPress={() => handleDownloadPDF(item.printLink)}
            style={[styles.pdfBtn, { borderColor: primary }]}
          >
            <Download size={14} color={primary} />
            <Text style={[styles.pdfBtnText, { color: primary }]}>Download PDF</Text>
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    );
  };

  // ── Sidebar ──
  const SidebarContent = () => (
    <ScrollView style={{ flex: 1 }}>
      {/* Date range */}
      <View style={styles.sidebarSection}>
        <View style={styles.sidebarSectionHeader}>
          <Text style={styles.sidebarSectionLabel}>STATEMENT DATE RANGE</Text>
          {(statementDateFrom || statementDateTo) && (
            <TouchableOpacity onPress={() => { setStatementDateFrom(''); setStatementDateTo(''); }}>
              <Text style={[styles.clearText, { color: primary }]}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.dateLabel}>From</Text>
        <TextInput
          style={[styles.dateInput, statementDateFrom ? { borderColor: primary } : {}]}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={MUTED}
          value={statementDateFrom}
          onChangeText={setStatementDateFrom}
        />
        <Text style={[styles.dateLabel, { marginTop: 8 }]}>To</Text>
        <TextInput
          style={[styles.dateInput, statementDateTo ? { borderColor: primary } : {}]}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={MUTED}
          value={statementDateTo}
          onChangeText={setStatementDateTo}
        />
      </View>

      {/* All records button */}
      <TouchableOpacity
        onPress={() => setSelectedDate('All')}
        style={[
          styles.dateItem,
          selectedDate === 'All' && { backgroundColor: `${primary}22` },
        ]}
      >
        <Text style={[styles.dateItemText, selectedDate === 'All' && { color: primary, fontWeight: '600' }]}>
          All Records
        </Text>
        <View style={[styles.badge, selectedDate === 'All' ? { backgroundColor: primary } : {}]}>
          <Text style={[styles.badgeText, selectedDate === 'All' ? { color: '#fff' } : {}]}>
            {dateItems.all}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Statement month accordion */}
      <TouchableOpacity
        style={styles.accordionHeader}
        onPress={() => setIsDateDropdownOpen(v => !v)}
      >
        <Text style={styles.accordionLabel}>Statement Month</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{dateItems.dates.length}</Text>
          </View>
          <ChevronDown
            size={16}
            color={MUTED}
            style={{ transform: [{ rotate: isDateDropdownOpen ? '180deg' : '0deg' }] }}
          />
        </View>
      </TouchableOpacity>

      {isDateDropdownOpen && dateItems.dates.map((item, idx) => (
        <TouchableOpacity
          key={idx}
          onPress={() => { setSelectedDate(item.date); setIsSidebarVisible(false); }}
          style={[
            styles.dateSubItem,
            selectedDate === item.date && { backgroundColor: `${primary}22` },
          ]}
        >
          <Calendar size={14} color={selectedDate === item.date ? primary : MUTED} style={{ marginRight: 8 }} />
          <Text style={[styles.dateSubText, selectedDate === item.date && { color: primary, fontWeight: '500' }]}>
            {item.date}
          </Text>
          <View style={[styles.badge, { marginLeft: 'auto' }, selectedDate === item.date ? { backgroundColor: primary } : {}]}>
            <Text style={[styles.badgeText, selectedDate === item.date ? { color: '#fff' } : {}]}>
              {item.count}
            </Text>
          </View>
        </TouchableOpacity>
      ))}

      {/* View Records button on mobile */}
      <View style={{ padding: 16 }}>
        <TouchableOpacity
          style={[styles.viewRecordsBtn, { backgroundColor: primary }]}
          onPress={() => setIsSidebarVisible(false)}
        >
          <Text style={styles.viewRecordsBtnText}>View Records</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ── Main render ──
  return (
    <View style={{ flex: 1, backgroundColor: BG, paddingTop: isTablet ? 16 : 60 }}>
      {/* Header toolbar */}
      <View style={styles.toolbar}>
        <View style={{ flex: 1 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search SOA records..."
          />
        </View>

        {/* Filter (sidebar) toggle */}
        {userRole !== 'customer' && (
          <TouchableOpacity
            style={styles.toolBtn}
            onPress={() => setIsSidebarVisible(true)}
          >
            <Filter size={18} color={TEXT} />
          </TouchableOpacity>
        )}

        {/* Pay Now for customers */}
        {userRole === 'customer' && (
          <TouchableOpacity
            style={[styles.payBtn, { backgroundColor: isPaymentProcessing ? '#6b7280' : primary }]}
            onPress={handlePayNow}
            disabled={isPaymentProcessing}
          >
            <Text style={styles.payBtnText}>{isPaymentProcessing ? 'Processing...' : 'Pay Now'}</Text>
          </TouchableOpacity>
        )}

        {/* Export */}
        <TouchableOpacity
          style={[styles.toolBtn, { borderColor: primary }]}
          onPress={handleExport}
          disabled={isLoading || filteredRecords.length === 0}
        >
          <Download size={18} color={primary} />
        </TouchableOpacity>

        {/* Refresh */}
        <TouchableOpacity
          style={[styles.toolBtn, { borderColor: primary }]}
          onPress={handleRefresh}
          disabled={isLoading || isRefreshingManual}
        >
          {(isLoading || isRefreshingManual) ? (
            <ActivityIndicator size="small" color={primary} />
          ) : (
            <RefreshCw size={18} color={primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* Pagination info */}
      {filteredRecords.length > 0 && (
        <View style={styles.paginationBar}>
          <Text style={styles.paginationText}>
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredRecords.length)} of {filteredRecords.length}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={[styles.pageBtn, currentPage === 1 && { opacity: 0.4 }]}
            >
              <ChevronLeft size={16} color={TEXT} />
            </TouchableOpacity>
            <Text style={styles.paginationText}>
              {currentPage}/{totalPages || 1}
            </Text>
            <TouchableOpacity
              onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              style={[styles.pageBtn, currentPage >= totalPages && { opacity: 0.4 }]}
            >
              <ChevronRight size={16} color={TEXT} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* List */}
      {isLoading && soaRecords.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={primary} />
          <Text style={styles.centerText}>Loading SOA records...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={{ color: '#ef4444', marginBottom: 12 }}>{error}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: primary }]} onPress={() => fetchSOARecords(true)}>
            <Text style={{ color: '#fff' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={paginatedRecords}
          keyExtractor={item => item.id}
          renderItem={renderSOACard}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={primary} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.centerText}>No SOA records found</Text>
            </View>
          }
        />
      )}

      {/* Sidebar modal (filter) */}
      <Modal
        visible={isSidebarVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsSidebarVisible(false)}
      >
        <TouchableOpacity
          style={styles.sidebarOverlay}
          activeOpacity={1}
          onPress={() => setIsSidebarVisible(false)}
        />
        <View style={styles.sidebarDrawer}>
          <View style={styles.sidebarDrawerHeader}>
            <Text style={styles.sidebarDrawerTitle}>Statements</Text>
            <TouchableOpacity onPress={() => setIsSidebarVisible(false)}>
              <X size={20} color={MUTED} />
            </TouchableOpacity>
          </View>
          <SidebarContent />
        </View>
      </Modal>

      {/* SOA Detail modal */}
      {selectedRecord && userRole !== 'customer' && (
        <SOADetails
          soaRecord={selectedRecord as any}
          onViewCustomer={handleViewCustomer}
          onClose={() => setSelectedRecordId(null)}
          onPrevious={currentSOAIndex > 0 ? handlePreviousRecord : undefined}
          onNext={currentSOAIndex < filteredRecords.length - 1 ? handleNextRecord : undefined}
        />
      )}

      {/* Customer details modal */}
      {(selectedCustomer || isLoadingDetails) && (
        isLoadingDetails ? (
          <Modal visible animationType="slide" onRequestClose={() => setIsLoadingDetails(false)}>
            <View style={[styles.center, { flex: 1, backgroundColor: CARD }]}>
              <ActivityIndicator size="large" color={primary} />
              <Text style={[styles.centerText, { marginTop: 12 }]}>Loading details...</Text>
            </View>
          </Modal>
        ) : selectedCustomer ? (
          <BillingDetails
            billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
            onlineStatusRecords={[]}
            onClose={() => setSelectedCustomer(null)}
          />
        ) : null
      )}

      {/* Payment Verify Modal */}
      <Modal visible={showPaymentVerifyModal} transparent animationType="fade" onRequestClose={() => setShowPaymentVerifyModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Payment</Text>
            <View style={styles.modalInfoBox}>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Account:</Text>
                <Text style={styles.modalRowValue}>{fullName}</Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Current Balance:</Text>
                <Text style={[styles.modalRowValue, { color: accountBalance > 0 ? '#ef4444' : '#10b981' }]}>
                  ₱{accountBalance.toFixed(2)}
                </Text>
              </View>
            </View>
            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}
            <Text style={styles.modalFieldLabel}>Payment Amount</Text>
            <TextInput
              style={styles.modalInput}
              keyboardType="decimal-pad"
              value={paymentInput}
              onChangeText={text => {
                if (text === '' || /^\d*\.?\d*$/.test(text)) {
                  setPaymentInput(text);
                  setPaymentAmount(text === '' ? 0 : parseFloat(text) || 0);
                }
              }}
              placeholder="100"
              placeholderTextColor={MUTED}
            />
            <Text style={styles.modalHint}>
              {accountBalance > 0 ? `Outstanding: ₱${accountBalance.toFixed(2)}` : 'Minimum: ₱1.00'}
            </Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowPaymentVerifyModal(false)}
                disabled={isPaymentProcessing}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.proceedBtn, { backgroundColor: (isPaymentProcessing || paymentAmount < 1) ? '#6b7280' : primary }]}
                onPress={handleProceedToCheckout}
                disabled={isPaymentProcessing || paymentAmount < 1}
              >
                {isPaymentProcessing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.proceedBtnText}>PROCEED TO CHECKOUT</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pending Payment Modal */}
      <Modal visible={showPendingPaymentModal && !!pendingPayment} transparent animationType="fade" onRequestClose={() => setShowPendingPaymentModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Transaction In Progress</Text>
            <View style={styles.modalInfoBox}>
              <Text style={{ textAlign: 'center', marginBottom: 8 }}>
                You have a pending payment ({pendingPayment?.reference_no}).{'\n'}The link is still active.
              </Text>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Amount:</Text>
                <Text style={[styles.modalRowValue, { color: primary }]}>
                  ₱{pendingPayment?.amount.toFixed(2)}
                </Text>
              </View>
            </View>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowPendingPaymentModal(false); setPendingPayment(null); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.proceedBtn, { backgroundColor: primary }]} onPress={handleResumePendingPayment}>
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
                <Text style={[styles.modalRowValue, { fontFamily: 'monospace' }]}>{paymentLinkData?.referenceNo}</Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Amount:</Text>
                <Text style={[styles.modalRowValue, { color: primary }]}>₱{paymentLinkData?.amount.toFixed(2)}</Text>
              </View>
            </View>
            <TouchableOpacity style={[styles.proceedBtn, { backgroundColor: primary, marginTop: 8 }]} onPress={handleOpenPaymentLink}>
              <Text style={styles.proceedBtnText}>PROCEED</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 8,
  },
  toolBtn: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  payBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  payBtnText: {
    color: '#fff',
    fontWeight: '600' as const,
    fontSize: 13,
  },
  paginationBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  paginationText: {
    fontSize: 12,
    color: MUTED,
  },
  pageBtn: {
    padding: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: BORDER,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: TEXT,
  },
  cardSub: {
    fontSize: 12,
    marginTop: 2,
  },
  cardAmount: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  cardDate: {
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },
  cardRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 3,
  },
  cardRowLabel: {
    fontSize: 12,
    color: MUTED,
  },
  cardRowValue: {
    fontSize: 12,
    color: TEXT,
    fontWeight: '500' as const,
  },
  pdfBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    marginTop: 10,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
  },
  pdfBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  center: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 32,
  },
  centerText: {
    marginTop: 8,
    color: MUTED,
    fontSize: 14,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  // Sidebar
  sidebarOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sidebarDrawer: {
    position: 'absolute' as const,
    left: 0, top: 0, bottom: 0,
    width: 300,
    backgroundColor: CARD,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    paddingTop: 60,
  },
  sidebarDrawerHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  sidebarDrawerTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: TEXT,
  },
  sidebarSection: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  sidebarSectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
  sidebarSectionLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: MUTED,
    letterSpacing: 0.8,
  },
  clearText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  dateLabel: {
    fontSize: 10,
    color: MUTED,
    marginBottom: 4,
  },
  dateInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    color: TEXT,
    backgroundColor: '#f9fafb',
  },
  dateItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dateItemText: {
    fontSize: 13,
    color: TEXT,
  },
  badge: {
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    color: MUTED,
  },
  accordionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  accordionLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: TEXT,
  },
  dateSubItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  dateSubText: {
    fontSize: 13,
    color: MUTED,
    flex: 1,
  },
  viewRecordsBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  viewRecordsBtnText: {
    color: '#fff',
    fontWeight: '700' as const,
    fontSize: 13,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 16,
  },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
    marginBottom: 16,
    color: TEXT,
  },
  modalInfoBox: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  modalRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 4,
  },
  modalRowLabel: {
    fontSize: 13,
    color: MUTED,
  },
  modalRowValue: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: TEXT,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    textAlign: 'center' as const,
  },
  modalFieldLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: TEXT,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700' as const,
    color: TEXT,
    backgroundColor: CARD,
  },
  modalHint: {
    fontSize: 12,
    color: MUTED,
    textAlign: 'right' as const,
    marginTop: 4,
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    alignItems: 'center' as const,
  },
  cancelBtnText: {
    fontWeight: '700' as const,
    color: TEXT,
    fontSize: 14,
  },
  proceedBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  proceedBtnText: {
    fontWeight: '700' as const,
    color: '#fff',
    fontSize: 13,
  },
});

export default SOA;
