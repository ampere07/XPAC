import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, ArrowRight, Maximize2, X, Phone, MessageSquare, Info,
  ExternalLink, Mail, ChevronDown, ChevronRight as ChevronRightIcon,
  Ban, XCircle, RotateCw, CheckCircle, Loader, Square, Settings, ArrowRightCircle, Paperclip,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { getApplication, updateApplication, getApplications, getRelatedDetailsUpdateLogs } from '../services/applicationService';
import { Application } from '../types/application';
import ConfirmationModal from '../modals/MoveToJoModal';
import JOAssignFormModal from '../modals/JOAssignFormModal';
import ApplicationVisitFormModal from '../modals/ApplicationVisitFormModal';
import ApplicationAttachmentModal from '../modals/ApplicationAttachmentModal';
import { JobOrderData } from '../services/jobOrderService';
import { ApplicationVisitData, getApplicationVisits } from '../services/applicationVisitService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { planService, Plan } from '../services/planService';
import RelatedDataTable from './RelatedDataTable';
import { relatedDataColumns } from '../config/relatedDataColumns';
import { usePermissions } from '../hooks/usePermissions';

const PlanListDetails = React.lazy(() => import('./PlanListDetails'));
const NotFoundModal = React.lazy(() => import('../modals/NotFoundModal'));

