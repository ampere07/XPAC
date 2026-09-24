import React, { useState, useEffect, useRef } from 'react';
import {
  X, ExternalLink, Edit, Settings, CircleArrowRight, Loader
} from 'lucide-react';
import ServiceOrderEditModal from '../modals/ServiceOrderEditModal';
import { getRelatedDetailsUpdateLogs } from '../services/serviceOrderService';
import RelatedDataTable from './RelatedDataTable';
import { relatedDataColumns } from '../config/relatedDataColumns';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import BillingDetails from './CustomerDetails';
import { BillingDetailRecord } from '../types/billing';
import { planService, Plan } from '../services/planService';
import { userService } from '../services/userService';
import { useUserDirectory } from '../hooks/useUserDirectory';
import { resolveUserDisplayName } from '../utils/userDisplay';
import { User as UserType } from '../types/api';
import { getCustomerDetail, convertCustomerDataToBillingDetail } from '../services/customerDetailService';
import { getAllInventoryItems } from '../services/inventoryItemService';
import { accountStatusFrom, sessionStatusFrom } from '../utils/onlineStatus';
import { usePermissions } from '../hooks/usePermissions';

const PlanListDetails = React.lazy(() => import('./PlanListDetails'));
const UserDetails = React.lazy(() => import('./UserDetails'));
const InventoryDetails = React.lazy(() => import('./InventoryDetails'));
const NotFoundModal = React.lazy(() => import('../modals/NotFoundModal'));

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
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
    return dateString;
  }
};

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
    affiliate: string;
    username: string;
    /** From technical_details, falling back to the account's install job order. */
    pppoePassword: string;
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
    newRouterSn?: string;
    newLcpnap?: string;
    newPlan?: string;
    clientSignatureUrl?: string;
    image1Url?: string;
    image2Url?: string;
    image3Url?: string;
    start_time?: string | null;
    end_time?: string | null;
  };
  onClose: () => void;
  onRefresh?: () => void;
  isMobile?: boolean;
}

