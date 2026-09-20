import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Globe,
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
  Download,
  X,
} from 'lucide-react-native';
import { StandardPage } from '../components/common';
import PaymentPortalDetails from '../components/PaymentPortalDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { usePaymentPortalStore } from '../store/paymentPortalStore';
import { PaymentPortalLog as PaymentPortalRecord } from '../services/paymentPortalLogsService';
import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { getCities, City } from '../services/cityService';
import { getRegions, Region } from '../services/regionService';
import { barangayService, Barangay } from '../services/barangayService';
import { BillingDetailRecord } from '../types/billing';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import PaymentPortalFunnelFilter, { FilterValues, allColumns as filterColumns } from '../filter/PaymentPortalFunnelFilter';
import { exportToCSV } from '../utils/exportUtils';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

const isDarkMode = false;

// ─── Colors ──────────────────────────────────────────────────────────────────

const COLORS = {
  bg: '#f9fafb',
  card: '#ffffff',
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  subBg: '#f3f4f6',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatCurrency = (amount: number) => `₱${Number(amount || 0).toFixed(2)}`;

const convertCustomerDataToBillingDetail = (customerData: CustomerDetailData): BillingDetailRecord => ({
  id: customerData.billingAccount?.accountNo || '',
  applicationId: customerData.billingAccount?.accountNo || '',
  accountNo: customerData.billingAccount?.accountNo || '',
  account_no: customerData.billingAccount?.accountNo || '',
  customerName: customerData.fullName,
  firstName: customerData.firstName,
  lastName: customerData.lastName,
  middleInitial: customerData.middleInitial,
  address: customerData.address,
  status: customerData.billingAccount?.billingStatusName ||
    (customerData.billingAccount?.billingStatusId === 2 ? 'Active' : 'Inactive'),
  balance: customerData.billingAccount?.accountBalance || 0,
  onlineStatus: customerData.onlineSessionStatus || 'Empty',
  cityId: null,
  regionId: null,
  timestamp: customerData.updatedAt || '',
  billingStatus: customerData.billingAccount?.billingStatusName ||
    (customerData.billingAccount?.billingStatusId
      ? (({ 1: 'In Progress', 2: 'Active', 3: 'Suspended', 4: 'Cancelled', 5: 'Overdue', 6: 'Service Account' } as Record<number, string>)[customerData.billingAccount.billingStatusId] || `Status ${customerData.billingAccount.billingStatusId}`)
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
  customerUpdatedAt: (customerData as any).updatedAt,
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
});

// ─── Status badge ─────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = (status || '').toLowerCase();
  let bg = '#e5e7eb';
  let color = '#6b7280';
  if (s === 'completed' || s === 'success' || s === 'paid') { bg = '#dcfce7'; color = '#16a34a'; }
  else if (s === 'pending' || s === 'processing' || s === 'queued') { bg = '#fef9c3'; color = '#ca8a04'; }
  else if (s === 'failed' || s === 'cancelled') { bg = '#fee2e2'; color = '#dc2626'; }

  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color, textTransform: 'capitalize' }}>
        {status || 'N/A'}
      </Text>
    </View>
  );
};

// ─── Record card ──────────────────────────────────────────────────────────────

interface RecordCardProps {
  record: PaymentPortalRecord;
  onPress: () => void;
  isSelected: boolean;
  primaryColor: string;
}

