import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Dimensions, RefreshControl, StyleSheet, Modal, DeviceEventEmitter } from 'react-native';
import { FileText, Search, X, Menu, RefreshCw, ArrowLeft, Filter, Check } from 'lucide-react-native';
import { FlashList } from '@shopify/flash-list';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ServiceOrderDetails from '../components/ServiceOrderDetails';
import { useServiceOrderContext, type ServiceOrder } from '../contexts/ServiceOrderContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { Picker } from '@react-native-picker/picker';
import { createAgentReferralMatcher, storedReferralOf } from '../utils/agentReferral';

// Location grouping removed as per user request

type MobileView = 'orders' | 'details';

// Utility functions outside component to avoid recreation
const formatDate = (dateStr?: string | null): string => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const datePart = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${datePart} ${timePart}`;
  } catch (e) {
    return dateStr;
  }
};

const checkIsStarted = (time?: string | null) => {
  if (!time) return false;
  const lowerTime = String(time).toLowerCase().trim();
  return !['0000-00-00 00:00:00', 'not set', '-', 'none', '', 'null', 'undefined'].includes(lowerTime);
};

const isWorkStarted = (item: ServiceOrder) => {
  const hasStart = checkIsStarted(item.start_time);
  const hasEnd = checkIsStarted(item.end_time);
  
  return hasStart && !hasEnd;
};
const StatusText = React.memo(({ status, type }: { status?: string, type: 'support' | 'visit' }) => {
  if (!status) return <Text style={{ color: '#9ca3af' }}>Unknown</Text>;

  let textColor = '';
  const lowerStatus = status.toLowerCase().trim();

  if (type === 'support') {
    switch (lowerStatus) {
      case 'resolved':
      case 'completed':
      case 'done':
        textColor = '#4ade80';
        break;
      case 'in-progress':
      case 'in progress':
        textColor = '#60a5fa';
        break;
      case 'pending':
        textColor = '#fb923c';
        break;
      case 'closed':
      case 'cancelled':
        textColor = '#9ca3af';
        break;
      default:
        textColor = '#9ca3af';
    }
  } else {
    switch (lowerStatus) {
      case 'completed':
      case 'done':
        textColor = '#4ade80';
        break;
      // Split out of the blue group (purple-400): sharing a colour with
      // "In Progress" made the two indistinguishable in the list.
      case 'reschedule':
        textColor = '#c084fc';
        break;
      case 'scheduled':
      case 'in progress':
        textColor = '#60a5fa';
        break;
      case 'pending':
        textColor = '#fb923c';
        break;
      case 'cancelled':
      case 'failed':
        textColor = '#ef4444';
        break;
      default:
        textColor = '#9ca3af';
    }
  }

  return (
    <Text style={{ fontWeight: 'bold', textTransform: 'uppercase', color: textColor }}>
      {status === 'in-progress' ? 'In Progress' : status}
    </Text>
  );
});

const ServiceOrderCard = React.memo(({
  serviceOrder,
  isSelected,
  onPress,
  userRole,
  userRoleId
}: {
  serviceOrder: ServiceOrder,
  isSelected: boolean,
  onPress: (so: ServiceOrder) => void,
  userRole: string,
  userRoleId: number | null
}) => (
  <Pressable
    onPress={() => onPress(serviceOrder)}
    style={[so.cardRow, {
      backgroundColor: isSelected ? '#f3f4f6' : 'transparent',
      borderColor: '#e5e7eb'
    }]}
  >
    <View style={so.cardInner}>
      <View style={so.cardLeft}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
          <Text style={[so.cardName, { color: '#111827', marginBottom: 0 }]}>{serviceOrder.fullName}</Text>
          {isWorkStarted(serviceOrder) && (
            <View style={{ backgroundColor: '#dcfce7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ color: '#15803d', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' }}>
                Work Started
              </Text>
            </View>
          )}
        </View>
        <Text style={[so.cardSub, { color: '#4b5563' }]} numberOfLines={2}>
          {formatDate(serviceOrder.timestamp)} | {serviceOrder.fullAddress}
        </Text>
      </View>
      <View style={so.cardRight}>
        <StatusText
          status={(userRole.toLowerCase() === 'technician' || userRoleId === 2) ? serviceOrder.visitStatus : serviceOrder.supportStatus}
          type={(userRole.toLowerCase() === 'technician' || userRoleId === 2) ? 'visit' : 'support'}
        />
      </View>
    </View>
  </Pressable>
));

const so = StyleSheet.create({
  container: { height: '100%', overflow: 'hidden' },
  // Sidebar
  sidebar: { borderRightWidth: 1, flexShrink: 0, flexDirection: 'column', position: 'relative' },
  sidebarHeader: { padding: 16, borderBottomWidth: 1, flexShrink: 0 },
  sidebarTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  sidebarTitle: { fontSize: 18, fontWeight: '600' },
  flex1: { flex: 1 },
  // Location items
  locationItem: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  locationRow: { flexDirection: 'row', alignItems: 'center' },
  locationName: { textTransform: 'capitalize', fontSize: 14 },
  mr8: { marginRight: 8 },
  mr12: { marginRight: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999 },
  badgeText: { fontSize: 12 },
  badgeLg: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 9999 },
  badgeLgText: { fontSize: 14 },
  // Mobile locations
  mobileLocations: { flex: 1, flexDirection: 'column', overflow: 'hidden' },
  mobileLocHeader: { padding: 16, paddingTop: 60, borderBottomWidth: 1 },
  mobileLocationItem: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1 },
  mobileLocationName: { textTransform: 'capitalize', fontSize: 16 },
  // Mobile overlay
  mobileOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  mobileBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  mobileSidebar: { position: 'absolute', top: 0, left: 0, bottom: 0, width: 256, flexDirection: 'column' },
  mobileSidebarHeader: { padding: 16, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Main content
  mainContent: { overflow: 'hidden', flex: 1, flexDirection: 'column' },
  mainInner: { flexDirection: 'column', height: '100%' },
  // Toolbar
  toolbar: { padding: 16, paddingTop: 60, borderBottomWidth: 1, flexShrink: 0 },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn: { padding: 8, borderRadius: 4 },
  menuBtn: { backgroundColor: '#374151', padding: 8, borderRadius: 4 },
  searchWrap: { position: 'relative', flex: 1 },
  searchInput: { width: '100%', borderRadius: 4, paddingLeft: 40, paddingRight: 16, paddingVertical: 8, borderWidth: 1 },
  searchIcon: { position: 'absolute', left: 12, top: 10 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, flexDirection: 'row', alignItems: 'center' },
  // List area
  listArea: { flex: 1, overflow: 'hidden', flexDirection: 'column' },
  loadingWrap: { paddingHorizontal: 16, paddingVertical: 48, alignItems: 'center' },
  skeletonCol: { flexDirection: 'column', alignItems: 'center' },
  skeletonBar1: { height: 16, width: '33%', borderRadius: 4, marginBottom: 16 },
  skeletonBar2: { height: 16, width: '50%', borderRadius: 4 },
  loadingText: { marginTop: 16 },
  retryBtn: { marginTop: 16, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4 },
  retryText: { color: 'white' },
  // Cards
  cardRow: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  cardInner: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardLeft: { flex: 1, minWidth: 0 },
  cardName: { fontWeight: '500', fontSize: 14, marginBottom: 4 },
  cardSub: { fontSize: 12 },
  cardRight: { flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 16, flexShrink: 0 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48 },
  // Pagination
  paginationBar: { borderTopWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paginationInfo: { fontSize: 12 },
  bold500: { fontWeight: '500' },
  paginationBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  pageBtnText: { fontSize: 14 },
  pageIndicatorWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pageIndicator: { paddingHorizontal: 8, fontSize: 14 },
  // Detail panels
  mobileDetail: { flex: 1, flexDirection: 'column', overflow: 'hidden' },
  tabletDetail: { flexShrink: 0, overflow: 'hidden' },
  // Status Modal
  statusModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  statusModalContent: { width: '80%', backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
  statusModalHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', alignItems: 'center' },
  statusModalTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  statusItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusItemText: { fontSize: 14, color: '#374151' },
});

const ServiceOrderPage: React.FC = () => {
  const isDarkMode = false; // Forced light mode as per user request
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { 
    serviceOrders, 
    isLoading, 
    isRefreshing,
    isFetchingNextPage,
    error, 
    refreshServiceOrders, 
    silentRefresh, 
    setSearchQuery: setContextSearch, 
    fetchNextPage, 
    hasMore 
  } = useServiceOrderContext();
  const [selectedServiceOrderRaw, setSelectedServiceOrderRaw] = useState<ServiceOrder | null>(null);

  const selectedServiceOrder = useMemo(() => {
    if (!selectedServiceOrderRaw) return null;
    return serviceOrders.find(so => String(so.id) === String(selectedServiceOrderRaw.id)) || selectedServiceOrderRaw;
  }, [serviceOrders, selectedServiceOrderRaw]);
  const [userRole, setUserRole] = useState<string>('');
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [userFullName, setUserFullName] = useState<string>('');
  // A referral made through the picker is stored as this id and holds none of
  // the agent's name, so the id is what finds their own service orders.
  const [userId, setUserId] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [mobileView, setMobileView] = useState<MobileView>('orders');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());

  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  // Debounce search input and trigger server-side search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setContextSearch(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]); // Only trigger when local search text changes

  // Batch all mount-time async loads into a single effect
  useEffect(() => {
    let cancelled = false;
    const initLoad = async () => {
      const [authResult, paletteResult] = await Promise.allSettled([
        AsyncStorage.getItem('authData'),
        settingsColorPaletteService.getActive(),
      ]);

      if (cancelled) return;

      if (authResult.status === 'fulfilled' && authResult.value) {
        try {
          const userData = JSON.parse(authResult.value);
          const role = userData.role || '';
          const roleId = userData.role_id ? Number(userData.role_id) : null;
          setUserRole(role);
          setUserRoleId(roleId);
          setUserEmail(userData.email || '');
          setUserFullName(userData.full_name || '');
          setUserId(userData.id ?? userData.user_id ?? null);

          if (role.toLowerCase() === 'technician' || roleId === 2 || role.toLowerCase() === 'agent' || roleId === 4) {
            // MobileView enforces 'orders' by default
          }
        } catch (error) { }
      }
      if (paletteResult.status === 'fulfilled') {
        setColorPalette(paletteResult.value);
      }
    };
    initLoad();

    const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      setColorPalette(newPalette);
    });

    return () => {
      cancelled = true;
      paletteSub.remove();
    };
  }, []);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, statusFilter]);

  const handleRefresh = useCallback(async () => {
    await refreshServiceOrders();
  }, [refreshServiceOrders]);

  // locationItems removed

  const itemExtractorMap: Record<string, (item: ServiceOrder) => string> = {
    fullName: item => item.fullName,
    fullAddress: item => item.fullAddress,
    concern: item => item.concern || '',
  };

  const filteredServiceOrders = useMemo(() => {
    const isTechnician = userRole.toLowerCase() === 'technician' || userRoleId === 2 ||
      userRole.toLowerCase() === 'agent' || userRoleId === 4;

    const isSuperUser = 
      userRoleId === 1 || userRoleId === 7 || userRoleId === 8 ||
      userRole.toLowerCase() === 'superadmin' || userRole.toLowerCase() === 'administrator' || userRole.toLowerCase() === 'headtech';

    const lowerSearch = debouncedSearch.toLowerCase();
    const isSearchEmpty = lowerSearch === '';

    // The agent's own half of the referral test, built once for the whole scan.
    const ownsReferral = createAgentReferralMatcher(userFullName, userEmail, userId);

    return serviceOrders
      .filter(serviceOrder => {
        // Hide resolved service orders for technicians
        if (!isSuperUser && isTechnician && (userRole.toLowerCase() === 'technician' || userRoleId === 2)) {
          const supportStatus = (serviceOrder.supportStatus || '').toLowerCase().trim();
          if (supportStatus === 'resolved') return false;
        }

        const matchesSearch = isSearchEmpty ||
          itemExtractorMap.fullName(serviceOrder).toLowerCase().includes(lowerSearch) ||
          itemExtractorMap.fullAddress(serviceOrder).toLowerCase().includes(lowerSearch) ||
          itemExtractorMap.concern(serviceOrder).toLowerCase().includes(lowerSearch);

        if (!matchesSearch) return false;
        
        // Status filtering
        if (statusFilter !== 'all') {
          const s = (userRole.toLowerCase() === 'technician' || userRoleId === 2) 
            ? (serviceOrder.visitStatus || '').toLowerCase().trim() 
            : (serviceOrder.supportStatus || '').toLowerCase().trim();
          
          if (statusFilter === 'done') {
            if (s !== 'completed' && s !== 'done' && s !== 'resolved') return false;
          } else if (statusFilter === 'inprogress') {
            if (s !== 'in-progress' && s !== 'in progress' && s !== 'inprogress' && s !== 'scheduled') return false;
          } else if (statusFilter === 'reschedule') {
            if (s !== 'reschedule') return false;
          } else if (statusFilter === 'failed') {
            if (s !== 'failed') return false;
          }
        }

        // Role-based filtering: Agents (role_id 4) only see their own referrals
        if (!isSuperUser && (userRole.toLowerCase() === 'agent' || userRoleId === 4)) {
          // The shared rule, not a substring test of its own: a referral is now
          // stored as the agent's user id, which contains none of their name, and
          // `includes` would also have counted "Ana" as a match for "Joana".
          // referredBy is the display name; referredByAgentId is the agent the
          // stored value names, when it names one.
          if (!ownsReferral(storedReferralOf(serviceOrder))) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const activeA = isWorkStarted(a) ? 1 : 0;
        const activeB = isWorkStarted(b) ? 1 : 0;

        if (activeA !== activeB) {
          return activeB - activeA; // Started/active ones first
        }

        const timeA = a.rawUpdatedAt ? new Date(a.rawUpdatedAt).getTime() : (a.timestamp ? new Date(a.timestamp).getTime() : 0);
        const timeB = b.rawUpdatedAt ? new Date(b.rawUpdatedAt).getTime() : (b.timestamp ? new Date(b.timestamp).getTime() : 0);
        return timeB - timeA;
      });
  }, [serviceOrders, debouncedSearch, statusFilter, userRole, userRoleId, userFullName, userEmail, userId]);

  const shouldPaginate = true; // Consistently paginate for all roles to prevent UI jumping

  const paginatedServiceOrders = useMemo(() => {
    if (!shouldPaginate) return filteredServiceOrders;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredServiceOrders.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredServiceOrders, currentPage, shouldPaginate]);

  useEffect(() => {
    const ticketIds = paginatedServiceOrders.map(order => order.id);
    console.log(`[ServiceOrder.tsx] Currently showing ${ticketIds.length} tickets:`, ticketIds);
  }, [paginatedServiceOrders]);

  const totalPages = useMemo(() => {
    if (!shouldPaginate) return 1;
    return Math.ceil(filteredServiceOrders.length / itemsPerPage);
  }, [filteredServiceOrders.length, shouldPaginate]);

  const handlePageChange = useCallback(async (newPage: number) => {
    if (newPage > totalPages && hasMore) {
      await fetchNextPage();
      setCurrentPage(newPage);
      return;
    }
    setCurrentPage(prev => {
      if (newPage >= 1 && newPage <= totalPages) return newPage;
      return prev;
    });
  }, [totalPages, hasMore, fetchNextPage]);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const handleRowClick = useCallback((serviceOrder: ServiceOrder) => {
    setSelectedServiceOrderRaw(serviceOrder);
    if (!isTablet) {
      setMobileView('details');
    }
  }, [isTablet]);



  const handleMobileBack = useCallback(() => {
    if (mobileView === 'details') {
      setSelectedServiceOrderRaw(null);
      setMobileView('orders');
    }
  }, [mobileView]);

  const handleMobileRowClick = useCallback((serviceOrder: ServiceOrder) => {
    setSelectedServiceOrderRaw(serviceOrder);
    setMobileView('details');
  }, []);

  return (
    <View style={[so.container, {
      flexDirection: isTablet ? 'row' : 'column',
      backgroundColor: '#f9fafb'
    }]}>
      {mobileMenuOpen && userRole.toLowerCase() !== 'technician' && userRole.toLowerCase() !== 'agent' && userRoleId !== 2 && userRoleId !== 4 && mobileView === 'orders' && (
        <View style={so.mobileOverlay}>
          <Pressable style={so.mobileBackdrop} onPress={() => setMobileMenuOpen(false)} />
          <View style={[so.mobileSidebar, { backgroundColor: '#ffffff' }]}>
            <View style={[so.mobileSidebarHeader, { borderColor: '#e5e7eb', padding: 16, paddingTop: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
              <Text style={[so.sidebarTitle, { color: '#111827' }]}>Filters</Text>
              <Pressable onPress={() => setMobileMenuOpen(false)}>
                <X size={24} color={'#4b5563'} />
              </Pressable>
            </View>
            <View style={{ padding: 16 }}>
              <Text style={{ color: '#6b7280' }}>No filters available</Text>
            </View>
          </View>
        </View>
      )}

      {userRole.toLowerCase() !== 'technician' && userRole.toLowerCase() !== 'agent' && isTablet && (
        <View style={[so.sidebar, {
          width: 256,
          backgroundColor: '#ffffff',
          borderColor: '#e5e7eb'
        }]}>
          <View style={[so.sidebarHeader, { borderColor: '#e5e7eb' }]}>
            <View style={so.sidebarTitleRow}>
              <Text style={[so.sidebarTitle, { color: '#111827' }]}>Service Orders</Text>
            </View>
          </View>
          <View style={{ padding: 16 }}>
            <Text style={{ color: '#6b7280' }}>No filters available</Text>
          </View>
        </View>
      )}

      <View style={[so.mainContent, {
        backgroundColor: '#ffffff',
        display: mobileView === 'details' && !isTablet ? 'none' : 'flex'
      }]}>
        <View style={so.mainInner}>
          <View style={[so.toolbar, {
            paddingTop: isTablet ? 16 : 60,
            backgroundColor: '#ffffff',
            borderColor: '#e5e7eb'
          }]}>
            <View style={so.toolbarRow}>

              <View style={so.searchWrap}>
                <TextInput
                  placeholder="Search service orders..."
                  placeholderTextColor="#6b7280"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  style={[so.searchInput, {
                    backgroundColor: '#f3f4f6',
                    color: '#111827',
                    borderColor: '#d1d5db'
                  }]}
                />
                <View style={so.searchIcon}>
                  <Search size={16} color="#6b7280" />
                </View>
              </View>
              <View style={so.actionsRow}>
                <Pressable
                  onPress={() => setShowStatusModal(true)}
                  style={[so.actionBtn, { 
                    backgroundColor: statusFilter !== 'all' ? (colorPalette?.primary || '#7c3aed') : '#f3f4f6',
                    borderWidth: statusFilter !== 'all' ? 0 : 1,
                    borderColor: '#d1d5db'
                  }]}
                >
                  <Filter size={20} color={statusFilter !== 'all' ? 'white' : '#4b5563'} />
                </Pressable>
                <Pressable
                  onPress={handleRefresh}
                  disabled={isLoading}
                  style={[so.actionBtn, { backgroundColor: isLoading ? '#4b5563' : (colorPalette?.primary || '#7c3aed') }]}
                >
                  <RefreshCw size={20} color="white" />
                </Pressable>
              </View>
            </View>
          </View>

          <View style={so.listArea}>
            {isLoading ? (
              <ScrollView
                style={so.flex1}
                refreshControl={
                  <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} tintColor={colorPalette?.primary || '#7c3aed'} colors={[colorPalette?.primary || '#7c3aed']} />
                }
              >
                <View style={so.loadingWrap}>
                  <View style={so.skeletonCol}>
                    <View style={[so.skeletonBar1, { backgroundColor: '#d1d5db' }]} />
                    <View style={[so.skeletonBar2, { backgroundColor: '#d1d5db' }]} />
                  </View>
                  <Text style={[so.loadingText, { color: '#4b5563' }]}>Loading service orders...</Text>
                </View>
              </ScrollView>
            ) : error ? (
              <ScrollView
                style={so.flex1}
                refreshControl={
                  <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} tintColor={colorPalette?.primary || '#7c3aed'} colors={[colorPalette?.primary || '#7c3aed']} />
                }
              >
                <View style={so.loadingWrap}>
                  <Text style={{ color: '#dc2626' }}>{error}</Text>
                  <Pressable onPress={handleRefresh} style={[so.retryBtn, { backgroundColor: '#9ca3af' }]}>
                    <Text style={so.retryText}>Retry</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : (
              <View style={so.flex1}>
                <FlashList
                  data={paginatedServiceOrders}
                  keyExtractor={(item) => String(item.id)}
                  refreshControl={
                    <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colorPalette?.primary || '#7c3aed'} colors={[colorPalette?.primary || '#7c3aed']} />
                  }
                  ListEmptyComponent={
                    <View style={so.emptyWrap}>
                      <Text style={{ color: '#4b5563' }}>No service orders found matching your filters</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingBottom: !isTablet ? 100 : 0 }}
                  renderItem={({ item: serviceOrder }) => (
                    <ServiceOrderCard
                      serviceOrder={serviceOrder}
                      isSelected={selectedServiceOrder?.id === serviceOrder.id}
                      onPress={!isTablet ? handleMobileRowClick : handleRowClick}
                      userRole={userRole}
                      userRoleId={userRoleId}
                    />
                  )}
                  onEndReached={() => {
                    if (!shouldPaginate && hasMore && !isFetchingNextPage) {
                      fetchNextPage();
                    }
                  }}
                  onEndReachedThreshold={0.5}
                  ListFooterComponent={
                    (!shouldPaginate && isFetchingNextPage) ? (
                      <View style={{ padding: 20, alignItems: 'center' }}>
                        <Text style={{ color: '#6b7280' }}>Loading more...</Text>
                      </View>
                    ) : null
                  }
                />
              </View>
            )}
          </View>

          {!isLoading && shouldPaginate && filteredServiceOrders.length > 0 && (
            <View style={[so.paginationBar, {
              flexDirection: isTablet ? 'row' : 'column',
              justifyContent: isTablet ? 'space-between' : 'center',
              gap: isTablet ? 0 : 12,
              backgroundColor: '#ffffff',
              borderColor: '#e5e7eb',
              paddingBottom: !isTablet ? 110 : 16
            }]}>
              <View>
                <Text style={[so.paginationInfo, { color: '#4b5563' }]}>
                  Showing <Text style={so.bold500}>{(currentPage - 1) * itemsPerPage + 1}</Text> to <Text style={so.bold500}>{Math.min(currentPage * itemsPerPage, filteredServiceOrders.length)}</Text> of <Text style={so.bold500}>{filteredServiceOrders.length}</Text> results
                </Text>
              </View>
              <View style={so.paginationBtns}>
                <Pressable
                  onPress={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  style={[so.pageBtn, {
                    backgroundColor: currentPage === 1 ? '#f3f4f6' : '#ffffff',
                    borderWidth: currentPage === 1 ? 0 : 1, borderColor: '#d1d5db'
                  }]}
                >
                  <Text style={[so.pageBtnText, {
                    color: currentPage === 1 ? '#9ca3af' : '#374151',
                    fontSize: 18,
                    fontWeight: 'bold'
                  }]}>{"<"}</Text>
                </Pressable>

                <View style={so.pageIndicatorWrap}>
                  <Text style={[so.pageIndicator, { color: '#111827' }]}>Page {currentPage} of {totalPages}{hasMore ? '+' : ''}</Text>
                </View>

                <Pressable
                  onPress={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages && !hasMore}
                  style={[so.pageBtn, {
                    backgroundColor: (currentPage === totalPages && !hasMore) ? '#f3f4f6' : '#ffffff',
                    borderWidth: (currentPage === totalPages && !hasMore) ? 0 : 1, borderColor: '#d1d5db'
                  }]}
                >
                  <Text style={[so.pageBtnText, {
                    color: (currentPage === totalPages && !hasMore) ? '#9ca3af' : '#374151',
                    fontSize: 18,
                    fontWeight: 'bold'
                  }]}>{">"}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>

      {
        selectedServiceOrder && mobileView === 'details' && (
          <View style={[so.mobileDetail, {
            backgroundColor: '#f9fafb',
            display: isTablet ? 'none' : 'flex'
          }]}>
            <ServiceOrderDetails
              serviceOrder={selectedServiceOrder as ServiceOrder}
              onClose={handleMobileBack}
              isMobile={true}
              userRoleProp={userRole}
              userRoleIdProp={userRoleId === null ? null : Number(userRoleId)}
            />
          </View>
        )
      }

      {
        selectedServiceOrder && mobileView !== 'details' && (
          <View style={[so.tabletDetail, { display: isTablet ? 'flex' : 'none' }]}>
            <ServiceOrderDetails
              serviceOrder={selectedServiceOrder as ServiceOrder}
              onClose={() => setSelectedServiceOrderRaw(null)}
              isMobile={false}
              userRoleProp={userRole}
              userRoleIdProp={userRoleId === null ? null : Number(userRoleId)}
            />
          </View>
        )
      }

      <Modal
        visible={showStatusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <Pressable style={so.statusModalOverlay} onPress={() => setShowStatusModal(false)}>
          <View style={so.statusModalContent}>
            <View style={so.statusModalHeader}>
              <Text style={so.statusModalTitle}>Filter by Status</Text>
            </View>
            {[
              { label: 'All Status', value: 'all' },
              { label: 'Done', value: 'done' },
              { label: 'In Progress', value: 'inprogress' },
              { label: 'Reschedule', value: 'reschedule' },
              { label: 'Failed', value: 'failed' }
            ].map((item) => (
              <Pressable
                key={item.value}
                style={so.statusItem}
                onPress={() => {
                  setStatusFilter(item.value);
                  setShowStatusModal(false);
                }}
              >
                <Text style={[so.statusItemText, statusFilter === item.value && { color: colorPalette?.primary || '#7c3aed', fontWeight: '700' }]}>
                  {item.label}
                </Text>
                {statusFilter === item.value && <Check size={18} color={colorPalette?.primary || '#7c3aed'} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

    </View >
  );
};

export default ServiceOrderPage;
