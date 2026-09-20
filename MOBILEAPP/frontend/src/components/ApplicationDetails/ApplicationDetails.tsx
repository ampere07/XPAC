import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert, Linking, StyleSheet, ActivityIndicator, TextInput, useWindowDimensions } from 'react-native';
import {
  X, Phone, MessageSquare, Info, ExternalLink, Mail, ChevronDown,
  ChevronLeft, ChevronRight as ChevronRightIcon, Ban, XCircle, RotateCw, CheckCircle,
  Loader, Square, Settings, Copy
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApplication, updateApplication, getRelatedDetailsUpdateLogs } from '../../services/applicationService';
import ConfirmationModal from '../../modals/MoveToJoModal';
import JOAssignFormModal from '../../modals/JOAssignFormModal';
import ApplicationVisitFormModal from '../../modals/ApplicationVisitFormModal';
import { JobOrderData } from '../../services/jobOrderService';
import { ApplicationVisitData, getApplicationVisits } from '../../services/applicationVisitService';
import { settingsColorPaletteService, ColorPalette } from '../../services/settingsColorPaletteService';
import { usePermissions } from '../../hooks/usePermissions';

interface ApplicationDetailsProps {
  application: {
    id: string;
    customerName: string;
    timestamp: string;
    address: string;
    location: string;
    city?: string;
    region?: string;
    barangay?: string;
    email_address?: string;
    mobile_number?: string;
  };
  onClose: () => void;
  onApplicationUpdate?: () => void;
  /** Forced by the host screen; falls back to a width check, like JobOrderDetails. */
  isMobile?: boolean;
}

