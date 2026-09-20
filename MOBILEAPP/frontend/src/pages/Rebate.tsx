import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Dimensions,
  ScrollView,
} from 'react-native';
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Menu,
  RefreshCw,
  FileText,
} from 'lucide-react-native';
import { StandardPage } from '../components/common';
import RebateFormModal from '../modals/RebateFormModal';
import RebateDetails from '../components/RebateDetails';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { exportToCSV } from '../utils/exportUtils';
import BillingDetails from '../components/CustomerDetails';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePermissions } from '../hooks/usePermissions';

// Force light mode per RN migration conventions
const isDarkMode = false;

interface RebateRecord {
  id: number;
  number_of_dates: number;
  rebate_type: string;
  selected_rebate: string;
  month: string;
  status: string;
  created_by: string;
  modified_by: string | null;
  modified_date: string;
  organization_id?: number | null;
}

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

const rebateColumns = [
  { key: 'id', label: 'ID' },
  { key: 'rebate_type', label: 'Rebate Type' },
  { key: 'selected_rebate', label: 'Selected Rebate' },
  { key: 'month', label: 'Month' },
  { key: 'number_of_dates', label: 'Number of Dates' },
  { key: 'status', label: 'Status' },
  { key: 'modified_by', label: 'Approved By' },
  { key: 'modified_date', label: 'Modified Date' },
];

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

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

