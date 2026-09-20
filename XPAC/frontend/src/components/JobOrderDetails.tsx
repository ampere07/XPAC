import React, { useState, useEffect, useRef } from 'react';
import {
  X, ExternalLink, Edit, Settings, Loader, ArrowRightCircle, Paperclip,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { updateJobOrder, approveJobOrder, getRelatedDetailsUpdateLogs, enableJobOrderForTechnician } from '../services/jobOrderService';
import apiClient from '../config/api';
import { getBillingStatuses, BillingStatus } from '../services/lookupService';
import { JobOrderDetailsProps } from '../types/jobOrder';
import JobOrderDoneFormModal from '../modals/JobOrderDoneFormModal';
import JobOrderDoneFormTechModal from '../modals/JobOrderDoneFormTechModal';
import JobOrderEditFormModal from '../modals/JobOrderEditFormModal';
import JOAttachmentModal from '../modals/JOAttachmentModal';
import ApprovalConfirmationModal from '../modals/ApprovalConfirmationModal';
import ConfirmationModal from '../modals/MoveToJoModal';
import PreInstalledModal from '../modals/PreInstalledModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getApplication } from '../services/applicationService';
import RelatedDataTable from './RelatedDataTable';
import { relatedDataColumns } from '../config/relatedDataColumns';
import { Application } from '../types/application';
import { planService, Plan } from '../services/planService';
import { userService } from '../services/userService';
import { User as UserType } from '../types/api';
import { getBillingRecords, getBillingRecordDetails, BillingDetailRecord } from '../services/billingService';
import { getAllInventoryItems } from '../services/inventoryItemService';
import { isAgentUser } from '../utils/agentReferral';
import { isClosedForTechnicianQueue, isTechnicianEnabled, TECHNICIAN_LOCKED_MESSAGE } from '../utils/technicianJobOrderAccess';
import { usePermissions } from '../hooks/usePermissions';

const PlanListDetails = React.lazy(() => import('./PlanListDetails'));
const UserDetails = React.lazy(() => import('./UserDetails'));
const CustomerDetails = React.lazy(() => import('./CustomerDetails'));
const InventoryDetails = React.lazy(() => import('./InventoryDetails'));
const NotFoundModal = React.lazy(() => import('../modals/NotFoundModal'));

// Pre Installed is held closed while the flow behind it is being reworked.
// The button stays visible so the feature does not look removed — flip this to
// false to hand it back, no other change needed.
const PRE_INSTALLED_UNDER_MAINTENANCE = true;

const JobOrderDetails: React.FC<JobOrderDetailsProps> = ({ jobOrder, onClose, onRefresh, isMobile = false, onPrevious, onNext, onExpandSection, isTechnicianLocked = false }) => {
  const [localIsMobile, setLocalIsMobile] = useState<boolean>(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => {
      setLocalIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const activeIsMobile = isMobile || localIsMobile;

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDoneModalOpen, setIsDoneModalOpen] = useState(false);
  const [isDoneTechModalOpen, setIsDoneTechModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [isFailedModalOpen, setIsFailedModalOpen] = useState(false);
  const [isPreInstalledModalOpen, setIsPreInstalledModalOpen] = useState(false);
  // Tracked separately from `loading` so the modal's own button shows the
  // spinner and cannot be pressed twice, without disabling the whole panel.
  const [preInstalledSaving, setPreInstalledSaving] = useState(false);
  const [billingStatuses, setBillingStatuses] = useState<BillingStatus[]>([]);
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [isEnablingTechnician, setIsEnablingTechnician] = useState(false);
  const [enableTechnicianError, setEnableTechnicianError] = useState<string | null>(null);
  /**
   * Local echo of technician_enabled after a successful enable.
   *
   * The list refresh is what makes the change permanent everywhere; this only
   * keeps the button honest in the moment between the two. Cleared whenever a
   * different job order is opened so it can never leak across records.
   */
  const [technicianEnabledOverride, setTechnicianEnabledOverride] = useState<boolean | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [applicationData, setApplicationData] = useState<Application | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [shouldCloseOnSuccess, setShouldCloseOnSuccess] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [selectedPlanForOverlay, setSelectedPlanForOverlay] = useState<Plan | null>(null);
  const [loadingPlanOverlay, setLoadingPlanOverlay] = useState(false);
  const [selectedUserForOverlay, setSelectedUserForOverlay] = useState<UserType | null>(null);
  const [loadingUserOverlay, setLoadingUserOverlay] = useState(false);
  const [selectedCustomerForOverlay, setSelectedCustomerForOverlay] = useState<BillingDetailRecord | null>(null);
  const [loadingCustomerOverlay, setLoadingCustomerOverlay] = useState(false);
  const [selectedInventoryForOverlay, setSelectedInventoryForOverlay] = useState<any | null>(null);
  const [loadingInventoryOverlay, setLoadingInventoryOverlay] = useState(false);
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null);
  const [users, setUsers] = useState<UserType[]>([]);

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
    if (!jobOrder.id) return;

    try {
      const result = await getRelatedDetailsUpdateLogs(jobOrder.id);

      const data = result.data || [];
      const count = result.count || 0;

      setRelatedData({ detailsUpdateLogs: data.slice(0, 5) });
      setFullRelatedData({ detailsUpdateLogs: data });
      setRelatedDataCounts({ detailsUpdateLogs: count });
    } catch (error) {
      console.error('Error fetching related details update logs:', error);
    }
  };

  const handleExpandModalOpen = (section: string) => {
    if (onExpandSection) {
      const fullName = `${jobOrder.First_Name || ''} ${jobOrder.Last_Name || ''}`.trim();
      const title = section === 'detailsUpdateLogs' 
        ? `All Related Details Update Logs ${fullName ? `(${fullName})` : ''}` 
        : section;
      const data = fullRelatedData[section] || [];
      const columns = relatedDataColumns[section as keyof typeof relatedDataColumns] || [];
      const count = relatedDataCounts[section] || 0;
      onExpandSection(section, title, data, columns, count);
    } else {
      setExpandedModalSection(section);
    }
  };

  const handleExpandModalClose = () => {
    setExpandedModalSection(null);
  };

  const hasActiveOverlay = !!selectedPlanForOverlay || !!selectedUserForOverlay || loadingPlanOverlay || loadingUserOverlay || !!selectedCustomerForOverlay || loadingCustomerOverlay || !!selectedInventoryForOverlay || loadingInventoryOverlay;

  const FIELD_VISIBILITY_KEY = 'jobOrderDetailsFieldVisibility';
  const FIELD_ORDER_KEY = 'jobOrderDetailsFieldOrder';

  const defaultFields = [
    'timestamp',
    'jobOrderNumber',
    'referredBy',
    'fullName',
    'contactNumber',
    'secondContactNumber',
    'emailAddress',
    'fullAddress',
    'addressCoordinates',
    'billingStatus',
    'billingDay',
    'choosePlan',
    'statusRemarks',
    'remarks',
    'installationLandmark',
    'connectionType',
    'modemRouterSn',
    'routerModel',
    'installationFee',
    'lcpnap',
    'port',
    'vlan',
    'username',
    'ipAddress',
    'usageType',
    'dateInstalled',
    'visitBy',
    'visitWith',
    'visitWithOther',
    'onsiteStatus',
    'startTime',
    'endTime',
    'duration',
    'jobOrderItems',

    'modifiedBy',
    'modifiedDate',
    'assignedEmail',
    'clientSignature',
    'setupImage',
    'speedtestImage',
    'signedContractImage',
    'boxReadingImage',
    'routerReadingImage',
    'portLabelImage',
    'houseFrontPicture',
    'clientTagging',
    'proofImage',
    'proofOfBilling',
    'governmentValidId',
    'secondGovernmentValidId',
    'documentAttachment',
    'otherIspBill'
  ];

  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(FIELD_VISIBILITY_KEY);
    const initialVisibility = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...initialVisibility, ...parsed };
      } catch (e) {
        return initialVisibility;
      }
    }
    return initialVisibility;
  });

  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(FIELD_ORDER_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure new fields are added to the end of the order if they're not in the saved order
        const missingFields = defaultFields.filter(f => !parsed.includes(f));
        return [...parsed, ...missingFields];
      } catch (e) {
        return defaultFields;
      }
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
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        const role = userData.role?.toLowerCase() || '';
        const id = userData.role_id || null;
        setUserRole(role);
        setRoleId(id);

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

        const isAgent = isAgentUser(role, id);
        const isTechnician = role === 'technician' || String(id) === '2';

        if (isAgent) {
          // Agents see the customer/visit side of a referral but none of the technical
          // provisioning details or uploaded documents — the same split the mobile app
          // applies. Installation fee stays visible because it drives their commission
          // and is already shown on the agent's Job Order list columns.
          const agentHiddenFields = [
            // Technical provisioning
            'modemRouterSn', 'routerModel', 'lcpnap', 'port', 'vlan', 'username',
            'ipAddress', 'usageType', 'jobOrderItems',
            // Attachments & documents
            'clientSignature', 'setupImage', 'speedtestImage', 'signedContractImage',
            'boxReadingImage', 'routerReadingImage', 'portLabelImage', 'houseFrontPicture',
            'clientTagging', 'proofImage', 'proofOfBilling', 'governmentValidId',
            'secondGovernmentValidId', 'documentAttachment', 'otherIspBill'
          ];
          const agentAllowedFields = defaultFields.filter(f => !agentHiddenFields.includes(f));
          setFieldOrder(agentAllowedFields);
          const newVisibility: Record<string, boolean> = {};
          defaultFields.forEach(f => {
            newVisibility[f] = agentAllowedFields.includes(f);
          });
          setFieldVisibility(newVisibility);
        } else if (isTechnician) {
          setFieldOrder(defaultFields);
          const allVisible: Record<string, boolean> = {};
          defaultFields.forEach(f => {
            allVisible[f] = true;
          });
          setFieldVisibility(allVisible);
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    }
  }, []);

  // Resolved centrally (hooks/usePermissions) so a seeded role such as
  // Technician is answered from the role table rather than from a stored
  // permissions array it does not have.
  const { can: hasPermission } = usePermissions();

  useEffect(() => {
    const fetchBillingStatuses = async () => {
      try {
        const statuses = await getBillingStatuses();
        setBillingStatuses(statuses);
      } catch (error) {
        console.error('Error fetching billing statuses:', error);
      }
    };
    fetchBillingStatuses();
  }, []);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await userService.getAllUsers();
        if (response.success && response.data) {
          setUsers(response.data);
        }
      } catch (err) {
        console.error('Failed to fetch users in JobOrderDetails:', err);
      }
    };
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchRelatedData();
  }, [jobOrder.id]);

  useEffect(() => {
    const fetchApplicationData = async () => {
      const appId = jobOrder.application_id || jobOrder.Application_ID || jobOrder.account_id;
      if (appId) {
        try {
          const app = await getApplication(appId.toString());
          setApplicationData(app);
        } catch (error) {
          console.error('Error fetching application data:', error);
        }
      }
    };

    if (jobOrder) {
      fetchApplicationData();
    }
  }, [jobOrder]);

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

  const getBillingStatusName = (statusId?: number | null): string => {
    if (!statusId) return 'Not Set';

    if (billingStatuses.length === 0) {
      const defaultStatuses: { [key: number]: string } = {
        1: 'In Progress',
        2: 'Active',
        3: 'Suspended',
        4: 'Cancelled',
        5: 'Overdue'
      };
      return defaultStatuses[statusId] || 'Loading...';
    }

    const status = billingStatuses.find(s => s.id === statusId);
    return status ? status.status_name : `Unknown (ID: ${statusId})`;
  };

  const formatDate = (dateStr?: string | null): string => {
    if (!dateStr) return 'Not scheduled';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      let hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const hh = String(hours).padStart(2, '0');
      return `${mm}/${dd}/${yyyy} ${hh}:${minutes} ${ampm}`;
    } catch (e) {
      return dateStr;
    }
  };

  const formatOnlyDate = (dateStr?: string | null): string => {
    if (!dateStr) return 'Not scheduled';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
      return dateStr || 'Not scheduled';
    }
  };

  const calculateDuration = (start?: string | null, end?: string | null): string => {
    if (!start || !end) return 'N/A';
    try {
      const startTime = new Date(start);
      const endTime = new Date(end);
      const diffMs = endTime.getTime() - startTime.getTime();

      if (diffMs < 0) return 'Invalid duration';

      const diffHrs = Math.floor(diffMs / 3600000);
      const diffMins = Math.floor((diffMs % 3600000) / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      const parts = [];
      if (diffHrs > 0) parts.push(`${diffHrs}h`);
      if (diffMins > 0) parts.push(`${diffMins}m`);
      if (diffSecs > 0 || parts.length === 0) parts.push(`${diffSecs}s`);

      return parts.join(' ');
    } catch (e) {
      return 'N/A';
    }
  };

  const formatPrice = (price?: string | number | null): string => {
    if (price === null || price === undefined) return '₱0.00';
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    return `₱${numPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getLastDayOfMonth = (): number => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return lastDay.getDate();
  };

  const getBillingDayDisplay = (billingDay?: string | number | null): string => {
    const day = billingDay ?? null;
    if (day === null || day === undefined) return 'Not set';
    const dayValue = Number(day);
    if (isNaN(dayValue)) return 'Not set';
    return dayValue === 0 ? String(getLastDayOfMonth()) : String(dayValue);
  };

  const getClientFullName = (): string => {
    const joName = [
      jobOrder.First_Name || jobOrder.first_name || '',
      jobOrder.Middle_Initial || jobOrder.middle_initial ? (jobOrder.Middle_Initial || jobOrder.middle_initial) + '.' : '',
      jobOrder.Last_Name || jobOrder.last_name || ''
    ].filter(Boolean).join(' ').trim();

    if (joName) return joName;

    if (applicationData) {
      return [
        applicationData.first_name || '',
        applicationData.middle_initial ? applicationData.middle_initial + '.' : '',
        applicationData.last_name || ''
      ].filter(Boolean).join(' ').trim();
    }

    return 'Unknown Client';
  };

  const getClientFullAddress = (): string => {
    const joAddressParts = [
      jobOrder.Installation_Address || jobOrder.installation_address || jobOrder.Address || jobOrder.address,
      jobOrder.Barangay || jobOrder.barangay,
      jobOrder.City || jobOrder.city,
      jobOrder.Region || jobOrder.region
    ].filter(Boolean);

    if (joAddressParts.length > 0) return joAddressParts.join(', ');

    if (applicationData) {
      const appAddressParts = [
        applicationData.installation_address,
        applicationData.barangay,
        applicationData.city,
        applicationData.region
      ].filter(Boolean);

      if (appAddressParts.length > 0) return appAddressParts.join(', ');
    }

    return 'No address provided';
  };

  const getStatusColor = (status: string | undefined | null, type: 'onsite' | 'billing') => {
    if (!status) return 'text-gray-400';

    if (type === 'onsite') {
      switch (status.toLowerCase()) {
        case 'done':
        case 'completed':
          return 'text-green-400';
        case 'reschedule':
          return 'text-blue-400';
        case 'inprogress':
        case 'in progress':
          return 'text-blue-400';
        case 'pending':
          return 'text-orange-400';
        case 'failed':
        case 'cancelled':
          return 'text-red-500';
        default:
          return 'text-gray-400';
      }
    } else {
      switch (status.toLowerCase()) {
        case 'done':
        case 'active':
        case 'completed':
        case 'vip':
        case 'service account':
          return 'text-green-400';
        case 'pending':
        case 'in progress':
          return 'text-orange-400';
        case 'suspended':
        case 'overdue':
        case 'cancelled':
        case 'blacklisted':
        case 'pullout':
          return 'text-red-500';
        case 'freeze':
          return 'text-blue-400';
        case 'inactive':
          return 'text-gray-400';
        default:
          return 'text-gray-400';
      }
    }
  };

  const handleDoneClick = () => {
    // A locked job order opens for reading, but not for editing: this form is how
    // the work gets recorded, and JobOrderController refuses the update anyway.
    if (isTechnicianLocked) {
      setError(TECHNICIAN_LOCKED_MESSAGE);
      return;
    }

    if (hasPermission('job-order.admin-edit')) {
      setIsDoneModalOpen(true);
    } else if (hasPermission('job-order.tech-edit')) {
      setIsDoneTechModalOpen(true);
    }
  };

  const handleEditClick = () => {
    setIsEditModalOpen(true);
  };

  const handleDoneSave = (formData: any) => {
    setSuccessMessage('Job Order updated successfully!');
    setShowSuccessModal(true);
    if (onRefresh) {
      onRefresh();
    }
    setIsDoneModalOpen(false);
    setIsDoneTechModalOpen(false);
  };

  const handleEditSave = (formData: any) => {
    setSuccessMessage('Job Order updated successfully!');
    setShowSuccessModal(true);
    if (onRefresh) {
      onRefresh();
    }
    setIsEditModalOpen(false);
  };


  const handleApproveClick = () => {
    setIsApprovalModalOpen(true);
  };

  const handleApproveConfirm = async () => {
    if (loading) return;
    try {
      setLoading(true);
      setIsApprovalModalOpen(false);
      setShowLoadingModal(true);

      if (!jobOrder.id) {
        throw new Error('Cannot approve job order: Missing ID');
      }

      const response = await approveJobOrder(jobOrder.id);

      if (response.success) {
        const accountNumber = response.data?.account_number || 'N/A';
        const contactNumber = response.data?.contact_number_primary || 'N/A';
        const userCreated = response.data?.user_created;

        let message = 'Job Order approved successfully! Customer, billing account, and technical details have been created.';

        if (userCreated) {
          message += `\n\nCustomer Login Credentials:\nUsername: ${accountNumber}\nPassword: ${contactNumber}`;
        }

        // Update the ONU name in SmartOLT using the PPPoE username (best-effort).
        const sn = jobOrder.Modem_Router_SN || jobOrder.modem_router_sn || jobOrder.Modem_SN || jobOrder.modem_sn;
        const pppoeUsername = jobOrder.Username || jobOrder.username || jobOrder.pppoe_username;

        if (sn && pppoeUsername) {
          try {
            const smartOltResponse = await apiClient.post('/smart-olt/update-name', {
              sn,
              pppoe_username: pppoeUsername,
            });

            if ((smartOltResponse.data as any)?.success) {
              message += `\n\nSmartOLT ONU name updated to: ${pppoeUsername}`;
            } else {
              const smartOltMsg = (smartOltResponse.data as any)?.message || 'Unknown error';
              message += `\n\nNote: Could not update SmartOLT ONU name (${smartOltMsg}).`;
            }
          } catch (smartOltErr: any) {
            console.error('SmartOLT ONU name update error:', smartOltErr);
            const smartOltMsg = smartOltErr.response?.data?.message || smartOltErr.message || 'Connection error';
            message += `\n\nNote: Could not update SmartOLT ONU name (${smartOltMsg}).`;
          }
        }

        setShowLoadingModal(false);
        setSuccessMessage(message);
        setShouldCloseOnSuccess(true);
        setShowSuccessModal(true);
        if (onRefresh) {
          onRefresh();
        }
      } else {
        setShowLoadingModal(false);
        const backendMsg = response.error || response.message || 'Failed to approve job order';
        let displayMsg = backendMsg;

        // Map duplicate errors to more specific messages
        if (backendMsg.includes('already data') || backendMsg.includes('duplicate') || backendMsg.toLowerCase().includes('serial number')) {
          if (backendMsg.toLowerCase().includes('serial number') || backendMsg.toLowerCase().includes('modem')) {
            displayMsg = "SN Duplicate, Please check on Customer Details. SN Duplicate Detected.";
          } else if (backendMsg.includes("already data") || backendMsg.toLowerCase().includes('duplicate')) {
            displayMsg = "Username Duplicate, Please check on Customer Details. Username Duplicate Detected.";
          }

          if (response.table && !displayMsg.includes('Customer Details')) {
            displayMsg = `Duplicate Entry Error: ${displayMsg}\nTable: ${response.table}`;
          }
        }

        setErrorMessage(displayMsg);
        setShowErrorModal(true);
      }
    } catch (err: any) {
      setShowLoadingModal(false);

      let displayMsg = 'Failed to approve job order';
      let tableInfo = '';

      if (err.response?.data) {
        const data = err.response.data;
        const rawMsg = data.error || data.message || 'Failed to approve job order';
        displayMsg = rawMsg;

        // Map duplicate errors to more specific messages
        if (rawMsg.includes('already data') || rawMsg.includes('duplicate') || rawMsg.toLowerCase().includes('serial number') || rawMsg.includes('already been approved')) {
          if (rawMsg.toLowerCase().includes('serial number') || rawMsg.toLowerCase().includes('modem')) {
            displayMsg = "SN Duplicate, Please check on Customer Details. SN Duplicate Detected.";
          } else if (rawMsg.includes("already data") || rawMsg.toLowerCase().includes('duplicate')) {
            displayMsg = "Username Duplicate, Please check on Customer Details. Username Duplicate Detected.";
          }

          if (data.table && !displayMsg.includes('Customer Details')) {
            tableInfo = `\nTable: ${data.table}`;
          }
        }
      } else if (err.message) {
        displayMsg = err.message;
      }

      setErrorMessage(`${displayMsg}${tableInfo}`);
      setShowErrorModal(true);
      console.error('Approve error:', err);
    } finally {
      setLoading(false);
    }
  };

  const shouldShowApproveButton = () => {
    const onsiteStatus = (jobOrder.Onsite_Status || '').toLowerCase();
    const billingStatus = (jobOrder.billing_status || jobOrder.Billing_Status || '').toLowerCase();

    return onsiteStatus === 'done' && billingStatus !== 'done' && hasPermission('job-order.approve');
  };

  const shouldShowEditButton = () => {
    // Nothing to offer on a job order that is waiting its turn.
    if (isTechnicianLocked) return false;

    const billingStatus = (jobOrder.billing_status || jobOrder.Billing_Status || '').toLowerCase();
    const onsiteStatus = (jobOrder.Onsite_Status || jobOrder.onsite_status || '').toLowerCase();

    // The ONLY time it is HIDDEN is when onsite is 'done' AND billing is 'approved' or 'done'
    const isHiddenState = onsiteStatus === 'done' && (billingStatus === 'approved' || billingStatus === 'done');

    if (hasPermission('job-order.admin-edit')) {
      return !isHiddenState;
    }

    if (hasPermission('job-order.tech-edit')) {
      return onsiteStatus === 'in progress' || onsiteStatus === 'inprogress';
    }

    return false;
  };

  // ── Technician queue release ────────────────────────────────────────────────
  // Technicians work their job orders oldest first: everything newer is greyed
  // out until either the older work moves forward or an administrator releases
  // one early. This is that release.

  const isAdminUser = (): boolean => {
    const lowerRole = (userRole || '').toLowerCase().trim();
    return lowerRole === 'administrator' || lowerRole === 'superadmin' || roleId === 1 || roleId === 7;
  };

  const technicianEnabled = technicianEnabledOverride ?? isTechnicianEnabled(jobOrder);

  // Offered for administrators on any job order a technician still owes work on,
  // including one that has been rescheduled — that is precisely the case where
  // they cannot pick it back up without being released. A job order that is
  // finished, failed or cancelled has nothing left to release.
  const shouldShowEnableTechnicianButton = () =>
    isAdminUser() && !isClosedForTechnicianQueue(jobOrder);

  const handleEnableTechnicianClick = async () => {
    if (isEnablingTechnician || technicianEnabled) return;

    if (!jobOrder.id) {
      setEnableTechnicianError('Cannot enable job order: Missing ID');
      return;
    }

    setEnableTechnicianError(null);
    setIsEnablingTechnician(true);

    try {
      const response = await enableJobOrderForTechnician(jobOrder.id);

      if (response?.success) {
        setTechnicianEnabledOverride(true);
        setSuccessMessage('Job order enabled. The technician can now start it.');
        setShowSuccessModal(true);
        if (onRefresh) {
          onRefresh();
        }
      } else {
        setEnableTechnicianError(response?.message || 'Failed to enable job order for the technician');
      }
    } catch (err: any) {
      setEnableTechnicianError(
        err.response?.data?.message || err.message || 'Failed to enable job order for the technician'
      );
    } finally {
      setIsEnablingTechnician(false);
    }
  };

  // A different record is a different lock state.
  useEffect(() => {
    setTechnicianEnabledOverride(null);
    setEnableTechnicianError(null);
  }, [jobOrder.id]);

  const shouldShowFailedButton = () => {
    const onsiteStatus = String(jobOrder.Onsite_Status || jobOrder.onsite_status || '').toLowerCase().trim();
    const billingStatus = String(jobOrder.billing_status || jobOrder.Billing_Status || '').toLowerCase().trim();

    return (onsiteStatus === 'done' || onsiteStatus === 'completed' || onsiteStatus === 'failed') &&
      billingStatus !== 'done' &&
      billingStatus !== 'failed' &&
      billingStatus !== 'approved' &&
      hasPermission('job-order.failed');
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (loading) return;
    try {
      setLoading(true);

      if (!jobOrder.id) {
        throw new Error('Cannot update job order: Missing ID');
      }

      await updateJobOrder(jobOrder.id, {
        Onsite_Status: newStatus,
        Modified_By: 'current_user@ampere.com',
      });

      jobOrder.Onsite_Status = newStatus;

      setSuccessMessage(`Status updated to ${newStatus}`);
      setShowSuccessModal(true);
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      setError(`Failed to update status: ${err.message}`);
      console.error('Status update error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFailedClick = () => {
    setIsFailedModalOpen(true);
  };

  const handleFailedConfirm = async () => {
    setIsFailedModalOpen(false);
    if (loading || !jobOrder.id) return;
    try {
      setLoading(true);
      const response = await updateJobOrder(jobOrder.id, {
        billing_status: 'Failed'
      });

      if (response.success) {
        setSuccessMessage('Job Order billing status updated to Failed!');
        setShowSuccessModal(true);
        if (onRefresh) {
          onRefresh();
        }
      } else {
        setErrorMessage(response.message || 'Failed to update status');
        setShowErrorModal(true);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while updating status');
      setShowErrorModal(true);
    } finally {
      setLoading(false);
    }
  };

  const handlePreInstalledClick = () => {
    setIsPreInstalledModalOpen(true);
  };

  /**
   * Record the pre-installation visit.
   *
   * Written through the same updateJobOrder() every other action on this panel
   * uses, so the change picks up the update log and the technician lock without
   * needing an endpoint of its own.
   *
   * The timestamp is built from the browser clock in the server's own
   * 'Y-m-d H:i:s' shape rather than sent as an ISO string, which the API would
   * read as UTC and store several hours out.
   */
  const handlePreInstalledSave = async (remarks: string) => {
    if (preInstalledSaving || !jobOrder.id) return;

    const trimmed = (remarks || '').trim();
    if (!trimmed) {
      setErrorMessage('Pre installed remarks are required.');
      setShowErrorModal(true);
      return;
    }

    try {
      setPreInstalledSaving(true);

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
        + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const response = await updateJobOrder(jobOrder.id, {
        pre_installed: 'preinstalled',
        pre_remarks: trimmed,
        pre_installed_datetime: stamp
      });

      if (response.success) {
        setIsPreInstalledModalOpen(false);
        setSuccessMessage('Job Order marked as Pre Installed!');
        setShowSuccessModal(true);
        if (onRefresh) {
          onRefresh();
        }
      } else {
        setErrorMessage(response.message || 'Failed to save pre installed details');
        setShowErrorModal(true);
      }
    } catch (err: any) {
      // The API's own message first: a refusal to record the visit explains why
      // (no email on the account, for one), and "Request failed with status
      // code 422" would hide it.
      setErrorMessage(
        err.response?.data?.message || err.message || 'An error occurred while saving pre installed details'
      );
      setShowErrorModal(true);
    } finally {
      setPreInstalledSaving(false);
    }
  };

  const getFieldLabel = (fieldKey: string): string => {
    const labels: Record<string, string> = {
      timestamp: 'Timestamp',
      jobOrderNumber: 'Job Order Number',
      referredBy: 'Referred By',
      fullName: 'Full Name',
      contactNumber: 'Contact Number',
      secondContactNumber: 'Second Contact Number',
      emailAddress: 'Email Address',
      fullAddress: 'Full Address',
      addressCoordinates: 'Address Coordinates',
      billingStatus: 'Billing Status',
      billingDay: 'Billing Day',
      choosePlan: 'Choose Plan',
      statusRemarks: 'Status Remarks',
      remarks: 'Remarks',
      installationLandmark: 'Installation Landmark',
      connectionType: 'Connection Type',
      modemRouterSn: 'Modem/Router SN',
      routerModel: 'Router Model',
      installationFee: 'Installation Fee',
      lcpnap: 'LCPNAP',
      port: 'PORT',
      vlan: 'VLAN',
      username: 'Username',
      ipAddress: 'IP Address',
      usageType: 'Usage Type',
      dateInstalled: 'Date Installed',
      visitBy: 'Visit By',
      visitWith: 'Visit With',
      visitWithOther: 'Visit With Other',
      onsiteStatus: 'Onsite Status',
      startTime: 'Start Time',
      endTime: 'End Time',
      duration: 'Duration',
      jobOrderItems: 'Item Used',

      modifiedBy: 'Modified By',
      modifiedDate: 'Modified Date',
      assignedEmail: 'Assigned Tech',
      clientSignature: 'Client Signature',
      setupImage: 'Setup Image',
      speedtestImage: 'Speedtest Image',
      signedContractImage: 'Signed Contract Image',
      boxReadingImage: 'Box Reading Image',
      routerReadingImage: 'Router Reading Image',
      portLabelImage: 'Port Label Image',
      houseFrontPicture: 'House Front Picture',
      clientTagging: 'Client Tagging',
      proofImage: 'Proof Image'
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

    const baseFieldClass = `flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`;
    const labelClass = `w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`;
    const valueClass = `flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`;

    switch (fieldKey) {
      case 'timestamp':
        const tsValue = jobOrder.Create_DateTime || jobOrder.created_at || jobOrder.timestamp;
        if (!tsValue) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Timestamp:</div>
            <div className={valueClass}>{formatDate(tsValue)}</div>
          </div>
        );

      case 'jobOrderNumber':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Job Order #:</div>
            <div className={valueClass}>{jobOrder.id || jobOrder.JobOrder_ID || (applicationData ? 'App-' + applicationData.id : 'N/A')}</div>
          </div>
        );

      case 'referredBy':
        const referredBy = jobOrder.Referred_By || jobOrder.referred_by || applicationData?.referred_by;
        if (!referredBy || referredBy === 'None') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Referred By:</div>
            <div className={valueClass}>{referredBy}</div>
          </div>
        );

      case 'fullName':
        const fullName = getClientFullName();
        if (!fullName || fullName === 'Unknown Client') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Full Name:</div>
            <div className={valueClass}>{fullName}</div>
          </div>
        );

      case 'contactNumber':
        const contactNum = jobOrder.Contact_Number || jobOrder.mobile_number || applicationData?.mobile_number;
        if (!contactNum) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Contact Number:</div>
            <div className={valueClass}>
              {contactNum}
            </div>
          </div>
        );

      case 'secondContactNumber':
        const secondContact = jobOrder.Second_Contact_Number || jobOrder.secondary_mobile_number || applicationData?.secondary_mobile_number;
        if (!secondContact) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Second Contact Number:</div>
            <div className={valueClass}>
              {secondContact}
            </div>
          </div>
        );

      case 'emailAddress':
        const emailAddress = jobOrder.Email_Address || jobOrder.email_address || applicationData?.email_address;
        if (!emailAddress) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Email Address:</div>
            <div className={valueClass}>
              {emailAddress}
            </div>
          </div>
        );

      case 'fullAddress':
        const fullAddr = getClientFullAddress();
        if (!fullAddr || fullAddr === 'No address provided') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Full Address:</div>
            <div className={valueClass}>{fullAddr}</div>
          </div>
        );

      case 'addressCoordinates':
        const coordinates = applicationData?.long_lat || jobOrder.address_coordinates || jobOrder.Address_Coordinates;
        if (!coordinates) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Address Coordinates:</div>
            <div className={valueClass}>{coordinates}</div>
          </div>
        );

      case 'billingStatus':
        const billingStatus = jobOrder.billing_status || jobOrder.Billing_Status;
        if (!billingStatus || billingStatus === 'Not Set') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Billing Status:</div>
            <div className={valueClass}>{billingStatus}</div>
          </div>
        );

      case 'billingDay':
        const billingDayDisp = getBillingDayDisplay(jobOrder.Billing_Day || jobOrder.billing_day);
        if (billingDayDisp === 'Not set') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Billing Day:</div>
            <div className={valueClass}>{billingDayDisp}</div>
          </div>
        );

      case 'choosePlan':
        const plan = jobOrder.Desired_Plan || jobOrder.desired_plan || jobOrder.Choose_Plan || jobOrder.choose_plan || applicationData?.desired_plan;
        if (!plan) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Choose Plan:</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{plan}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingPlanOverlay(true);
                    const allPlans = await planService.getAllPlans();
                    const desiredPlanStr = typeof plan === 'string' ? plan.split('-')[0].trim().toLowerCase() : '';
                    const match = allPlans.find(p =>
                      p.name.toLowerCase() === desiredPlanStr ||
                      (typeof plan === 'string' && plan.toLowerCase().includes(p.name.toLowerCase()))
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
                className={`p-1 rounded transition-colors ${loadingPlanOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                title="View Plan Details"
                disabled={loadingPlanOverlay}
              >
                {loadingPlanOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
              </button>
            </div>
          </div>
        );

      case 'statusRemarks':
        const statusRemarks = jobOrder.Status_Remarks || jobOrder.status_remarks;
        if (!statusRemarks) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Status Remarks:</div>
            <div className={valueClass}>{statusRemarks}</div>
          </div>
        );

      case 'remarks':
        const remarks = jobOrder.Remarks || jobOrder.onsite_remarks;
        if (!remarks) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Remarks:</div>
            <div className={valueClass}>{remarks}</div>
          </div>
        );


      case 'installationLandmark':
        const installationLandmark = jobOrder.Installation_Landmark || jobOrder.installation_landmark || jobOrder.landmark || applicationData?.landmark;
        if (!installationLandmark) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Installation Landmark:</div>
            <div className={valueClass}>{installationLandmark}</div>
          </div>
        );

      case 'connectionType':
        const connType = jobOrder.Connection_Type || jobOrder.connection_type;
        if (!connType) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Connection Type:</div>
            <div className={valueClass}>{connType}</div>
          </div>
        );

      case 'modemRouterSn':
        const sn = jobOrder.Modem_Router_SN || jobOrder.modem_router_sn || jobOrder.Modem_SN || jobOrder.modem_sn;
        if (!sn) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Modem/Router SN:</div>
            <div className={valueClass}>{sn}</div>
          </div>
        );

      case 'routerModel':
        const model = jobOrder.Router_Model || jobOrder.router_model;
        if (!model || model === 'None') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Router Model:</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{model}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingInventoryOverlay(true);
                    const allInventoryRes = await getAllInventoryItems('', 1, 1000);
                    const allInventory = allInventoryRes.data || [];
                    const match = allInventory.find(inv =>
                      inv.item_name.toLowerCase() === model.toLowerCase() ||
                      inv.item_name.toLowerCase().includes(model.toLowerCase()) ||
                      model.toLowerCase().includes(inv.item_name.toLowerCase())
                    );
                    if (match) {
                      setSelectedInventoryForOverlay({
                        item_id: match.id,
                        item_name: match.item_name,
                        item_description: match.item_description,
                        category: match.category_id ? String(match.category_id) : 'Item',
                        quantity_alert: match.quantity_alert,
                        image: match.image_url,
                      });
                    } else {
                      setNotFoundMessage('Inventory details not found for this router model.');
                    }
                  } catch (err) {
                    console.error('Error finding inventory', err);
                  } finally {
                    setLoadingInventoryOverlay(false);
                  }
                }}
                className={`p-1 rounded transition-colors ${loadingInventoryOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                title="View Inventory Details"
                disabled={loadingInventoryOverlay}
              >
                {loadingInventoryOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
              </button>
            </div>
          </div>
        );

      case 'installationFee':
        const fee = jobOrder.Installation_Fee || jobOrder.installation_fee;
        if (fee === null || fee === undefined) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Installation Fee:</div>
            <div className={valueClass}>{formatPrice(fee)}</div>
          </div>
        );

      case 'lcpnap':
        const lcpnap = jobOrder.LCPNAP || jobOrder.lcpnap;
        if (!lcpnap) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>LCPNAP:</div>
            <div className={valueClass}>{lcpnap}</div>
          </div>
        );

      case 'port':
        const port = jobOrder.PORT || jobOrder.Port || jobOrder.port;
        if (!port) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>PORT:</div>
            <div className={valueClass}>{port}</div>
          </div>
        );

      case 'vlan':
        const vlan = jobOrder.VLAN || jobOrder.vlan;
        if (!vlan) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>VLAN:</div>
            <div className={valueClass}>{vlan}</div>
          </div>
        );

      case 'username':
        const username = jobOrder.Username || jobOrder.username || jobOrder.pppoe_username;
        if (!username) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Username:</div>
            <div className={valueClass}>{username}</div>
          </div>
        );

      case 'ipAddress':
        const ip = jobOrder.IP_Address || jobOrder.ip_address || jobOrder.IP || jobOrder.ip;
        if (!ip) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>IP Address:</div>
            <div className={valueClass}>{ip}</div>
          </div>
        );

      case 'usageType':
        const usage = jobOrder.Usage_Type || jobOrder.usage_type;
        if (!usage) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Usage Type:</div>
            <div className={valueClass}>{usage}</div>
          </div>
        );

      case 'dateInstalled':
        const dateInstalled = jobOrder.Date_Installed || jobOrder.date_installed;
        if (!dateInstalled) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Date Installed:</div>
            <div className={valueClass}>
              {formatOnlyDate(dateInstalled)}
            </div>
          </div>
        );

      case 'visitBy':
        const visitBy = jobOrder.Visit_By || jobOrder.visit_by;
        if (!visitBy) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Visit By:</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{visitBy}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingUserOverlay(true);
                    const allUsers = (await userService.getAllUsers()).data || [];
                    const match = allUsers.find(u =>
                      String(u.id) === visitBy ||
                      u.username === visitBy ||
                      (u.first_name + ' ' + u.last_name).toLowerCase() === visitBy.toLowerCase() ||
                      (u.first_name + ' ' + (u.middle_initial ? u.middle_initial + ' ' : '') + u.last_name).toLowerCase() === visitBy.toLowerCase()
                    );
                    if (match) {
                      setSelectedUserForOverlay(match);
                    } else {
                      setNotFoundMessage('User details not found.');
                    }
                  } catch (err) {
                    console.error('Error finding user', err);
                  } finally {
                    setLoadingUserOverlay(false);
                  }
                }}
                className={`p-1 rounded transition-colors ${loadingUserOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                title="View User Details"
                disabled={loadingUserOverlay}
              >
                {loadingUserOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
              </button>
            </div>
          </div>
        );

      case 'visitWith':
        const visitWith = jobOrder.Visit_With || jobOrder.visit_with;
        if (!visitWith || visitWith === 'None') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Visit With:</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{visitWith}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingUserOverlay(true);
                    const allUsers = (await userService.getAllUsers()).data || [];
                    const match = allUsers.find(u =>
                      String(u.id) === visitWith ||
                      u.username === visitWith ||
                      (u.first_name + ' ' + u.last_name).toLowerCase() === visitWith.toLowerCase() ||
                      (u.first_name + ' ' + (u.middle_initial ? u.middle_initial + ' ' : '') + u.last_name).toLowerCase() === visitWith.toLowerCase()
                    );
                    if (match) {
                      setSelectedUserForOverlay(match);
                    } else {
                      setNotFoundMessage('User details not found.');
                    }
                  } catch (err) {
                    console.error('Error finding user', err);
                  } finally {
                    setLoadingUserOverlay(false);
                  }
                }}
                className={`p-1 rounded transition-colors ${loadingUserOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                title="View User Details"
                disabled={loadingUserOverlay}
              >
                {loadingUserOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
              </button>
            </div>
          </div>
        );

      case 'visitWithOther':
        const visitWithOther = jobOrder.Visit_With_Other || jobOrder.visit_with_other;
        if (!visitWithOther || visitWithOther === 'None') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Visit With Other:</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{visitWithOther}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingUserOverlay(true);
                    const allUsers = (await userService.getAllUsers()).data || [];
                    const match = allUsers.find(u =>
                      String(u.id) === visitWithOther ||
                      u.username === visitWithOther ||
                      (u.first_name + ' ' + u.last_name).toLowerCase() === visitWithOther.toLowerCase() ||
                      (u.first_name + ' ' + (u.middle_initial ? u.middle_initial + ' ' : '') + u.last_name).toLowerCase() === visitWithOther.toLowerCase()
                    );
                    if (match) {
                      setSelectedUserForOverlay(match);
                    } else {
                      setNotFoundMessage('User details not found.');
                    }
                  } catch (err) {
                    console.error('Error finding user', err);
                  } finally {
                    setLoadingUserOverlay(false);
                  }
                }}
                className={`p-1 rounded transition-colors ${loadingUserOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                title="View User Details"
                disabled={loadingUserOverlay}
              >
                {loadingUserOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
              </button>
            </div>
          </div>
        );

      case 'onsiteStatus':
        const onsiteStatus = jobOrder.Onsite_Status;
        if (!onsiteStatus || onsiteStatus === 'Not set') return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Onsite Status:</div>
            <div className={`${getStatusColor(onsiteStatus, 'onsite')} flex-1 capitalize`}>
              {onsiteStatus === 'inprogress' ? 'In Progress' : onsiteStatus}
            </div>
          </div>
        );

      case 'startTime':
        const startTime = jobOrder.start_time;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Start Time:</div>
            <div className={valueClass}>{formatDate(startTime)}</div>
          </div>
        );

      case 'endTime':
        const endTime = jobOrder.end_time;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>End Time:</div>
            <div className={valueClass}>{formatDate(endTime)}</div>
          </div>
        );

      case 'duration':
        const st = jobOrder.start_time;
        const et = jobOrder.end_time;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Duration:</div>
            <div className={valueClass}>{calculateDuration(st, et)}</div>
          </div>
        );





      case 'jobOrderItems':
        return (
          <div className={`flex flex-col border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`text-sm mb-2 font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Item Used</div>
            {jobOrder.job_order_items && jobOrder.job_order_items.length > 0 ? (
              <div className={`overflow-x-auto rounded border ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <table className={`min-w-full text-sm text-left ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <thead className={isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'}>
                    <tr>
                      <th className={`px-4 py-2 font-medium border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>Item Name</th>
                      <th className={`px-4 py-2 font-medium border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobOrder.job_order_items.map((item, index) => (
                      <tr key={index} className={isDarkMode ? 'bg-gray-900 border-gray-700 hover:bg-gray-800' : 'bg-white border-gray-200 hover:bg-gray-50'}>
                        <td className={`px-4 py-2 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>{item.item_name}</td>
                        <td className={`px-4 py-2 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={`text-sm italic ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>No items found</div>
            )}
          </div>
        );

      case 'modifiedBy':
        const modifiedBy = jobOrder.Modified_By;
        if (!modifiedBy) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Modified By:</div>
            <div className={valueClass}>{modifiedBy}</div>
          </div>
        );

      case 'modifiedDate':
        if (!jobOrder.Modified_Date) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Modified Date:</div>
            <div className={valueClass}>{formatDate(jobOrder.Modified_Date)}</div>
          </div>
        );

      case 'assignedEmail':
        const assignedEmail = jobOrder.Assigned_Email || jobOrder.assigned_email;
        if (!assignedEmail || assignedEmail === 'Not set') return null;
        const matchedUser = users.find(u => (u.email_address || '').toLowerCase() === assignedEmail.toLowerCase());
        const displayValue = matchedUser
          ? [
              matchedUser.first_name || '',
              matchedUser.middle_initial ? `${matchedUser.middle_initial}.` : '',
              matchedUser.last_name || ''
            ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || assignedEmail
          : assignedEmail;

        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Assigned Tech:</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{displayValue}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingUserOverlay(true);
                    const allUsers = (await userService.getAllUsers()).data || [];
                    const match = allUsers.find(u =>
                      u.email_address?.toLowerCase() === assignedEmail.toLowerCase()
                    );

                    if (match) {
                      setSelectedUserForOverlay(match);
                    } else {
                      setNotFoundMessage('User details not found for this email.');
                    }
                  } catch (err) {
                    console.error('Error finding user', err);
                  } finally {
                    setLoadingUserOverlay(false);
                  }
                }}
                className={`p-1 rounded transition-colors ${loadingUserOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                title="View User Details"
                disabled={loadingUserOverlay}
              >
                {loadingUserOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRightCircle className="w-4 h-4" />}
              </button>
            </div>
          </div>
        );

      case 'clientSignature':
        const clientSignatureImg = jobOrder.client_signature_url || jobOrder.Client_Signature_URL || jobOrder.client_signature || jobOrder.Client_Signature;
        if (!clientSignatureImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Client Signature</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {clientSignatureImg}
              </span>
              {clientSignatureImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(clientSignatureImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'setupImage':
        const setupImg = jobOrder.setup_image_url || jobOrder.Setup_Image_URL || jobOrder.Setup_Image_Url;
        if (!setupImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Setup Image</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {setupImg}
              </span>
              {setupImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(setupImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'speedtestImage':
        const speedtestImg = jobOrder.speedtest_image_url || jobOrder.Speedtest_Image_URL || jobOrder.speedtest_image || jobOrder.Speedtest_Image;
        if (!speedtestImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Speedtest Image</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {speedtestImg}
              </span>
              {speedtestImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(speedtestImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'signedContractImage':
        const contractImg = jobOrder.signed_contract_image_url || jobOrder.Signed_Contract_Image_URL || jobOrder.signed_contract_url || jobOrder.Signed_Contract_URL;
        if (!contractImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Signed Contract Image</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {contractImg}
              </span>
              {contractImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(contractImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'boxReadingImage':
        const boxReadingImg = jobOrder.box_reading_image_url || jobOrder.Box_Reading_Image_URL || jobOrder.box_reading_url || jobOrder.Box_Reading_URL;
        if (!boxReadingImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Box Reading Image</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {boxReadingImg}
              </span>
              {boxReadingImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(boxReadingImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'routerReadingImage':
        const routerReadingImg = jobOrder.router_reading_image_url || jobOrder.Router_Reading_Image_URL || jobOrder.router_reading_url || jobOrder.Router_Reading_URL;
        if (!routerReadingImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Router Reading Image</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {routerReadingImg}
              </span>
              {routerReadingImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(routerReadingImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'portLabelImage':
        const portLabelImg = jobOrder.port_label_image_url || jobOrder.Port_Label_Image_URL || jobOrder.port_label_url || jobOrder.Port_Label_URL;
        if (!portLabelImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Port Label Image</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {portLabelImg}
              </span>
              {portLabelImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(portLabelImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'houseFrontPicture':
        const houseFrontImg = jobOrder.house_front_picture_url || jobOrder.House_Front_Picture_URL || jobOrder.house_front_picture || jobOrder.House_Front_Picture || applicationData?.house_front_picture_url;
        if (!houseFrontImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>House Front Picture</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {houseFrontImg}
              </span>
              {houseFrontImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(houseFrontImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'clientTagging':
        const clientTaggingImg = jobOrder.client_tagging_url || jobOrder.Client_Tagging_URL || jobOrder.client_tagging || jobOrder.Client_Tagging;
        if (!clientTaggingImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Client Tagging</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {clientTaggingImg}
              </span>
              {clientTaggingImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(clientTaggingImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'proofImage':
        const proofImg = jobOrder.proof_image_url || jobOrder.Proof_Image_URL || jobOrder.proof_image || jobOrder.Proof_Image;
        if (!proofImg) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Proof Image</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">
                {proofImg}
              </span>
              {proofImg && (
                <button
                  className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  onClick={() => window.open(proofImg)}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        );

      case 'proofOfBilling':
        const proofOfBilling = applicationData?.proof_of_billing_url;
        if (!proofOfBilling) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Proof of Billing</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">{proofOfBilling}</span>
              <button
                className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                onClick={() => window.open(proofOfBilling)}
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </div>
        );

      case 'governmentValidId':
        const govId = applicationData?.government_valid_id_url;
        if (!govId) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Government ID</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">{govId}</span>
              <button
                className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                onClick={() => window.open(govId)}
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </div>
        );

      case 'secondGovernmentValidId':
        const secondGovId = applicationData?.secondary_government_valid_id_url;
        if (!secondGovId) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Second Government ID</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">{secondGovId}</span>
              <button
                className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                onClick={() => window.open(secondGovId)}
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </div>
        );

      case 'documentAttachment':
        const docAttach = applicationData?.document_attachment_url;
        if (!docAttach) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Document Attachment</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">{docAttach}</span>
              <button
                className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                onClick={() => window.open(docAttach)}
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </div>
        );

      case 'otherIspBill':
        const ispBill = applicationData?.other_isp_bill_url;
        if (!ispBill) return null;
        return (
          <div className={`flex border-b py-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`w-40 text-sm whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Other ISP Bill</div>
            <div className={`flex-1 flex items-center justify-between min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span className="truncate mr-2">{ispBill}</span>
              <button
                className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                onClick={() => window.open(ispBill)}
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={`${
        activeIsMobile
          ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]'
          : 'h-full flex flex-col overflow-hidden md:border-l relative w-full md:w-auto'
      } flex flex-col overflow-hidden ${
        isDarkMode ? 'bg-gray-950 border-white border-opacity-30' : 'bg-gray-50 border-gray-300'
      }`}
      style={!activeIsMobile && window.innerWidth >= 768 ? { width: `${detailsWidth}px` } : undefined}
    >
      {!activeIsMobile && (
        <div
          className={`hidden md:block absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50 ${isDarkMode ? 'hover:bg-orange-500' : 'hover:bg-orange-600'
            }`}
          onMouseDown={handleMouseDownResize}
        />
      )}

      {hasActiveOverlay && (
        <div className="absolute inset-0 z-50 bg-white dark:bg-gray-900 overflow-hidden flex flex-col h-full w-full">
          {loadingPlanOverlay && (
            <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
              <div className="flex flex-col items-center gap-3">
                <p className="loading-dots pt-4">Loading Plan Details</p>
              </div>
            </div>
          )}
          {loadingUserOverlay && (
            <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
              <div className="flex flex-col items-center gap-3">
                <p className="loading-dots pt-4">Loading User Details</p>
              </div>
            </div>
          )}
          {loadingCustomerOverlay && (
            <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
              <div className="flex flex-col items-center gap-3">
                <p className="loading-dots pt-4">Loading Customer Details</p>
              </div>
            </div>
          )}
          {loadingInventoryOverlay && (
            <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
              <div className="flex flex-col items-center gap-3">
                <p className="loading-dots pt-4">Loading Inventory Details</p>
              </div>
            </div>
          )}
          {selectedPlanForOverlay && (
            <React.Suspense fallback={
              <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
                <div className="flex flex-col items-center gap-3">
                  <p className="loading-dots pt-4">Loading Plan Overlay</p>
                </div>
              </div>
            }>
              <div className="w-full h-full relative border-0">
                <PlanListDetails
                  plan={selectedPlanForOverlay}
                  onClose={() => setSelectedPlanForOverlay(null)}
                  isMobile={activeIsMobile}
                />
              </div>
            </React.Suspense>
          )}
          {selectedUserForOverlay && (
            <React.Suspense fallback={
              <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
                <div className="flex flex-col items-center gap-3">
                  <p className="loading-dots pt-4">Loading User Overlay</p>
                </div>
              </div>
            }>
              <div className="w-full h-full relative border-0">
                <UserDetails
                  user={selectedUserForOverlay}
                  onClose={() => setSelectedUserForOverlay(null)}
                  isMobile={activeIsMobile}
                  isDarkMode={isDarkMode}
                  colorPalette={colorPalette}
                />
              </div>
            </React.Suspense>
          )}
          {selectedCustomerForOverlay && (
            <React.Suspense fallback={
              <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
                <div className="flex flex-col items-center gap-3">
                  <p className="loading-dots pt-4">Loading Customer Overlay</p>
                </div>
              </div>
            }>
              <div className="w-full h-full relative border-0">
                <CustomerDetails
                  billingRecord={selectedCustomerForOverlay}
                  onClose={() => setSelectedCustomerForOverlay(null)}
                />
              </div>
            </React.Suspense>
          )}
          {selectedInventoryForOverlay && (
            <React.Suspense fallback={
              <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-white text-gray-500'}`}>
                <div className="flex flex-col items-center gap-3">
                  <p className="loading-dots pt-4">Loading Inventory Overlay</p>
                </div>
              </div>
            }>
              <div className="w-full h-full relative border-0">
                <InventoryDetails
                  item={selectedInventoryForOverlay}
                  onClose={() => setSelectedInventoryForOverlay(null)}
                />
              </div>
            </React.Suspense>
          )}
        </div>
      )}

      <div className={hasActiveOverlay ? 'hidden' : 'block h-full flex flex-col w-full'}>
        <div className={`p-3 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
          }`}>
          <div className="flex items-center flex-1 min-w-0">
            <h2 className={`font-medium truncate ${activeIsMobile ? 'max-w-[200px] text-sm' : ''} ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{getClientFullName()}</h2>
            {loading && <div className={`ml-3 animate-pulse text-sm flex-shrink-0 ${isDarkMode ? 'text-orange-500' : 'text-orange-600'
              }`}>Loading...</div>}
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-y-1">

            {shouldShowEnableTechnicianButton() && (
              <button
                className={`px-2 py-1 rounded-sm flex items-center text-sm font-medium whitespace-nowrap ${technicianEnabled
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                onClick={handleEnableTechnicianClick}
                disabled={technicianEnabled || isEnablingTechnician}
                title={technicianEnabled
                  ? 'The technician can already start this job order'
                  : 'Let the technician start this job order without finishing their older ones first'}
              >
                {isEnablingTechnician && <Loader className="h-3 w-3 mr-1 animate-spin" />}
                <span>{technicianEnabled ? 'Enabled' : (isEnablingTechnician ? 'Enabling...' : 'Enable')}</span>
              </button>
            )}
            {shouldShowApproveButton() && (
              <button
                className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded-sm flex items-center text-sm whitespace-nowrap"
                onClick={handleApproveClick}
                disabled={loading}
              >
                <span>Approve</span>
              </button>
            )}
            {shouldShowFailedButton() && (
              <button
                className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded-sm flex items-center transition-colors text-sm font-medium whitespace-nowrap"
                onClick={handleFailedClick}
                disabled={loading}
              >
                <span>Failed</span>
              </button>
            )}
            {hasPermission('job-order.pre-install') && (
            <button
              className={`text-white px-2 py-1 rounded-sm flex items-center transition-colors text-sm font-medium whitespace-nowrap ${PRE_INSTALLED_UNDER_MAINTENANCE
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-700'}`}
              onClick={handlePreInstalledClick}
              disabled={PRE_INSTALLED_UNDER_MAINTENANCE || loading || preInstalledSaving}
              title={jobOrder.pre_installed
                ? `Already recorded${jobOrder.pre_installed_datetime ? ' on ' + formatDate(jobOrder.pre_installed_datetime) : ''}`
                  + `${jobOrder.preinstalled_updated_by ? ' by ' + jobOrder.preinstalled_updated_by : ''} — click to update`
                : 'Record a pre-installation visit'}
            >
              <span>{jobOrder.pre_installed ? 'Pre Installed ✓' : 'Pre Installed'}</span>
            </button>
            )}
            {shouldShowEditButton() && (
              <button
                className="text-white px-2 py-1 rounded-sm flex items-center transition-colors text-sm font-medium whitespace-nowrap"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                }}
                onClick={handleDoneClick}
                disabled={loading}
              >
                <span>Edit</span>
              </button>
            )}

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

            {!(userRole === 'agent' || String(roleId) === '4') && (
              <div className="relative">
                <button
                  onClick={() => setShowFieldSettings(!showFieldSettings)}
                  className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
                  title="Field Settings"
                >
                  <Settings size={16} />
                </button>
                {showFieldSettings && (
                  <div className={`absolute right-0 mt-2 w-64 sm:w-80 rounded-lg shadow-lg border z-50 max-h-80 overflow-y-auto ${isDarkMode
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
                      <div className={`text-xs mb-2 px-2 hidden sm:block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
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
            )}

            {hasPermission('job-order.attachment') && (
              <button
                onClick={() => setIsAttachmentModalOpen(true)}
                className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
                title="Attachments"
              >
                <Paperclip size={18} />
              </button>
            )}

            <button
              onClick={onClose}
              className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div className={`p-3 m-3 rounded ${isDarkMode
            ? 'bg-red-900 bg-opacity-20 border border-red-700 text-red-400'
            : 'bg-red-100 border border-red-300 text-red-700'
            }`}>
            {error}
          </div>
        )}

        {enableTechnicianError && (
          <div className={`p-3 m-3 rounded ${isDarkMode
            ? 'bg-red-900 bg-opacity-20 border border-red-700 text-red-400'
            : 'bg-red-100 border border-red-300 text-red-700'
            }`}>
            {enableTechnicianError}
          </div>
        )}

        <div className={`flex-1 overflow-y-auto w-full ${activeIsMobile ? 'pb-24' : ''}`}>
          <div className={`max-w-2xl mx-auto py-4 px-3 sm:py-6 sm:px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
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
                      <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>{relatedDataCounts[section.key] || 0}</span>
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

      {/* Expanded Modal for Related Data */}
      {expandedModalSection && (
        <div className="absolute inset-0 flex flex-col" style={{ backgroundColor: isDarkMode ? '#111827' : '#ffffff', zIndex: 9999 }}>
          {/* Modal Header */}
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
            }`}>
            <div className="flex items-center space-x-3">
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                {expandedModalSection === 'detailsUpdateLogs' && 'All Related Details Update Logs'}
              </h2>
              <span className={`text-xs px-2 py-1 rounded ${isDarkMode
                ? 'bg-gray-600 text-white'
                : 'bg-gray-300 text-gray-900'
                }`}>
                {relatedDataCounts[expandedModalSection]} items
              </span>
            </div>
            <button
              onClick={handleExpandModalClose}
              className={`p-2 rounded transition-colors ${isDarkMode
                ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                }`}
            >
              <X size={20} />
            </button>
          </div>

          {/* Modal Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <RelatedDataTable
              data={fullRelatedData[expandedModalSection] || []}
              columns={relatedDataColumns[expandedModalSection as keyof typeof relatedDataColumns]}
              isDarkMode={isDarkMode}
            />
          </div>
        </div>
      )}

      <JobOrderDoneFormModal
        isOpen={isDoneModalOpen}
        onClose={() => setIsDoneModalOpen(false)}
        onSave={handleDoneSave}
        jobOrderData={jobOrder}
      />

      <JobOrderDoneFormTechModal
        isOpen={isDoneTechModalOpen}
        onClose={() => setIsDoneTechModalOpen(false)}
        onSave={handleDoneSave}
        jobOrderData={jobOrder}
      />

      <JobOrderEditFormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleEditSave}
        jobOrderData={jobOrder}
      />

      <JOAttachmentModal
        isOpen={isAttachmentModalOpen}
        onClose={() => setIsAttachmentModalOpen(false)}
        onSave={(formData) => {
          handleDoneSave(formData);
          setIsAttachmentModalOpen(false);
        }}
        jobOrderData={jobOrder}
      />

      <ApprovalConfirmationModal
        isOpen={isApprovalModalOpen}
        onClose={() => setIsApprovalModalOpen(false)}
        onConfirm={handleApproveConfirm}
        loading={loading}
      />

      <ConfirmationModal
        isOpen={isFailedModalOpen}
        title="Confirm Status Update"
        message="Are you sure you want to mark the billing status of this Job Order as Failed?"
        confirmText="Confirm"
        cancelText="Cancel"
        onConfirm={handleFailedConfirm}
        onCancel={() => setIsFailedModalOpen(false)}
      />

      <PreInstalledModal
        isOpen={isPreInstalledModalOpen}
        saving={preInstalledSaving}
        initialRemarks={jobOrder.pre_remarks}
        onSave={handlePreInstalledSave}
        onCancel={() => setIsPreInstalledModalOpen(false)}
      />

      <ConfirmationModal
        isOpen={showSuccessModal}
        title="Success"
        message={successMessage}
        confirmText="OK"
        cancelText="Close"
        onConfirm={() => {
          setShowSuccessModal(false);
          if (shouldCloseOnSuccess) {
            onClose();
          }
        }}
        onCancel={() => {
          setShowSuccessModal(false);
          if (shouldCloseOnSuccess) {
            onClose();
          }
        }}
      />

      {/* Loading Modal */}
      {showLoadingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className={`rounded-lg shadow-2xl w-full max-w-md mx-4 p-8 ${isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}>
            <div className="flex flex-col items-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-t-2 mb-4"
                style={{ borderColor: colorPalette?.primary || '#7c3aed' }}
              ></div>
              <h2 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Processing Approval</h2>
              <p className={`text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Please wait while we approve the job order and create customer records...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal */}
      <ConfirmationModal
        isOpen={showErrorModal}
        title="Error"
        message={errorMessage}
        confirmText="OK"
        cancelText="Close"
        onConfirm={() => setShowErrorModal(false)}
        onCancel={() => setShowErrorModal(false)}
      />

      {/* Not Found Modal */}
      <React.Suspense fallback={null}>
        <NotFoundModal
          isOpen={!!notFoundMessage}
          onClose={() => setNotFoundMessage(null)}
          message={notFoundMessage || ''}
        />
      </React.Suspense>
    </div>
  );
};

export default JobOrderDetails;

