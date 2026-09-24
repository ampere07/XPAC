import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Alert, Linking } from 'react-native';
import { 
  X, Phone, MessageSquare, Info, ExternalLink, Mail, ChevronDown, 
  ChevronRight as ChevronRightIcon, Ban, XCircle, RotateCw, CheckCircle, 
  Loader, Square, Settings
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApplication, updateApplication } from '../../services/applicationService';
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
}

const ApplicationDetails: React.FC<ApplicationDetailsProps> = ({ application, onClose, onApplicationUpdate }) => {
  // Move to JO and the quick status row each have their own key
  // (application-management.move-to-jo / .quick-status).
  const { can } = usePermissions();
  const canMoveToJo = can('application-management.move-to-jo');
  const canQuickStatus = can('application-management.quick-status');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailedApplication, setDetailedApplication] = useState<any>(null);
  const [showMoveConfirmation, setShowMoveConfirmation] = useState(false);
  const [showJOAssignForm, setShowJOAssignForm] = useState(false);
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string>('');
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

  const renderFieldContent = (fieldKey: string) => {
    if (!fieldVisibility[fieldKey]) return null;

    const baseFieldStyle = { flexDirection: 'row' as const, borderBottomWidth: 1, paddingBottom: 16, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' };
    const labelStyle = { width: 160, fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' };
    const valueStyle = { flex: 1, color: isDarkMode ? '#ffffff' : '#111827' };

    switch (fieldKey) {
      case 'timestamp':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Timestamp:</Text>
            <Text style={valueStyle}>
              {detailedApplication?.create_date && detailedApplication?.create_time 
                ? `${detailedApplication.create_date} ${detailedApplication.create_time}` 
                : formatDate(application.timestamp)}
            </Text>
          </View>
        );
      
      case 'status':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Status:</Text>
            <Text style={{ flex: 1, textTransform: 'capitalize', color: getStatusColor(detailedApplication?.status) }}>
              {detailedApplication?.status || 'Pending'}
            </Text>
          </View>
        );

      case 'referredBy':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Referred By:</Text>
            <Text style={valueStyle}>{detailedApplication?.referred_by || 'None'}</Text>
          </View>
        );

      case 'fullName':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Full Name of Client:</Text>
            <Text style={valueStyle}>{getClientFullName()}</Text>
          </View>
        );

      case 'fullAddress':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Full Address of Client:</Text>
            <Text style={valueStyle}>{getClientFullAddress()}</Text>
          </View>
        );

      case 'landmark':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Landmark:</Text>
            <Text style={valueStyle}>{detailedApplication?.landmark || 'Not provided'}</Text>
          </View>
        );

      case 'contactNumber':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Contact Number:</Text>
            <Text style={valueStyle}>
              {detailedApplication?.mobile_number || application.mobile_number || 'Not provided'}
            </Text>
          </View>
        );

      case 'secondContactNumber':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Second Contact Number:</Text>
            <Text style={valueStyle}>
              {detailedApplication?.secondary_mobile_number || 'Not provided'}
            </Text>
          </View>
        );

      case 'emailAddress':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Email Address:</Text>
            <Text style={valueStyle}>
              {detailedApplication?.email_address || application.email_address || 'Not provided'}
            </Text>
          </View>
        );

      case 'village':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Village:</Text>
            <Text style={valueStyle}>{detailedApplication?.village || 'Not specified'}</Text>
          </View>
        );

      case 'barangay':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Barangay:</Text>
            <Text style={valueStyle}>{detailedApplication?.barangay || application.barangay || 'Not specified'}</Text>
          </View>
        );

      case 'city':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>City:</Text>
            <Text style={valueStyle}>{detailedApplication?.city || application.city || 'Not specified'}</Text>
          </View>
        );

      case 'region':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Region:</Text>
            <Text style={valueStyle}>{detailedApplication?.region || application.region || 'Not specified'}</Text>
          </View>
        );

      case 'desiredPlan':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Desired Plan:</Text>
            <Text style={valueStyle}>
              {detailedApplication?.desired_plan || 'Not specified'}
            </Text>
          </View>
        );

      case 'promo':
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Promo:</Text>
            <Text style={valueStyle}>{detailedApplication?.promo || 'None'}</Text>
          </View>
        );

      case 'termsAgreed':
        if (!detailedApplication?.terms_agreed) return null;
        return (
          <View style={baseFieldStyle}>
            <Text style={labelStyle}>Terms and Conditions:</Text>
            <Text style={valueStyle}>Agreed</Text>
          </View>
        );

      case 'proofOfBilling':
        return (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
            <Text style={{ width: 160, fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>Proof of Billing</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, marginRight: 8, color: isDarkMode ? '#ffffff' : '#111827' }} numberOfLines={1}>
                {detailedApplication?.proof_of_billing_url || 'No document available'}
              </Text>
              {detailedApplication?.proof_of_billing_url && (
                <Pressable onPress={() => Linking.openURL(detailedApplication.proof_of_billing_url)}>
                  <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              )}
            </View>
          </View>
        );

      case 'governmentValidId':
        return (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
            <Text style={{ width: 160, fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>Government Valid ID</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, marginRight: 8, color: isDarkMode ? '#ffffff' : '#111827' }} numberOfLines={1}>
                {detailedApplication?.government_valid_id_url || 'No document available'}
              </Text>
              {detailedApplication?.government_valid_id_url && (
                <Pressable onPress={() => Linking.openURL(detailedApplication.government_valid_id_url)}>
                  <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              )}
            </View>
          </View>
        );

      case 'secondaryGovernmentValidId':
        return (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
            <View style={{ width: 160 }}>
              <Text style={{ fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>Secondary Government</Text>
              <Text style={{ fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>Valid ID</Text>
            </View>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, marginRight: 8, color: isDarkMode ? '#ffffff' : '#111827' }} numberOfLines={1}>
                {detailedApplication?.secondary_government_valid_id_url || 'No document available'}
              </Text>
              {detailedApplication?.secondary_government_valid_id_url && (
                <Pressable onPress={() => Linking.openURL(detailedApplication.secondary_government_valid_id_url)}>
                  <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              )}
            </View>
          </View>
        );

      case 'houseFrontPicture':
        return (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
            <Text style={{ width: 160, fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>House Front Picture</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, marginRight: 8, color: isDarkMode ? '#ffffff' : '#111827' }} numberOfLines={1}>
                {detailedApplication?.house_front_picture_url || 'No image available'}
              </Text>
              {detailedApplication?.house_front_picture_url && (
                <Pressable onPress={() => Linking.openURL(detailedApplication.house_front_picture_url)}>
                  <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              )}
            </View>
          </View>
        );

      case 'promoImage':
        return (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
            <Text style={{ width: 160, fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>Promo Image</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, marginRight: 8, color: isDarkMode ? '#ffffff' : '#111827' }} numberOfLines={1}>
                {detailedApplication?.promo_url || 'No image available'}
              </Text>
              {detailedApplication?.promo_url && (
                <Pressable onPress={() => Linking.openURL(detailedApplication.promo_url)}>
                  <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              )}
            </View>
          </View>
        );

      case 'nearestLandmark1':
        return (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
            <Text style={{ width: 160, fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>Nearest Landmark 1</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, marginRight: 8, color: isDarkMode ? '#ffffff' : '#111827' }} numberOfLines={1}>
                {detailedApplication?.nearest_landmark1_url || 'No image available'}
              </Text>
              {detailedApplication?.nearest_landmark1_url && (
                <Pressable onPress={() => Linking.openURL(detailedApplication.nearest_landmark1_url)}>
                  <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              )}
            </View>
          </View>
        );

      case 'nearestLandmark2':
        return (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
            <Text style={{ width: 160, fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>Nearest Landmark 2</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, marginRight: 8, color: isDarkMode ? '#ffffff' : '#111827' }} numberOfLines={1}>
                {detailedApplication?.nearest_landmark2_url || 'No image available'}
              </Text>
              {detailedApplication?.nearest_landmark2_url && (
                <Pressable onPress={() => Linking.openURL(detailedApplication.nearest_landmark2_url)}>
                  <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              )}
            </View>
          </View>
        );

      case 'documentAttachment':
        return (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
            <Text style={{ width: 160, fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>Document Attachment</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, marginRight: 8, color: isDarkMode ? '#ffffff' : '#111827' }} numberOfLines={1}>
                {detailedApplication?.document_attachment_url || 'No document available'}
              </Text>
              {detailedApplication?.document_attachment_url && (
                <Pressable onPress={() => Linking.openURL(detailedApplication.document_attachment_url)}>
                  <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              )}
            </View>
          </View>
        );

      case 'otherIspBill':
        return (
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
            <Text style={{ width: 160, fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>Other ISP Bill</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, marginRight: 8, color: isDarkMode ? '#ffffff' : '#111827' }} numberOfLines={1}>
                {detailedApplication?.other_isp_bill_url || 'No document available'}
              </Text>
              {detailedApplication?.other_isp_bill_url && (
                <Pressable onPress={() => Linking.openURL(detailedApplication.other_isp_bill_url)}>
                  <ExternalLink width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              )}
            </View>
          </View>
        );

      default:
        return null;
    }
  };
  
  return (
    <View style={{ height: '100%', flexDirection: 'column', overflow: 'hidden', borderLeftWidth: 1, position: 'relative', backgroundColor: isDarkMode ? '#030712' : '#f9fafb', borderLeftColor: isDarkMode ? 'rgba(255,255,255,0.3)' : '#d1d5db' }}>
      <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: isDarkMode ? '#ffffff' : '#111827', fontWeight: '500' }}>{getClientFullName()}</Text>
          {loading && <Text style={{ marginLeft: 12, fontSize: 14, color: isDarkMode ? '#fb923c' : '#7c3aed' }}>Loading...</Text>}
        </View>
        
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {canMoveToJo && (
          <Pressable 
            style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 2, flexDirection: 'row', alignItems: 'center', backgroundColor: colorPalette?.primary || '#7c3aed' }}
            onPress={handleMoveToJO}
            disabled={loading}
          >
            <Text style={{ color: '#ffffff' }}>Move to JO</Text>
          </Pressable>
          )}
          <Pressable 
            style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 2, flexDirection: 'row', alignItems: 'center', backgroundColor: colorPalette?.primary || '#7c3aed' }}
            onPress={handleScheduleVisit}
            disabled={loading}
          >
            <Text style={{ color: '#ffffff' }}>Schedule</Text>
          </Pressable>
          
          <Pressable onPress={() => setShowFieldSettings(!showFieldSettings)}>
            <Settings width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
          </Pressable>
          
          <Pressable onPress={onClose}>
            <X width={18} height={18} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
          </Pressable>
        </View>
      </View>
      
      {canQuickStatus && (
      <View style={{ paddingVertical: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: isDarkMode ? '#111827' : '#f3f4f6', borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }}>
        <Pressable 
          style={{ flexDirection: 'column', alignItems: 'center', padding: 8, borderRadius: 6 }}
          onPress={() => handleStatusChange('No Facility')}
          disabled={loading}
        >
          <View style={{ padding: 8, borderRadius: 9999, backgroundColor: colorPalette?.primary || '#7c3aed' }}>
            <Ban width={18} height={18} color="#ffffff" />
          </View>
          <Text style={{ fontSize: 12, marginTop: 4, color: isDarkMode ? '#d1d5db' : '#374151' }}>No Facility</Text>
        </Pressable>
        
        <Pressable 
          style={{ flexDirection: 'column', alignItems: 'center', padding: 8, borderRadius: 6 }}
          onPress={() => handleStatusChange('Cancelled')}
          disabled={loading}
        >
          <View style={{ padding: 8, borderRadius: 9999, backgroundColor: colorPalette?.primary || '#7c3aed' }}>
            <XCircle width={18} height={18} color="#ffffff" />
          </View>
          <Text style={{ fontSize: 12, marginTop: 4, color: isDarkMode ? '#d1d5db' : '#374151' }}>Cancelled</Text>
        </Pressable>
        
        <Pressable 
          style={{ flexDirection: 'column', alignItems: 'center', padding: 8, borderRadius: 6 }}
          onPress={() => handleStatusChange('No Slot')}
          disabled={loading}
        >
          <View style={{ padding: 8, borderRadius: 9999, backgroundColor: colorPalette?.primary || '#7c3aed' }}>
            <RotateCw width={18} height={18} color="#ffffff" />
          </View>
          <Text style={{ fontSize: 12, marginTop: 4, color: isDarkMode ? '#d1d5db' : '#374151' }}>No Slot</Text>
        </Pressable>
        
        <Pressable 
          style={{ flexDirection: 'column', alignItems: 'center', padding: 8, borderRadius: 6 }}
          onPress={() => handleStatusChange('Duplicate')}
          disabled={loading}
        >
          <View style={{ padding: 8, borderRadius: 9999, backgroundColor: colorPalette?.primary || '#7c3aed' }}>
            <Square width={18} height={18} color="#ffffff" />
          </View>
          <Text style={{ fontSize: 12, marginTop: 4, color: isDarkMode ? '#d1d5db' : '#374151' }}>Duplicate</Text>
        </Pressable>
        
        <Pressable 
          style={{ flexDirection: 'column', alignItems: 'center', padding: 8, borderRadius: 6 }}
          onPress={() => handleStatusChange('In Progress')}
          disabled={loading}
        >
          <View style={{ padding: 8, borderRadius: 9999, backgroundColor: colorPalette?.primary || '#7c3aed' }}>
            <CheckCircle width={18} height={18} color="#ffffff" />
          </View>
          <Text style={{ fontSize: 12, marginTop: 4, color: isDarkMode ? '#d1d5db' : '#374151' }}>Clear Status</Text>
        </Pressable>
      </View>
      )}
      
      {error && (
        <View style={{ padding: 12, margin: 12, borderRadius: 4, backgroundColor: isDarkMode ? 'rgba(127, 29, 29, 0.2)' : '#fef2f2', borderWidth: 1, borderColor: isDarkMode ? '#991b1b' : '#fca5a5' }}>
          <Text style={{ color: isDarkMode ? '#fca5a5' : '#991b1b' }}>{error}</Text>
        </View>
      )}
      
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ maxWidth: 672, marginHorizontal: 'auto', paddingVertical: 24, paddingHorizontal: 16, backgroundColor: isDarkMode ? '#030712' : '#f9fafb' }}>
          <View style={{ gap: 16 }}>
            {fieldOrder.map((fieldKey) => (
              <React.Fragment key={fieldKey}>
                {renderFieldContent(fieldKey)}
              </React.Fragment>
            ))}
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

      <ConfirmationModal
        isOpen={showStatusConfirmation}
        title="Confirm Status Change"
        message={`Are you sure you want to change the status to "${pendingStatus}"?`}
        confirmText="Change Status"
        cancelText="Cancel"
        onConfirm={handleConfirmStatusChange}
        onCancel={handleCancelStatusChange}
      />

      <JOAssignFormModal
        isOpen={showJOAssignForm}
        onClose={() => setShowJOAssignForm(false)}
        onSave={handleSaveJOForm}
        applicationData={{
          ...detailedApplication,
          // The detail fetch may not have landed (or may have failed) when the
          // form opens. Without these the form prefilled no referral, and saving
          // wrote referred_by: null onto both the job order and the application.
          id: detailedApplication?.id ?? application.id,
          referred_by: detailedApplication?.referred_by ?? (application as any).referred_by ?? '',
          referred_by_agent_id:
            detailedApplication?.referred_by_agent_id ?? (application as any).referred_by_agent_id ?? null,
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

export default ApplicationDetails;