const RecordCard: React.FC<RecordCardProps> = ({ record, onPress, isSelected, primaryColor }) => (
  <TouchableOpacity
    onPress={onPress}
    style={{
      backgroundColor: isSelected ? `${primaryColor}14` : COLORS.card,
      marginHorizontal: 12,
      marginVertical: 4,
      borderRadius: 10,
      padding: 14,
      borderWidth: 1,
      borderColor: isSelected ? primaryColor : COLORS.border,
    }}
  >
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }} numberOfLines={1}>
          {record.fullName || 'Unknown'}
        </Text>
        <Text style={{ fontSize: 13, color: '#ef4444', fontWeight: '600', marginTop: 2 }}>
          {record.accountNo || record.account_id || 'N/A'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: primaryColor }}>
          {formatCurrency(record.total_amount || 0)}
        </Text>
      </View>
    </View>

    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      <StatusBadge status={record.status || 'N/A'} />
      {record.transaction_status && record.transaction_status !== record.status && (
        <StatusBadge status={record.transaction_status} />
      )}
    </View>

    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 12, color: COLORS.muted }}>
        {record.payment_channel || record.provider || 'N/A'}
      </Text>
      <Text style={{ fontSize: 12, color: COLORS.muted }}>
        {record.date_time ? new Date(record.date_time).toLocaleDateString() : 'N/A'}
      </Text>
    </View>

    {record.reference_no ? (
      <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }} numberOfLines={1}>
        Ref: {record.reference_no}
      </Text>
    ) : null}
  </TouchableOpacity>
);

// ─── Main component ───────────────────────────────────────────────────────────

