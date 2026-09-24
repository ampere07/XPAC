import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Dimensions, DeviceEventEmitter, RefreshControl, StyleSheet, Modal } from 'react-native';
import { Search, ListFilter, Menu, X, ArrowLeft, RefreshCw, LogOut, Filter, Check } from 'lucide-react-native';
import { FlashList } from '@shopify/flash-list';
import AsyncStorage from '@react-native-async-storage/async-storage';
import JobOrderDetails from '../components/JobOrderDetails';
import JobOrderFunnelFilter, { FilterValues } from '../components/filters/JobOrderFunnelFilter';
import { useJobOrderContext } from '../contexts/JobOrderContext';
import { getBillingStatuses, BillingStatus } from '../services/lookupService';
import { JobOrder } from '../types/jobOrder';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { techInOutService } from '../services/techInOutService';
import TimeInOutModal from '../modals/TimeInOutModal';
import { agentJobOrderBand, createAgentReferralMatcher, storedReferralOf } from '../utils/agentReferral';


const StatusText = React.memo(({ status, type }: { status?: string | null, type: 'onsite' | 'billing' }) => {
  if (!status) return <Text style={{ color: '#9ca3af' }}>-</Text>;

  let textColor = '';

  if (type === 'onsite') {
    switch (status.toLowerCase()) {
      case 'done':
      case 'completed':
        textColor = '#4ade80';
        break;
      // Purple (purple-400), not blue: sharing blue with "In Progress" made
      // the two indistinguishable in the list.
      case 'reschedule':
        textColor = '#c084fc';
        break;
      case 'inprogress':
      case 'in progress':
        textColor = '#60a5fa';
        break;
      case 'pending':
        textColor = '#fb923c';
        break;
      case 'failed':
      case 'cancelled':
        textColor = '#ef4444';
        break;
      default:
        textColor = '#9ca3af';
    }
  } else {
    switch (status.toLowerCase()) {
      case 'done':
      case 'active':
      case 'completed':
      case 'paid':
        textColor = '#4ade80';
        break;
      case 'pending':
      case 'in progress':
        textColor = '#fb923c';
        break;
      case 'suspended':
      case 'overdue':
      case 'unpaid':
      case 'cancelled':
        textColor = '#ef4444';
        break;
      default:
        textColor = '#9ca3af';
    }
  }

  return (
    <Text style={{ fontWeight: 'bold', textTransform: 'uppercase', color: textColor }}>
      {status === 'inprogress' ? 'In Progress' : status}
    </Text>
  );
});

