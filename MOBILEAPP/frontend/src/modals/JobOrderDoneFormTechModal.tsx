import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, TouchableOpacity, Modal, Image, Platform, DeviceEventEmitter, KeyboardAvoidingView, Alert, Keyboard, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import SignatureScreen from 'react-native-signature-canvas';
import * as ExpoFileSystem from 'expo-file-system/legacy';
import { saveImagesToGallery } from '../utils/saveImagesToGallery';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Settings, Camera, X, ChevronDown, Search, Check, ChevronLeft, MapPin, CheckCircle, AlertCircle, XCircle } from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// Global cache to persist data between form opens/re-renders
// This makes re-opening the form instant.
const DATA_CACHE: {
  lcpnaps: any[] | null;
  inventory: any[] | null;
  technicians: any[] | null;
  plans: any[] | null;
  vlans: any[] | null;
  usageTypes: any[] | null;
  routerModels: any[] | null;
  usernamePattern: any | null;
  mostUsedLcpnaps: any[] | null;
  lastFetch: number;
} = {
  lcpnaps: null,
  inventory: null,
  technicians: null,
  plans: null,
  vlans: null,
  usageTypes: null,
  routerModels: null,
  usernamePattern: null,
  mostUsedLcpnaps: null,
  lastFetch: 0
};

const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes cache expiry

import { UserData } from '../types/api';
import { updateJobOrder } from '../services/jobOrderService';
import { userService } from '../services/userService';
import { referredByEcho } from '../utils/referredByField';
import { technicianService, Technician } from '../services/technicianService';
import { planService, Plan } from '../services/planService';
import { getAllLCPNAPs, LCPNAP, getMostUsedLCPNAPs } from '../services/lcpnapService';
import { getAllVLANs, VLAN } from '../services/vlanService';
import { getAllUsageTypes, UsageType } from '../services/usageTypeService';
import { getAllInventoryItems, InventoryItem } from '../services/inventoryItemService';
import { createJobOrderItems, JobOrderItem } from '../services/jobOrderItemService';
import { updateApplication } from '../services/applicationService';
import { formatToGMT8MySQL, formatToGMT8Display } from '../utils/dateUtils';
import apiClient from '../config/api';
import { getActiveImageSize } from '../services/imageSettingsService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LocationPicker from '../components/LocationPicker';
import { pppoeService, UsernamePattern } from '../services/pppoeService';
import ImagePreview from '../components/ImagePreview';
import { SearchablePicker, SearchablePickerTrigger } from '../components/SearchablePicker';
import { usePermissions } from '../hooks/usePermissions';

interface JobOrderDoneFormTechModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: any) => void;
  jobOrderData?: any;
}

type RouterModelEntry = { model: string; brand: string; description: string; id: number };

interface JobOrderDoneFormData {
  dateInstalled: string;
  usageType: string;
  choosePlan: string;
  connectionType: string;
  routerModel: string;
  modemSN: string;

  region: string;
  city: string;
  barangay: string;
  lcpnap: string;
  port: string;
  vlan: string;
  onsiteStatus: string;
  onsiteRemarks: string;
  signedContractImage: File | null;
  setupImage: File | null;
  boxReadingImage: File | null;
  routerReadingImage: File | null;
  portLabelImage: File | null;
  clientSignatureImage: File | null;
  clientTaggingImage: File | null;
  modifiedBy: string;
  modifiedDate: string;
  itemName1: string;
  visit_by: string;
  visit_with: string;
  visit_with_other: string;
  ip: string;
  addressCoordinates: string;
  proofImage: File | null;
}

interface OrderItem {
  itemId: string;
  quantity: string;
}

/**
 * Values that occur in technical_details.port but mean "no port assigned". Ports are
 * numbered from 1, so anything resolving to zero counts as blank too.
 */
const BLANK_PORT_VALUES = new Set([
  '', '0', '00', 'P0', 'P00', '-', '--', 'N/A', 'NA', 'NONE', 'NULL', 'UNDEFINED', 'TBD',
]);

/**
 * Ports are stored inconsistently ('3', 'P3', 'p03', ' P03 '), so everything is compared
 * in the canonical picker form: P + two digits.
 *
 * Returns '' when there is no port assigned — the caller treats that as "this record
 * holds no port". An unrecognised but non-empty value is returned as-is rather than
 * discarded: a port we cannot parse must never be silently reported as free, or two
 * customers end up on it.
 */
const normalizePortLabel = (raw: any): string => {
  const p = (raw ?? '').toString().replace(/\s+/g, '').toUpperCase();
  if (BLANK_PORT_VALUES.has(p)) return '';
  if (/^\d+$/.test(p)) {
    const n = Number(p);
    return n > 0 ? `P${String(n).padStart(2, '0')}` : '';
  }
  if (/^P\d+$/.test(p)) {
    const n = Number(p.substring(1));
    return n > 0 ? `P${String(n).padStart(2, '0')}` : '';
  }
  return p;
};

/**
 * Billing status id for Pullout, matching billing_status.status_name = 'Pullout'.
 * Used only as a fallback when the API did not return the status name.
 */
const PULLOUT_BILLING_STATUS_ID = 5;

/**
 * Has this customer been pulled out? Only then is their LCP/NAP port free to reassign.
 * Matched on the status name where available, falling back to the id.
 */
const isPulledOut = (customer: any): boolean => {
  const name = (customer?.billing_status ?? customer?.billing_status_name ?? '')
    .toString()
    .trim()
    .toLowerCase();
  if (name) return name.replace(/[\s_-]/g, '') === 'pullout';

  const id = customer?.billing_status_id;
  return id != null && Number(id) === PULLOUT_BILLING_STATUS_ID;
};

// ─── Mini Modal Item Component ──────────────────────────────────────────────
interface MiniModalItemProps {
  label: string;
  isSelected: boolean;
  onPress: (label: string) => void;
  isDarkMode: boolean;
  primaryColor: string;
  imageUrl?: string | null;
}

const MiniModalItem = React.memo<MiniModalItemProps>(
  ({ label, isSelected, onPress, isDarkMode, primaryColor, imageUrl }) => (
    <Pressable
      onPress={() => onPress(label)}
      style={({ pressed }) => [
        styles.miniModalItem,
        { backgroundColor: pressed ? (isDarkMode ? 'rgba(124, 58, 237, 0.1)' : '#f3f4f6') : 'transparent' }
      ]}
    >
      <Text style={[styles.miniModalItemText, {
        color: isSelected ? primaryColor : (isDarkMode ? '#e5e7eb' : '#374151'),
        fontWeight: isSelected ? '700' : 'bold',
        flex: 1
      }]}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {imageUrl && (
          <Image
            source={{ uri: imageUrl || undefined }}
            style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: '#f3f4f6', resizeMode: 'cover' }}
          />
        )}
        {isSelected && <Check size={24} color={primaryColor} />}
      </View>
    </Pressable>
  )
);

// Local helpers removed in favor of utility