const PaymentPortal: React.FC = () => {
  const {
    paymentPortalRecords: records,
    totalCount,
    isLoading: loading,
    error,
    fetchPaymentPortalRecords,
    refreshPaymentPortalRecords,
    fetchUpdates,
  } = usePaymentPortalStore();

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState<PaymentPortalRecord | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState(false);

  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [activeFilters, setActiveFilters] = useState<FilterValues>({});
  const [locationSidebarVisible, setLocationSidebarVisible] = useState(false);

  const [dateTimeFrom, setDateTimeFrom] = useState('');
  const [dateTimeTo, setDateTimeTo] = useState('');

  const primaryColor = colorPalette?.primary || '#7c3aed';

  // ─── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const loadPalette = async () => {
      try {
        const p = await settingsColorPaletteService.getActive();
        setColorPalette(p);
      } catch {}
    };
    loadPalette();
  }, []);

  useEffect(() => {
    fetchPaymentPortalRecords();
  }, [fetchPaymentPortalRecords]);

  useEffect(() => {
    const loadFilters = async () => {
      try {
        const saved = await AsyncStorage.getItem('paymentPortalFunnelFilters');
        if (saved) setActiveFilters(JSON.parse(saved));
      } catch {}
    };
    loadFilters();
  }, []);

  useEffect(() => {
    const loadLookupData = async () => {
      try {
        const [citiesData, regionsData, barangaysRes] = await Promise.all([
          getCities(),
          getRegions(),
          barangayService.getAll(),
        ]);
        setCities(citiesData || []);
        setRegions(regionsData || []);
        setBarangays(barangaysRes.success ? barangaysRes.data : []);
      } catch {}
    };
    loadLookupData();
  }, []);

  useEffect(() => {
    const loadPaymentMethods = async () => {
      try {
        const res = await paymentMethodService.getAll();
        if (res.success) setPaymentMethods(res.data);
      } catch {}
    };
    loadPaymentMethods();
  }, []);

  // 15-minute auto-refresh interval
  useEffect(() => {
    const intervalId = setInterval(async () => {
      try { await fetchUpdates(); } catch {}
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchUpdates]);

  // Keep selectedRecord fresh as records update
  const selectedRecordRef = useRef<PaymentPortalRecord | null>(null);
  useEffect(() => { selectedRecordRef.current = selectedRecord; }, [selectedRecord]);
  useEffect(() => {
    if (selectedRecordRef.current && records.length > 0) {
      const updated = records.find(r => r.id === selectedRecordRef.current?.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedRecordRef.current)) {
        setSelectedRecord(updated);
      }
    }
  }, [records]);

  // ─── userOrgId ────────────────────────────────────────────────────────────────

  const [userOrgId, setUserOrgId] = useState<number | null>(null);
  useEffect(() => {
    const loadOrgId = async () => {
      try {
        const raw = await AsyncStorage.getItem('authData');
        if (raw) {
          const d = JSON.parse(raw);
          setUserOrgId(d.organization_id || d.user?.organization_id || d.organization?.id || d.user?.organization?.id || null);
        }
      } catch {}
    };
    loadOrgId();
  }, []);

  // ─── Filtering ────────────────────────────────────────────────────────────────

  const globalFilteredRecords = useMemo(() => {
    const q = searchQuery.toLowerCase().replace(/\s+/g, '');

    let filtered = records.filter(record => {
      if (userOrgId) {
        if ((record as any).organization_id !== userOrgId) return false;
      } else {
        if ((record as any).organization_id) return false;
      }

      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return Object.values(val).some(v => checkValue(v));
        return String(val).toLowerCase().replace(/\s+/g, '').includes(q);
      };

      return searchQuery === '' || checkValue(record);
    });

    if (Object.keys(activeFilters).length > 0) {
      filtered = filtered.filter((record: any) =>
        Object.entries(activeFilters).every(([key, filter]: [string, any]) => {
          const getVal = (item: any, k: string) => {
            switch (k) {
              case 'fullName': return item.fullName ?? item.full_name;
              case 'accountNo': return item.accountNo ?? item.account_no;
              case 'reference_no': return item.reference_no ?? item.referenceNo;
              case 'payment_method': {
                const channel = item.payment_channel;
                if (!channel) return null;
                const pm = paymentMethods.find(m => m.payment_method.toLowerCase().trim() === channel.toLowerCase().trim());
                return pm ? String(pm.id) : channel;
              }
              default: return item[k];
            }
          };

          const val = getVal(record, key);

          if (filter.type === 'checklist') {
            if (!filter.value || !Array.isArray(filter.value) || filter.value.length === 0) return true;
            const valStr = String(val || '').toLowerCase().trim();
            if (key === 'barangay' || key === 'city' || key === 'region') {
              const directVal = String(record[key] || '').toLowerCase().trim();
              const address = String(record.address || '').toLowerCase();
              return (filter.value as string[]).some(opt => {
                const o = opt.toLowerCase().trim();
                return directVal === o || address.includes(o);
              });
            }
            return (filter.value as string[]).some(opt => valStr === opt.toLowerCase().trim());
          }

          if (filter.type === 'text') {
            if (!filter.value) return true;
            return String(val || '').toLowerCase().includes(String(filter.value).toLowerCase());
          }

          if (filter.type === 'number') {
            const n = Number(val);
            if (isNaN(n)) return false;
            if (filter.from !== undefined && filter.from !== '' && n < Number(filter.from)) return false;
            if (filter.to !== undefined && filter.to !== '' && n > Number(filter.to)) return false;
            return true;
          }

          if (filter.type === 'date') {
            if (!val) return false;
            const dt = new Date(val).getTime();
            if (isNaN(dt)) return false;
            if (filter.from && dt < new Date(filter.from).getTime()) return false;
            if (filter.to) {
              const toDate = new Date(filter.to);
              toDate.setHours(23, 59, 59, 999);
              if (dt > toDate.getTime()) return false;
            }
            return true;
          }

          return true;
        })
      );
    }

    if (dateTimeFrom || dateTimeTo) {
      filtered = filtered.filter(record => {
        if (!record.date_time) return false;
        const dt = new Date(record.date_time).getTime();
        if (isNaN(dt)) return false;
        if (dateTimeFrom) {
          const from = new Date(dateTimeFrom);
          from.setHours(0, 0, 0, 0);
          if (dt < from.getTime()) return false;
        }
        if (dateTimeTo) {
          const to = new Date(dateTimeTo);
          to.setHours(23, 59, 59, 999);
          if (dt > to.getTime()) return false;
        }
        return true;
      });
    }

    return filtered;
  }, [records, searchQuery, activeFilters, dateTimeFrom, dateTimeTo, userOrgId, paymentMethods]);

  // Location counts
  const locationItems = useMemo(() => {
    const regionCounts: Record<string, number> = {};
    const cityCounts: Record<string, number> = {};
    const barangayCounts: Record<string, number> = {};

    regions.forEach(r => { regionCounts[r.name] = 0; });
    cities.forEach(c => { cityCounts[`${c.region_id}_${c.name}`] = 0; });
    barangays.forEach(b => { barangayCounts[`${b.city_id}_${b.barangay}`] = 0; });

    globalFilteredRecords.forEach(record => {
      const city = record.city;
      const barangay = record.barangay;
      const matchedCity = cities.find(c => c.name === city);
      if (matchedCity) {
        const matchedRegion = regions.find(r => r.id === matchedCity.region_id);
        if (matchedRegion) regionCounts[matchedRegion.name] = (regionCounts[matchedRegion.name] || 0) + 1;
        cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] = (cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] || 0) + 1;
      }
      if (barangay) {
        const matchedBarangay = barangays.find(b => b.barangay === barangay && (!city || cities.find(c => c.id === b.city_id)?.name === city));
        if (matchedBarangay) {
          barangayCounts[`${matchedBarangay.city_id}_${matchedBarangay.barangay}`] = (barangayCounts[`${matchedBarangay.city_id}_${matchedBarangay.barangay}`] || 0) + 1;
        }
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
      total: globalFilteredRecords.length,
    };
  }, [regions, cities, barangays, globalFilteredRecords]);

  const filteredRecords = useMemo(() => {
    return globalFilteredRecords.filter(record => {
      if (selectedLocation === 'all') return true;
      if (selectedLocation.startsWith('reg:')) {
        const regionName = selectedLocation.substring(4);
        const matchedCity = cities.find(c => c.name === record.city);
        const matchedRegion = regions.find(r => r.id === matchedCity?.region_id);
        return matchedRegion?.name === regionName;
      }
      if (selectedLocation.startsWith('city:')) return record.city === selectedLocation.substring(5);
      if (selectedLocation.startsWith('brgy:')) return record.barangay === selectedLocation.substring(5);
      return true;
    });
  }, [globalFilteredRecords, selectedLocation, cities, regions]);

  // ─── Actions ──────────────────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refreshPaymentPortalRecords(); } finally { setRefreshing(false); }
  };

  const handleManualRefresh = async () => {
    setIsRefreshingManual(true);
    try { await fetchUpdates(); } finally { setIsRefreshingManual(false); }
  };

  const handleViewCustomer = async (accountNo: string) => {
    setIsLoadingDetails(true);
    try {
      const detail = await getCustomerDetail(accountNo);
      if (detail) setSelectedCustomer(detail);
    } catch (err) {
      console.error('Error fetching customer details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleExport = async () => {
    if (!filteredRecords || filteredRecords.length === 0) {
      Alert.alert('No data', 'No records to export.');
      return;
    }
    const exportCols = [
      { key: 'date_time', label: 'Date Time' },
      { key: 'accountNo', label: 'Account No' },
      { key: 'fullName', label: 'Full Name' },
      { key: 'total_amount', label: 'Total Amount' },
      { key: 'status', label: 'Status' },
      { key: 'reference_no', label: 'Reference No' },
      { key: 'contactNo', label: 'Contact Number' },
      { key: 'accountBalance', label: 'Account Balance' },
      { key: 'checkout_id', label: 'Checkout ID' },
      { key: 'transaction_status', label: 'Transaction Status' },
      { key: 'payment_channel', label: 'Payment Channel' },
    ];
    const getVal = (record: PaymentPortalRecord, key: string) => {
      switch (key) {
        case 'accountNo': return record.accountNo || (record as any).account_id || '-';
        case 'total_amount': return formatCurrency(record.total_amount || 0);
        case 'accountBalance': return formatCurrency(record.accountBalance || 0);
        default: return (record as any)[key] || '-';
      }
    };
    try {
      await exportToCSV('payment_portal_export', exportCols, filteredRecords, getVal);
    } catch (e) {
      Alert.alert('Export failed', String(e));
    }
  };

  const removeFilter = async (key: string) => {
    const next = { ...activeFilters };
    delete next[key];
    setActiveFilters(next);
    try { await AsyncStorage.setItem('paymentPortalFunnelFilters', JSON.stringify(next)); } catch {}
  };

  const toggleLocationExpansion = (locationId: string) => {
    setExpandedLocations(prev => {
      const next = new Set(prev);
      if (next.has(locationId)) next.delete(locationId);
      else next.add(locationId);
      return next;
    });
  };

  const currentRecordIndex = selectedRecord
    ? filteredRecords.findIndex(r => r.id === selectedRecord.id)
    : -1;

  const handlePreviousRecord = () => {
    if (currentRecordIndex > 0) setSelectedRecord(filteredRecords[currentRecordIndex - 1]);
  };

  const handleNextRecord = () => {
    if (currentRecordIndex !== -1 && currentRecordIndex < filteredRecords.length - 1)
      setSelectedRecord(filteredRecords[currentRecordIndex + 1]);
  };

  const currentCustomerIndex = selectedCustomer?.billingAccount?.accountNo
    ? filteredRecords.findIndex(r => r.accountNo === selectedCustomer.billingAccount!.accountNo || (r as any).account_id === selectedCustomer.billingAccount!.accountNo)
    : -1;

  const handlePreviousCustomer = () => {
    if (currentCustomerIndex > 0) {
      const prev = filteredRecords[currentCustomerIndex - 1];
      const acc = prev.accountNo || (prev as any).account_id;
      if (acc) handleViewCustomer(String(acc));
    }
  };

  const handleNextCustomer = () => {
    if (currentCustomerIndex !== -1 && currentCustomerIndex < filteredRecords.length - 1) {
      const next = filteredRecords[currentCustomerIndex + 1];
      const acc = next.accountNo || (next as any).account_id;
      if (acc) handleViewCustomer(String(acc));
    }
  };

  // ─── Location Sidebar Modal ───────────────────────────────────────────────────

  const renderLocationSidebar = () => (
    <Modal
      visible={locationSidebarVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setLocationSidebarVisible(false)}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setLocationSidebarVisible(false)} />
        <View style={{ height: '80%', backgroundColor: COLORS.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>Locations</Text>
            <TouchableOpacity onPress={() => setLocationSidebarVisible(false)}>
              <X size={20} color={COLORS.muted} />
            </TouchableOpacity>
          </View>

          {/* Date range */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Date Range</Text>
              {(dateTimeFrom || dateTimeTo) && (
                <TouchableOpacity onPress={() => { setDateTimeFrom(''); setDateTimeTo(''); }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: primaryColor }}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>From</Text>
            <TextInput
              value={dateTimeFrom}
              onChangeText={setDateTimeFrom}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              style={{
                borderWidth: 1, borderColor: dateTimeFrom ? primaryColor : COLORS.border,
                borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
                fontSize: 12, color: COLORS.text, backgroundColor: COLORS.card, marginBottom: 8,
              }}
            />
            <Text style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>To</Text>
            <TextInput
              value={dateTimeTo}
              onChangeText={setDateTimeTo}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              style={{
                borderWidth: 1, borderColor: dateTimeTo ? primaryColor : COLORS.border,
                borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
                fontSize: 12, color: COLORS.text, backgroundColor: COLORS.card,
              }}
            />
          </View>

          <ScrollView style={{ flex: 1 }}>
            {/* All */}
            <TouchableOpacity
              onPress={() => { setSelectedLocation('all'); setLocationSidebarVisible(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingHorizontal: 16, paddingVertical: 12,
                backgroundColor: selectedLocation === 'all' ? `${primaryColor}1a` : 'transparent',
              }}
            >
              <Text style={{ fontSize: 14, color: selectedLocation === 'all' ? primaryColor : COLORS.text, fontWeight: selectedLocation === 'all' ? '700' : '400' }}>All Records</Text>
              <View style={{ backgroundColor: selectedLocation === 'all' ? primaryColor : COLORS.subBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 12, color: selectedLocation === 'all' ? '#ffffff' : COLORS.muted }}>{locationItems.total}</Text>
              </View>
            </TouchableOpacity>

            {locationItems.regions.map((region: any) => (
              <View key={region.id}>
                <TouchableOpacity
                  onPress={() => { setSelectedLocation(region.id); setLocationSidebarVisible(false); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 16, paddingVertical: 12,
                    backgroundColor: selectedLocation === region.id ? `${primaryColor}1a` : 'transparent',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <TouchableOpacity onPress={() => toggleLocationExpansion(region.id)} style={{ padding: 4, marginRight: 4 }}>
                      {expandedLocations.has(region.id)
                        ? <ChevronDown size={16} color={selectedLocation === region.id ? primaryColor : COLORS.muted} />
                        : <ChevronRight size={16} color={selectedLocation === region.id ? primaryColor : COLORS.muted} />
                      }
                    </TouchableOpacity>
                    <Globe size={14} color={selectedLocation === region.id ? primaryColor : COLORS.muted} style={{ marginRight: 8 }} />
                    <Text style={{ fontSize: 14, color: selectedLocation === region.id ? primaryColor : COLORS.text, fontWeight: selectedLocation === region.id ? '700' : '400' }}>
                      {region.name}
                    </Text>
                  </View>
                  {region.count > 0 && (
                    <View style={{ backgroundColor: selectedLocation === region.id ? primaryColor : COLORS.subBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 12, color: selectedLocation === region.id ? '#ffffff' : COLORS.muted }}>{region.count}</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {expandedLocations.has(region.id) && region.cities.map((city: any) => (
                  <View key={city.id}>
                    <TouchableOpacity
                      onPress={() => { setSelectedLocation(city.id); setLocationSidebarVisible(false); }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                        paddingLeft: 40, paddingRight: 16, paddingVertical: 10,
                        backgroundColor: selectedLocation === city.id ? `${primaryColor}12` : 'transparent',
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <TouchableOpacity onPress={() => toggleLocationExpansion(city.id)} style={{ padding: 4, marginRight: 4 }}>
                          {expandedLocations.has(city.id)
                            ? <ChevronDown size={14} color={COLORS.muted} />
                            : <ChevronRight size={14} color={COLORS.muted} />
                          }
                        </TouchableOpacity>
                        <Text style={{ fontSize: 13, color: selectedLocation === city.id ? primaryColor : COLORS.muted }}>
                          {city.name}
                        </Text>
                      </View>
                      {city.count > 0 && (
                        <Text style={{ fontSize: 12, color: COLORS.muted }}>{city.count}</Text>
                      )}
                    </TouchableOpacity>

                    {expandedLocations.has(city.id) && city.barangays.map((brgy: any) => (
                      <TouchableOpacity
                        key={brgy.id}
                        onPress={() => { setSelectedLocation(brgy.id); setLocationSidebarVisible(false); }}
                        style={{
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                          paddingLeft: 64, paddingRight: 16, paddingVertical: 8,
                          backgroundColor: selectedLocation === brgy.id ? `${primaryColor}0a` : 'transparent',
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: selectedLocation === brgy.id ? primaryColor : COLORS.muted, marginRight: 8, opacity: 0.6 }} />
                          <Text style={{ fontSize: 12, color: selectedLocation === brgy.id ? primaryColor : COLORS.muted, fontWeight: selectedLocation === brgy.id ? '700' : '400' }}>
                            {brgy.name}
                          </Text>
                        </View>
                        {brgy.count > 0 && (
                          <Text style={{ fontSize: 11, color: COLORS.muted, opacity: 0.6 }}>{brgy.count}</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // ─── Render ───────────────────────────────────────────────────────────────────

  const describeActiveFilter = (filter: any): string => {
    if (filter.type === 'text' || filter.type === 'boolean') return String(filter.value);
    if (filter.type === 'checklist') return Array.isArray(filter.value) ? filter.value.join(', ') : String(filter.value || '');
    if (filter.type === 'number' || filter.type === 'date') {
      if (filter.from && filter.to) return `${filter.from} - ${filter.to}`;
      if (filter.from) return `> ${filter.from}`;
      if (filter.to) return `< ${filter.to}`;
    }
    return '';
  };

  return (
    <StandardPage<any>
      data={filteredRecords}
      keyExtractor={(item) => String(item.id)}
      renderItem={(item) => (
        <RecordCard
          record={item}
          onPress={() => setSelectedRecord(item)}
          isSelected={selectedRecord?.id === item.id}
          primaryColor={primaryColor}
        />
      )}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search payment portal records..."
      onOpenFunnel={() => setIsFunnelFilterOpen(true)}
      activeFilterCount={Object.keys(activeFilters).length}
      chips={Object.entries(activeFilters).map(([key, filter]: [string, any]) => ({
        key,
        label: (filterColumns.find((c: any) => c.key === key) as any)?.label || key,
        value: describeActiveFilter(filter),
      }))}
      onRemoveChip={removeFilter}
      onClearChips={async () => {
        setActiveFilters({});
        try { await AsyncStorage.removeItem('paymentPortalFunnelFilters'); } catch {}
      }}
      onExport={handleExport}
      exportDisabled={loading || filteredRecords.length === 0}
      onRefresh={handleManualRefresh}
      refreshDisabled={loading || isRefreshingManual}
      isRefreshing={loading || isRefreshingManual}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      isLoading={loading && records.length === 0}
      loadingText="Loading payment portal records..."
      error={error}
      onRetry={() => fetchPaymentPortalRecords(true)}
      emptyText={records.length > 0 ? 'No records matching your filters.' : 'No payment portal records found.'}
      progressText={`${filteredRecords.length} of ${Math.max(totalCount, records.length)} records`}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={(n) => { setItemsPerPage(n); setCurrentPage(1); }}
      colorPalette={colorPalette}
      isDarkMode={isDarkMode}
      toolbarActions={
        <TouchableOpacity
          onPress={() => setLocationSidebarVisible(true)}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: selectedLocation !== 'all' ? primaryColor : COLORS.border,
            backgroundColor: selectedLocation !== 'all' ? `${primaryColor}14` : COLORS.card,
          }}
        >
          <Globe size={18} color={selectedLocation !== 'all' ? primaryColor : COLORS.muted} />
        </TouchableOpacity>
      }
    >
      {/* Detail Modal */}
      {selectedRecord && (
        <PaymentPortalDetails
          record={selectedRecord as any}
          onClose={() => setSelectedRecord(null)}
          onViewCustomer={handleViewCustomer}
          onPrevious={currentRecordIndex > 0 ? handlePreviousRecord : undefined}
          onNext={currentRecordIndex !== -1 && currentRecordIndex < filteredRecords.length - 1 ? handleNextRecord : undefined}
        />
      )}

      {/* Customer Detail Modal */}
      {(selectedCustomer || isLoadingDetails) && (
        <Modal
          visible
          animationType="slide"
          transparent={false}
          onRequestClose={() => { setSelectedCustomer(null); setIsLoadingDetails(false); }}
        >
          {isLoadingDetails ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg, paddingTop: 60 }}>
              <ActivityIndicator size="large" color={primaryColor} />
              <Text style={{ marginTop: 12, color: COLORS.muted }}>Loading details...</Text>
            </View>
          ) : selectedCustomer ? (
            <BillingDetails
              billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
              onlineStatusRecords={[]}
              onClose={() => setSelectedCustomer(null)}
              onPrevious={currentCustomerIndex > 0 ? handlePreviousCustomer : undefined}
              onNext={currentCustomerIndex !== -1 && currentCustomerIndex < filteredRecords.length - 1 ? handleNextCustomer : undefined}
            />
          ) : null}
        </Modal>
      )}

      {/* Location Sidebar Modal */}
      {renderLocationSidebar()}

      {/* Funnel Filter */}
      <PaymentPortalFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={async (filters) => {
          setActiveFilters(filters);
          try { await AsyncStorage.setItem('paymentPortalFunnelFilters', JSON.stringify(filters)); } catch {}
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={activeFilters}
      />
    </StandardPage>
  );
};

export default PaymentPortal;
