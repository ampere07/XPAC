import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Modal,
  ScrollView,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import {
  Receipt,
  CheckCheck,
  X,
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Download,
  Filter,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalSearch from './globalfunctions/GlobalSearch';
import TransactionListDetails from '../components/TransactionListDetails';
import { transactionService } from '../services/transactionService';
import { getCities, City } from '../services/cityService';
import { getRegions, Region } from '../services/regionService';
import { barangayService, Barangay } from '../services/barangayService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useTransactionStore } from '../store/transactionStore';
import { Transaction } from '../types/transaction';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import { exportToCSV } from '../utils/exportUtils';
import { accountStatusFrom, sessionStatusFrom } from '../utils/onlineStatus';
import { usePermissions } from '../hooks/usePermissions';

// ─── Constants ─────────────────────────────────────────────────────────────
const isDarkMode = false;
const { width } = Dimensions.get('window');
const isTablet = width >= 768;

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    billingStatus: customerData.billingAccount?.billingStatusId
      ? (({ 1: 'In Progress', 2: 'Active', 3: 'Suspended', 4: 'Cancelled', 5: 'Overdue', 6: 'Service Account' } as Record<number, string>)[customerData.billingAccount.billingStatusId] || `Status ${customerData.billingAccount.billingStatusId}`)
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
  };
};

