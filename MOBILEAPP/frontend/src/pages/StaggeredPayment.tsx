import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Alert,
} from 'react-native';
import {
  RefreshCw,
  Download,
  X,
  Globe,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalSearch from './globalfunctions/GlobalSearch';
import StaggeredListDetails from '../components/StaggeredListDetails';
import StaggeredInstallationFormModal from '../modals/StaggeredInstallationFormModal';
import { useStaggeredPaymentContext, StaggeredInstallation } from '../contexts/StaggeredPaymentContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import apiClient from '../config/api';
import { exportToCSV } from '../utils/exportUtils';
import { usePermissions } from '../hooks/usePermissions';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

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

const formatCurrency = (amount: number | string) => {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `₱${(isNaN(n) ? 0 : n).toFixed(2)}`;
};

const formatDate = (dateStr?: string, includeTime = false): string => {
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

const statusColor = (s: string) => {
  switch ((s || '').toLowerCase()) {
    case 'active': return '#22c55e';
    case 'pending': return '#eab308';
    case 'completed': return '#3b82f6';
    default: return '#9ca3af';
  }
};

const ITEMS_PER_PAGE = 25;

const StaggeredPayment: React.FC = () => {
  const isDarkMode = false;
  const primary = '#7c3aed'; // will be overridden by palette

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [staggeredDateFrom, setStaggeredDateFrom] = useState('');
  const [staggeredDateTo, setStaggeredDateTo] = useState('');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | null>('staggered_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedStaggered, setSelectedStaggered] = useState<StaggeredInstallation | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isStaggeredFormModalOpen, setIsStaggeredFormModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [orgId, setOrgId] = useState<number | null>(null);

  const selectedStaggeredRef = useRef<StaggeredInstallation | null>(null);
  const { staggeredRecords, isLoading, error, silentRefresh, isFullyLoaded } = useStaggeredPaymentContext();

  const primaryColor = colorPalette?.primary || '#7c3aed';

  // Load auth data
  useEffect(() => {
    AsyncStorage.getItem('authData').then(raw => {
      if (!raw) return;
      try {
        const userData = JSON.parse(raw);
        setUserRole(userData.role || '');
        setRoleId(userData.role_id || null);
        setOrgId(userData.organization_id || null);
        let perms: string[] = [];
        if (userData.permissions) {
          if (Array.isArray(userData.permissions)) {
            perms = userData.permissions;
          } else if (typeof userData.permissions === 'string') {
            try {
              const parsed = JSON.parse(userData.permissions);
              perms = Array.isArray(parsed) ? parsed : [];
            } catch {
              perms = userData.permissions.split(',').map((p: string) => p.trim()).filter(Boolean);
            }
          }
        }
        setUserPermissions(perms);
      } catch (err) {
        console.error('Error parsing auth data in StaggeredPayment:', err);
      }
    });
  }, []);

  // Color palette
  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  // Initial + interval refresh (15 min)
  useEffect(() => {
    silentRefresh();
    const interval = setInterval(() => {
      silentRefresh().catch(err => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [silentRefresh]);

  // Track selected ref
  useEffect(() => {
    selectedStaggeredRef.current = selectedStaggered;
  }, [selectedStaggered]);

  // Auto-update selectedStaggered when records refresh
  useEffect(() => {
    if (selectedStaggeredRef.current && staggeredRecords.length > 0) {
      const updatedMatch = staggeredRecords.find(r => r.id === selectedStaggeredRef.current?.id);
      if (updatedMatch && JSON.stringify(updatedMatch) !== JSON.stringify(selectedStaggeredRef.current)) {
        setSelectedStaggered(updatedMatch);
      }
    }
  }, [staggeredRecords]);

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDate, staggeredDateFrom, staggeredDateTo]);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
  const { can: hasPermission } = usePermissions();

  const globalFilteredRecords = useMemo(() => {
    let filtered = staggeredRecords;

    if (orgId) {
      filtered = filtered.filter(r => !(r as any).organization_id || (r as any).organization_id === orgId);
    }

    if (searchQuery) {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return Object.values(val).some(v => checkValue(v));
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };
      filtered = filtered.filter(r => checkValue(r));
    }

    if (staggeredDateFrom || staggeredDateTo) {
      filtered = filtered.filter(r => {
        if (!r.staggered_date) return false;
        const dateValue = new Date(r.staggered_date).getTime();
        if (isNaN(dateValue)) return false;
        if (staggeredDateFrom) {
          const from = new Date(staggeredDateFrom);
          from.setHours(0, 0, 0, 0);
          if (dateValue < from.getTime()) return false;
        }
        if (staggeredDateTo) {
          const to = new Date(staggeredDateTo);
          to.setHours(23, 59, 59, 999);
          if (dateValue > to.getTime()) return false;
        }
        return true;
      });
    }

    return filtered;
  }, [staggeredRecords, searchQuery, staggeredDateFrom, staggeredDateTo, orgId]);

  const dateItems = useMemo(() => {
    const dateCounts: Record<string, number> = {};
    const dates = new Map<string, string>();
    globalFilteredRecords.forEach(r => {
      if (r.staggered_date) {
        const formatted = new Date(r.staggered_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        dateCounts[formatted] = (dateCounts[formatted] || 0) + 1;
        dates.set(formatted, r.staggered_date);
      }
    });
    const sortedDates = Array.from(dates.entries())
      .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime())
      .map(([formatted]) => ({ date: formatted, count: dateCounts[formatted] }));
    return { all: globalFilteredRecords.length, dates: sortedDates };
  }, [globalFilteredRecords]);

  const filteredRecords = useMemo(() => {
    let filtered = globalFilteredRecords.filter(r => {
      if (selectedDate === 'All') return true;
      if (!r.staggered_date) return false;
      const formatted = new Date(r.staggered_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      return formatted === selectedDate;
    });

    if (sortColumn) {
      filtered = [...filtered].sort((a: any, b: any) => {
        let aVal: any;
        let bVal: any;
        if (sortColumn === 'full_name') {
          aVal = a.billing_account?.customer?.full_name || '';
          bVal = b.billing_account?.customer?.full_name || '';
        } else if (sortColumn === 'plan') {
          aVal = a.billing_account?.customer?.desired_plan || '';
          bVal = b.billing_account?.customer?.desired_plan || '';
        } else if (sortColumn === 'address') {
          aVal = a.billing_account?.customer?.address || '';
          bVal = b.billing_account?.customer?.address || '';
        } else {
          aVal = a[sortColumn] || '';
          bVal = b[sortColumn] || '';
        }
        if (['staggered_balance', 'monthly_payment', 'months_to_pay'].includes(sortColumn)) {
          aVal = Number(aVal) || 0;
          bVal = Number(bVal) || 0;
        } else if (['staggered_date', 'updated_at', 'modified_date'].includes(sortColumn)) {
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
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredRecords.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredRecords, currentPage]);

  const currentStaggeredIndex = useMemo(() => {
    if (!selectedStaggered) return -1;
    return filteredRecords.findIndex(r => r.id === selectedStaggered.id);
  }, [filteredRecords, selectedStaggered]);

  const handleRowClick = (record: StaggeredInstallation) => {
    setSelectedStaggered(record);
    setSelectedCustomer(null);
  };

  const handlePreviousRecord = () => {
    if (currentStaggeredIndex > 0) handleRowClick(filteredRecords[currentStaggeredIndex - 1]);
  };

  const handleNextRecord = () => {
    if (currentStaggeredIndex >= 0 && currentStaggeredIndex < filteredRecords.length - 1) {
      handleRowClick(filteredRecords[currentStaggeredIndex + 1]);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshingManual(true);
    try {
      await silentRefresh();
    } finally {
      setIsRefreshingManual(false);
    }
  };

  const onPullRefresh = async () => {
    setRefreshing(true);
    try {
      await silentRefresh();
    } finally {
      setRefreshing(false);
    }
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

  const handleExport = () => {
    if (!filteredRecords || filteredRecords.length === 0) return;
    const exportColumns = [
      { key: 'staggered_install_no', label: 'ID' },
      { key: 'account_no', label: 'Account No' },
      { key: 'full_name', label: 'Customer Name' },
      { key: 'staggered_date', label: 'Date' },
      { key: 'staggered_balance', label: 'Total Amount' },
      { key: 'monthly_payment', label: 'Monthly' },
      { key: 'months_to_pay', label: 'Months' },
      { key: 'status', label: 'Status' },
    ];
    const getExportValue = (record: StaggeredInstallation, key: string): any => {
      switch (key) {
        case 'account_no': return record.account_no || '-';
        case 'full_name': return record.billing_account?.customer?.full_name || '-';
        case 'staggered_date': return formatDate(record.staggered_date);
        case 'staggered_balance': return formatCurrency(record.staggered_balance);
        case 'monthly_payment': return formatCurrency(record.monthly_payment);
        case 'months_to_pay': return record.months_to_pay;
        case 'status': return record.status || '-';
        default: return (record as any)[key] || '-';
      }
    };
    exportToCSV('staggered_payment_export', exportColumns, filteredRecords, getExportValue);
  };

  const handleSaveStaggered = async (_formData: any) => {
    await handleRefresh();
    setIsStaggeredFormModalOpen(false);
  };

  // Card row renderer
  const renderItem = ({ item: record }: { item: StaggeredInstallation }) => {
    const isSelected = selectedStaggered?.id === record.id;
    return (
      <TouchableOpacity
        onPress={() => handleRowClick(record)}
        style={{
          backgroundColor: isSelected ? `${primaryColor}15` : '#ffffff',
          borderRadius: 8,
          padding: 14,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: isSelected ? primaryColor : '#e5e7eb',
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#f87171' }}>
              {record.account_no || '-'}
            </Text>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#111827', marginTop: 2 }}>
              {record.billing_account?.customer?.full_name || '-'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 12, color: statusColor(record.status), fontWeight: '600', textTransform: 'capitalize' }}>
              {record.status}
            </Text>
            <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              {formatDate(record.staggered_date)}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <View>
            <Text style={{ fontSize: 11, color: '#6b7280' }}>Balance</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#111827' }}>
              {formatCurrency(record.staggered_balance)}
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 11, color: '#6b7280' }}>Monthly</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#111827' }}>
              {formatCurrency(record.monthly_payment)}
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 11, color: '#6b7280' }}>Months Left</Text>
            <Text style={{
              fontSize: 13, fontWeight: 'bold',
              color: record.months_to_pay === 0 ? '#22c55e' : primaryColor,
            }}>
              {record.months_to_pay}
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 11, color: '#6b7280' }}>ID</Text>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>#{record.staggered_install_no}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View style={{
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        paddingTop: isTablet ? 16 : 60,
        paddingHorizontal: 16,
        paddingBottom: 12,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Staggered Payment</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {hasPermission('staggered-payment.add') && (
              <TouchableOpacity
                onPress={() => setIsStaggeredFormModalOpen(true)}
                style={{ backgroundColor: primaryColor, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>+</Text>
                <Text style={{ color: '#ffffff', fontSize: 13 }}>Add</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleExport}
              disabled={isLoading || filteredRecords.length === 0}
              style={{
                borderWidth: 1, borderColor: primaryColor, borderRadius: 8, padding: 7,
                backgroundColor: '#ffffff', opacity: (isLoading || filteredRecords.length === 0) ? 0.4 : 1,
              }}
            >
              <Download size={18} color={primaryColor} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleRefresh}
              disabled={isLoading || isRefreshingManual}
              style={{
                borderWidth: 1, borderColor: primaryColor, borderRadius: 8, padding: 7,
                backgroundColor: '#ffffff', opacity: (isLoading || isRefreshingManual) ? 0.4 : 1,
              }}
            >
              <RefreshCw size={18} color={primaryColor} />
            </TouchableOpacity>
          </View>
        </View>

        <GlobalSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search Staggered records..."
        />
      </View>

      {/* Date filter bar — horizontal scroll */}
      <View style={{ backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}>
          <TouchableOpacity
            onPress={() => setSelectedDate('All')}
            style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
              backgroundColor: selectedDate === 'All' ? primaryColor : '#f3f4f6',
              flexDirection: 'row', alignItems: 'center', gap: 6,
            }}
          >
            <Globe size={13} color={selectedDate === 'All' ? '#ffffff' : '#6b7280'} />
            <Text style={{ fontSize: 13, color: selectedDate === 'All' ? '#ffffff' : '#374151', fontWeight: '500' }}>
              All
            </Text>
            <View style={{
              backgroundColor: selectedDate === 'All' ? 'rgba(255,255,255,0.3)' : '#e5e7eb',
              borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1,
            }}>
              <Text style={{ fontSize: 11, color: selectedDate === 'All' ? '#ffffff' : '#6b7280' }}>
                {dateItems.all}
              </Text>
            </View>
          </TouchableOpacity>

          {dateItems.dates.map((item, index) => (
            <TouchableOpacity
              key={index}
              onPress={() => setSelectedDate(item.date)}
              style={{
                paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                backgroundColor: selectedDate === item.date ? primaryColor : '#f3f4f6',
                flexDirection: 'row', alignItems: 'center', gap: 6,
              }}
            >
              <Calendar size={13} color={selectedDate === item.date ? '#ffffff' : '#6b7280'} />
              <Text style={{ fontSize: 13, color: selectedDate === item.date ? '#ffffff' : '#374151', fontWeight: '500' }}>
                {item.date}
              </Text>
              <View style={{
                backgroundColor: selectedDate === item.date ? 'rgba(255,255,255,0.3)' : '#e5e7eb',
                borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1,
              }}>
                <Text style={{ fontSize: 11, color: selectedDate === item.date ? '#ffffff' : '#6b7280' }}>
                  {item.count}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Results count + sort info */}
      {!isLoading && filteredRecords.length > 0 && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''} found
          </Text>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            Page {currentPage} of {totalPages}
          </Text>
        </View>
      )}

      {/* Main list */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ marginTop: 12, color: '#6b7280', fontSize: 14 }}>
            Loading Staggered Payment records...
          </Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#ef4444', marginBottom: 16, textAlign: 'center' }}>{error}</Text>
          <TouchableOpacity
            onPress={handleRefresh}
            style={{ backgroundColor: '#e5e7eb', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6 }}
          >
            <Text style={{ color: '#374151' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : filteredRecords.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22, fontWeight: '600', color: '#9ca3af', marginBottom: 8 }}>
            Staggered Payment
          </Text>
          <Text style={{ fontSize: 16, color: '#9ca3af' }}>No payment records found</Text>
        </View>
      ) : (
        <FlatList
          data={paginatedRecords}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={primaryColor} />
          }
          ListFooterComponent={
            totalPages > 1 ? (
              <View style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 8, paddingVertical: 12, paddingHorizontal: 16,
              }}>
                <TouchableOpacity
                  onPress={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  style={{ padding: 6, opacity: currentPage === 1 ? 0.3 : 1 }}
                >
                  <ChevronsLeft size={18} color="#374151" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{ padding: 6, opacity: currentPage === 1 ? 0.3 : 1 }}
                >
                  <ChevronLeft size={18} color="#374151" />
                </TouchableOpacity>
                <Text style={{ fontSize: 13, color: '#374151', paddingHorizontal: 8 }}>
                  {currentPage} / {totalPages}
                </Text>
                <TouchableOpacity
                  onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{ padding: 6, opacity: currentPage === totalPages ? 0.3 : 1 }}
                >
                  <ChevronRight size={18} color="#374151" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  style={{ padding: 6, opacity: currentPage === totalPages ? 0.3 : 1 }}
                >
                  <ChevronsRight size={18} color="#374151" />
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* Staggered Detail Modal */}
      {selectedStaggered && (
        <StaggeredListDetails
          staggered={selectedStaggered as any}
          onClose={() => setSelectedStaggered(null)}
          onViewCustomer={handleViewCustomer}
          onPrevious={currentStaggeredIndex > 0 ? handlePreviousRecord : undefined}
          onNext={currentStaggeredIndex < filteredRecords.length - 1 ? handleNextRecord : undefined}
        />
      )}

      {/* Customer Detail Modal */}
      {(selectedCustomer || isLoadingDetails) && (
        <Modal visible animationType="slide" onRequestClose={() => setSelectedCustomer(null)}>
          {isLoadingDetails ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' }}>
              <ActivityIndicator size="large" color={primaryColor} />
              <Text style={{ marginTop: 12, color: '#6b7280' }}>Loading details...</Text>
            </View>
          ) : selectedCustomer ? (
            <BillingDetails
              billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
              onlineStatusRecords={[]}
              onClose={() => setSelectedCustomer(null)}
            />
          ) : null}
        </Modal>
      )}

      {/* Add Staggered Form Modal */}
      <StaggeredInstallationFormModal
        isOpen={isStaggeredFormModalOpen}
        onClose={() => setIsStaggeredFormModalOpen(false)}
        onSave={handleSaveStaggered}
      />

      {/* Filter/date drawer (mobile) — triggered via header filter icon if needed */}
      {mobileMenuOpen && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setMobileMenuOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', flexDirection: 'row' }}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setMobileMenuOpen(false)} />
            <View style={{ width: 280, backgroundColor: '#ffffff', height: '100%' }}>
              <View style={{
                paddingTop: 60, paddingHorizontal: 16, paddingBottom: 12,
                borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827' }}>Filter by Date</Text>
                <TouchableOpacity onPress={() => setMobileMenuOpen(false)}>
                  <X size={22} color="#6b7280" />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
                <TouchableOpacity
                  onPress={() => { setSelectedDate('All'); setMobileMenuOpen(false); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8,
                    backgroundColor: selectedDate === 'All' ? `${primaryColor}15` : '#f9fafb',
                    borderWidth: 1, borderColor: selectedDate === 'All' ? primaryColor : '#e5e7eb',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Globe size={15} color={selectedDate === 'All' ? primaryColor : '#6b7280'} />
                    <Text style={{ color: selectedDate === 'All' ? primaryColor : '#374151', fontWeight: '500' }}>All Records</Text>
                  </View>
                  <Text style={{ color: '#9ca3af', fontSize: 12 }}>{dateItems.all}</Text>
                </TouchableOpacity>

                {dateItems.dates.map((item, index) => (
                  <TouchableOpacity
                    key={index}
                    onPress={() => { setSelectedDate(item.date); setMobileMenuOpen(false); }}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8,
                      backgroundColor: selectedDate === item.date ? `${primaryColor}15` : '#f9fafb',
                      borderWidth: 1, borderColor: selectedDate === item.date ? primaryColor : '#e5e7eb',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Calendar size={15} color={selectedDate === item.date ? primaryColor : '#6b7280'} />
                      <Text style={{ color: selectedDate === item.date ? primaryColor : '#374151', fontWeight: '500' }}>
                        {item.date}
                      </Text>
                    </View>
                    <Text style={{ color: '#9ca3af', fontSize: 12 }}>{item.count}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

export default StaggeredPayment;
