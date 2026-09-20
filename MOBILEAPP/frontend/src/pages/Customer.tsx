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
  AppState,
  AppStateStatus,
  Animated,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Circle,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Download,
  Filter,
  Menu,
  LogOut,
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
import CustomerFunnelFilter, { allColumns as filterColumns, FilterValues } from '../filter/CustomerFunnelFilter';
import pusher from '../services/pusherService';
import apiClient from '../config/api';

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
    status: customerData.billingAccount?.billingStatusName || (customerData.billingAccount?.billingStatusId === 1 ? 'Active' : 'Disconnected'),
    balance: customerData.billingAccount?.accountBalance || 0,
    onlineStatus: customerData.onlineSessionStatus || 'Empty',
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
    referredByAgentId: customerData.referredByAgentId ?? null,
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
  const {
    billingRecords,
    totalCount,
    isLoading: isTableLoading,
    isBackgroundLoading,
    error: contextError,
    fetchBillingRecords,
    refreshBillingRecords,
    refreshLatestData,
  } = useBillingStore();
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

  const [activeFilters, setActiveFilters] = useState<FilterValues>({});
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);
  const [hasNewData, setHasNewData] = useState<boolean>(false);
  const [viewers, setViewers] = useState<Record<string, string[]>>({});
  const [showSessionExpired, setShowSessionExpired] = useState<boolean>(false);
  const [customerRefreshKey, setCustomerRefreshKey] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);
  const listRef = useRef<FlatList<BillingRecord>>(null);
  const knownCountRef = useRef<number>(0);
  const hasCountBaselineRef = useRef<boolean>(false);
  const [sidebarRendered, setSidebarRendered] = useState(false);
  const sidebarSlideX = useRef(new Animated.Value(-width)).current;
  const sidebarBackdrop = useRef(new Animated.Value(0)).current;

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

  // Slide the location drawer in from the left, out to the left.
  useEffect(() => {
    if (sidebarVisible) {
      setSidebarRendered(true);
      Animated.parallel([
        Animated.timing(sidebarSlideX, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(sidebarBackdrop, { toValue: 0.4, duration: 260, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(sidebarSlideX, { toValue: -width, duration: 220, useNativeDriver: true }),
        Animated.timing(sidebarBackdrop, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setSidebarRendered(false);
      });
    }
  }, [sidebarVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore saved funnel filters
  useEffect(() => {
    AsyncStorage.getItem('customerFunnelFilters')
      .then((saved) => {
        if (!saved) return;
        try { setActiveFilters(JSON.parse(saved)); } catch { /* ignore */ }
      })
      .catch(() => { });
  }, []);

  // Real-time. `pusherService` is an RN-safe stub today, so these callbacks never fire
  // and the polling below is what keeps the list fresh; the wiring matches the web
  // screen so restoring pusher-js turns real-time back on with no change here.
  useEffect(() => {
    const handleDataChange = async () => {
      setHasNewData(true);
      try {
        await refreshLatestData();
        const accountNo = selectedCustomerRef.current?.billingAccount?.accountNo;
        if (accountNo) {
          const updatedCustomer = await getCustomerDetail(accountNo);
          if (updatedCustomer) setSelectedCustomer(updatedCustomer);
          setCustomerRefreshKey((prev) => prev + 1);
        }
      } catch (err) {
        console.error('[Customer] Failed to fetch latest data:', err);
      }
    };

    const appChannel = pusher.subscribe('applications');
    const jobChannel = pusher.subscribe('job-orders');
    const customerChannel = pusher.subscribe('customers');

    appChannel.bind('new-application', handleDataChange);
    jobChannel.bind('job-order-done', handleDataChange);
    customerChannel.bind('customer-updated', handleDataChange);

    return () => {
      appChannel.unbind('new-application', handleDataChange);
      jobChannel.unbind('job-order-done', handleDataChange);
      customerChannel.unbind('customer-updated', handleDataChange);
      pusher.unsubscribe('applications');
      pusher.unsubscribe('job-orders');
      pusher.unsubscribe('customers');
    };
  }, [refreshLatestData]);

  // Presence channel — who is viewing which customer.
  useEffect(() => {
    const presenceChannel = pusher.subscribe('presence-customers-presence');

    presenceChannel.bind('viewing-update', (data: { customer_id: string; username: string; action: string }) => {
      setViewers((prev) => {
        const current = prev[data.customer_id] || [];
        if (data.action === 'started_viewing') {
          if (!current.includes(data.username)) {
            return { ...prev, [data.customer_id]: [...current, data.username] };
          }
        } else if (data.action === 'stopped_viewing') {
          return { ...prev, [data.customer_id]: current.filter((n) => n !== data.username) };
        }
        return prev;
      });
    });

    presenceChannel.bind('pusher:member_removed', (member: any) => {
      const identifier = member?.info?.username || member?.info?.email;
      if (!identifier) return;
      setViewers((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((id) => {
          next[id] = (next[id] || []).filter((n) => n !== identifier);
        });
        return next;
      });
    });

    return () => {
      presenceChannel.unbind();
      pusher.unsubscribe('presence-customers-presence');
    };
  }, []);

  // Foreground polling — the RN stand-in for the web screen's Soketi push. Paused while
  // the app is backgrounded so a pocketed phone is not polling over cellular.
  useEffect(() => {
    const POLLING_INTERVAL = 30 * 1000;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        refreshLatestData().catch((err) => console.error('[Customer] Polling failed:', err));
      }, POLLING_INTERVAL);
    };
    const stop = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        refreshLatestData().catch(() => { });
        start();
      } else {
        stop();
      }
    });

    return () => { stop(); sub.remove(); };
  }, [refreshLatestData]);

  // Idle auto-refresh — a full sweep every 15 minutes of no interaction.
  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshLatestData().catch((err) => console.error('[Customer] Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [refreshLatestData]);

  // Flag newly-arrived records so the refresh button can show the "new data" dot.
  useEffect(() => {
    if (!hasCountBaselineRef.current) {
      hasCountBaselineRef.current = true;
      knownCountRef.current = billingRecords.length;
      return;
    }
    if (billingRecords.length > knownCountRef.current) setHasNewData(true);
    knownCountRef.current = billingRecords.length;
  }, [billingRecords.length]);

  // Session expiry — the store surfaces the auth failure through `error`.
  useEffect(() => {
    if (contextError && (contextError.includes('401') || contextError.toLowerCase().includes('unauthorized'))) {
      setShowSessionExpired(true);
    }
  }, [contextError]);

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

  const getStatusInfo = (record: any) => {
    const accessStatus = record.status || '';
    const lowerStatus = accessStatus.toLowerCase();
    const lowerOnlineStatus = (record.onlineStatus || '').toLowerCase();

    let bucket = 'offline';
    if (lowerStatus === 'restricted' || lowerOnlineStatus === 'restricted') bucket = 'restricted';
    else if (lowerStatus === 'not found' || lowerOnlineStatus === 'not found') bucket = 'not found';
    else if (lowerStatus === 'disconnected' || lowerOnlineStatus === 'disconnected') bucket = 'disconnected';
    else if (lowerStatus === 'inactive') bucket = 'offline';
    else if (['online', 'active', 'connected'].includes(lowerOnlineStatus)) bucket = 'online';
    else if (lowerOnlineStatus && lowerOnlineStatus !== 'offline' && lowerOnlineStatus !== 'empty') bucket = lowerOnlineStatus;

    const lower = bucket.toLowerCase();
    if (lower === 'online') return { label: 'ONLINE', hex: '#22c55e', hollow: false, hideCircle: false };
    if (lower === 'offline') return { label: 'OFFLINE', hex: '#facc15', hollow: true, hideCircle: false };
    if (lower === 'not found') return { label: 'NOT FOUND', hex: '#dc2626', hollow: false, hideCircle: false };
    if (lower === 'disconnected') return { label: 'DISCONNECTED', hex: '#9ca3af', hollow: false, hideCircle: false };
    if (lower === 'restricted') return { label: 'RESTRICTED', hex: '#f97316', hollow: false, hideCircle: false };
    if (lower === 'empty') return { label: 'EMPTY', hex: '#94a3b8', hollow: true, hideCircle: true };
    return { label: bucket.toUpperCase(), hex: '#3b82f6', hollow: false, hideCircle: false };
  };

  /** Field accessor used by the funnel filters — mirrors the web `getVal`. */
  const getVal = (item: BillingRecord, key: string): any => {
    switch (key) {
      case 'id':
      case 'accountNo': return item.id || item.applicationId;
      case 'customerName': return item.customerName;
      case 'firstName': return item.firstName;
      case 'middleInitial': return item.middleInitial;
      case 'lastName': return item.lastName;
      case 'address': return item.address;
      case 'contactNumber': return item.contactNumber;
      case 'secondContactNumber': return item.secondContactNumber;
      case 'emailAddress': return item.emailAddress;
      case 'plan': return item.plan;
      case 'balance':
      case 'accountBalance': return item.balance;
      case 'status': return item.status;
      case 'onlineStatus': return getStatusInfo(item).label.toLowerCase();
      case 'billingStatus': return item.billingStatus || 'Active';
      case 'dateInstalled': return item.dateInstalled;
      case 'username': return item.username;
      case 'connectionType': return item.connectionType;
      case 'routerModel': return item.routerModel;
      case 'sessionGroup': return item.sessionGroup;
      default: return (item as any)[key];
    }
  };

  const applyFunnelFilters = (records: BillingRecord[], filters: FilterValues): BillingRecord[] => {
    if (!filters || Object.keys(filters).length === 0) return records;

    return records.filter((record) =>
      Object.entries(filters).every(([key, filter]: [string, any]) => {
        const recordValue = getVal(record, key);

        if (filter.type === 'checklist') {
          if (!filter.value || !Array.isArray(filter.value) || filter.value.length === 0) return true;
          const valStr = String(recordValue || '').toLowerCase();
          // Exact match, so "Ultra" cannot match "Ultra-Plus 2099".
          return filter.value.some((v: string) => valStr === String(v).toLowerCase());
        }

        if (filter.type === 'text') {
          if (!filter.value) return true;
          const value = String(recordValue || '').toLowerCase();
          if (key === 'billing_status_id') return value === String(filter.value).toLowerCase();
          return value.includes(String(filter.value).toLowerCase());
        }

        if (filter.type === 'number') {
          const numValue = Number(recordValue);
          if (isNaN(numValue)) return false;
          if (filter.from !== undefined && filter.from !== '' && numValue < Number(filter.from)) return false;
          if (filter.to !== undefined && filter.to !== '' && numValue > Number(filter.to)) return false;
          return true;
        }

        if (filter.type === 'date') {
          if (!recordValue) return false;
          const dateValue = new Date(recordValue).getTime();
          if (isNaN(dateValue)) return false;
          if (filter.from && dateValue < new Date(filter.from).getTime()) return false;
          if (filter.to && dateValue > new Date(filter.to).getTime()) return false;
          return true;
        }

        return true;
      })
    );
  };

  // 1. Global filtered set (org + search + funnel) — powers sidebar counts
  const globalFilteredRecords = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
    const searched = billingRecords.filter((record) => {
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

    return applyFunnelFilters(searched, activeFilters);
  }, [billingRecords, searchQuery, userOrgId, activeFilters]);

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

  // ─── Pagination ──────────────────────────────────────────────────────────────

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredBillingRecords.length / itemsPerPage)),
    [filteredBillingRecords.length, itemsPerPage]
  );

  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredBillingRecords.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredBillingRecords, currentPage, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  // Any change to the result set puts you back on page 1
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedLocation, activeFilters, itemsPerPage]);

  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [currentPage]);

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

  const broadcastViewing = (customerId: string, action: 'started_viewing' | 'stopped_viewing') =>
    apiClient
      .post('/customers/broadcast-viewing', { customer_id: customerId, action })
      .catch((err) => console.error(`[Viewing] Failed to broadcast ${action}:`, err));

  const handleRecordClick = async (record: BillingRecord) => {
    const previous = selectedCustomerRef.current?.billingAccount?.accountNo;
    if (previous && previous !== record.applicationId) {
      broadcastViewing(previous, 'stopped_viewing');
    }
    try {
      setIsLoadingDetails(true);
      setDetailsModalVisible(true);
      const customerData = await getCustomerDetail(record.applicationId);
      setSelectedCustomer(customerData);
      broadcastViewing(record.applicationId, 'started_viewing');
    } catch (err) {
      console.error('Failed to fetch customer details:', err);
      setLocalError('Failed to load customer details');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleCloseDetails = () => {
    const previous = selectedCustomerRef.current?.billingAccount?.accountNo;
    if (previous) broadcastViewing(previous, 'stopped_viewing');
    setDetailsModalVisible(false);
    setSelectedCustomer(null);
  };

  // Pull-to-refresh pulls only what changed since the last sync — re-downloading every
  // record on each pull is what made this feel like a cold start.
  const handlePullRefresh = async () => {
    setRefreshing(true);
    setHasNewData(false);
    try {
      await refreshLatestData();
    } catch (err) {
      console.error('Failed to refresh latest billing records:', err);
    } finally {
      setRefreshing(false);
    }
  };

  // The toolbar button is the deliberate full reload.
  const handleRefresh = async () => {
    setRefreshing(true);
    setHasNewData(false);
    try {
      await refreshBillingRecords();
    } catch (err) {
      console.error('Failed to refresh billing records:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleApplyFilters = async (filters: FilterValues) => {
    setActiveFilters(filters);
    try { await AsyncStorage.setItem('customerFunnelFilters', JSON.stringify(filters)); } catch { /* ignore */ }
  };

  const removeFilter = async (key: string) => {
    const next = { ...activeFilters };
    delete next[key];
    setActiveFilters(next);
    try { await AsyncStorage.setItem('customerFunnelFilters', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const handleClearAllFilters = async () => {
    setActiveFilters({});
    try { await AsyncStorage.removeItem('customerFunnelFilters'); } catch { /* ignore */ }
  };

  const activeFilterKeys = Object.keys(activeFilters);

  const getFilterDisplayValue = (filter: any): string => {
    if (filter.type === 'checklist') {
      return Array.isArray(filter.value) ? filter.value.join(', ') : String(filter.value ?? '');
    }
    if (filter.type === 'text' || filter.type === 'boolean') return String(filter.value ?? '');
    if (filter.type === 'number' || filter.type === 'date') {
      if (filter.from && filter.to) return `${filter.from} - ${filter.to}`;
      if (filter.from) return `> ${filter.from}`;
      if (filter.to) return `< ${filter.to}`;
    }
    return '';
  };

  const handleRelogin = () => {
    setShowSessionExpired(false);
    AsyncStorage.removeItem('authData').catch(() => { });
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
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: isSelected ? '#f3f4f6' : 'transparent',
        }}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{ fontSize: 14, fontWeight: '500', color: '#111827', marginBottom: 4, textTransform: 'capitalize' }}
              numberOfLines={1}
            >
              {(item.customerName || '-').toLowerCase()}
            </Text>
            {(viewers[item.applicationId] || []).length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                {(viewers[item.applicationId] || []).map((username) => (
                  <View
                    key={username}
                    style={{ backgroundColor: primaryColor, borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff', textTransform: 'lowercase' }}>
                      {username} is viewing
                    </Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={{ fontSize: 12, color: '#4b5563' }} numberOfLines={2}>
              {[item.applicationId, item.plan, item.address].filter(Boolean).join(' | ') || 'Not specified'}
            </Text>
          </View>
          <View style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 16, flexShrink: 0 }}>
            <Text style={{ fontWeight: 'bold', textTransform: 'uppercase', color: statusInfo.hex }}>
              {statusInfo.label}
            </Text>
            <Text style={{ fontSize: 12, color: '#4b5563' }}>₱{item.balance?.toFixed(2) ?? '0.00'}</Text>
            <Text style={{ fontSize: 11, color: '#9ca3af' }}>{item.billingStatus || 'Active'}</Text>
          </View>
        </View>
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
    <Modal visible={sidebarRendered} animationType="none" transparent onRequestClose={() => setSidebarVisible(false)}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: sidebarBackdrop }}
        />
        <Animated.View style={[styles.sidebarContainer, { transform: [{ translateX: sidebarSlideX }] }]}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>Customers</Text>
            <TouchableOpacity onPress={() => setSidebarVisible(false)}>
              <X size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }}>
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

          <View style={styles.sidebarFooter}>
            <TouchableOpacity
              onPress={() => setSidebarVisible(false)}
              style={[styles.viewRecordsBtn, { backgroundColor: primaryColor }]}
            >
              <Text style={styles.viewRecordsText}>View Records</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSidebarVisible(false)} />
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
          <BillingDetails
            billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
            onlineStatusRecords={[]}
            onClose={handleCloseDetails}
            onRefresh={refreshLatestData}
            refreshKey={customerRefreshKey}
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
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: isTablet ? 16 : 60 }]}>
        <TouchableOpacity
          onPress={() => setSidebarVisible(true)}
          style={[styles.iconBtn, {
            borderColor: selectedLocation !== 'all' ? primaryColor : '#e5e7eb',
            backgroundColor: selectedLocation !== 'all' ? `${primaryColor}12` : '#fff',
          }]}
        >
          <Menu size={18} color={selectedLocation !== 'all' ? primaryColor : '#374151'} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search customer records..."
          />
        </View>

        <TouchableOpacity
          onPress={() => setIsFunnelFilterOpen(true)}
          style={[styles.iconBtn, { borderColor: activeFilterKeys.length > 0 ? '#ef4444' : '#e5e7eb' }]}
        >
          <Filter size={18} color={activeFilterKeys.length > 0 ? '#ef4444' : '#374151'} />
          {activeFilterKeys.length > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterKeys.length}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleExport}
          disabled={filteredBillingRecords.length === 0}
          style={[styles.iconBtn, { borderColor: primaryColor, opacity: filteredBillingRecords.length === 0 ? 0.4 : 1 }]}
        >
          <Download size={18} color={primaryColor} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleRefresh}
          disabled={isTableLoading || refreshing || isBackgroundLoading}
          style={[styles.iconBtn, {
            borderColor: primaryColor,
            opacity: (isTableLoading || refreshing || isBackgroundLoading) ? 0.4 : 1,
          }]}
        >
          {refreshing || isBackgroundLoading || (isTableLoading && billingRecords.length === 0)
            ? <ActivityIndicator size="small" color={primaryColor} />
            : <RefreshCw size={18} color={primaryColor} />}
          {hasNewData && <View style={styles.newDataDot} />}
        </TouchableOpacity>
      </View>

      {/* Load progress */}
      {!isTableLoading && totalCount > billingRecords.length && (
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>Loading records… ({billingRecords.length}/{totalCount})</Text>
        </View>
      )}

      {/* Active funnel filter chips */}
      {activeFilterKeys.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterChipsRow}
          contentContainerStyle={styles.filterChipsContent}
        >
          <Text style={styles.filterChipsLabel}>FILTERS:</Text>
          {activeFilterKeys.map((key) => {
            const filter = activeFilters[key] as any;
            const label = filterColumns.find((c) => c.key === key)?.label || key;
            return (
              <View
                key={key}
                style={[styles.chip, { backgroundColor: `${primaryColor}14`, borderColor: `${primaryColor}44` }]}
              >
                <Text style={[styles.chipText, { color: primaryColor }]} numberOfLines={1}>
                  {label}: {getFilterDisplayValue(filter)}
                </Text>
                <TouchableOpacity onPress={() => removeFilter(key)}>
                  <X size={13} color={primaryColor} />
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity onPress={handleClearAllFilters} style={{ paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: primaryColor, textDecorationLine: 'underline' }}>
              Clear all
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

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
        ref={listRef}
        data={paginatedRecords}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        ListEmptyComponent={renderEmpty}
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        windowSize={10}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handlePullRefresh} colors={[primaryColor]} tintColor={primaryColor} />
        }
        contentContainerStyle={paginatedRecords.length === 0 ? styles.flatListEmpty : styles.flatListContent}
      />

      {/* Pagination */}
      {filteredBillingRecords.length > 0 && (
        <View style={[styles.pagination, { paddingBottom: isTablet ? 12 : 110 }]}>
          <View style={styles.paginationTop}>
            <View style={styles.perPageWrap}>
              <Text style={styles.paginationText}>Show</Text>
              <View style={styles.pickerBox}>
                <Picker
                  selectedValue={itemsPerPage}
                  onValueChange={(v) => setItemsPerPage(Number(v))}
                  style={{ color: '#111827' }}
                  dropdownIconColor="#6b7280"
                >
                  {[10, 25, 50, 100].map((v) => (
                    <Picker.Item key={v} label={String(v)} value={v} />
                  ))}
                </Picker>
              </View>
              <Text style={styles.paginationText}>entries</Text>
            </View>
            <Text style={styles.paginationText}>
              Showing <Text style={{ fontWeight: '600' }}>{(currentPage - 1) * itemsPerPage + 1}</Text> to{' '}
              <Text style={{ fontWeight: '600' }}>{Math.min(currentPage * itemsPerPage, filteredBillingRecords.length)}</Text> of{' '}
              <Text style={{ fontWeight: '600' }}>{filteredBillingRecords.length}</Text> results
            </Text>
          </View>

          <View style={styles.paginationNav}>
            {([
              { label: '«', page: 1, disabled: currentPage === 1 },
              { label: '‹', page: currentPage - 1, disabled: currentPage === 1 },
            ] as const).map((btn) => (
              <TouchableOpacity
                key={btn.label}
                onPress={() => handlePageChange(btn.page)}
                disabled={btn.disabled}
                style={[styles.pageBtn, btn.disabled && styles.pageBtnDisabled]}
              >
                <Text style={[styles.pageBtnText, btn.disabled && { color: '#9ca3af' }]}>{btn.label}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.pageIndicator}>Page {currentPage} of {totalPages}</Text>
            {([
              { label: '›', page: currentPage + 1, disabled: currentPage === totalPages },
              { label: '»', page: totalPages, disabled: currentPage === totalPages },
            ] as const).map((btn) => (
              <TouchableOpacity
                key={btn.label}
                onPress={() => handlePageChange(btn.page)}
                disabled={btn.disabled}
                style={[styles.pageBtn, btn.disabled && styles.pageBtnDisabled]}
              >
                <Text style={[styles.pageBtnText, btn.disabled && { color: '#9ca3af' }]}>{btn.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {renderSidebar()}
      {renderDetailsModal()}

      <CustomerFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          handleApplyFilters(filters);
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={activeFilters}
      />

      {/* Session Expired */}
      <Modal visible={showSessionExpired} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.sessionOverlay}>
          <View style={styles.sessionCard}>
            <LogOut size={44} color="#ef4444" />
            <Text style={styles.sessionTitle}>Session Expired</Text>
            <Text style={styles.sessionMessage}>Please re-login to continue using the application.</Text>
            <TouchableOpacity onPress={handleRelogin} style={[styles.sessionBtn, { backgroundColor: primaryColor }]}>
              <Text style={styles.sessionBtnText}>Re-login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f9fafb' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 8,
  },
  progressRow: { paddingHorizontal: 16, paddingVertical: 4, backgroundColor: '#ffffff' },
  progressText: { fontSize: 10, color: '#9ca3af' },
  iconBtn: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 8,
    padding: 9,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { fontSize: 9, color: '#fff', fontWeight: '700' },
  newDataDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#fff',
  },
  filterChipsRow: { backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  filterChipsContent: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  filterChipsLabel: { fontSize: 10, fontWeight: '700', color: '#9ca3af', letterSpacing: 1 },
  pagination: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  paginationTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  perPageWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pickerBox: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', width: 92, height: 36, justifyContent: 'center' },
  paginationText: { fontSize: 12, color: '#4b5563' },
  paginationNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  pageBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  pageBtnDisabled: { backgroundColor: '#f3f4f6', borderWidth: 0 },
  pageBtnText: { fontSize: 18, fontWeight: 'bold', color: '#374151' },
  pageIndicator: { paddingHorizontal: 8, fontSize: 14, color: '#111827' },
  sessionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sessionCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360, alignItems: 'center', gap: 12 },
  sessionTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  sessionMessage: { fontSize: 13, color: '#4b5563', textAlign: 'center' },
  sessionBtn: { borderRadius: 8, paddingVertical: 12, width: '100%', alignItems: 'center', marginTop: 4 },
  sessionBtnText: { color: '#fff', fontWeight: '700' },
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
  // Rows carry their own padding and dividers, same as ApplicationManagement — any
  // padding/gap here would double up as spacing around each card.
  flatListContent: { flexGrow: 1 },
  flatListEmpty: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 12 },
  retryBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8, marginTop: 8 },
  // Sidebar modal
  sidebarContainer: { width: '85%', maxWidth: 520, height: '100%', backgroundColor: '#ffffff' },
  sidebarFooter: { padding: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  viewRecordsBtn: { borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
  viewRecordsText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
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
});

export default Customer;
