import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Linking,
  useWindowDimensions,
  StyleSheet,
  DeviceEventEmitter,
  Alert,
  ActivityIndicator
} from 'react-native';
import { X, ExternalLink, Play, Square, Paperclip, Lock } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

import { WorkOrderDetailsProps } from '../types/workOrder';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { updateWorkOrder, enableWorkOrderForTechnician } from '../services/workOrderService';
import {
  buildTechnicianLockedWorkOrderIds,
  isClosedForTechnicianQueue,
  isTechnicianEnabled,
  TECHNICIAN_LOCKED_MESSAGE,
} from '../utils/technicianWorkOrderAccess';
import ConfirmationModal from '../modals/MoveToJoModal';
import StartTimerModal from '../modals/StartTimerModal';
import { useServiceOrderContext } from '../contexts/ServiceOrderContext';
import { useJobOrderContext } from '../contexts/JobOrderContext';
import { useWorkOrderStore } from '../store/workOrderStore';
import { techInOutService } from '../services/techInOutService';

const checkIsStarted = (time?: string | null) => {
  if (!time) return false;
  const lowerTime = String(time).toLowerCase().trim();
  return !['0000-00-00 00:00:00', 'not set', '-', 'none', '', 'null', 'undefined'].includes(lowerTime);
};

const formatDate = (dateStr?: string | null): string => {
  if (!dateStr) return 'Not set';
  try {
    const d = dayjs.tz(dateStr, 'Asia/Manila');
    if (!d.isValid()) return dateStr;
    return d.format('MM/DD/YYYY hh:mm A');
  } catch (e) {
    return 'Not set';
  }
};

