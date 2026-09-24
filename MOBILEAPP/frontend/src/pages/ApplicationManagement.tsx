import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import { Filter, Download, RefreshCw, X, ExternalLink } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalSearch from './globalfunctions/GlobalSearch';
import ApplicationDetails from '../components/ApplicationDetails';
import AddApplicationModal from '../modals/AddApplicationModal';
import ApplicationFunnelFilter, {
  allColumns as filterColumns,
  FilterValues,
} from '../filter/ApplicationFunnelFilter';
import { useApplicationStore } from '../store/applicationStore';
import { Application } from '../types/application';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { exportToCSV } from '../utils/exportUtils';

// ─── helpers ─────────────────────────────────────────────────────────────────

const formatDate = (dateString?: string): string => {
  if (!dateString || dateString === '-' || dateString === 'N/A') return dateString || '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${date.getFullYear()}`;
  } catch {
    return dateString;
  }
};

const getStatusColor = (status: string): string => {
  const s = (status || '').toLowerCase();
  if (s === 'schedule' || s === 'scheduled' || s === 'confirmed' || s === 'completed') return '#16a34a';
  if (s === 'no facility' || s === 'cancelled') return '#dc2626';
  if (s === 'no slot') return '#9333ea';
  if (s === 'duplicate') return '#db2777';
  if (s === 'in progress') return '#2563eb';
  if (s === 'pending') return '#ea580c';
  if (s === 'empty') return '#9ca3af';
  return '#6b7280';
};

const getStatusDotColor = (statusId: string): string => {
  const val = statusId.replace('status:', '');
  if (val === 'scheduled' || val === 'confirmed') return '#16a34a';
  if (val === 'no slot') return '#9333ea';
  if (val === 'no facility' || val === 'cancelled') return '#dc2626';
  if (val === 'duplicate') return '#db2777';
  if (val === 'pending') return '#ea580c';
  return '#9ca3af';
};

const allColumns = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'status', label: 'Status' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'firstName', label: 'First Name' },
  { key: 'middleInitial', label: 'M.I.' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'emailAddress', label: 'Email Address' },
  { key: 'mobileNumber', label: 'Mobile Number' },
  { key: 'secondaryMobileNumber', label: 'Secondary Mobile' },
  { key: 'installationAddress', label: 'Installation Address' },
  { key: 'landmark', label: 'Landmark' },
  { key: 'region', label: 'Region' },
  { key: 'city', label: 'City' },
  { key: 'barangay', label: 'Barangay' },
  { key: 'desiredPlan', label: 'Desired Plan' },
  { key: 'promo', label: 'Promo' },
  { key: 'referredBy', label: 'Referred By' },
  { key: 'createDate', label: 'Create Date' },
  { key: 'createTime', label: 'Create Time' },
];

const renderCellValue = (application: Application, columnKey: string): string => {
  switch (columnKey) {
    case 'timestamp':
      return (application as any).create_date && (application as any).create_time
        ? `${formatDate((application as any).create_date)} ${(application as any).create_time}`
        : formatDate((application as any).timestamp) || '-';
    case 'status': return (application as any).status || '-';
    case 'customerName': return application.customer_name || '-';
    case 'firstName': return (application as any).first_name || '-';
    case 'middleInitial': return (application as any).middle_initial || '-';
    case 'lastName': return (application as any).last_name || '-';
    case 'emailAddress': return (application as any).email_address || '-';
    case 'mobileNumber': return (application as any).mobile_number || '-';
    case 'secondaryMobileNumber': return (application as any).secondary_mobile_number || '-';
    case 'installationAddress': return (application as any).installation_address || (application as any).address || '-';
    case 'landmark': return (application as any).landmark || '-';
    case 'region': return (application as any).region || '-';
    case 'city': return (application as any).city || '-';
    case 'barangay': return (application as any).barangay || '-';
    case 'desiredPlan': return (application as any).desired_plan || '-';
    case 'promo': return (application as any).promo || '-';
    case 'referredBy': return (application as any).referred_by || '-';
    case 'createDate': return formatDate((application as any).create_date) || '-';
    case 'createTime': return (application as any).create_time || '-';
    default: return '-';
  }
};