const formatDate = (dateStr?: string, includeTime = false): string => {
  if (!dateStr) return 'No date';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    if (!includeTime) return `${mm}/${dd}/${yyyy}`;
    let hours = date.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${mm}/${dd}/${yyyy} ${hours}:${minutes}:${seconds} ${ampm}`;
  } catch {
    return dateStr;
  }
};

const formatCurrency = (amount: number | string | null | undefined): string => {
  if (amount === null || amount === undefined || amount === '') return '₱0.00';
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return '₱0.00';
  return `₱${n.toFixed(2)}`;
};

// ─── Status Badge ────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status?: string | null }> = ({ status }) => {
  const s = (status || '').toLowerCase();
  const color =
    s === 'done' || s === 'completed' ? '#22c55e' :
    s === 'pending' ? '#eab308' :
    s === 'processing' ? '#3b82f6' :
    s === 'failed' || s === 'cancelled' ? '#ef4444' :
    '#6b7280';
  return (
    <Text style={{ color, textTransform: 'capitalize', fontSize: 12, fontWeight: '500' }}>
      {status || 'Unknown'}
    </Text>
  );
};

// ─── Transaction Card ────────────────────────────────────────────────────────

interface TransactionCardProps {
  transaction: Transaction;
  isSelected: boolean;
  isBatchMode: boolean;
  isPending: boolean;
  isSelectedBatch: boolean;
  onPress: () => void;
  onToggle: () => void;
  primary: string;
  paymentMethods: PaymentMethod[];
}

const TransactionCard: React.FC<TransactionCardProps> = ({
  transaction,
  isSelected,
  isBatchMode,
  isPending,
  isSelectedBatch,
  onPress,
  onToggle,
  primary,
  paymentMethods,
}) => {
  const getPaymentMethodName = (pmId: string | number | null | undefined): string => {
    if (!pmId) return '-';
    const pm = paymentMethods.find(m => String(m.id) === String(pmId));
    return pm ? pm.payment_method : String(pmId);
  };

  const paymentMethod =
    transaction.payment_method_info?.payment_method ||
    getPaymentMethodName(transaction.payment_method) || '-';

  const bgColor = isSelected
    ? '#f3f4f6'
    : isSelectedBatch
    ? `${primary}22`
    : '#ffffff';

  return (
    <TouchableOpacity
      onPress={isBatchMode ? (isPending ? onToggle : undefined) : onPress}
      style={{
        backgroundColor: bgColor,
        marginHorizontal: 12,
        marginVertical: 4,
        borderRadius: 10,
        padding: 14,
        borderWidth: 1,
        borderColor: isSelected ? primary : isSelectedBatch ? primary : '#e5e7eb',
        flexDirection: 'row',
        gap: 10,
      }}
      activeOpacity={0.7}
    >
      {isBatchMode && (
        <View style={{ justifyContent: 'center', paddingRight: 4 }}>
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              borderWidth: 2,
              borderColor: isPending ? primary : '#d1d5db',
              backgroundColor: isSelectedBatch ? primary : '#ffffff',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isSelectedBatch && <Check size={12} color="#ffffff" />}
          </View>
        </View>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#ef4444' }}>
              {transaction.account?.account_no || '-'}
            </Text>
            <Text style={{ fontSize: 13, color: '#111827', marginTop: 1 }}>
              {transaction.account?.customer?.full_name || '-'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>
              {formatCurrency(transaction.received_payment)}
            </Text>
            <StatusBadge status={transaction.status} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
          <Text style={{ fontSize: 11, color: '#6b7280', flex: 1 }}>
            {formatDate(transaction.date_processed, true)}
          </Text>
          <Text style={{ fontSize: 11, color: '#6b7280' }}>{paymentMethod}</Text>
        </View>
        {transaction.remarks ? (
          <Text style={{ fontSize: 11, color: '#6b7280' }} numberOfLines={1}>
            {transaction.remarks}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

interface TransactionListProps {
  onNavigate?: (section: string, extra?: string) => void;
}

const TransactionList: React.FC<TransactionListProps> = ({ onNavigate }) => {
  const {
    transactions,
    totalCount,
    isLoading: loading,
    error,
    fetchTransactions,
    fetchUpdates,
  } = useTransactionStore();

  const [userRole, setUserRole] = useState('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [processedDateFrom, setProcessedDateFrom] = useState('');
  const [processedDateTo, setProcessedDateTo] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>({});

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [customerRefreshKey, setCustomerRefreshKey] = useState(0);

  const [isBatchApproveMode, setIsBatchApproveMode] = useState(false);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [isApproving, setIsApproving] = useState(false);

  const [sortColumn, setSortColumn] = useState<string | null>('date_processed');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);

  const [refreshing, setRefreshing] = useState(false);
  const [locationFilterVisible, setLocationFilterVisible] = useState(false);

  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const primary = colorPalette?.primary || '#7c3aed';

  // ─── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (transactions.length === 0) {
      fetchTransactions();
    }
  }, []);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('authData').then(raw => {
      if (!raw) return;
      try {
        const userData = JSON.parse(raw);
        setUserRole(userData.role || '');
        setRoleId(userData.role_id || null);
      } catch {}
    });
  }, []);

  useEffect(() => {
    Promise.all([
      getCities(),
      getRegions(),
      barangayService.getAll(),
      paymentMethodService.getAll(),
    ]).then(([citiesData, regionsData, barangaysRes, pmRes]) => {
      setCities(citiesData || []);
      setRegions(regionsData || []);
      setBarangays(barangaysRes.success ? barangaysRes.data : []);
      if (pmRes.success) setPaymentMethods(pmRes.data);
    }).catch(() => {});
  }, []);

  // 15-minute polling instead of Pusher
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try { await fetchUpdates(); } catch {}
    }, 15 * 60 * 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchUpdates]);

  // ─── Permissions ───────────────────────────────────────────────────────────

  // Resolved centrally (hooks/usePermissions): a seeded role answers from the
  // permission table, a custom role from the keys the server resolved for it.
  const { can: hasPermission } = usePermissions();

  // ─── User org ──────────────────────────────────────────────────────────────

  const [userOrgId, setUserOrgId] = useState<any>(null);
  useEffect(() => {
    AsyncStorage.getItem('authData').then(raw => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        setUserOrgId(d.organization_id || d.user?.organization_id || d.organization?.id || d.user?.organization?.id || null);
      } catch {}
    });
  }, []);

  // ─── Location items ────────────────────────────────────────────────────────

  const globalFilteredTransactions = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
    let filtered = transactions.filter(t => {
      if (userOrgId) {
        if ((t as any).organization_id !== userOrgId) return false;
      }
      if (searchQuery === '') return true;
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return Object.values(val).some(v => checkValue(v));
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };
      return checkValue(t);
    });

    if (processedDateFrom || processedDateTo) {
      filtered = filtered.filter(t => {
        if (!t.date_processed) return false;
        const dateValue = new Date(t.date_processed).getTime();
        if (isNaN(dateValue)) return false;
        if (processedDateFrom) {
          const from = new Date(processedDateFrom);
          from.setHours(0, 0, 0, 0);
          if (dateValue < from.getTime()) return false;
        }
        if (processedDateTo) {
          const to = new Date(processedDateTo);
          to.setHours(23, 59, 59, 999);
          if (dateValue > to.getTime()) return false;
        }
        return true;
      });
    }

    return filtered;
  }, [transactions, searchQuery, userOrgId, processedDateFrom, processedDateTo]);

  const locationItems = useMemo(() => {
    const regionCounts: Record<string, number> = {};
    const cityCounts: Record<string, number> = {};
    const barangayCounts: Record<string, number> = {};

    regions.forEach(r => { regionCounts[r.name] = 0; });
    cities.forEach(c => { cityCounts[`${c.region_id}_${c.name}`] = 0; });
    barangays.forEach(b => { barangayCounts[`${b.city_id}_${b.barangay}`] = 0; });

    globalFilteredTransactions.forEach(t => {
      const region = (t.account as any)?.customer?.region;
      const city = (t.account as any)?.customer?.city;
      const barangay = (t.account as any)?.customer?.barangay;
      if (region) regionCounts[region] = (regionCounts[region] || 0) + 1;
      if (city) {
        const mc = cities.find(c => c.name === city);
        if (mc) cityCounts[`${mc.region_id}_${mc.name}`] = (cityCounts[`${mc.region_id}_${mc.name}`] || 0) + 1;
      }
      if (barangay) {
        const mb = barangays.find(b => b.barangay === barangay && (!city || cities.find(c => c.id === b.city_id)?.name === city));
        if (mb) barangayCounts[`${mb.city_id}_${mb.barangay}`] = (barangayCounts[`${mb.city_id}_${mb.barangay}`] || 0) + 1;
      }
    });

    return {
      regions: regions.map(r => ({
        id: `reg:${r.name}`,
        name: r.name,
        count: regionCounts[r.name] || 0,
        cities: cities.filter(c => c.region_id === r.id).map(c => ({
          id: `city:${c.name}`,
          name: c.name,
          count: cityCounts[`${r.id}_${c.name}`] || 0,
          barangays: barangays.filter(b => b.city_id === c.id).map(b => ({
            id: `brgy:${b.barangay}`,
            name: b.barangay,
            count: barangayCounts[`${c.id}_${b.barangay}`] || 0,
          })),
        })),
      })),
      total: globalFilteredTransactions.length,
    };
  }, [regions, cities, barangays, globalFilteredTransactions]);

  // ─── Filtered + sorted ────────────────────────────────────────────────────

  const filteredTransactions = useMemo(() => {
    let filtered = globalFilteredTransactions.filter(t => {
      if (selectedLocation === 'all') return true;
      const customer = (t.account as any)?.customer;
      if (selectedLocation.startsWith('reg:')) return customer?.region === selectedLocation.substring(4);
      if (selectedLocation.startsWith('city:')) return customer?.city === selectedLocation.substring(5);
      if (selectedLocation.startsWith('brgy:')) return customer?.barangay === selectedLocation.substring(5);
      return true;
    });

    if (sortColumn) {
      const dateCols = ['date_processed', 'created_at', 'updated_at', 'payment_date'];
      const numericCols = ['received_payment', 'account_balance', 'id'];
      filtered = [...filtered].sort((a, b) => {
        const getVal = (t: any) => {
          switch (sortColumn) {
            case 'date_processed': return t.date_processed;
            case 'created_at': return t.created_at;
            case 'account_no': return t.account?.account_no || '';
            case 'received_payment': return Number(t.received_payment) || 0;
            case 'payment_method': return t.payment_method_info?.payment_method || String(t.payment_method || '');
            case 'processed_by': return t.processor?.email_address || t.processed_by_user || '';
            case 'full_name': return t.account?.customer?.full_name || '';
            case 'status': return t.status || '';
            case 'id': return Number(t.id) || 0;
            case 'account_balance': return Number(t.account?.account_balance) || 0;
            default: return t[sortColumn] || '';
          }
        };
        let aVal = getVal(a);
        let bVal = getVal(b);
        if (dateCols.includes(sortColumn)) {
          aVal = new Date(aVal || '').getTime() || 0;
          bVal = new Date(bVal || '').getTime() || 0;
        } else if (!numericCols.includes(sortColumn)) {
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
        }
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [globalFilteredTransactions, selectedLocation, sortColumn, sortDirection]);

  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredTransactions.slice(start, start + itemsPerPage);
  }, [filteredTransactions, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);

  // ─── Pull to refresh ──────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchUpdates(); } finally { setRefreshing(false); }
  };

  // ─── Transaction actions ──────────────────────────────────────────────────

  const handleRowPress = (transaction: Transaction) => {
    if (isBatchApproveMode) {
      if ((transaction.status || '').toLowerCase() === 'pending') {
        toggleTransactionSelection(transaction.id);
      }
    } else {
      setSelectedTransaction(transaction);
      setSelectedCustomer(null);
    }
  };

  const toggleTransactionSelection = (id: string) => {
    const t = transactions.find(tx => tx.id === id);
    if (!t || (t.status || '').toLowerCase() !== 'pending') return;
    setSelectedTransactionIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const pendingIds = filteredTransactions.filter(t => (t.status || '').toLowerCase() === 'pending').map(t => t.id);
    if (selectedTransactionIds.length === pendingIds.length && pendingIds.length > 0) {
      setSelectedTransactionIds([]);
    } else {
      setSelectedTransactionIds(pendingIds);
    }
  };

  const handleCancelApprove = () => {
    setIsBatchApproveMode(false);
    setSelectedTransactionIds([]);
  };

  const handleBatchApprove = () => {
    if (selectedTransactionIds.length === 0) return;
    Alert.alert(
      'Confirm Batch Approval',
      `Are you sure you want to approve ${selectedTransactionIds.length} transaction(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setIsApproving(true);
            try {
              const result = await transactionService.batchApproveTransactions(selectedTransactionIds);
              if (result.success) {
                const successCount = result.data?.success?.length || 0;
                const failedCount = result.data?.failed?.length || 0;
                Alert.alert(
                  failedCount > 0 ? 'Partial Success' : 'Success',
                  failedCount > 0
                    ? `${successCount} approved, ${failedCount} failed`
                    : `Successfully approved ${successCount} transaction(s)`
                );
                setIsBatchApproveMode(false);
                setSelectedTransactionIds([]);
                await fetchUpdates();
              } else {
                Alert.alert('Error', result.message || 'Failed to approve transactions');
              }
            } catch (err: any) {
              Alert.alert('Error', `Failed to approve: ${err.message}`);
            } finally {
              setIsApproving(false);
            }
          },
        },
      ]
    );
  };

  // ─── Customer detail ──────────────────────────────────────────────────────

  const handleViewCustomer = async (accountNo: string) => {
    setIsLoadingDetails(true);
    try {
      const detail = await getCustomerDetail(accountNo);
      if (detail) setSelectedCustomer(detail);
    } catch {}
    finally { setIsLoadingDetails(false); }
  };

  const refreshCustomerDetails = async (accountNo: string) => {
    try {
      const detail = await getCustomerDetail(accountNo);
      if (detail) { setSelectedCustomer(detail); setCustomerRefreshKey(k => k + 1); }
    } catch {}
  };

  const handleApprovalSuccess = async () => {
    await fetchUpdates();
    if (selectedTransaction) {
      const updated = useTransactionStore.getState().transactions.find(t => t.id === selectedTransaction.id);
      if (updated) setSelectedTransaction(updated);
    }
    if (selectedCustomer?.billingAccount?.accountNo) {
      await refreshCustomerDetails(selectedCustomer.billingAccount.accountNo);
    }
  };

  // ─── Export ───────────────────────────────────────────────────────────────

  const handleExport = () => {
    if (!filteredTransactions.length) return;
    const columns = [
      { key: 'date_processed', label: 'Date Processed' },
      { key: 'account_no', label: 'Account No.' },
      { key: 'received_payment', label: 'Received Payment' },
      { key: 'payment_method', label: 'Payment Method' },
      { key: 'processed_by', label: 'Processed By' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'or_no', label: 'OR No.' },
      { key: 'reference_no', label: 'Reference No.' },
      { key: 'status', label: 'Status' },
      { key: 'transaction_type', label: 'Transaction Type' },
    ];
    const getVal = (t: any, key: string) => {
      switch (key) {
        case 'date_processed': return formatDate(t.date_processed, true);
        case 'account_no': return t.account?.account_no || '-';
        case 'received_payment': return formatCurrency(t.received_payment);
        case 'payment_method': return t.payment_method_info?.payment_method || String(t.payment_method || '-');
        case 'processed_by': return t.processor?.email_address || t.processed_by_user || '-';
        case 'full_name': return t.account?.customer?.full_name || '-';
        case 'or_no': return t.or_no || '-';
        case 'reference_no': return t.reference_no || '-';
        case 'status': return t.status || '-';
        case 'transaction_type': return t.transaction_type || '-';
        default: return '-';
      }
    };
    exportToCSV('transactions_export', columns, filteredTransactions, getVal);
  };

  // ─── Sort label ───────────────────────────────────────────────────────────

  const sortOptions = [
    { key: 'date_processed', label: 'Date Processed' },
    { key: 'received_payment', label: 'Amount' },
    { key: 'status', label: 'Status' },
    { key: 'full_name', label: 'Name' },
  ];

  // ─── Location Filter Modal ────────────────────────────────────────────────

  const renderLocationFilterModal = () => (
    <Modal visible={locationFilterVisible} animationType="slide" onRequestClose={() => setLocationFilterVisible(false)}>
      <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
        <View
          style={{
            paddingTop: isTablet ? 16 : 60,
            paddingHorizontal: 16,
            paddingBottom: 12,
            backgroundColor: '#ffffff',
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827' }}>Filter Location</Text>
          <TouchableOpacity onPress={() => setLocationFilterVisible(false)}>
            <X size={20} color="#374151" />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1, paddingTop: 8 }}>
          {/* All */}
          <TouchableOpacity
            onPress={() => { setSelectedLocation('all'); setLocationFilterVisible(false); }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 14,
              backgroundColor: selectedLocation === 'all' ? `${primary}15` : '#ffffff',
              marginBottom: 1,
            }}
          >
            <Text style={{ fontSize: 14, color: selectedLocation === 'all' ? primary : '#111827', fontWeight: selectedLocation === 'all' ? '600' : '400' }}>
              All Transactions
            </Text>
            <View style={{
              backgroundColor: selectedLocation === 'all' ? primary : '#e5e7eb',
              borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2,
            }}>
              <Text style={{ fontSize: 12, color: selectedLocation === 'all' ? '#ffffff' : '#374151' }}>
                {locationItems.total}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Regions */}
          {locationItems.regions.map((region) => (
            <View key={region.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', marginBottom: 1 }}>
                <TouchableOpacity
                  onPress={() => {
                    const next = new Set(expandedLocations);
                    next.has(region.id) ? next.delete(region.id) : next.add(region.id);
                    setExpandedLocations(next);
                  }}
                  style={{ paddingLeft: 16, paddingVertical: 14, paddingRight: 4 }}
                >
                  {expandedLocations.has(region.id)
                    ? <ChevronDown size={16} color="#6b7280" />
                    : <ChevronRight size={16} color="#6b7280" />}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setSelectedLocation(region.id); setLocationFilterVisible(false); }}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16, paddingVertical: 14 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Receipt size={14} color={selectedLocation === region.id ? primary : '#6b7280'} />
                    <Text style={{ fontSize: 14, color: selectedLocation === region.id ? primary : '#111827', fontWeight: selectedLocation === region.id ? '600' : '400' }}>
                      {region.name}
                    </Text>
                  </View>
                  {region.count > 0 && (
                    <Text style={{ fontSize: 12, color: '#6b7280' }}>{region.count}</Text>
                  )}
                </TouchableOpacity>
              </View>

              {expandedLocations.has(region.id) && region.cities.map((city) => (
                <View key={city.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fafafa', marginBottom: 1 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const next = new Set(expandedLocations);
                        next.has(city.id) ? next.delete(city.id) : next.add(city.id);
                        setExpandedLocations(next);
                      }}
                      style={{ paddingLeft: 36, paddingVertical: 10, paddingRight: 4 }}
                    >
                      {expandedLocations.has(city.id)
                        ? <ChevronDown size={14} color="#9ca3af" />
                        : <ChevronRight size={14} color="#9ca3af" />}
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { setSelectedLocation(city.id); setLocationFilterVisible(false); }}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16, paddingVertical: 10 }}
                    >
                      <Text style={{ fontSize: 13, color: selectedLocation === city.id ? primary : '#374151' }}>{city.name}</Text>
                      {city.count > 0 && <Text style={{ fontSize: 11, color: '#9ca3af' }}>{city.count}</Text>}
                    </TouchableOpacity>
                  </View>

                  {expandedLocations.has(city.id) && city.barangays.map((brgy: any) => (
                    <TouchableOpacity
                      key={brgy.id}
                      onPress={() => { setSelectedLocation(brgy.id); setLocationFilterVisible(false); }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingLeft: 56,
                        paddingRight: 16,
                        paddingVertical: 8,
                        backgroundColor: '#fafafa',
                        marginBottom: 1,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: selectedLocation === brgy.id ? primary : '#d1d5db' }} />
                        <Text style={{ fontSize: 12, color: selectedLocation === brgy.id ? primary : '#6b7280', fontWeight: selectedLocation === brgy.id ? '600' : '400' }}>
                          {brgy.name}
                        </Text>
                      </View>
                      {brgy.count > 0 && <Text style={{ fontSize: 11, color: '#9ca3af' }}>{brgy.count}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );

  // ─── Item renderer ────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item }: { item: Transaction }) => {
    const isSelected = selectedTransaction?.id === item.id;
    const isSelectedBatch = selectedTransactionIds.includes(item.id);
    const isPending = (item.status || '').toLowerCase() === 'pending';
    return (
      <TransactionCard
        transaction={item}
        isSelected={isSelected}
        isBatchMode={isBatchApproveMode}
        isPending={isPending}
        isSelectedBatch={isSelectedBatch}
        onPress={() => handleRowPress(item)}
        onToggle={() => toggleTransactionSelection(item.id)}
        primary={primary}
        paymentMethods={paymentMethods}
      />
    );
  }, [selectedTransaction, selectedTransactionIds, isBatchApproveMode, primary, paymentMethods]);

  const currentTransactionIndex = selectedTransaction
    ? filteredTransactions.findIndex(t => t.id === selectedTransaction.id)
    : -1;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View
        style={{
          paddingTop: isTablet ? 16 : 60,
          paddingHorizontal: 16,
          paddingBottom: 10,
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <GlobalSearch
              searchQuery={searchQuery}
              setSearchQuery={(q) => { setSearchQuery(q); setCurrentPage(1); }}
              isDarkMode={false}
              colorPalette={colorPalette}
              placeholder="Search transactions..."
            />
          </View>
          {/* Location filter button */}
          <TouchableOpacity
            onPress={() => setLocationFilterVisible(true)}
            style={{
              padding: 9,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: selectedLocation !== 'all' ? primary : '#e5e7eb',
              backgroundColor: '#ffffff',
            }}
          >
            <Filter size={18} color={selectedLocation !== 'all' ? primary : '#6b7280'} />
          </TouchableOpacity>
          {/* Export */}
          <TouchableOpacity
            onPress={handleExport}
            disabled={filteredTransactions.length === 0}
            style={{
              padding: 9,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: primary,
              backgroundColor: '#ffffff',
              opacity: filteredTransactions.length === 0 ? 0.4 : 1,
            }}
          >
            <Download size={18} color={primary} />
          </TouchableOpacity>
          {/* Refresh */}
          <TouchableOpacity
            onPress={handleRefresh}
            style={{
              padding: 9,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: primary,
              backgroundColor: '#ffffff',
            }}
          >
            <RefreshCw size={18} color={primary} />
          </TouchableOpacity>
        </View>

        {/* Batch approve row */}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {hasPermission('transaction-list.batch-approve') && (
            <TouchableOpacity
              onPress={() => isBatchApproveMode ? handleCancelApprove() : setIsBatchApproveMode(true)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: isBatchApproveMode ? '#dc2626' : primary,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                gap: 6,
              }}
            >
              {isBatchApproveMode
                ? <X size={15} color="#ffffff" />
                : <CheckCheck size={15} color="#ffffff" />}
              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '500' }}>
                {isBatchApproveMode ? 'Cancel' : 'Batch Approve'}
              </Text>
            </TouchableOpacity>
          )}

          {isBatchApproveMode && (
            <>
              <TouchableOpacity
                onPress={toggleSelectAll}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: primary,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 8,
                  gap: 4,
                }}
              >
                <Text style={{ color: primary, fontSize: 13 }}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBatchApprove}
                disabled={selectedTransactionIds.length === 0 || isApproving}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: selectedTransactionIds.length === 0 ? '#d1d5db' : '#22c55e',
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 8,
                  gap: 6,
                  opacity: isApproving ? 0.6 : 1,
                }}
              >
                <Check size={15} color="#ffffff" />
                <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '500' }}>
                  {isApproving ? 'Approving...' : `Approve (${selectedTransactionIds.length})`}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* Active filter chips */}
          {selectedLocation !== 'all' && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: `${primary}15`, paddingHorizontal: 8,
              paddingVertical: 4, borderRadius: 12,
            }}>
              <Text style={{ fontSize: 11, color: primary }}>
                {selectedLocation.startsWith('reg:') ? selectedLocation.substring(4) :
                 selectedLocation.startsWith('city:') ? selectedLocation.substring(5) :
                 selectedLocation.startsWith('brgy:') ? selectedLocation.substring(5) : selectedLocation}
              </Text>
              <TouchableOpacity onPress={() => setSelectedLocation('all')}>
                <X size={12} color={primary} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Sort row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 2 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {sortOptions.map(opt => (
              <TouchableOpacity
                key={opt.key}
                onPress={() => {
                  if (sortColumn === opt.key) {
                    setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortColumn(opt.key);
                    setSortDirection('desc');
                  }
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 12,
                  backgroundColor: sortColumn === opt.key ? `${primary}15` : '#f3f4f6',
                  gap: 4,
                }}
              >
                <Text style={{ fontSize: 12, color: sortColumn === opt.key ? primary : '#6b7280', fontWeight: sortColumn === opt.key ? '600' : '400' }}>
                  {opt.label}
                </Text>
                {sortColumn === opt.key && (
                  <Text style={{ fontSize: 10, color: primary }}>{sortDirection === 'asc' ? '↑' : '↓'}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* List */}
      {loading && transactions.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator size="large" color={primary} />
          <Text style={{ color: '#6b7280', fontSize: 14 }}>Loading transactions...</Text>
        </View>
      ) : error && transactions.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Text style={{ color: '#ef4444', fontSize: 14 }}>{error}</Text>
          <TouchableOpacity
            onPress={() => fetchTransactions(true)}
            style={{ backgroundColor: primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={paginatedTransactions}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[primary]}
              tintColor={primary}
            />
          }
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 80 }}
          ListEmptyComponent={
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280', fontSize: 14 }}>
                {transactions.length > 0 ? 'No transactions found matching your filters' : 'No transactions found.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            totalPages > 1 ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderTopWidth: 1,
                  borderTopColor: '#e5e7eb',
                  backgroundColor: '#ffffff',
                  marginTop: 4,
                }}
              >
                <Text style={{ fontSize: 12, color: '#6b7280' }}>
                  {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredTransactions.length)} of {filteredTransactions.length}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: currentPage === 1 ? '#e5e7eb' : primary,
                      opacity: currentPage === 1 ? 0.4 : 1,
                    }}
                  >
                    <Text style={{ color: currentPage === 1 ? '#9ca3af' : primary, fontSize: 13 }}>Prev</Text>
                  </TouchableOpacity>
                  <Text style={{ alignSelf: 'center', fontSize: 12, color: '#374151' }}>
                    {currentPage} / {totalPages}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: currentPage === totalPages ? '#e5e7eb' : primary,
                      opacity: currentPage === totalPages ? 0.4 : 1,
                    }}
                  >
                    <Text style={{ color: currentPage === totalPages ? '#9ca3af' : primary, fontSize: 13 }}>Next</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null
          }
        />
      )}

      {/* Location filter modal */}
      {renderLocationFilterModal()}

      {/* Transaction detail modal */}
      {selectedTransaction && (
        <TransactionListDetails
          transaction={selectedTransaction as any}
          onClose={() => setSelectedTransaction(null)}
          onNavigate={onNavigate}
          onViewCustomer={handleViewCustomer}
          onApprovalSuccess={handleApprovalSuccess}
          paymentMethods={paymentMethods}
          onPrevious={currentTransactionIndex > 0 ? () => setSelectedTransaction(filteredTransactions[currentTransactionIndex - 1]) : undefined}
          onNext={currentTransactionIndex !== -1 && currentTransactionIndex < filteredTransactions.length - 1 ? () => setSelectedTransaction(filteredTransactions[currentTransactionIndex + 1]) : undefined}
        />
      )}

      {/* Customer detail modal */}
      {(selectedCustomer || isLoadingDetails) && (
        isLoadingDetails ? (
          <Modal visible animationType="fade" transparent>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={primary} />
              <Text style={{ color: '#ffffff', marginTop: 12 }}>Loading details...</Text>
            </View>
          </Modal>
        ) : selectedCustomer ? (
          <BillingDetails
            billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
            onlineStatusRecords={[]}
            onClose={() => setSelectedCustomer(null)}
            onRefresh={async () => {
              const accountNo = selectedCustomer.billingAccount?.accountNo;
              if (accountNo) await refreshCustomerDetails(accountNo);
            }}
            refreshKey={customerRefreshKey}
          />
        ) : null
      )}

      {/* Approving loading modal */}
      <LoadingModalGlobal
        isOpen={isApproving}
        type="loading"
        title="Approving"
        message="Approving transactions..."
        loadingPercentage={50}
        isDarkMode={false}
        colorPalette={colorPalette}
      />
    </View>
  );
};

export default TransactionList;