const jo = StyleSheet.create({
  container: { height: '100%', overflow: 'hidden' },
  // Mobile overlay
  mobileOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  mobileBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  mobileSidebar: { position: 'absolute', top: 0, left: 0, bottom: 0, width: 256, flexDirection: 'column' },
  mobileSidebarHeader: { padding: 16, paddingTop: 60, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Sidebar
  sidebar: { borderRightWidth: 1, flexShrink: 0, flexDirection: 'column', position: 'relative' },
  sidebarHeaderBox: { padding: 16, borderBottomWidth: 1, flexShrink: 0 },
  sidebarTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  sidebarTitle: { fontSize: 18, fontWeight: '600' },
  pad16: { padding: 16 },
  // Main content
  mainContent: { overflow: 'hidden', flex: 1, flexDirection: 'column' },
  mainInner: { flexDirection: 'column', height: '100%' },
  // Toolbar
  toolbar: { padding: 16, borderBottomWidth: 1, flexShrink: 0 },
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
  flex1: { flex: 1 },
  // Loading
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
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: '#ffffff', borderRadius: 24, padding: 32, width: '100%', maxWidth: 400, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 15, elevation: 10 },
  modalIconContainer: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 12, textAlign: 'center' },
  modalMessage: { fontSize: 16, color: '#4b5563', textAlign: 'center', marginBottom: 32, lineHeight: 24 },
  reloginButton: { paddingVertical: 16, paddingHorizontal: 32, borderRadius: 16, width: '100%', alignItems: 'center', shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  reloginButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  // Status Modal
  statusModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  statusModalContent: { width: '80%', backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
  statusModalHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', alignItems: 'center' },
  statusModalTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  statusItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusItemText: { fontSize: 14, color: '#374151' },
});

// Move utility functions outside components to avoid recreation
const formatDate = (dateStr?: string | null): string => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    const datePart = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${datePart} ${timePart}`;
  } catch (e) {
    return '-';
  }
};

const checkIsStarted = (time?: string | null) => {
  if (!time) return false;
  const lowerTime = String(time).toLowerCase().trim();
  return !['0000-00-00 00:00:00', 'not set', '-', 'none', '', 'null', 'undefined'].includes(lowerTime);
};

const isWorkStarted = (item: JobOrder) => {
  const hasStart = checkIsStarted(item.start_time) || checkIsStarted(item.StartTimeStamp) || checkIsStarted(item.start_timestamp);
  const hasEnd = checkIsStarted(item.end_time) || checkIsStarted(item.EndTimeStamp) || checkIsStarted(item.end_timestamp);
  
  return hasStart && !hasEnd;
};

const formatPrice = (price?: number | null): string => {
  if (price === null || price === undefined || price === 0) return '-';
  return `₱${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const getClientFullName = (jobOrder: JobOrder): string => {
  return [
    jobOrder.First_Name || jobOrder.first_name || '',
    jobOrder.Middle_Initial || jobOrder.middle_initial ? (jobOrder.Middle_Initial || jobOrder.middle_initial) + '.' : '',
    jobOrder.Last_Name || jobOrder.last_name || ''
  ].filter(Boolean).join(' ').trim() || '-';
};

const getClientFullAddress = (jobOrder: JobOrder): string => {
  const addressParts = [
    jobOrder.Installation_Address || jobOrder.installation_address || jobOrder.Address || jobOrder.address,
    jobOrder.Barangay || jobOrder.barangay,
    jobOrder.City || jobOrder.city,
    jobOrder.Region || jobOrder.region
  ].filter(Boolean);

  return addressParts.length > 0 ? addressParts.join(', ') : '-';
};

const itemExtractorMap: Record<string, (item: JobOrder) => any> = {
  id: item => item.id,
  application_id: item => item.application_id,
  timestamp: item => item.Timestamp || item.timestamp,
  date_installed: item => item.Date_Installed || item.date_installed,
  installation_fee: item => item.Installation_Fee || item.installation_fee,
  billing_day: item => item.Billing_Day || item.billing_day,
  billing_status_id: item => item.billing_status_id || item.Billing_Status_ID,
  modem_router_sn: item => item.Modem_Router_SN || item.modem_router_sn,
  router_model: item => item.Router_Model || item.router_model,
  group_name: item => item.group_name || item.Group_Name,
  lcpnap: item => item.LCPNAP || item.lcpnap,
  port: item => item.PORT || item.Port || item.port,
  vlan: item => item.VLAN || item.vlan,
  username: item => item.Username || item.username,
  ip_address: item => item.IP_Address || item.ip_address || item.IP || item.ip,
  connection_type: item => item.Connection_Type || item.connection_type,
  usage_type: item => item.Usage_Type || item.usage_type,
  username_status: item => item.username_status || item.Username_Status,
  visit_by: item => item.Visit_By || item.visit_by,
  visit_with: item => item.Visit_With || item.visit_with,
  visit_with_other: item => item.Visit_With_Other || item.visit_with_other,
  onsite_status: item => item.Onsite_Status || item.onsite_status,
  onsite_remarks: item => item.Onsite_Remarks || item.onsite_remarks,
  status_remarks: item => item.Status_Remarks || item.status_remarks,
  address_coordinates: item => item.Address_Coordinates || item.address_coordinates,
  contract_link: item => item.Contract_Link || item.contract_link,
  client_signature_url: item => item.client_signature_url || item.Client_Signature_URL || item.client_signature_image_url || item.Client_Signature_Image_URL,
  setup_image_url: item => item.setup_image_url || item.Setup_Image_URL || item.Setup_Image_Url,
  speedtest_image_url: item => item.speedtest_image_url || item.Speedtest_Image_URL || item.speedtest_image || item.Speedtest_Image,
  signed_contract_image_url: item => item.signed_contract_image_url || item.Signed_Contract_Image_URL || item.signed_contract_url || item.Signed_Contract_URL,
  box_reading_image_url: item => item.box_reading_image_url || item.Box_Reading_Image_URL || item.box_reading_url || item.Box_Reading_URL,
  router_reading_image_url: item => item.router_reading_image_url || item.Router_Reading_Image_URL || item.router_reading_url || item.Router_Reading_URL,
  port_label_image_url: item => item.port_label_image_url || item.Port_Label_Image_URL || item.port_label_url || item.Port_Label_URL,
  house_front_picture_url: item => item.house_front_picture_url || item.House_Front_Picture_URL || item.house_front_picture || item.House_Front_Picture,
  created_at: item => item.created_at || item.Created_At,
  created_by_user_email: item => item.created_by_user_email || item.Created_By_User_Email,
  updated_at: item => item.updated_at || item.Updated_At,
  updated_by_user_email: item => item.updated_by_user_email || item.Updated_By_User_Email,
  assigned_email: item => item.Assigned_Email || item.assigned_email,
  pppoe_username: item => item.PPPoE_Username || item.pppoe_username,
  pppoe_password: item => item.PPPoE_Password || item.pppoe_password,
  full_name: item => getClientFullName(item),
  address: item => getClientFullAddress(item),
  contract_template: item => item.Contract_Template || item.contract_template,
  first_name: item => item.First_Name || item.first_name,
  middle_initial: item => item.Middle_Initial || item.middle_initial,
  last_name: item => item.Last_Name || item.last_name,
  contact_number: item => item.Contact_Number || item.Mobile_Number || item.contact_number || item.mobile_number,
  second_contact_number: item => item.Second_Contact_Number || item.Secondary_Mobile_Number || item.second_contact_number || item.secondary_mobile_number,
  email_address: item => item.Email_Address || item.Applicant_Email_Address || item.email_address || item.applicant_email_address,
  region: item => item.Region || item.region,
  city: item => item.City || item.city,
  barangay: item => item.Barangay || item.barangay,
  location: item => item.Region || item.region,
  choose_plan: item => item.Choose_Plan || item.Desired_Plan || item.choose_plan || item.desired_plan,
  referred_by: item => item.Referred_By || item.referred_by,
  start_timestamp: item => item.StartTimeStamp || item.start_timestamp,
  end_timestamp: item => item.EndTimeStamp || item.end_timestamp,
  duration: item => item.Duration || item.duration,
};

const JobOrderCard = React.memo(({
  jobOrder,
  isSelected,
  onPress,
  userRole,
  userRoleId
}: {
  jobOrder: JobOrder;
  isSelected: boolean;
  onPress: (jo: JobOrder) => void;
  userRole: string;
  userRoleId: number | null;
}) => {
  const isAgent = userRole.toLowerCase() === 'agent' || userRoleId === 4;
  const displayStatus = jobOrder.Onsite_Status || jobOrder.onsite_status;
  const displayType = 'onsite';

  return (
    <Pressable
      onPress={() => onPress(jobOrder)}
      style={[jo.cardRow, {
        backgroundColor: isSelected ? '#f3f4f6' : 'transparent',
        borderColor: '#e5e7eb'
      }]}
    >
      <View style={jo.cardInner}>
        <View style={jo.cardLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
            <Text style={[jo.cardName, { color: '#111827', marginBottom: 0 }]}>
              {getClientFullName(jobOrder)}
            </Text>
            {isWorkStarted(jobOrder) && (
              <View style={{ backgroundColor: '#dcfce7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: '#15803d', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' }}>
                  Work Started
                </Text>
              </View>
            )}
          </View>
          <Text style={[jo.cardSub, { color: '#4b5563' }]} numberOfLines={2}>
            {formatDate(jobOrder.Timestamp || jobOrder.timestamp)} | {getClientFullAddress(jobOrder)}
          </Text>
          <Text style={[jo.cardSub, { color: '#6b7280', marginTop: 4 }]}>
            Fee: {formatPrice(jobOrder.Installation_Fee || jobOrder.installation_fee)}
          </Text>
        </View>
        <View style={jo.cardRight}>
          <StatusText status={displayStatus} type={displayType} />
        </View>
      </View>
    </Pressable>
  );
});

const JobOrderPage: React.FC<{ onLogout?: () => void }> = ({ onLogout }) => {

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showStatusModal, setShowStatusModal] = useState<boolean>(false);
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrder | null>(null);
  const { jobOrders, isLoading, error, refreshJobOrders, silentRefresh } = useJobOrderContext();
  const [billingStatuses, setBillingStatuses] = useState<BillingStatus[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [mobileView, setMobileView] = useState<'orders' | 'details'>('orders');
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState<boolean>(false);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
  const [showReloginModal, setShowReloginModal] = useState<boolean>(false);
  const [showTimeModal, setShowTimeModal] = useState<boolean>(false);
  const [authUserData, setAuthUserData] = useState<any>(null);


  // Watch for 401 error to show relogin modal
  useEffect(() => {
    if (error && (error.includes('401') || error.toLowerCase().includes('unauthorized'))) {
      setShowReloginModal(true);
    }
  }, [error]);

  const handleRelogin = useCallback(() => {
    setShowReloginModal(false);
    if (onLogout) {
      onLogout();
    }
  }, [onLogout]);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const handleApplyFilters = useCallback((filters: FilterValues) => {
    setFilterValues(filters);
    setCurrentPage(1);
    setIsFunnelFilterOpen(false);
  }, []);

  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  // Debounce search input to avoid recomputing heavy filter on every keystroke
  const [userEmail, setUserEmail] = useState<string>('');
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [userFullName, setUserFullName] = useState<string>('');
  // A referral made through the picker is stored as this id and holds none of
  // the agent's name, so the id is what finds their own job orders.
  const [userId, setUserId] = useState<number | null>(null);
  /**
   * True once the signed-in user has been read from storage.
   *
   * Storage is asynchronous here, so the first render has no identity. Without
   * this gate the role-based filter below sees no role, treats the viewer as
   * unrestricted, and paints every job order in the organisation for a moment
   * before replacing it with the agent's own. Nothing is listed until it is set.
   */
  const [identityReady, setIdentityReady] = useState(false);

  // Debounce search input to avoid recomputing heavy filter on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    silentRefresh();
  }, [silentRefresh]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refreshJobOrders();
    setIsRefreshing(false);
  }, [refreshJobOrders]);



  // Batch all mount-time async loads into a single effect
  useEffect(() => {
    let cancelled = false;
    const initLoad = async () => {
      // The palette and billing statuses are network calls; they are started
      // now but NOT waited on before the identity is known, so the list (which
      // is gated on identityReady below) is not held empty for every role until
      // both requests settle.
      const othersPromise = Promise.allSettled([
        settingsColorPaletteService.getActive(),
        getBillingStatuses(),
      ]);
      const [authResult] = await Promise.allSettled([AsyncStorage.getItem('authData')]);

      if (cancelled) return;

      if (authResult.status === 'fulfilled' && authResult.value) {
        try {
          const userData = JSON.parse(authResult.value);
          setAuthUserData(userData);
          const rName = userData.role || '';
          setUserRole(rName);
          setUserEmail(userData.email || '');
          const rId = userData.role_id ? Number(userData.role_id) : null;
          setUserRoleId(rId);
          setUserFullName(userData.full_name || '');
          setUserId(userData.id ?? userData.user_id ?? null);

          // Check time in status for technicians
          const isTech = rId === 2 || rName.toLowerCase() === 'technician';
          if (isTech) {
            const userId = userData.id || userData.user_id || userData.user?.id;
            if (userId) {
              techInOutService.getStatus(userId).then(statusRes => {
                if (statusRes.success) {
                  const s = statusRes.data;
                  if (!s?.time_in || !!s?.time_out) {
                    setShowTimeModal(true);
                  }
                }
              }).catch(err => console.error('[JobOrder] Status check failed:', err));
            }
          }
        } catch (error) { }
      }

      // Set whether or not the read succeeded: a viewer whose identity cannot be
      // determined is treated as having no role, which shows nothing rather than
      // leaving the list stuck behind the gate for ever.
      setIdentityReady(true);

      const [paletteResult, billingResult] = await othersPromise;
      if (cancelled) return;

      if (paletteResult.status === 'fulfilled') {
        setColorPalette(paletteResult.value);
      }
      if (billingResult.status === 'fulfilled') {
        setBillingStatuses(billingResult.value);
      }
    };
    initLoad();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('jobOrderUpdated', () => {
      setSelectedJobOrder(null);
      setMobileView('orders');
      refreshJobOrders();
    });

    const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      setColorPalette(newPalette);
    });
    
    return () => {
      subscription.remove();
      paletteSub.remove();
    };
  }, [refreshJobOrders]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, statusFilter, filterValues]);

  const handleMobileRowClick = useCallback((jobOrder: JobOrder) => {
    setSelectedJobOrder(jobOrder);
    setMobileView('details');
  }, []);

  const handleRowClick = useCallback((jobOrder: JobOrder) => {
    setSelectedJobOrder(jobOrder);
    if (width >= 768) {
      setMobileView('orders');
    }
  }, [width]);





  const filteredJobOrders = useMemo(() => {
    // Nothing is listed until the signed-in user is known, so a restricted role
    // never sees records it is not entitled to, even for a single frame.
    if (!identityReady) return [];

    const lowerSearch = debouncedSearch.toLowerCase();

    // An agent with neither name nor email nor id must see nothing, never
    // everyone's job orders.
    const agentKnowsWhoTheyAre = Boolean(userFullName) || Boolean(userEmail) || userId !== null;
    const ownsReferral = createAgentReferralMatcher(userFullName, userEmail, userId);

    return jobOrders.filter(jobOrder => {
      const fullName = getClientFullName(jobOrder).toLowerCase();
      const matchesSearch = debouncedSearch === '' ||
        fullName.includes(lowerSearch) ||
        ((jobOrder.Address || jobOrder.address) || '').toLowerCase().includes(lowerSearch) ||
        ((jobOrder.Assigned_Email || jobOrder.assigned_email) || '').toLowerCase().includes(lowerSearch);

      if (!matchesSearch) return false;

      const isSuperUser = 
        userRoleId === 1 || userRoleId === 7 || userRoleId === 8 ||
        userRole.toLowerCase() === 'superadmin' || userRole.toLowerCase() === 'administrator' || userRole.toLowerCase() === 'headtech';

      // Role-based filtering: Agents (role_id 4) only see their own referrals.
      //
      // An agent sees every referral they own, however long ago it was raised —
      // there is no date cut-off, and finished ones are kept rather than
      // dropped: they read at the bottom of the list (see sortedJobOrders) so
      // the work still in flight leads.
      if (!isSuperUser && (userRole.toLowerCase() === 'agent' || userRoleId === 4)) {
        if (!agentKnowsWhoTheyAre) return false;
        // Referred_By is the display name; the stored value (an agent id for
        // picker-made referrals) is what decides ownership.
        if (!ownsReferral(storedReferralOf(jobOrder))) return false;
      }

      // Hide job orders with onsite status "done", "completed", or "failed" after 1 day
      // Only applicable for technicians
      if (!isSuperUser && debouncedSearch === '') {
        const isTechnician = userRole.toLowerCase() === 'technician' || userRoleId === 2;
        if (isTechnician) {
          const onsiteStatus = (jobOrder.Onsite_Status || jobOrder.onsite_status || '').toLowerCase().trim();
          if (onsiteStatus === 'done' || onsiteStatus === 'completed' || onsiteStatus === 'failed') {
            // Use updated_at or EndTimeStamp to determine when it was completed
            const completionTime = jobOrder.Updated_At || jobOrder.updated_at || jobOrder.EndTimeStamp || jobOrder.end_timestamp;
            if (completionTime) {
              const completionDate = new Date(completionTime);
              const today = new Date();
              const isToday = completionDate.getFullYear() === today.getFullYear() &&
                completionDate.getMonth() === today.getMonth() &&
                completionDate.getDate() === today.getDate();

              if (!isToday) return false;
            }
          }
        }
      }

      // Status filtering
      if (statusFilter !== 'all') {
        const s = (jobOrder.Onsite_Status || jobOrder.onsite_status || '').toLowerCase().trim();
        if (statusFilter === 'pending') {
          if (s !== 'pending') return false;
        } else if (statusFilter === 'inprogress') {
          if (s !== 'inprogress' && s !== 'in progress' && s !== 'in-progress') return false;
        } else if (statusFilter === 'done') {
          if (s !== 'done' && s !== 'completed') return false;
        } else if (statusFilter === 'reschedule') {
          // The column is free text and all three spellings are in the data;
          // matching only 'reschedule' would hide the rest of the same status.
          if (s !== 'reschedule' && s !== 'rescheduled' && s !== 're-schedule') return false;
        } else if (statusFilter === 'cancelled') {
          if (s !== 'cancelled') return false;
        } else if (statusFilter === 'failed') {
          if (s !== 'failed') return false;
        }
      }

      // Apply funnel filters
      for (const key in filterValues) {
        const filter = filterValues[key];
        const extractor = itemExtractorMap[key];
        if (!extractor) continue;

        const itemValue = extractor(jobOrder);

        if (filter.type === 'text' && filter.value) {
          if (!String(itemValue || '').toLowerCase().includes(filter.value.toLowerCase())) {
            return false;
          }
        } else if (filter.type === 'number') {
          const numValue = parseFloat(itemValue);
          if (filter.from !== undefined && numValue < Number(filter.from)) return false;
          if (filter.to !== undefined && numValue > Number(filter.to)) return false;
        } else if (filter.type === 'date') {
          const dateValue = new Date(itemValue).getTime();
          if (filter.from && dateValue < new Date(String(filter.from)).getTime()) return false;
          if (filter.to && dateValue > new Date(String(filter.to)).getTime()) return false;
        }
      }

      return true;
    });
  }, [jobOrders, debouncedSearch, statusFilter, identityReady, userRole, userRoleId, userFullName, userEmail, userId, authUserData, filterValues, getClientFullName, getClientFullAddress]);

  const isAgentViewer = useMemo(
    () => userRole.toLowerCase() === 'agent' || userRoleId === 4,
    [userRole, userRoleId]
  );

  const sortedJobOrders = useMemo(() => {
    // An agent reads their referrals by status band — In Progress first, then
    // Reschedule, then Failed, with Done last — and newest first inside each
    // band, so the visits still happening lead and the finished installations
    // sit at the bottom. The started-first rule below is deliberately not
    // applied: it reorders an agent's list for a reason unrelated to them.
    if (isAgentViewer) {
      return [...filteredJobOrders].sort((a, b) => {
        const bandA = agentJobOrderBand(a);
        const bandB = agentJobOrderBand(b);
        if (bandA !== bandB) return bandA - bandB;

        return (parseInt(String(b.id), 10) || 0) - (parseInt(String(a.id), 10) || 0);
      });
    }

    return [...filteredJobOrders].sort((a, b) => {
      const activeA = isWorkStarted(a) ? 1 : 0;
      const activeB = isWorkStarted(b) ? 1 : 0;

      if (activeA !== activeB) {
        return activeB - activeA; // Started/active ones first
      }

      const idA = parseInt(String(a.id)) || 0;
      const idB = parseInt(String(b.id)) || 0;
      return idB - idA;
    });
  }, [filteredJobOrders, isAgentViewer]);

  const shouldPaginate = true; // Consistently paginate for all roles to prevent UI jumping

  const paginatedJobOrders = useMemo(() => {
    if (!shouldPaginate) return sortedJobOrders;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedJobOrders.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedJobOrders, currentPage, shouldPaginate]);

  const totalPages = useMemo(() => {
    if (!shouldPaginate) return 1;
    return Math.ceil(sortedJobOrders.length / itemsPerPage);
  }, [sortedJobOrders.length, shouldPaginate]);

  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(prev => {
      const maxPage = totalPages;
      if (newPage >= 1 && newPage <= maxPage) return newPage;
      return prev;
    });
  }, [totalPages]);

  const handleMobileBack = useCallback(() => {
    if (mobileView === 'details') {
      setSelectedJobOrder(null);
      setMobileView('orders');
    }
  }, [mobileView]);


  return (
    <View style={[jo.container, {
      flexDirection: isTablet ? 'row' : 'column',
      backgroundColor: '#f9fafb'
    }]}>


      {mobileMenuOpen && userRole.toLowerCase() !== 'technician' && userRole.toLowerCase() !== 'agent' && userRoleId !== 2 && userRoleId !== 4 && mobileView === 'orders' && (
        <View style={jo.mobileOverlay}>
          <Pressable style={jo.mobileBackdrop} onPress={() => setMobileMenuOpen(false)} />
          <View style={[jo.mobileSidebar, { backgroundColor: '#ffffff' }]}>
            <View style={[jo.mobileSidebarHeader, { borderColor: '#e5e7eb' }]}>
              <Text style={[jo.sidebarTitle, { color: '#111827' }]}>Filters</Text>
              <Pressable onPress={() => setMobileMenuOpen(false)}>
                <X size={24} color={'#4b5563'} />
              </Pressable>
            </View>
            <View style={jo.pad16}>
              <Text style={{ color: '#6b7280' }}>No filters available</Text>
            </View>
          </View>
        </View>
      )}

      {userRole.toLowerCase() !== 'technician' && userRole.toLowerCase() !== 'agent' && isTablet && (
        <View style={[jo.sidebar, {
          width: 256,
          backgroundColor: '#ffffff',
          borderColor: '#e5e7eb'
        }]}>
          <View style={[jo.sidebarHeaderBox, { borderColor: '#e5e7eb' }]}>
            <View style={jo.sidebarTitleRow}>
              <Text style={[jo.sidebarTitle, { color: '#111827' }]}>Job Orders</Text>
            </View>
          </View>
          <View style={jo.pad16}>
            <Text style={{ color: '#6b7280' }}>No filters available</Text>
          </View>
        </View>
      )}

      <View style={[jo.mainContent, {
        backgroundColor: '#ffffff',
        display: mobileView === 'details' && !isTablet ? 'none' : 'flex'
      }]}>
        <View style={jo.mainInner}>
          <View style={[jo.toolbar, {
            paddingTop: isTablet ? 16 : 60,
            backgroundColor: '#ffffff',
            borderColor: '#e5e7eb'
          }]}>
            <View style={jo.toolbarRow}>

              <View style={jo.searchWrap}>
                <TextInput
                  placeholder="Search job orders..."
                  placeholderTextColor={'#6b7280'}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  style={[jo.searchInput, {
                    backgroundColor: '#f3f4f6',
                    color: '#111827',
                    borderColor: '#d1d5db'
                  }]}
                />
                <View style={jo.searchIcon}>
                  <Search size={16} color={'#6b7280'} />
                </View>
              </View>
              <View style={jo.actionsRow}>
                <Pressable
                  onPress={() => setShowStatusModal(true)}
                  style={[jo.actionBtn, { 
                    backgroundColor: statusFilter !== 'all' ? (colorPalette?.primary || '#7c3aed') : '#f3f4f6',
                    borderWidth: statusFilter !== 'all' ? 0 : 1,
                    borderColor: '#d1d5db'
                  }]}
                >
                  <Filter size={20} color={statusFilter !== 'all' ? 'white' : '#4b5563'} />
                </Pressable>
                <Pressable
                  onPress={handleRefresh}
                  disabled={isRefreshing}
                  style={[jo.actionBtn, { backgroundColor: isRefreshing ? '#4b5563' : (colorPalette?.primary || '#7c3aed') }]}
                >
                  <RefreshCw size={20} color="white" />
                </Pressable>
              </View>
            </View>
          </View>

          <View style={jo.listArea}>
            {isLoading ? (
              <ScrollView
                style={jo.flex1}
                refreshControl={
                  <RefreshControl
                    refreshing={isRefreshing}
                    onRefresh={handleRefresh}
                    tintColor={colorPalette?.primary || '#7c3aed'}
                    colors={[colorPalette?.primary || '#7c3aed']}
                  />
                }
              >
                <View style={jo.loadingWrap}>
                  <View style={jo.skeletonCol}>
                    <View style={[jo.skeletonBar1, { backgroundColor: '#d1d5db' }]} />
                    <View style={[jo.skeletonBar2, { backgroundColor: '#d1d5db' }]} />
                  </View>
                  <Text style={[jo.loadingText, { color: '#4b5563' }]}>Loading job orders...</Text>
                </View>
              </ScrollView>
            ) : error ? (
              <ScrollView
                style={jo.flex1}
                refreshControl={
                  <RefreshControl
                    refreshing={isRefreshing}
                    onRefresh={handleRefresh}
                    tintColor={colorPalette?.primary || '#7c3aed'}
                    colors={[colorPalette?.primary || '#7c3aed']}
                  />
                }
              >
                <View style={jo.loadingWrap}>
                  <Text style={{ color: '#dc2626' }}>{error}</Text>
                  <Pressable
                    onPress={() => Alert.alert('Retry', 'Reload the application')}
                    style={[jo.retryBtn, { backgroundColor: '#9ca3af' }]}
                  >
                    <Text style={jo.retryText}>Retry</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : (
              <View style={jo.flex1}>
                <FlashList
                  data={paginatedJobOrders}
                  keyExtractor={(item) => String(item.id)}
                  refreshControl={
                    <RefreshControl
                      refreshing={isRefreshing}
                      onRefresh={handleRefresh}
                      tintColor={colorPalette?.primary || '#7c3aed'}
                      colors={[colorPalette?.primary || '#7c3aed']}
                    />
                  }
                  ListEmptyComponent={
                    <View style={jo.emptyWrap}>
                      <Text style={{ color: '#4b5563' }}>No job orders found matching your filters</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingBottom: !isTablet ? 100 : 0 }}
                  renderItem={({ item: jobOrder }) => (
                    <JobOrderCard
                      jobOrder={jobOrder}
                      isSelected={selectedJobOrder?.id === jobOrder.id}
                      onPress={!isTablet ? handleMobileRowClick : handleRowClick}
                      userRole={userRole}
                      userRoleId={userRoleId}
                    />
                  )}
                />
              </View>
            )}
          </View>

          {!isLoading && shouldPaginate && sortedJobOrders.length > 0 && (
            <View style={[jo.paginationBar, {
              flexDirection: isTablet ? 'row' : 'column',
              justifyContent: isTablet ? 'space-between' : 'center',
              gap: isTablet ? 0 : 12,
              backgroundColor: '#ffffff',
              borderColor: '#e5e7eb',
              paddingBottom: !isTablet ? 110 : 16
            }]}>
              <View>
                <Text style={[jo.paginationInfo, { color: '#4b5563' }]}>
                  Showing <Text style={jo.bold500}>{(currentPage - 1) * itemsPerPage + 1}</Text> to <Text style={jo.bold500}>{Math.min(currentPage * itemsPerPage, sortedJobOrders.length)}</Text> of <Text style={jo.bold500}>{sortedJobOrders.length}</Text> results
                </Text>
              </View>
              <View style={jo.paginationBtns}>
                <Pressable
                  onPress={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  style={[jo.pageBtn, {
                    backgroundColor: currentPage === 1 ? '#f3f4f6' : '#ffffff',
                    borderWidth: currentPage === 1 ? 0 : 1,
                    borderColor: '#d1d5db'
                  }]}
                >
                  <Text style={[jo.pageBtnText, {
                    color: currentPage === 1 ? '#9ca3af' : '#374151',
                    fontSize: 18,
                    fontWeight: 'bold'
                  }]}>{"<"}</Text>
                </Pressable>

                <View style={jo.pageIndicatorWrap}>
                  <Text style={[jo.pageIndicator, { color: '#111827' }]}>
                    Page {currentPage} of {totalPages}
                  </Text>
                </View>

                <Pressable
                  onPress={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  style={[jo.pageBtn, {
                    backgroundColor: currentPage === totalPages ? '#f3f4f6' : '#ffffff',
                    borderWidth: currentPage === totalPages ? 0 : 1,
                    borderColor: '#d1d5db'
                  }]}
                >
                  <Text style={[jo.pageBtnText, {
                    color: currentPage === totalPages ? '#9ca3af' : '#374151',
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
        selectedJobOrder && mobileView === 'details' && (
          <View style={[jo.mobileDetail, {
            backgroundColor: '#f9fafb',
            display: isTablet ? 'none' : 'flex'
          }]}>
            <JobOrderDetails
              jobOrder={selectedJobOrder as JobOrder}
              onClose={handleMobileBack}
              onRefresh={refreshJobOrders}
              isMobile={true}
              userRoleProp={userRole}
              userRoleIdProp={userRoleId}
              billingStatusesProp={billingStatuses}
            />
          </View>
        )
      }

      {
        selectedJobOrder && (mobileView !== 'details' || isTablet) && (
          <View style={[jo.tabletDetail, { display: isTablet ? 'flex' : 'none' }]}>
            <JobOrderDetails
              jobOrder={selectedJobOrder as JobOrder}
              onClose={() => setSelectedJobOrder(null)}
              onRefresh={refreshJobOrders}
              isMobile={false}
              userRoleProp={userRole}
              userRoleIdProp={userRoleId}
              billingStatusesProp={billingStatuses}
            />
          </View>
        )
      }

      <JobOrderFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={handleApplyFilters}
        currentFilters={filterValues}
      />

      <Modal
        transparent
        visible={showReloginModal}
        animationType="fade"
        statusBarTranslucent
      >
        <View style={jo.modalOverlay}>
          <View style={jo.modalContent}>
            <View style={jo.modalIconContainer}>
              <LogOut size={48} color="#ef4444" />
            </View>
            <Text style={jo.modalTitle}>Session Expired</Text>
            <Text style={jo.modalMessage}>
              Your session has expired or is invalid. Please log in again to securely access your account.
            </Text>
            <Pressable
              onPress={handleRelogin}
              style={[jo.reloginButton, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}
            >
              <Text style={jo.reloginButtonText}>Relogin</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <TimeInOutModal
        visible={showTimeModal}
        onClose={() => setShowTimeModal(false)}
        userData={authUserData}
        colorPalette={colorPalette}
        isMandatory={true}
      />

      <Modal
        visible={showStatusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <Pressable style={jo.statusModalOverlay} onPress={() => setShowStatusModal(false)}>
          <View style={jo.statusModalContent}>
            <View style={jo.statusModalHeader}>
              <Text style={jo.statusModalTitle}>Filter by Status</Text>
            </View>
            {[
              { label: 'All Status', value: 'all' },
              { label: 'Pending', value: 'pending' },
              { label: 'In Progress', value: 'inprogress' },
              { label: 'Done', value: 'done' },
              { label: 'Rescheduled', value: 'reschedule' },
              { label: 'Cancelled', value: 'cancelled' },
              { label: 'Failed', value: 'failed' }
            ].map((item) => (
              <Pressable
                key={item.value}
                style={jo.statusItem}
                onPress={() => {
                  setStatusFilter(item.value);
                  setShowStatusModal(false);
                }}
              >
                <Text style={[jo.statusItemText, statusFilter === item.value && { color: colorPalette?.primary || '#7c3aed', fontWeight: '700' }]}>
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

export default JobOrderPage;