// ─── props ────────────────────────────────────────────────────────────────────

interface ApplicationManagementProps {
  onNavigate?: (section: string, extra?: string) => void;
}

// ─── component ────────────────────────────────────────────────────────────────

const ApplicationManagement: React.FC<ApplicationManagementProps> = ({ onNavigate }) => {
  const isDarkMode = false;
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  // ── state ─────────────────────────────────────────────────────────────────
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(null);
  const [currentUserRoleId, setCurrentUserRoleId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [funnelFilters, setFunnelFilters] = useState<FilterValues>({});
  const [timestampFrom] = useState('');
  const [timestampTo] = useState('');

  const [isSidebarVisible, setIsSidebarVisible] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const selectedApplicationRef = useRef<Application | null>(null);

  const {
    applications,
    isLoading,
    error,
    fetchApplications,
    refreshApplications,
    silentRefresh,
  } = useApplicationStore();

  const primary = colorPalette?.primary || '#7c3aed';

  // ── bootstrap ─────────────────────────────────────────────────────────────

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => { });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('authData').then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        setCurrentUserOrgId(
          d.organization_id || d.user?.organization_id || d.organization?.id || d.user?.organization?.id || null
        );
        setCurrentUserRoleId(Number(d.role_id) || Number(d.user?.role_id) || null);
        setCurrentUserRole((d.role || d.user?.role || '').toLowerCase());
        setUserEmail(d.email || d.user?.email || '');
      } catch { /* ignore */ }
    });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('applicationFunnelFilters').then((raw) => {
      if (raw) {
        try { setFunnelFilters(JSON.parse(raw)); } catch { /* ignore */ }
      }
    });
  }, []);

  useEffect(() => {
    if (applications.length === 0) fetchApplications();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 15-minute silent refresh
  useEffect(() => {
    const id = setInterval(() => {
      silentRefresh().catch(() => { });
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [silentRefresh]);

  // Keep ref in sync
  useEffect(() => {
    selectedApplicationRef.current = selectedApplication;
  }, [selectedApplication]);

  // Auto-update selected app when store updates
  useEffect(() => {
    if (selectedApplicationRef.current && applications.length > 0) {
      const updated = applications.find((r) => r.id === selectedApplicationRef.current?.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedApplicationRef.current)) {
        setSelectedApplication(updated);
      }
    }
  }, [applications]);

  // ── pull-to-refresh ───────────────────────────────────────────────────────

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refreshApplications(); } finally { setRefreshing(false); }
  };

  const handleManualRefresh = async () => {
    setIsRefreshingManual(true);
    try { await refreshApplications(); } finally { setIsRefreshingManual(false); }
  };

  // ── filtering ─────────────────────────────────────────────────────────────

  const isSuperUser = useMemo(
    () =>
      currentUserRoleId === 1 ||
      currentUserRoleId === 7 ||
      currentUserRoleId === 8 ||
      currentUserRole === 'administrator' ||
      currentUserRole === 'superadmin' ||
      currentUserRole === 'headtech',
    [currentUserRoleId, currentUserRole]
  );

  const globalFilteredApplications = useMemo(() => {
    return applications.filter((application) => {
      if (!isSuperUser && currentUserOrgId) {
        if ((application as any).organization_id !== currentUserOrgId) return false;
      } else if (!isSuperUser && !currentUserOrgId) {
        if ((application as any).organization_id) return false;
      }

      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return Object.values(val).some((v) => checkValue(v));
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };
      if (searchQuery !== '' && !checkValue(application)) return false;

      for (const [key, filter] of Object.entries(funnelFilters)) {
        const appValue = (application as any)[key];
        const tf = filter as any;

        if (tf.type === 'text' && tf.value !== undefined && tf.value !== '') {
          if (!String(appValue || '').toLowerCase().includes(String(tf.value).toLowerCase())) return false;
        } else if (tf.type === 'number') {
          const numValue = parseFloat(appValue);
          if (!isNaN(numValue)) {
            if (tf.from !== undefined && tf.from !== '' && numValue < parseFloat(tf.from)) return false;
            if (tf.to !== undefined && tf.to !== '' && numValue > parseFloat(tf.to)) return false;
          } else if ((tf.from !== undefined && tf.from !== '') || (tf.to !== undefined && tf.to !== '')) {
            return false;
          }
        } else if (tf.type === 'date') {
          if (appValue) {
            const dv = new Date(appValue).getTime();
            if (!isNaN(dv)) {
              if (tf.from && dv < new Date(tf.from).getTime()) return false;
              if (tf.to && dv > new Date(tf.to).getTime() + 86400000) return false;
            } else { return false; }
          } else if (tf.from || tf.to) { return false; }
        } else if (tf.type === 'boolean' && tf.value !== undefined && tf.value !== '') {
          const bv = appValue === true || appValue === 'true' || appValue === 1;
          if (bv !== tf.value) return false;
        } else if (tf.type === 'checklist' && tf.selectedOptions && tf.selectedOptions.length > 0) {
          let appVal = (application as any)[key];
          if (key === 'status') {
            let st = String(appVal || '').toLowerCase();
            if (!appVal || String(appVal).trim() === '') st = 'empty';
            appVal = st === 'schedule' ? 'scheduled' : st;
          }
          const normVal = String(appVal || '').toLowerCase().trim();
          const isMatch = tf.selectedOptions.some((opt: string) => {
            const fv = String(opt).toLowerCase().trim();
            if (['status', 'barangay', 'city', 'region', 'terms_agreed', 'desired_plan', 'desiredPlan'].includes(key)) {
              return normVal === fv;
            }
            return normVal.includes(fv);
          });
          if (!isMatch) return false;
        }
      }

      // Timestamp date range filter
      if (timestampFrom || timestampTo) {
        const dateValueStr = (application as any).timestamp;
        if (!dateValueStr) return false;
        const dv = new Date(dateValueStr).getTime();
        if (isNaN(dv)) return false;
        if (timestampFrom) {
          const fd = new Date(timestampFrom);
          fd.setHours(0, 0, 0, 0);
          if (dv < fd.getTime()) return false;
        }
        if (timestampTo) {
          const td = new Date(timestampTo);
          td.setHours(23, 59, 59, 999);
          if (dv > td.getTime()) return false;
        }
      }

      return true;
    });
  }, [applications, searchQuery, funnelFilters, timestampFrom, timestampTo, isSuperUser, currentUserOrgId]);

  const statusItems = useMemo(() => {
    const statuses = [
      { name: 'Scheduled', value: 'scheduled' },
      { name: 'No Slot', value: 'no slot' },
      { name: 'No Facility', value: 'no facility' },
      { name: 'Duplicate', value: 'duplicate' },
      { name: 'Cancelled', value: 'cancelled' },
      { name: 'Confirmed', value: 'confirmed' },
      { name: 'Pending', value: 'pending' },
      { name: 'Empty', value: 'empty' },
    ];
    const counts: Record<string, number> = {};
    statuses.forEach((s) => (counts[s.value] = 0));
    globalFilteredApplications.forEach((app) => {
      let st = ((app as any).status || '').toLowerCase();
      if (!(app as any).status || String((app as any).status).trim() === '') st = 'empty';
      const norm = st === 'schedule' ? 'scheduled' : st;
      if (counts[norm] !== undefined) counts[norm]++;
    });
    return {
      items: statuses
        .map((s) => ({ id: `status:${s.value}`, name: s.name, count: counts[s.value] || 0 }))
        .filter((s) => s.count > 0),
      total: globalFilteredApplications.length,
    };
  }, [globalFilteredApplications]);

  const filteredApplications = useMemo(() => {
    let filtered = globalFilteredApplications.filter((application) => {
      if (selectedLocation === 'all') return true;
      if (selectedLocation.startsWith('status:')) {
        const statusValue = selectedLocation.substring(7);
        let appStatus = ((application as any).status || '').toLowerCase();
        if (!(application as any).status || String((application as any).status).trim() === '') appStatus = 'empty';
        const norm = appStatus === 'schedule' ? 'scheduled' : appStatus;
        return norm === statusValue;
      }
      return true;
    });

    filtered = [...filtered].sort((a, b) => {
      const dateA = (a as any).created_at || (a as any).timestamp;
      const dateB = (b as any).created_at || (b as any).timestamp;
      const tA = dateA ? new Date(dateA).getTime() : 0;
      const tB = dateB ? new Date(dateB).getTime() : 0;
      if (tA !== tB) return tB - tA;
      return (parseInt(b.id) || 0) - (parseInt(a.id) || 0);
    });

    return filtered;
  }, [globalFilteredApplications, selectedLocation]);

  const currentApplicationIndex = useMemo(
    () => (!selectedApplication ? -1 : filteredApplications.findIndex((r) => r.id === selectedApplication.id)),
    [filteredApplications, selectedApplication]
  );

  // ── pagination ──────────────────────────────────────────────────────────────

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredApplications.length / itemsPerPage)),
    [filteredApplications.length]
  );

  const paginatedApplications = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredApplications.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredApplications, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  // Reset to first page whenever the result set changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedLocation, funnelFilters]);

  // ── actions ───────────────────────────────────────────────────────────────

  const handleApplicationUpdate = () => { silentRefresh().catch(() => { }); };

  const handleExport = () => {
    if (!filteredApplications.length) return;
    exportToCSV('applications_export', allColumns, filteredApplications, renderCellValue);
  };

  const handleApplyFilters = async (filters: FilterValues) => {
    setFunnelFilters(filters);
    try { await AsyncStorage.setItem('applicationFunnelFilters', JSON.stringify(filters)); } catch { /* ignore */ }
  };

  const handleClearAllFilters = async () => {
    setFunnelFilters({});
    try { await AsyncStorage.removeItem('applicationFunnelFilters'); } catch { /* ignore */ }
  };

  const removeFilter = async (key: string) => {
    const next = { ...funnelFilters };
    delete next[key];
    setFunnelFilters(next);
    try { await AsyncStorage.setItem('applicationFunnelFilters', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const openApplyForm = () => {
    const url = userEmail
      ? `https://apply.gowiser.ph?created_by_email=${encodeURIComponent(userEmail)}`
      : 'https://apply.gowiser.ph';
    Linking.openURL(url).catch(() => { });
  };

  // ── filter display helpers ────────────────────────────────────────────────

  const activeFilterKeys = Object.keys(funnelFilters);

  const getFilterDisplayValue = (key: string, filter: any): string => {
    if (filter.type === 'text' || filter.type === 'boolean') return String(filter.value);
    if (filter.type === 'checklist') {
      return Array.isArray(filter.selectedOptions) ? filter.selectedOptions.join(', ') : String(filter.selectedOptions);
    }
    if (filter.type === 'number' || filter.type === 'date') {
      if (filter.from && filter.to) return `${filter.from} - ${filter.to}`;
      if (filter.from) return `> ${filter.from}`;
      if (filter.to) return `< ${filter.to}`;
    }
    return '';
  };

  // ── sidebar content ───────────────────────────────────────────────────────

  const SidebarContent = () => (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingTop: isTablet ? 16 : 60,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Applications</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={openApplyForm}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: primary,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 6,
            }}
          >
            <ExternalLink size={13} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Apply</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsSidebarVisible(false)}>
            <X size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {/* All Applications */}
        <TouchableOpacity
          onPress={() => { setSelectedLocation('all'); setIsSidebarVisible(false); }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 14,
            backgroundColor: selectedLocation === 'all' ? `${primary}18` : 'transparent',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '500', color: selectedLocation === 'all' ? primary : '#374151' }}>
            All Applications
          </Text>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              backgroundColor: selectedLocation === 'all' ? primary : '#f3f4f6',
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: selectedLocation === 'all' ? '#fff' : '#6b7280' }}>
              {statusItems.total}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Status items */}
        {statusItems.items.map((status) => {
          const isSelected = selectedLocation === status.id;
          const dotColor = getStatusDotColor(status.id);
          return (
            <TouchableOpacity
              key={status.id}
              onPress={() => { setSelectedLocation(status.id); setIsSidebarVisible(false); }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingVertical: 12,
                backgroundColor: isSelected ? `${primary}18` : 'transparent',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
                <Text style={{ fontSize: 14, fontWeight: '500', color: isSelected ? primary : '#374151' }}>
                  {status.name}
                </Text>
              </View>
              {status.count > 0 && (
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 6,
                    backgroundColor: isSelected ? primary : '#f3f4f6',
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isSelected ? '#fff' : '#9ca3af' }}>
                    {status.count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  // ── card renderer ─────────────────────────────────────────────────────────

  const renderCard = ({ item }: { item: Application }) => {
    const statusRaw = (item as any).status || '';
    const statusDisplay = !statusRaw || String(statusRaw).trim() === '' ? 'Empty' : statusRaw;
    const statusColor = getStatusColor(statusDisplay);
    const isSelected = selectedApplication?.id === item.id;

    return (
      <TouchableOpacity
        onPress={() => setSelectedApplication(item)}
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
              {(item.customer_name || '').toLowerCase()}
            </Text>
            <Text style={{ fontSize: 12, color: '#4b5563' }} numberOfLines={2}>
              {(item as any).create_date && (item as any).create_time
                ? `${(item as any).create_date} ${(item as any).create_time}`
                : (item as any).timestamp || 'Not specified'}
              {' | '}
              {[
                item.installation_address || (item as any).address,
                (item as any).barangay,
                (item as any).city,
                (item as any).region,
              ]
                .filter(Boolean)
                .join(', ')}
            </Text>
          </View>
          <View style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 16, flexShrink: 0 }}>
            <Text style={{ fontWeight: 'bold', textTransform: 'uppercase', color: statusColor }}>
              {statusDisplay}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ── main render ───────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Top bar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 12,
          backgroundColor: '#fff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          gap: 8,
        }}
      >
        {/* Status sidebar trigger */}
        <TouchableOpacity
          onPress={() => setIsSidebarVisible(true)}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: selectedLocation !== 'all' ? primary : '#e5e7eb',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selectedLocation !== 'all' ? `${primary}12` : '#fff',
            flexShrink: 0,
          }}
        >
          <Filter size={18} color={selectedLocation !== 'all' ? primary : '#374151'} />
        </TouchableOpacity>

        {/* Search */}
        <View style={{ flex: 1 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search applications..."
          />
        </View>

        {/* Funnel filter */}
        <TouchableOpacity
          onPress={() => setIsFunnelFilterOpen(true)}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: activeFilterKeys.length > 0 ? '#ef4444' : '#e5e7eb',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff',
            flexShrink: 0,
          }}
        >
          <Filter size={18} color={activeFilterKeys.length > 0 ? '#ef4444' : '#374151'} />
          {activeFilterKeys.length > 0 && (
            <View
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: '#ef4444',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>{activeFilterKeys.length}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Export */}
        <TouchableOpacity
          onPress={handleExport}
          disabled={isLoading || filteredApplications.length === 0}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: primary,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff',
            opacity: isLoading || filteredApplications.length === 0 ? 0.4 : 1,
            flexShrink: 0,
          }}
        >
          <Download size={18} color={primary} />
        </TouchableOpacity>

        {/* Refresh */}
        <TouchableOpacity
          onPress={handleManualRefresh}
          disabled={isLoading || isRefreshingManual}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: primary,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff',
            opacity: isLoading || isRefreshingManual ? 0.4 : 1,
            flexShrink: 0,
          }}
        >
          {isRefreshingManual || (isLoading && applications.length === 0) ? (
            <ActivityIndicator size="small" color={primary} />
          ) : (
            <RefreshCw size={18} color={primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* Active filter chips */}
      {activeFilterKeys.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}
          contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#9ca3af', letterSpacing: 1 }}>FILTERS:</Text>
          {activeFilterKeys.map((filterKey) => {
            const filter = funnelFilters[filterKey] as any;
            const col = filterColumns.find((c) => (c as any).key === filterKey);
            const label = col?.label || filterKey;
            const displayVal = getFilterDisplayValue(filterKey, filter);
            return (
              <View
                key={filterKey}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: `${primary}15`,
                  borderRadius: 99,
                  paddingLeft: 10,
                  paddingRight: 6,
                  paddingVertical: 4,
                  borderWidth: 1,
                  borderColor: `${primary}30`,
                  gap: 4,
                }}
              >
                <Text style={{ fontSize: 11, color: primary }}>
                  <Text style={{ opacity: 0.7 }}>{label}: </Text>
                  {displayVal}
                </Text>
                <TouchableOpacity onPress={() => removeFilter(filterKey)}>
                  <X size={12} color={primary} />
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity onPress={handleClearAllFilters} style={{ paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: primary, textDecorationLine: 'underline' }}>
              Clear all
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* List */}
      {isLoading && applications.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={primary} />
          <Text style={{ marginTop: 12, color: '#6b7280', fontSize: 14 }}>Loading applications...</Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>{error}</Text>
          <TouchableOpacity
            onPress={() => fetchApplications()}
            style={{ backgroundColor: primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            style={{ flex: 1 }}
            data={paginatedApplications}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderCard}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={primary} />}
            ListEmptyComponent={
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <Text style={{ color: '#6b7280', fontSize: 14 }}>
                  No applications found matching your filters
                </Text>
              </View>
            }
            contentContainerStyle={{ flexGrow: 1 }}
          />

          {/* Pagination */}
          {filteredApplications.length > 0 && (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: '#e5e7eb',
                backgroundColor: '#fff',
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: isTablet ? 12 : 110,
                flexDirection: isTablet ? 'row' : 'column',
                alignItems: 'center',
                justifyContent: isTablet ? 'space-between' : 'center',
                gap: isTablet ? 0 : 12,
              }}
            >
              <Text style={{ fontSize: 12, color: '#4b5563' }}>
                Showing <Text style={{ fontWeight: '500' }}>{(currentPage - 1) * itemsPerPage + 1}</Text> to{' '}
                <Text style={{ fontWeight: '500' }}>{Math.min(currentPage * itemsPerPage, filteredApplications.length)}</Text> of{' '}
                <Text style={{ fontWeight: '500' }}>{filteredApplications.length}</Text> results
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 4,
                    minWidth: 40,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: currentPage === 1 ? '#f3f4f6' : '#fff',
                    borderWidth: currentPage === 1 ? 0 : 1,
                    borderColor: '#d1d5db',
                  }}
                >
                  <Text style={{ fontSize: 18, fontWeight: 'bold', color: currentPage === 1 ? '#9ca3af' : '#374151' }}>{'<'}</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ paddingHorizontal: 8, fontSize: 14, color: '#111827' }}>
                    Page {currentPage} of {totalPages}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 4,
                    minWidth: 40,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: currentPage === totalPages ? '#f3f4f6' : '#fff',
                    borderWidth: currentPage === totalPages ? 0 : 1,
                    borderColor: '#d1d5db',
                  }}
                >
                  <Text style={{ fontSize: 18, fontWeight: 'bold', color: currentPage === totalPages ? '#9ca3af' : '#374151' }}>{'>'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      )}

      {/* Sidebar Modal */}
      <Modal
        visible={isSidebarVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsSidebarVisible(false)}
      >
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsSidebarVisible(false)}
          />
          <View style={{ width: '80%', maxWidth: 320, backgroundColor: '#fff', flex: 1 }}>
            <SidebarContent />
          </View>
        </View>
      </Modal>

      {/* Application Details Modal */}
      {selectedApplication && (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => setSelectedApplication(null)}
        >
          <ApplicationDetails
            application={selectedApplication as any}
            onClose={() => setSelectedApplication(null)}
            onApplicationUpdate={handleApplicationUpdate}
          />
        </Modal>
      )}

      {/* Add Application Modal */}
      <AddApplicationModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={() => {
          silentRefresh().catch(() => { });
          setIsAddModalOpen(false);
        }}
      />

      {/* Funnel Filter */}
      <ApplicationFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          handleApplyFilters(filters);
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={funnelFilters}
      />
    </View>
  );
};

export default ApplicationManagement;
