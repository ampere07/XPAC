import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  Dimensions,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Circle,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Download,
  SlidersHorizontal,
  ChevronLeft,
  X,
} from 'lucide-react-native';
import BillingDetails from '../components/CustomerDetails';
import { BillingRecord } from '../services/billingService';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import { getCities, City } from '../services/cityService';
import { getRegions, Region } from '../services/regionService';
import { barangayService, Barangay } from '../services/barangayService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useBillingStore } from '../store/billingStore';
import { billingStatusService, BillingStatus } from '../services/billingStatusService';
import { userService } from '../services/userService';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { exportToCSV } from '../utils/exportUtils';
import { accountStatusFrom, sessionStatusFrom, getOnlineStatusInfo } from '../utils/onlineStatus';

const isDarkMode = false;

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

const convertCustomerDataToBillingDetail = (customerData: CustomerDetailData): BillingDetailRecord => {
  return {
    id: customerData.billingAccount?.accountNo || '',
    applicationId: customerData.billingAccount?.accountNo || '',
    customerName: customerData.fullName,
    firstName: customerData.firstName,
    middleInitial: customerData.middleInitial,
    lastName: customerData.lastName,
    address: customerData.address,
    status: accountStatusFrom(customerData),
    balance: customerData.billingAccount?.accountBalance || 0,
    onlineStatus: sessionStatusFrom(customerData),
    cityId: null,
    regionId: null,
    timestamp: customerData.updatedAt || '',
    billingStatus: customerData.billingAccount?.billingStatusName || (customerData.billingAccount?.billingStatusId ? `Status ${customerData.billingAccount.billingStatusId}` : ''),
    billing_status_id: customerData.billingAccount?.billingStatusId,
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
    totalPaid: (customerData as any).totalPaid || (customerData as any).total_paid || 0,
    provider: customerData.groupName || '',
    lcp: customerData.technicalDetails?.lcp || '',
    nap: customerData.technicalDetails?.nap || '',
    modifiedBy: (customerData.billingAccount as any)?.updatedBy || (customerData as any).updatedBy || '',
    modifiedDate: customerData.updatedAt || '',
    barangay: customerData.barangay || '',
    city: customerData.city || '',
    region: customerData.region || '',
    usageType: customerData.technicalDetails?.usageType || '',
    referredBy: customerData.referredBy || '',
    referralContactNo: '',
    groupName: customerData.groupName || '',
    mikrotikId: '',
    houseFrontPicture: customerData.houseFrontPictureUrl || '',
    accountBalance: customerData.billingAccount?.accountBalance || 0,
    housingStatus: customerData.housingStatus || '',
    addressCoordinates: customerData.addressCoordinates || '',
    lcpnapport: `${customerData.technicalDetails?.lcpnap || ''} ${customerData.technicalDetails?.port || ''}`.trim(),
    balanceUpdateDate: customerData.billingAccount?.balanceUpdateDate || '',
    billingAccountCreatedBy: (customerData.billingAccount as any)?.createdBy || '',
    billingAccountCreatedAt: (customerData.billingAccount as any)?.createdAt || '',
    billingAccountUpdatedBy: (customerData.billingAccount as any)?.updatedBy || '',
    billingAccountUpdatedAt: (customerData.billingAccount as any)?.updatedAt || '',
    proofOfBillingUrl: (customerData as any).proofOfBillingUrl || '',
    governmentValidIdUrl: (customerData as any).governmentValidIdUrl || '',
    secondGovernmentValidIdUrl: (customerData as any).secondGovernmentValidIdUrl || '',
    documentAttachmentUrl: (customerData as any).documentAttachmentUrl || '',
    otherIspBillUrl: (customerData as any).otherIspBillUrl || '',
    accountNoCustomer: (customerData as any).accountNoCustomer || '',
    customerUpdatedBy: (customerData as any).updatedBy || '',
    customerUpdatedAt: customerData.updatedAt || '',
    techUpdatedBy: (customerData.technicalDetails as any)?.updatedBy || '',
    techUpdatedAt: (customerData.technicalDetails as any)?.updatedAt || '',
    sessionGroup: (customerData as any).session_group || '',
    sessionIp: (customerData as any).session_ip || customerData.technicalDetails?.ipAddress || '',
    sessionIP: (customerData as any).session_ip || customerData.technicalDetails?.ipAddress || '',
    vip_expiration: (customerData.billingAccount as any)?.vip_expiration || '',
    vip_remarks: (customerData.billingAccount as any)?.vip_remarks || '',
  } as BillingDetailRecord;
};

