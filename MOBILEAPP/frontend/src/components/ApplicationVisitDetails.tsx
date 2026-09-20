import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  Linking,
  StyleSheet,
  Switch,
} from 'react-native';
import { X, ExternalLink, Edit, XOctagon, RotateCw, Settings } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApplication } from '../services/applicationService';
import { updateApplicationVisit } from '../services/applicationVisitService';
import ConfirmationModal from '../modals/MoveToJoModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface ApplicationVisitDetailsProps {
  applicationVisit: {
    id: string;
    application_id: string;
    timestamp?: string;
    assigned_email?: string;
    visit_by?: string;
    visit_with?: string;
    visit_with_other?: string;
    visit_status?: string;
    visit_remarks?: string;
    status_remarks?: string;
    application_status?: string;
    full_name: string;
    full_address: string;
    referred_by?: string;
    updated_by_user_email: string;
    created_at?: string;
    updated_at?: string;
    first_name?: string;
    middle_initial?: string;
    last_name?: string;
    house_front_picture_url?: string;
    image1_url?: string;
    image2_url?: string;
    image3_url?: string;
    [key: string]: any;
  };
  onClose: () => void;
  onUpdate?: () => void;
  isMobile?: boolean;
}

const FIELD_VISIBILITY_KEY = 'applicationVisitDetailsFieldVisibility';
const FIELD_ORDER_KEY = 'applicationVisitDetailsFieldOrder';

const defaultFields = [
  'timestamp',
  'referredBy',
  'fullName',
  'contactNumber',
  'secondContactNumber',
  'emailAddress',
  'address',
  'chosenPlan',
  'landmark',
  'visitBy',
  'visitWith',
  'visitWithOther',
  'visitType',
  'visitStatus',
  'visitNotes',
  'assignedEmail',
  'applicationStatus',
  'modifiedBy',
  'modifiedDate',
  'houseFrontPicture',
  'image1',
  'image2',
  'image3',
];

