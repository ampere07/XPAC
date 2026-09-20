import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Linking, Platform, useWindowDimensions, StyleSheet, Alert, DeviceEventEmitter, ActivityIndicator } from 'react-native';
import { X, ExternalLink, Edit, ChevronLeft, Play, Square, MapPin, Lock } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ServiceOrderEditModal from '../modals/ServiceOrderEditModal';
import ConfirmationModal from '../modals/MoveToJoModal';
import StartTimerModal from '../modals/StartTimerModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useServiceOrderContext } from '../contexts/ServiceOrderContext';
import { useJobOrderContext } from '../contexts/JobOrderContext';
import { useWorkOrderStore } from '../store/workOrderStore';
import { formatToGMT8MySQL } from '../utils/dateUtils';
import { updateServiceOrder, enableServiceOrderForTechnician } from '../services/serviceOrderService';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { techInOutService } from '../services/techInOutService';
import {
  buildTechnicianLockedServiceOrderIds,
  isClosedForTechnicianQueue,
  isTechnicianEnabled,
  TECHNICIAN_LOCKED_MESSAGE,
} from '../utils/technicianServiceOrderAccess';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);
import { getServiceOrderItems, ServiceOrderItem } from '../services/serviceOrderItemService';

interface ServiceOrderDetailsProps {
  serviceOrder: {
    id: string;
    ticketId: string;
    timestamp: string;
    accountNumber: string;
    fullName: string;
    contactAddress: string;
    dateInstalled: string;
    contactNumber: string;
    fullAddress: string;
    houseFrontPicture: string;
    emailAddress: string;
    plan: string;
    affiliate?: string;
    username: string;
    connectionType: string;
    routerModemSN: string;
    lcp: string;
    nap: string;
    port: string;
    vlan: string;
    concern: string;
    concernRemarks: string;
    visitStatus: string;
    visitBy: string;
    visitWith: string;
    visitWithOther: string;
    visitRemarks: string;
    modifiedBy: string;
    modifiedDate: string;
    requestedBy: string;
    assignedEmail: string;
    supportRemarks: string;
    serviceCharge: string;
    repairCategory?: string;
    supportStatus?: string;
    priorityLevel?: string;
    newRouterSn?: string;
    newLcpnap?: string;
    newPlan?: string;
    newLcp?: string;
    newNap?: string;
    newPort?: string;
    newVlan?: string;
    routerModel?: string;
    proofImageUrl?: string;
    clientSignatureUrl?: string;
    image1Url?: string;
    image2Url?: string;
    image3Url?: string;
    setupImageUrl?: string;
    routerReadingImageUrl?: string;
    boxReadingImageUrl?: string;
    speedtestImageUrl?: string;
    region?: string;
    city?: string;
    barangay?: string;
    start_time?: string | null;
    end_time?: string | null;
    proof_of_billing_url?: string;
    government_valid_id_url?: string;
    second_government_valid_id_url?: string;
    document_attachment_url?: string;
    other_isp_bill_url?: string;
    visit_status?: string;
    referredBy?: string;
  };
  onClose: () => void;
  isMobile?: boolean;
  userRoleProp?: string;
  userRoleIdProp?: number | null;
}

const FIELD_VISIBILITY_KEY = 'serviceOrderDetailsFieldVisibility';
const FIELD_ORDER_KEY = 'serviceOrderDetailsFieldOrder';

const defaultFields = [
  'ticketId',
  'timestamp',
  'accountNumber',
  'dateInstalled',
  'startTime',
  'endTime',
  'duration',
  'fullName',
  'contactNumber',
  'fullAddress',
  'addressCoordinates',
  'houseFrontPicture',
  'emailAddress',
  'plan',
  'username',
  'connectionType',
  'routerModemSN',
  'lcp',
  'nap',
  'port',
  'vlan',
  'concern',
  'concernRemarks',
  'visitStatus',
  'visitBy',
  'visitWith',
  'visitWithOther',
  'visitRemarks',
  'modifiedBy',
  'modifiedDate',
  'requestedBy',
  'assignedEmail',
  'supportRemarks',
  'supportStatus',
  'priorityLevel',
  'repairCategory',
  'newRouterSn',
  'newLcpnap',
  'newLcp',
  'newNap',
  'newPort',
  'newVlan',
  'routerModel',
  'newPlan',
  'orderItems',
  'image1Url',
  'image2Url',
  'image3Url',
  'setupImageUrl',
  'routerReadingImageUrl',
  'boxReadingImageUrl',
  'speedtestImageUrl',
  'clientSignatureUrl',
  'proofImageUrl',
  'serviceCharge',
  'affiliate',
  'referredBy',
  'region',
  'city',
  'barangay',
  'proof_of_billing_url',
  'government_valid_id_url',
  'second_government_valid_id_url',
  'document_attachment_url',
  'other_isp_bill_url'
];

const initialVisibility = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});

const formatDate = (dateStr?: string | null): string => {
  if (!dateStr) return 'Not set';
  try {
    const d = dayjs.tz(dateStr, 'Asia/Manila');
    if (!d.isValid()) return dateStr;
    return d.format('MM/DD/YYYY hh:mm A');
  } catch (e) {
    return dateStr || 'Not set';
  }
};

const formatDateOnly = (dateStr?: string | null): string => {
  if (!dateStr) return '-';
  try {
    const d = dayjs.tz(dateStr, 'Asia/Manila');
    if (!d.isValid()) return dateStr;
    return d.format('MM/DD/YYYY');
  } catch (e) {
    return dateStr;
  }
};

const getStatusColor = (status: string | undefined, type: 'support' | 'visit'): string => {
  if (!status) return '#9ca3af';
  const lower = status.toLowerCase().trim();
  if (type === 'support') {
    if (['resolved', 'completed', 'done'].includes(lower)) return '#4ade80';
    if (['in-progress', 'in progress'].includes(lower)) return '#60a5fa';
    if (lower === 'pending') return '#fb923c';
    return '#9ca3af';
  } else {
    if (['completed', 'done'].includes(lower)) return '#4ade80';
    if (['scheduled', 'reschedule', 'in progress'].includes(lower)) return '#60a5fa';
    if (lower === 'pending') return '#fb923c';
    if (['cancelled', 'failed'].includes(lower)) return '#ef4444';
    return '#9ca3af';
  }
};