const JobOrderDoneFormTechModal: React.FC<JobOrderDoneFormTechModalProps> = ({
  isOpen,
  onClose,
  onSave,
  jobOrderData
}) => {
  const insets = useSafeAreaInsets();
  const isDarkMode = false;
  const { can, ready: permissionsReady } = usePermissions();

  // Reading /applications/{id} needs the application-management key, which the
  // technician opening this form does not hold. The prefill below already falls
  // back to the job order's own values when the application is missing, so the
  // request only ever bought a 403 — the fallback is the outcome either way.
  const canReadApplication = permissionsReady && can('application-management');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());

  useEffect(() => {
    DeviceEventEmitter.emit('techModalStateChange', isOpen);
    return () => {
      DeviceEventEmitter.emit('techModalStateChange', false);
    };
  }, [isOpen]);



  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();

    const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      setColorPalette(newPalette);
    });

    return () => paletteSub.remove();
  }, []);

  const [currentUser, setCurrentUser] = useState<UserData | null>(null);

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          setCurrentUser(JSON.parse(authData));
        }
      } catch (error) {
        console.error('Failed to fetch auth data:', error);
      }
    };
    fetchUserData();
  }, []);

  const currentUserEmail = currentUser?.email || 'unknown@unknown.com';

  const [formData, setFormData] = useState<JobOrderDoneFormData>({
    dateInstalled: formatDateTimeForInput(new Date()),
    usageType: '',
    choosePlan: '',
    connectionType: 'Fiber',
    routerModel: '',
    modemSN: '',

    region: '',
    city: '',
    barangay: '',
    lcpnap: '',
    port: '',
    vlan: '',
    onsiteStatus: 'In Progress',
    onsiteRemarks: '',
    signedContractImage: null,
    setupImage: null,
    boxReadingImage: null,
    routerReadingImage: null,
    portLabelImage: null,
    clientSignatureImage: null,
    clientTaggingImage: null,
    modifiedBy: currentUserEmail,
    modifiedDate: formatToGMT8Display(),
    itemName1: '',
    visit_by: '',
    visit_with: '',
    visit_with_other: '',
    ip: '',
    addressCoordinates: '',
    proofImage: null
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submittingDots, setSubmittingDots] = useState('');

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      setSubmittingDots('.');
      interval = setInterval(() => {
        setSubmittingDots(prev => (prev.length >= 3 ? '.' : prev + '.'));
      }, 500);
    } else {
      setSubmittingDots('');
    }
    return () => clearInterval(interval);
  }, [loading]);

  const [technicians, setTechnicians] = useState<Array<{ email: string; name: string }>>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [routerModels, setRouterModels] = useState<RouterModelEntry[]>([]);
  const [lcpnaps, setLcpnaps] = useState<LCPNAP[]>([]);
  const [vlans, setVlans] = useState<VLAN[]>([]);

  const [usageTypes, setUsageTypes] = useState<UsageType[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);

  const [orderItems, setOrderItems] = useState<OrderItem[]>([{ itemId: '', quantity: '' }]);
  const [imagePreviews, setImagePreviews] = useState<{
    signedContractImage: string | null;
    setupImage: string | null;
    boxReadingImage: string | null;
    routerReadingImage: string | null;
    portLabelImage: string | null;
    clientSignatureImage: string | null;
    clientTaggingImage: string | null;
    proofImage: string | null;
  }>({
    signedContractImage: null,
    setupImage: null,
    boxReadingImage: null,
    routerReadingImage: null,
    portLabelImage: null,
    clientSignatureImage: null,
    clientTaggingImage: null,
    proofImage: null
  });

  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState<{
    title: string;
    messages: Array<{ type: 'success' | 'warning' | 'error'; text: string }>;
  }>({ title: '', messages: [] });
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [usernamePattern, setUsernamePattern] = useState<UsernamePattern | null>(null);
  const [techInputValue, setTechInputValue] = useState<string>('');
  const [lcpnapSearch, setLcpnapSearch] = useState('');
  const [itemSearchModal, setItemSearchModal] = useState('');
  const [routerModelSearch, setRouterModelSearch] = useState('');
  const [isRouterModelMiniModalVisible, setIsRouterModelMiniModalVisible] = useState(false);
  const [isItemMiniModalVisible, setIsItemMiniModalVisible] = useState(false);
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);
  const [usedPorts, setUsedPorts] = useState<Set<string>>(new Set());
  // port -> who is holding it, for the "not available" message.
  const [portOccupants, setPortOccupants] = useState<Map<string, string>>(new Map());

  const [isOnsiteStatusPickerOpen, setIsOnsiteStatusPickerOpen] = useState(false);
  const [onsiteStatusSearch, setOnsiteStatusSearch] = useState('');
  
  const [isLcpnapMiniModalVisible, setIsLcpnapMiniModalVisible] = useState(false);
  const [isUsageTypeMiniModalVisible, setIsUsageTypeMiniModalVisible] = useState(false);
  const [isPortMiniModalVisible, setIsPortMiniModalVisible] = useState(false);
  const [isVlanMiniModalVisible, setIsVlanMiniModalVisible] = useState(false);
  const [isTechMiniModalVisible, setIsTechMiniModalVisible] = useState(false);

  const [usageTypeSearch, setUsageTypeSearch] = useState('');
  const [portSearch, setPortSearch] = useState('');
  const [vlanSearch, setVlanSearch] = useState('');
  const [techSearch, setTechSearch] = useState('');
  const [activeTechField, setActiveTechField] = useState<'visit_by' | 'visit_with' | 'visit_with_other' | null>(null);

  const [mostUsedLcpnaps, setMostUsedLcpnaps] = useState<LCPNAP[]>([]);
   const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time'>('date');
  const [tempPickedDate, setTempPickedDate] = useState<Date | null>(null);
  const [isDoneRendering, setIsDoneRendering] = useState(false);
  const [isValidatingSN, setIsValidatingSN] = useState(false);
  const [isSNValidated, setIsSNValidated] = useState(false);
  const [validateCooldown, setValidateCooldown] = useState(0);

  useEffect(() => {
    let timer: any;
    if (validateCooldown > 0) {
      timer = setInterval(() => {
        setValidateCooldown(prev => prev - 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [validateCooldown]);

  // Shared mounted flag – set false on unmount so ALL async callbacks can bail out
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Open-session counter – incremented each time the modal transitions to isOpen=true.
  const openCycleRef = useRef(0);
  const initialDataLoadedRef = useRef(false);
  const [isContentReady, setIsContentReady] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const raf = requestAnimationFrame(() => {
        if (isMountedRef.current) setIsContentReady(true);
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setIsContentReady(false);
      initialDataLoadedRef.current = false;
    }
  }, [isOpen]);

  // Deferred rendering for the "Done" form section.
  useEffect(() => {
    if (formData.onsiteStatus === 'Done') {
      const timer = setTimeout(() => {
        if (isMountedRef.current) {
          setIsDoneRendering(true);
        }
      }, 200);
      return () => clearTimeout(timer);
    } else {
      setIsDoneRendering(false);
    }
  }, [formData.onsiteStatus]);

  // Signature State
  const signatureRef = useRef<any>(null);
  const [isDrawingSignature, setIsDrawingSignature] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // Formats a Date into the MySQL datetime string the DB now expects (local/GMT+8 wall-clock).
  function formatDateTimeForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // Safely turns a stored "YYYY-MM-DD HH:mm:ss" (or date-only) string into a Date for the picker.
  function parseDateInput(value?: string): Date {
    if (!value) return new Date();
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const parsed = new Date(normalized);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  const onDateChange = (event: any, selectedDate?: Date) => {
    // Android dispatches a 'dismissed' event when the dialog is cancelled.
    if (event?.type === 'dismissed' || !selectedDate) {
      setShowDatePicker(false);
      setDatePickerMode('date');
      setTempPickedDate(null);
      return;
    }

    // Android has no combined datetime picker: pick the date first, then the time.
    if (Platform.OS === 'android' && datePickerMode === 'date') {
      setTempPickedDate(selectedDate);
      setDatePickerMode('time');
      return; // keep the picker open, now in time mode
    }

    let finalDate = selectedDate;
    if (Platform.OS === 'android' && datePickerMode === 'time' && tempPickedDate) {
      finalDate = new Date(tempPickedDate);
      finalDate.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
    }

    setShowDatePicker(false);
    setDatePickerMode('date');
    setTempPickedDate(null);
    handleInputChange('dateInstalled', formatDateTimeForInput(finalDate));
  };

  const convertGoogleDriveUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;

    const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (fileIdMatch && fileIdMatch[1]) {
      return `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
    }

    const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch && idMatch[1]) {
      return `https://drive.google.com/uc?export=view&id=${idMatch[1]}`;
    }

    return url;
  };




  // Consolidated data fetching - all independent API calls batched into one effect.
  useEffect(() => {
    const joId = jobOrderData?.id || jobOrderData?.JobOrder_ID;
    if (!isOpen || !joId) {
      // Full cleanup when modal closes
      setFormData(prev => ({
        ...prev,
        dateInstalled: formatDateTimeForInput(new Date()),
        usageType: '',
        choosePlan: '',
        connectionType: 'Fiber',
        routerModel: '',
        modemSN: '',
        lcpnap: '',
        port: '',
        vlan: '',
        onsiteStatus: 'In Progress',
        onsiteRemarks: '',
        signedContractImage: null,
        setupImage: null,
        boxReadingImage: null,
        routerReadingImage: null,
        portLabelImage: null,
        clientSignatureImage: null,
        clientTaggingImage: null,
        itemName1: '',
        visit_by: '',
        visit_with: '',
        visit_with_other: '',
        ip: '',
        addressCoordinates: '',
        proofImage: null
      }));
      setErrors({});
      setOrderItems([{ itemId: '', quantity: '' }]);
      setTechInputValue('');
      setIsSNValidated(false);
      setValidateCooldown(0);
      return;
    }

    openCycleRef.current += 1;
    const session = openCycleRef.current;
    const isCurrentSession = () => isMountedRef.current && openCycleRef.current === session;
    const controller = new AbortController();

    const fetchAllData = async (isDone: boolean) => {
      const now = Date.now();
      const isCacheValid = (now - DATA_CACHE.lastFetch) < CACHE_EXPIRY;

      // Hydrate from cache immediately for perceived speed
      if (isCacheValid) {
        if (Array.isArray(DATA_CACHE.technicians)) setTechnicians(DATA_CACHE.technicians);
        if (DATA_CACHE.usernamePattern) setUsernamePattern(DATA_CACHE.usernamePattern);
        if (isDone) {
          if (Array.isArray(DATA_CACHE.lcpnaps)) setLcpnaps(DATA_CACHE.lcpnaps);
          if (Array.isArray(DATA_CACHE.inventory)) setInventoryItems(DATA_CACHE.inventory);
          if (Array.isArray(DATA_CACHE.plans)) setPlans(DATA_CACHE.plans);
          if (Array.isArray(DATA_CACHE.vlans)) setVlans(DATA_CACHE.vlans);
          if (Array.isArray(DATA_CACHE.usageTypes)) setUsageTypes(DATA_CACHE.usageTypes);
          if (Array.isArray(DATA_CACHE.routerModels)) setRouterModels(DATA_CACHE.routerModels);
          if (Array.isArray(DATA_CACHE.mostUsedLcpnaps)) setMostUsedLcpnaps(DATA_CACHE.mostUsedLcpnaps);
        }
      }

      const commonPromises = [
        getActiveImageSize(),
        pppoeService.getPatterns('username'),
        technicianService.getAllTechnicians(),
      ];

      const donePromises = isDone ? [
        getAllLCPNAPs('', 1, 1000),
        getAllVLANs(),
        getAllUsageTypes(),
        getAllInventoryItems('', 1, 1000),
        planService.getAllPlans(),
        getMostUsedLCPNAPs(),
      ] : [];

      const results = await Promise.allSettled([...commonPromises, ...donePromises]);
      if (!isCurrentSession()) return;

      let idx = 0;
      const imageSizeRes = results[idx++] as any;
      const userPatRes = results[idx++] as any;
      const techRes = results[idx++] as any;
      const lcpRes = (isDone ? results[idx++] : null) as any;
      const vlanRes = (isDone ? results[idx++] : null) as any;
      const usageRes = (isDone ? results[idx++] : null) as any;
      const invRes = (isDone ? results[idx++] : null) as any;
      const planRes = (isDone ? results[idx++] : null) as any;
      const mostUsedLcpRes = (isDone ? results[idx++] : null) as any;

      // Process Common
      if (userPatRes.status === 'fulfilled' && userPatRes.value?.length) {
        const pattern = userPatRes.value[0];
        setUsernamePattern(pattern);
        const existingUsername = jobOrderData?.pppoe_username || jobOrderData?.PPPoE_Username || '';
        if (existingUsername && pattern.sequence.some((item: any) => item.type === 'tech_input')) {
          setTechInputValue(existingUsername);
        }
      }

      if (techRes.status === 'fulfilled' && techRes.value?.success) {
        const list = techRes.value.data.filter((t: any) => t.first_name || t.last_name).map((t: any) => ({
          email: t.id.toString(),
          name: `${t.first_name || ''} ${t.middle_initial ? t.middle_initial + '. ' : ''}${t.last_name || ''}`.trim()
        }));
        setTechnicians(list);
        DATA_CACHE.technicians = list;
      }

      // Process Done
      if (lcpRes && lcpRes.status === 'fulfilled' && lcpRes.value?.success && Array.isArray(lcpRes.value.data)) {
        setLcpnaps(lcpRes.value.data);
      }
      if (vlanRes && vlanRes.status === 'fulfilled' && vlanRes.value?.success && Array.isArray(vlanRes.value.data)) {
        setVlans(vlanRes.value.data);
      }
      if (usageRes && usageRes.status === 'fulfilled' && usageRes.value?.success && Array.isArray(usageRes.value.data)) {
        const filteredUt = usageRes.value.data.filter((ut: any) => {
          const val = String(ut.usage_name || ut.Usage_Name || '').toLowerCase();
          return val && val !== 'undefined' && val !== 'null';
        });
        setUsageTypes(filteredUt);
      }
      if (invRes && invRes.status === 'fulfilled' && invRes.value?.success && Array.isArray(invRes.value.data)) {
        const items = invRes.value.data;
        const filteredInv = items.filter((i: any) => String(i.category_id) === '1');
        setInventoryItems(filteredInv);
        const filteredRouter = items.filter((i: any) => String(i.category_id) === '11').map((i: any, index: number) => ({
          model: i.item_name, brand: 'Inventory', description: i.item_description || '', id: index
        }));
        setRouterModels(filteredRouter);
      }
      if (planRes && planRes.status === 'fulfilled' && Array.isArray(planRes.value)) {
        setPlans(planRes.value);
      }
      if (mostUsedLcpRes && mostUsedLcpRes.status === 'fulfilled' && mostUsedLcpRes.value?.success && Array.isArray(mostUsedLcpRes.value.data)) {
        setMostUsedLcpnaps(mostUsedLcpRes.value.data);
      }

      // Cache Update
      DATA_CACHE.lastFetch = Date.now();
      if (lcpRes && lcpRes.status === 'fulfilled' && lcpRes.value?.success && Array.isArray(lcpRes.value.data)) {
        DATA_CACHE.lcpnaps = lcpRes.value.data;
      }
      if (invRes && invRes.status === 'fulfilled' && invRes.value?.success && Array.isArray(invRes.value.data)) {
        const items = invRes.value.data;
        DATA_CACHE.inventory = items.filter((i: any) => String(i.category_id) === '1');
        DATA_CACHE.routerModels = items.filter((i: any) => String(i.category_id) === '11').map((i: any, index: number) => ({
          model: i.item_name, brand: 'Inventory', description: i.item_description || '', id: index
        }));
      }
      if (planRes && planRes.status === 'fulfilled' && Array.isArray(planRes.value)) {
        DATA_CACHE.plans = planRes.value;
      }
      if (vlanRes && vlanRes.status === 'fulfilled' && vlanRes.value?.success && Array.isArray(vlanRes.value.data)) {
        DATA_CACHE.vlans = vlanRes.value.data;
      }
      if (usageRes && usageRes.status === 'fulfilled' && usageRes.value?.success && Array.isArray(usageRes.value.data)) {
        DATA_CACHE.usageTypes = usageRes.value.data.filter((ut: any) => {
          const val = String(ut.usage_name || ut.Usage_Name || '').toLowerCase();
          return val && val !== 'undefined' && val !== 'null';
        });
      }
      if (userPatRes.status === 'fulfilled') {
        DATA_CACHE.usernamePattern = userPatRes.value[0];
      }
      if (mostUsedLcpRes && mostUsedLcpRes.status === 'fulfilled' && mostUsedLcpRes.value?.success && Array.isArray(mostUsedLcpRes.value.data)) {
        DATA_CACHE.mostUsedLcpnaps = mostUsedLcpRes.value.data;
      }
    };

    fetchAllData(formData.onsiteStatus === 'Done');

    const fetchJobOrderItems = async () => {
      try {
        const response = await apiClient.get(`/job-order-items?job_order_id=${joId}`, { signal: controller.signal });
        if (isCurrentSession() && response.data?.success) {
          const items = response.data.data;
          if (items.length > 0) {
            const unique = new Map();
            items.forEach((it: any) => {
              const existing = unique.get(it.item_name) || { quantity: 0 };
              unique.set(it.item_name, { itemId: it.item_name, quantity: (parseInt(existing.quantity) + parseInt(it.quantity || 0)).toString() });
            });
            const formatted = Array.from(unique.values());
            formatted.push({ itemId: '', quantity: '' });
            setOrderItems(formatted);
          }
        }
      } catch (err) { }
    };
    fetchJobOrderItems();

    return () => controller.abort();
  }, [isOpen, jobOrderData?.id, formData.onsiteStatus === 'Done']);


  // Fetch used ports for the selected LCPNAP
  useEffect(() => {
    if (!isOpen || !formData.lcpnap) {
      setUsedPorts(new Set());
      return;
    }

    const session = openCycleRef.current;
    const isCurrentSession = () => isMountedRef.current && openCycleRef.current === session;
    const controller = new AbortController();

    const fetchUsedPorts = async () => {
      try {
        const used = new Set<string>();
        const currentId = jobOrderData?.id || jobOrderData?.JobOrder_ID;
        const currentAccountId = jobOrderData?.account_id || jobOrderData?.Account_ID;

        // Parallelize both sources of used ports
        const [joResponseResult, rcResponseResult] = await Promise.allSettled([
          // 1. Fetch from job-orders (pending/active)
          apiClient.get('/job-orders', {
            params: { lcpnap: formData.lcpnap, limit: 500 },
            signal: controller.signal
          }),
          // 2. Fetch from technical_details (already installed customers)
          (async () => {
            const selectedLcpnapObj = lcpnaps.find(ln => (ln.lcpnap_name || (ln as any).name) === formData.lcpnap);
            if (selectedLcpnapObj?.id) {
              return apiClient.get(`/lcpnap/${selectedLcpnapObj.id}/related-customers`, {
                signal: controller.signal
              });
            }
            return null;
          })()
        ]);

        if (!isCurrentSession()) return;

        // Process Job Orders results
        if (joResponseResult.status === 'fulfilled' && joResponseResult.value?.data?.success) {
          joResponseResult.value.data.data.forEach((jo: any) => {
            const joLcpnap = jo.lcpnap || jo.LCPNAP;
            if (joLcpnap === formData.lcpnap) {
              const joId = jo.id || jo.JobOrder_ID;
              const joPort = normalizePortLabel(jo.port || jo.PORT);
              if (joPort && String(joId) !== String(currentId)) {
                used.add(joPort);
              }
            }
          });
        }

        // Process Related Customers results.
        //
        // An installed customer holds a port only when BOTH are true:
        //   1. their account is still in service — billing status is anything other than
        //      Pullout. Once pulled out the equipment is gone and the port is reusable.
        //   2. their technical details actually name a port. A record with the port left
        //      blank ('', '0', '-', 'N/A'...) occupies nothing, so it must not take a
        //      port out of circulation.
        const occupants = new Map<string, string>();
        if (rcResponseResult.status === 'fulfilled' && rcResponseResult.value?.data?.success) {
          rcResponseResult.value.data.data.forEach((rc: any) => {
            const rcPort = normalizePortLabel(rc.port);
            const rcAccountId = rc.id || rc.account_id || rc.Account_ID;

            // Rule 2: no port recorded -> holds nothing. Also skips the account being
            // edited, so a technician never blocks themselves out of their own port.
            if (!rcPort || String(rcAccountId) === String(currentAccountId)) return;

            // Rule 1: pulled out -> port released.
            if (isPulledOut(rc)) return;

            used.add(rcPort);

            const who = (rc.full_name || rc.account_no || 'another customer').toString().trim();
            const statusName = (rc.billing_status || '').toString().trim();
            occupants.set(rcPort, statusName ? `${who} (${statusName})` : who);
          });
        }

        if (isCurrentSession()) {
          setUsedPorts(used);
          setPortOccupants(occupants);
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError' && error?.code !== 'ERR_CANCELED') {
          console.error('Failed to fetch used ports:', error);
        }
      }
    };

    fetchUsedPorts();

    return () => { controller.abort(); };
  }, [isOpen, formData.lcpnap, jobOrderData?.id, jobOrderData?.JobOrder_ID]);

  useEffect(() => {
    if (!jobOrderData || !isOpen || initialDataLoadedRef.current) return;
    initialDataLoadedRef.current = true;

    const session = openCycleRef.current;
    const isCurrentSession = () => isMountedRef.current && openCycleRef.current === session;
    const controller = new AbortController();

    const initialSN = jobOrderData.Modem_SN || jobOrderData.modem_sn || '';
    if (initialSN && initialSN.trim() !== '') {
      setIsSNValidated(true);
    } else {
      setIsSNValidated(false);
    }

    const loadedOnsiteStatus = jobOrderData.Onsite_Status || jobOrderData.onsite_status || 'In Progress';

    const isEmptyValue = (value: any): boolean => {
      if (value === null || value === undefined || value === '') return true;
      if (typeof value === 'string') {
        const trimmed = value.trim().toLowerCase();
        return trimmed === 'null' || trimmed === 'undefined';
      }
      return false;
    };

    const getValue = (value: any): string => isEmptyValue(value) ? '' : value;

    const formatDateForInput = (dateValue: any): string => {
      const now = formatDateTimeForInput(new Date());
      const isEmpty = (val: any) => {
        if (!val) return true;
        if (typeof val === 'string') {
          const t = val.trim().toLowerCase();
          return t === '' || t === 'null' || t === 'undefined' || t === '0000-00-00' || t.startsWith('0000-00-00');
        }
        return false;
      };

      if (isEmpty(dateValue)) return now;

      try {
        // Normalize "YYYY-MM-DD HH:mm:ss" to ISO so the time survives parsing across JS engines.
        const normalized = typeof dateValue === 'string' && !dateValue.includes('T')
          ? dateValue.replace(' ', 'T')
          : dateValue;
        const date = new Date(normalized);
        if (isNaN(date.getTime())) return now;

        if (date.getFullYear() < 2020) return now;

        return formatDateTimeForInput(date);
      } catch (error) {
        return now;
      }
    };

    const sanitize = (v: any): string => {
      const s = (v || '').toString().trim().toLowerCase();
      return (s === 'undefined' || s === 'null') ? '' : (v || '').toString();
    };

    const buildFormData = (appData?: any) => ({
      dateInstalled: formatDateForInput(jobOrderData.Date_Installed || jobOrderData.date_installed),
      usageType: sanitize(jobOrderData.Usage_Type || jobOrderData.usage_type),
      choosePlan: getValue(jobOrderData.Desired_Plan || jobOrderData.desired_plan || jobOrderData.Choose_Plan || jobOrderData.choose_plan || jobOrderData.plan),
      connectionType: (() => {
        const t = (getValue(jobOrderData.Connection_Type || jobOrderData.connection_type) || 'Fiber').toLowerCase();
        if (t === 'antenna') return 'Antenna';
        if (t === 'fiber') return 'Fiber';
        if (t === 'local') return 'Local';
        return 'Fiber';
      })(),
      routerModel: sanitize(jobOrderData.Router_Model || jobOrderData.router_model),
      modemSN: getValue(jobOrderData.Modem_SN || jobOrderData.modem_sn),
      lcpnap: getValue(jobOrderData.LCPNAP || jobOrderData.lcpnap),
      port: getValue(jobOrderData.PORT || jobOrderData.port),
      vlan: getValue(jobOrderData.VLAN || jobOrderData.vlan),
      region: getValue((appData?.region) || jobOrderData.Region || jobOrderData.region),
      city: getValue((appData?.city) || jobOrderData.City || jobOrderData.city),
      barangay: getValue((appData?.barangay) || jobOrderData.Barangay || jobOrderData.barangay),
      onsiteStatus: loadedOnsiteStatus,
      onsiteRemarks: getValue(jobOrderData.Onsite_Remarks || jobOrderData.onsite_remarks),
      itemName1: getValue(jobOrderData.Item_Name_1 || jobOrderData.item_name_1),
      visit_by: getValue(jobOrderData.Visit_By || jobOrderData.visit_by),
      visit_with: getValue(jobOrderData.Visit_With || jobOrderData.visit_with),
      visit_with_other: getValue(jobOrderData.Visit_With_Other || jobOrderData.visit_with_other),
      ip: getValue(jobOrderData.IP || jobOrderData.ip),
      addressCoordinates: getValue((appData?.long_lat) || jobOrderData.Address_Coordinates || jobOrderData.address_coordinates)
    });

    const buildImagePreviews = (safeConvert: (val: any) => string | null) => ({
      signedContractImage: safeConvert(jobOrderData.signed_contract_image_url || jobOrderData.Signed_Contract_Image_URL),
      setupImage: safeConvert(jobOrderData.setup_image_url || jobOrderData.Setup_Image_URL),
      boxReadingImage: safeConvert(jobOrderData.box_reading_image_url || jobOrderData.Box_Reading_Image_URL),
      routerReadingImage: safeConvert(jobOrderData.router_reading_image_url || jobOrderData.Router_Reading_Image_URL),
      portLabelImage: safeConvert(jobOrderData.port_label_image_url || jobOrderData.Port_Label_Image_URL),
      clientSignatureImage: safeConvert(jobOrderData.client_signature_url || jobOrderData.Client_Signature_URL),
      clientTaggingImage: safeConvert(jobOrderData.client_tagging_url || jobOrderData.Client_Tagging_URL),
      proofImage: safeConvert(jobOrderData.proof_image_url || jobOrderData.Proof_Image_URL)
    });

    const safeConvertUrl = (val: any): string | null => {
      const url = val || '';
      if (url && typeof url === 'string' && url.startsWith('http')) {
        return convertGoogleDriveUrl(url);
      }
      return null;
    };

    const fetchApplicationData = async () => {
      try {
        const applicationId = jobOrderData.application_id || jobOrderData.Application_ID;
        if (applicationId && canReadApplication) {
          const appResponse = await apiClient.get<{ success: boolean; application: any }>(
            `/applications/${applicationId}`,
            { signal: controller.signal }
          );

          // Discard if the modal was closed or a new open-cycle started
          if (!isCurrentSession()) return;

          if (appResponse.data.success && appResponse.data.application) {
            setFormData(prev => ({ ...prev, ...buildFormData(appResponse.data.application) }));
            setImagePreviews(buildImagePreviews(safeConvertUrl));
          } else {
            setFormData(prev => ({ ...prev, ...buildFormData() }));
            setImagePreviews(buildImagePreviews(safeConvertUrl));
          }
        } else {
          if (!isCurrentSession()) return;
          setFormData(prev => ({ ...prev, ...buildFormData() }));
          setImagePreviews(buildImagePreviews(safeConvertUrl));
        }
      } catch (error: any) {
        // Ignore AbortError – it's an intentional cancellation
        if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') return;
        if (!isCurrentSession()) return;
        setFormData(prev => ({ ...prev, ...buildFormData() }));
        setImagePreviews(buildImagePreviews(safeConvertUrl));
      }
    };

    fetchApplicationData();

    return () => {
      controller.abort();
    };
  }, [isOpen, jobOrderData?.id, jobOrderData?.JobOrder_ID, canReadApplication]);

  const handleInputChange = useCallback((field: keyof JobOrderDoneFormData, value: string | File | null) => {
    let finalValue = value;
    if (typeof value === 'string' && field === 'modemSN') {
      finalValue = value.toUpperCase();
    }
    setFormData(prev => {
      const newData = { ...prev, [field]: finalValue };
      if (field === 'lcpnap') newData.port = '';
      if (field === 'region') { newData.city = ''; newData.barangay = ''; }
      if (field === 'city') newData.barangay = '';
      return newData;
    });

    if (field === 'modemSN' || field === 'connectionType') {
      setIsSNValidated(false);
    }
    setErrors(prev => {
      if (prev[field]) {
        return { ...prev, [field]: '' };
      }
      return prev;
    });
  }, []);

  const handleImageUpload = useCallback((field: 'signedContractImage' | 'setupImage' | 'boxReadingImage' | 'routerReadingImage' | 'portLabelImage' | 'clientSignatureImage' | 'clientTaggingImage' | 'proofImage', file: any) => {
    setFormData(prev => ({ ...prev, [field]: file }));
    setImagePreviews(prev => ({ ...prev, [field]: file ? file.uri : null }));
    setErrors(prev => prev[field] ? { ...prev, [field]: '' } : prev);
  }, []);

  const handleSignatureOK = async (signature: string) => {
    setIsDrawingSignature(false);
    setScrollEnabled(true);
    try {
      const path = `${(ExpoFileSystem as any).cacheDirectory}signature_${Date.now()}.png`;
      const base64Code = signature.replace('data:image/png;base64,', '');
      await (ExpoFileSystem as any).writeAsStringAsync(path, base64Code, {
        encoding: 'base64',
      });

      const file = {
        uri: path,
        name: `signature_${Date.now()}.png`,
        type: 'image/png',
        size: base64Code.length * 0.75 // Approximate size
      };

      handleImageUpload('clientSignatureImage', file);
    } catch (e) {
      console.error('Error handling signature:', e);
      Alert.alert('Error', 'Failed to save signature');
    }
  };

  const handleSignatureClear = () => {
    if (signatureRef.current) {
      signatureRef.current.clearSignature();
    }
    setFormData(prev => ({ ...prev, clientSignatureImage: null }));
    setImagePreviews(prev => ({ ...prev, clientSignatureImage: null }));
  };

  const handleItemChange = useCallback((index: number, field: 'itemId' | 'quantity', value: string) => {
    setOrderItems(prevItems => {
      const newItems = prevItems.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      );

      // Auto-add new row if item selected in the last row
      if (field === 'itemId' && value && index === prevItems.length - 1) {
        return [...newItems, { itemId: '', quantity: '' }];
      }

      return newItems;
    });
  }, []);

  const handleRemoveItem = useCallback((index: number) => {
    setOrderItems(prev => {
      if (prev.length > 1) {
        return prev.filter((_, i) => i !== index);
      }
      return prev;
    });
  }, []);

  const showMessageModal = (title: string, messages: Array<{ type: 'success' | 'warning' | 'error'; text: string }>) => {
    setModalContent({ title, messages });
    setShowModal(true);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.choosePlan.trim()) newErrors.choosePlan = 'Choose Plan is required';
    if (!formData.onsiteStatus.trim()) newErrors.onsiteStatus = 'Onsite Status is required';

    if (!formData.region.trim()) newErrors.region = 'Region is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.barangay.trim()) newErrors.barangay = 'Barangay is required';

    if (formData.onsiteStatus === 'Done') {
      if (!formData.dateInstalled.trim()) newErrors.dateInstalled = 'Date Installed is required';
      if (!formData.usageType.trim()) newErrors.usageType = 'Usage Type is required';
      if (!formData.connectionType.trim()) newErrors.connectionType = 'Connection Type is required';
      if (!formData.routerModel.trim()) newErrors.routerModel = 'Router Model is required';
      if (!formData.modemSN.trim()) newErrors.modemSN = 'Modem SN is required';

      // Check if tech_input is required for PPPoE username
      if (usernamePattern && usernamePattern.sequence.some(item => item.type === 'tech_input')) {
        if (!techInputValue.trim()) {
          newErrors.techInput = 'PPPoE Username is required';
        }
      }

      if (formData.connectionType === 'Antenna') {
        if (!formData.ip.trim()) newErrors.ip = 'IP is required';

      } else if (formData.connectionType === 'Fiber') {
        // Resolved here rather than reusing the `portTotal` computed further down the
        // component, so this check does not depend on declaration order.
        const totalPortsOnLcpnap = Number(
          lcpnaps.find(ln => (ln.lcpnap_name || (ln as any).name) === formData.lcpnap)?.port_total || 0
        ) || 0;

        if (!formData.lcpnap.trim()) newErrors.lcpnap = 'LCP-NAP is required';
        if (!formData.port.trim()) {
          newErrors.port = 'PORT is required';
        } else {
          // The picker already hides taken ports, but a value can survive a change of
          // LCP-NAP or be left over from an earlier edit, so re-check on save.
          const chosen = normalizePortLabel(formData.port);

          if (!chosen) {
            // Non-empty but meaningless ('N/A', '0', '-'), so it would slip past the
            // required check without naming a real port.
            newErrors.port = 'PORT is required';
          } else if (!/^P\d{2,}$/.test(chosen) || Number(chosen.substring(1)) > totalPortsOnLcpnap) {
            newErrors.port = totalPortsOnLcpnap
              ? `PORT ${chosen} does not exist on ${formData.lcpnap} (it has ${totalPortsOnLcpnap} ports)`
              : `PORT ${chosen} is not valid for ${formData.lcpnap}`;
          } else if (usedPorts.has(chosen)) {
            const holder = portOccupants.get(chosen);
            newErrors.port = holder
              ? `PORT ${chosen} is not available — still assigned to ${holder}`
              : `PORT ${chosen} is not available — already in use`;
          }
        }
        if (!formData.vlan.trim()) newErrors.vlan = 'VLAN is required';
      }

      if (!formData.visit_by.trim()) newErrors.visit_by = 'Visit By is required';
      if (!formData.visit_with.trim()) newErrors.visit_with = 'Visit With is required';
      if (!formData.visit_with_other.trim()) newErrors.visit_with_other = 'Visit With(Other) is required';
      if (!formData.onsiteRemarks.trim()) newErrors.onsiteRemarks = 'Onsite Remarks is required';
      if (!formData.addressCoordinates.trim()) newErrors.addressCoordinates = 'Address Coordinates is required';

      const selectedItems = orderItems.filter(item => item.itemId && item.itemId !== 'None');
      const hasNoneItem = orderItems.some(item => item.itemId === 'None');

      if (selectedItems.length === 0 && !hasNoneItem) {
        newErrors.items = 'At least one item or "None" is required';
      } else {
        orderItems.forEach((item, index) => {
          if (item.itemId && item.itemId !== 'None') {
            if (!item.quantity || parseInt(item.quantity) <= 0) {
              newErrors[`quantity_${index}`] = 'Valid quantity is required';
              if (!newErrors.items) newErrors.items = `Quantity required for ${item.itemId}`;
            }
          }
        });
      }

      // Image and Signature Validations for 'Done'
      if (!formData.boxReadingImage && !jobOrderData?.box_reading_image_url && !jobOrderData?.Box_Reading_Image_URL)
        newErrors.boxReadingImage = 'Box Reading Image is required';

      if (!formData.routerReadingImage && !jobOrderData?.router_reading_image_url && !jobOrderData?.Router_Reading_Image_URL)
        newErrors.routerReadingImage = 'Router Reading Image is required';

      if ((formData.connectionType === 'Antenna' || formData.connectionType === 'Local') &&
        !formData.portLabelImage && !jobOrderData?.port_label_image_url && !jobOrderData?.Port_Label_Image_URL)
        newErrors.portLabelImage = 'Port Label Image is required';

      if (!formData.setupImage && !jobOrderData?.setup_image_url && !jobOrderData?.Setup_Image_URL)
        newErrors.setupImage = 'Setup Image is required';

      if (!formData.signedContractImage && !jobOrderData?.signed_contract_image_url && !jobOrderData?.Signed_Contract_Image_URL)
        newErrors.signedContractImage = 'Signed Contract Image is required';

      if (!formData.clientTaggingImage && !jobOrderData?.client_tagging_image_url && !jobOrderData?.Client_Tagging_Image_URL)
        newErrors.clientTaggingImage = 'Client Tagging Image is required';




    }

    if (formData.onsiteStatus === 'Failed' || formData.onsiteStatus === 'Reschedule') {
      if (!formData.visit_by.trim()) newErrors.visit_by = 'Visit By is required';
      if (!formData.visit_with.trim()) newErrors.visit_with = 'Visit With is required';
      if (!formData.visit_with_other.trim()) newErrors.visit_with_other = 'Visit With(Other) is required';
      if (!formData.onsiteRemarks.trim()) newErrors.onsiteRemarks = 'Onsite Remarks is required';
    }

    // Proof Image is mandatory only for Failed and Reschedule statuses
    if ((formData.onsiteStatus === 'Failed' || formData.onsiteStatus === 'Reschedule') && !formData.proofImage && !jobOrderData?.proof_image_url && !jobOrderData?.Proof_Image_URL) {
      newErrors.proofImage = 'Proof Image is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleValidateSN = async () => {
    const sn = formData.modemSN?.trim();
    if (!sn) {
      Alert.alert('Validation Error', 'Please enter a Modem Serial Number first.');
      return;
    }

    if (isValidatingSN || validateCooldown > 0) return;

    if (formData.connectionType !== 'Fiber' && formData.connectionType !== 'Antenna') {
      Alert.alert('Validation Info', 'SN validation is only available for Fiber and Antenna connections.');
      return;
    }

    setIsValidatingSN(true);
    setValidateCooldown(30);
    try {
      const response = await apiClient.get('/smart-olt/validate-sn', {
        params: { 
          sn,
          jo_id: jobOrderData?.id || jobOrderData?.JobOrder_ID,
          user_email: currentUserEmail
        },
        timeout: 15000
      });

      const result = response?.data;

      if (!result || !result.success) {
        const msg = result?.message || 'Serial Number not found in SmartOLT system.';
        Alert.alert('Validation Error', msg);
        setErrors(prev => ({ ...prev, modemSN: msg }));
        setIsSNValidated(false);
        return;
      }

      // Success logic
      setIsSNValidated(true);
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.modemSN;
        return newErrors;
      });

      // Auto-populate router model safely
      const onuType = result.data?.onu_type_name || result.onus?.[0]?.onu_type_name;
      if (onuType) {
        setFormData(prev => ({ ...prev, routerModel: onuType }));
      }

      Alert.alert('Success', 'Modem Serial Number is valid and verified in SmartOLT.');
    } catch (error: any) {
      console.error('[Validation Error]', error);
      const errorMsg = error.response?.data?.message || error.message || 'System communication error. Please check your internet.';
      Alert.alert('Validation Error', errorMsg);
      setErrors(prev => ({ ...prev, modemSN: errorMsg }));
      setIsSNValidated(false);
    } finally {
      setIsValidatingSN(false);
    }
  };

  const handleSave = async () => {
    if (isDrawingSignature) {
      Alert.alert('Signature Required', 'Please click the "Save" button below the signature pad first to confirm your signature.');
      return;
    }

    const updatedFormData = {
      ...formData,
      modifiedBy: currentUserEmail,
      modifiedDate: formatToGMT8Display()
    };

    setFormData(updatedFormData);

    const jobOrderId = jobOrderData?.id || jobOrderData?.JobOrder_ID;

    if (!jobOrderId) {
      showMessageModal('Error', [
        { type: 'error', text: 'Cannot update job order: Missing ID' }
      ]);
      return;
    }

    setLoading(true);
    setShowLoadingModal(true);
    setLoadingPercentage(0);
    setCurrentStep(0);
    setLoadingMessage('Saving images to gallery...');

    const saveMessages: Array<{ type: 'success' | 'warning' | 'error'; text: string }> = [];
    let progressInterval: NodeJS.Timeout | null = null;

    try {


      // 2. Perform Form Validation
      setLoadingMessage('Validating form...');
      setLoadingPercentage(30);
      if (!validateForm()) {
        setLoading(false);
        setShowLoadingModal(false);
        showMessageModal('Validation Error', [
          { type: 'error', text: 'Please fill in all required fields before saving.' }
        ]);
        return;
      }

      // Finalizing and Saving
      setCurrentStep(0);
      setLoadingPercentage(45);
      setLoadingMessage('Finalizing and saving changes...');

      progressInterval = setInterval(() => {
        setLoadingPercentage(prev => {
          if (prev >= 98) return 98;
          return prev + 1;
        });
      }, 500);



      const manilaNow = dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss');

      let jobOrderUpdateData: any = {
        updated_by_user_email: updatedFormData.modifiedBy,
        desired_plan: updatedFormData.choosePlan,
      };

      if (updatedFormData.onsiteStatus === 'In Progress') {
        jobOrderUpdateData.onsite_status = 'In Progress';
      } else if (updatedFormData.onsiteStatus === 'Done') {
        jobOrderUpdateData = {
          ...jobOrderUpdateData,
          onsite_status: 'Done',
          date_installed: updatedFormData.dateInstalled,
          usage_type: updatedFormData.usageType,
          router_model: updatedFormData.routerModel,
          lcpnap: updatedFormData.lcpnap,
          port: updatedFormData.port,
          vlan: updatedFormData.vlan,
          connection_type: updatedFormData.connectionType,
          modem_router_sn: updatedFormData.modemSN,
          ip_address: updatedFormData.ip,
          onsite_remarks: updatedFormData.onsiteRemarks,
          address_coordinates: updatedFormData.addressCoordinates || '',
          visit_by: updatedFormData.visit_by,
          visit_with: updatedFormData.visit_with,
          visit_with_other: updatedFormData.visit_with_other,
        };

        // Only set end_time if it's not already set
        if (!jobOrderData?.end_time && !jobOrderData?.End_Time) {
          jobOrderUpdateData.end_time = manilaNow;
        }

        // Add tech input username if applicable
        const hasTechInput = usernamePattern && usernamePattern.sequence.some(item => (item as any).type === 'tech_input');
        if (hasTechInput && techInputValue.trim()) {
          jobOrderUpdateData.pppoe_username = techInputValue.trim();
        }
      } else if (updatedFormData.onsiteStatus === 'Failed' || updatedFormData.onsiteStatus === 'Reschedule') {
        jobOrderUpdateData = {
          ...jobOrderUpdateData,
          onsite_status: updatedFormData.onsiteStatus,
          visit_by: updatedFormData.visit_by,
          visit_with: updatedFormData.visit_with,
          visit_with_other: updatedFormData.visit_with_other,
          onsite_remarks: updatedFormData.onsiteRemarks,
        };

        // Only set end_time if it's not already set
        if (!jobOrderData?.end_time && !jobOrderData?.End_Time) {
          jobOrderUpdateData.end_time = manilaNow;
        }
      }


      if (['Done', 'Failed', 'Reschedule'].includes(updatedFormData.onsiteStatus)) {
        const firstName = (jobOrderData?.First_Name || jobOrderData?.first_name || '').trim();
        const middleInitial = (jobOrderData?.Middle_Initial || jobOrderData?.middle_initial || '').trim();
        const fullLastName = (jobOrderData?.Last_Name || jobOrderData?.last_name || '').trim();
        const folderName = `(joborder)${firstName} ${middleInitial} ${fullLastName}`.trim();

        const imageFormData = new FormData();
        imageFormData.append('folder_name', folderName);

        let hasImages = false;
        // The same photos, kept so a copy can be filed on the technician's own
        // phone before any of this is sent. Collected here rather than listed
        // again below so the two can never drift apart.
        const galleryItems: { field: string; uri?: string | null }[] = [];

        const safeAppendImage = (fieldName: string, fileObj: any) => {
          if (!fileObj) return;
          const fileName = fileObj.name || `${fieldName}_${Date.now()}.jpg`;
          imageFormData.append(fieldName, fileObj, fileName);
          galleryItems.push({ field: fieldName, uri: fileObj.uri });
          hasImages = true;
        };

        if (updatedFormData.onsiteStatus === 'Done') {

          safeAppendImage('signed_contract_image', formData.signedContractImage);
          safeAppendImage('setup_image', formData.setupImage);
          safeAppendImage('box_reading_image', formData.boxReadingImage);
          safeAppendImage('router_reading_image', formData.routerReadingImage);
          safeAppendImage('port_label_image', formData.portLabelImage);
          safeAppendImage('client_signature_image', formData.clientSignatureImage);
          safeAppendImage('client_tagging_image', formData.clientTaggingImage);
          safeAppendImage('proof_image', formData.proofImage);
        }

        if (updatedFormData.onsiteStatus === 'Failed' || updatedFormData.onsiteStatus === 'Reschedule') {
          safeAppendImage('proof_image', formData.proofImage);
        }

        // Keep a copy on the phone BEFORE anything is uploaded, so a failed
        // upload or a lost connection cannot leave the technician with no
        // record of the visit. Filed as "<field>, <first name> <last name>".
        //
        // Awaited so the copies exist before the request starts, but never
        // allowed to throw: the submission matters more than the keepsake.
        await saveImagesToGallery(
          galleryItems,
          `${firstName} ${fullLastName}`.trim()
        );

        if (hasImages) {

          try {
            const uploadResponse = await apiClient.post<{
              success: boolean;
              message: string;
              data?: {
                signed_contract_image_url?: string;
                setup_image_url?: string;
                box_reading_image_url?: string;
                router_reading_image_url?: string;
                port_label_image_url?: string;
                client_signature_image_url?: string;
                client_tagging_url?: string;
                proof_image_url?: string;
              };
              folder_id?: string;
            }>(`/job-orders/${jobOrderId}/upload-images`, imageFormData, {
              headers: {
                'Content-Type': 'multipart/form-data'
              }
            });

            if (uploadResponse.data.success && uploadResponse.data.data) {
              const imageUrls = uploadResponse.data.data;

              if (imageUrls.signed_contract_image_url) {
                jobOrderUpdateData.signed_contract_image_url = imageUrls.signed_contract_image_url;
              }
              if (imageUrls.setup_image_url) {
                jobOrderUpdateData.setup_image_url = imageUrls.setup_image_url;
              }
              if (imageUrls.box_reading_image_url) {
                jobOrderUpdateData.box_reading_image_url = imageUrls.box_reading_image_url;
              }
              if (imageUrls.router_reading_image_url) {
                jobOrderUpdateData.router_reading_image_url = imageUrls.router_reading_image_url;
              }
              if (imageUrls.port_label_image_url) {
                jobOrderUpdateData.port_label_image_url = imageUrls.port_label_image_url;
              }
              if (imageUrls.client_signature_image_url) {
                jobOrderUpdateData.client_signature_url = imageUrls.client_signature_image_url;
              }
              if (imageUrls.client_tagging_url) {
                jobOrderUpdateData.client_tagging_url = imageUrls.client_tagging_url;
              }
              if (imageUrls.proof_image_url) {
                jobOrderUpdateData.proof_image_url = imageUrls.proof_image_url;
              }
            }
          } catch (uploadError: any) {
            const errorMsg = uploadError.response?.data?.message || uploadError.message || 'Unknown error';
            saveMessages.push({
              type: 'warning',
              text: `Failed to upload images to Google Drive: ${errorMsg}`
            });
          }
        }
      }




      console.log('[API CALL] ========================================');
      console.log('[API CALL] ABOUT TO CALL: updateJobOrder()');
      console.log('[API CALL] Method: PUT');
      console.log('[API CALL] Endpoint: /job-orders/' + jobOrderId);
      console.log('[API CALL] Job Order ID:', jobOrderId);
      console.log('[API CALL] typeof jobOrderId:', typeof jobOrderId);
      console.log('[API CALL] Update Data Keys:', Object.keys(jobOrderUpdateData));
      console.log('[API CALL] Full Update Data:', JSON.stringify(jobOrderUpdateData, null, 2));
      console.log('[API CALL] IMPORTANT: This should UPDATE existing row, NOT create new row');
      console.log('[API CALL] ========================================');

      let jobOrderResponse: any;
      let radiusWarning: string | null = null;

      try {
        jobOrderResponse = await updateJobOrder(jobOrderId, jobOrderUpdateData);
      } catch (apiError: any) {
        // Check if the backend returned job_order_saved:true (JO saved but RADIUS failed)
        const responseData = apiError?.response?.data;
        if (responseData?.job_order_saved === true) {
          // Job order WAS saved — treat RADIUS failure as a warning, not a blocking error
          console.warn('[API WARNING] Job order saved but RADIUS failed:', responseData.message);
          jobOrderResponse = { success: true, data: responseData.data, message: responseData.message };
          radiusWarning = responseData.message || 'RADIUS account creation failed';
        } else {
          // Real error — rethrow
          throw apiError;
        }
      }

      console.log('[API RESPONSE] ========================================');
      console.log('[API RESPONSE] updateJobOrder completed');
      console.log('[API RESPONSE] Full response:', JSON.stringify(jobOrderResponse, null, 2));
      console.log('[API RESPONSE] success:', jobOrderResponse?.success);
      console.log('[API RESPONSE] message:', jobOrderResponse?.message);
      console.log('[API RESPONSE] data:', jobOrderResponse?.data);
      console.log('[API RESPONSE] ========================================');

      if (!jobOrderResponse.success) {
        console.error('[SAVE ERROR] updateJobOrder failed:', jobOrderResponse);
        throw new Error(jobOrderResponse.message || 'Job order update failed');
      }

      console.log('[SAVE SUCCESS] Job order updated successfully');

      saveMessages.push({
        type: 'success',
        text: 'Job order updated successfully'
      });

      // If RADIUS failed but JO was saved, show it as a warning
      if (radiusWarning) {
        saveMessages.push({
          type: 'warning',
          text: `RADIUS: ${radiusWarning}. The job order has been saved. Please retry RADIUS creation manually.`
        });
      }

      // Clear saved draft
      if (jobOrderId) {
        try {
          await AsyncStorage.removeItem(`jobOrderDraft_${jobOrderId}`);
          await AsyncStorage.removeItem(`jobOrderItemsDraft_${jobOrderId}`);
        } catch (e) {
          console.error('Error clearing draft:', e);
        }
      }

      // Show PPPoE credentials if backend returned them
      if (updatedFormData.onsiteStatus === 'Done' && jobOrderResponse.data) {
        const { pppoe_username, pppoe_password } = jobOrderResponse.data;
        if (pppoe_username && pppoe_password) {
          saveMessages.push({
            type: 'success',
            text: `RADIUS/PPPoE Credentials: Username: ${pppoe_username}, Password: ${pppoe_password}`
          });
        }
      }

      let applicationId = jobOrderData.application_id || jobOrderData.Application_ID || jobOrderData.account_id;

      if (!applicationId) {
        try {
          const jobOrderResponse = await apiClient.get<{ success: boolean; data: any }>(`/job-orders/${jobOrderId}`);
          if (jobOrderResponse.data.success && jobOrderResponse.data.data) {
            applicationId = jobOrderResponse.data.data.application_id;
          }
        } catch (fetchError: any) {
        }
      }

      if (applicationId && updatedFormData.onsiteStatus !== 'In Progress') {
        try {
          const firstName = jobOrderData?.First_Name || jobOrderData?.first_name || '';
          const middleInitial = jobOrderData?.Middle_Initial || jobOrderData?.middle_initial || '';
          const lastName = jobOrderData?.Last_Name || jobOrderData?.last_name || '';
          const mobileNumber = jobOrderData?.Mobile_Number || jobOrderData?.mobile_number || '';
          const secondaryMobile = jobOrderData?.Secondary_Mobile_Number || jobOrderData?.secondary_mobile_number || '';
          const emailAddress = jobOrderData?.Email_Address || jobOrderData?.email_address || '';
          const installationAddress = jobOrderData?.Installation_Address || jobOrderData?.installation_address || '';
          const landmark = jobOrderData?.Landmark || jobOrderData?.landmark || '';
          // Passed straight through, so the id the record carries is what goes
          // out. The name beside it would lose which agent it was.
          const referredBy = referredByEcho(
            jobOrderData,
            jobOrderData?.Referred_By || jobOrderData?.referred_by || ''
          );
          const promo = jobOrderData?.Promo || jobOrderData?.promo || '';

          const applicationUpdateData: any = {
            first_name: firstName,
            middle_initial: middleInitial,
            last_name: lastName,
            mobile_number: mobileNumber,
            secondary_mobile_number: secondaryMobile,
            email_address: emailAddress,
            installation_address: installationAddress,
            landmark: landmark,
            region: updatedFormData.region,
            city: updatedFormData.city,
            barangay: updatedFormData.barangay,
            desired_plan: updatedFormData.choosePlan,
            referred_by: referredBy,
            promo: promo,
            long_lat: updatedFormData.addressCoordinates || '',
            updated_by: updatedFormData.modifiedBy
          };

          const applicationResponse = await updateApplication(applicationId.toString(), applicationUpdateData);

          saveMessages.push({
            type: 'success',
            text: `Application updated: Plan: ${updatedFormData.choosePlan}, Location: ${updatedFormData.region}, ${updatedFormData.city}, ${updatedFormData.barangay}`
          });
        } catch (appError: any) {
          const errorMsg = appError.response?.data?.message || appError.message || 'Unknown error';
          saveMessages.push({
            type: 'warning',
            text: `Application update failed: ${errorMsg} (Application ID: ${applicationId})`
          });
        }
      } else {
        saveMessages.push({
          type: 'warning',
          text: 'Cannot update application - missing application ID'
        });
      }

      if (updatedFormData.onsiteStatus === 'Done') {
        const validItems = orderItems.filter(item => {
          const quantity = parseInt(item.quantity);
          const isValid = item.itemId && item.itemId.trim() !== '' && !isNaN(quantity) && quantity > 0;
          return isValid;
        });

        if (validItems.length > 0) {
          try {
            const numericJobOrderId = parseInt((jobOrderData.JobOrder_ID || jobOrderData.id || 0).toString());
            if (!numericJobOrderId || isNaN(numericJobOrderId)) {
              throw new Error('Invalid Job Order ID for items saving');
            }

            const itemsToCreate: JobOrderItem[] = validItems.map(item => ({
              job_order_id: numericJobOrderId,
              item_name: item.itemId,
              quantity: parseInt(item.quantity)
            }));

            const createResponse = await createJobOrderItems(itemsToCreate);
            if (!createResponse.success) {
              throw new Error(createResponse.message || 'Failed to create job order items');
            }
          } catch (itemsError: any) {
            saveMessages.push({
              type: 'warning',
              text: `Items saving warning: ${itemsError.message || 'Check connection'}`
            });
          }
        }
      }

      if (progressInterval) clearInterval(progressInterval);
      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      setErrors({});
      setLoading(false);
      setShowLoadingModal(false);
      setLoadingPercentage(0);
      onSave(updatedFormData);
      DeviceEventEmitter.emit('jobOrderUpdated');
      onClose();
    } catch (error: any) {
      if (progressInterval) clearInterval(progressInterval);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error occurred';

      setLoading(false);
      setShowLoadingModal(false);
      setLoadingPercentage(0);

      // Detect SN-related validation errors and highlight the modemSN field
      const lowerError = errorMessage.toLowerCase();
      if (
        lowerError.includes('smart olt') ||
        lowerError.includes('sn duplicate') ||
        lowerError.includes('sn not existing') ||
        lowerError.includes('duplicate detected')
      ) {
        setErrors(prev => ({ ...prev, modemSN: errorMessage }));
      }

      // Build a specific, descriptive error message based on the source of the failure
      let displayMessage: string;

      const isRadiusError =
        lowerError.includes('radius') ||
        lowerError.includes('it has a duplicate on onboarded customer');

      const isSmartOltError =
        lowerError.includes('smart olt') ||
        lowerError.includes('smartolt') ||
        lowerError.includes('sn duplicate') ||
        lowerError.includes('sn not existing') ||
        lowerError.includes('duplicate detected');

      if (isRadiusError) {
        displayMessage = `It has an error in Radius due to:\n${errorMessage}`;
      } else if (isSmartOltError) {
        displayMessage = `It has an error in the Smart OLT due to:\n${errorMessage}`;
      } else {
        displayMessage = `Backend error due to:\n${errorMessage}\n\nPlease contact support.`;
      }

      showMessageModal('Error', [
        { type: 'error', text: displayMessage }
      ]);
    }
  };

  const fullName = useMemo(() => `${jobOrderData?.First_Name || jobOrderData?.first_name || ''} ${jobOrderData?.Middle_Initial || jobOrderData?.middle_initial || ''} ${jobOrderData?.Last_Name || jobOrderData?.last_name || ''}`.trim(), [jobOrderData?.id, jobOrderData?.JobOrder_ID, jobOrderData?.First_Name, jobOrderData?.Last_Name]);

  const selectedLcpnap = useMemo(() => {
    const safeLcpnaps = Array.isArray(lcpnaps) ? lcpnaps : [];
    return safeLcpnaps.find(ln => ln && ln.lcpnap_name === formData.lcpnap);
  }, [lcpnaps, formData.lcpnap]);
  const portTotal = Number(selectedLcpnap?.port_total || 0) || 0;

  // Memoize filtered lists to prevent expensive re-computation on every render
  const filteredRouterModels = useMemo(() => {
    const query = (routerModelSearch || '').toLowerCase();
    const safeRouterModels = Array.isArray(routerModels) ? routerModels : [];
    return safeRouterModels
      .filter(rm => {
        if (!rm || !rm.model) return false;
        return String(rm.model).toLowerCase().includes(query);
      })
      .slice(0, 50);
  }, [routerModels, routerModelSearch]);

  const onsiteStatuses = useMemo(() => ['In Progress', 'Done', 'Failed', 'Reschedule'], []);
  const filteredOnsiteStatuses = useMemo(() => {
    return onsiteStatuses.filter(s => s.toLowerCase().includes(onsiteStatusSearch.toLowerCase()));
  }, [onsiteStatusSearch, onsiteStatuses]);

  const filteredLcpnaps = useMemo(() => {
    const query = (lcpnapSearch || '').toLowerCase();
    const safeLcpnaps = Array.isArray(lcpnaps) ? lcpnaps : [];
    const safeMostUsed = Array.isArray(mostUsedLcpnaps) ? mostUsedLcpnaps : [];

    if (!query) {
      return safeMostUsed.filter(ln => ln && (ln.lcpnap_name || (ln as any).name));
    }

    return safeLcpnaps
      .filter(ln => {
        if (!ln) return false;
        const name = ln.lcpnap_name || (ln as any).name || '';
        return String(name).toLowerCase().includes(query);
      })
      .slice(0, 50);
  }, [lcpnaps, lcpnapSearch, mostUsedLcpnaps]);

  const filteredInventoryItems = useMemo(() => {
    const query = (itemSearchModal || '').toLowerCase();
    const safeInventoryItems = Array.isArray(inventoryItems) ? inventoryItems : [];
    return safeInventoryItems
      .filter(invItem => {
        if (!invItem || !invItem.item_name) return false;
        return String(invItem.item_name).toLowerCase().includes(query);
      })
      .slice(0, 50);
  }, [inventoryItems, itemSearchModal]);

  const visitByTechnicians = useMemo(() =>
    technicians.filter(t => t.name !== formData.visit_with && t.name !== formData.visit_with_other),
    [technicians, formData.visit_with, formData.visit_with_other]
  );

  const visitWithTechnicians = useMemo(() =>
    technicians.filter(t => t.name !== formData.visit_by && t.name !== formData.visit_with_other),
    [technicians, formData.visit_by, formData.visit_with_other]
  );

  const visitWithOtherTechnicians = useMemo(() =>
    technicians.filter(t => t.name !== formData.visit_by && t.name !== formData.visit_with),
    [technicians, formData.visit_by, formData.visit_with]
  );

  const failedVisitByTechnicians = useMemo(() =>
    technicians, [technicians]
  );

  const failedVisitWithTechnicians = useMemo(() =>
    technicians.filter(t => t.name !== formData.visit_by),
    [technicians, formData.visit_by]
  );

  const failedVisitWithOtherTechnicians = useMemo(() =>
    technicians.filter(t => t.name !== formData.visit_by && t.name !== formData.visit_with),
    [technicians, formData.visit_by, formData.visit_with]
  );

  const handleLcpnapItemPress = useCallback((name: string) => {
    handleInputChange('lcpnap', name);
    setIsLcpnapMiniModalVisible(false);
    setLcpnapSearch('');
    Keyboard.dismiss();
  }, [handleInputChange]);

  const handleRouterModelItemPress = useCallback((model: string) => {
    handleInputChange('routerModel', model);
    setIsRouterModelMiniModalVisible(false);
    setRouterModelSearch('');
    Keyboard.dismiss();
  }, [handleInputChange]);

  const handleInventoryItemPress = useCallback((name: string) => {
    if (activeItemIndex !== null) {
      handleItemChange(activeItemIndex, 'itemId', name);
    }
    setIsItemMiniModalVisible(false);
    setItemSearchModal('');
    setActiveItemIndex(null);
    Keyboard.dismiss();
  }, [activeItemIndex, handleItemChange]);

  const handleUsageTypeItemPress = useCallback((name: string) => {
    handleInputChange('usageType', name);
    setIsUsageTypeMiniModalVisible(false);
    setUsageTypeSearch('');
    Keyboard.dismiss();
  }, [handleInputChange]);

  const handlePortItemPress = useCallback((name: string) => {
    handleInputChange('port', name);
    setIsPortMiniModalVisible(false);
    setPortSearch('');
    Keyboard.dismiss();
  }, [handleInputChange]);

  const handleVlanItemPress = useCallback((name: string) => {
    handleInputChange('vlan', name);
    setIsVlanMiniModalVisible(false);
    setVlanSearch('');
    Keyboard.dismiss();
  }, [handleInputChange]);

  const handleTechItemPress = useCallback((name: string) => {
    if (activeTechField) {
      handleInputChange(activeTechField, name);
    }
    setIsTechMiniModalVisible(false);
    setTechSearch('');
    setActiveTechField(null);
    Keyboard.dismiss();
  }, [activeTechField, handleInputChange]);

  const filteredUsageTypes = useMemo(() => {
    const query = (usageTypeSearch || '').toLowerCase();
    const safeUsageTypes = Array.isArray(usageTypes) ? usageTypes : [];
    return safeUsageTypes
      .filter(ut => ut != null)
      .map(ut => String(ut.usage_name || (ut as any).Usage_Name || ''))
      .filter(name => name && name.toLowerCase().includes(query))
      .slice(0, 50);
  }, [usageTypes, usageTypeSearch]);

  const availablePorts = useMemo(() => {
    const ports = Array.from({ length: portTotal }, (_, i) => `P${(i + 1).toString().padStart(2, '0')}`);
    const safeUsedPorts = usedPorts instanceof Set ? usedPorts : new Set<string>();
    return ports.filter(p => !safeUsedPorts.has(p));
  }, [portTotal, usedPorts]);

  const filteredPorts = useMemo(() => {
    const query = (portSearch || '').toLowerCase();
    const safeAvailablePorts = Array.isArray(availablePorts) ? availablePorts : [];
    return safeAvailablePorts
      .filter(p => p && p.toLowerCase().includes(query))
      .slice(0, 50);
  }, [availablePorts, portSearch]);

  const filteredVlans = useMemo(() => {
    const query = (vlanSearch || '').toLowerCase();
    const safeVlans = Array.isArray(vlans) ? vlans : [];
    return safeVlans
      .filter(vlan => vlan && vlan.value != null)
      .map(vlan => vlan.value!.toString())
      .filter(v => v.toLowerCase().includes(query))
      .slice(0, 50);
  }, [vlans, vlanSearch]);

  const filteredTechs = useMemo(() => {
    const query = (techSearch || '').toLowerCase();
    let list = Array.isArray(technicians) ? technicians : [];
    if (activeTechField === 'visit_by') list = Array.isArray(visitByTechnicians) ? visitByTechnicians : [];
    else if (activeTechField === 'visit_with') list = Array.isArray(visitWithTechnicians) ? visitWithTechnicians : [];
    else if (activeTechField === 'visit_with_other') list = Array.isArray(visitWithOtherTechnicians) ? visitWithOtherTechnicians : [];

    // Add "None" for Visit With and Visit With Other
    const finalList = (activeTechField === 'visit_with' || activeTechField === 'visit_with_other')
      ? [{ name: 'None', email: '' }, ...list]
      : list;

    return finalList
      .filter(t => t && t.name && t.name.toLowerCase().includes(query))
      .slice(0, 50);
  }, [technicians, techSearch, activeTechField, visitByTechnicians, visitWithTechnicians, visitWithOtherTechnicians]);

  const renderLcpnapItem = useCallback(({ item, extraData }: any) => {
    if (!item) return null;
    const name = item.lcpnap_name || item.name || '';
    if (!name) return null;
    return (
      <MiniModalItem
        label={name}
        isSelected={extraData && extraData.selectedValue === name}
        onPress={extraData && extraData.onPress}
        isDarkMode={extraData && extraData.isDarkMode}
        primaryColor={(extraData && extraData.primaryColor) || '#7c3aed'}
      />
    );
  }, []);

  const renderRouterModelItem = useCallback(({ item, extraData }: any) => {
    if (!item?.model) return null;
    return (
      <MiniModalItem
        label={item.model}
        isSelected={extraData.selectedValue === item.model}
        onPress={extraData.onPress}
        isDarkMode={extraData.isDarkMode}
        primaryColor={extraData.primaryColor}
      />
    );
  }, []);

  const renderItemItem = useCallback(({ item, extraData }: any) => {
    if (!item?.item_name) return null;
    return (
      <MiniModalItem
        label={item.item_name}
        isSelected={extraData.selectedValue === item.item_name}
        onPress={extraData.onPress}
        isDarkMode={extraData.isDarkMode}
        primaryColor={extraData.primaryColor}
        imageUrl={item.image_url ? convertGoogleDriveUrl(item.image_url) : null}
      />
    );
  }, []);

  const renderUsageTypeItem = useCallback(({ item, extraData }: any) => (
    <MiniModalItem
      label={item}
      isSelected={extraData.selectedValue === item}
      onPress={extraData.onPress}
      isDarkMode={extraData.isDarkMode}
      primaryColor={extraData.primaryColor}
    />
  ), []);

  const renderPortItem = useCallback(({ item, extraData }: any) => (
    <MiniModalItem
      label={item}
      isSelected={extraData.selectedValue === item}
      onPress={extraData.onPress}
      isDarkMode={extraData.isDarkMode}
      primaryColor={extraData.primaryColor}
    />
  ), []);

  const renderVlanItem = useCallback(({ item, extraData }: any) => (
    <MiniModalItem
      label={item}
      isSelected={extraData.selectedValue === item}
      onPress={extraData.onPress}
      isDarkMode={extraData.isDarkMode}
      primaryColor={extraData.primaryColor}
    />
  ), []);

  const renderTechItem = useCallback(({ item, extraData }: any) => (
    <MiniModalItem
      label={item.name}
      isSelected={extraData.selectedValue === item.name}
      onPress={extraData.onPress}
      isDarkMode={extraData.isDarkMode}
      primaryColor={extraData.primaryColor}
    />
  ), []);

  const lcpnapExtraData = useMemo(() => ({
    selectedValue: formData.lcpnap,
    onPress: handleLcpnapItemPress,
    isDarkMode,
    primaryColor: colorPalette?.primary || '#7c3aed'
  }), [formData.lcpnap, handleLcpnapItemPress, isDarkMode, colorPalette?.primary]);

  const routerModelExtraData = useMemo(() => ({
    selectedValue: formData.routerModel,
    onPress: handleRouterModelItemPress,
    isDarkMode,
    primaryColor: colorPalette?.primary || '#7c3aed'
  }), [formData.routerModel, handleRouterModelItemPress, isDarkMode, colorPalette?.primary]);

  const itemExtraData = useMemo(() => ({
    selectedValue: activeItemIndex !== null ? orderItems[activeItemIndex]?.itemId : '',
    onPress: handleInventoryItemPress,
    isDarkMode,
    primaryColor: colorPalette?.primary || '#7c3aed'
  }), [activeItemIndex, orderItems, handleInventoryItemPress, isDarkMode, colorPalette?.primary]);

  const usageTypeExtraData = useMemo(() => ({
    selectedValue: formData.usageType,
    onPress: handleUsageTypeItemPress,
    isDarkMode,
    primaryColor: colorPalette?.primary || '#7c3aed'
  }), [formData.usageType, handleUsageTypeItemPress, isDarkMode, colorPalette?.primary]);

  const portExtraData = useMemo(() => ({
    selectedValue: formData.port,
    onPress: handlePortItemPress,
    isDarkMode,
    primaryColor: colorPalette?.primary || '#7c3aed'
  }), [formData.port, handlePortItemPress, isDarkMode, colorPalette?.primary]);

  const vlanExtraData = useMemo(() => ({
    selectedValue: formData.vlan,
    onPress: handleVlanItemPress,
    isDarkMode,
    primaryColor: colorPalette?.primary || '#7c3aed'
  }), [formData.vlan, handleVlanItemPress, isDarkMode, colorPalette?.primary]);

  const techExtraData = useMemo(() => ({
    selectedValue: activeTechField ? formData[activeTechField] : '',
    onPress: handleTechItemPress,
    isDarkMode,
    primaryColor: colorPalette?.primary || '#7c3aed'
  }), [activeTechField, formData, handleTechItemPress, isDarkMode, colorPalette?.primary]);

  return (
    <>

      {/* ─── Loading Modal with Validation Steps ─────────────────────────── */}
      <Modal
        visible={showLoadingModal}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
      >
        <View style={styles.loadingModalOverlay}>
          <View style={[styles.loadingModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
            <ActivityIndicator size="large" color={colorPalette?.primary || '#7c3aed'} />
            <Text style={[styles.loadingPercentage, { color: colorPalette?.primary || '#7c3aed', marginTop: 16 }]}>
              {Math.round(loadingPercentage)}%
            </Text>
            <Text style={{
              marginTop: 8,
              color: isDarkMode ? '#e5e7eb' : '#374151',
              fontSize: 16,
              fontWeight: '600',
              textAlign: 'center'
            }}>
              {loadingMessage || 'Processing...'}
            </Text>

            {/* Steps indicator */}
            <View style={{ marginTop: 24, width: '100%' }}>
              {[
                'Saving changes'
              ].map((step, index) => (
                <View key={index} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <View style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: currentStep > index
                      ? '#10b981'
                      : (currentStep === index ? (colorPalette?.primary || '#7c3aed') : (isDarkMode ? '#374151' : '#e5e7eb')),
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 12
                  }}>
                    {currentStep > index ? (
                      <Check size={14} color="white" />
                    ) : (
                      <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{index + 1}</Text>
                    )}
                  </View>
                  <Text style={{
                    color: currentStep >= index
                      ? (isDarkMode ? '#ffffff' : '#111827')
                      : (isDarkMode ? '#9ca3af' : '#6b7280'),
                    fontSize: 14,
                    fontWeight: currentStep === index ? 'bold' : 'normal'
                  }}>
                    {step}
                  </Text>
                  {currentStep === index && (
                    <ActivityIndicator size="small" color={colorPalette?.primary || '#7c3aed'} style={{ marginLeft: 8 }} />
                  )}
                </View>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Message Modal ───────────────────────────────────────────── */}
      <Modal
        visible={showModal}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.messageModalOverlay}>
          <View style={[styles.messageModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
            <View style={[styles.messageModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
              <Text style={[styles.messageModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>{modalContent.title}</Text>
              <Pressable
                onPress={() => setShowModal(false)}
                style={styles.messageModalClose}
              >
                <X size={20} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
              </Pressable>
            </View>
            <View style={styles.messageList}>
              <View>
                {modalContent.messages.map((message, index) => (
                  <View
                    key={index}
                    style={[styles.messageItem, {
                      backgroundColor: message.type === 'success'
                        ? (isDarkMode ? 'rgba(20, 83, 45, 0.3)' : '#dcfce7')
                        : message.type === 'warning'
                          ? (isDarkMode ? 'rgba(113, 63, 18, 0.3)' : '#fef9c3')
                          : (isDarkMode ? 'rgba(127, 29, 29, 0.3)' : '#fee2e2'),
                      borderColor: message.type === 'success'
                        ? (isDarkMode ? '#15803d' : '#86efac')
                        : message.type === 'warning'
                          ? (isDarkMode ? '#a16207' : '#fde047')
                          : (isDarkMode ? '#b91c1c' : '#fca5a5')
                    }]}
                  >
                    {message.type === 'success' && (
                      <CheckCircle color="#22c55e" size={20} style={{ marginTop: 2 }} />
                    )}
                    {message.type === 'warning' && (
                      <AlertCircle color="#eab308" size={20} style={{ marginTop: 2 }} />
                    )}
                    {message.type === 'error' && (
                      <XCircle color="#ef4444" size={20} style={{ marginTop: 2 }} />
                    )}
                    <Text
                      style={[styles.messageText, {
                        color: message.type === 'success'
                          ? (isDarkMode ? '#bbf7d0' : '#166534')
                          : message.type === 'warning'
                            ? (isDarkMode ? '#fef08a' : '#854d0e')
                            : (isDarkMode ? '#fecaca' : '#991b1b')
                      }]}
                    >
                      {message.text}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.messageModalFooter, { borderTopColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
              <Pressable
                onPress={() => setShowModal(false)}
                style={[styles.messageModalButton, {
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }]}
              >
                <Text style={styles.messageModalButtonText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── LCP-NAP Mini Modal ──────────────────────────────────────── */}
      {isLcpnapMiniModalVisible && (
        <Modal
          visible={isLcpnapMiniModalVisible}
          transparent={true}
          animationType="fade"
          statusBarTranslucent={true}
          onRequestClose={() => setIsLcpnapMiniModalVisible(false)}
        >
          <View style={styles.miniModalOverlay}>
            <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
              <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Select LCP-NAP</Text>
                <Pressable onPress={() => setIsLcpnapMiniModalVisible(false)} style={styles.miniModalClose}>
                  <X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                </Pressable>
              </View>
              <View style={styles.miniModalSearchContainer}>
                <View style={[styles.searchContainer, {
                  backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
                  borderColor: isDarkMode ? '#374151' : '#e5e7eb'
                }]}>
                  <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                  <TextInput
                    placeholder="Search LCP-NAP..."
                    value={lcpnapSearch}
                    onChangeText={setLcpnapSearch}
                    placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                    style={[styles.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]}
                    autoFocus={isLcpnapMiniModalVisible}
                  />
                  {lcpnapSearch.length > 0 && (
                    <Pressable onPress={() => setLcpnapSearch('')}>
                      <X size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={{ height: 350, width: '100%' }}>
                <FlashList
                  data={filteredLcpnaps}
                  extraData={lcpnapExtraData}
                  // @ts-ignore
                  estimatedItemSize={60}
                  keyExtractor={(item, index) => {
                    if (!item) return index.toString();
                    const itemId = item.id || (item as any).ID;
                    return itemId ? itemId.toString() : index.toString();
                  }}
                  ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
                  renderItem={renderLcpnapItem}
                  ListEmptyComponent={
                    <View style={styles.miniModalEmpty}>
                      <Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: 16 }}>No results found</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingHorizontal: 40, paddingBottom: 20 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* ─── Router Model Mini Modal ─────────────────────────────────── */}
      {isRouterModelMiniModalVisible && (
        <Modal
          visible={isRouterModelMiniModalVisible}
          transparent={true}
          animationType="fade"
          statusBarTranslucent={true}
          onRequestClose={() => setIsRouterModelMiniModalVisible(false)}
        >
          <View style={styles.miniModalOverlay}>
            <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
              <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Select Router Model</Text>
                <Pressable onPress={() => setIsRouterModelMiniModalVisible(false)} style={styles.miniModalClose}>
                  <X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                </Pressable>
              </View>
              <View style={styles.miniModalSearchContainer}>
                <View style={[styles.searchContainer, {
                  backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
                  borderColor: isDarkMode ? '#374151' : '#e5e7eb'
                }]}>
                  <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                  <TextInput
                    placeholder="Search Router Model..."
                    value={routerModelSearch}
                    onChangeText={setRouterModelSearch}
                    placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                    autoFocus={isRouterModelMiniModalVisible}
                    style={[styles.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]}
                  />
                  {routerModelSearch.length > 0 && (
                    <Pressable onPress={() => setRouterModelSearch('')}>
                      <X size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={{ height: 350, width: '100%' }}>
                <FlashList
                  data={filteredRouterModels}
                  extraData={routerModelExtraData}
                  // @ts-ignore
                  estimatedItemSize={60}
                  keyExtractor={(item, index) => {
                    if (!item) return index.toString();
                    const model = item.model;
                    return model ? model.toString() : index.toString();
                  }}
                  ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
                  renderItem={renderRouterModelItem}
                  ListEmptyComponent={
                    <View style={styles.miniModalEmpty}>
                      <Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: 16 }}>No results found</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingHorizontal: 40, paddingBottom: 20 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* ─── Item Selection Mini Modal ───────────────────────────────── */}
      {isItemMiniModalVisible && (
        <Modal
          visible={isItemMiniModalVisible}
          transparent={true}
          animationType="fade"
          statusBarTranslucent={true}
          onRequestClose={() => setIsItemMiniModalVisible(false)}
        >
          <View style={styles.miniModalOverlay}>
            <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
              <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Select Item</Text>
                <Pressable onPress={() => setIsItemMiniModalVisible(false)} style={styles.miniModalClose}>
                  <X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                </Pressable>
              </View>
              <View style={styles.miniModalSearchContainer}>
                <View style={[styles.searchContainer, {
                  backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
                  borderColor: isDarkMode ? '#374151' : '#e5e7eb'
                }]}>
                  <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                  <TextInput
                    placeholder="Search Item..."
                    value={itemSearchModal}
                    onChangeText={setItemSearchModal}
                    placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                    style={[styles.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]}
                    autoFocus={isItemMiniModalVisible}
                  />
                  {itemSearchModal.length > 0 && (
                    <Pressable onPress={() => setItemSearchModal('')}>
                      <X size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={{ height: 350, width: '100%' }}>
                <FlashList
                  data={[
                    ...("None".toLowerCase().includes(itemSearchModal.toLowerCase()) ? [{ id: -1, item_name: 'None', image_url: null } as any] : []),
                    ...filteredInventoryItems
                  ]}
                  extraData={itemExtraData}
                  // @ts-ignore
                  estimatedItemSize={60}
                  keyExtractor={(item, index) => {
                    if (!item) return index.toString();
                    const itemId = item.id || (item as any).ID;
                    return itemId !== undefined ? itemId.toString() : index.toString();
                  }}
                  ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
                  renderItem={renderItemItem}
                  ListEmptyComponent={
                    <View style={styles.miniModalEmpty}>
                      <Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: 16 }}>No results found</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingHorizontal: 40, paddingBottom: 20 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* ─── Onsite Status Mini Modal ───────────────────────────────── */}
      <SearchablePicker
        isOpen={isOnsiteStatusPickerOpen}
        onClose={() => setIsOnsiteStatusPickerOpen(false)}
        title="Select Onsite Status"
        data={filteredOnsiteStatuses}
        onSelect={(item) => {
          handleInputChange('onsiteStatus', item);
          setIsOnsiteStatusPickerOpen(false);
        }}
        keyExtractor={(item) => item}
        searchValue={onsiteStatusSearch}
        onSearchChange={setOnsiteStatusSearch}
        placeholder="Search Status..."
        isDarkMode={isDarkMode}
        activeColor={colorPalette?.primary || '#7c3aed'}
        selectedItemValue={formData.onsiteStatus}
      />

      {/* ─── Usage Type Mini Modal ──────────────────────────────────── */}
      {isUsageTypeMiniModalVisible && (
        <Modal
          visible={isUsageTypeMiniModalVisible}
          transparent={true}
          animationType="fade"
          statusBarTranslucent={true}
          onRequestClose={() => setIsUsageTypeMiniModalVisible(false)}
        >
          <View style={styles.miniModalOverlay}>
            <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
              <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Select Usage Type</Text>
                <Pressable onPress={() => setIsUsageTypeMiniModalVisible(false)} style={styles.miniModalClose}>
                  <X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                </Pressable>
              </View>
              <View style={styles.miniModalSearchContainer}>
                <View style={[styles.searchContainer, {
                  backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
                  borderColor: isDarkMode ? '#374151' : '#e5e7eb'
                }]}>
                  <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                  <TextInput
                    placeholder="Search Usage Type..."
                    value={usageTypeSearch}
                    onChangeText={setUsageTypeSearch}
                    placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                    style={[styles.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]}
                    autoFocus={isUsageTypeMiniModalVisible}
                  />
                  {usageTypeSearch.length > 0 && (
                    <Pressable onPress={() => setUsageTypeSearch('')}>
                      <X size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={{ height: 350, width: '100%' }}>
                <FlashList
                  data={filteredUsageTypes}
                  extraData={usageTypeExtraData}
                  // @ts-ignore
                  estimatedItemSize={60}
                  keyExtractor={(item, index) => index.toString()}
                  ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
                  renderItem={renderUsageTypeItem}
                  ListEmptyComponent={
                    <View style={styles.miniModalEmpty}>
                      <Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: 16 }}>No results found</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingHorizontal: 40, paddingBottom: 20 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* ─── Port Mini Modal ────────────────────────────────────────── */}
      {isPortMiniModalVisible && (
        <Modal
          visible={isPortMiniModalVisible}
          transparent={true}
          animationType="fade"
          statusBarTranslucent={true}
          onRequestClose={() => setIsPortMiniModalVisible(false)}
        >
          <View style={styles.miniModalOverlay}>
            <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
              <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Select PORT</Text>
                <Pressable onPress={() => setIsPortMiniModalVisible(false)} style={styles.miniModalClose}>
                  <X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                </Pressable>
              </View>
              <View style={styles.miniModalSearchContainer}>
                <View style={[styles.searchContainer, {
                  backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
                  borderColor: isDarkMode ? '#374151' : '#e5e7eb'
                }]}>
                  <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                  <TextInput
                    placeholder="Search PORT..."
                    value={portSearch}
                    onChangeText={setPortSearch}
                    placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                    style={[styles.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]}
                    autoFocus={isPortMiniModalVisible}
                  />
                  {portSearch.length > 0 && (
                    <Pressable onPress={() => setPortSearch('')}>
                      <X size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={{ height: 350, width: '100%' }}>
                <FlashList
                  data={filteredPorts}
                  extraData={portExtraData}
                  // @ts-ignore
                  estimatedItemSize={60}
                  keyExtractor={(item, index) => index.toString()}
                  ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
                  renderItem={renderPortItem}
                  ListEmptyComponent={
                    <View style={styles.miniModalEmpty}>
                      <Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: 16 }}>No results found</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingHorizontal: 40, paddingBottom: 20 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* ─── Vlan Mini Modal ────────────────────────────────────────── */}
      {isVlanMiniModalVisible && (
        <Modal
          visible={isVlanMiniModalVisible}
          transparent={true}
          animationType="fade"
          statusBarTranslucent={true}
          onRequestClose={() => setIsVlanMiniModalVisible(false)}
        >
          <View style={styles.miniModalOverlay}>
            <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
              <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>Select VLAN</Text>
                <Pressable onPress={() => setIsVlanMiniModalVisible(false)} style={styles.miniModalClose}>
                  <X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                </Pressable>
              </View>
              <View style={styles.miniModalSearchContainer}>
                <View style={[styles.searchContainer, {
                  backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
                  borderColor: isDarkMode ? '#374151' : '#e5e7eb'
                }]}>
                  <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                  <TextInput
                    placeholder="Search VLAN..."
                    value={vlanSearch}
                    onChangeText={setVlanSearch}
                    placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                    style={[styles.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]}
                    autoFocus={isVlanMiniModalVisible}
                  />
                  {vlanSearch.length > 0 && (
                    <Pressable onPress={() => setVlanSearch('')}>
                      <X size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={{ height: 350, width: '100%' }}>
                <FlashList
                  data={filteredVlans}
                  extraData={vlanExtraData}
                  // @ts-ignore
                  estimatedItemSize={60}
                  keyExtractor={(item, index) => index.toString()}
                  ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
                  renderItem={renderVlanItem}
                  ListEmptyComponent={
                    <View style={styles.miniModalEmpty}>
                      <Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: 16 }}>No results found</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingHorizontal: 40, paddingBottom: 20 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* ─── Technician Mini Modal ──────────────────────────────────── */}
      {isTechMiniModalVisible && (
        <Modal
          visible={isTechMiniModalVisible}
          transparent={true}
          animationType="fade"
          statusBarTranslucent={true}
          onRequestClose={() => setIsTechMiniModalVisible(false)}
        >
          <View style={styles.miniModalOverlay}>
            <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
              <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
                <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>
                  {activeTechField === 'visit_by' ? 'Select Visit By' : activeTechField === 'visit_with' ? 'Select Visit With' : 'Select Visit With (Other)'}
                </Text>
                <Pressable onPress={() => setIsTechMiniModalVisible(false)} style={styles.miniModalClose}>
                  <X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                </Pressable>
              </View>
              <View style={styles.miniModalSearchContainer}>
                <View style={[styles.searchContainer, {
                  backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
                  borderColor: isDarkMode ? '#374151' : '#e5e7eb'
                }]}>
                  <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                  <TextInput
                    placeholder="Search Technician..."
                    value={techSearch}
                    onChangeText={setTechSearch}
                    placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                    style={[styles.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]}
                    autoFocus={isTechMiniModalVisible}
                  />
                  {techSearch.length > 0 && (
                    <Pressable onPress={() => setTechSearch('')}>
                      <X size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={{ height: 350, width: '100%' }}>
                <FlashList
                  data={filteredTechs}
                  extraData={techExtraData}
                  // @ts-ignore
                  estimatedItemSize={60}
                  keyExtractor={(item, index) => {
                    if (!item) return index.toString();
                    const email = item.email;
                    return email ? email.toString() : index.toString();
                  }}
                  ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
                  renderItem={renderTechItem}
                  ListEmptyComponent={
                    <View style={styles.miniModalEmpty}>
                      <Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: 16 }}>No results found</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingHorizontal: 40, paddingBottom: 20 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* ─── Main Form Page Overlay ─────────────────────────────────────────── */}
      {isOpen && (
        <View style={[styles.pageOverlay, { backgroundColor: isDarkMode ? '#111827' : '#f9fafb' }]}>
          <KeyboardAvoidingView
            behavior="padding"
            style={{ flex: 1 }}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
          >
            <View style={[styles.pageContainer, { backgroundColor: isDarkMode ? '#111827' : '#f9fafb' }]}>
              <View style={{ height: insets?.top || 0, backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }} />
              <View style={[styles.header, {
                backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb',
                position: 'relative',
                justifyContent: 'center',
                height: 60,
                paddingHorizontal: 0
              }]}>
                <Pressable
                  onPress={onClose}
                  disabled={loading}
                  style={[styles.cancelButton, {
                    position: 'absolute',
                    left: 16,
                    zIndex: 10,
                    borderColor: loading ? (isDarkMode ? '#374151' : '#e5e7eb') : (colorPalette?.primary || '#7c3aed'),
                    opacity: loading ? 0.6 : 1
                  }]}
                >
                  <Text style={[styles.cancelButtonText, {
                    color: loading ? (isDarkMode ? '#4b5563' : '#9ca3af') : (colorPalette?.primary || '#7c3aed')
                  }]}>Cancel</Text>
                </Pressable>

                <View style={{
                  position: 'absolute',
                  left: 100,
                  right: 100,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.headerTitle, {
                      color: isDarkMode ? '#ffffff' : '#111827',
                      textAlign: 'center',
                      fontSize: 18
                    }]}
                  >
                    {fullName}
                  </Text>
                </View>

                {/* Submit Button Logic */}
                {(() => {
                  const requiresSNValidation = formData.onsiteStatus === 'Done' &&
                    (formData.connectionType === 'Fiber' || formData.connectionType === 'Antenna');
                  const needsValidation = requiresSNValidation && !isSNValidated;
                  const isSubmitDisabled = loading || needsValidation;
                  const submitButtonBgColor = isSubmitDisabled
                    ? (isDarkMode ? '#4b5563' : '#9ca3af')
                    : (colorPalette?.primary || '#7c3aed');

                  return (
                    <View style={{
                      position: 'absolute',
                      right: 16,
                      zIndex: 20
                    }}>
                      <TouchableOpacity
                        onPress={handleSave}
                        disabled={isSubmitDisabled}
                        style={[styles.submitButton, {
                          backgroundColor: submitButtonBgColor,
                          paddingVertical: 8,
                          paddingHorizontal: 16,
                          opacity: isSubmitDisabled ? 0.6 : 1,
                          minWidth: 80,
                          alignItems: 'center',
                          justifyContent: 'center'
                        }]}
                      >
                        <Text style={[styles.submitButtonText, { color: '#ffffff', fontWeight: 'bold' }]}>
                          {loading ? `Submitting...` : 'Submit'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })()}
              </View>

              <View style={[styles.contentContainer, { flex: 1 }]}>
                {!isContentReady ? (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
                    <ActivityIndicator size="large" color={colorPalette?.primary || '#7c3aed'} />
                    <Text style={{ color: isDarkMode ? '#9ca3af' : '#6b7280', marginTop: 12, fontSize: 14 }}>Loading form...</Text>
                  </View>
                ) : (
                  <ScrollView
                    style={styles.contentContainer}
                    contentContainerStyle={styles.scrollViewContent}
                    scrollEnabled={scrollEnabled}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={styles.inputGroup}>
                      <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                          Choose Plan<Text style={styles.required}>*</Text>
                        </Text>
                        <View>
                          <TextInput
                            value={formData.choosePlan}
                            editable={false}
                            placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                            style={[styles.textInput, {
                              opacity: 0.75,
                              backgroundColor: isDarkMode ? '#374151' : '#f3f4f6',
                              borderColor: errors.choosePlan ? '#ef4444' : (isDarkMode ? '#4b5563' : '#d1d5db'),
                              color: isDarkMode ? '#d1d5db' : '#4b5563'
                            }]}
                          />
                        </View>
                        {errors.choosePlan && (
                          <View style={styles.errorContainer}>
                            <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                              <Text style={styles.errorIconText}>!</Text>
                            </View>
                            <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.choosePlan}</Text>
                          </View>
                        )}
                      </View>

                      <SearchablePickerTrigger
                        label="Onsite Status"
                        value={formData.onsiteStatus}
                        onPress={() => setIsOnsiteStatusPickerOpen(true)}
                        error={errors.onsiteStatus}
                        isDarkMode={isDarkMode}
                        required={true}
                        placeholder="Select Onsite Status..."
                      />

                      <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>Region</Text>
                        <TextInput
                          value={formData.region}
                          editable={false}
                          placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                          style={[styles.textInput, {
                            opacity: 0.75,
                            backgroundColor: isDarkMode ? '#374151' : '#f3f4f6',
                            borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                            color: isDarkMode ? '#d1d5db' : '#4b5563'
                          }]}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>City</Text>
                        <TextInput
                          value={formData.city}
                          editable={false}
                          placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                          style={[styles.textInput, {
                            opacity: 0.75,
                            backgroundColor: isDarkMode ? '#374151' : '#f3f4f6',
                            borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                            color: isDarkMode ? '#d1d5db' : '#4b5563'
                          }]}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>Barangay</Text>
                        <TextInput
                          value={formData.barangay}
                          editable={false}
                          placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                          style={[styles.textInput, {
                            opacity: 0.75,
                            backgroundColor: isDarkMode ? '#374151' : '#f3f4f6',
                            borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                            color: isDarkMode ? '#d1d5db' : '#4b5563'
                          }]}
                        />
                      </View>


                      {formData.onsiteStatus === 'Done' && (isDoneRendering ? (
                        <>
                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Date Installed<Text style={styles.required}>*</Text>
                            </Text>
                            <View>
                              <Pressable
                                onPress={() => { setDatePickerMode('date'); setShowDatePicker(true); }}
                                style={[styles.datePickerButton, {
                                  borderColor: errors.dateInstalled ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff'
                                }]}
                              >
                                <Text style={{
                                  color: formData.dateInstalled ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#6b7280' : '#9ca3af')
                                }}>
                                  {formData.dateInstalled || 'Select Date & Time'}
                                </Text>
                              </Pressable>
                              {showDatePicker && (
                                <DateTimePicker
                                  value={parseDateInput(formData.dateInstalled)}
                                  mode={Platform.OS === 'ios' ? 'datetime' : datePickerMode}
                                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                                  onChange={onDateChange}
                                  maximumDate={new Date()}
                                />
                              )}
                            </View>
                            {errors.dateInstalled && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>This entry is required</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Usage Type<Text style={styles.required}>*</Text>
                            </Text>
                            <View>
                              <Pressable
                                onPress={() => setIsUsageTypeMiniModalVisible(true)}
                                style={[styles.searchContainer, {
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  borderColor: errors.usageType ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                  paddingVertical: 12
                                }]}
                              >
                                <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                <Text style={{
                                  flex: 1,
                                  paddingHorizontal: 12,
                                  color: formData.usageType ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                  fontSize: 14
                                }}>
                                  {formData.usageType || "Select Usage Type..."}
                                </Text>
                                <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                              </Pressable>
                            </View>
                            {errors.usageType && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>This entry is required</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Connection Type<Text style={styles.required}>*</Text>
                            </Text>
                            <View style={styles.connectionTypeContainer}>
                              <Pressable
                                onPress={() => handleInputChange('connectionType', 'Antenna')}
                                style={[styles.connectionTypeButton, {
                                  backgroundColor: formData.connectionType === 'Antenna'
                                    ? (colorPalette?.primary || '#7c3aed')
                                    : (isDarkMode ? '#1f2937' : '#f3f4f6'),
                                  borderColor: formData.connectionType === 'Antenna'
                                    ? (colorPalette?.accent || '#dc2626')
                                    : (isDarkMode ? '#374151' : '#d1d5db')
                                }]}
                              >
                                <Text style={[styles.connectionTypeText, {
                                  color: formData.connectionType === 'Antenna'
                                    ? '#ffffff'
                                    : (isDarkMode ? '#d1d5db' : '#374151')
                                }]}>Antenna</Text>
                              </Pressable>
                              <Pressable
                                onPress={() => handleInputChange('connectionType', 'Fiber')}
                                style={[styles.connectionTypeButton, {
                                  backgroundColor: formData.connectionType === 'Fiber'
                                    ? (colorPalette?.primary || '#7c3aed')
                                    : (isDarkMode ? '#1f2937' : '#f3f4f6'),
                                  borderColor: formData.connectionType === 'Fiber'
                                    ? (colorPalette?.accent || '#dc2626')
                                    : (isDarkMode ? '#374151' : '#d1d5db')
                                }]}
                              >
                                <Text style={[styles.connectionTypeText, {
                                  color: formData.connectionType === 'Fiber'
                                    ? '#ffffff'
                                    : (isDarkMode ? '#d1d5db' : '#374151')
                                }]}>Fiber</Text>
                              </Pressable>
                              <Pressable
                                onPress={() => handleInputChange('connectionType', 'Local')}
                                style={[styles.connectionTypeButton, {
                                  backgroundColor: formData.connectionType === 'Local'
                                    ? (colorPalette?.primary || '#7c3aed')
                                    : (isDarkMode ? '#1f2937' : '#f3f4f6'),
                                  borderColor: formData.connectionType === 'Local'
                                    ? (colorPalette?.accent || '#dc2626')
                                    : (isDarkMode ? '#374151' : '#d1d5db')
                                }]}
                              >
                                <Text style={[styles.connectionTypeText, {
                                  color: formData.connectionType === 'Local'
                                    ? '#ffffff'
                                    : (isDarkMode ? '#d1d5db' : '#374151')
                                }]}>Local</Text>
                              </Pressable>
                            </View>
                            {errors.connectionType && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>This entry is required</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Router Model<Text style={styles.required}>*</Text>
                            </Text>
                            <View
                              style={[styles.searchContainer, {
                                backgroundColor: isDarkMode ? '#1f2937' : '#f3f4f6', // Light grey background
                                borderColor: errors.routerModel ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                height: 50,
                                paddingHorizontal: 12,
                                opacity: 0.8
                              }]}
                            >
                              <Text style={{
                                flex: 1,
                                paddingHorizontal: 4,
                                color: formData.routerModel ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                fontSize: 14,
                                fontWeight: '500'
                              }}>
                                {formData.routerModel || "Validated Modem SN to Get Router Model..."}
                              </Text>
                            </View>
                            {errors.routerModel && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>This entry is required</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Modem SN<Text style={styles.required}>*</Text>
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <TouchableOpacity
                                onPress={handleValidateSN}
                                disabled={isValidatingSN || validateCooldown > 0}
                                style={{
                                  paddingVertical: 14,
                                  paddingHorizontal: 16,
                                  backgroundColor: (isValidatingSN || validateCooldown > 0) ? '#9ca3af' : (colorPalette?.primary || '#7c3aed'),
                                  borderRadius: 12,
                                  justifyContent: 'center',
                                  alignItems: 'center',
                                  minWidth: 90,
                                  height: 50 // Matching standard input height
                                }}
                              >
                                {isValidatingSN ? (
                                  <ActivityIndicator size="small" color="#ffffff" />
                                ) : validateCooldown > 0 ? (
                                  <Text style={{ color: '#ffffff', fontWeight: 'bold', fontSize: 13 }}>{validateCooldown}s</Text>
                                ) : (
                                  <Text style={{ color: '#ffffff', fontWeight: 'bold', fontSize: 13 }}>VALIDATE</Text>
                                )}
                              </TouchableOpacity>
                              <TextInput
                                value={formData.modemSN}
                                onChangeText={(text) => handleInputChange('modemSN', text)}
                                placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                                style={[styles.textInput, {
                                  flex: 1,
                                  height: 50,
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  color: isDarkMode ? '#ffffff' : '#111827',
                                  borderColor: errors.modemSN ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db')
                                }]}
                              />
                            </View>
                            {errors.modemSN && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.modemSN}</Text>
                              </View>
                            )}
                          </View>

                          {usernamePattern && usernamePattern.sequence.some(item => item.type === 'tech_input') && (
                            <View style={styles.inputGroup}>
                              <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                                PPPoE Username<Text style={styles.required}>*</Text>
                              </Text>
                              <TextInput
                                value={techInputValue}
                                onChangeText={(text) => {
                                  setTechInputValue(text);
                                  if (errors.techInput) {
                                    setErrors(prev => ({ ...prev, techInput: '' }));
                                  }
                                }}
                                placeholder="Enter PPPoE username"
                                placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                                style={[styles.textInput, {
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  color: isDarkMode ? '#ffffff' : '#111827',
                                  borderColor: errors.techInput ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db')
                                }]}
                              />
                              {errors.techInput && (
                                <View style={styles.errorContainer}>
                                  <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                    <Text style={styles.errorIconText}>!</Text>
                                  </View>
                                  <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.techInput}</Text>
                                </View>
                              )}
                              {!techInputValue.trim() && !errors.techInput && (
                                <Text style={{ fontSize: 12, marginTop: 4, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>
                                  This will be used as the PPPoE username
                                </Text>
                              )}
                            </View>
                          )}

                          {formData.connectionType === 'Antenna' && (
                            <View style={styles.inputGroup}>
                              <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                                IP<Text style={styles.required}>*</Text>
                              </Text>
                              <TextInput
                                value={formData.ip}
                                onChangeText={(text) => handleInputChange('ip', text)}
                                placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                                style={[styles.textInput, {
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  color: isDarkMode ? '#ffffff' : '#111827',
                                  borderColor: errors.ip ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db')
                                }]}
                              />
                              {errors.ip && (
                                <View style={styles.errorContainer}>
                                  <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                    <Text style={styles.errorIconText}>!</Text>
                                  </View>
                                  <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>This entry is required</Text>
                                </View>
                              )}
                            </View>
                          )}

                          {formData.connectionType === 'Fiber' && (
                            <View style={styles.inputGroup}>
                              <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                                  LCP-NAP<Text style={styles.required}>*</Text>
                                </Text>
                                <Pressable
                                  onPress={() => {
                                    setIsLcpnapMiniModalVisible(true);
                                    setLcpnapSearch(''); // Clear search on open to show recommendations (Top 5)
                                  }}
                                  style={[styles.searchContainer, {
                                    backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                    borderColor: errors.lcpnap ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                    paddingVertical: 12
                                  }]}
                                >
                                  <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                  <Text style={[styles.searchInput, {
                                    color: formData.lcpnap ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563')
                                  }]}>
                                    {formData.lcpnap || "Select LCP-NAP..."}
                                  </Text>
                                  <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                </Pressable>
                                {errors.lcpnap && (
                                  <View style={styles.errorContainer}>
                                    <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                      <Text style={styles.errorIconText}>!</Text>
                                    </View>
                                    <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.lcpnap}</Text>
                                  </View>
                                )}
                              </View>

                              <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                                  PORT<Text style={styles.required}>*</Text>
                                </Text>
                                <View>
                                  <Pressable
                                    onPress={() => setIsPortMiniModalVisible(true)}
                                    style={[styles.searchContainer, {
                                      backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                      borderColor: errors.port ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                      paddingVertical: 12
                                    }]}
                                  >
                                    <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                    <Text style={{
                                      flex: 1,
                                      paddingHorizontal: 12,
                                      color: formData.port ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                      fontSize: 14
                                    }}>
                                      {formData.port || "Select PORT..."}
                                    </Text>
                                    <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                  </Pressable>
                                </View>
                                {errors.port && (
                                  <View style={styles.errorContainer}>
                                    <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                      <Text style={styles.errorIconText}>!</Text>
                                    </View>
                                    <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.port}</Text>
                                  </View>
                                )}
                              </View>

                              <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                                  VLAN<Text style={styles.required}>*</Text>
                                </Text>
                                <View>
                                  <Pressable
                                    onPress={() => setIsVlanMiniModalVisible(true)}
                                    style={[styles.searchContainer, {
                                      backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                      borderColor: errors.vlan ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                      paddingVertical: 12
                                    }]}
                                  >
                                    <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                    <Text style={{
                                      flex: 1,
                                      paddingHorizontal: 12,
                                      color: formData.vlan ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                      fontSize: 14
                                    }}>
                                      {formData.vlan || "Select VLAN..."}
                                    </Text>
                                    <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                  </Pressable>
                                </View>
                                {errors.vlan && (
                                  <View style={styles.errorContainer}>
                                    <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                      <Text style={styles.errorIconText}>!</Text>
                                    </View>
                                    <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.vlan}</Text>
                                  </View>
                                )}
                              </View>
                            </View>
                          )}

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Visit By<Text style={styles.required}>*</Text>
                            </Text>
                            <View>
                              <Pressable
                                onPress={() => {
                                  setActiveTechField('visit_by');
                                  setIsTechMiniModalVisible(true);
                                }}
                                style={[styles.searchContainer, {
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  borderColor: errors.visit_by ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                  paddingVertical: 12
                                }]}
                              >
                                <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                <Text style={{
                                  flex: 1,
                                  paddingHorizontal: 12,
                                  color: formData.visit_by ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                  fontSize: 14
                                }}>
                                  {formData.visit_by || "Select Visit By..."}
                                </Text>
                                <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                              </Pressable>
                            </View>
                            {errors.visit_by && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.visit_by}</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Visit With<Text style={styles.required}>*</Text>
                            </Text>
                            <View>
                              <Pressable
                                onPress={() => {
                                  setActiveTechField('visit_with');
                                  setIsTechMiniModalVisible(true);
                                }}
                                style={[styles.searchContainer, {
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  borderColor: errors.visit_with ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                  paddingVertical: 12
                                }]}
                              >
                                <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                <Text style={{
                                  flex: 1,
                                  paddingHorizontal: 12,
                                  color: formData.visit_with ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                  fontSize: 14
                                }}>
                                  {formData.visit_with || "Select Visit With..."}
                                </Text>
                                <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                              </Pressable>
                            </View>
                            {errors.visit_with && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.visit_with}</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Visit With(Other)<Text style={styles.required}>*</Text>
                            </Text>
                            <View>
                              <Pressable
                                onPress={() => {
                                  setActiveTechField('visit_with_other');
                                  setIsTechMiniModalVisible(true);
                                }}
                                style={[styles.searchContainer, {
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  borderColor: errors.visit_with_other ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                  paddingVertical: 12
                                }]}
                              >
                                <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                <Text style={{
                                  flex: 1,
                                  paddingHorizontal: 12,
                                  color: formData.visit_with_other ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                  fontSize: 14
                                }}>
                                  {formData.visit_with_other || "Visit With(Other)..."}
                                </Text>
                                <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                              </Pressable>
                            </View>
                            {errors.visit_with_other && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.visit_with_other}</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Onsite Remarks<Text style={styles.required}>*</Text>
                            </Text>
                            <TextInput
                              value={formData.onsiteRemarks}
                              onChangeText={(text) => handleInputChange('onsiteRemarks', text)}
                              multiline={true}
                              numberOfLines={4}
                              placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                              style={[styles.textInput, styles.textArea, {
                                backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                color: isDarkMode ? '#ffffff' : '#111827',
                                borderColor: errors.onsiteRemarks ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db')
                              }]}
                            />
                            {errors.onsiteRemarks && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.onsiteRemarks}</Text>
                              </View>
                            )}
                          </View>

                          <ImagePreview
                            imageUrl={imagePreviews.boxReadingImage}
                            label="Box Reading Image"
                            required={true}
                            onUpload={(file) => handleImageUpload('boxReadingImage', file)}
                            error={errors.boxReadingImage}
                            colorPrimary={colorPalette?.primary || '#7c3aed'}
                            saveToGalleryOnCapture={false}
                          />

                          <ImagePreview
                            imageUrl={imagePreviews.routerReadingImage}
                            label="Router Reading Image"
                            required={true}
                            onUpload={(file) => handleImageUpload('routerReadingImage', file)}
                            error={errors.routerReadingImage}
                            colorPrimary={colorPalette?.primary || '#7c3aed'}
                            saveToGalleryOnCapture={false}
                          />

                          {(formData.connectionType === 'Antenna' || formData.connectionType === 'Local') && (
                            <ImagePreview
                              imageUrl={imagePreviews.portLabelImage}
                              label="Port Label Image"
                              required={true}
                              onUpload={(file) => handleImageUpload('portLabelImage', file)}
                              error={errors.portLabelImage}
                              colorPrimary={colorPalette?.primary || '#7c3aed'}
                              saveToGalleryOnCapture={false}
                            />
                          )}

                          <ImagePreview
                            imageUrl={imagePreviews.clientTaggingImage}
                            label="Client Tagging"
                            required={true}
                            onUpload={(file) => handleImageUpload('clientTaggingImage', file)}
                            error={errors.clientTaggingImage}
                            colorPrimary={colorPalette?.primary || '#7c3aed'}
                            saveToGalleryOnCapture={false}
                          />

                          <ImagePreview
                            imageUrl={imagePreviews.setupImage}
                            label="Setup Image"
                            required={true}
                            onUpload={(file) => handleImageUpload('setupImage', file)}
                            error={errors.setupImage}
                            colorPrimary={colorPalette?.primary || '#7c3aed'}
                            saveToGalleryOnCapture={false}
                          />

                          <ImagePreview
                            imageUrl={imagePreviews.signedContractImage}
                            label="Signed Contract Image"
                            required={true}
                            onUpload={(file) => handleImageUpload('signedContractImage', file)}
                            error={errors.signedContractImage}
                            colorPrimary={colorPalette?.primary || '#7c3aed'}
                            saveToGalleryOnCapture={false}
                          />

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Client Signature Image
                            </Text>
                            {!isDrawingSignature ? (
                              <View>
                                <Pressable
                                  onPress={() => setIsDrawingSignature(true)}
                                  style={[styles.signatureContainer, {
                                    borderColor: errors.clientSignatureImage ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                    backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb'
                                  }]}
                                >
                                  {imagePreviews.clientSignatureImage ? (
                                    <Image
                                      source={{ uri: imagePreviews.clientSignatureImage }}
                                      style={{ width: '100%', height: '100%', resizeMode: 'contain' }}
                                    />
                                  ) : (
                                    <View style={styles.signaturePlaceholder}>
                                      <View style={[styles.signatureIconCircle, { backgroundColor: (colorPalette?.primary || '#7c3aed') + '20' }]}>
                                        <Camera size={24} color={colorPalette?.primary || '#7c3aed'} />
                                      </View>
                                      <Text style={{ color: isDarkMode ? '#9ca3af' : '#6b7280' }}>Tap to Draw Signature</Text>
                                    </View>
                                  )}
                                </Pressable>
                                {imagePreviews.clientSignatureImage && (
                                  <View style={styles.signatureActions}>
                                    <Pressable
                                      onPress={() => handleImageUpload('clientSignatureImage', null)}
                                      style={styles.removeButton}
                                    >
                                      <X size={16} color="#ef4444" />
                                      <Text style={styles.removeButtonText}>Remove</Text>
                                    </Pressable>
                                    <Pressable
                                      onPress={() => setIsDrawingSignature(true)}
                                      style={[styles.redrawButton, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}
                                    >
                                      <Text style={styles.redrawButtonText}>Redraw</Text>
                                    </Pressable>
                                  </View>
                                )}
                              </View>
                            ) : (
                              <View style={[styles.signatureCanvasContainer, { borderColor: isDarkMode ? '#374151' : '#d1d5db', flexDirection: 'column' }]}>
                                <View style={{ flex: 1 }}>
                                  <SignatureScreen
                                    ref={signatureRef}
                                    onOK={handleSignatureOK}
                                    onEmpty={() => Alert.alert('Empty', 'Please provide a signature before saving')}
                                    onBegin={() => setScrollEnabled(false)}
                                    onEnd={() => setScrollEnabled(true)}
                                    webStyle={`.m-signature-pad--footer {display: none;} .m-signature-pad {box-shadow: none; border: none;} .m-signature-pad--body {border: none;} body,html {width: 100%; height: 100%; margin: 0; padding: 0;}`}
                                  />
                                  <Pressable
                                    onPress={() => {
                                      setIsDrawingSignature(false);
                                      setScrollEnabled(true);
                                    }}
                                    style={styles.signatureCloseButton}
                                  >
                                    <X size={20} color="#000" />
                                  </Pressable>
                                </View>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderTopWidth: 1, borderColor: isDarkMode ? '#4b5563' : '#e5e7eb', backgroundColor: isDarkMode ? '#374151' : '#f9fafb' }}>
                                  <Pressable onPress={() => signatureRef.current?.clearSignature()} style={{ padding: 8 }}>
                                    <Text style={{ color: '#ef4444', fontWeight: 'bold' }}>Clear</Text>
                                  </Pressable>
                                  <Pressable onPress={() => signatureRef.current?.readSignature()} style={{ paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#10b981', borderRadius: 6 }}>
                                    <Text style={{ color: 'white', fontWeight: 'bold' }}>Save</Text>
                                  </Pressable>
                                </View>
                              </View>
                            )}
                            {errors.clientSignatureImage && (
                              <Text style={[styles.errorText, { color: '#ef4444', marginTop: 4 }]}>{errors.clientSignatureImage}</Text>
                            )}
                          </View>


                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Items<Text style={styles.required}>*</Text>
                            </Text>
                            {orderItems.map((item, index) => (
                              <View
                                key={index}
                                style={styles.itemRow}
                              >
                                <View style={styles.itemRowContent}>
                                  <View style={styles.itemSearchContainer}>
                                    {/* Item trigger button — same pattern as LCP-NAP */}
                                    <Pressable
                                      onPress={() => {
                                        setActiveItemIndex(index);
                                        setItemSearchModal('');
                                        setIsItemMiniModalVisible(true);
                                      }}
                                      style={[styles.searchContainer, {
                                        backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                        borderColor: errors[`item_${index}`] ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                        paddingVertical: 12
                                      }]}
                                    >
                                      <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                      <Text style={[styles.searchInput, {
                                        color: item.itemId ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563')
                                      }]}>
                                        {item.itemId || `Select Item ${index + 1}...`}
                                      </Text>
                                      {item.itemId ? (
                                        <Pressable
                                          onPress={() => {
                                            handleItemChange(index, 'itemId', '');
                                          }}
                                          style={{ padding: 4 }}
                                          hitSlop={8}
                                        >
                                          <X size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                        </Pressable>
                                      ) : (
                                        <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                      )}
                                    </Pressable>
                                    {errors[`item_${index}`] && (
                                      <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed', marginTop: 4 }]}>{errors[`item_${index}`]}</Text>
                                    )}
                                  </View>

                                  {item.itemId && item.itemId !== 'None' && (
                                    <View style={styles.itemQtyContainer}>
                                      <TextInput
                                        keyboardType="numeric"
                                        value={item.quantity.toString()}
                                        onChangeText={(text) => handleItemChange(index, 'quantity', text)}
                                        placeholder="Qty"
                                        placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                                        style={[styles.textInput, {
                                          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                          color: isDarkMode ? '#ffffff' : '#111827',
                                          borderColor: isDarkMode ? '#374151' : '#d1d5db'
                                        }]}
                                      />
                                      {errors[`quantity_${index}`] && (
                                        <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed', marginTop: 4 }]}>{errors[`quantity_${index}`]}</Text>
                                      )}
                                    </View>
                                  )}

                                  {orderItems.length > 1 && (
                                    <Pressable
                                      onPress={() => handleRemoveItem(index)}
                                      style={styles.removeItemButton}
                                    >
                                      <X size={20} color={isDarkMode ? '#F87171' : '#EF4444'} />
                                    </Pressable>
                                  )}
                                </View>
                              </View>
                            ))}
                            {errors.items && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.items}</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <LocationPicker
                              value={formData.addressCoordinates}
                              onChange={(coordinates) => handleInputChange('addressCoordinates', coordinates)}
                              isDarkMode={isDarkMode}
                              label="Address Coordinates"
                              required={true}
                              error={errors.addressCoordinates}
                            />
                          </View>
                        </>
                      ) : (
                        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                          <ActivityIndicator size="small" color={colorPalette?.primary || '#7c3aed'} />
                          <Text style={{ marginTop: 8, color: isDarkMode ? '#9ca3af' : '#6b7280', fontSize: 12 }}>Preparing technical fields...</Text>
                        </View>
                      ))}

                      {(formData.onsiteStatus === 'Failed' || formData.onsiteStatus === 'Reschedule') && (
                        <>
                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Visit By<Text style={styles.required}>*</Text>
                            </Text>
                            <View>
                              <Pressable
                                onPress={() => {
                                  setActiveTechField('visit_by');
                                  setIsTechMiniModalVisible(true);
                                }}
                                style={[styles.searchContainer, {
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  borderColor: errors.visit_by ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                  paddingVertical: 12
                                }]}
                              >
                                <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                <Text style={{
                                  flex: 1,
                                  paddingHorizontal: 12,
                                  color: formData.visit_by ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                  fontSize: 14
                                }}>
                                  {formData.visit_by || "Select Visit By..."}
                                </Text>
                                <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                              </Pressable>
                            </View>
                            {errors.visit_by && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.visit_by}</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Visit With<Text style={styles.required}>*</Text>
                            </Text>
                            <View>
                              <Pressable
                                onPress={() => {
                                  setActiveTechField('visit_with');
                                  setIsTechMiniModalVisible(true);
                                }}
                                style={[styles.searchContainer, {
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  borderColor: errors.visit_with ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                  paddingVertical: 12
                                }]}
                              >
                                <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                <Text style={{
                                  flex: 1,
                                  paddingHorizontal: 12,
                                  color: formData.visit_with ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                  fontSize: 14
                                }}>
                                  {formData.visit_with || "Select Visit With..."}
                                </Text>
                                <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                              </Pressable>
                            </View>
                            {errors.visit_with && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.visit_with}</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Visit With(Other)<Text style={styles.required}>*</Text>
                            </Text>
                            <View>
                              <Pressable
                                onPress={() => {
                                  setActiveTechField('visit_with_other');
                                  setIsTechMiniModalVisible(true);
                                }}
                                style={[styles.searchContainer, {
                                  backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                  borderColor: errors.visit_with_other ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
                                  paddingVertical: 12
                                }]}
                              >
                                <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                                <Text style={{
                                  flex: 1,
                                  paddingHorizontal: 12,
                                  color: formData.visit_with_other ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9CA3AF' : '#4B5563'),
                                  fontSize: 14
                                }}>
                                  {formData.visit_with_other || "Visit With(Other)..."}
                                </Text>
                                <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                              </Pressable>
                            </View>
                            {errors.visit_with_other && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.visit_with_other}</Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                              Onsite Remarks<Text style={styles.required}>*</Text>
                            </Text>
                            <TextInput
                              value={formData.onsiteRemarks}
                              onChangeText={(text) => handleInputChange('onsiteRemarks', text)}
                              multiline={true}
                              numberOfLines={4}
                              placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                              style={[styles.textInput, styles.textArea, {
                                backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                                color: isDarkMode ? '#ffffff' : '#111827',
                                borderColor: errors.onsiteRemarks ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db')
                              }]}
                            />
                            {errors.onsiteRemarks && (
                              <View style={styles.errorContainer}>
                                <View style={[styles.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
                                  <Text style={styles.errorIconText}>!</Text>
                                </View>
                                <Text style={[styles.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors.onsiteRemarks}</Text>
                              </View>
                            )}
                          </View>


                        </>
                      )}
                      {(formData.onsiteStatus === 'Failed' || formData.onsiteStatus === 'Reschedule') && (
                        <View style={styles.inputGroup}>
                          <ImagePreview
                            imageUrl={imagePreviews.proofImage}
                            label="Proof Image"
                            required={true}
                            onUpload={(file) => handleImageUpload('proofImage', file)}
                            error={errors.proofImage}
                            colorPrimary={colorPalette?.primary || '#7c3aed'}
                            saveToGalleryOnCapture={false}
                          />
                        </View>
                      )}
                    </View>
                  </ScrollView>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  pageOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 999,
  },
  pageContainer: {
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  submitButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  contentContainer: {
    flex: 1,
  },
  scrollViewContent: {
    padding: 24,
    paddingBottom: 100,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  required: {
    color: '#ef4444',
  },
  inputContainer: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  textInput: {
    width: '100%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  textArea: {
    textAlignVertical: 'top',
  },
  pickerContainer: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  datePickerButton: {
    width: '100%',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  errorIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  errorIconText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 12,
  },
  connectionTypeContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  connectionTypeButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionTypeText: {
    fontWeight: '500',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
  },
  dropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    marginTop: 4,
    zIndex: 50,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 5,
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  dropdownItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownItemText: {
    fontSize: 14,
  },
  dropdownItemSelectedIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f97316',
  },
  emptyDropdown: {
    paddingHorizontal: 16,
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyDropdownText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  signatureContainer: {
    height: 192,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  signaturePlaceholder: {
    alignItems: 'center',
  },
  signatureIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  signatureActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#ef4444',
    fontSize: 12,
    marginLeft: 4,
  },
  redrawButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  redrawButtonText: {
    color: '#ffffff',
    fontSize: 12,
  },
  signatureCanvasContainer: {
    height: 288,
    borderWidth: 1,
    backgroundColor: '#ffffff',
    marginBottom: 8,
    overflow: 'hidden',
    borderRadius: 8,
  },
  signatureCloseButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 9999,
    zIndex: 10,
    elevation: 2,
  },
  itemRow: {
    marginBottom: 16,
  },
  itemRowContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemSearchContainer: {
    flex: 1,
  },
  itemQtyContainer: {
    width: 96,
  },
  removeItemButton: {
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingModalContent: {
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    minWidth: 320,
  },
  loadingPercentage: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  messageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  messageModalContent: {
    borderRadius: 12,
    width: '100%',
    maxWidth: 672,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  messageModalHeader: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  messageModalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  messageModalClose: {
    padding: 4,
  },
  messageList: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  messageItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  messageText: {
    fontSize: 14,
    flex: 1,
  },
  messageModalFooter: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  messageModalButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
  },
  messageModalButtonText: {
    color: '#ffffff',
    fontWeight: '500',
    textAlign: 'center',
  },
  miniModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  miniModalContent: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  miniModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  miniModalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  miniModalClose: {
    padding: 4,
  },
  miniModalSearchContainer: {
    padding: 12,
  },
  miniModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  miniModalItemText: {
    fontSize: 24,
    textAlign: 'left',
  },
  miniModalEmpty: {
    padding: 24,
    alignItems: 'center',
  },
});

export default JobOrderDoneFormTechModal;