const ApplicationVisitDetails: React.FC<ApplicationVisitDetailsProps> = ({
  applicationVisit,
  onClose,
  onUpdate,
  isMobile = false,
}) => {
  const isDarkMode = false;
  const [applicationDetails, setApplicationDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMoveConfirmation, setShowMoveConfirmation] = useState(false);
  const [showEditStatusModal, setShowEditStatusModal] = useState(false);
  const [currentVisitData, setCurrentVisitData] = useState(applicationVisit);
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [showInlineConfirmation, setShowInlineConfirmation] = useState(false);
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<string | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>(
    defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {}),
  );
  const [fieldOrder, setFieldOrder] = useState<string[]>(defaultFields);

  // Load persisted field settings from AsyncStorage
  useEffect(() => {
    const loadFieldSettings = async () => {
      try {
        const savedVisibility = await AsyncStorage.getItem(FIELD_VISIBILITY_KEY);
        const savedOrder = await AsyncStorage.getItem(FIELD_ORDER_KEY);
        if (savedVisibility) {
          setFieldVisibility(JSON.parse(savedVisibility));
        }
        if (savedOrder) {
          setFieldOrder(JSON.parse(savedOrder));
        }
      } catch (e) {
        // ignore
      }
    };
    loadFieldSettings();
  }, []);

  // Persist field visibility
  useEffect(() => {
    AsyncStorage.setItem(FIELD_VISIBILITY_KEY, JSON.stringify(fieldVisibility)).catch(() => {});
  }, [fieldVisibility]);

  // Persist field order
  useEffect(() => {
    AsyncStorage.setItem(FIELD_ORDER_KEY, JSON.stringify(fieldOrder)).catch(() => {});
  }, [fieldOrder]);

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
  }, []);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const user = JSON.parse(authData);
          setUserRole(user.role?.toLowerCase() || '');
          setRoleId(user.role_id || user.roleId || null);
        }
      } catch (e) {
        // ignore
      }
    };
    loadAuth();
  }, []);

  useEffect(() => {
    setCurrentVisitData(applicationVisit);
  }, [applicationVisit]);

  useEffect(() => {
    const fetchApplicationData = async () => {
      if (!applicationVisit.application_id) return;
      try {
        setLoading(true);
        const appData = await getApplication(applicationVisit.application_id);
        setApplicationDetails(appData);
      } catch (err: any) {
        setError(`Failed to load application data: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchApplicationData();
  }, [applicationVisit.application_id]);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  const handleMoveToJO = () => {
    setShowMoveConfirmation(true);
  };

  const handleConfirmMoveToJO = () => {
    setShowMoveConfirmation(false);
    Alert.alert('Feature not available on mobile', 'Please use the web app to assign a Job Order.');
  };

  const handleEditVisit = () => {
    setShowEditStatusModal(true);
  };

  const handleStatusClick = (newStatus: string | null) => {
    setPendingStatusUpdate(newStatus);
    setShowInlineConfirmation(true);
  };

  const handleConfirmStatusUpdate = async () => {
    setShowInlineConfirmation(false);
    const newStatus = pendingStatusUpdate;
    setPendingStatusUpdate(null);
    if (newStatus === undefined) return;
    await handleStatusUpdate(newStatus);
  };

  const handleCancelStatusUpdate = () => {
    setShowInlineConfirmation(false);
    setPendingStatusUpdate(null);
  };

  const handleStatusUpdate = async (newStatus: string | null) => {
    try {
      setLoading(true);
      setError(null);

      let updatedByEmail: string | null = null;
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const user = JSON.parse(authData);
          updatedByEmail = user.email;
        }
      } catch (e) {
        // ignore
      }

      await updateApplicationVisit(applicationVisit.id, {
        visit_status: newStatus,
        updated_by_user_email: updatedByEmail ?? undefined,
      });

      setCurrentVisitData({ ...currentVisitData, visit_status: newStatus || '' });

      const statusMessage = newStatus ? `Status updated to ${newStatus}` : 'Status cleared successfully';
      setSuccessMessage(statusMessage);
      setShowSuccessModal(true);

      if (onUpdate) {
        onUpdate();
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Unknown error occurred';
      setError(`Failed to update status: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr?: string | null): string => {
    if (!dateStr) return 'Not provided';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
      return dateStr;
    }
  };

  const getFullName = () => {
    return (
      currentVisitData.full_name ||
      `${currentVisitData.first_name || ''} ${currentVisitData.middle_initial || ''} ${currentVisitData.last_name || ''}`.trim()
    );
  };

  const getFieldLabel = (fieldKey: string): string => {
    const labels: Record<string, string> = {
      timestamp: 'Timestamp',
      referredBy: 'Referred By',
      fullName: 'Full Name',
      contactNumber: 'Contact Number',
      secondContactNumber: 'Second Contact Number',
      emailAddress: 'Email Address',
      address: 'Address',
      chosenPlan: 'Chosen Plan',
      landmark: 'Landmark',
      visitBy: 'Visit By',
      visitWith: 'Visit With',
      visitWithOther: 'Visit With (Other)',
      visitType: 'Visit Type',
      visitStatus: 'Visit Status',
      visitNotes: 'Visit Notes',
      assignedEmail: 'Assigned Email',
      applicationStatus: 'Application Status',
      modifiedBy: 'Modified By',
      modifiedDate: 'Modified Date',
      houseFrontPicture: 'House Front Picture',
      image1: 'Image 1',
      image2: 'Image 2',
      image3: 'Image 3',
    };
    return labels[fieldKey] || fieldKey;
  };

  const toggleFieldVisibility = (field: string) => {
    setFieldVisibility((prev: Record<string, boolean>) => ({ ...prev, [field]: !prev[field] }));
  };

  const selectAllFields = () => {
    const allVisible: Record<string, boolean> = defaultFields.reduce(
      (acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }),
      {},
    );
    setFieldVisibility(allVisible);
  };

  const deselectAllFields = () => {
    const allHidden: Record<string, boolean> = defaultFields.reduce(
      (acc: Record<string, boolean>, field) => ({ ...acc, [field]: false }),
      {},
    );
    setFieldVisibility(allHidden);
  };

  const resetFieldSettings = () => {
    const allVisible: Record<string, boolean> = defaultFields.reduce(
      (acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }),
      {},
    );
    setFieldVisibility(allVisible);
    setFieldOrder(defaultFields);
  };

  const getVisitStatusColor = (status?: string): string => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return '#4ade80';
      case 'failed':
        return '#ef4444';
      case 'in progress':
        return '#60a5fa';
      case 'scheduled':
        return '#4ade80';
      case 'pending':
        return '#fb923c';
      case 'cancelled':
        return '#ef4444';
      default:
        return '#fb923c';
    }
  };

  const getApplicationStatusColor = (status?: string): string => {
    switch (status?.toLowerCase()) {
      case 'approved':
      case 'schedule':
      case 'completed':
        return '#4ade80';
      case 'pending':
        return '#fb923c';
      case 'in progress':
        return '#60a5fa';
      case 'cancelled':
        return '#ef4444';
      case 'no facility':
        return '#f87171';
      case 'no slot':
        return '#a78bfa';
      case 'duplicate':
        return '#f472b6';
      default:
        return '#fb923c';
    }
  };

  const openUrl = (url?: string) => {
    if (url) {
      Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open URL'));
    }
  };

  const renderFieldRow = (label: string, value: string, valueColor?: string) => (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}:</Text>
      <Text style={[styles.fieldValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );

  const renderImageRow = (label: string, url?: string) => (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}:</Text>
      <View style={styles.imageRowRight}>
        <Text style={[styles.fieldValue, { flex: 1 }]} numberOfLines={1}>
          {url || 'No image available'}
        </Text>
        {url ? (
          <TouchableOpacity onPress={() => openUrl(url)} style={{ marginLeft: 8 }}>
            <ExternalLink size={16} color="#6b7280" />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const renderFieldContent = (fieldKey: string) => {
    if (!fieldVisibility[fieldKey]) return null;

    switch (fieldKey) {
      case 'timestamp':
        return renderFieldRow('Timestamp', formatDate(currentVisitData.created_at) || 'Not provided');
      case 'referredBy':
        return renderFieldRow('Referred By', currentVisitData.referred_by || 'Not specified');
      case 'fullName':
        return renderFieldRow('Full Name', getFullName());
      case 'contactNumber':
        return renderFieldRow('Contact Number', applicationDetails?.mobile_number || 'Not provided');
      case 'secondContactNumber':
        return renderFieldRow('Second Contact Number', applicationDetails?.secondary_mobile_number || 'Not provided');
      case 'emailAddress':
        return renderFieldRow('Email Address', applicationDetails?.email_address || 'Not provided');
      case 'address':
        return renderFieldRow('Address', currentVisitData.full_address || 'Not provided');
      case 'chosenPlan':
        return renderFieldRow('Chosen Plan', applicationDetails?.desired_plan || 'Not specified');
      case 'landmark':
        return renderFieldRow('Landmark', applicationDetails?.landmark || 'Not provided');
      case 'visitBy':
        return renderFieldRow('Visit By', currentVisitData.visit_by || 'Not assigned');
      case 'visitWith':
        return renderFieldRow('Visit With', currentVisitData.visit_with || 'None');
      case 'visitWithOther':
        return renderFieldRow('Visit With (Other)', currentVisitData.visit_with_other || 'None');
      case 'visitType':
        return renderFieldRow('Visit Type', 'Initial Visit');
      case 'visitStatus':
        return renderFieldRow(
          'Visit Status',
          currentVisitData.visit_status || 'Scheduled',
          getVisitStatusColor(currentVisitData.visit_status),
        );
      case 'visitNotes':
        return renderFieldRow('Visit Notes', currentVisitData.visit_remarks || 'No notes');
      case 'assignedEmail':
        return renderFieldRow('Assigned Email', currentVisitData.assigned_email || 'Not assigned');
      case 'applicationStatus':
        return renderFieldRow(
          'Application Status',
          currentVisitData.application_status || applicationDetails?.status || 'Pending',
          getApplicationStatusColor(currentVisitData.application_status || applicationDetails?.status),
        );
      case 'modifiedBy':
        return renderFieldRow('Modified By', currentVisitData.updated_by_user_email || 'System');
      case 'modifiedDate':
        return renderFieldRow('Modified Date', formatDate(currentVisitData.updated_at) || 'Not modified');
      case 'houseFrontPicture':
        return renderImageRow('House Front Picture', currentVisitData.house_front_picture_url);
      case 'image1':
        return renderImageRow('Image 1', currentVisitData.image1_url);
      case 'image2':
        return renderImageRow('Image 2', currentVisitData.image2_url);
      case 'image3':
        return renderImageRow('Image 3', currentVisitData.image3_url);
      default:
        return null;
    }
  };

  const isAdmin = userRole !== 'technician' && (userRole === 'administrator' || roleId === 1 || roleId === 7);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {getFullName()}
          </Text>
          {loading && <ActivityIndicator size="small" color="#f97316" style={{ marginLeft: 8 }} />}
        </View>
        <View style={styles.headerRight}>
          {isAdmin && (
            <TouchableOpacity
              style={[styles.headerBtn, { backgroundColor: primaryColor }]}
              onPress={handleMoveToJO}
            >
              <Text style={styles.headerBtnText}>Move to JO</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: primaryColor, marginLeft: 8 }]}
            onPress={handleEditVisit}
          >
            <Edit size={14} color="#ffffff" />
            <Text style={[styles.headerBtnText, { marginLeft: 4 }]}>Visit Status</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ marginLeft: 8 }}
            onPress={() => setShowFieldSettings(!showFieldSettings)}
          >
            <Settings size={18} color="#6b7280" />
          </TouchableOpacity>
          <TouchableOpacity style={{ marginLeft: 8 }} onPress={onClose}>
            <X size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Admin Action Bar */}
      {isAdmin && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleStatusClick('Failed')}
            disabled={loading}
          >
            <View style={[styles.actionIcon, { backgroundColor: loading ? '#4b5563' : primaryColor }]}>
              <XOctagon size={18} color="#ffffff" />
            </View>
            <Text style={styles.actionLabel}>Failed</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleStatusClick('In Progress')}
            disabled={loading}
          >
            <View style={[styles.actionIcon, { backgroundColor: loading ? '#4b5563' : primaryColor }]}>
              <RotateCw size={18} color="#ffffff" />
            </View>
            <Text style={styles.actionLabel}>Visit In Progress</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Error banner */}
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Field Settings Modal */}
      <Modal
        visible={showFieldSettings}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFieldSettings(false)}
      >
        <TouchableOpacity
          style={styles.settingsOverlay}
          activeOpacity={1}
          onPress={() => setShowFieldSettings(false)}
        >
          <View style={styles.settingsPanel}>
            <View style={styles.settingsPanelHeader}>
              <Text style={styles.settingsPanelTitle}>Field Visibility</Text>
              <View style={styles.settingsActions}>
                <TouchableOpacity onPress={selectAllFields}>
                  <Text style={styles.settingsActionText}>Show All</Text>
                </TouchableOpacity>
                <Text style={styles.settingsSep}>|</Text>
                <TouchableOpacity onPress={deselectAllFields}>
                  <Text style={styles.settingsActionText}>Hide All</Text>
                </TouchableOpacity>
                <Text style={styles.settingsSep}>|</Text>
                <TouchableOpacity onPress={resetFieldSettings}>
                  <Text style={styles.settingsActionText}>Reset</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {fieldOrder.map((fieldKey) => (
                <TouchableOpacity
                  key={fieldKey}
                  style={styles.settingsRow}
                  onPress={() => toggleFieldVisibility(fieldKey)}
                >
                  <Switch
                    value={!!fieldVisibility[fieldKey]}
                    onValueChange={() => toggleFieldVisibility(fieldKey)}
                    trackColor={{ false: '#e5e7eb', true: primaryColor }}
                    thumbColor="#ffffff"
                  />
                  <Text style={styles.settingsRowLabel}>{getFieldLabel(fieldKey)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Inline Status Confirmation Modal */}
      <Modal
        visible={showInlineConfirmation}
        transparent
        animationType="fade"
        onRequestClose={handleCancelStatusUpdate}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconRow}>
              <View style={[styles.confirmIconCircle, { backgroundColor: primaryColor }]}>
                {pendingStatusUpdate === 'Failed' ? (
                  <XOctagon size={20} color="#ffffff" />
                ) : (
                  <RotateCw size={20} color="#ffffff" />
                )}
              </View>
              <Text style={styles.confirmTitle}>Confirm Status Change</Text>
            </View>
            <Text style={styles.confirmMessage}>
              {pendingStatusUpdate === 'Failed'
                ? 'Are you sure you want to mark this visit as "Failed"?'
                : 'Are you sure you want to mark this visit as "In Progress"?'}
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancelBtn} onPress={handleCancelStatusUpdate}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOkBtn, { backgroundColor: primaryColor }]}
                onPress={handleConfirmStatusUpdate}
              >
                <Text style={styles.confirmOkText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Visit Status — web modal not migrated yet */}
      <Modal
        visible={showEditStatusModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditStatusModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Edit Visit Status</Text>
            <Text style={styles.confirmMessage}>
              Full visit status editing is available in the web application.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity
                style={[styles.confirmOkBtn, { backgroundColor: primaryColor }]}
                onPress={() => setShowEditStatusModal(false)}
              >
                <Text style={styles.confirmOkText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Fields */}
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {fieldOrder.map((fieldKey) => (
          <React.Fragment key={fieldKey}>{renderFieldContent(fieldKey)}</React.Fragment>
        ))}
      </ScrollView>

      {/* Move to JO Confirmation */}
      <ConfirmationModal
        isOpen={showMoveConfirmation}
        title="Confirm"
        message="Are you sure you want to move this application to JO?"
        confirmText="Move to JO"
        cancelText="Cancel"
        onConfirm={handleConfirmMoveToJO}
        onCancel={() => setShowMoveConfirmation(false)}
      />

      {/* Success Modal */}
      <ConfirmationModal
        isOpen={showSuccessModal}
        title="Success"
        message={successMessage}
        confirmText="OK"
        cancelText="Close"
        onConfirm={() => setShowSuccessModal(false)}
        onCancel={() => setShowSuccessModal(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  headerBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#f3f4f6',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 32,
  },
  actionBtn: {
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
  },
  actionIcon: {
    padding: 8,
    borderRadius: 999,
  },
  actionLabel: {
    fontSize: 11,
    color: '#374151',
    marginTop: 4,
  },
  errorBanner: {
    margin: 12,
    padding: 10,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 6,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 0,
  },
  fieldRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    alignItems: 'flex-start',
  },
  fieldLabel: {
    width: 140,
    fontSize: 13,
    color: '#6b7280',
    flexShrink: 0,
  },
  fieldValue: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  imageRowRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Settings panel
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  settingsPanel: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  settingsPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  settingsPanelTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  settingsActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  settingsActionText: {
    fontSize: 12,
    color: '#2563eb',
  },
  settingsSep: {
    fontSize: 12,
    color: '#9ca3af',
    marginHorizontal: 2,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    gap: 12,
  },
  settingsRowLabel: {
    fontSize: 14,
    color: '#374151',
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  confirmCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  confirmIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmIconCircle: {
    padding: 8,
    borderRadius: 999,
    marginRight: 12,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  confirmMessage: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 20,
    lineHeight: 20,
  },
  confirmBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  confirmCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
  confirmCancelText: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  confirmOkBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  confirmOkText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '500',
  },
});

export default ApplicationVisitDetails;