const getFieldLabel = (fieldKey: string): string => {
  const labels: Record<string, string> = {
    ticketId: 'Ticket ID',
    timestamp: 'Timestamp',
    accountNumber: 'Account No.',
    dateInstalled: 'Date Installed',
    startTime: 'Start Time',
    endTime: 'End Time',
    duration: 'Duration',
    fullName: 'Full Name',
    contactNumber: 'Contact Number',
    fullAddress: 'Full Address',
    addressCoordinates: 'Address Coordinates',
    houseFrontPicture: 'House Front Picture',
    emailAddress: 'Email Address',
    plan: 'Plan',
    username: 'Username',
    connectionType: 'Connection Type',
    routerModemSN: 'Router/Modem SN',
    lcp: 'LCP',
    nap: 'NAP',
    port: 'PORT',
    vlan: 'VLAN',
    concern: 'Concern',
    concernRemarks: 'Concern Remarks',
    visitStatus: 'Visit Status',
    visitBy: 'Visit By',
    visitWith: 'Visit With',
    visitWithOther: 'Visit With Other',
    visitRemarks: 'Visit Remarks',
    modifiedBy: 'Modified By',
    modifiedDate: 'Modified Date',
    requestedBy: 'Requested by',
    assignedEmail: 'Assigned Email',
    supportRemarks: 'Support Remarks',
    supportStatus: 'Support Status',
    repairCategory: 'Repair Category',
    newRouterSn: 'New Router SN',
    newLcpnap: 'New LCP/NAP',
    newLcp: 'New LCP',
    newNap: 'New NAP',
    newPort: 'New PORT',
    newVlan: 'New VLAN',
    routerModel: 'Router Model',
    newPlan: 'New Plan',
    orderItems: 'Items Used',
    image1Url: 'Time In Image',
    image2Url: 'Modem Setup Image',
    image3Url: 'Time Out Image',
    setupImageUrl: 'Setup Image',
    routerReadingImageUrl: 'Router Reading Image',
    boxReadingImageUrl: 'Box Reading Image',
    speedtestImageUrl: 'Port Label Image',
    clientSignatureUrl: 'Client Signature',
    proofImageUrl: 'Proof Image',
    serviceCharge: 'Service Charge',
    priorityLevel: 'Priority Level',
    affiliate: 'Affiliate/Group',
    referredBy: 'Referred By',
    region: 'Region',
    city: 'City',
    barangay: 'Barangay',
    proof_of_billing_url: 'Proof of Billing',
    government_valid_id_url: 'Government Valid ID',
    second_government_valid_id_url: 'Second Government Valid ID',
    document_attachment_url: 'Document Attachment',
    other_isp_bill_url: 'Other ISP Bill'
  };
  return labels[fieldKey] || fieldKey;
};