const Rebate: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [rebateRecords, setRebateRecords] = useState<RebateRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState<boolean>(false);
  const [selectedRebate, setSelectedRebate] = useState<RebateRecord | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [userOrgId, setUserOrgId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'sidebar' | 'list'>('list');
  const [showSidebar, setShowSidebar] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  // 15-minute auto-refresh interval (replaces idle detection + pusher)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchRebateData(true);
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(p => setColorPalette(p))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const loadAuthData = async () => {
      try {
        const authDataStr = await AsyncStorage.getItem('authData');
        if (authDataStr) {
          const userData = JSON.parse(authDataStr);
          setUserRole(userData.role || '');
          setRoleId(userData.role_id || null);

          const orgId = userData.organization_id
            || userData.user?.organization_id
            || userData.organization?.id
            || userData.user?.organization?.id
            || null;
          setUserOrgId(orgId);

          let perms: string[] = [];
          if (userData.permissions) {
            if (Array.isArray(userData.permissions)) {
              perms = userData.permissions;
            } else if (typeof userData.permissions === 'string') {
              try {
                const parsed = JSON.parse(userData.permissions);
                perms = Array.isArray(parsed) ? parsed : [];
              } catch (e) {
                perms = userData.permissions.split(',').map((p: string) => p.trim()).filter(Boolean);
              }
            }
          }
          setUserPermissions(perms);
        }
      } catch (error) {
        console.error('Error parsing auth data in Rebate:', error);
      }
    };
    loadAuthData();
  }, []);

  useEffect(() => {
    fetchRebateData();
  }, []);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
  const { can: hasPermission } = usePermissions();

  const fetchRebateData = async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      const response = await apiClient.get<RebateRecord[]>('/rebates');
      setRebateRecords(Array.isArray(response.data) ? response.data : []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch Rebate records:', err);
      if (!silent) setError('Failed to load Rebate records. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setIsRefreshingManual(true);
      const response = await apiClient.get<RebateRecord[]>('/rebates');
      setRebateRecords(Array.isArray(response.data) ? response.data : []);
      setError(null);
    } catch (err) {
      console.error('Failed to refresh Rebate records:', err);
    } finally {
      setRefreshing(false);
      setIsRefreshingManual(false);
    }
  };

  const handleViewCustomer = async (accountNo: string) => {
    setIsLoadingDetails(true);
    try {
      const detail = await getCustomerDetail(accountNo);
      if (detail) {
        setSelectedCustomer(detail);
      }
    } catch (err) {
      console.error('Error fetching customer details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Organization + search filter
  const globalFilteredRecords = useMemo(() => {
    let filtered = rebateRecords;

    if (userOrgId) {
      filtered = filtered.filter((r) => r.organization_id === userOrgId);
    } else {
      filtered = filtered.filter((r) => !r.organization_id);
    }

    if (searchQuery) {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return Object.values(val).some(v => checkValue(v));
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };
      filtered = filtered.filter(record => checkValue(record));
    }

    return filtered;
  }, [rebateRecords, searchQuery, userOrgId]);

  const dateItems = useMemo(() => {
    const monthCounts: Record<string, number> = {};
    const months = new Set<string>();
    globalFilteredRecords.forEach(record => {
      if (record.month) {
        monthCounts[record.month] = (monthCounts[record.month] || 0) + 1;
        months.add(record.month);
      }
    });
    const sortedMonths = Array.from(months)
      .sort((a, b) => b.localeCompare(a))
      .map(month => ({ date: month, count: monthCounts[month] }));
    return { all: globalFilteredRecords.length, dates: sortedMonths };
  }, [globalFilteredRecords]);

  const filteredRecords = useMemo(() => {
    return globalFilteredRecords.filter(record => {
      if (selectedDate === 'All') return true;
      return record.month === selectedDate;
    });
  }, [globalFilteredRecords, selectedDate]);

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDate, itemsPerPage]);

  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage);

  const handleExport = () => {
    if (!filteredRecords || filteredRecords.length === 0) return;
    const getExportValue = (record: RebateRecord, columnKey: string) => {
      switch (columnKey) {
        case 'id': return record.id;
        case 'rebate_type': return record.rebate_type || '-';
        case 'selected_rebate': return record.selected_rebate || '-';
        case 'month': return record.month || '-';
        case 'number_of_dates': return record.number_of_dates;
        case 'status': return record.status || '-';
        case 'modified_by': return record.modified_by || '-';
        case 'modified_date': return formatDate(record.modified_date, true);
        default: return '-';
      }
    };
    exportToCSV('rebate_export', rebateColumns, filteredRecords, getExportValue);
  };

  const getStatusColor = (status: string) => {
    switch ((status || '').toLowerCase()) {
      case 'unused': return '#22c55e';
      case 'used': return '#ef4444';
      case 'pending': return '#eab308';
      default: return '#6b7280';
    }
  };

  // Sidebar content (month filter)
  const renderSidebar = () => (
    <View style={{
      flex: 1,
      backgroundColor: '#ffffff',
      borderRightWidth: isTablet ? 1 : 0,
      borderRightColor: '#e5e7eb',
    }}>
      {/* Sidebar header */}
      <View style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>Rebates</Text>
        {hasPermission('mass-rebate.add') && (
          <TouchableOpacity
            onPress={() => {
              setShowSidebar(false);
              setIsModalOpen(true);
            }}
            style={{
              backgroundColor: primaryColor,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 6,
              gap: 4,
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>+</Text>
            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '500' }}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* All Records item */}
      <ScrollView>
        <TouchableOpacity
          onPress={() => {
            setSelectedDate('All');
            setShowSidebar(false);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: selectedDate === 'All' ? `${primaryColor}22` : 'transparent',
          }}
        >
          <Text style={{
            fontSize: 14,
            color: selectedDate === 'All' ? primaryColor : '#374151',
            fontWeight: selectedDate === 'All' ? '600' : '400',
          }}>
            All Records
          </Text>
          <View style={{
            backgroundColor: selectedDate === 'All' ? primaryColor : '#e5e7eb',
            borderRadius: 10,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}>
            <Text style={{
              fontSize: 11,
              color: selectedDate === 'All' ? '#ffffff' : '#6b7280',
              fontWeight: '600',
            }}>
              {dateItems.all}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Month items */}
        {dateItems.dates.map((item, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => {
              setSelectedDate(item.date);
              setShowSidebar(false);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 12,
              backgroundColor: selectedDate === item.date ? `${primaryColor}22` : 'transparent',
              borderTopWidth: 1,
              borderTopColor: '#f3f4f6',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <FileText size={14} color={selectedDate === item.date ? primaryColor : '#6b7280'} />
              <Text style={{
                fontSize: 14,
                color: selectedDate === item.date ? primaryColor : '#374151',
                fontWeight: selectedDate === item.date ? '600' : '400',
              }}>
                {item.date}
              </Text>
            </View>
            <View style={{
              backgroundColor: selectedDate === item.date ? primaryColor : '#e5e7eb',
              borderRadius: 10,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}>
              <Text style={{
                fontSize: 10,
                color: selectedDate === item.date ? '#ffffff' : '#6b7280',
                fontWeight: '700',
              }}>
                {item.count}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  // Render each rebate record card in the list
  const renderItem = ({ item }: { item: RebateRecord }) => (
    <TouchableOpacity
      onPress={() => setSelectedRebate(item)}
      style={{
        backgroundColor: '#ffffff',
        marginHorizontal: 12,
        marginVertical: 4,
        borderRadius: 8,
        padding: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>#{item.id}</Text>
        <Text style={{
          fontSize: 12,
          fontWeight: '600',
          color: getStatusColor(item.status),
          textTransform: 'capitalize',
        }}>
          {item.status}
        </Text>
      </View>
      <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 2 }}>
        {item.selected_rebate || '-'}
      </Text>
      <Text style={{ fontSize: 13, color: '#374151', marginBottom: 4, textTransform: 'capitalize' }}>
        {item.rebate_type} · {item.month}
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>
          Days: <Text style={{ fontWeight: '600', color: '#111827' }}>{item.number_of_dates}</Text>
        </Text>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>
          {item.modified_by ? `Approved: ${item.modified_by}` : 'Pending approval'}
        </Text>
      </View>
      {item.modified_date && (
        <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
          {formatDate(item.modified_date, true)}
        </Text>
      )}
    </TouchableOpacity>
  );

  // Pagination controls
  // One layout, not two. This page used to branch into a tablet build with a
  // permanent sidebar and a separate phone build with a drawer and a floating
  // add button; the shell is responsive, so both are the same screen now.
  return (
    <StandardPage<RebateRecord>
      data={filteredRecords}
      keyExtractor={(item) => String(item.id)}
      renderItem={(item) => renderItem({ item })}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search Rebate records..."
      drawerContent={<View style={{ flex: 1, paddingTop: 60 }}>{renderSidebar()}</View>}
      drawerActive={selectedDate !== 'All'}
      chips={selectedDate !== 'All' ? [{ key: '__month', label: 'Month', value: selectedDate }] : []}
      onRemoveChip={() => setSelectedDate('All')}
      onClearChips={() => setSelectedDate('All')}
      onExport={handleExport}
      exportDisabled={isLoading || filteredRecords.length === 0}
      onRefresh={handleRefresh}
      refreshDisabled={isLoading || isRefreshingManual}
      isRefreshing={isLoading || isRefreshingManual}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      isLoading={isLoading}
      loadingText="Loading Rebate records..."
      error={error}
      onRetry={handleRefresh}
      emptyText="No Rebate records found"
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={(n) => { setItemsPerPage(n); setCurrentPage(1); }}
      colorPalette={colorPalette}
      isDarkMode={isDarkMode}
      toolbarActions={
        hasPermission('mass-rebate.add') ? (
          <TouchableOpacity
            onPress={() => setIsModalOpen(true)}
            style={{ width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: primaryColor }}
          >
            <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '300', lineHeight: 26 }}>+</Text>
          </TouchableOpacity>
        ) : null
      }
    >
      {selectedRebate && (
        <Modal visible animationType="slide" onRequestClose={() => setSelectedRebate(null)}>
          <RebateDetails
            rebate={selectedRebate as any}
            onClose={() => {
              setSelectedRebate(null);
              handleRefresh();
            }}
            onViewCustomer={handleViewCustomer}
          />
        </Modal>
      )}

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

      <RebateFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={() => {
          setIsModalOpen(false);
          handleRefresh();
        }}
      />
    </StandardPage>
  );
};

export default Rebate;