// Columns used for CSV export
const exportColumns = [
  { key: 'status', label: 'Status' },
  { key: 'billingStatus', label: 'Billing Status' },
  { key: 'accountNo', label: 'Account No.' },
  { key: 'dateInstalled', label: 'Date Installed' },
  { key: 'customerName', label: 'Full Name' },
  { key: 'address', label: 'Address' },
  { key: 'contactNumber', label: 'Contact Number' },
  { key: 'emailAddress', label: 'Email Address' },
  { key: 'plan', label: 'Plan' },
  { key: 'balance', label: 'Account Balance' },
  { key: 'username', label: 'Username' },
  { key: 'barangay', label: 'Barangay' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'Region' },
];

interface CustomerProps {
  initialSearchQuery?: string;
  autoOpenAccountNo?: string;
}

const Customer: React.FC<CustomerProps> = ({ initialSearchQuery, autoOpenAccountNo }) => {
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery || '');
  const { billingRecords, totalCount, isLoading: isTableLoading, error: contextError, fetchBillingRecords, refreshLatestData } = useBillingStore();
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const selectedCustomerRef = useRef<CustomerDetailData | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [billingStatuses, setBillingStatuses] = useState<BillingStatus[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userEmailCache, setUserEmailCache] = useState<Record<string, string>>({});
  const [userOrgId, setUserOrgId] = useState<any>(null);

  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  const error = localError || contextError;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    selectedCustomerRef.current = selectedCustomer;
  }, [selectedCustomer]);

  // Load org id from AsyncStorage
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('authData');
        if (raw) {
          const authData = JSON.parse(raw);
          setUserOrgId(
            authData.organization_id ||
            authData.user?.organization_id ||
            authData.organization?.id ||
            authData.user?.organization?.id ||
            null
          );
        }
      } catch {
        setUserOrgId(null);
      }
    })();
  }, []);

  // Fetch supporting location + palette data
  useEffect(() => {
    const fetchLocationData = async () => {
      try {
        const [citiesData, regionsData, barangaysRes, statusesRes, activePalette] = await Promise.all([
          getCities(),
          getRegions(),
          barangayService.getAll(),
          billingStatusService.getAll(),
          settingsColorPaletteService.getActive(),
        ]);
        setCities(citiesData || []);
        setRegions(regionsData || []);
        setBarangays((barangaysRes as any)?.success ? (barangaysRes as any).data : []);
        setBillingStatuses(statusesRes || []);
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch location data:', err);
        setCities([]);
        setRegions([]);
        setBarangays([]);
      }
    };
    fetchLocationData();
  }, []);

  // Initial load
  useEffect(() => {
    fetchBillingRecords();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Silent refresh every 15 minutes (pusher is a no-op stub in RN)
  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshLatestData().catch((err) => console.error('[Customer] Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [refreshLatestData]);

  // Sync initialSearchQuery
  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // Auto-open account if prop provided
  useEffect(() => {
    const autoOpen = async () => {
      if (autoOpenAccountNo) {
        setIsLoadingDetails(true);
        setDetailsModalVisible(true);
        try {
          const detail = await getCustomerDetail(autoOpenAccountNo);
          if (detail) setSelectedCustomer(detail);
        } catch (err) {
          console.error('Error auto-opening customer details:', err);
        } finally {
          setIsLoadingDetails(false);
        }
      }
    };
    autoOpen();
  }, [autoOpenAccountNo]);

  // Reset selected location if regions change and selected location is no longer valid
  useEffect(() => {
    if (selectedLocation === 'all') return;
    const [type, name] = selectedLocation.split(':');
    let isValid = false;
    if (type === 'status') isValid = true;
    else if (type === 'reg') isValid = regions.some((r) => r.name === name);
    else if (type === 'city') isValid = cities.some((c) => c.name === name);
    else if (type === 'brgy') isValid = barangays.some((b) => b.barangay === name);
    if (!isValid) setSelectedLocation('all');
  }, [regions, cities, barangays, selectedLocation]);

  // Delegated to the shared resolver — this list and the Customer Details panel it opens
  // must bucket an account the same way. Returned shape is unchanged.
  const getStatusInfo = getOnlineStatusInfo;

  // 1. Global filtered set (org + search) — powers sidebar counts
  const globalFilteredRecords = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
    return billingRecords.filter((record) => {
      if (userOrgId) {
        if ((record as any).organization_id !== userOrgId) return false;
      } else {
        if ((record as any).organization_id) return false;
      }
      return (
        searchQuery === '' ||
        Object.values(record).some((value) => {
          if (value === null || value === undefined) return false;
          return String(value).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
        })
      );
    });
  }, [billingRecords, searchQuery, userOrgId]);

  // 2. Status tree (Status > (Session) > Billing Status > Barangay)
  const statusTree = useMemo(() => {
    const tree: Record<string, {
      count: number;
      bStatuses: Record<string, { count: number; barangays: Record<string, number> }>;
      sessionStatuses?: Record<string, { count: number; bStatuses: Record<string, { count: number; barangays: Record<string, number> }> }>;
    }> = {};

    globalFilteredRecords.forEach((record: BillingRecord) => {
      const accessStatus = record.status || '';
      let bucket = 'offline';
      const lowerStatus = accessStatus.toLowerCase();
      const lowerOnlineStatus = (record.onlineStatus || '').toLowerCase();

      if (lowerStatus === 'restricted' || lowerOnlineStatus === 'restricted') bucket = 'restricted';
      else if (lowerStatus === 'not found' || lowerOnlineStatus === 'not found') bucket = 'not found';
      else if (lowerStatus === 'disconnected' || lowerOnlineStatus === 'disconnected') bucket = 'disconnected';
      else if (lowerStatus === 'inactive') bucket = 'offline';
      else if (['online', 'active', 'connected'].includes(lowerOnlineStatus)) bucket = 'online';
      else if (lowerOnlineStatus && lowerOnlineStatus !== 'offline' && lowerOnlineStatus !== 'empty') bucket = lowerOnlineStatus;

      if (!tree[bucket]) {
        tree[bucket] = { count: 0, bStatuses: {}, sessionStatuses: (bucket === 'restricted' || bucket === 'disconnected') ? {} : undefined };
      }

      tree[bucket].count++;
      const bStatus = record.billingStatus || 'Regular';
      const brgy = record.barangay || 'No Barangay';

      if (bucket === 'restricted' || bucket === 'disconnected') {
        const isActive = ((record as any).active_sessions || 0) >= 1;
        const sessionKey = isActive ? 'online' : 'offline';
        if (!tree[bucket].sessionStatuses![sessionKey]) {
          tree[bucket].sessionStatuses![sessionKey] = { count: 0, bStatuses: {} };
        }
        tree[bucket].sessionStatuses![sessionKey].count++;
        if (!tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus]) {
          tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus] = { count: 0, barangays: {} };
        }
        tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus].count++;
        tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus].barangays[brgy] =
          (tree[bucket].sessionStatuses![sessionKey].bStatuses[bStatus].barangays[brgy] || 0) + 1;
      } else {
        if (!tree[bucket].bStatuses[bStatus]) {
          tree[bucket].bStatuses[bStatus] = { count: 0, barangays: {} };
        }
        tree[bucket].bStatuses[bStatus].count++;
        tree[bucket].bStatuses[bStatus].barangays[brgy] = (tree[bucket].bStatuses[bStatus].barangays[brgy] || 0) + 1;
      }
    });

    return {
      items: Object.keys(tree).map((name) => ({
        id: `status:${name}`,
        name,
        count: tree[name].count,
        sessionStatuses: tree[name].sessionStatuses ? Object.entries(tree[name].sessionStatuses!).map(([sKey, sData]) => ({
          id: `status:${name}:session:${sKey}`,
          name: sKey === 'online' ? 'Session Online' : 'Session Offline',
          count: sData.count,
          bStatuses: Object.entries(sData.bStatuses).sort().map(([bName, bData]) => ({
            id: `status:${name}:session:${sKey}:billing:${bName}`,
            name: bName,
            count: bData.count,
            barangays: Object.entries(bData.barangays).sort().map(([brgyName, brgyCount]) => ({
              id: `status:${name}:session:${sKey}:billing:${bName}:brgy:${brgyName}`,
              name: brgyName,
              count: brgyCount,
            })),
          })),
        })) : undefined,
        bStatuses: !tree[name].sessionStatuses ? Object.entries(tree[name].bStatuses).sort().map(([bName, bData]) => ({
          id: `status:${name}:billing:${bName}`,
          name: bName,
          count: bData.count,
          barangays: Object.entries(bData.barangays).sort().map(([brgyName, brgyCount]) => ({
            id: `status:${name}:billing:${bName}:brgy:${brgyName}`,
            name: brgyName,
            count: brgyCount,
          })),
        })) : [],
      })).sort((a, b) => {
        const order = ['online', 'offline', 'disconnected', 'restricted', 'not found', 'empty'];
        const indexA = order.indexOf(a.name.toLowerCase());
        const indexB = order.indexOf(b.name.toLowerCase());
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.name.localeCompare(b.name);
      }),
      total: globalFilteredRecords.length,
    };
  }, [globalFilteredRecords]);

  // 3. Location-filtered records for the list
  const filteredBillingRecords = useMemo(() => {
    return globalFilteredRecords.filter((record: BillingRecord) => {
      let matchesLocation = selectedLocation === 'all';
      if (!matchesLocation) {
        if (selectedLocation.startsWith('status:')) {
          const parts = selectedLocation.split(':');
          const statusName = parts[1];
          const accessStatus = record.status || '';
          let recordBucket = 'offline';
          const lowerStatus = accessStatus.toLowerCase();
          const lowerOnlineStatus = (record.onlineStatus || '').toLowerCase();

          if (lowerStatus === 'restricted' || lowerOnlineStatus === 'restricted') recordBucket = 'restricted';
          else if (lowerStatus === 'not found' || lowerOnlineStatus === 'not found') recordBucket = 'not found';
          else if (lowerStatus === 'disconnected' || lowerOnlineStatus === 'disconnected') recordBucket = 'disconnected';
          else if (lowerStatus === 'inactive') recordBucket = 'offline';
          else if (['online', 'active', 'connected'].includes(lowerOnlineStatus)) recordBucket = 'online';
          else if (lowerOnlineStatus && lowerOnlineStatus !== 'offline' && lowerOnlineStatus !== 'empty') recordBucket = lowerOnlineStatus;

          if (recordBucket !== statusName) return false;
          let currentLevel = 2;

          if (parts.length > currentLevel && parts[currentLevel] === 'session') {
            const sessionType = parts[currentLevel + 1];
            const isActive = ((record as any).active_sessions || 0) >= 1;
            const recordSession = isActive ? 'online' : 'offline';
            if (recordSession !== sessionType) return false;
            currentLevel += 2;
          }

          if (parts.length > currentLevel && parts[currentLevel] === 'billing') {
            const bStatus = parts[currentLevel + 1];
            if (record.billingStatus !== bStatus) return false;
            currentLevel += 2;
            if (parts.length > currentLevel && parts[currentLevel] === 'brgy') {
              const brgyName = parts[currentLevel + 1];
              if (record.barangay !== brgyName) return false;
            }
          }
          matchesLocation = true;
        } else if (selectedLocation.startsWith('reg:')) {
          matchesLocation = record.region === selectedLocation.substring(4);
        } else if (selectedLocation.startsWith('city:')) {
          matchesLocation = record.city === selectedLocation.substring(5);
        } else if (selectedLocation.startsWith('brgy:')) {
          matchesLocation = record.barangay === selectedLocation.substring(5);
        }
      }
      return matchesLocation;
    });
  }, [globalFilteredRecords, selectedLocation]);

  // Resolve user IDs for Modified By display (visible records)
  useEffect(() => {
    const resolveUserIds = async () => {
      const ids = filteredBillingRecords
        .slice(0, 100)
        .map((record) => record.modifiedBy)
        .filter((v): v is string => !!v && !isNaN(Number(v)));
      const uniqueIds = Array.from(new Set(ids));
      await Promise.all(
        uniqueIds.map(async (id) => {
          if (userEmailCache[id]) return;
          try {
            const res = await userService.getUserById(Number(id));
            if (res.success && res.data?.email_address) {
              setUserEmailCache((prev) => ({ ...prev, [id]: res.data!.email_address }));
            }
          } catch (err) {
            console.error(`Failed to resolve user ID ${id}:`, err);
          }
        })
      );
    };
    if (filteredBillingRecords.length > 0) resolveUserIds();
  }, [filteredBillingRecords]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleRecordClick = async (record: BillingRecord) => {
    try {
      setIsLoadingDetails(true);
      setDetailsModalVisible(true);
      const customerData = await getCustomerDetail(record.applicationId);
      setSelectedCustomer(customerData);
    } catch (err) {
      console.error('Failed to fetch customer details:', err);
      setLocalError('Failed to load customer details');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleCloseDetails = () => {
    setDetailsModalVisible(false);
    setSelectedCustomer(null);
  };

  const currentRecordIndex = selectedCustomer?.billingAccount?.accountNo
    ? filteredBillingRecords.findIndex((r) => r.applicationId === selectedCustomer.billingAccount!.accountNo)
    : -1;

  const handlePreviousRecord = () => {
    if (currentRecordIndex > 0) handleRecordClick(filteredBillingRecords[currentRecordIndex - 1]);
  };

  const handleNextRecord = () => {
    if (currentRecordIndex !== -1 && currentRecordIndex < filteredBillingRecords.length - 1) {
      handleRecordClick(filteredBillingRecords[currentRecordIndex + 1]);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshLatestData();
    } catch (err) {
      console.error('Failed to refresh billing records:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const getExportValue = (record: BillingRecord, key: string): string => {
    switch (key) {
      case 'status': return getStatusInfo(record).label;
      case 'accountNo': return record.applicationId;
      case 'billingStatus': return record.billingStatus || 'Active';
      case 'dateInstalled': return formatDate(record.dateInstalled);
      case 'customerName': return record.customerName || '-';
      case 'address': return record.address || '-';
      case 'contactNumber': return record.contactNumber || '-';
      case 'emailAddress': return record.emailAddress || '-';
      case 'plan': return record.plan || '-';
      case 'balance': return `${record.balance?.toFixed(2) ?? '0.00'}`;
      case 'username': return record.username || '-';
      case 'barangay': return record.barangay || '-';
      case 'city': return record.city || '-';
      case 'region': return record.region || '-';
      default: return String((record as any)[key] ?? '-');
    }
  };

  const handleExport = () => {
    if (!filteredBillingRecords || filteredBillingRecords.length === 0) return;
    exportToCSV('customers_export', exportColumns, filteredBillingRecords, getExportValue);
  };

  const toggleExpand = (id: string) => {
    setExpandedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectLocation = (id: string) => {
    setSelectedLocation(id);
    setSidebarVisible(false);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const selectedLocationLabel = useMemo(() => {
    if (selectedLocation === 'all') return 'All Customers';
    const parts = selectedLocation.split(':');
    return parts[parts.length - 1] || 'All Customers';
  }, [selectedLocation]);

  const renderCard = ({ item }: { item: BillingRecord }) => {
    const statusInfo = getStatusInfo(item);
    const isSelected = selectedCustomer?.billingAccount?.accountNo === item.applicationId;
    return (
      <TouchableOpacity
        onPress={() => handleRecordClick(item)}
        style={[styles.card, isSelected && { borderColor: primaryColor, borderWidth: 2 }]}
        activeOpacity={0.75}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.accountNo} numberOfLines={1}>{item.applicationId}</Text>
          <View style={styles.onlineRow}>
            {!statusInfo.hideCircle && (
              <Circle size={9} color={statusInfo.hex} fill={statusInfo.hollow ? 'transparent' : statusInfo.hex} strokeWidth={statusInfo.hollow ? 3 : 1} />
            )}
            <Text style={[styles.onlineLabel, { color: statusInfo.hex }]}>{statusInfo.label}</Text>
          </View>
        </View>
        <Text style={styles.customerName} numberOfLines={1}>{item.customerName || '-'}</Text>
        {item.address ? <Text style={styles.cardAddress} numberOfLines={1}>{item.address}</Text> : null}
        <View style={styles.cardFooter}>
          <Text style={styles.cardBalance}>
            Balance: <Text style={{ fontWeight: '700', color: '#111827' }}>₱{item.balance?.toFixed(2) ?? '0.00'}</Text>
          </Text>
          <Text style={styles.billingStatusBadge}>{item.billingStatus || 'Active'}</Text>
        </View>
        {item.plan ? <Text style={styles.cardMuted} numberOfLines={1}>{item.plan}</Text> : null}
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      {isTableLoading ? (
        <>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.emptyText}>Loading customer records...</Text>
        </>
      ) : error ? (
        <>
          <Text style={[styles.emptyText, { color: '#dc2626' }]}>{error}</Text>
          <TouchableOpacity onPress={handleRefresh} style={[styles.retryBtn, { borderColor: primaryColor }]}>
            <Text style={{ color: primaryColor, fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.emptyText}>
          {billingRecords.length > 0 ? 'No customer records found matching your filters' : (totalCount > billingRecords.length ? 'Loading more records...' : 'No customer records found')}
        </Text>
      )}
    </View>
  );

  // ─── Sidebar (status tree) modal ───────────────────────────────────────────
  const renderTreeRow = (
    id: string,
    label: string,
    count: number,
    depth: number,
    hasChildren: boolean,
    accentHex?: string,
    hollow?: boolean,
    hideCircle?: boolean
  ) => {
    const isSelected = selectedLocation === id;
    const isExpanded = expandedLocations.has(id);
    return (
      <View style={[styles.treeRow, { paddingLeft: 12 + depth * 16 }, isSelected && { backgroundColor: `${primaryColor}22` }]}>
        <TouchableOpacity style={styles.treeRowMain} onPress={() => selectLocation(id)} activeOpacity={0.7}>
          {accentHex && !hideCircle && (
            <Circle size={11} color={accentHex} fill={hollow ? 'transparent' : accentHex} strokeWidth={hollow ? 3 : 1} style={{ marginRight: 6 }} />
          )}
          <Text style={[styles.treeLabel, { color: isSelected ? primaryColor : '#374151', fontWeight: depth === 0 ? '700' : '500' }]} numberOfLines={1}>
            {label}
          </Text>
        </TouchableOpacity>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{count}</Text>
        </View>
        {hasChildren ? (
          <TouchableOpacity onPress={() => toggleExpand(id)} style={styles.chevBtn}>
            {isExpanded ? <ChevronDown size={16} color="#6b7280" /> : <ChevronRight size={16} color="#6b7280" />}
          </TouchableOpacity>
        ) : (
          <View style={styles.chevBtn} />
        )}
      </View>
    );
  };

  const renderSidebar = () => (
    <Modal visible={sidebarVisible} animationType="slide" transparent onRequestClose={() => setSidebarVisible(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.sidebarContainer}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>Customers</Text>
            <TouchableOpacity onPress={() => setSidebarVisible(false)}>
              <X size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {/* All */}
            <View style={[styles.treeRow, selectedLocation === 'all' && { backgroundColor: `${primaryColor}22` }]}>
              <TouchableOpacity style={styles.treeRowMain} onPress={() => selectLocation('all')} activeOpacity={0.7}>
                <Text style={[styles.treeLabel, { color: selectedLocation === 'all' ? primaryColor : '#374151', fontWeight: '700' }]}>
                  All Customers
                </Text>
              </TouchableOpacity>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{statusTree.total}</Text>
              </View>
              <View style={styles.chevBtn} />
            </View>

            {statusTree.items.map((status) => {
              const style = getStatusInfo({ status: status.name, onlineStatus: status.name });
              const isExpanded = expandedLocations.has(status.id);
              return (
                <View key={status.id}>
                  {renderTreeRow(status.id, status.name.toUpperCase(), status.count, 0, true, style.hex, style.hollow, style.hideCircle)}
                  {isExpanded && (status.sessionStatuses ? (
                    status.sessionStatuses.map((session) => {
                      const isSessionExpanded = expandedLocations.has(session.id);
                      return (
                        <View key={session.id}>
                          {renderTreeRow(session.id, session.name, session.count, 1, true)}
                          {isSessionExpanded && session.bStatuses.map((billing) => {
                            const isBillingExpanded = expandedLocations.has(billing.id);
                            return (
                              <View key={billing.id}>
                                {renderTreeRow(billing.id, billing.name, billing.count, 2, billing.barangays.length > 0)}
                                {isBillingExpanded && billing.barangays.map((brgy) =>
                                  <View key={brgy.id}>{renderTreeRow(brgy.id, brgy.name, brgy.count, 3, false)}</View>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      );
                    })
                  ) : (
                    status.bStatuses.map((billing) => {
                      const isBillingExpanded = expandedLocations.has(billing.id);
                      return (
                        <View key={billing.id}>
                          {renderTreeRow(billing.id, billing.name, billing.count, 1, billing.barangays.length > 0)}
                          {isBillingExpanded && billing.barangays.map((brgy) =>
                            <View key={brgy.id}>{renderTreeRow(brgy.id, brgy.name, brgy.count, 2, false)}</View>
                          )}
                        </View>
                      );
                    })
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderDetailsModal = () => (
    <Modal visible={detailsModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCloseDetails}>
      {isLoadingDetails ? (
        <View style={styles.detailsLoading}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.detailsLoadingText}>Loading details...</Text>
        </View>
      ) : selectedCustomer ? (
        <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
          <View style={styles.detailNav}>
            <TouchableOpacity
              onPress={handlePreviousRecord}
              disabled={currentRecordIndex <= 0}
              style={[styles.navBtn, { opacity: currentRecordIndex <= 0 ? 0.4 : 1 }]}
            >
              <ChevronLeft size={18} color={primaryColor} />
              <Text style={[styles.navBtnText, { color: primaryColor }]}>Prev</Text>
            </TouchableOpacity>
            <Text style={styles.navCounter}>
              {currentRecordIndex >= 0 ? `${currentRecordIndex + 1} / ${filteredBillingRecords.length}` : ''}
            </Text>
            <TouchableOpacity
              onPress={handleNextRecord}
              disabled={currentRecordIndex === -1 || currentRecordIndex >= filteredBillingRecords.length - 1}
              style={[styles.navBtn, { opacity: (currentRecordIndex === -1 || currentRecordIndex >= filteredBillingRecords.length - 1) ? 0.4 : 1 }]}
            >
              <Text style={[styles.navBtnText, { color: primaryColor }]}>Next</Text>
              <ChevronRight size={18} color={primaryColor} />
            </TouchableOpacity>
          </View>
          <BillingDetails
            billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
            onlineStatusRecords={[]}
            onClose={handleCloseDetails}
          />
        </View>
      ) : (
        <View style={styles.detailsLoading}>
          <Text style={{ color: '#6b7280' }}>No data available.</Text>
          <TouchableOpacity onPress={handleCloseDetails} style={styles.closeBtn}>
            <Text style={{ color: primaryColor, fontWeight: '600' }}>Close</Text>
          </TouchableOpacity>
        </View>
      )}
    </Modal>
  );

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: isTablet ? 16 : 60 }]}>
        <Text style={styles.headerTitle}>Customers</Text>
        <Text style={styles.headerSubtitle}>
          {filteredBillingRecords.length} record{filteredBillingRecords.length !== 1 ? 's' : ''}
          {!isTableLoading && totalCount > billingRecords.length ? ` (loading ${billingRecords.length}/${totalCount})` : ''}
        </Text>
      </View>

      {/* Search + Controls */}
      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search customer records..."
          />
        </View>
        <TouchableOpacity onPress={() => setSidebarVisible(true)} style={[styles.iconBtn, { borderColor: primaryColor }]}>
          <SlidersHorizontal size={18} color={primaryColor} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleExport}
          disabled={filteredBillingRecords.length === 0}
          style={[styles.iconBtn, { borderColor: primaryColor, opacity: filteredBillingRecords.length === 0 ? 0.5 : 1 }]}
        >
          <Download size={18} color={primaryColor} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleRefresh}
          disabled={isTableLoading || refreshing}
          style={[styles.iconBtn, { borderColor: primaryColor, opacity: (isTableLoading || refreshing) ? 0.5 : 1 }]}
        >
          <RefreshCw size={18} color={primaryColor} />
        </TouchableOpacity>
      </View>

      {/* Active location chip */}
      {selectedLocation !== 'all' && (
        <View style={styles.chipRow}>
          <View style={[styles.chip, { backgroundColor: `${primaryColor}14`, borderColor: `${primaryColor}44` }]}>
            <Text style={[styles.chipText, { color: primaryColor }]} numberOfLines={1}>{selectedLocationLabel}</Text>
            <TouchableOpacity onPress={() => setSelectedLocation('all')}>
              <X size={13} color={primaryColor} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* List */}
      <FlatList
        data={filteredBillingRecords}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        ListEmptyComponent={renderEmpty}
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        windowSize={10}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[primaryColor]} tintColor={primaryColor} />
        }
        contentContainerStyle={filteredBillingRecords.length === 0 ? styles.flatListEmpty : styles.flatListContent}
      />

      {renderSidebar()}
      {renderDetailsModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  headerSubtitle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 8,
  },
  iconBtn: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 9,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, backgroundColor: '#f9fafb' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '80%',
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  flatListContent: { padding: 12, gap: 10 },
  flatListEmpty: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  accountNo: { fontSize: 12, color: '#dc2626', fontWeight: '600', flex: 1, marginRight: 8 },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  onlineLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  customerName: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 2 },
  cardAddress: { fontSize: 12, color: '#6b7280', marginTop: 1 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  cardBalance: { fontSize: 13, color: '#374151' },
  billingStatusBadge: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  cardMuted: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 12 },
  retryBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8, marginTop: 8 },
  // Sidebar modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sidebarContainer: { backgroundColor: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%', paddingBottom: 24 },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  sidebarTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  treeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  treeRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  treeLabel: { fontSize: 13, flexShrink: 1 },
  countBadge: { backgroundColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 7, paddingVertical: 2, marginHorizontal: 6 },
  countBadgeText: { fontSize: 10, fontWeight: '700', color: '#374151' },
  chevBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  // Details modal
  detailsLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb', gap: 12 },
  detailsLoadingText: { fontSize: 14, color: '#6b7280', marginTop: 8 },
  closeBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f3f4f6' },
  detailNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  navBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 },
  navBtnText: { fontSize: 13, fontWeight: '600' },
  navCounter: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
});

export default Customer;