const ApplicationDetails: React.FC<ApplicationDetailsProps> = ({ application, onClose, onApplicationUpdate, isMobile: propIsMobile }) => {
  const { width } = useWindowDimensions();
  const isMobile = propIsMobile !== undefined ? propIsMobile : width < 768;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailedApplication, setDetailedApplication] = useState<any>(null);
  const [showMoveConfirmation, setShowMoveConfirmation] = useState(false);
  const [showJOAssignForm, setShowJOAssignForm] = useState(false);
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string>('');
  const [statusRemarks, setStatusRemarks] = useState<string>('');
  const [relatedLogs, setRelatedLogs] = useState<any[]>([]);
  const [relatedLogsCount, setRelatedLogsCount] = useState<number>(0);
  const [relatedLogsExpanded, setRelatedLogsExpanded] = useState<boolean>(false);
  const [showVisitExistsConfirmation, setShowVisitExistsConfirmation] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showFieldSettings, setShowFieldSettings] = useState(false);

  const FIELD_VISIBILITY_KEY = 'applicationDetailsFieldVisibility';
  const FIELD_ORDER_KEY = 'applicationDetailsFieldOrder';

  const defaultFields = [
    'timestamp',
    'status',
    'referredBy',
    'fullName',
    'fullAddress',
    'landmark',
    'contactNumber',
    'secondContactNumber',
    'emailAddress',
    'village',
    'barangay',
    'city',
    'region',
    'desiredPlan',
    'promo',
    'termsAgreed',
    'proofOfBilling',
    'governmentValidId',
    'secondaryGovernmentValidId',
    'houseFrontPicture',
    'promoImage',
    'nearestLandmark1',
    'nearestLandmark2',
    'documentAttachment',
    'otherIspBill'
  ];

  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>(() => {
    return defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
  });

  const [fieldOrder, setFieldOrder] = useState<string[]>(defaultFields);

  useEffect(() => {
    const loadSettings = async () => {
      const theme = await AsyncStorage.getItem('theme');
      setIsDarkMode(theme === 'dark');

      const savedVisibility = await AsyncStorage.getItem(FIELD_VISIBILITY_KEY);
      if (savedVisibility) {
        setFieldVisibility(JSON.parse(savedVisibility));
      }

      const savedOrder = await AsyncStorage.getItem(FIELD_ORDER_KEY);
      if (savedOrder) {
        setFieldOrder(JSON.parse(savedOrder));
      }
    };
    loadSettings();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(FIELD_VISIBILITY_KEY, JSON.stringify(fieldVisibility));
  }, [fieldVisibility]);

  useEffect(() => {
    AsyncStorage.setItem(FIELD_ORDER_KEY, JSON.stringify(fieldOrder));
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

  const handleMoveToJO = () => {
    setShowMoveConfirmation(true);
  };

  const handleConfirmMoveToJO = () => {
    setShowMoveConfirmation(false);
    setShowJOAssignForm(true);
  };

  // Related details update logs (audit trail for this application).
  useEffect(() => {
    let active = true;
    if (!application.id) return;
    getRelatedDetailsUpdateLogs(application.id)
      .then((result) => {
        if (!active) return;
        setRelatedLogs(result.data || []);
        setRelatedLogsCount(result.count || (result.data ? result.data.length : 0));
      })
      .catch((err) => console.error('Error fetching related details update logs:', err));
    return () => { active = false; };
  }, [application.id, detailedApplication]);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
  const { can: hasPermission } = usePermissions();

  const handleScheduleVisit = async () => {
    try {
      setLoading(true);

      const existingVisitsResponse = await getApplicationVisits(application.id);

      if (existingVisitsResponse.success && existingVisitsResponse.data && existingVisitsResponse.data.length > 0) {
        setShowVisitExistsConfirmation(true);
      } else {
        setShowVisitForm(true);
      }
    } catch (error) {
      console.error('Error checking existing visits:', error);
      setShowVisitForm(true);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCreateNewVisit = () => {
    setShowVisitExistsConfirmation(false);
    setShowVisitForm(true);
  };

  const handleCancelCreateNewVisit = () => {
    setShowVisitExistsConfirmation(false);
  };

  const handleStatusChange = (newStatus: string) => {
    setPendingStatus(newStatus);
    setShowStatusConfirmation(true);
  };

  const handleConfirmStatusChange = async () => {
    try {
      setLoading(true);

      await updateApplication(application.id, { status: pendingStatus });

      const updatedApplication = await getApplication(application.id);
      setDetailedApplication(updatedApplication);

      setShowStatusConfirmation(false);
      setPendingStatus('');

      if (onApplicationUpdate) {
        onApplicationUpdate();
      }

      setSuccessMessage(`Status updated to ${pendingStatus}`);
      setShowSuccessModal(true);
    } catch (err: any) {
      setError(`Failed to update status: ${err.message}`);
      console.error('Status update error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelStatusChange = () => {
    setShowStatusConfirmation(false);
    setPendingStatus('');
  };

  const handleSaveJOForm = (formData: JobOrderData) => {
    setShowJOAssignForm(false);
  };

  const handleSaveVisitForm = (formData: ApplicationVisitData) => {
    setShowVisitForm(false);

    if (onApplicationUpdate) {
      onApplicationUpdate();
    }
  };

  useEffect(() => {
    const fetchApplicationDetails = async () => {
      try {
        setLoading(true);
        setError(null);

        const result = await getApplication(application.id);
        setDetailedApplication(result);
      } catch (err: any) {
        console.error('Error fetching application details:', err);
        setError(err.message || 'Failed to load application details');
      } finally {
        setLoading(false);
      }
    };

    fetchApplicationDetails();
  }, [application.id]);

  const getClientFullName = (): string => {
    return [
      detailedApplication?.first_name || '',
      detailedApplication?.middle_initial ? detailedApplication.middle_initial + '.' : '',
      detailedApplication?.last_name || ''
    ].filter(Boolean).join(' ').trim() || application.customerName || 'Unknown Client';
  };

  const getClientFullAddress = (): string => {
    const addressParts = [
      detailedApplication?.installation_address || application.address,
      detailedApplication?.location || application.location,
      detailedApplication?.barangay || application.barangay,
      detailedApplication?.city || application.city,
      detailedApplication?.region || application.region
    ].filter(Boolean);
    
    return addressParts.length > 0 ? addressParts.join(', ') : 'No address provided';
  };

  const formatDate = (dateStr?: string | null): string => {
    if (!dateStr) return 'Not provided';
    try {
      return new Date(dateStr).toLocaleString();
    } catch (e) {
      return dateStr;
    }
  };

  const getStatusColor = (status?: string | null): string => {
    if (!status) return '#9ca3af';
    
    switch (status.toLowerCase()) {
      case 'schedule':
      case 'completed':
        return '#4ade80';
      case 'in progress':
        return '#60a5fa';
      case 'pending':
        return '#fb923c';
      case 'cancelled':
        return '#ef4444';
      case 'no facility':
        return '#f87171';
      case 'no slot':
        return '#c084fc';
      case 'duplicate':
        return '#f472b6';
      default:
        return '#9ca3af';
    }
  };

  const getFieldLabel = (fieldKey: string): string => {
    const labels: Record<string, string> = {
      timestamp: 'Timestamp',
      status: 'Status',
      referredBy: 'Referred By',
      fullName: 'Full Name of Client',
      fullAddress: 'Full Address of Client',
      landmark: 'Landmark',
      contactNumber: 'Contact Number',
      secondContactNumber: 'Second Contact Number',
      emailAddress: 'Email Address',
      village: 'Village',
      barangay: 'Barangay',
      city: 'City',
      region: 'Region',
      desiredPlan: 'Desired Plan',
      promo: 'Promo',
      termsAgreed: 'Terms and Conditions',
      proofOfBilling: 'Proof of Billing',
      governmentValidId: 'Government Valid ID',
      secondaryGovernmentValidId: 'Secondary Government Valid ID',
      houseFrontPicture: 'House Front Picture',
      promoImage: 'Promo Image',
      nearestLandmark1: 'Nearest Landmark 1',
      nearestLandmark2: 'Nearest Landmark 2',
      documentAttachment: 'Document Attachment',
      otherIspBill: 'Other ISP Bill'
    };
    return labels[fieldKey] || fieldKey;
  };

  const toggleFieldVisibility = (field: string) => {
    setFieldVisibility((prev: Record<string, boolean>) => ({ ...prev, [field]: !prev[field] }));
  };

  const selectAllFields = () => {
    const allVisible: Record<string, boolean> = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
    setFieldVisibility(allVisible);
  };

  const deselectAllFields = () => {
    const allHidden: Record<string, boolean> = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: false }), {});
    setFieldVisibility(allHidden);
  };

  const resetFieldSettings = () => {
    const allVisible: Record<string, boolean> = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
    setFieldVisibility(allVisible);
    setFieldOrder(defaultFields);
  };

  const valueColor = isDarkMode ? '#ffffff' : '#111827';

  const textValue = (value: React.ReactNode) => (
    <Text style={[st.valueText, { color: valueColor }]}>{value}</Text>
  );

  const linkValue = (url?: string | null, emptyLabel: string = 'No document available') => (
    <View style={st.imageLinkRow}>
      <Text style={[st.imageLinkText, { color: valueColor }]} numberOfLines={1}>
        {url || emptyLabel}
      </Text>
      {url ? (
        <Pressable onPress={() => Linking.openURL(url)}>
          <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
        </Pressable>
      ) : null}
    </View>
  );

  /** Value renderers only — the label/row chrome is shared by renderFieldContent. */
  const fieldValueRenderers: Record<string, () => React.ReactNode> = {
    timestamp: () =>
      textValue(
        detailedApplication?.create_date && detailedApplication?.create_time
          ? `${detailedApplication.create_date} ${detailedApplication.create_time}`
          : formatDate(application.timestamp)
      ),
    status: () => (
      <Text style={[st.valueText, st.statusCapitalize, { color: getStatusColor(detailedApplication?.status) }]}>
        {detailedApplication?.status || 'Pending'}
      </Text>
    ),
    referredBy: () => textValue(detailedApplication?.referred_by || 'None'),
    fullName: () => textValue(getClientFullName()),
    fullAddress: () => textValue(getClientFullAddress()),
    landmark: () => textValue(detailedApplication?.landmark || 'Not provided'),
    contactNumber: () => textValue(detailedApplication?.mobile_number || application.mobile_number || 'Not provided'),
    secondContactNumber: () => textValue(detailedApplication?.secondary_mobile_number || 'Not provided'),
    emailAddress: () => textValue(detailedApplication?.email_address || application.email_address || 'Not provided'),
    village: () => textValue(detailedApplication?.village || 'Not specified'),
    barangay: () => textValue(detailedApplication?.barangay || application.barangay || 'Not specified'),
    city: () => textValue(detailedApplication?.city || application.city || 'Not specified'),
    region: () => textValue(detailedApplication?.region || application.region || 'Not specified'),
    desiredPlan: () => textValue(detailedApplication?.desired_plan || 'Not specified'),
    promo: () => textValue(detailedApplication?.promo || 'None'),
    termsAgreed: () => textValue('Agreed'),
    proofOfBilling: () => linkValue(detailedApplication?.proof_of_billing_url),
    governmentValidId: () => linkValue(detailedApplication?.government_valid_id_url),
    secondaryGovernmentValidId: () => linkValue(detailedApplication?.secondary_government_valid_id_url),
    houseFrontPicture: () => linkValue(detailedApplication?.house_front_picture_url, 'No image available'),
    promoImage: () => linkValue(detailedApplication?.promo_url, 'No image available'),
    nearestLandmark1: () => linkValue(detailedApplication?.nearest_landmark1_url, 'No image available'),
    nearestLandmark2: () => linkValue(detailedApplication?.nearest_landmark2_url, 'No image available'),
    documentAttachment: () => linkValue(detailedApplication?.document_attachment_url),
    otherIspBill: () => linkValue(detailedApplication?.other_isp_bill_url),
  };

  const renderFieldContent = (fieldKey: string) => {
    if (!fieldVisibility[fieldKey]) return null;
    // Terms only makes sense as a row once the applicant has actually agreed.
    if (fieldKey === 'termsAgreed' && !detailedApplication?.terms_agreed) return null;

    const renderer = fieldValueRenderers[fieldKey];
    if (!renderer) return null;

    return (
      <View style={[st.fieldRow, { borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }]}>
        <Text style={[st.fieldLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>{getFieldLabel(fieldKey)}</Text>
        <View style={st.fieldValueWrap}>{renderer()}</View>
      </View>
    );
  };
  
  const primaryColor = colorPalette?.primary || '#7c3aed';
  const canMoveToJo = hasPermission('application-management.move-to-jo');
  const canQuickStatus = hasPermission('application-management.quick-status');

  const quickActions = [
    { key: 'noFacility', label: 'No Facility', Icon: Ban, onPress: () => handleStatusChange('No Facility') },
    { key: 'cancelled', label: 'Cancelled', Icon: XCircle, onPress: () => handleStatusChange('Cancelled') },
    { key: 'noSlot', label: 'No Slot', Icon: RotateCw, onPress: () => handleStatusChange('No Slot') },
    { key: 'duplicate', label: 'Duplicate', Icon: Copy, onPress: () => handleStatusChange('Duplicate') },
    { key: 'clearStatus', label: 'Clear Status', Icon: CheckCircle, onPress: () => handleStatusChange('In Progress') },
  ];

  return (
    <View style={[st.container, {
      borderLeftWidth: !isMobile ? 1 : 0,
      backgroundColor: isDarkMode ? '#030712' : '#f9fafb',
      borderLeftColor: isDarkMode ? 'rgba(255,255,255,0.3)' : '#d1d5db'
    }]}>
      <View style={[st.header, {
        paddingTop: isMobile ? 60 : 12,
        backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
        borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb'
      }]}>
        <View style={st.headerLeft}>
          <Pressable onPress={onClose} style={st.backBtn}>
            <ChevronLeft width={28} height={28} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
          </Pressable>
          <View style={st.headerNameContainer}>
            <Text
              style={[st.headerName, {
                fontSize: isMobile ? 20 : 24,
                color: isDarkMode ? '#ffffff' : '#111827'
              }]}
              numberOfLines={1}
            >
              {getClientFullName()}
            </Text>
          </View>
        </View>

        <View style={st.headerActions}>
          {loading && <ActivityIndicator size="small" color={primaryColor} />}
        </View>
      </View>

      {canMoveToJo && (
        <View style={[st.primaryActions, { backgroundColor: isDarkMode ? '#111827' : '#f3f4f6' }]}>
          <Pressable
            style={[st.primaryBtn, { backgroundColor: primaryColor }]}
            onPress={handleMoveToJO}
            disabled={loading}
          >
            <Text style={st.primaryBtnText}>Move to JO</Text>
          </Pressable>
        </View>
      )}

      {canQuickStatus && (
        <View style={[st.actionBar, {
          backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
          borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb'
        }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.actionBarInner}>
            {quickActions.map(({ key, label, Icon, onPress }) => (
              <Pressable key={key} style={st.actionBtnWrap} onPress={onPress} disabled={loading}>
                <View style={[st.actionIconCircle, { backgroundColor: loading ? '#9ca3af' : primaryColor }]}>
                  <Icon width={18} height={18} color="#ffffff" />
                </View>
                <Text style={[st.actionLabel, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {error && (
        <View style={[st.errorBox, {
          backgroundColor: isDarkMode ? 'rgba(127, 29, 29, 0.2)' : '#fef2f2',
          borderColor: isDarkMode ? '#991b1b' : '#fca5a5'
        }]}>
          <Text style={{ color: isDarkMode ? '#fca5a5' : '#991b1b' }}>{error}</Text>
        </View>
      )}

      <ScrollView style={st.flex1} showsVerticalScrollIndicator={false} contentContainerStyle={st.scrollContent}>
        <View style={[st.fieldsContainer, { backgroundColor: isDarkMode ? '#030712' : '#f9fafb' }]}>
          <View>
            {fieldOrder.map((fieldKey) => (
              <React.Fragment key={fieldKey}>
                {renderFieldContent(fieldKey)}
              </React.Fragment>
            ))}
          </View>

          {/* Related Details Update Logs */}
          <View style={[st.relatedSection, { borderTopColor: isDarkMode ? '#1f2937' : '#e5e7eb' }]}>
            <Pressable
              style={st.relatedHeader}
              onPress={() => setRelatedLogsExpanded(!relatedLogsExpanded)}
            >
              <View style={st.relatedHeaderLeft}>
                <Text style={[st.relatedTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>
                  Related Details Update Logs
                </Text>
                <View style={[st.relatedBadge, { backgroundColor: isDarkMode ? '#4b5563' : '#d1d5db' }]}>
                  <Text style={[st.relatedBadgeText, { color: isDarkMode ? '#ffffff' : '#111827' }]}>
                    {relatedLogsCount}
                  </Text>
                </View>
              </View>
              {relatedLogsExpanded
                ? <ChevronDown width={18} height={18} color="#6b7280" />
                : <ChevronRightIcon width={18} height={18} color="#6b7280" />}
            </Pressable>

            {relatedLogsExpanded && (
              relatedLogsCount > 0 ? (
                <View>
                  {relatedLogs.slice(0, 5).map((log: any, idx: number) => (
                    <View
                      key={log.id ?? idx}
                      style={[st.relatedRow, { borderTopColor: isDarkMode ? '#1f2937' : '#f3f4f6' }]}
                    >
                      <Text style={[st.relatedRowTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]} numberOfLines={1}>
                        {log.action || log.event || log.type || 'Update'}
                      </Text>
                      <Text style={[st.relatedRowMeta, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]} numberOfLines={2}>
                        {[log.modified_by || log.updated_by || log.user_email, formatDate(log.created_at || log.timestamp)]
                          .filter(Boolean)
                          .join(' • ')}
                      </Text>
                    </View>
                  ))}
                  {relatedLogsCount > 5 && (
                    <Text style={[st.relatedMore, { color: primaryColor }]}>
                      +{relatedLogsCount - 5} more items
                    </Text>
                  )}
                </View>
              ) : (
                <Text style={[st.relatedEmpty, { color: isDarkMode ? '#6b7280' : '#9ca3af' }]}>
                  No related details update logs found.
                </Text>
              )
            )}
          </View>
        </View>
      </ScrollView>

      {showFieldSettings && (
        <Modal
          visible={showFieldSettings}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowFieldSettings(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}
            onPress={() => setShowFieldSettings(false)}
          >
            <Pressable
              style={{ width: '90%', maxWidth: 400, borderRadius: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, borderWidth: 1, maxHeight: '80%', backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', borderColor: isDarkMode ? '#374151' : '#e5e7eb' }}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }}>
                <Text style={{ fontWeight: '600', color: isDarkMode ? '#ffffff' : '#111827' }}>Field Visibility</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Pressable onPress={selectAllFields}>
                    <Text style={{ color: '#2563eb', fontSize: 12 }}>Show All</Text>
                  </Pressable>
                  <Text style={{ color: isDarkMode ? '#6b7280' : '#9ca3af' }}>|</Text>
                  <Pressable onPress={deselectAllFields}>
                    <Text style={{ color: '#2563eb', fontSize: 12 }}>Hide All</Text>
                  </Pressable>
                  <Text style={{ color: isDarkMode ? '#6b7280' : '#9ca3af' }}>|</Text>
                  <Pressable onPress={resetFieldSettings}>
                    <Text style={{ color: '#2563eb', fontSize: 12 }}>Reset</Text>
                  </Pressable>
                </View>
              </View>
              <ScrollView style={{ padding: 8 }} showsVerticalScrollIndicator={false}>
                {fieldOrder.map((fieldKey) => (
                  <Pressable
                    key={fieldKey}
                    onPress={() => toggleFieldVisibility(fieldKey)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4 }}
                  >
                    <View style={{ height: 16, width: 16, borderRadius: 4, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: fieldVisibility[fieldKey] ? '#2563eb' : '#ffffff', alignItems: 'center', justifyContent: 'center' }}>
                      {fieldVisibility[fieldKey] && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: 'bold' }}>✓</Text>}
                    </View>
                    <Text style={{ fontSize: 14, color: isDarkMode ? '#d1d5db' : '#374151' }}>
                      {getFieldLabel(fieldKey)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
      
      <ConfirmationModal
        isOpen={showMoveConfirmation}
        title="Confirm"
        message="Are you sure you want to move this application to JO?"
        confirmText="Move to JO"
        cancelText="Cancel"
        onConfirm={handleConfirmMoveToJO}
        onCancel={() => setShowMoveConfirmation(false)}
      />

      {/* Status change — remarks are captured here and sent with the update, and are
          mandatory for Cancelled, same as the web screen. */}
      <Modal
        visible={showStatusConfirmation}
        transparent
        animationType="fade"
        onRequestClose={handleCancelStatusChange}
      >
        <View style={st.statusOverlay}>
          <View style={[st.statusCard, { backgroundColor: isDarkMode ? '#111827' : '#ffffff', borderColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
            <View style={[st.statusCardHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
              <Text style={[st.statusCardTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>
                Change Status to "{pendingStatus}"
              </Text>
            </View>

            <View style={st.statusCardBody}>
              <Text style={{ fontSize: 13, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>
                Are you sure you want to change the status of this application to{' '}
                <Text style={{ fontWeight: '700' }}>{pendingStatus}</Text>?
              </Text>
              <View>
                <Text style={[st.statusLabel, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                  Remarks {pendingStatus === 'Cancelled' && <Text style={{ color: '#ef4444' }}>*</Text>}
                </Text>
                <TextInput
                  value={statusRemarks}
                  onChangeText={setStatusRemarks}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  placeholder="Enter remarks for status change (required for Cancelled)..."
                  placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
                  style={[st.statusInput, {
                    backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                    borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                    color: isDarkMode ? '#ffffff' : '#111827'
                  }]}
                />
              </View>
            </View>

            <View style={[st.statusCardFooter, { borderTopColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
              <Pressable
                onPress={handleCancelStatusChange}
                disabled={loading}
                style={[st.statusCancelBtn, { borderColor: isDarkMode ? '#4b5563' : '#d1d5db' }]}
              >
                <Text style={{ color: isDarkMode ? '#d1d5db' : '#374151', fontWeight: '500' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmStatusChange}
                disabled={loading || (pendingStatus === 'Cancelled' && !statusRemarks.trim())}
                style={[st.statusConfirmBtn, {
                  backgroundColor: primaryColor,
                  opacity: loading || (pendingStatus === 'Cancelled' && !statusRemarks.trim()) ? 0.5 : 1
                }]}
              >
                {loading && <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 6 }} />}
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <JOAssignFormModal
        isOpen={showJOAssignForm}
        onClose={() => setShowJOAssignForm(false)}
        onSave={handleSaveJOForm}
        applicationData={{
          ...detailedApplication,
          installation_address: detailedApplication?.installation_address || application.address,
        }}
      />

      <ConfirmationModal
        isOpen={showVisitExistsConfirmation}
        title="Visit Already Exists"
        message="This application already has a scheduled visit. Do you want to schedule another visit for this application?"
        confirmText="Continue"
        cancelText="Cancel"
        onConfirm={handleConfirmCreateNewVisit}
        onCancel={handleCancelCreateNewVisit}
      />

      <ApplicationVisitFormModal
        isOpen={showVisitForm}
        onClose={() => setShowVisitForm(false)}
        onSave={handleSaveVisitForm}
        applicationData={{
          ...detailedApplication,
          id: detailedApplication?.id || application.id,
          secondaryNumber: detailedApplication?.mobile_alt || ''
        }}
      />

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

/** Layout mirrors JobOrderDetails so both detail screens read the same. */
const st = StyleSheet.create({
  container: { height: '100%', flexDirection: 'column', overflow: 'hidden', position: 'relative', width: '100%' },
  header: { padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, position: 'relative' },
  backBtn: { position: 'absolute', left: 0, zIndex: 10 },
  // Padding keeps a long, centered name from running under the absolutely-placed back arrow.
  headerNameContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  headerName: { fontWeight: '500', textAlign: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryActions: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12 },
  primaryBtn: { flex: 1, paddingVertical: 10, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '600' },
  actionBar: { paddingVertical: 12, borderBottomWidth: 1 },
  actionBarInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, flexGrow: 1 },
  actionBtnWrap: { flexDirection: 'column', alignItems: 'center', padding: 8, borderRadius: 6, minWidth: 76 },
  actionIconCircle: { padding: 8, borderRadius: 9999 },
  actionLabel: { fontSize: 12, marginTop: 4 },
  errorBox: { padding: 12, margin: 12, borderRadius: 4, borderWidth: 1 },
  flex1: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 120 },
  fieldsContainer: { width: '100%', minHeight: '100%', paddingVertical: 8, paddingHorizontal: 0 },
  fieldRow: { flexDirection: 'column', borderBottomWidth: 1, paddingVertical: 4, paddingHorizontal: 16, alignItems: 'flex-start', gap: 2 },
  fieldLabel: { fontSize: 14, fontWeight: '500' },
  fieldValueWrap: { width: '100%' },
  valueText: { fontSize: 16 },
  statusCapitalize: { textTransform: 'capitalize' },
  imageLinkRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  imageLinkText: { flex: 1, marginRight: 8, fontSize: 16 },
  relatedSection: { marginTop: 24, borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 8 },
  relatedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  relatedHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  relatedTitle: { fontSize: 15, fontWeight: '500' },
  relatedBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  relatedBadgeText: { fontSize: 11, fontWeight: '600' },
  relatedRow: { paddingVertical: 10, borderTopWidth: 1, gap: 2 },
  relatedRowTitle: { fontSize: 14, fontWeight: '500' },
  relatedRowMeta: { fontSize: 12 },
  relatedMore: { fontSize: 12, fontWeight: '600', paddingVertical: 10 },
  relatedEmpty: { fontSize: 13, fontStyle: 'italic', paddingVertical: 12 },
  statusOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  statusCard: { width: '100%', maxWidth: 420, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  statusCardHeader: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  statusCardTitle: { fontSize: 16, fontWeight: '600' },
  statusCardBody: { paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  statusLabel: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  statusInput: { borderWidth: 1, borderRadius: 6, padding: 10, minHeight: 76, fontSize: 14 },
  statusCardFooter: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  statusCancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, borderWidth: 1 },
  statusConfirmBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, flexDirection: 'row', alignItems: 'center' },
});

export default ApplicationDetails;