const ServiceOrderDetails: React.FC<ServiceOrderDetailsProps> = ({ serviceOrder, onClose, onRefresh, isMobile = false }) => {
  // service_orders stores the actor as an email string, so names come from the shared
  // (cached) user directory rather than a per-record lookup.
  const userDirectory = useUserDirectory();

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

  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isTechEditMode, setIsTechEditMode] = useState<boolean>(false);
  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  const [selectedPlanForOverlay, setSelectedPlanForOverlay] = useState<Plan | null>(null);
  const [loadingPlanOverlay, setLoadingPlanOverlay] = useState(false);
  const [selectedUserForOverlay, setSelectedUserForOverlay] = useState<UserType | null>(null);
  const [loadingUserOverlay, setLoadingUserOverlay] = useState(false);
  const [selectedCustomerForOverlay, setSelectedCustomerForOverlay] = useState<BillingDetailRecord | null>(null);
  const [loadingCustomerOverlay, setLoadingCustomerOverlay] = useState(false);
  const [selectedInventoryForOverlay, setSelectedInventoryForOverlay] = useState<any | null>(null);
  const [loadingInventoryOverlay, setLoadingInventoryOverlay] = useState(false);
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null);

  // Related details update logs
  const [relatedData, setRelatedData] = useState<Record<string, any[]>>({ detailsUpdateLogs: [] });
  const [fullRelatedData, setFullRelatedData] = useState<Record<string, any[]>>({ detailsUpdateLogs: [] });
  const [relatedDataCounts, setRelatedDataCounts] = useState<Record<string, number>>({ detailsUpdateLogs: 0 });
  const [expandedModalSection, setExpandedModalSection] = useState<string | null>(null);

  const fetchRelatedData = async () => {
    if (!serviceOrder.id) return;
    try {
      const result = await getRelatedDetailsUpdateLogs(serviceOrder.id);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceOrder.id]);

  const handleExpandModalOpen = (section: string) => {
    setExpandedModalSection(section);
  };

  const handleExpandModalClose = () => {
    setExpandedModalSection(null);
  };

  const hasActiveOverlay = !!selectedPlanForOverlay || !!selectedUserForOverlay || loadingPlanOverlay || loadingUserOverlay || !!selectedCustomerForOverlay || loadingCustomerOverlay || !!selectedInventoryForOverlay || loadingInventoryOverlay;

  const FIELD_VISIBILITY_KEY = 'serviceOrderDetailsFieldVisibility';
  const FIELD_ORDER_KEY = 'serviceOrderDetailsFieldOrder';

  const defaultFields = [
    'ticketId',
    'timestamp',
    'accountNumber',
    'dateInstalled',
    'fullName',
    'contactNumber',
    'fullAddress',
    'houseFrontPicture',
    'emailAddress',
    'plan',
    'affiliate',
    'username',
    'pppoePassword',
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
    'repairCategory',
    'newRouterSn',
    'newLcpnap',
    'newPlan',
    'image1Url',
    'image2Url',
    'image3Url',
    'clientSignatureUrl',
    'startTime',
    'endTime',
    'duration',
    'serviceCharge'
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

  /**
   * Folds fields added to defaultFields since the user last reordered back into their saved order.
   *
   * Each missing field is spliced in after its nearest preceding default neighbour that survived
   * in the saved order, rather than appended — so PPPOE Password lands right after Username where
   * the default layout puts it, instead of alone at the bottom of the panel. Saved entries are
   * never dropped, so a user's own ordering is preserved as-is.
   */
  const mergeFieldOrder = (saved: string[]): string[] => {
    const result = [...saved];

    defaultFields.forEach((field, index) => {
      if (result.includes(field)) return;

      let insertAt = result.length;
      for (let i = index - 1; i >= 0; i--) {
        const anchor = result.indexOf(defaultFields[i]);
        if (anchor !== -1) {
          insertAt = anchor + 1;
          break;
        }
      }
      result.splice(insertAt, 0, field);
    });

    return result;
  };

  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(FIELD_ORDER_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? mergeFieldOrder(parsed) : defaultFields;
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
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
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


  const { can } = usePermissions();

  // One answer for every role, from config/permissions.ts: the seeded role's
  // table (as the web draws it) or a custom role's server-resolved list.
  const hasPermission = (permission: string): boolean => can(permission);

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

  const handleEditClick = () => {
    if (hasPermission('service-order.admin-edit')) {
      setIsTechEditMode(false);
      setIsEditModalOpen(true);
    } else if (hasPermission('service-order.tech-edit')) {
      setIsTechEditMode(true);
      setIsEditModalOpen(true);
    }
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
  };

  const handleSaveEdit = (formData: any) => {
    setIsEditModalOpen(false);
    // Trigger refresh after a short delay to ensure modal closes first
    setTimeout(() => {
      if (onRefresh) {
        onRefresh();
      }
    }, 100);
  };


  const getFieldLabel = (fieldKey: string): string => {
    const labels: Record<string, string> = {
      ticketId: 'Ticket ID',
      timestamp: 'Timestamp',
      accountNumber: 'Account No.',
      dateInstalled: 'Date Installed',
      fullName: 'Full Name',
      contactNumber: 'Contact Number',
      fullAddress: 'Full Address',
      houseFrontPicture: 'House Front Picture',
      emailAddress: 'Email Address',
      plan: 'Plan',
      affiliate: 'Affiliate',
      username: 'Username',
      pppoePassword: 'PPPOE Password',
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
      newPlan: 'New Plan',
      image1Url: 'Time In Image',
      image2Url: 'Modem Setup Image',
      image3Url: 'Time Out Image',
      clientSignatureUrl: 'Client Signature',
      startTime: 'Start Time',
      endTime: 'End Time',
      duration: 'Duration',
      serviceCharge: 'Service Charge'
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

  const formatDateTime = (dateStr?: string | null): string => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleString();
    } catch (e) {
      return dateStr;
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

  const getStatusColor = (status: string | undefined, type: 'support' | 'visit'): string => {
    if (!status) return 'text-gray-400';

    if (type === 'support') {
      switch (status.toLowerCase()) {
        case 'resolved':
        case 'completed':
          return 'text-green-400';
        case 'in-progress':
        case 'in progress':
          return 'text-blue-400';
        case 'pending':
          return 'text-orange-400';
        case 'closed':
        case 'cancelled':
          return 'text-gray-400';
        default:
          return 'text-gray-400';
      }
    } else {
      switch (status.toLowerCase()) {
        case 'completed':
          return 'text-green-400';
        case 'scheduled':
        case 'reschedule':
        case 'in progress':
          return 'text-blue-400';
        case 'pending':
          return 'text-orange-400';
        case 'cancelled':
        case 'failed':
          return 'text-red-500';
        default:
          return 'text-gray-400';
      }
    }
  };

  const renderField = (label: string, value: any) => {
    if (!value ||
      value === '-' ||
      value === 'Not assigned' ||
      value === 'Not provided' ||
      value === 'None' ||
      value === 'Not specified' ||
      value === 'Unknown Client' ||
      value === 'No address provided' ||
      value === 'Not Set' ||
      value === 'Not scheduled') return null;
    return (
      <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
        }`}>
        <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>{label}</div>
        <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>
          {value}
        </div>
      </div>
    );
  };

  const renderImageField = (label: string, url: string | undefined, displayText: string) => {
    if (!url) return null;
    return (
      <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
        }`}>
        <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>{label}</div>
        <div className={`flex-1 flex items-center min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>
          <span className="truncate mr-2" title={url}>
            {displayText}
          </span>
          <button
            className={`flex-shrink-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}
            onClick={() => window.open(url, '_blank')}
          >
            <ExternalLink size={16} />
          </button>
        </div>
      </div>
    );
  };

  const renderFieldContent = (fieldKey: string) => {
    if (!fieldVisibility[fieldKey]) return null;

    switch (fieldKey) {
      case 'ticketId':
        return renderField('Ticket ID', serviceOrder.ticketId);
      case 'timestamp':
        return renderField('Timestamp', formatDate(serviceOrder.timestamp));
      case 'accountNumber':
        const accInfo = [serviceOrder.accountNumber, serviceOrder.fullName, serviceOrder.fullAddress].filter(val =>
          val &&
          val !== 'Not provided' &&
          val !== 'Unknown Client' &&
          val !== 'No address provided' &&
          val !== '-'
        );
        if (accInfo.length === 0) return null;
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Account No.</div>
            <div className="text-red-500 flex-1 flex items-center">
              <span>{accInfo.join(' | ')}</span>
              <button 
                onClick={async () => {
                  if (!serviceOrder.accountNumber || serviceOrder.accountNumber === 'Not provided') {
                    alert('No valid account number available.');
                    return;
                  }
                  try {
                    setLoadingCustomerOverlay(true);
                    const details = await getCustomerDetail(serviceOrder.accountNumber);
                    
                    if (details) {
                      setSelectedCustomerForOverlay(convertCustomerDataToBillingDetail(details));
                    } else {
                      setNotFoundMessage('Customer details not found for this account.');
                    }
                  } catch (err) {
                    console.error('Error finding customer', err);
                    alert('Error loading customer details.');
                  } finally {
                    setLoadingCustomerOverlay(false);
                  }
                }}
                className={`ml-2 p-1 rounded transition-colors ${loadingCustomerOverlay ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-800 hover:text-white' : 'hover:bg-gray-200 hover:text-gray-900'} ${selectedCustomerForOverlay ? (colorPalette?.primary ? 'text-[' + colorPalette.primary + ']' : 'text-black dark:text-white') : (isDarkMode ? 'text-gray-400' : 'text-gray-600')}`}
                title="View Customer Details"
                disabled={loadingCustomerOverlay}
              >
                {loadingCustomerOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
              </button>
            </div>
          </div>
        );
      case 'dateInstalled':
        return renderField('Date Installed', formatDate(serviceOrder.dateInstalled));
      case 'fullName':
        return renderField('Full Name', serviceOrder.fullName);
      case 'contactNumber':
        return renderField('Contact Number', serviceOrder.contactNumber);
      case 'fullAddress':
        return renderField('Full Address', serviceOrder.fullAddress);
      case 'houseFrontPicture':
        return renderImageField('House Front Picture', serviceOrder.houseFrontPicture, serviceOrder.houseFrontPicture);
      case 'emailAddress':
        return renderField('Email Address', serviceOrder.emailAddress);
      case 'plan':
        const valuePlan = serviceOrder.plan;
        if (!valuePlan || valuePlan === '-' || valuePlan === 'None' || valuePlan === 'Not specified') return null;
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Plan</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{valuePlan}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingPlanOverlay(true);
                    const allPlans = await planService.getAllPlans();
                    const desiredPlanStr = typeof valuePlan === 'string' ? valuePlan.split('-')[0].trim().toLowerCase() : '';
                    const match = allPlans.find(p => 
                      p.name.toLowerCase() === desiredPlanStr ||
                      (typeof valuePlan === 'string' && valuePlan.toLowerCase().includes(p.name.toLowerCase()))
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
                {loadingPlanOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
              </button>
            </div>
          </div>
        );
      case 'affiliate':
        return renderField('Affiliate', serviceOrder.affiliate);
      case 'username':
        return renderField('Username', serviceOrder.username);
      // Rendered directly instead of through renderField, which drops empty values: an account
      // with no PPPoE password on record needs to show that, not silently omit the row.
      case 'pppoePassword':
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>PPPOE Password</div>
            <div className={`flex-1 font-mono ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              {serviceOrder.pppoePassword || '-'}
            </div>
          </div>
        );
      case 'connectionType':
        return renderField('Connection Type', serviceOrder.connectionType);
      case 'routerModemSN':
        const valueRouterSN = serviceOrder.routerModemSN;
        if (!valueRouterSN || valueRouterSN === '-' || valueRouterSN === 'None' || valueRouterSN === 'Not specified') return null;
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Router/Modem SN</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{valueRouterSN}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingInventoryOverlay(true);
                    const allInventoryRes = await getAllInventoryItems('', 1, 1000);
                    const allInventory = allInventoryRes.data || [];
                    const match = allInventory.find(inv => 
                      inv.item_name.toLowerCase() === valueRouterSN.toLowerCase() ||
                      inv.item_name.toLowerCase().includes(valueRouterSN.toLowerCase()) ||
                      valueRouterSN.toLowerCase().includes(inv.item_name.toLowerCase())
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
                      setNotFoundMessage('Inventory details not found for this router/modem SN.');
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
                {loadingInventoryOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
              </button>
            </div>
          </div>
        );
      case 'lcp':
        return renderField('LCP', serviceOrder.lcp);
      case 'nap':
        return renderField('NAP', serviceOrder.nap);
      case 'port':
        return renderField('PORT', serviceOrder.port);
      case 'vlan':
        return renderField('VLAN', serviceOrder.vlan);
      case 'concern':
        return renderField('Concern', serviceOrder.concern);
      case 'concernRemarks':
        return renderField('Concern Remarks', serviceOrder.concernRemarks);
      case 'visitStatus':
        const vStatus = serviceOrder.visitStatus;
        if (!vStatus || vStatus === '-' || vStatus === 'Not set') return null;
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Visit Status</div>
            <div className={`flex-1 font-bold uppercase ${getStatusColor(vStatus, 'visit')
              }`}>
              {vStatus}
            </div>
          </div>
        );
      case 'visitBy':
      case 'visitWith':
      case 'visitWithOther':
        let visitValue = '';
        let visitLabel = '';
        if (fieldKey === 'visitBy') { visitValue = serviceOrder.visitBy; visitLabel = 'Visit By'; }
        if (fieldKey === 'visitWith') { visitValue = serviceOrder.visitWith; visitLabel = 'Visit With'; }
        if (fieldKey === 'visitWithOther') { visitValue = serviceOrder.visitWithOther; visitLabel = 'Visit With Other'; }
        
        if (!visitValue || visitValue === '-' || visitValue === 'None' || visitValue === 'Not specified') return null;
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{visitLabel}</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{visitValue}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingUserOverlay(true);
                    const allUsers = (await userService.getAllUsers()).data || [];
                    const match = allUsers.find(u => 
                      String(u.id) === visitValue ||
                      u.username === visitValue ||
                      (u.first_name + ' ' + u.last_name).toLowerCase() === visitValue.toLowerCase() ||
                      (u.first_name + ' ' + (u.middle_initial ? u.middle_initial + ' ' : '') + u.last_name).toLowerCase() === visitValue.toLowerCase()
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
                {loadingUserOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
              </button>
            </div>
          </div>
        );
      case 'visitRemarks':
        return renderField('Visit Remarks', serviceOrder.visitRemarks);
      case 'modifiedBy':
        return renderField('Modified By', resolveUserDisplayName(serviceOrder.modifiedBy, userDirectory, serviceOrder.modifiedBy));
      case 'modifiedDate':
        return renderField('Modified Date', formatDate(serviceOrder.modifiedDate));
      case 'requestedBy':
        return renderField('Requested by', resolveUserDisplayName(serviceOrder.requestedBy, userDirectory, serviceOrder.requestedBy));
      case 'assignedEmail':
        const assignedEmail = serviceOrder.assignedEmail;
        if (!assignedEmail || assignedEmail === '-' || assignedEmail === 'Not set' || assignedEmail === 'Not specified') return null;
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Assigned Email</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{assignedEmail}</span>
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
                {loadingUserOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
              </button>
            </div>
          </div>
        );
      case 'supportRemarks':
        return renderField('Support Remarks', serviceOrder.supportRemarks);
      case 'supportStatus':
        const sStatus = serviceOrder.supportStatus;
        if (!sStatus || sStatus === '-' || sStatus === 'Not set') return null;
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'
            }`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Support Status</div>
            <div className={`flex-1 font-bold uppercase ${getStatusColor(sStatus, 'support')
              }`}>
              {sStatus}
            </div>
          </div>
        );
      case 'repairCategory':
        return renderField('Repair Category', serviceOrder.repairCategory);
      case 'newRouterSn':
        const valueNewRouterSn = serviceOrder.newRouterSn;
        if (!valueNewRouterSn || valueNewRouterSn === '-' || valueNewRouterSn === 'None' || valueNewRouterSn === 'Not specified') return null;
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>New Router SN</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{valueNewRouterSn}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingInventoryOverlay(true);
                    const allInventoryRes = await getAllInventoryItems('', 1, 1000);
                    const allInventory = allInventoryRes.data || [];
                    const match = allInventory.find(inv => 
                      inv.item_name.toLowerCase() === valueNewRouterSn.toLowerCase() ||
                      inv.item_name.toLowerCase().includes(valueNewRouterSn.toLowerCase()) ||
                      valueNewRouterSn.toLowerCase().includes(inv.item_name.toLowerCase())
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
                      setNotFoundMessage('Inventory details not found for this router SN.');
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
                {loadingInventoryOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
              </button>
            </div>
          </div>
        );
      case 'newLcpnap':
        return renderField('New LCP/NAP', serviceOrder.newLcpnap);
      case 'newPlan':
        const valueNewPlan = serviceOrder.newPlan;
        if (!valueNewPlan || valueNewPlan === '-' || valueNewPlan === 'None' || valueNewPlan === 'Not specified') return null;
        return (
          <div className={`flex py-2 ${isDarkMode ? 'border-b border-gray-800' : 'border-b border-gray-300'}`}>
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>New Plan</div>
            <div className={`flex-1 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              <span>{valueNewPlan}</span>
              <button
                onClick={async () => {
                  try {
                    setLoadingPlanOverlay(true);
                    const allPlans = await planService.getAllPlans();
                    const desiredPlanStr = typeof valueNewPlan === 'string' ? valueNewPlan.split('-')[0].trim().toLowerCase() : '';
                    const match = allPlans.find(p => 
                      p.name.toLowerCase() === desiredPlanStr ||
                      (typeof valueNewPlan === 'string' && valueNewPlan.toLowerCase().includes(p.name.toLowerCase()))
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
                {loadingPlanOverlay ? <Loader className="w-4 h-4 animate-spin" /> : <CircleArrowRight size={16} />}
              </button>
            </div>
          </div>
        );
      case 'image1Url':
        return renderImageField('Time In Image', serviceOrder.image1Url, 'View Image');
      case 'image2Url':
        return renderImageField('Modem Setup Image', serviceOrder.image2Url, 'View Image');
      case 'image3Url':
        return renderImageField('Time Out Image', serviceOrder.image3Url, 'View Image');
      case 'clientSignatureUrl':
        return renderImageField('Client Signature', serviceOrder.clientSignatureUrl, 'View Signature');
      case 'startTime':
        return renderField('Start Time', formatDateTime(serviceOrder.start_time));
      case 'endTime':
        return renderField('End Time', formatDateTime(serviceOrder.end_time));
      case 'duration':
        if (!serviceOrder.start_time || !serviceOrder.end_time) return null;
        return renderField('Duration', calculateDuration(serviceOrder.start_time, serviceOrder.end_time));
      case 'serviceCharge':
        const sCharge = serviceOrder.serviceCharge;
        if (!sCharge || sCharge === '-' || sCharge === '0' || sCharge === '0.00' || sCharge === '₱0.00') return null;
        return (
          <div className="flex py-2">
            <div className={`w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Service Charge</div>
            <div className={`flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{sCharge}</div>
          </div>
        );
      default:
        return null;
    }
  };

  // NOTE: there was a second render path here, gated on a `showCustomerDetails` flag that
  // nothing ever set, which opened Customer Details on a record built from the service
  // order alone — with status and onlineStatus hard-coded to 'Unknown' and balance to 0.
  // It has been removed rather than left as a template for the next screen to copy: the
  // "View Customer Details" arrow beside Account No. is the only way this panel opens, and
  // it fetches the real account (see convertCustomerDataToBillingDetail above), so
  // connectivity comes from RADIUS rather than from a placeholder.

  return (
    <div
      className={`${
        activeIsMobile
          ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]'
          : 'h-full flex flex-col overflow-hidden md:border-l relative w-full md:w-auto'
      } flex flex-col overflow-hidden ${
        isDarkMode ? 'bg-gray-950 border-white border-opacity-30' : 'bg-white border-gray-300'
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
      <div className={`p-3 flex items-center justify-between border-b ${isDarkMode
        ? 'bg-gray-800 border-gray-700'
        : 'bg-gray-100 border-gray-200'
        }`}>
        <div className="flex items-center">
          <h2 className={`font-medium truncate ${activeIsMobile ? 'max-w-[200px] text-sm' : 'max-w-md'} ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{serviceOrder.accountNumber} | {serviceOrder.fullName} | {serviceOrder.contactAddress}</h2>
        </div>

        <div className="flex items-center space-x-3">

          {serviceOrder.supportStatus?.toLowerCase() !== 'resolved' && (hasPermission('service-order.admin-edit') || hasPermission('service-order.tech-edit')) && (
            <button
              className="text-white px-3 py-1 rounded-sm flex items-center disabled:opacity-50"
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
              onClick={handleEditClick}
            >
              <Edit size={16} className="mr-1" />
              <span>Edit</span>
            </button>
          )}

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

          <button
            onClick={onClose}
            className={isDarkMode ? 'hover:text-white text-gray-400' : 'hover:text-gray-900 text-gray-600'}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto w-full ${activeIsMobile ? 'pb-24' : ''}`}>
        <div className={`mx-auto py-1 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-white'
          }`}>
          <div className="space-y-1">
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

      {/* Expanded Modal for Related Data */}
      {expandedModalSection && (
        <div className="absolute inset-0 flex flex-col" style={{ backgroundColor: isDarkMode ? '#111827' : '#ffffff', zIndex: 9999 }}>
          {/* Modal Header */}
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
            <div className="flex items-center space-x-3">
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {expandedModalSection === 'detailsUpdateLogs' && 'All Related Details Update Logs'}
              </h2>
              <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>
                {relatedDataCounts[expandedModalSection]} items
              </span>
            </div>
            <button
              onClick={handleExpandModalClose}
              className={`p-2 rounded transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'}`}
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
            <div className="w-full h-full relative border-0">
              <BillingDetails
                billingRecord={selectedCustomerForOverlay}
                onClose={() => setSelectedCustomerForOverlay(null)}
              />
            </div>
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

      {isEditModalOpen && (
        <ServiceOrderEditModal
          isOpen={isEditModalOpen}
          onClose={handleCloseEditModal}
          onSave={handleSaveEdit}
          serviceOrderData={serviceOrder}
          isTech={isTechEditMode}
        />
      )}
      
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

export default ServiceOrderDetails;