const ServiceOrderDetails: React.FC<ServiceOrderDetailsProps> = ({
  serviceOrder,
  onClose,
  isMobile: propIsMobile = false,
  userRoleProp,
  userRoleIdProp
}) => {
  const { width } = useWindowDimensions();
  const isMobile = propIsMobile || width < 768;
  const { silentRefresh, serviceOrders } = useServiceOrderContext();
  const { jobOrders } = useJobOrderContext();
  const { workOrders } = useWorkOrderStore();
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isStartTimerModalOpen, setIsStartTimerModalOpen] = useState<boolean>(false);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [userRole, setUserRole] = useState<string>(userRoleProp || '');
  const [userRoleId, setUserRoleId] = useState<number | null>(userRoleIdProp || null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [userFullName, setUserFullName] = useState<string>('');
  const [customerDetail, setCustomerDetail] = useState<CustomerDetailData | null>(null);
  const [orderItems, setOrderItems] = useState<ServiceOrderItem[]>([]);

  // Sync props to state if props change
  useEffect(() => {
    if (userRoleProp) setUserRole(userRoleProp);
  }, [userRoleProp]);

  useEffect(() => {
    if (userRoleIdProp !== undefined) setUserRoleId(userRoleIdProp);
  }, [userRoleIdProp]);
  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>(initialVisibility);
  const [fieldOrder, setFieldOrder] = useState<string[]>(defaultFields);
  const checkIsStarted = (time?: string | null) => {
    if (!time) return false;
    const lowerTime = String(time).toLowerCase().trim();
    return !['0000-00-00 00:00:00', 'not set', '-', 'none', '', 'null', 'undefined'].includes(lowerTime);
  };

  const [isStarted, setIsStarted] = useState(checkIsStarted((serviceOrder as any).start_time));
  const [isEnded, setIsEnded] = useState(checkIsStarted((serviceOrder as any).end_time));
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(dayjs().tz('Asia/Manila').add(8, 'hour'));
  const [techStatus, setTechStatus] = useState<'online' | 'offline'>('offline');
  const [showTimeInWarning, setShowTimeInWarning] = useState(false);
  const [isEnablingTechnician, setIsEnablingTechnician] = useState(false);
  /**
   * Local echo of technician_enabled after a successful enable.
   *
   * The list refresh is what makes the change permanent everywhere; this only
   * keeps the button honest in the moment between the two. Cleared whenever a
   * different service order is opened so it can never leak across records.
   */
  const [technicianEnabledOverride, setTechnicianEnabledOverride] = useState<boolean | null>(null);

  // ── Technician queue release ────────────────────────────────────────────────
  // Technicians work their service orders In Progress first and oldest first
  // within that: everything else active is greyed out until either the work
  // ahead of it moves forward or an administrator releases one early.

  const isAdminUser = (userRole || '').toLowerCase() === 'administrator'
    || (userRole || '').toLowerCase() === 'superadmin'
    || userRoleId === 1 || userRoleId === 7;

  const technicianEnabled = technicianEnabledOverride ?? isTechnicianEnabled(serviceOrder);

  const isTechnicianViewer = userRole === 'technician' || userRoleId === 2 || String(userRoleId) === '2';

  /**
   * Is this service order still waiting its turn in the technician's queue?
   *
   * The same rule the list greys rows out with, asked again here because the
   * actions live in this view. A technician may read any service order assigned
   * to them; starting it and editing it wait until it is their next visit or an
   * administrator releases it. Built from the whole assigned set out of the
   * context — the API already scopes that to them — so a filtered or paged view
   * can never change which service order counts as next.
   *
   * ServiceOrderApiController::isServiceOrderLockedForTechnician() enforces the
   * same rule on update, so what happens here is the message, not the lock.
   */
  const technicianLocked = useMemo(() => {
    if (!isTechnicianViewer || technicianEnabled) return false;
    return buildTechnicianLockedServiceOrderIds(serviceOrders).has(String(serviceOrder.id));
  }, [isTechnicianViewer, technicianEnabled, serviceOrders, serviceOrder.id]);

  // Offered for administrators on any service order a technician still owes work
  // on, including a rescheduled one — that is precisely the case where they
  // cannot pick it back up without being released. A service order that is
  // finished, resolved, failed or cancelled has nothing left to release.
  const shouldShowEnableTechnicianButton = () =>
    isAdminUser && !isClosedForTechnicianQueue(serviceOrder);

  const handleEnableTechnicianClick = async () => {
    if (isEnablingTechnician || technicianEnabled) return;

    if (!serviceOrder.id) {
      setError('Cannot enable service order: Missing ID');
      return;
    }

    setError(null);
    setIsEnablingTechnician(true);

    try {
      const response = await enableServiceOrderForTechnician(serviceOrder.id);

      if (response?.success) {
        setTechnicianEnabledOverride(true);
        setSuccessMessage('Service order enabled. The technician can now start it.');
        setShowSuccessModal(true);
        silentRefresh();
      } else {
        setError((response as any)?.message || 'Failed to enable service order for the technician');
      }
    } catch (err: any) {
      setError(
        err.response?.data?.message || err.message || 'Failed to enable service order for the technician'
      );
    } finally {
      setIsEnablingTechnician(false);
    }
  };

  // A different record is a different lock state.
  useEffect(() => {
    setTechnicianEnabledOverride(null);
  }, [serviceOrder.id]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isStarted && !isEnded) {
      interval = setInterval(() => {
        setNow(dayjs().tz('Asia/Manila').add(8, 'hour'));
      }, 1000);
    } else {
      setNow(dayjs().tz('Asia/Manila').add(8, 'hour'));
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStarted, isEnded]);

  useEffect(() => {
    setIsStarted(checkIsStarted((serviceOrder as any).start_time));
    setIsEnded(checkIsStarted((serviceOrder as any).end_time));
  }, [serviceOrder]);
  
  useEffect(() => {
    const fetchCustomerDetail = async () => {
      if (serviceOrder.accountNumber) {
        try {
          const detail = await getCustomerDetail(serviceOrder.accountNumber);
          setCustomerDetail(detail);
        } catch (error) {
          console.error('Error fetching customer detail in ServiceOrderDetails:', error);
        }
      }
    };
    fetchCustomerDetail();
  }, [serviceOrder.accountNumber]);

  useEffect(() => {
    const fetchOrderItems = async () => {
      if (serviceOrder.id) {
        const response = await getServiceOrderItems(Number(serviceOrder.id));
        if (response.success) {
          setOrderItems(response.data);
        }
      }
    };
    fetchOrderItems();
  }, [serviceOrder.id]);

  useEffect(() => {
    const loadSettings = async () => {
      const authData = await AsyncStorage.getItem('authData');
      let userData = null;
      if (authData) {
        try {
          userData = JSON.parse(authData);
          if (!userRoleProp) setUserRole(userData.role?.toLowerCase() || '');
          if (userRoleIdProp === null) setUserRoleId(Number(userData.role_id));
          setUserEmail(userData.email || '');
          setUserFullName(userData.full_name || '');

          // Check technician status - Always check if user is a technician
          const currentRole = userRoleProp || userData.role?.toLowerCase() || '';
          const currentRoleId = userRoleIdProp !== null ? userRoleIdProp : Number(userData.role_id);
          const isTechnician = (currentRole === 'technician' || currentRoleId === 2);
          
          if (isTechnician) {
            const userId = userData.id || userData.user_id || userData.user?.id;
            if (userId) {
              const response = await techInOutService.getStatus(userId);
              if (response.success && response.data) {
                const isOnline = !!(response.data.time_in && !response.data.time_out);
                setTechStatus(isOnline ? 'online' : 'offline');
              }
            }
          }
        } catch (error) {
          console.error('Error parsing auth data or fetching tech status:', error);
        }
      }

      const [savedVisibility, savedOrder] = await Promise.all([
        AsyncStorage.getItem(FIELD_VISIBILITY_KEY),
        AsyncStorage.getItem(FIELD_ORDER_KEY)
      ]);

      if (savedVisibility) setFieldVisibility(JSON.parse(savedVisibility));
      if (savedOrder) setFieldOrder(JSON.parse(savedOrder));
    };
    loadSettings();

    const fetchPalette = async () => {
      try {
        const palette = await settingsColorPaletteService.getActive();
        setColorPalette(palette);
      } catch (err) {}
    };
    fetchPalette();

    const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      setColorPalette(newPalette);
    });

    return () => paletteSub.remove();
  }, [userRoleProp, userRoleIdProp]);

  useEffect(() => {
    AsyncStorage.setItem(FIELD_VISIBILITY_KEY, JSON.stringify(fieldVisibility));
  }, [fieldVisibility]);

  useEffect(() => {
    AsyncStorage.setItem(FIELD_ORDER_KEY, JSON.stringify(fieldOrder));
  }, [fieldOrder]);

  const handleEditClick = useCallback(() => {
    // A locked service order opens for reading, but not for editing: this form is
    // how the visit gets recorded, so letting it open would hand back everything
    // the locked Start button withholds.
    if (technicianLocked) {
      Alert.alert('Service Order Locked', TECHNICIAN_LOCKED_MESSAGE, [{ text: 'OK' }]);
      return;
    }

    if (userRole === 'technician' || userRoleId === 2 || String(userRoleId) === '2') {
      if (!isStarted) {
        Alert.alert(
          'Action Required',
          'You need to start the service order first.',
          [{ text: 'OK' }]
        );
        return;
      }
    }
    setIsEditModalOpen(true);
  }, [isStarted, userRole, userRoleId, technicianLocked]);

  const handleCloseEditModal = useCallback(() => setIsEditModalOpen(false), []);
  const handleSaveEdit = useCallback(() => {
    setIsEditModalOpen(false);
    silentRefresh();
  }, [silentRefresh]);

  const toggleFieldVisibility = useCallback((field: string) => {
    setFieldVisibility(prev => ({ ...prev, [field]: !prev[field] }));
  }, []);

  // formatMySQLDate removed in favor of utility

  const handleStartTimer = async () => {
    try {
      const isTechnician = userRole === 'technician' || userRoleId === 2 || String(userRoleId) === '2';
      if (isTechnician) {
        // Reading the service order is always allowed; starting it waits until
        // this one is their next visit or an administrator releases it.
        if (technicianLocked) {
          Alert.alert('Service Order Locked', TECHNICIAN_LOCKED_MESSAGE, [{ text: 'OK' }]);
          return;
        }

        if (techStatus === 'offline') {
          setShowTimeInWarning(true);
          return;
        }

        const isJobInProgress = (item: any) => {
          const hasStarted = checkIsStarted(item.start_time) || checkIsStarted(item.StartTimeStamp) || checkIsStarted(item.start_timestamp);
          const hasEnded = checkIsStarted(item.end_time) || checkIsStarted(item.EndTimeStamp) || checkIsStarted(item.end_timestamp);
          const status = (item.visit_status || item.visitStatus || item.onsite_status || item.Onsite_Status || '').toLowerCase().trim();
          
          if (!hasStarted || hasEnded) return false;
          if (status !== 'in progress' && status !== 'reschedule' && status !== 'inprogress' && status !== 'in-progress') return false;

          const loggedInEmail = userEmail.toLowerCase().trim();
          const loggedInName = userFullName.toLowerCase().trim();
          if (!loggedInEmail) return false;

          const assigned = (item.assignedEmail || item.assigned_email || item.visitBy || item.visit_by_user || item.Visit_By || item.visit_by || '').toLowerCase();
          const isAssigned = assigned.includes(loggedInEmail) || (loggedInName && assigned.includes(loggedInName));

          const itemTechs = Array.isArray(item.technicians) ? item.technicians : [];
          const isTechAssigned = itemTechs.some((tech: string) => {
            const t = String(tech).toLowerCase();
            return t.includes(loggedInEmail) || (loggedInName && t.includes(loggedInName));
          });

          return isAssigned || isTechAssigned;
        };

        // Check for other active service orders
        const activeServiceOrder = serviceOrders.find(so => 
          so.id !== serviceOrder.id && 
          isJobInProgress(so)
        );

        // Check for active job orders
        const activeJobOrder = jobOrders.find(jo => 
          isJobInProgress(jo)
        );

        // Check for active work orders
        const activeWorkOrder = workOrders.find(wo => 
          isJobInProgress(wo)
        );

        if (activeServiceOrder || activeJobOrder || activeWorkOrder) {
          let activeJobDetails = '';
          if (activeServiceOrder) {
            const id = activeServiceOrder.ticketId || activeServiceOrder.id;
            const name = activeServiceOrder.fullName || 'Unknown';
            activeJobDetails = `\n\nActive Job:\n• Type: Service Order\n• ID: ${id}\n• Name: ${name}`;
          } else if (activeJobOrder) {
            const id = activeJobOrder.id || activeJobOrder.JobOrder_ID || 'N/A';
            const name = [
              activeJobOrder.First_Name || activeJobOrder.first_name || '',
              activeJobOrder.Middle_Initial || activeJobOrder.middle_initial ? (activeJobOrder.Middle_Initial || activeJobOrder.middle_initial) + '.' : '',
              activeJobOrder.Last_Name || activeJobOrder.last_name || ''
            ].filter(Boolean).join(' ').trim() || 'Unknown Client';
            activeJobDetails = `\n\nActive Job:\n• Type: Job Order\n• ID: ${id}\n• Name: ${name}`;
          } else if (activeWorkOrder) {
            const id = activeWorkOrder.id || 'N/A';
            const name = activeWorkOrder.instructions || 'No Instructions';
            activeJobDetails = `\n\nActive Job:\n• Type: Work Order\n• ID: ${id}\n• Name: ${name}`;
          }

          Alert.alert(
            'Cannot Start',
            `You already have another job in progress. Please finish it before starting a new one.${activeJobDetails}`,
            [{ text: 'OK' }]
          );
          return;
        }
      }

      setIsStartTimerModalOpen(true);
    } catch (err: any) {
      setError(`Failed to prepare timer: ${err.message}`);
    }
  };

  const handleConfirmStartTimer = async (selectedTechnicians: string[]) => {
    try {
      setLoading(true);
      if (!serviceOrder.id) throw new Error('Cannot update service order: Missing ID');

      const currentTime = dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss');
      await updateServiceOrder(serviceOrder.id, {
        start_time: currentTime,
        end_time: null,
        technicians: selectedTechnicians,
      } as any);

      (serviceOrder as any).start_time = currentTime;
      (serviceOrder as any).end_time = null;
      (serviceOrder as any).technicians = selectedTechnicians;
      setIsStarted(true);
      setIsEnded(false);
      setIsStartTimerModalOpen(false);
      setSuccessMessage('Timer started successfully!');
      setShowSuccessModal(true);
      silentRefresh();
    } catch (err: any) {
      console.error('Failed to start timer:', err);
      setError(`Failed to start timer: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEndTimer = async () => {
    try {
      setLoading(true);
      if (!serviceOrder.id) throw new Error('Cannot update service order: Missing ID');

      const currentTime = dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss');
      await updateServiceOrder(serviceOrder.id, {
        end_time: currentTime,
      } as any);

      (serviceOrder as any).end_time = currentTime;
      setIsEnded(true);
      setSuccessMessage('Timer ended successfully!');
      setShowSuccessModal(true);
      silentRefresh();
    } catch (err: any) {
      console.error('Failed to end timer:', err);
      setError(`Failed to end timer: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const selectAllFields = useCallback(() => {
    const allVisible = defaultFields.reduce((acc, field) => ({ ...acc, [field]: true }), {});
    setFieldVisibility(allVisible);
  }, []);

  const deselectAllFields = useCallback(() => {
    const allHidden = defaultFields.reduce((acc, field) => ({ ...acc, [field]: false }), {});
    setFieldVisibility(allHidden);
  }, []);

  const resetFieldSettings = useCallback(() => {
    setFieldVisibility(initialVisibility);
    setFieldOrder(defaultFields);
  }, []);

  const valStyle = [styles.valueText, { color: '#111827' }];

  const isFieldEmpty = useCallback((fieldKey: string): boolean => {
    if (fieldKey === 'duration') return !(serviceOrder as any).start_time;
    if (fieldKey === 'startTime') return !(serviceOrder as any).start_time;
    if (fieldKey === 'endTime') return !(serviceOrder as any).end_time;

    const val = (serviceOrder as any)[fieldKey];
    if (fieldKey === 'addressCoordinates') return !customerDetail?.addressCoordinates;
    if (val === null || val === undefined || val === '') return true;
    if (val === '-' || val === 'None' || val === 'Not assigned' || val === 'No remarks' || val === 'Not set') return true;

    // Special check for images
    if (['houseFrontPicture', 'image1Url', 'image2Url', 'image3Url', 'setupImageUrl', 'routerReadingImageUrl', 'boxReadingImageUrl', 'speedtestImageUrl', 'clientSignatureUrl', 'proof_of_billing_url', 'government_valid_id_url', 'second_government_valid_id_url', 'document_attachment_url', 'other_isp_bill_url'].includes(fieldKey)) {
      if (fieldKey === 'proof_of_billing_url') {
        const img = customerDetail?.proofOfBillingUrl || customerDetail?.proof_of_billing_url;
        return !img || img.trim() === '' || img.trim() === 'No image available' || img.trim() === 'No image';
      }
      if (fieldKey === 'government_valid_id_url') {
        const img = customerDetail?.governmentValidIdUrl || customerDetail?.government_valid_id_url;
        return !img || img.trim() === '' || img.trim() === 'No image available' || img.trim() === 'No image';
      }
      if (fieldKey === 'second_government_valid_id_url') {
        const img = customerDetail?.secondGovernmentValidIdUrl || customerDetail?.second_government_valid_id_url;
        return !img || img.trim() === '' || img.trim() === 'No image available' || img.trim() === 'No image';
      }
      if (fieldKey === 'document_attachment_url') {
        const img = customerDetail?.documentAttachmentUrl || customerDetail?.document_attachment_url;
        return !img || img.trim() === '' || img.trim() === 'No image available' || img.trim() === 'No image';
      }
      if (fieldKey === 'other_isp_bill_url') {
        const img = customerDetail?.otherIspBillUrl || customerDetail?.other_isp_bill_url;
        return !img || img.trim() === '' || img.trim() === 'No image available' || img.trim() === 'No image';
      }
      if (fieldKey === 'houseFrontPicture') {
        const img = customerDetail?.houseFrontPictureUrl || serviceOrder.houseFrontPicture;
        return !img || img.trim() === '' || img.trim() === 'No image available' || img.trim() === 'No image';
      }
      return !val || val.trim() === '' || val.trim() === 'No image available' || val.trim() === 'No image';
    }

    // Special check for numeric/currency
    if (fieldKey === 'serviceCharge') {
      return !val || val === '0';
    }

    return false;
  }, [serviceOrder]);

  const getDurationString = (start?: string | null, end?: string | null): string => {
    if (!start) return 'N/A';
    try {
      const startTime = dayjs.tz(start, 'Asia/Manila').valueOf();
      const endTime = end ? dayjs.tz(end, 'Asia/Manila').valueOf() : now.valueOf();
      
      if (isNaN(startTime) || isNaN(endTime)) return 'N/A';
      
      const diff = Math.max(0, endTime - startTime);
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      return `${hours}h ${minutes}m ${seconds}s`;
    } catch (e) {
      return 'N/A';
    }
  };

  const fieldRenderers: Record<string, () => React.ReactNode> = useMemo(() => ({
    ticketId: () => <Text style={valStyle} selectable={true}>{serviceOrder.ticketId}</Text>,
    timestamp: () => <Text style={valStyle} selectable={true}>{formatDate(serviceOrder.timestamp)}</Text>,
    accountNumber: () => (
      <Text style={[styles.accountDetailsText, styles.valueText]} selectable={true}>
        {serviceOrder.accountNumber} | {serviceOrder.fullName} | {serviceOrder.fullAddress}
      </Text>
    ),
    dateInstalled: () => <Text style={valStyle} selectable={true}>{formatDateOnly(serviceOrder.dateInstalled)}</Text>,
    startTime: () => <Text style={valStyle} selectable={true}>{formatDate((serviceOrder as any).start_time)}</Text>,
    endTime: () => <Text style={valStyle} selectable={true}>{formatDate((serviceOrder as any).end_time)}</Text>,
    duration: () => <Text style={valStyle} selectable={true}>{getDurationString((serviceOrder as any).start_time, (serviceOrder as any).end_time)}</Text>,
    fullName: () => <Text style={valStyle} selectable={true}>{serviceOrder.fullName}</Text>,
    contactNumber: () => <Text style={valStyle} selectable={true}>{serviceOrder.contactNumber}</Text>,
    fullAddress: () => <Text style={valStyle} selectable={true}>{serviceOrder.fullAddress}</Text>,
    addressCoordinates: () => {
      const coords = customerDetail?.addressCoordinates;
      return (
        <View style={styles.imageLinkContainer}>
          <Text style={valStyle} selectable={true}>{coords || 'Not provided'}</Text>
          {coords && (
            <Pressable onPress={() => handleOpenURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}`)}>
              <MapPin width={24} height={24} color="#4b5563" />
            </Pressable>
          )}
        </View>
      );
    },
    houseFrontPicture: () => renderImageLinkContent(customerDetail?.houseFrontPictureUrl || serviceOrder.houseFrontPicture),
    emailAddress: () => <Text style={valStyle} selectable={true}>{serviceOrder.emailAddress}</Text>,
    plan: () => <Text style={valStyle} selectable={true}>{serviceOrder.plan}</Text>,
    username: () => <Text style={valStyle} selectable={true}>{serviceOrder.username}</Text>,
    connectionType: () => <Text style={valStyle} selectable={true}>{serviceOrder.connectionType}</Text>,
    routerModemSN: () => <Text style={valStyle} selectable={true}>{serviceOrder.routerModemSN}</Text>,
    lcp: () => <Text style={valStyle} selectable={true}>{serviceOrder.lcp}</Text>,
    nap: () => <Text style={valStyle} selectable={true}>{serviceOrder.nap}</Text>,
    port: () => <Text style={valStyle} selectable={true}>{serviceOrder.port}</Text>,
    vlan: () => <Text style={valStyle} selectable={true}>{serviceOrder.vlan}</Text>,
    concern: () => <Text style={valStyle} selectable={true}>{serviceOrder.concern}</Text>,
    concernRemarks: () => <Text style={valStyle} selectable={true}>{serviceOrder.concernRemarks}</Text>,
    visitStatus: () => (
      <Text style={[styles.statusText, { color: getStatusColor(serviceOrder.visitStatus, 'visit') }]} selectable={true}>
        {serviceOrder.visitStatus === 'inprogress' ? 'In Progress' : (serviceOrder.visitStatus || 'Not set')}
      </Text>
    ),
    visitBy: () => <Text style={valStyle} selectable={true}>{serviceOrder.visitBy || 'Not assigned'}</Text>,
    visitWith: () => <Text style={valStyle} selectable={true}>{serviceOrder.visitWith || 'None'}</Text>,
    visitWithOther: () => <Text style={valStyle} selectable={true}>{serviceOrder.visitWithOther || 'None'}</Text>,
    visitRemarks: () => <Text style={valStyle} selectable={true}>{serviceOrder.visitRemarks || 'No remarks'}</Text>,
    modifiedBy: () => <Text style={valStyle} selectable={true}>{serviceOrder.modifiedBy || 'System'}</Text>,
    modifiedDate: () => <Text style={valStyle} selectable={true}>{formatDate(serviceOrder.modifiedDate)}</Text>,
    requestedBy: () => <Text style={valStyle} selectable={true}>{serviceOrder.requestedBy}</Text>,
    assignedEmail: () => <Text style={valStyle} selectable={true}>{serviceOrder.assignedEmail || 'Not assigned'}</Text>,
    supportRemarks: () => <Text style={valStyle} selectable={true}>{serviceOrder.supportRemarks || 'No remarks'}</Text>,
    supportStatus: () => (
      <Text style={[styles.statusText, { color: getStatusColor(serviceOrder.supportStatus, 'support') }]} selectable={true}>
        {serviceOrder.supportStatus || 'Not set'}
      </Text>
    ),
    repairCategory: () => <Text style={valStyle} selectable={true}>{serviceOrder.repairCategory || 'None'}</Text>,
    newRouterSn: () => <Text style={valStyle} selectable={true}>{serviceOrder.newRouterSn || 'None'}</Text>,
    newLcpnap: () => <Text style={valStyle} selectable={true}>{serviceOrder.newLcpnap || 'None'}</Text>,
    newLcp: () => <Text style={valStyle} selectable={true}>{serviceOrder.newLcp || 'None'}</Text>,
    newNap: () => <Text style={valStyle} selectable={true}>{serviceOrder.newNap || 'None'}</Text>,
    newPort: () => <Text style={valStyle} selectable={true}>{serviceOrder.newPort || 'None'}</Text>,
    newVlan: () => <Text style={valStyle} selectable={true}>{serviceOrder.newVlan || 'None'}</Text>,
    routerModel: () => <Text style={valStyle} selectable={true}>{serviceOrder.routerModel || 'None'}</Text>,
    newPlan: () => <Text style={valStyle} selectable={true}>{serviceOrder.newPlan || 'None'}</Text>,
    orderItems: () => (
      <View style={{ gap: 4 }}>
        {orderItems.length > 0 ? (
          orderItems.map((item, idx) => (
            <Text key={idx} style={valStyle} selectable={true}>
              • {item.item_name} (Qty: {item.quantity})
            </Text>
          ))
        ) : (
          <Text style={valStyle} selectable={true}>None</Text>
        )}
      </View>
    ),
    image1Url: () => renderImageLinkContent(serviceOrder.image1Url),
    image2Url: () => renderImageLinkContent(serviceOrder.image2Url),
    image3Url: () => renderImageLinkContent(serviceOrder.image3Url),
    setupImageUrl: () => renderImageLinkContent(serviceOrder.setupImageUrl),
    routerReadingImageUrl: () => renderImageLinkContent(serviceOrder.routerReadingImageUrl),
    boxReadingImageUrl: () => renderImageLinkContent(serviceOrder.boxReadingImageUrl),
    speedtestImageUrl: () => renderImageLinkContent(serviceOrder.speedtestImageUrl),
    clientSignatureUrl: () => renderImageLinkContent(serviceOrder.clientSignatureUrl),
    proofImageUrl: () => renderImageLinkContent(serviceOrder.proofImageUrl),
    serviceCharge: () => <Text style={valStyle} selectable={true}>₱{parseFloat(serviceOrder.serviceCharge || '0').toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>,
    priorityLevel: () => <Text style={valStyle} selectable={true}>{serviceOrder.priorityLevel || 'Normal'}</Text>,
    affiliate: () => <Text style={valStyle} selectable={true}>{serviceOrder.affiliate || 'None'}</Text>,
    referredBy: () => <Text style={valStyle} selectable={true}>{(serviceOrder as any).referredBy || 'None'}</Text>,
    region: () => <Text style={valStyle} selectable={true}>{serviceOrder.region || 'None'}</Text>,
    city: () => <Text style={valStyle} selectable={true}>{serviceOrder.city || 'None'}</Text>,
    barangay: () => <Text style={valStyle} selectable={true}>{serviceOrder.barangay || 'None'}</Text>,
    proof_of_billing_url: () => renderImageLinkContent(customerDetail?.proofOfBillingUrl || customerDetail?.proof_of_billing_url),
    government_valid_id_url: () => renderImageLinkContent(customerDetail?.governmentValidIdUrl || customerDetail?.government_valid_id_url),
    second_government_valid_id_url: () => renderImageLinkContent(customerDetail?.secondGovernmentValidIdUrl || customerDetail?.second_government_valid_id_url),
    document_attachment_url: () => renderImageLinkContent(customerDetail?.documentAttachmentUrl || customerDetail?.document_attachment_url),
    other_isp_bill_url: () => renderImageLinkContent(customerDetail?.otherIspBillUrl || customerDetail?.other_isp_bill_url),
  }), [serviceOrder, userRole, userRoleId, isFieldEmpty, now, isStarted, isEnded, customerDetail, orderItems]);

  const renderField = (label: string, content: React.ReactNode) => (
    <View style={[styles.fieldContainer, { borderBottomColor: '#e5e7eb' }]}>
      <Text style={[styles.fieldLabel, { color: '#6b7280' }]}>{label}</Text>
      <View style={styles.fieldValueContainer}>
        {content}
      </View>
    </View>
  );

  const handleOpenURL = async (url: string | undefined | null) => {
    if (!url) return;
    const trimmed = url.trim();
    if (trimmed === 'No image available' || trimmed === 'No image' || trimmed === '') {
      Alert.alert('Info', 'No image available to view.');
      return;
    }

    try {
      let finalUrl = trimmed;
      // Ensure the URL has a proper scheme
      if (!/^[a-zA-Z]+:\/\//.test(finalUrl)) {
        if (finalUrl.startsWith('/')) {
          const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || '';
          const origin = apiBase.split('/api')[0];
          finalUrl = `${origin}${finalUrl}`;
        } else {
          finalUrl = `https://${finalUrl}`;
        }
      }

      // On web, use window.open with _blank to open in a new tab
      // On native, use Linking.openURL
      if (Platform.OS === 'web') {
        const win = window.open(finalUrl, '_blank', 'noopener,noreferrer');
        if (!win) {
          // Popup was blocked, fall back to Linking
          await Linking.openURL(finalUrl);
        }
      } else {
        const supported = await Linking.canOpenURL(finalUrl);
        if (supported) {
          await Linking.openURL(finalUrl);
        } else {
          Alert.alert('Error', 'Cannot open this URL: ' + finalUrl);
        }
      }
    } catch (err: any) {
      Alert.alert('Error', 'Failed to open link: ' + err.message);
    }
  };

  const renderImageLinkContent = (url: string | undefined | null) => {
    const isNoImage = !url || url.trim() === '' || url.trim() === 'No image available' || url.trim() === 'No image';
    return (
      <View style={styles.imageLinkContainer}>
        {!isNoImage ? (
          <Pressable 
            onPress={() => handleOpenURL(url)}
            style={({ pressed }) => [
              { opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center' }
            ]}
          >
            <Text style={[styles.imageLinkText, styles.valueText, { color: '#2563eb', textDecorationLine: 'underline', flex: 0, marginRight: 4 }]} selectable={true}>
              View
            </Text>
            <Pressable onPress={() => handleOpenURL(url)}>
              <ExternalLink width={14} height={14} color="#2563eb" />
            </Pressable>
          </Pressable>
        ) : (
          <Text style={[styles.imageLinkText, styles.valueText, { color: '#9ca3af' }]} selectable={true}>
            No image available
          </Text>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { borderLeftWidth: !isMobile ? 1 : 0, backgroundColor: '#f9fafb', borderLeftColor: '#d1d5db' }]}>
      <View style={[styles.header, { backgroundColor: '#ffffff', borderBottomColor: '#e5e7eb', paddingTop: isMobile ? 60 : 12 }]}>
        <View style={styles.headerTitleContainer}>
          <Pressable onPress={onClose} style={styles.backButton}>
            <ChevronLeft width={28} height={28} color="#4b5563" />
          </Pressable>
          <View style={styles.centeredTitle}>
            <Text style={[styles.headerTitle, { fontSize: isMobile ? 14 : 18, color: '#111827' }]} numberOfLines={1} selectable={true}>
              {serviceOrder.fullName}
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          {/* Start Timer Button */}
          {((!isStarted || (['reschedule'].includes(((serviceOrder as any).visitStatus || '').toLowerCase().trim() || ((serviceOrder as any).visit_status || '').toLowerCase().trim() || '') && isStarted && isEnded))) && 
           ['in progress', 'inprogress', 'reschedule'].includes(((serviceOrder as any).visitStatus || '').toLowerCase().trim() || ((serviceOrder as any).visit_status || '').toLowerCase().trim() || '') && 
           (userRoleId === 2 || userRole?.toLowerCase() === 'technician') && (
            <Pressable
              style={[styles.iconBtn, {
                backgroundColor: technicianLocked ? '#d1d5db' : (colorPalette?.primary || '#10b981'),
              }]}
              onPress={handleStartTimer}
              disabled={loading || technicianLocked}
            >
              {technicianLocked
                ? <Lock width={18} height={18} color="#6b7280" />
                : <Play width={18} height={18} color="#ffffff" />}
            </Pressable>
          )}

          {shouldShowEnableTechnicianButton() && (
            <Pressable
              style={[styles.headerButton, { backgroundColor: technicianEnabled ? '#e5e7eb' : '#059669' }]}
              onPress={handleEnableTechnicianClick}
              disabled={technicianEnabled || isEnablingTechnician}
            >
              {isEnablingTechnician && (
                <ActivityIndicator size="small" color="#ffffff" style={styles.headerButtonIcon} />
              )}
              <Text style={[styles.headerButtonText, { color: technicianEnabled ? '#6b7280' : '#ffffff' }]}>
                {technicianEnabled ? 'Enabled' : (isEnablingTechnician ? 'Enabling...' : 'Enable')}
              </Text>
            </Pressable>
          )}

          {userRole !== 'agent' && userRoleId !== 4 && ['in progress', 'reschedule'].includes(serviceOrder.visitStatus?.toLowerCase().trim() || '') && (
            <Pressable
              style={[styles.headerButton, { backgroundColor: technicianLocked ? '#d1d5db' : (colorPalette?.primary || '#7c3aed') }]}
              onPress={handleEditClick}
              disabled={technicianLocked}
            >
              {technicianLocked
                ? <Lock width={16} height={16} color="#6b7280" style={styles.headerButtonIcon} />
                : <Edit width={16} height={16} color="#ffffff" style={styles.headerButtonIcon} />}
              <Text style={[styles.headerButtonText, technicianLocked ? { color: '#6b7280' } : null]}>Edit</Text>
            </Pressable>
          )}
          {/* Symmetric placeholder if no actions are visible */}
          {(!userRole || userRole === 'agent' || userRoleId === 4) && (
            <View style={{ width: 28 }} />
          )}
        </View>
      </View>

      <ScrollView style={styles.flex1} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {fieldOrder.map(key => {
            if (!fieldVisibility[key]) return null;
            const renderer = fieldRenderers[key];
            if (!renderer) return null;
            return <React.Fragment key={key}>{renderField(getFieldLabel(key), renderer())}</React.Fragment>;
          })}
        </View>
      </ScrollView>


      {isEditModalOpen && (
        <ServiceOrderEditModal
          isOpen={isEditModalOpen}
          onClose={handleCloseEditModal}
          onSave={handleSaveEdit}
          serviceOrderData={serviceOrder}
        />
      )}

      {error && (
        <View style={[styles.errorBox, { backgroundColor: '#fef2f2', borderColor: '#fca5a5' }]}>
          <Text style={{ color: '#991b1b' }}>{error}</Text>
        </View>
      )}

      <ConfirmationModal
        isOpen={showSuccessModal}
        title="Success"
        message={successMessage}
        confirmText="OK"
        cancelText="Close"
        onConfirm={() => setShowSuccessModal(false)}
        onCancel={() => setShowSuccessModal(false)}
      />

      <ConfirmationModal
        isOpen={showTimeInWarning}
        title="Action Required"
        message="You need to time in first in the menu before starting a service order."
        confirmText="OK"
        cancelText="Close"
        onConfirm={() => setShowTimeInWarning(false)}
        onCancel={() => setShowTimeInWarning(false)}
      />

      <StartTimerModal
        isOpen={isStartTimerModalOpen}
        onClose={() => setIsStartTimerModalOpen(false)}
        onConfirm={handleConfirmStartTimer}
        loading={loading}
        colorPalette={colorPalette}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { height: '100%', flexDirection: 'column', overflow: 'hidden', position: 'relative', width: '100%' },
  header: { padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitleContainer: { flexDirection: 'row', alignItems: 'center', flex: 1, position: 'relative' },
  backButton: { position: 'absolute', left: 0, zIndex: 10 },
  centeredTitle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontWeight: '500', textAlign: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, flexDirection: 'row', alignItems: 'center' },
  headerButtonText: { color: '#ffffff', fontWeight: '500', fontSize: 14 },
  headerButtonIcon: { marginRight: 4 },
  iconBtn: { padding: 6, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  settingsButton: { padding: 4 },
  flex1: { flex: 1 },
  content: { width: '100%', paddingTop: 8, paddingBottom: 120 },
  fieldContainer: { flexDirection: 'column', borderBottomWidth: 1, paddingVertical: 8, paddingHorizontal: 16, gap: 2 },
  fieldLabel: { fontSize: 14, fontWeight: '500' },
  fieldValueContainer: { width: '100%' },
  imageLinkContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  imageLinkText: { flex: 1, marginRight: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '90%', maxWidth: 400, borderRadius: 8, borderWidth: 1, maxHeight: '80%', overflow: 'hidden' },
  modalHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontWeight: '600' },
  modalHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalActionText: { color: '#2563eb', fontSize: 12 },
  modalList: { padding: 8 },
  modalItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 4 },
  checkbox: { height: 18, width: 18, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkboxTick: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },
  modalItemText: { fontSize: 14 },
  valueText: { fontSize: 16 },
  accountDetailsText: { color: '#ef4444' },
  statusText: { fontWeight: '600', textTransform: 'uppercase' },
  errorBox: { padding: 12, margin: 12, borderRadius: 4, borderWidth: 1 },
});

export default ServiceOrderDetails;