interface ApplicationDetailsProps {
  application: Application;
  onClose: () => void;
  onApplicationUpdate?: () => void;
  onNavigate?: (section: string, extra?: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onExpandSection?: (sectionKey: string, title: string, data: any[], columns: any[], count: number) => void;
}

const ApplicationDetails: React.FC<ApplicationDetailsProps> = ({ application, onClose, onApplicationUpdate, onNavigate, onPrevious, onNext, onExpandSection }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailedApplication, setDetailedApplication] = useState<any>(null);
  const currentStatus = (detailedApplication?.status || application.status || '').toLowerCase();
  const [showMoveConfirmation, setShowMoveConfirmation] = useState(false);
  const [showJOAssignForm, setShowJOAssignForm] = useState(false);
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [showAttachmentModal, setShowAttachmentModal] = useState(false);
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string>('');
  const [showVisitExistsConfirmation, setShowVisitExistsConfirmation] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [selectedPlanForOverlay, setSelectedPlanForOverlay] = useState<Plan | null>(null);
  const [loadingPlanOverlay, setLoadingPlanOverlay] = useState(false);
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null);
  const [statusRemarks, setStatusRemarks] = useState<string>('');
  const [duplicateApplications, setDuplicateApplications] = useState<any[]>([]);
  const [loadingDuplicates, setLoadingDuplicates] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        setUserRole(userData.role || '');
        setRoleId(userData.role_id || null);
        
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
      } catch (error) {
        console.error('Error parsing auth data in ApplicationDetails:', error);
      }
    }
  }, []);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
  const { can: hasPermission } = usePermissions();

  // Related data states
  const [relatedData, setRelatedData] = useState<Record<string, any[]>>({
    detailsUpdateLogs: []
  });

  const [fullRelatedData, setFullRelatedData] = useState<Record<string, any[]>>({
    detailsUpdateLogs: []
  });

  const [relatedDataCounts, setRelatedDataCounts] = useState<Record<string, number>>({
    detailsUpdateLogs: 0
  });

  const [expandedModalSection, setExpandedModalSection] = useState<string | null>(null);

  const fetchRelatedData = async () => {
    if (!application.id) return;

    try {
      const result = await getRelatedDetailsUpdateLogs(application.id);

      const data = result.data || [];
      const count = result.count || 0;

      setRelatedData({ detailsUpdateLogs: data.slice(0, 5) });
      setFullRelatedData({ detailsUpdateLogs: data });
      setRelatedDataCounts({ detailsUpdateLogs: count });
    } catch (error) {
      console.error('Error fetching related details update logs:', error);
    }
  };

  useEffect(() => {
    fetchRelatedData();
  }, [application.id, detailedApplication]);

  const handleExpandModalOpen = (section: string) => {
    if (onExpandSection) {
      const customerName = application.customer_name || (detailedApplication ? detailedApplication.customer_name : '');
      const label = section === 'detailsUpdateLogs' 
        ? `All Related Details Update Logs ${customerName ? `(${customerName})` : ''}` 
        : section;
      onExpandSection(
        section,
        label,
        fullRelatedData[section] || [],
        relatedDataColumns[section as keyof typeof relatedDataColumns],
        relatedDataCounts[section]
      );
    } else {
      setExpandedModalSection(section);
    }
  };

  const handleExpandModalClose = () => {
    setExpandedModalSection(null);
  };

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
    'otherIspBill',
    'remarks',
    'updatedBy',
    'updatedAt'
  ];

  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(FIELD_VISIBILITY_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
    return defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
  });

  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(FIELD_ORDER_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const missing = defaultFields.filter((f: string) => !parsed.includes(f));
      return missing.length > 0 ? [...parsed, ...missing] : parsed;
    }
    return defaultFields;
  });

  useEffect(() => {
    localStorage.setItem(FIELD_VISIBILITY_KEY, JSON.stringify(fieldVisibility));
  }, [fieldVisibility]);

  useEffect(() => {
    localStorage.setItem(FIELD_ORDER_KEY, JSON.stringify(fieldOrder));
  }, [fieldOrder]);

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark');
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

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
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const diff = startXRef.current - e.clientX;
      const newWidth = Math.max(600, Math.min(1200, startWidthRef.current + diff));

      setDetailsWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = detailsWidth;
  };

  const handleMoveToJO = () => {
    setShowMoveConfirmation(true);
  };

  const handleConfirmMoveToJO = () => {
    setShowMoveConfirmation(false);
    setShowJOAssignForm(true);
  };

  const handleScheduleVisit = async () => {
    if (loading) return;
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
    setStatusRemarks('');
    setShowStatusConfirmation(true);
  };

  const handleConfirmStatusChange = async () => {
    if (loading) return;
    try {
      setLoading(true);

      const authData = localStorage.getItem('authData');
      const parsedUser = authData ? JSON.parse(authData) : null;
      const updatedBy = parsedUser ? (parsedUser.email_address || parsedUser.email || '') : '';

      await updateApplication(application.id, {
        status: pendingStatus,
        remarks: statusRemarks,
        updated_by: updatedBy
      } as any);

      const updatedApplication = await getApplication(application.id);
      setDetailedApplication(updatedApplication);

      setShowStatusConfirmation(false);
      setPendingStatus('');
      setStatusRemarks('');

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
    setStatusRemarks('');
  };

  const handleSaveJOForm = (formData: JobOrderData) => {
    setShowJOAssignForm(false);
    if (onApplicationUpdate) {
      onApplicationUpdate();
    }
    onClose();
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

  useEffect(() => {
    const fetchDuplicates = async () => {
      if (pendingStatus !== 'Duplicate' || !detailedApplication) {
        setDuplicateApplications([]);
        return;
      }

      try {
        setLoadingDuplicates(true);
        const mobile = detailedApplication.mobile_number || application.mobile_number;
        if (!mobile) return;

        const response = await getApplications(true, 1, 10, mobile);
        if (response.success && response.applications) {
          const filtered = response.applications.filter((app: any) => app.id !== detailedApplication.id && app.id !== application.id);
          setDuplicateApplications(filtered);
        }
      } catch (err) {
        console.error('Error fetching duplicate applications:', err);
      } finally {
        setLoadingDuplicates(false);
      }
    };

    fetchDuplicates();
  }, [pendingStatus, detailedApplication, application.id]);

  const getClientFullName = (): string => {
    return [
      detailedApplication?.first_name || '',
      detailedApplication?.middle_initial ? detailedApplication.middle_initial + '.' : '',
      detailedApplication?.last_name || ''
    ].filter(Boolean).join(' ').trim() || application.customer_name || 'Unknown Client';
  };

  const getClientFullAddress = (): string => {
    const addressParts = [
      detailedApplication?.installation_address || application.address,

      detailedApplication?.barangay || application.barangay,
      detailedApplication?.city || application.city,
      detailedApplication?.region || application.region
    ].filter(Boolean);

    return addressParts.length > 0 ? addressParts.join(', ') : 'No address provided';
  };

  const formatDate = (dateStr?: string | null, includeTime: boolean = false): string => {
    if (!dateStr) return 'Not provided';
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

  const getStatusColor = (status?: string | null): string => {
    if (!status) return 'text-gray-400';

    switch (status.toLowerCase()) {
      case 'schedule':
      case 'completed':
        return 'text-green-400';
      case 'in progress':
        return 'text-blue-400';
      case 'pending':
        return 'text-orange-400';
      case 'cancelled':
        return 'text-red-500';
      case 'no facility':
        return 'text-red-400';
      case 'no slot':
        return 'text-purple-400';
      case 'duplicate':
        return 'text-pink-400';
      default:
        return 'text-gray-400';
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
      otherIspBill: 'Other ISP Bill',
      remarks: 'Remarks',
      updatedBy: 'Updated By',
      updatedAt: 'Updated At'
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

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (dropIndex: number) => {
    if (draggedIndex === null) return;
    const newOrder = [...fieldOrder];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, removed);
    setFieldOrder(newOrder);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const resetFieldSettings = () => {
    const allVisible: Record<string, boolean> = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
    setFieldVisibility(allVisible);
    setFieldOrder(defaultFields);
  };

  const renderFieldContent = (fieldKey: string) => {
    if (!fieldVisibility[fieldKey]) return null;

    switch (fieldKey) {
      case 'timestamp':
        let tsValue = 'Not provided';
        if (detailedApplication?.create_date && detailedApplication?.create_time) {
          const [h, m, s] = detailedApplication.create_time.split(':');
          let hours = parseInt(h);
          const ampm = hours >= 12 ? 'PM' : 'AM';
          hours = hours % 12;
          hours = hours ? hours : 12;
          tsValue = `${detailedApplication.create_date} ${hours}:${m || '00'}:${s || '00'} ${ampm}`;
        } else if (application.timestamp) {
          tsValue = formatDate(application.timestamp, true);
        }

        if (tsValue === 'Not provided') return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Timestamp:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              {tsValue}
            </div>
          </div>
        );

      case 'status':
        if (!detailedApplication?.status) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Status:</div>
            <div className={`${getStatusColor(detailedApplication?.status)} flex-1 capitalize`}>
              {detailedApplication?.status}
            </div>
          </div>
        );

      case 'referredBy':
        const referredBy = detailedApplication?.referred_by;
        if (!referredBy || referredBy === 'None') return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Referred By:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{referredBy}</div>
          </div>
        );

      case 'fullName':
        const clientName = getClientFullName();
        if (!clientName || clientName === 'Unknown Client') return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Full Name of Client:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{clientName}</div>
          </div>
        );

      case 'fullAddress':
        const clientAddr = getClientFullAddress();
        if (!clientAddr || clientAddr === 'No address provided') return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Full Address of Client:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{clientAddr}</div>
          </div>
        );

      case 'landmark':
        if (!detailedApplication?.landmark) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Landmark:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{detailedApplication.landmark}</div>
          </div>
        );

      case 'contactNumber':
        const contactNum = detailedApplication?.mobile_number || application.mobile_number;
        if (!contactNum) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Contact Number:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              {contactNum}
            </div>
          </div>
        );

      case 'secondContactNumber':
        if (!detailedApplication?.secondary_mobile_number) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Second Contact Number:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              {detailedApplication.secondary_mobile_number}
            </div>
          </div>
        );

      case 'emailAddress':
        const emailAddress = detailedApplication?.email_address || application.email_address;
        if (!emailAddress) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Email Address:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              {emailAddress}
            </div>
          </div>
        );



      case 'barangay':
        const brgy = detailedApplication?.barangay || application.barangay;
        if (!brgy) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Barangay:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{brgy}</div>
          </div>
        );

      case 'city':
        const cty = detailedApplication?.city || application.city;
        if (!cty) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>City:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{cty}</div>
          </div>
        );

      case 'region':
        const rgn = detailedApplication?.region || application.region;
        if (!rgn) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Region:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{rgn}</div>
          </div>
        );

      case 'desiredPlan':
        if (!detailedApplication?.desired_plan) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Desired Plan:</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span>{detailedApplication.desired_plan}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingPlanOverlay(true);
                    const allPlans = await planService.getAllPlans();
                    const desiredPlanStr = detailedApplication.desired_plan.split('-')[0].trim().toLowerCase();
                    const match = allPlans.find(p =>
                      p.name.toLowerCase() === desiredPlanStr ||
                      detailedApplication.desired_plan.toLowerCase().includes(p.name.toLowerCase())
                    );
                    if (match) {
                      setSelectedPlanForOverlay(match);
                    } else {
                      setNotFoundMessage('Plan details not found.');
                    }
                  } catch (err) {
                    console.error('Error finding plan', err);
                  } finally {
                    setLoadingPlanOverlay(false);
                  }
                }}
                className={`p-1 rounded-full transition-colors ${isDarkMode ? 'text-white hover:bg-gray-800' : 'text-black hover:bg-gray-100'}`}
                title="View Plan Details"
                disabled={loadingPlanOverlay}
              >
                {loadingPlanOverlay ? <Loader size={16} className="animate-spin" /> : <ArrowRightCircle size={16} />}
              </button>
            </div>
          </div>
        );

      case 'promo':
        if (!detailedApplication?.promo) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Promo:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{detailedApplication.promo}</div>
          </div>
        );

      case 'termsAgreed':
        if (!detailedApplication?.terms_agreed) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Terms and Conditions:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Agreed</div>
          </div>
        );

      case 'proofOfBilling':
        if (!detailedApplication?.proof_of_billing_url) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Proof of Billing</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span className="truncate mr-2">
                {detailedApplication.proof_of_billing_url}
              </span>
              {detailedApplication?.proof_of_billing_url && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  onClick={() => window.open(detailedApplication.proof_of_billing_url)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'governmentValidId':
        if (!detailedApplication?.government_valid_id_url) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Government Valid ID</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span className="truncate mr-2">
                {detailedApplication.government_valid_id_url}
              </span>
              {detailedApplication?.government_valid_id_url && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  onClick={() => window.open(detailedApplication.government_valid_id_url)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'secondaryGovernmentValidId':
        if (!detailedApplication?.secondary_government_valid_id_url) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
              <div>Secondary Government</div>
              <div>Valid ID</div>
            </div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span className="truncate mr-2">
                {detailedApplication.secondary_government_valid_id_url}
              </span>
              {detailedApplication?.secondary_government_valid_id_url && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  onClick={() => window.open(detailedApplication.secondary_government_valid_id_url)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'houseFrontPicture':
        if (!detailedApplication?.house_front_picture_url) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>House Front Picture</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span className="truncate mr-2">
                {detailedApplication.house_front_picture_url}
              </span>
              {detailedApplication?.house_front_picture_url && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  onClick={() => window.open(detailedApplication.house_front_picture_url)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'promoImage':
        if (!detailedApplication?.promo_url) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Promo Image</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span className="truncate mr-2">
                {detailedApplication.promo_url}
              </span>
              {detailedApplication?.promo_url && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  onClick={() => window.open(detailedApplication.promo_url)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'nearestLandmark1':
        if (!detailedApplication?.nearest_landmark1_url) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Nearest Landmark 1</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span className="truncate mr-2">
                {detailedApplication.nearest_landmark1_url}
              </span>
              {detailedApplication?.nearest_landmark1_url && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  onClick={() => window.open(detailedApplication.nearest_landmark1_url)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'nearestLandmark2':
        if (!detailedApplication?.nearest_landmark2_url) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Nearest Landmark 2</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span className="truncate mr-2">
                {detailedApplication.nearest_landmark2_url}
              </span>
              {detailedApplication?.nearest_landmark2_url && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  onClick={() => window.open(detailedApplication.nearest_landmark2_url)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'documentAttachment':
        if (!detailedApplication?.document_attachment_url) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Document Attachment</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span className="truncate mr-2">
                {detailedApplication.document_attachment_url}
              </span>
              {detailedApplication?.document_attachment_url && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  onClick={() => window.open(detailedApplication.document_attachment_url)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'otherIspBill':
        if (!detailedApplication?.other_isp_bill_url) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'
            }`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Other ISP Bill</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              <span className="truncate mr-2">
                {detailedApplication.other_isp_bill_url}
              </span>
              {detailedApplication?.other_isp_bill_url && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  onClick={() => window.open(detailedApplication.other_isp_bill_url)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'remarks':
        if (!detailedApplication?.remarks) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Remarks:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{detailedApplication.remarks}</div>
          </div>
        );

      case 'updatedBy':
        if (!detailedApplication?.updated_by) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Updated By:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{detailedApplication.updated_by}</div>
          </div>
        );

      case 'updatedAt':
        if (!detailedApplication?.updated_at) return null;
        return (
          <div className={`flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Updated At:</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{formatDate(detailedApplication.updated_at, true)}</div>
          </div>
        );

      default:
        return null;
    }
  };

  const hasActiveOverlay = selectedPlanForOverlay !== null;

  return (
    <div className={`flex flex-col relative md:border-l overflow-hidden ${
      isMobile ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]' : 'h-full'
    } ${isDarkMode ? 'bg-gray-950 border-white border-opacity-30' : 'bg-gray-50 border-gray-300'
    }`} style={{ width: isMobile ? '100%' : `${detailsWidth}px` }}>

      {/* Plan Overlay */}
      {hasActiveOverlay && (
        <div className="absolute inset-0 z-50 bg-white dark:bg-gray-900 overflow-hidden flex flex-col h-full w-full">
          <React.Suspense fallback={
            <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
              <div className="flex flex-col items-center gap-3">
                <p className="loading-dots pt-4">Loading Plan Details</p>
              </div>
            </div>
          }>
            <PlanListDetails
              plan={selectedPlanForOverlay}
              onClose={() => setSelectedPlanForOverlay(null)}
              isMobile={isMobile}
              onNavigate={onNavigate}
            />
          </React.Suspense>
        </div>
      )}

      <div className={hasActiveOverlay ? 'hidden' : 'block h-full flex flex-col'}>
        {!isMobile && (
          <div
            className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50 ${isDarkMode ? 'hover:bg-orange-500' : 'hover:bg-orange-600'
              }`}
            onMouseDown={handleMouseDownResize}
          />
        )}

        <div className={`p-3 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
          }`}>
          <div className="flex items-center">
            <h2 className={isDarkMode ? 'text-white font-medium' : 'text-gray-900 font-medium'}>{getClientFullName()}</h2>
            {loading && <div className={`ml-3 animate-pulse text-sm ${isDarkMode ? 'text-orange-500' : 'text-orange-600'
              }`}>Loading...</div>}
          </div>

          <div className="flex items-center space-x-3">
            {!['scheduled', 'schedule'].includes(currentStatus) && hasPermission('application-management.move-to-jo') && (
              <button
                className="px-3 py-1 rounded-sm flex items-center text-white"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = colorPalette.primary;
                  }
                }}
                onClick={handleMoveToJO}
                disabled={loading}
              >
                <span>Move to JO</span>
              </button>
            )}
            {/* <button
            className="px-3 py-1 rounded-sm flex items-center text-white"
            style={{
              backgroundColor: colorPalette?.primary || '#7c3aed'
            }}
            onMouseEnter={(e) => {
              if (colorPalette?.accent) {
                e.currentTarget.style.backgroundColor = colorPalette.accent;
              }
            }}
            onMouseLeave={(e) => {
              if (colorPalette?.primary) {
                e.currentTarget.style.backgroundColor = colorPalette.primary;
              }
            }}
            onClick={handleScheduleVisit}
            disabled={loading}
          >
            <span>Schedule</span>
          </button> */}

            <div className="flex items-center overflow-hidden mr-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPrevious?.();
                }}
                disabled={!onPrevious}
                className={`p-2 transition-colors ${!onPrevious
                  ? (isDarkMode ? 'text-gray-600 bg-gray-800' : 'text-gray-300 bg-gray-50')
                  : (isDarkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900')
                  }`}
                title="Previous Record"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNext?.();
                }}
                disabled={!onNext}
                className={`p-2 transition-colors ${!onNext
                  ? (isDarkMode ? 'text-gray-600 bg-gray-800' : 'text-gray-300 bg-gray-50')
                  : (isDarkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900')
                  }`}
                title="Next Record"
              >

                <ChevronRight size={18} />
              </button>
            </div>

            <div className="relative">
              <button
                onClick={() => setShowFieldSettings(!showFieldSettings)}
                className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
                title="Field Settings"
              >
                <Settings size={16} />
              </button>
              {showFieldSettings && (
                <div className={`absolute right-0 mt-2 w-80 rounded-lg shadow-lg border z-50 max-h-96 overflow-y-auto ${isDarkMode
                  ? 'bg-gray-800 border-gray-700'
                  : 'bg-white border-gray-200'
                  }`}>
                  <div className={`px-4 py-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                    }`}>
                    <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>Field Visibility & Order</h3>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={selectAllFields}
                        className="text-blue-600 hover:text-blue-700 text-xs"
                      >
                        Show All
                      </button>
                      <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                      <button
                        onClick={deselectAllFields}
                        className="text-blue-600 hover:text-blue-700 text-xs"
                      >
                        Hide All
                      </button>
                      <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                      <button
                        onClick={resetFieldSettings}
                        className="text-blue-600 hover:text-blue-700 text-xs"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  <div className="p-2">
                    <div className={`text-xs mb-2 px-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                      Drag to reorder fields
                    </div>
                    {fieldOrder.map((fieldKey, index) => (
                      <div
                        key={fieldKey}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(index)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center space-x-2 px-2 py-1.5 rounded cursor-move transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                          } ${draggedIndex === index
                            ? isDarkMode ? 'bg-gray-600' : 'bg-gray-200'
                            : ''
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={fieldVisibility[fieldKey]}
                          onChange={() => toggleFieldVisibility(fieldKey)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                          }`}>☰</span>
                        <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                          {getFieldLabel(fieldKey)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Attachments Button */}
            <button
              onClick={() => setShowAttachmentModal(true)}
              className={`p-2 rounded transition-colors ${isDarkMode
                ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                }`}
              title="Attachments"
            >
              <Paperclip size={18} />
            </button>

            <button
              onClick={onClose}
              className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {currentStatus !== 'scheduled' && currentStatus !== 'schedule' && hasPermission('application-management.quick-status') && (
          <div className={`py-3 border-b flex items-center justify-center px-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-100 border-gray-200'
            }`}>
            {currentStatus !== 'no facility' && <button
              className={`flex flex-col items-center text-center p-2 rounded-md transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'
                }`}
              onClick={() => handleStatusChange('No Facility')}
              disabled={loading}
            >
              <div
                className="p-2 rounded-full"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
              >
                <div className="text-white">
                  <Ban size={18} />
                </div>
              </div>
              <span className={`text-xs mt-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>No Facility</span>
            </button>}

            {currentStatus !== 'cancelled' && <button
              className={`flex flex-col items-center text-center p-2 rounded-md transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'
                }`}
              onClick={() => handleStatusChange('Cancelled')}
              disabled={loading}
            >
              <div
                className="p-2 rounded-full"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
              >
                <div className="text-white">
                  <XCircle size={18} />
                </div>
              </div>
              <span className={`text-xs mt-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Cancelled</span>
            </button>}

            {currentStatus !== 'no slot' && <button
              className={`flex flex-col items-center text-center p-2 rounded-md transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'
                }`}
              onClick={() => handleStatusChange('No Slot')}
              disabled={loading}
            >
              <div
                className="p-2 rounded-full"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
              >
                <div className="text-white">
                  <RotateCw size={18} />
                </div>
              </div>
              <span className={`text-xs mt-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>No Slot</span>
            </button>}

            {currentStatus !== 'duplicate' && <button
              className={`flex flex-col items-center text-center p-2 rounded-md transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'
                }`}
              onClick={() => handleStatusChange('Duplicate')}
              disabled={loading}
            >
              <div
                className="p-2 rounded-full"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
              >
                <div className="text-white">
                  <Square size={18} />
                </div>
              </div>
              <span className={`text-xs mt-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Duplicate</span>
            </button>}
          </div>
        )}

        {error && (
          <div className={`p-3 m-3 rounded ${isDarkMode
            ? 'bg-red-900 bg-opacity-20 border border-red-700 text-red-400'
            : 'bg-red-100 border border-red-300 text-red-700'
            }`}>
            {error}
          </div>
        )}

        <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-24' : ''}`}>
          <div className={`max-w-2xl mx-auto py-6 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
            }`}>
            <div className="space-y-4">
              {fieldOrder.map((fieldKey) => (
                <React.Fragment key={fieldKey}>
                  {renderFieldContent(fieldKey)}
                </React.Fragment>
              ))}
            </div>

            {/* Related Data Section */}
            <div className="mt-8 space-y-4">
              {[{ key: 'detailsUpdateLogs', label: 'Related Details Update Logs', dataKey: 'detailsUpdateLogs' }].map((section) => (
                <div key={section.key} className={`border-t pt-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                  <div className={`w-full py-2 flex items-center justify-between`}>
                    <div className="flex items-center space-x-2">
                      <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{section.label}</span>
                      <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>{relatedDataCounts[section.key]}</span>
                    </div>
                    {relatedDataCounts[section.key] > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExpandModalOpen(section.key);
                        }}
                        className={`text-sm transition-colors hover:underline ${isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-500'}`}
                      >
                        Expand
                      </button>
                    )}
                  </div>

                  {relatedDataCounts[section.key] > 0 ? (
                    <div className="pb-4">
                      <RelatedDataTable
                        data={relatedData[section.key]}
                        columns={relatedDataColumns[section.dataKey as keyof typeof relatedDataColumns]}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                  ) : (
                    <div className={`text-sm py-4 italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      No related {section.label.toLowerCase()} found.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      <ConfirmationModal
        isOpen={showMoveConfirmation}
        title="Confirm"
        message="Are you sure you want to move this application to JO?"
        confirmText="Move to JO"
        cancelText="Cancel"
        onConfirm={handleConfirmMoveToJO}
        onCancel={() => setShowMoveConfirmation(false)}
      />

      {showStatusConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[6000] p-4">
          <div className={`w-full max-w-md mx-4 rounded-lg shadow-xl ${isDarkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200'}`}>
            <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Change Status to "{pendingStatus}"
              </h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Are you sure you want to change the status of this application to <strong>{pendingStatus}</strong>?
              </p>
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Remarks {pendingStatus === 'Cancelled' && <span className="text-red-500">*</span>}
                </label>
                <textarea
                  className={`w-full p-2 border rounded-md resize-none ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
                  rows={3}
                  value={statusRemarks}
                  onChange={(e) => setStatusRemarks(e.target.value)}
                  placeholder="Enter remarks for status change (required for Cancelled)..."
                />
              </div>
            </div>
            <div className={`px-6 py-4 border-t flex justify-end space-x-3 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <button
                className={`px-4 py-2 rounded-md font-medium transition-colors ${isDarkMode ? 'text-gray-300 hover:bg-gray-800 border border-gray-600' : 'text-gray-700 hover:bg-gray-100 border border-gray-300'}`}
                onClick={handleCancelStatusChange}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-md text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                onClick={handleConfirmStatusChange}
                disabled={loading || (pendingStatus === 'Cancelled' && !statusRemarks.trim())}
              >
                {loading ? <Loader size={16} className="animate-spin inline-block mr-2" /> : null}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-black bg-opacity-50">
          <div className={`w-full max-w-sm rounded-lg shadow-xl overflow-hidden ${isDarkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200'}`}>
            <div className="p-6 text-center">
              <div className="w-16 h-16 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-500" />
              </div>
              <h3 className={`text-xl font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Success!</h3>
              <p className={`text-base ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>{successMessage}</p>
            </div>
            <div className={`px-6 py-4 bg-gray-50 dark:bg-gray-800/50 flex justify-center border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <button
                onClick={() => setShowSuccessModal(false)}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium transition-colors"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showVisitExistsConfirmation && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-black bg-opacity-50">
          <div className={`w-full max-w-md rounded-lg shadow-xl ${isDarkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200'}`}>
            <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className={`text-lg font-semibold text-yellow-600 dark:text-yellow-500 flex items-center`}>
                <Info size={20} className="mr-2" />
                Active Schedule Exists
              </h3>
            </div>
            <div className={`p-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <p>There is already a scheduled visit for this application.</p>
              <p className="mt-2">Are you sure you want to create another schedule?</p>
            </div>
            <div className={`px-6 py-4 border-t flex justify-end space-x-3 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <button
                className={`px-4 py-2 rounded font-medium transition-colors ${isDarkMode ? 'text-gray-300 hover:bg-gray-800 border border-gray-600' : 'text-gray-700 hover:bg-gray-100 border border-gray-300'}`}
                onClick={handleCancelCreateNewVisit}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded text-white font-medium"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                onClick={handleConfirmCreateNewVisit}
              >
                Yes, Create New
              </button>
            </div>
          </div>
        </div>
      )}

      {showJOAssignForm && (
        <JOAssignFormModal
          isOpen={showJOAssignForm}
          onClose={() => setShowJOAssignForm(false)}
          onSave={handleSaveJOForm}
          applicationData={{
            id: detailedApplication?.id || application.id,
            first_name: detailedApplication?.first_name || application.first_name,
            middle_initial: detailedApplication?.middle_initial || application.middle_initial,
            last_name: detailedApplication?.last_name || application.last_name,
            email_address: detailedApplication?.email_address || application.email_address,
            mobile_number: detailedApplication?.mobile_number || application.mobile_number,
            installation_address: detailedApplication?.installation_address || application.installation_address,
            landmark: detailedApplication?.landmark || application.landmark,
            barangay: detailedApplication?.barangay || application.barangay,
            city: detailedApplication?.city || application.city,
            region: detailedApplication?.region || application.region,
            desired_plan: detailedApplication?.desired_plan || application.desired_plan,
            promo: detailedApplication?.promo || application.promo,
            location: detailedApplication?.location || (application as any).location
          }}
        />
      )}

      {showVisitForm && (
        <ApplicationVisitFormModal
          isOpen={showVisitForm}
          onClose={() => setShowVisitForm(false)}
          onSave={handleSaveVisitForm}
          applicationData={{
            id: detailedApplication?.id || application.id,
            fullName: getClientFullName(),
            address: getClientFullAddress(),
            contactNumber: detailedApplication?.mobile_number || application.mobile_number,
            plan: detailedApplication?.desired_plan || application.desired_plan,
            promo: detailedApplication?.promo || application.promo,
            landmark: detailedApplication?.landmark || application.landmark,
            long_lat: detailedApplication?.long_lat || application.long_lat,
            city: detailedApplication?.city || application.city,
            barangay: detailedApplication?.barangay || application.barangay,
          }}
        />
      )}

      {/* Expanded Modal for Related Data */}
      {expandedModalSection && (
        <div className="absolute inset-0 flex flex-col" style={{ backgroundColor: isDarkMode ? '#111827' : '#ffffff', zIndex: 9999 }}>
          {/* Header */}
          <div className={`px-4 md:px-6 py-4 flex items-center justify-between border-b ${
            isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-center space-x-2 md:space-x-4">
              <div className="flex items-center space-x-2 md:space-x-3">
                <h2 className={`text-lg md:text-xl font-bold truncate max-w-[200px] md:max-w-none ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {expandedModalSection === 'detailsUpdateLogs' && 'All Related Details Update Logs'}
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] md:text-xs font-bold border transition-colors ${
                  isDarkMode 
                    ? 'bg-gray-800 text-gray-400 border-gray-700' 
                    : 'bg-gray-100 text-gray-500 border-gray-200'
                }`}>
                  {relatedDataCounts[expandedModalSection]} items
                </span>
              </div>
            </div>

            <button
              onClick={handleExpandModalClose}
              className={`p-2 rounded-full transition-colors ${
                isDarkMode ? 'hover:bg-gray-800 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              <X size={20} />
            </button>
          </div>

          {/* Table Content */}
          <div className="flex-1 overflow-hidden relative">
            <RelatedDataTable
              data={fullRelatedData[expandedModalSection] || []}
              columns={relatedDataColumns[expandedModalSection as keyof typeof relatedDataColumns]}
              isDarkMode={isDarkMode}
              fullContent={true}
            />
          </div>
        </div>
      )}

      {/* Application Attachment Modal */}
      <ApplicationAttachmentModal
        isOpen={showAttachmentModal}
        onClose={() => setShowAttachmentModal(false)}
        onSave={() => {
          setShowAttachmentModal(false);
          if (onApplicationUpdate) onApplicationUpdate();
          // Refresh details
          const fetchApplicationDetails = async () => {
            try {
              const result = await getApplication(application.id);
              setDetailedApplication(result);
            } catch (err) { }
          };
          fetchApplicationDetails();
        }}
        applicationData={detailedApplication || application}
      />
    </div>
  );
};

export default ApplicationDetails;