const getDurationString = (start?: string | null, end?: string | null, now?: any): string => {
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

const getStatusColor = (status: string | undefined | null): string => {
  if (!status) return '#9ca3af';
  const s = status.toLowerCase().trim();
  switch (s) {
    case 'completed':
    case 'done':
      return '#4ade80';
    case 'in progress':
    case 'inprogress':
      return '#60a5fa';
    case 'pending':
      return '#fb923c';
    case 'failed':
    case 'cancelled':
      return '#ef4444';
    case 'on hold':
      return '#a78bfa';
    default:
      return '#9ca3af';
  }
};

const getFieldLabel = (fieldKey: string): string => {
  const labels: Record<string, string> = {
    workOrderId: 'Work Order ID',
    instructions: 'Instructions / Brief Description',
    reportTo: 'Report To',
    assignTo: 'Assign To',
    workStatus: 'Work Status',
    remarks: 'Remarks',
    requestedBy: 'Requested By',
    requestedDate: 'Requested Date',
    updatedBy: 'Updated By',
    updatedDate: 'Updated Date',
    startTime: 'Start Time',
    endTime: 'End Time',
    duration: 'Duration',
    image1: 'Image 1',
    image2: 'Image 2',
    image3: 'Image 3',
    signature: 'Signature',
  };
  return labels[fieldKey] || fieldKey;
};

const defaultFields = [
  'workOrderId',
  'instructions',
  'reportTo',
  'assignTo',
  'workStatus',
  'remarks',
  'requestedBy',
  'requestedDate',
  'updatedBy',
  'updatedDate',
  'startTime',
  'endTime',
  'duration',
  'image1',
  'image2',
  'image3',
  'signature',
];

const WorkOrderDetails: React.FC<WorkOrderDetailsProps & { isDarkMode?: boolean; colorPalette?: ColorPalette | null }> = ({
  workOrder,
  onClose,
  onEdit,
  onRefresh,
  isDarkMode: propDarkMode,
  colorPalette: propColorPalette
}) => {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const { serviceOrders } = useServiceOrderContext();
  const { jobOrders } = useJobOrderContext();
  const { workOrders } = useWorkOrderStore();

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => propColorPalette ?? settingsColorPaletteService.getActiveSync());
  const [userRole, setUserRole] = useState<string>('');
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [userFullName, setUserFullName] = useState<string>('');
  const [techStatus, setTechStatus] = useState<'online' | 'offline'>('offline');
  const [showTimeInWarning, setShowTimeInWarning] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [isStartTimerModalOpen, setIsStartTimerModalOpen] = useState(false);
  const [isStarted, setIsStarted] = useState(checkIsStarted(workOrder?.start_time));
  const [isEnded, setIsEnded] = useState(checkIsStarted(workOrder?.end_time));
  const [isEnablingTechnician, setIsEnablingTechnician] = useState(false);
  /**
   * Local echo of technician_enabled after a successful enable.
   *
   * The list refresh is what makes the change permanent everywhere; this only
   * keeps the button honest in the moment between the two. Cleared whenever a
   * different work order is opened so it can never leak across records.
   */
  const [technicianEnabledOverride, setTechnicianEnabledOverride] = useState<boolean | null>(null);

  // ── Technician queue release ────────────────────────────────────────────────
  // Technicians work their work orders In Progress first and oldest first within
  // that: everything else active is greyed out until either the work ahead of it
  // moves forward or an administrator releases one early.

  const isAdminUser = (userRole || '').toLowerCase() === 'administrator'
    || (userRole || '').toLowerCase() === 'superadmin'
    || userRoleId === 1 || userRoleId === 7;

  const technicianEnabled = technicianEnabledOverride ?? isTechnicianEnabled(workOrder);

  const isTechnicianViewer = userRole === 'technician' || userRoleId === 2 || String(userRoleId) === '2';

  /**
   * Is this work order still waiting its turn in the technician's queue?
   *
   * The same rule the list greys rows out with. Starting and editing wait until
   * it is their next work order or an administrator releases it; reading never
   * does. WorkOrderApiController::isWorkOrderLockedForTechnician() refuses the
   * update either way, so gating the buttons is what keeps the technician from
   * filling in a form that cannot be saved.
   */
  const technicianLocked = React.useMemo(() => {
    if (!isTechnicianViewer || technicianEnabled || !workOrder) return false;
    return buildTechnicianLockedWorkOrderIds(workOrders, { email: userEmail, fullName: userFullName })
      .has(String(workOrder.id));
  }, [isTechnicianViewer, technicianEnabled, workOrders, workOrder, userEmail, userFullName]);

  // Offered for administrators on any record a technician still owes work on,
  // including one that is deferred — that is precisely the case where they cannot
  // pick it back up on their own. Only work that is finished, failed or cancelled
  // has nothing left to release.
  const shouldShowEnableTechnicianButton = () =>
    isAdminUser && !!workOrder && !isClosedForTechnicianQueue(workOrder);

  const handleEnableTechnicianClick = async () => {
    if (isEnablingTechnician || technicianEnabled) return;

    if (!workOrder?.id) {
      setError('Cannot enable work order: Missing ID');
      return;
    }

    setError(null);
    setIsEnablingTechnician(true);

    try {
      const response = await enableWorkOrderForTechnician(workOrder.id);

      if (response?.success) {
        setTechnicianEnabledOverride(true);
        setSuccessMessage('Work order enabled. The technician can now start it.');
        setShowSuccessModal(true);
        if (onRefresh) onRefresh();
      } else {
        setError((response as any)?.message || 'Failed to enable work order for the technician');
      }
    } catch (err: any) {
      setError(
        err.response?.data?.message || err.message || 'Failed to enable work order for the technician'
      );
    } finally {
      setIsEnablingTechnician(false);
    }
  };

  // A different record is a different lock state.
  useEffect(() => {
    setTechnicianEnabledOverride(null);
  }, [workOrder?.id]);
  const [now, setNow] = useState(dayjs().tz('Asia/Manila').add(8, 'hour'));

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
    setIsStarted(checkIsStarted(workOrder?.start_time));
    setIsEnded(checkIsStarted(workOrder?.end_time));
  }, [workOrder?.start_time, workOrder?.end_time]);

  const handleStartTimer = async () => {
    if (!workOrder) return;
    try {
      const isTechnician = userRole === 'technician' || userRoleId === 2 || String(userRoleId) === '2';
      if (isTechnician) {
        if (techStatus === 'offline') {
          setShowTimeInWarning(true);
          return;
        }

        const isJobInProgress = (item: any) => {
          const hasStarted = checkIsStarted(item.start_time) || checkIsStarted(item.StartTimeStamp) || checkIsStarted(item.start_timestamp);
          const hasEnded = checkIsStarted(item.end_time) || checkIsStarted(item.EndTimeStamp) || checkIsStarted(item.end_timestamp);
          const status = (item.visit_status || item.visitStatus || item.onsite_status || item.Onsite_Status || item.work_status || item.workStatus || '').toLowerCase().trim();
          
          if (!hasStarted || hasEnded) return false;
          if (status !== 'in progress' && status !== 'reschedule' && status !== 'inprogress' && status !== 'in-progress') return false;

          const loggedInEmail = userEmail.toLowerCase().trim();
          const loggedInName = userFullName.toLowerCase().trim();
          if (!loggedInEmail) return false;

          const assigned = (item.assignedEmail || item.assigned_email || item.visitBy || item.visit_by_user || item.Visit_By || item.visit_by || item.assign_to || item.assignTo || '').toLowerCase();
          const isAssigned = assigned.includes(loggedInEmail) || (loggedInName && assigned.includes(loggedInName));

          const itemTechs = Array.isArray(item.technicians) ? item.technicians : [];
          const isTechAssigned = itemTechs.some((tech: string) => {
            const t = String(tech).toLowerCase();
            return t.includes(loggedInEmail) || (loggedInName && t.includes(loggedInName));
          });

          return isAssigned || isTechAssigned;
        };

        // Check for other active work orders
        const activeWorkOrder = workOrders.find(wo => 
          wo.id !== workOrder.id && 
          isJobInProgress(wo)
        );

        // Check for active service orders
        const activeServiceOrder = serviceOrders.find(so => 
          isJobInProgress(so)
        );

        // Check for active job orders
        const activeJobOrder = jobOrders.find(jo => 
          isJobInProgress(jo)
        );

        if (activeWorkOrder || activeServiceOrder || activeJobOrder) {
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
      if (!workOrder?.id) throw new Error('Cannot update work order: Missing ID');

      const currentTime = dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss');
      await updateWorkOrder(workOrder.id!, {
        start_time: currentTime,
        end_time: null,
      } as any);

      (workOrder as any).start_time = currentTime;
      (workOrder as any).end_time = null;
      setIsStarted(true);
      setIsEnded(false);
      setIsStartTimerModalOpen(false);
      setSuccessMessage('Timer started successfully!');
      setShowSuccessModal(true);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setError(`Failed to start timer: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEndTimer = async () => {
    try {
      setLoading(true);
      if (!workOrder?.id) throw new Error('Cannot update work order: Missing ID');

      const currentTime = dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss');
      await updateWorkOrder(workOrder.id!, {
        end_time: currentTime,
      } as any);

      (workOrder as any).end_time = currentTime;
      setIsEnded(true);
      setSuccessMessage('Timer ended successfully!');
      setShowSuccessModal(true);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setError(`Failed to end timer: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      const authData = await AsyncStorage.getItem('authData');
      if (authData) {
        try {
          const parsed = JSON.parse(authData);
          setUserRoleId(parsed.role_id || parsed.roleId || null);
          setUserRole(parsed.role?.toLowerCase() || parsed.roleName?.toLowerCase() || '');
          setUserEmail(parsed.email_address || parsed.email || '');
          const fullName = parsed.full_name || `${parsed.first_name || ''} ${parsed.last_name || ''}`.trim();
          setUserFullName(fullName || parsed.username || '');

          const currentRole = parsed.role?.toLowerCase() || parsed.roleName?.toLowerCase() || '';
          const currentRoleId = parsed.role_id || parsed.roleId || null;
          const isTechnician = currentRole === 'technician' || currentRoleId === 2;
          if (isTechnician) {
            const userId = parsed.id || parsed.user_id || parsed.user?.id;
            if (userId) {
              const response = await techInOutService.getStatus(userId);
              if (response.success && response.data) {
                const isOnline = !!(response.data.time_in && !response.data.time_out);
                setTechStatus(isOnline ? 'online' : 'offline');
              }
            }
          }
        } catch (error) { }
      }
    };
    loadSettings();

    const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      setColorPalette(newPalette);
    });

    return () => paletteSub.remove();
  }, []);

  useEffect(() => {
    if (propColorPalette) setColorPalette(propColorPalette);
  }, [propColorPalette]);

  if (!workOrder) return null;

  const dynamicValueColor = '#111827';
  const valStyle = [st.valueText, { color: dynamicValueColor }];

  const renderImageLink = useCallback((url: string | undefined | null) => (
    <View style={st.imageLinkRow}>
      {url ? (
        <Pressable 
          onPress={() => Linking.openURL(url)}
          style={({ pressed }) => [
            { opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center' }
          ]}
        >
          <Text style={[st.imageLinkText, { color: '#2563eb', textDecorationLine: 'underline', flex: 0, marginRight: 4 }]} selectable={true}>
            View
          </Text>
          <ExternalLink width={14} height={14} color="#2563eb" />
        </Pressable>
      ) : (
        <Text style={[st.imageLinkText, { color: '#9ca3af' }]} selectable={true}>
          No image available
        </Text>
      )}
    </View>
  ), []);







  const fieldRenderers: Record<string, () => React.ReactNode> = useMemo(() => ({
    workOrderId: () => <Text style={valStyle} selectable={true}>{workOrder.id || 'N/A'}</Text>,
    instructions: () => <Text style={valStyle} selectable={true}>{workOrder.instructions || 'No instructions'}</Text>,
    reportTo: () => <Text style={valStyle} selectable={true}>{workOrder.report_to || 'Not specified'}</Text>,
    assignTo: () => <Text style={valStyle} selectable={true}>{workOrder.assign_to || 'Not assigned'}</Text>,
    workStatus: () => (
      <Text style={[st.statusText, { color: getStatusColor(workOrder.work_status) }]}>
        {workOrder.work_status || 'Not set'}
      </Text>
    ),
    remarks: () => <Text style={valStyle} selectable={true}>{workOrder.remarks || 'No remarks'}</Text>,
    requestedBy: () => <Text style={valStyle} selectable={true}>{workOrder.requested_by || 'System'}</Text>,
    requestedDate: () => <Text style={valStyle} selectable={true}>{formatDate(workOrder.requested_date)}</Text>,
    updatedBy: () => <Text style={valStyle} selectable={true}>{workOrder.updated_by || 'Not updated'}</Text>,
    updatedDate: () => <Text style={valStyle} selectable={true}>{formatDate(workOrder.updated_date)}</Text>,
    startTime: () => <Text style={valStyle} selectable={true}>{formatDate(workOrder.start_time)}</Text>,
    endTime: () => <Text style={valStyle} selectable={true}>{formatDate(workOrder.end_time)}</Text>,
    duration: () => <Text style={valStyle} selectable={true}>{getDurationString(workOrder.start_time, workOrder.end_time, now)}</Text>,
    image1: () => renderImageLink(workOrder.image_1),
    image2: () => renderImageLink(workOrder.image_2),
    image3: () => renderImageLink(workOrder.image_3),
    signature: () => renderImageLink(workOrder.signature),
  }), [workOrder, renderImageLink]);

  const isFieldEmpty = useCallback((fieldKey: string): boolean => {
    switch (fieldKey) {
      case 'workOrderId': return !workOrder.id;
      case 'instructions': return !workOrder.instructions || workOrder.instructions === 'No instructions';
      case 'reportTo': return !workOrder.report_to || workOrder.report_to === 'Not specified';
      case 'assignTo': return !workOrder.assign_to || workOrder.assign_to === 'Not assigned';
      case 'workStatus': return !workOrder.work_status || workOrder.work_status === 'Not set';
      case 'remarks': return !workOrder.remarks || workOrder.remarks === 'No remarks';
      case 'requestedBy': return !workOrder.requested_by || workOrder.requested_by === 'System';
      case 'requestedDate': return !workOrder.requested_date;
      case 'updatedBy': return !workOrder.updated_by || workOrder.updated_by === 'Not updated';
      case 'updatedDate': return !workOrder.updated_date;
      case 'startTime': return !workOrder.start_time;
      case 'endTime': return !workOrder.end_time;
      case 'duration': return !workOrder.start_time;
      case 'image1': return !workOrder.image_1;
      case 'image2': return !workOrder.image_2;
      case 'image3': return !workOrder.image_3;
      case 'signature': return !workOrder.signature;
      default: return false;
    }
  }, [workOrder]);

  const renderFieldContent = useCallback((fieldKey: string) => {
    const renderer = fieldRenderers[fieldKey];
    if (!renderer || isFieldEmpty(fieldKey)) return null;

    return (
      <View key={fieldKey} style={[st.fieldRow, { borderBottomColor: '#e5e7eb' }]}>
        <Text style={[st.fieldLabel, { color: '#6b7280' }]}>{getFieldLabel(fieldKey)}</Text>
        <View style={st.fieldValueWrap}>
          {renderer()}
        </View>
      </View>
    );
  }, [fieldRenderers, isFieldEmpty]);

  return (
    <View style={[st.container, {
      borderLeftWidth: !isMobile ? 1 : 0,
      backgroundColor: '#f9fafb',
      borderLeftColor: '#d1d5db'
    }]}>
      <View style={[st.header, {
        paddingTop: isMobile ? 60 : 12,
        backgroundColor: '#ffffff',
        borderBottomColor: '#e5e7eb'
      }]}>
        <View style={st.headerLeft}>
          <Text
            style={[st.headerName, {
              maxWidth: isMobile ? 200 : undefined,
              fontSize: isMobile ? 20 : 24,
              color: '#111827'
            }]}
            numberOfLines={1}
          >
            Work Order #{workOrder.id}
          </Text>
        </View>

        <View style={st.headerActions}>
          {shouldShowEnableTechnicianButton() && (
            <Pressable
              style={[st.actionBtn, { backgroundColor: technicianEnabled ? '#e5e7eb' : '#059669', marginRight: 8 }]}
              onPress={handleEnableTechnicianClick}
              disabled={technicianEnabled || isEnablingTechnician}
            >
              {isEnablingTechnician && (
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 6 }} />
              )}
              <Text style={[st.actionBtnText, { color: technicianEnabled ? '#6b7280' : '#ffffff', fontSize: isMobile ? 14 : 16 }]}>
                {technicianEnabled ? 'Enabled' : (isEnablingTechnician ? 'Enabling...' : 'Enable')}
              </Text>
            </Pressable>
          )}

          {(workOrder.work_status?.toLowerCase().includes('pending') || workOrder.work_status?.toLowerCase().includes('in progress')) && (
            <Pressable
              style={[st.actionBtn, { backgroundColor: technicianLocked ? '#d1d5db' : (colorPalette?.primary || '#7c3aed'), marginRight: 8 }]}
              onPress={() => {
                if (technicianLocked) {
                  Alert.alert('Work Order Locked', TECHNICIAN_LOCKED_MESSAGE, [{ text: 'OK' }]);
                  return;
                }
                onEdit?.();
              }}
              disabled={technicianLocked}
            >
              <Text style={[st.actionBtnText, { color: technicianLocked ? '#6b7280' : '#ffffff', fontSize: isMobile ? 14 : 16 }]}>Edit</Text>
            </Pressable>
          )}

          {(!isEnded || workOrder.work_status?.toLowerCase().trim() === 'reschedule') && 
           ['in progress', 'inprogress', 'pending', 'reschedule'].includes(workOrder.work_status?.toLowerCase().trim() || '') && 
           (userRoleId === 2 || userRole === 'technician') && (
            <>
              {(!isStarted || (['reschedule'].includes(workOrder.work_status?.toLowerCase().trim() || '') && isStarted && isEnded)) && (
                <Pressable
                  style={[st.iconBtn, { backgroundColor: technicianLocked ? '#d1d5db' : (colorPalette?.primary || '#10b981'), marginRight: 8 }]}
                  onPress={handleStartTimer}
                  disabled={loading || technicianLocked}
                >
                  {technicianLocked
                    ? <Lock width={18} height={18} color="#6b7280" />
                    : <Play width={18} height={18} color="#ffffff" />}
                </Pressable>
              )}
            </>
          )}



          <Pressable onPress={onClose} style={{ padding: 4 }}>
            <X width={28} height={28} color="#4b5563" />
          </Pressable>
        </View>
      </View>

      {error && (
        <View style={[st.errorBox, {
          backgroundColor: '#fef2f2',
          borderColor: '#fca5a5'
        }]}>
          <Text style={{ color: '#991b1b' }}>{error}</Text>
        </View>
      )}

      <ScrollView style={st.flex1} showsVerticalScrollIndicator={false} contentContainerStyle={st.scrollContent}>
        <View style={[st.fieldsContainer, { backgroundColor: '#f9fafb' }]}>
          {defaultFields.map(renderFieldContent)}
        </View>
      </ScrollView>

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
        message="You need to time in first in the menu before starting a work order."
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

const st = StyleSheet.create({
  container: { flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative', width: '100%' },
  header: { padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  headerName: { fontWeight: '500' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 2, flexDirection: 'row', alignItems: 'center' },
  actionBtnText: { color: '#ffffff', fontWeight: '500' },
  iconBtn: { padding: 6, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  errorBox: { padding: 12, margin: 12, borderRadius: 4, borderWidth: 1 },
  statusText: { fontSize: 14, fontWeight: '600', textTransform: 'capitalize' },
  flex1: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 120 },
  fieldsContainer: { width: '100%', minHeight: '100%', paddingVertical: 8 },
  fieldRow: { flexDirection: 'column', borderBottomWidth: 1, paddingVertical: 4, paddingHorizontal: 16, alignItems: 'flex-start', gap: 2 },
  fieldLabel: { fontSize: 14, fontWeight: '500' },
  fieldValueWrap: { width: '100%' },
  valueText: { fontSize: 16 },
  imageLinkRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  imageLinkText: { flex: 1, marginRight: 8, fontSize: 16 },
});

export default WorkOrderDetails;
