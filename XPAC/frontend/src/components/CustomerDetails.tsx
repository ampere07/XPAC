import React, { useState, useEffect, useRef, Suspense, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, Paperclip, Wrench, Edit, ChevronLeft, ChevronRight as ChevronRightNav, Maximize2, X, ExternalLink, Settings, Circle, CircleArrowRight, Loader2, Download, Clock } from 'lucide-react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import TransactConfirmationModal from '../modals/TransactConfirmationModal';
import TransactionFormModal from '../modals/TransactionFormModal';
import PrepaidOverrideModal from '../modals/PrepaidOverrideModal';
import StaggeredInstallationFormModal from '../modals/StaggeredInstallationFormModal';
import DiscountFormModal from '../modals/DiscountFormModal';
import SORequestFormModal from '../modals/SORequestFormModal';
import CustomerDetailsEditModal from '../modals/CustomerDetailsEditModal';
import CustomerAttachmentModal from '../modals/CustomerAttachmentModal';
import RelatedDataTable from './RelatedDataTable';
import { relatedDataColumns } from '../config/relatedDataColumns';
import { BillingDetailRecord } from '../types/billing';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { customerDetailUpdateService } from '../services/customerDetailUpdateService';
import { userService } from '../services/userService';
import { relatedDataService } from '../services/relatedDataService';
import SOADetails from './SOADetails';
import InvoiceDetails from './InvoiceDetails';
import ServiceOrderDetails from './ServiceOrderDetails';
import PaymentPortalDetails from './PaymentPortalDetails';
import TransactionListDetails from './TransactionListDetails';
import * as lcpnapService from '../services/lcpnapService';
import { transformServiceOrder } from '../store/serviceOrderStore';
import apiClient from '../config/api';
import { getOnlineStatusInfo } from '../utils/onlineStatus';
import { usePermissions } from '../hooks/usePermissions';

// Break circular dependency with lazy loading
const LcpNapLocationDetails = React.lazy(() => import('./LcpNapLocationDetails'));

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

/** Placeholder for always-rendered fields that hold no value. */
const NOT_SET = 'Not Set';

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch (e) {
    return dateString;
  }
};

const formatDateTime = (dateString: string | null | undefined): string => {
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
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const strTime = hours + ':' + minutes + ' ' + ampm;

    return `${mm}/${dd}/${yyyy} ${strTime}`;
  } catch (e) {
    return dateString;
  }
};

interface OnlineStatusRecord {
  id: string;
  status: string;
  accountNo: string;
  username: string;
  group: string;
  splynxId: string;
}

interface BillingDetailsProps {
  billingRecord: BillingDetailRecord;
  onlineStatusRecords?: OnlineStatusRecord[];
  onClose?: () => void;
  onRefresh?: () => Promise<void> | void;
  refreshKey?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onExpandSection?: (sectionKey: string, title: string, data: any[], columns: any[], count: number) => void;
}

const BillingDetails: React.FC<BillingDetailsProps> = ({
  billingRecord,
  onlineStatusRecords = [],
  onClose,
  onRefresh,
  refreshKey,
  onPrevious,
  onNext,
  onExpandSection
}) => {

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  const { can } = usePermissions();

  // One answer for every role, from config/permissions.ts: the seeded role's
  // table (as the web draws it) or a custom role's server-resolved list.
  const hasPermission = (permission: string): boolean => can(permission);

  const [selectedSOARecord, setSelectedSOARecord] = useState<any>(null);
  const [loadingSOARecord, setLoadingSOARecord] = useState(false);

  const handleSOARowClick = async (row: any) => {
    if (!row || !row.id) return;
    try {
      setLoadingSOARecord(true);
      const response = await relatedDataService.getStatementOfAccountById(row.id);
      if (response.success && response.data) {
        setSelectedSOARecord(response.data);
      } else {
        console.error('Failed to fetch SOA details:', response.message);
      }
    } catch (error) {
      console.error('Error fetching SOA details:', error);
    } finally {
      setLoadingSOARecord(false);
    }
  };

  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  const handleInvoiceRowClick = async (row: any) => {
    const id = row?.id || row?.invoice_id;
    if (!id) return;
    try {
      setLoadingInvoice(true);
      const response = await relatedDataService.getInvoiceById(id);
      if (response.success && response.data) {
        setSelectedInvoice(response.data);
      } else {
        console.error('Failed to fetch invoice details:', response.message);
      }
    } catch (error) {
      console.error('Error fetching invoice details:', error);
    } finally {
      setLoadingInvoice(false);
    }
  };

  const [selectedPaymentPortalLog, setSelectedPaymentPortalLog] = useState<any>(null);
  const [loadingPaymentPortalLog, setLoadingPaymentPortalLog] = useState(false);

  const handlePaymentPortalRowClick = async (row: any) => {
    const id = row?.id || row?.log_id;
    if (!id) return;
    try {
      setLoadingPaymentPortalLog(true);
      const response = await relatedDataService.getPaymentPortalLogById(id);
      if (response.success && response.data) {
        setSelectedPaymentPortalLog(response.data);
      } else {
        console.error('Failed to fetch payment portal log details:', response.message);
      }
    } catch (error) {
      console.error('Error fetching payment portal log details:', error);
    } finally {
      setLoadingPaymentPortalLog(false);
    }
  };

  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [loadingTransaction, setLoadingTransaction] = useState(false);

  const handleTransactionRowClick = async (row: any) => {
    const id = row?.id || row?.transaction_id;
    if (!id) return;
    try {
      setLoadingTransaction(true);
      const response = await relatedDataService.getTransactionById(id);
      if (response.success && response.data) {
        setSelectedTransaction(response.data);
      } else {
        console.error('Failed to fetch transaction details:', response.message);
      }
    } catch (error) {
      console.error('Error fetching transaction details:', error);
    } finally {
      setLoadingTransaction(false);
    }
  };

  const [selectedServiceOrder, setSelectedServiceOrder] = useState<any>(null);
  const [loadingServiceOrder, setLoadingServiceOrder] = useState(false);

  const handleServiceOrderRowClick = async (row: any) => {
    const id = row?.id || row?.ticket_id; // Check ticket_id too just in case
    if (!id) return;
    try {
      setLoadingServiceOrder(true);

      const response = await relatedDataService.getServiceOrderById(id);
      if (response.success && response.data) {
        const transformedOrder = transformServiceOrder(response.data);
        setSelectedServiceOrder(transformedOrder);
      } else {
        console.error('Failed to fetch service order details:', response.message);
      }
    } catch (error) {
      console.error('Error fetching service order details:', error);
    } finally {
      setLoadingServiceOrder(false);
    }
  };

  const [selectedLcpNapLocation, setSelectedLcpNapLocation] = useState<any>(null);
  const [loadingLcpNap, setLoadingLcpNap] = useState(false);

  const handleLcpNapClick = async () => {
    if (!billingRecord.lcpnap) return;

    const parseCoordinates = (coordString: string): { latitude: number; longitude: number } | null => {
      if (!coordString) return null;
      const coords = coordString.split(',').map(c => c.trim());
      if (coords.length !== 2) return null;
      const latitude = parseFloat(coords[0]);
      const longitude = parseFloat(coords[1]);
      if (isNaN(latitude) || isNaN(longitude)) return null;
      return { latitude, longitude };
    };

    try {
      setLoadingLcpNap(true);

      // OPTIMIZATION: Try to fetch the specific LCP NAP by name first
      let response = await lcpnapService.getAllLCPNAPsForMap(false, billingRecord.lcpnap);

      // If none found with SEARCH (maybe name mismatch), try the full list
      if (!response.success || !response.data || response.data.length === 0) {
        response = await lcpnapService.getAllLCPNAPsForMap();
      }

      if (response.success && response.data) {
        const target = billingRecord.lcpnap.trim().toLowerCase();

        // Match logic:
        // 1. Exact match
        // 2. Normalized match (trim/lowercase)
        // 3. Partial match (target in name or vice versa)
        const matchedItem = response.data.find(loc => {
          const name = loc.lcpnap_name.trim().toLowerCase();
          return name === target || name.includes(target) || target.includes(name);
        });

        if (matchedItem) {

          // Parse coordinates to provide latitude and longitude required by LcpNapLocationDetails
          const coords = parseCoordinates(matchedItem.coordinates);
          const locationWithCoords = {
            ...matchedItem,
            latitude: coords?.latitude,
            longitude: coords?.longitude
          };

          if (locationWithCoords.latitude === undefined || locationWithCoords.longitude === undefined) {
            console.warn('Matching location found but coordinates are invalid:', matchedItem.coordinates);
            alert(`Found location "${matchedItem.lcpnap_name}" but it has invalid coordinates: ${matchedItem.coordinates}`);
            return;
          }

          setSelectedLcpNapLocation(locationWithCoords);
        } else {
          console.warn('LCP NAP location not found. Available names:', response.data.slice(0, 10).map(l => l.lcpnap_name));
        }
      } else {
        console.error('Failed to fetch LCP NAP locations:', response.message);
      }
    } catch (error) {
      console.error('Error in handleLcpNapClick:', error);
    } finally {
      setLoadingLcpNap(false);
    }
  };

  /**
   * Scheme picker for the IP row in Technical Details.
   *
   * Holds the IP plus the on-screen position of the arrow that opened it, because
   * the popover is portalled to <body> (see the render at the bottom of this
   * component) and therefore positions itself in viewport coordinates.
   *
   * Portalled rather than absolutely positioned inside the row: the details
   * sections are scroll containers and the whole panel is `overflow-hidden` on
   * mobile, so an in-flow popover would be clipped.
   */
  const [ipSchemeMenu, setIpSchemeMenu] = useState<{ ip: string; top: number; right: number } | null>(null);

  // Dismiss the scheme menu on Escape, on any outside click, and on scroll or
  // resize — its position is captured from the trigger, so it would otherwise
  // drift away from the row it belongs to.
  useEffect(() => {
    if (!ipSchemeMenu) return;

    const close = () => setIpSchemeMenu(null);
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    // Capture phase so scrolling in any nested container also dismisses it.
    window.addEventListener('scroll', close, true);
    document.addEventListener('mousedown', close);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('mousedown', close);
    };
  }, [ipSchemeMenu]);

  const [showTransactModal, setShowTransactModal] = useState(false);
  const [showTransactionFormModal, setShowTransactionFormModal] = useState(false);
  const [showStaggeredInstallationModal, setShowStaggeredInstallationModal] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showSORequestConfirmModal, setShowSORequestConfirmModal] = useState(false);
  const [showSORequestFormModal, setShowSORequestFormModal] = useState(false);
  const [showDetailsEditModal, setShowDetailsEditModal] = useState(false);
  const [showAttachmentModal, setShowAttachmentModal] = useState(false);
  const [editType, setEditType] = useState<'customer_details' | 'billing_details' | 'technical_details'>('customer_details');
  const [detailsWidth, setDetailsWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showColumnVisibility, setShowColumnVisibility] = useState(false);
  const [expandedModalSection, setExpandedModalSection] = useState<string | null>(null);

  // Related data states
  const [relatedData, setRelatedData] = useState<Record<string, any[]>>({
    invoices: [],
    statementOfAccounts: [],
    paymentPortalLogs: [],
    transactions: [],
    staggered: [],
    discounts: [],
    serviceOrders: [],
    reconnectionLogs: [],
    disconnectedLogs: [],
    detailsUpdateLogs: [],
    planChangeLogs: [],
    serviceChargeLogs: [],
    changeDueLogs: [],
    securityDeposits: []
  });

  // Full related data (not limited to 5 items)
  const [fullRelatedData, setFullRelatedData] = useState<Record<string, any[]>>({
    invoices: [],
    statementOfAccounts: [],
    paymentPortalLogs: [],
    transactions: [],
    staggered: [],
    discounts: [],
    serviceOrders: [],
    reconnectionLogs: [],
    disconnectedLogs: [],
    detailsUpdateLogs: [],
    planChangeLogs: [],
    serviceChargeLogs: [],
    changeDueLogs: [],
    securityDeposits: []
  });

  const [relatedDataCounts, setRelatedDataCounts] = useState<Record<string, number>>({
    invoices: 0,
    statementOfAccounts: 0,
    paymentPortalLogs: 0,
    transactions: 0,
    staggered: 0,
    discounts: 0,
    serviceOrders: 0,
    reconnectionLogs: 0,
    disconnectedLogs: 0,
    detailsUpdateLogs: 0,
    planChangeLogs: 0,
    serviceChargeLogs: 0,
    changeDueLogs: 0,
    securityDeposits: 0
  });

  const [loadingData, setLoadingData] = useState<Record<string, boolean>>({});
  const [userEmailCache, setUserEmailCache] = useState<Record<string, string>>({});
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  const COLUMN_VISIBILITY_KEY = 'customerDetailsColumnVisibility';
  const FIELD_ORDER_KEY = 'customerDetailsFieldOrder';

  const defaultFieldOrder = {
    customerDetails: [
      'fullName',
      'emailAddress',
      'contactNumber',
      'secondContactNumber',
      'address',
      'barangay',
      'city',
      'region',
      'referredBy',
      'desiredPlan',
      'addressCoordinates',
      'houseFrontPicture',
      'accountNoCustomer',
      'proofOfBillingUrl',
      'governmentValidIdUrl',
      'secondGovernmentValidIdUrl',
      'documentAttachmentUrl',
      'otherIspBillUrl',
      'customerUpdatedBy',
      'customerUpdatedAt'
    ],
    technicalDetails: [
      'usageType',
      'dateInstalled',
      'username',
      'pppoePassword',
      'connectionType',
      'routerModel',
      'routerModemSN',
      'sessionGroup',
      'onlineStatus',
      'mikrotikId',
      'lcp',
      'nap',
      'lcpnap',
      'vlan',
      'port',
      'sessionIp',
      'techUpdatedBy',
      'techUpdatedAt'
    ],
    billingDetails: [
      'accountNumber',
      'billingStatus',
      'billingDay',
      'generationType',
      'vatType',
      'withholding',
      'prepaidExpiration',
      'vip_expiration',
      'vip_remarks',
      'plan',
      'accountBalance',
      'balanceUpdateDate',
      'totalPaid',
      'billingAccountCreatedBy',
      'billingAccountCreatedAt',
      'billingAccountUpdatedBy',
      'billingAccountUpdatedAt'
    ]
  };

  const defaultColumnVisibility = {
    customerDetails: true,
    technicalDetails: true,
    billingDetails: true
  };

  const [columnVisibility, setColumnVisibility] = useState(() => {
    const saved = localStorage.getItem(COLUMN_VISIBILITY_KEY);
    return saved ? JSON.parse(saved) : defaultColumnVisibility;
  });

  const [fieldOrder, setFieldOrder] = useState(() => {
    const saved = localStorage.getItem(FIELD_ORDER_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge any new fields from defaultFieldOrder that aren't in the saved order
      const merged: Record<string, string[]> = { ...parsed };
      for (const section of Object.keys(defaultFieldOrder) as Array<keyof typeof defaultFieldOrder>) {
        const savedSection = merged[section] || [];
        const defaults = defaultFieldOrder[section];
        const missing = defaults.filter((f: string) => !savedSection.includes(f));
        if (missing.length > 0) {
          merged[section] = [...savedSection, ...missing];
        }
      }
      return merged;
    }
    return defaultFieldOrder;
  });

  const [draggedItem, setDraggedItem] = useState<{ section: string; index: number } | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

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
    localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  useEffect(() => {
    localStorage.setItem(FIELD_ORDER_KEY, JSON.stringify(fieldOrder));
  }, [fieldOrder]);

  // Shared with the customer list so the panel and the row behind it can never
  // disagree. This was a local copy that had drifted — it lacked the Inactive rule
  // and the Empty guard, so an inactive account with a stale session read ONLINE
  // here while the list correctly read OFFLINE.
  const getStatusInfo = getOnlineStatusInfo;

  const fetchRelatedData = useCallback(async () => {
    const accountNo = billingRecord.accountNo || billingRecord.account_no || billingRecord.applicationId;
    if (!accountNo) {
      return;
    }

    // Fetch all related data
    const fetchPromises = [
      { key: 'invoices', fn: relatedDataService.getRelatedInvoices },
      { key: 'statementOfAccounts', fn: relatedDataService.getRelatedStatementOfAccounts },
      { key: 'paymentPortalLogs', fn: relatedDataService.getRelatedPaymentPortalLogs },
      { key: 'transactions', fn: relatedDataService.getRelatedTransactions },
      { key: 'staggered', fn: relatedDataService.getRelatedStaggered },
      { key: 'discounts', fn: relatedDataService.getRelatedDiscounts },
      { key: 'serviceOrders', fn: relatedDataService.getRelatedServiceOrders },
      { key: 'reconnectionLogs', fn: relatedDataService.getRelatedReconnectionLogs },
      { key: 'disconnectedLogs', fn: relatedDataService.getRelatedDisconnectedLogs },
      { key: 'detailsUpdateLogs', fn: relatedDataService.getRelatedDetailsUpdateLogs },
      { key: 'planChangeLogs', fn: relatedDataService.getRelatedPlanChangeLogs },
      { key: 'serviceChargeLogs', fn: relatedDataService.getRelatedServiceChargeLogs },
      { key: 'changeDueLogs', fn: relatedDataService.getRelatedChangeDueLogs },
      { key: 'securityDeposits', fn: relatedDataService.getRelatedSecurityDeposits },
      { key: 'jobOrders', fn: relatedDataService.getRelatedJobOrdersByAccount },
      { key: 'applications', fn: relatedDataService.getRelatedApplicationsByAccount }
    ];

    const results = await Promise.all(
      fetchPromises.map(async ({ key, fn }) => {
        try {
          const result = await fn(accountNo);
          return { key, data: result.data || [], count: result.count || 0 };
        } catch (error) {
          console.error(`❌ Error fetching ${key}:`, error);
          return { key, data: [], count: 0 };
        }
      })
    );

    const newRelatedData: Record<string, any[]> = {};
    const newFullRelatedData: Record<string, any[]> = {};
    const newCounts: Record<string, number> = {};

    results.forEach(({ key, data, count }) => {
      // Store full data for modal view
      newFullRelatedData[key] = data;
      // Limit to 5 latest items for dropdown display
      newRelatedData[key] = data.slice(0, 5);
      newCounts[key] = count;
    });

    setRelatedData(newRelatedData);
    setFullRelatedData(newFullRelatedData);
    setRelatedDataCounts(newCounts);
  }, [billingRecord.applicationId, billingRecord.accountNo, billingRecord.account_no]);

  // Fetch related data when account number changes or refreshKey increments
  useEffect(() => {
    fetchRelatedData();
  }, [billingRecord.applicationId, billingRecord.accountNo, billingRecord.account_no, refreshKey]);

  /*
   * ── Prepaid Expiration Override ──────────────────────────────────────────
   *
   * Took over the toolbar slot the "Print latest SOA" action used to occupy. Printing a statement
   * from here is no loss — SOADetails still does it, per statement, which is where anyone printing
   * one is choosing from anyway.
   *
   * The action only appears for prepaid accounts: a postpaid customer's access is governed by
   * invoices, so there is no service period on them to adjust.
   *
   * Letters-only compare so accounts still carrying the older 'Pre Paid' spelling resolve too —
   * the same normalisation BillingAccount::isPrepaidType() applies on the backend.
   */
  const [showPrepaidOverrideModal, setShowPrepaidOverrideModal] = useState(false);

  const isPrepaidAccount = useMemo(
    () => String(billingRecord.generationType ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'prepaid',
    [billingRecord.generationType]
  );

  // Resolve user IDs for Created By / Updated By fields
  useEffect(() => {
    const resolveUserIds = async () => {
      const ids = [
        billingRecord.billingAccountCreatedBy,
        billingRecord.billingAccountUpdatedBy,
        billingRecord.customerUpdatedBy,
        billingRecord.techUpdatedBy
      ].filter((v): v is string => !!v && !isNaN(Number(v)));

      const uniqueIds = Array.from(new Set(ids));

      await Promise.all(
        uniqueIds.map(async (id) => {
          if (userEmailCache[id]) return;
          try {
            const res = await userService.getUserById(Number(id));
            if (res.success && res.data?.email_address) {
              setUserEmailCache(prev => ({ ...prev, [id]: res.data!.email_address }));
            }
          } catch {
            // silently ignore unresolvable IDs
          }
        })
      );
    };

    resolveUserIds();
  }, [billingRecord.billingAccountCreatedBy, billingRecord.billingAccountUpdatedBy, billingRecord.customerUpdatedBy, billingRecord.techUpdatedBy]);

  const toggleColumnVisibility = (column: string) => {
    setColumnVisibility((prev: Record<string, boolean>) => ({
      ...prev,
      [column]: !prev[column]
    }));
  };

  const selectAllColumns = () => {
    const allVisible = Object.keys(defaultColumnVisibility).reduce((acc, key) => {
      acc[key] = true;
      return acc;
    }, {} as Record<string, boolean>);
    setColumnVisibility(allVisible);
  };

  const deselectAllColumns = () => {
    const allHidden = Object.keys(defaultColumnVisibility).reduce((acc, key) => {
      acc[key] = false;
      return acc;
    }, {} as Record<string, boolean>);
    setColumnVisibility(allHidden);
  };

  const handleDragStart = (section: string, index: number) => {
    setDraggedItem({ section, index });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (section: string, dropIndex: number) => {
    if (!draggedItem || draggedItem.section !== section) return;

    const newOrder = [...fieldOrder[section]];
    const [removed] = newOrder.splice(draggedItem.index, 1);
    newOrder.splice(dropIndex, 0, removed);

    setFieldOrder({
      ...fieldOrder,
      [section]: newOrder
    });
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  const toggleSectionExpansion = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const resetFieldOrder = () => {
    setFieldOrder(defaultFieldOrder);
  };

  const getFieldLabel = (fieldKey: string): string => {
    const labels: Record<string, string> = {
      fullName: 'Full Name',
      emailAddress: 'Email Address',
      contactNumber: 'Contact Number',
      secondContactNumber: 'Second Contact Number',
      address: 'Address',
      barangay: 'Barangay',
      city: 'City',
      region: 'Region',
      referredBy: 'Referred By',
      desiredPlan: 'Desired Plan',
      addressCoordinates: 'Address Coordinates',
      houseFrontPicture: 'House Front Picture',
      usageType: 'Usage Type',
      dateInstalled: 'Date Installed',
      username: 'PPPOE Username',
      pppoePassword: 'PPPOE Password',
      connectionType: 'Connection Type',
      routerModel: 'Router Model',
      routerModemSN: 'Router Serial Number',
      sessionGroup: 'Group',
      onlineStatus: 'Online Status',
      mikrotikId: 'Mikrotik ID',
      lcp: 'LCP',
      nap: 'NAP',
      lcpnap: 'LCP NAP',
      vlan: 'VLAN',
      port: 'PORT',
      sessionIp: 'SESSION IP',
      accountNumber: 'Account Number',
      billingStatus: 'Billing Status',
      billingDay: 'Billing Day',
      generationType: 'Billing Type',
      vatType: 'VAT',
      withholding: 'Withholding',
      prepaidExpiration: 'Prepaid Expiration',
      plan: 'Plan',
      accountBalance: 'Account Balance',
      totalPaid: 'Total Paid',
      balanceUpdateDate: 'Balance Update Date',
      billingAccountCreatedBy: 'Created By',
      billingAccountCreatedAt: 'Created At',
      billingAccountUpdatedBy: 'Updated By',
      billingAccountUpdatedAt: 'Updated At',
      vip_expiration: 'VIP Expiration Date',
      vip_remarks: 'VIP Remarks',
      accountNoCustomer: 'Customer Account No',
      proofOfBillingUrl: 'Proof of Billing',
      governmentValidIdUrl: 'Government ID',
      secondGovernmentValidIdUrl: 'Second Government ID',
      documentAttachmentUrl: 'Document Attachment',
      otherIspBillUrl: 'Other ISP Bill',
      customerUpdatedBy: 'Updated By',
      customerUpdatedAt: 'Updated At',
      techUpdatedBy: 'Updated By',
      techUpdatedAt: 'Updated At'
    };
    return labels[fieldKey] || fieldKey;
  };

  const renderField = (fieldKey: string, billingRecord: BillingDetailRecord): React.ReactElement | null => {
    const fieldRenderers: Record<string, () => React.ReactElement | null> = {
      fullName: () => billingRecord.customerName ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Full Name</span>
          <span className={`font-medium truncate text-right min-w-0 uppercase ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.customerName}>{billingRecord.customerName}</span>
        </div>
      ) : null,
      emailAddress: () => (billingRecord.emailAddress || billingRecord.email) ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Email Address</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.emailAddress || billingRecord.email || ''}>{billingRecord.emailAddress || billingRecord.email}</span>
        </div>
      ) : null,
      contactNumber: () => billingRecord.contactNumber ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Contact Number</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.contactNumber}>{billingRecord.contactNumber}</span>
        </div>
      ) : null,
      secondContactNumber: () => billingRecord.secondContactNumber ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Second Contact Number</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.secondContactNumber}>{billingRecord.secondContactNumber}</span>
        </div>
      ) : null,
      address: () => billingRecord.address?.split(',')[0] ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Address</span>
          <span className={`font-medium truncate text-right min-w-0 uppercase ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.address}>{billingRecord.address.split(',')[0]}</span>
        </div>
      ) : null,
      barangay: () => billingRecord.barangay ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Barangay</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.barangay}>{billingRecord.barangay}</span>
        </div>
      ) : null,
      city: () => billingRecord.city ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>City</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.city}>{billingRecord.city}</span>
        </div>
      ) : null,
      region: () => billingRecord.region ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Region</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.region}>{billingRecord.region}</span>
        </div>
      ) : null,
      referredBy: () => billingRecord.referredBy ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Referred By</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.referredBy}>{billingRecord.referredBy}</span>
        </div>
      ) : null,
      desiredPlan: () => billingRecord.desiredPlan ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Desired Plan</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.desiredPlan}>{billingRecord.desiredPlan}</span>
        </div>
      ) : null,
      addressCoordinates: () => {
        if (!billingRecord.addressCoordinates) return null;

        // Parse coordinates - expecting format like "14.1234,121.5678" or "14.1234, 121.5678"
        const coords = billingRecord.addressCoordinates.split(',').map(c => parseFloat(c.trim()));

        if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) {
          return (
            <div className="space-y-2">
              <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>Address Coordinates</span>
              <div className={`w-full h-24 border rounded flex items-center justify-center ${isDarkMode
                ? 'bg-gray-800 border-gray-700'
                : 'bg-gray-100 border-gray-300'
                }`}>
                <span className={`text-sm truncate px-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                  }`} title={billingRecord.addressCoordinates}>{billingRecord.addressCoordinates}</span>
              </div>
            </div>
          );
        }

        const [lat, lng] = coords;

        return (
          <div className="space-y-2">
            <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Address Coordinates</span>
            <div className={`w-full h-64 border rounded overflow-hidden relative ${isDarkMode
              ? 'border-gray-700'
              : 'border-gray-300'
              }`} style={{ zIndex: 1 }}>
              <MapContainer
                center={[lat, lng]}
                zoom={16}
                minZoom={6}
                maxBounds={L.latLngBounds([4.3, 114.0], [21.5, 127.5])}
                maxBoundsViscosity={1.0}
                style={{ height: '100%', width: '100%', zIndex: 1 }}
                scrollWheelZoom={false}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={[lat, lng]}>
                  <Popup>
                    <span className="uppercase">{billingRecord.customerName}</span><br />
                    <span className="uppercase">{billingRecord.address}</span>
                  </Popup>
                </Marker>
              </MapContainer>
            </div>
            <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>
              Latitude: {lat}, Longitude: {lng}
            </div>
          </div>
        );
      },
      houseFrontPicture: () => billingRecord.houseFrontPicture ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>House Front Picture</span>
          <button
            onClick={() => window.open(billingRecord.houseFrontPicture, '_blank')}
            className={`${isDarkMode
              ? 'text-blue-400 hover:text-blue-300'
              : 'text-blue-600 hover:text-blue-700'
            } flex items-center space-x-1 min-w-0 max-w-[180px] sm:max-w-[300px]`}
          >
            <span className="text-sm truncate" title={billingRecord.houseFrontPicture}>{billingRecord.houseFrontPicture}</span>
            <ExternalLink size={14} className="flex-shrink-0" />
          </button>
        </div>
      ) : null,
      accountNoCustomer: () => billingRecord.accountNoCustomer ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Customer Account No</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={billingRecord.accountNoCustomer}>{billingRecord.accountNoCustomer}</span>
        </div>
      ) : null,
      proofOfBillingUrl: () => billingRecord.proofOfBillingUrl ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Proof of Billing</span>
          <button
            onClick={() => window.open(billingRecord.proofOfBillingUrl, '_blank')}
            className={`${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} flex items-center space-x-1 min-w-0`}
          >
            <span className="text-sm truncate" title={billingRecord.proofOfBillingUrl}>View Document</span>
            <ExternalLink size={14} className="flex-shrink-0" />
          </button>
        </div>
      ) : null,
      governmentValidIdUrl: () => billingRecord.governmentValidIdUrl ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Government ID</span>
          <button
            onClick={() => window.open(billingRecord.governmentValidIdUrl, '_blank')}
            className={`${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} flex items-center space-x-1 min-w-0`}
          >
            <span className="text-sm truncate" title={billingRecord.governmentValidIdUrl}>View Document</span>
            <ExternalLink size={14} className="flex-shrink-0" />
          </button>
        </div>
      ) : null,
      secondGovernmentValidIdUrl: () => billingRecord.secondGovernmentValidIdUrl ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Second Government ID</span>
          <button
            onClick={() => window.open(billingRecord.secondGovernmentValidIdUrl, '_blank')}
            className={`${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} flex items-center space-x-1 min-w-0`}
          >
            <span className="text-sm truncate" title={billingRecord.secondGovernmentValidIdUrl}>View Document</span>
            <ExternalLink size={14} className="flex-shrink-0" />
          </button>
        </div>
      ) : null,
      documentAttachmentUrl: () => billingRecord.documentAttachmentUrl ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Document Attachment</span>
          <button
            onClick={() => window.open(billingRecord.documentAttachmentUrl, '_blank')}
            className={`${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} flex items-center space-x-1 min-w-0`}
          >
            <span className="text-sm truncate" title={billingRecord.documentAttachmentUrl}>View Document</span>
            <ExternalLink size={14} className="flex-shrink-0" />
          </button>
        </div>
      ) : null,
      otherIspBillUrl: () => billingRecord.otherIspBillUrl ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Other ISP Bill</span>
          <button
            onClick={() => window.open(billingRecord.otherIspBillUrl, '_blank')}
            className={`${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} flex items-center space-x-1 min-w-0`}
          >
            <span className="text-sm truncate" title={billingRecord.otherIspBillUrl}>View Document</span>
            <ExternalLink size={14} className="flex-shrink-0" />
          </button>
        </div>
      ) : null,
      customerUpdatedBy: () => {
        const raw = billingRecord.customerUpdatedBy;
        if (!raw) return null;
        const display = (raw && !isNaN(Number(raw)))
          ? (userEmailCache[raw] || raw)
          : raw;
        return (
          <div className="flex justify-between items-center gap-4">
            <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Updated By</span>
            <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={display}>{display}</span>
          </div>
        );
      },
      customerUpdatedAt: () => billingRecord.customerUpdatedAt ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Updated At</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{formatDateTime(billingRecord.customerUpdatedAt)}</span>
        </div>
      ) : null,
      techUpdatedBy: () => {
        const raw = billingRecord.techUpdatedBy;
        if (!raw) return null;
        const display = (raw && !isNaN(Number(raw)))
          ? (userEmailCache[raw] || raw)
          : raw;
        return (
          <div className="flex justify-between items-center gap-4">
            <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Updated By</span>
            <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={display}>{display}</span>
          </div>
        );
      },
      techUpdatedAt: () => billingRecord.techUpdatedAt ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Updated At</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{formatDateTime(billingRecord.techUpdatedAt)}</span>
        </div>
      ) : null,
      usageType: () => billingRecord.usageType ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Usage Type</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.usageType}>{billingRecord.usageType}</span>
        </div>
      ) : null,
      dateInstalled: () => billingRecord.dateInstalled ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Date Installed</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{formatDate(billingRecord.dateInstalled)}</span>
        </div>
      ) : null,
      username: () => billingRecord.username ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>PPPOE Username</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.username}>{billingRecord.username}</span>
        </div>
      ) : null,
      // Always rendered, unlike the username row above: staff need to see that an account has
      // no PPPoE password on record, and a silently missing row cannot convey that.
      pppoePassword: () => (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>PPPOE Password</span>
          <span className={`font-medium truncate text-right min-w-0 font-mono ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.pppoePassword || NOT_SET}>
            {billingRecord.pppoePassword || NOT_SET}
          </span>
        </div>
      ),
      sessionGroup: () => billingRecord.sessionGroup ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Group</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={billingRecord.sessionGroup}>{billingRecord.sessionGroup}</span>
        </div>
      ) : null,
      connectionType: () => billingRecord.connectionType ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Connection Type</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.connectionType}>{billingRecord.connectionType}</span>
        </div>
      ) : null,
      routerModel: () => billingRecord.routerModel ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Router Model</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.routerModel}>{billingRecord.routerModel}</span>
        </div>
      ) : null,
      routerModemSN: () => billingRecord.routerModemSN ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Router Serial Number</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.routerModemSN}>{billingRecord.routerModemSN}</span>
        </div>
      ) : null,
      onlineStatus: () => {
        if (!billingRecord.status && !billingRecord.onlineStatus) return null;
        const statusInfo = getStatusInfo(billingRecord);
        return (
          <div className="flex justify-between items-center gap-4">
            <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Online Status</span>
            <div className="flex items-center space-x-2 flex-shrink-0">
              {!statusInfo.hideCircle && (statusInfo.hollow ? (
                <Circle className={`h-3.5 w-3.5 ${statusInfo.color}`} strokeWidth={3} />
              ) : (
                <div className={`h-3.5 w-3.5 rounded-full ${statusInfo.fillColor}`} />
              ))}
              <span className={`font-bold text-xs tracking-tight ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            </div>
          </div>
        );
      },
      mikrotikId: () => billingRecord.mikrotikId ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Mikrotik ID</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.mikrotikId}>{billingRecord.mikrotikId}</span>
        </div>
      ) : null,
      lcpnap: () => billingRecord.lcpnap ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>LCP NAP</span>
          <div className="flex items-center space-x-2 min-w-0">
            <span className={`font-medium truncate min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`} title={billingRecord.lcpnap}>{billingRecord.lcpnap}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleLcpNapClick();
              }}
              disabled={loadingLcpNap}
              className={`p-1 rounded transition-colors flex-shrink-0 ${loadingLcpNap ? 'opacity-50 cursor-not-allowed' : isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'
                }`}
              title="View LCP NAP Location Details"
            >
              <CircleArrowRight size={18} className={loadingLcpNap ? 'animate-pulse' : ''} />
            </button>
          </div>
        </div>
      ) : null,
      lcp: () => billingRecord.lcp ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>LCP</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.lcp}>{billingRecord.lcp}</span>
        </div>
      ) : null,
      nap: () => billingRecord.nap ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>NAP</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.nap}>{billingRecord.nap}</span>
        </div>
      ) : null,
      port: () => billingRecord.port ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>PORT</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.port}>{billingRecord.port}</span>
        </div>
      ) : null,
      vlan: () => billingRecord.vlan ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>VLAN</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.vlan}>{billingRecord.vlan}</span>
        </div>
      ) : null,
      sessionIp: () => {
        const rawIp = String(billingRecord.sessionIp || billingRecord.sessionIP || '').trim();
        if (!rawIp) return null;

        // Strip any scheme already stored on the value. Today every row is a bare
        // IPv4, but if one ever arrives as "http://10.0.0.1" the naive join would
        // build "https://http://10.0.0.1", which opens a broken tab.
        const ip = rawIp.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');

        return (
          <div className="flex justify-between items-center gap-4">
            <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>IP</span>
            <span className="flex items-center gap-1 min-w-0">
              <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`} title={ip}>{ip}</span>
              <button
                type="button"
                title="Open as URL"
                aria-label="Open IP as a URL"
                aria-haspopup="menu"
                aria-expanded={ipSchemeMenu?.ip === ip}
                // mousedown is the document-level dismiss handler, so stop it here
                // or opening the menu would immediately close it again.
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (ipSchemeMenu?.ip === ip) {
                    setIpSchemeMenu(null);
                    return;
                  }
                  // Anchor to the trigger in viewport coordinates; the menu is
                  // portalled to <body> and right-aligned under the arrow.
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setIpSchemeMenu({
                    ip,
                    top: r.bottom + 6,
                    right: Math.max(8, window.innerWidth - r.right),
                  });
                }}
                className={`flex-shrink-0 p-0.5 rounded transition-colors ${isDarkMode
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200'
                  }`}
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-150 ${ipSchemeMenu?.ip === ip ? 'rotate-180' : ''}`}
                />
              </button>
            </span>
          </div>
        );
      },
      accountNumber: () => billingRecord.applicationId ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Account Number</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.applicationId}>{billingRecord.applicationId}</span>
        </div>
      ) : null,
      billingStatus: () => billingRecord.billingStatus ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Billing Status</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.billingStatus}>{billingRecord.billingStatus}</span>
        </div>
      ) : null,
      // Billing Type / VAT / Withholding / VIP are ALWAYS rendered, even with no value, so the
      // Billing Details section keeps a stable shape and a missing setting is visibly missing
      // rather than silently absent. NOT_SET is the placeholder for "no value stored".
      generationType: () => (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Billing Type</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.generationType || NOT_SET}>{billingRecord.generationType || NOT_SET}</span>
        </div>
      ),
      vatType: () => {
        // Prefers the boolean; falls back to the legacy free-text mode for accounts created
        // before vat_enabled existed. Only when neither is present is it genuinely unset.
        const vatLabel = typeof billingRecord.vatEnabled === 'boolean'
          ? (billingRecord.vatEnabled ? 'VAT Included' : 'No VAT')
          : (billingRecord.vatType || NOT_SET);
        return (
          <div className="flex justify-between items-center gap-4">
            <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>VAT</span>
            <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`} title={vatLabel}>{vatLabel}</span>
          </div>
        );
      },
      withholding: () => {
        // Explicit false is a real answer ("No"), not a missing value — only null/undefined,
        // meaning an account predating the column, reads as unset.
        const withholdingLabel = billingRecord.withholdingEnabled
          ? `${billingRecord.withholdingPercentage ?? 0}%`
          : (billingRecord.withholdingEnabled === false ? 'No' : NOT_SET);
        return (
          <div className="flex justify-between items-center gap-4">
            <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Withholding</span>
            <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{withholdingLabel}</span>
          </div>
        );
      },
      prepaidExpiration: () => {
        // Letters-only compare so accounts still carrying the older 'Pre Paid'
        // spelling resolve too — same normalisation the backend uses.
        const isPrepaid = String(billingRecord.generationType ?? '')
          .toLowerCase().replace(/[^a-z]/g, '') === 'prepaid';

        // Shown for every prepaid account, NOT only those with a date. A prepaid
        // account with no expiry is a real state (it is only set on the first
        // payment), and "Not set" tells you that — whereas hiding the row made it
        // indistinguishable from the field not existing. Postpaid accounts have no
        // prepaid period, so the row stays hidden for them unless a stray value
        // exists, in which case it is surfaced rather than swallowed.
        if (!isPrepaid && !billingRecord.prepaidExpiration) return null;

        return (
          <div className="flex justify-between items-center gap-4">
            <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Prepaid Expiration</span>
            <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{billingRecord.prepaidExpiration ? formatDateTime(billingRecord.prepaidExpiration) : NOT_SET}</span>
          </div>
        );
      },
      vip_expiration: () => (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>VIP Expiration Date</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{billingRecord.vip_expiration ? formatDate(billingRecord.vip_expiration) : NOT_SET}</span>
        </div>
      ),
      vip_remarks: () => billingRecord.vip_remarks ? (
        <div className="flex justify-between items-start gap-4 flex-col sm:flex-row sm:items-center">
          <span className={`text-xs sm:text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>VIP Remarks</span>
          <span className={`font-medium text-left sm:text-right text-xs sm:text-sm truncate min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`} title={billingRecord.vip_remarks}>{billingRecord.vip_remarks}</span>
        </div>
      ) : null,
      billingDay: () => (billingRecord.billingDay !== undefined && billingRecord.billingDay !== null) ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Billing Day</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{billingRecord.billingDay === 0 ? 'Every end of month' : (billingRecord.billingDay)}</span>
        </div>
      ) : null,
      plan: () => billingRecord.plan ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Plan</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`} title={billingRecord.plan}>{billingRecord.plan}</span>
        </div>
      ) : null,
      accountBalance: () => (billingRecord.accountBalance !== undefined && billingRecord.accountBalance !== null) || (billingRecord.balance !== undefined && billingRecord.balance !== null) ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Account Balance</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>₱{Number(billingRecord.accountBalance ?? billingRecord.balance ?? 0).toFixed(2)}</span>
        </div>
      ) : null,
      billingAccountCreatedBy: () => {
        const raw = billingRecord.billingAccountCreatedBy;
        if (!raw) return null;
        const display = (raw && !isNaN(Number(raw)))
          ? (userEmailCache[raw] || raw)
          : raw;
        return (
          <div className="flex justify-between items-center gap-4">
            <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Created By</span>
            <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`} title={display}>{display}</span>
          </div>
        );
      },
      billingAccountCreatedAt: () => billingRecord.billingAccountCreatedAt ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Created At</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{formatDateTime(billingRecord.billingAccountCreatedAt)}</span>
        </div>
      ) : null,
      billingAccountUpdatedBy: () => {
        const raw = billingRecord.billingAccountUpdatedBy;
        if (!raw) return null;
        const display = (raw && !isNaN(Number(raw)))
          ? (userEmailCache[raw] || raw)
          : raw;
        return (
          <div className="flex justify-between items-center gap-4">
            <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Updated By</span>
            <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`} title={display}>{display}</span>
          </div>
        );
      },
      billingAccountUpdatedAt: () => billingRecord.billingAccountUpdatedAt ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Updated At</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{formatDateTime(billingRecord.billingAccountUpdatedAt)}</span>
        </div>
      ) : null,
      balanceUpdateDate: () => billingRecord.balanceUpdateDate ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Balance Update Date</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{formatDate(billingRecord.balanceUpdateDate)}</span>
        </div>
      ) : null,
      totalPaid: () => (billingRecord.totalPaid !== undefined && billingRecord.totalPaid !== null) ? (
        <div className="flex justify-between items-center gap-4">
          <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Total Paid</span>
          <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>₱{Number(billingRecord.totalPaid || 0).toFixed(2)}</span>
        </div>
      ) : null
    };

    const renderer = fieldRenderers[fieldKey];
    return renderer ? renderer() : null;
  };



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

  const handleClose = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleTransactClick = () => {
    setShowTransactModal(true);
  };

  const handleTransactConfirm = () => {
    setShowTransactModal(false);
    setShowTransactionFormModal(true);
  };

  const handleTransactCancel = () => {
    setShowTransactModal(false);
  };

  const handleTransactionFormSave = useCallback(async (formData: any) => {
    setShowTransactionFormModal(false);

    // Auto-refresh the customer data and related data
    if (onRefresh) {
      await onRefresh();
    }
    await fetchRelatedData();
  }, [onRefresh, fetchRelatedData]);

  const handleTransactionFormClose = useCallback(() => {
    setShowTransactionFormModal(false);
  }, []);

  const handleStaggeredInstallationAdd = () => {
    setShowStaggeredInstallationModal(true);
  };

  const handleStaggeredInstallationFormSave = async (formData: any) => {
    setShowStaggeredInstallationModal(false);
    if (onRefresh) {
      await onRefresh();
    }
    await fetchRelatedData();
  };

  const handleStaggeredInstallationFormClose = () => {
    setShowStaggeredInstallationModal(false);
  };

  const handleDiscountAdd = () => {
    setShowDiscountModal(true);
  };

  const handleDiscountFormSave = async (formData: any) => {
    setShowDiscountModal(false);
    if (onRefresh) {
      await onRefresh();
    }
    await fetchRelatedData();
  };

  const handleDiscountFormClose = () => {
    setShowDiscountModal(false);
  };

  const handleWrenchClick = () => {
    setShowSORequestConfirmModal(true);
  };

  const handleSORequestConfirm = () => {
    setShowSORequestConfirmModal(false);
    setShowSORequestFormModal(true);
  };

  const handleSORequestCancel = () => {
    setShowSORequestConfirmModal(false);
  };

  const handleSORequestFormSave = async () => {
    setShowSORequestFormModal(false);
    if (onRefresh) {
      await onRefresh();
    }
    await fetchRelatedData();
  };

  const handleSORequestFormClose = () => {
    setShowSORequestFormModal(false);
  };

  const handleEditClick = () => {
    setEditType('customer_details');
    setShowDetailsEditModal(true);
  };

  const handleDetailsEditSave = async (formData: any, activeEditType: 'customer_details' | 'billing_details' | 'technical_details') => {
    try {
      let result: any = null;

      if (activeEditType === 'customer_details') {
        result = await customerDetailUpdateService.updateCustomerDetails(
          billingRecord.applicationId,
          formData
        );
      } else if (activeEditType === 'billing_details') {
        result = await customerDetailUpdateService.updateBillingDetails(
          billingRecord.applicationId,
          formData
        );
      } else if (activeEditType === 'technical_details') {
        result = await customerDetailUpdateService.updateTechnicalDetails(
          billingRecord.applicationId,
          formData
        );
      }

      if (onRefresh) {
        await onRefresh();
      }
      await fetchRelatedData();

      // We don't close the modal here anymore. The modal component handles the success UI and closing.
      // Return the API response so the modal can surface RADIUS queue info (radius_queued / radius_message).
      return result;
    } catch (error) {
      console.error('Failed to update details:', error);
      throw error; // Re-throw so the modal can handle the error state
    }
  };

  const handleDetailsEditClose = () => {
    setShowDetailsEditModal(false);
  };
  const handleExpandModalOpen = (sectionKey: string) => {
    if (onExpandSection && sectionKey === 'detailsUpdateLogs') {
      const name = billingRecord.customerName || '';
      const nameSuffix = name ? ` (${name})` : '';
      
      const labels: Record<string, string> = {
        invoices: `All Related Invoices${nameSuffix}`,
        statementOfAccounts: `All Related Statement of Accounts${nameSuffix}`,
        paymentPortalLogs: `All Related Payment Portal Logs${nameSuffix}`,
        transactions: `All Related Transactions${nameSuffix}`,
        staggered: `All Related Staggered${nameSuffix}`,
        discounts: `All Related Discounts${nameSuffix}`,
        serviceOrders: `All Related Service Orders${nameSuffix}`,
        reconnectionLogs: `All Related Reconnection Logs${nameSuffix}`,
        disconnectedLogs: `All Related Disconnected Logs${nameSuffix}`,
        detailsUpdateLogs: `All Related Details Update Logs${nameSuffix}`,
        planChangeLogs: `All Related Plan Change Logs${nameSuffix}`,
        serviceChargeLogs: `All Related Service Charge Logs${nameSuffix}`,
        changeDueLogs: `All Related Change Due Logs${nameSuffix}`,
        securityDeposits: `All Related Security Deposits${nameSuffix}`
      };
      
      onExpandSection(
        sectionKey,
        labels[sectionKey] || sectionKey,
        fullRelatedData[sectionKey] || [],
        relatedDataColumns[sectionKey as keyof typeof relatedDataColumns],
        relatedDataCounts[sectionKey]
      );
    } else {
      setExpandedModalSection(sectionKey);
    }
  };

  const handleExpandModalClose = () => {
    setExpandedModalSection(null);
  };

  const defaultOnlineStatus: OnlineStatusRecord[] = onlineStatusRecords.length > 0 ? onlineStatusRecords : [
    {
      id: '1',
      status: 'Online',
      accountNo: billingRecord.applicationId || '',
      username: billingRecord.username || '',
      group: billingRecord.groupName || '',
      splynxId: '1'
    }
  ];

  const handleExportCSV = () => {
    let csvContent = "";
    
    const addRow = (row: any[]) => {
      csvContent += row.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(",") + "\r\n";
    };

    addRow(["--- CUSTOMER DETAILS ---"]);
    addRow(["Full Name", billingRecord.customerName]);
    addRow(["Email Address", billingRecord.emailAddress || billingRecord.email]);
    addRow(["Contact Number", billingRecord.contactNumber]);
    addRow(["Second Contact Number", billingRecord.secondContactNumber]);
    addRow(["Address", billingRecord.address]);
    addRow(["Barangay", billingRecord.barangay]);
    addRow(["City", billingRecord.city]);
    addRow(["Region", billingRecord.region]);
    addRow(["Referred By", billingRecord.referredBy]);
    addRow(["Desired Plan", billingRecord.desiredPlan]);
    addRow([]);

    addRow(["--- TECHNICAL DETAILS ---"]);
    addRow(["Usage Type", billingRecord.usageType]);
    addRow(["Date Installed", formatDate(billingRecord.dateInstalled)]);
    addRow(["PPPOE Username", billingRecord.username]);
    addRow(["Connection Type", billingRecord.connectionType]);
    addRow(["Router Model", billingRecord.routerModel]);
    addRow(["Router Serial Number", billingRecord.routerModemSN]);
    addRow(["Group", billingRecord.sessionGroup]);
    addRow(["Mikrotik ID", billingRecord.mikrotikId]);
    addRow(["LCP", billingRecord.lcp]);
    addRow(["NAP", billingRecord.nap]);
    addRow(["VLAN", billingRecord.vlan]);
    addRow(["PORT", billingRecord.port]);
    addRow([]);

    addRow(["--- BILLING DETAILS ---"]);
    addRow(["Account Number", billingRecord.applicationId || billingRecord.accountNo || (billingRecord as any).account_no]);
    addRow(["Billing Status", billingRecord.billingStatus]);
    addRow(["Billing Day", billingRecord.billingDay]);
    // Billing Type, VAT Type and Prepaid Expiration are each rendered conditionally in the
    // Billing Details section, so the export guards them the same way — an account without a
    // value produces no row instead of a blank one. Order matches the on-screen section.
    if (billingRecord.generationType) {
      addRow(["Billing Type", billingRecord.generationType]);
    }
    const vatExportLabel = typeof billingRecord.vatEnabled === 'boolean'
      ? (billingRecord.vatEnabled ? 'VAT Included' : 'No VAT')
      : billingRecord.vatType;
    if (vatExportLabel) {
      addRow(["VAT", vatExportLabel]);
    }
    if (billingRecord.withholdingEnabled) {
      addRow(["Withholding", `${billingRecord.withholdingPercentage ?? 0}%`]);
    }
    if (billingRecord.prepaidExpiration) {
      addRow(["Prepaid Expiration", formatDateTime(billingRecord.prepaidExpiration)]);
    }
    addRow(["Plan", billingRecord.plan]);
    addRow(["Account Balance", billingRecord.accountBalance]);
    addRow(["Total Paid", billingRecord.totalPaid]);
    addRow([]);

    const sections = [
      { key: "invoices", title: "Invoices", cols: relatedDataColumns.invoices },
      { key: "statementOfAccounts", title: "Statement of Accounts", cols: relatedDataColumns.statementOfAccounts },
      { key: "paymentPortalLogs", title: "Payment Portal Logs", cols: relatedDataColumns.paymentPortalLogs },
      { key: "transactions", title: "Transactions", cols: relatedDataColumns.transactions },
      { key: "staggered", title: "Staggered Payments", cols: relatedDataColumns.staggered },
      { key: "discounts", title: "Discounts", cols: relatedDataColumns.discounts },
      { key: "serviceOrders", title: "Service Orders", cols: relatedDataColumns.serviceOrders },
      { key: "reconnectionLogs", title: "Reconnection Logs", cols: relatedDataColumns.reconnectionLogs },
      { key: "disconnectedLogs", title: "Disconnected Logs", cols: relatedDataColumns.disconnectedLogs },
      { key: "detailsUpdateLogs", title: "Details Update Logs", cols: relatedDataColumns.detailsUpdateLogs },
      { key: "planChangeLogs", title: "Plan Change Logs", cols: relatedDataColumns.planChangeLogs },
      { key: "serviceChargeLogs", title: "Service Charge Logs", cols: relatedDataColumns.serviceChargeLogs },
      { key: "changeDueLogs", title: "Change Due Logs", cols: relatedDataColumns.changeDueLogs },
      { key: "securityDeposits", title: "Security Deposits", cols: relatedDataColumns.securityDeposits },
      { key: "jobOrders", title: "Job Orders", cols: relatedDataColumns.customerJobOrders },
      { key: "applications", title: "Applications", cols: relatedDataColumns.applications }
    ];

    sections.forEach(sec => {
      const data = fullRelatedData[sec.key];
      if (data && data.length > 0) {
        addRow([`--- ${sec.title.toUpperCase()} ---`]);
        const keys = sec.cols.map((c: any) => c.key);
        const headers = sec.cols.map((c: any) => c.label);
        addRow(headers);
        data.forEach((item: any) => {
          const rowData = keys.map((k: string) => {
             let val = item[k];
             if (k === 'created_at' || k === 'updated_at' || k === 'date') val = formatDate(val);
             if (typeof val === 'object' && val !== null) {
                try { val = JSON.stringify(val); } catch(e) {}
             }
             return val;
          });
          addRow(rowData);
        });
        addRow([]);
      }
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Customer_Export_${billingRecord.applicationId || 'Unknown'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Unified return with resizing wrapper
  return (
    <div
      className={`flex flex-col relative md:border-l overflow-hidden ${
        isMobile ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]' : 'h-full'
      } ${isDarkMode
        ? 'bg-gray-900 text-white border-white border-opacity-30'
        : 'bg-white text-gray-900 border-gray-300'
        }`}
      style={{ width: isMobile ? '100%' : `${detailsWidth}px` }}
    >
      {!isMobile && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-[10001]"
          style={{
            backgroundColor: isResizing ? (colorPalette?.primary || '#7c3aed') : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (!isResizing) {
              e.currentTarget.style.backgroundColor = colorPalette?.accent || '#7c3aed';
            }
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
          onMouseDown={handleMouseDownResize}
        />
      )}

      {loadingInvoice || loadingSOARecord || loadingPaymentPortalLog || loadingTransaction || loadingServiceOrder || loadingLcpNap ? (
        <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-white'}`}>
          <div className="flex flex-col items-center space-y-4">
            <Loader2
              className="animate-spin h-10 w-10 text-blue-500"
            />
            <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Fetching details...
            </p>
          </div>
        </div>
      ) : selectedLcpNapLocation ? (
        <div className="h-full w-full overflow-hidden">
          <Suspense fallback={
            <div className={`h-full w-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-white'}`}>
              <Loader2
                className="animate-spin h-8 w-8"
                style={{ color: colorPalette?.primary || '#f97316' }}
              />
            </div>
          }>
            <LcpNapLocationDetails
              location={selectedLcpNapLocation}
              onClose={() => setSelectedLcpNapLocation(null)}
              externalWidth={detailsWidth}
            />
          </Suspense>
        </div>
      ) : selectedSOARecord ? (
        <div className="h-full w-full overflow-hidden">
          <SOADetails
            soaRecord={selectedSOARecord}
            onClose={() => setSelectedSOARecord(null)}
            onViewCustomer={() => setSelectedSOARecord(null)}
          />
        </div>
      ) : selectedInvoice ? (
        <div className="h-full w-full overflow-hidden">
          <InvoiceDetails
            invoiceRecord={selectedInvoice}
            onClose={() => setSelectedInvoice(null)}
            onViewCustomer={() => setSelectedInvoice(null)}
          />
        </div>
      ) : selectedPaymentPortalLog ? (
        <div className="h-full w-full overflow-hidden">
          <PaymentPortalDetails
            record={selectedPaymentPortalLog}
            onClose={() => setSelectedPaymentPortalLog(null)}
            onViewCustomer={() => setSelectedPaymentPortalLog(null)}
          />
        </div>
      ) : selectedTransaction ? (
        <div className="h-full w-full overflow-hidden">
          <TransactionListDetails
            transaction={selectedTransaction}
            onClose={() => setSelectedTransaction(null)}
            onViewCustomer={() => setSelectedTransaction(null)}
          />
        </div>
      ) : selectedServiceOrder ? (
        <div className="h-full w-full overflow-hidden">
          <ServiceOrderDetails
            serviceOrder={selectedServiceOrder}
            onClose={() => setSelectedServiceOrder(null)}
            onRefresh={onRefresh}
          />
        </div>
      ) : (
        <>
          <div className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-gray-100 border-gray-200'
            }`}>
            <h1 className={`text-base sm:text-lg font-semibold truncate pr-4 min-w-0 flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`} title={`${billingRecord.applicationId} | ${billingRecord.customerName} | ${billingRecord.address}`}>
              {billingRecord.applicationId} | <span className="uppercase">{billingRecord.customerName}</span> | <span className="uppercase">{billingRecord.address}</span>
            </h1>
            <div className="flex items-center justify-end space-x-1.5 sm:space-x-2 flex-shrink-0">
              <button
                onClick={handleExportCSV}
                className={`p-2 rounded transition-colors ${isDarkMode
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                  }`}
                title="Export to CSV"
              >
                <Download size={18} />
              </button>
              {/* Prepaid Expiration Override — replaces the old Print action.
                  Hidden for anything but a prepaid account: postpaid access is governed by
                  invoices, so there is no service period here to adjust. */}
              {isPrepaidAccount && hasPermission('customer.prepaid-override') && (
                <button
                  onClick={() => setShowPrepaidOverrideModal(true)}
                  className={`p-2 rounded transition-colors ${isDarkMode
                    ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  title="Request Prepaid Expiration Override"
                >
                  <Clock size={18} />
                </button>
              )}
              {hasPermission('customer.so-request') && (
                <button
                  onClick={handleWrenchClick}
                  className={`p-2 rounded transition-colors ${isDarkMode
                    ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  title="Service Order Request"
                >
                  <Wrench size={18} />
                </button>
              )}
              {hasPermission('customer.details-edit') && (
                <button
                  onClick={handleEditClick}
                  className={`p-2 rounded transition-colors ${isDarkMode
                    ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  title="Edit Customer Details"
                >
                  <Edit size={18} />
                </button>
              )}
              {hasPermission('customer.attachment') && (
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
              )}
              {hasPermission('customer.transact') && (
                <button
                  onClick={handleTransactClick}
                  className="px-3 py-1 rounded text-sm transition-colors text-white"
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
                >
                  Transact
                </button>
              )}
              
              {/* Navigation Chevrons */}
              {(onPrevious || onNext) && (
                <div className="flex items-center">
                  <button
                    onClick={onPrevious}
                    disabled={!onPrevious}
                    className={`p-2 rounded transition-colors ${!onPrevious ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode
                      ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                      }`}
                    title="Previous Record"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={onNext}
                    disabled={!onNext}
                    className={`p-2 rounded transition-colors ${!onNext ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode
                      ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                      }`}
                    title="Next Record"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              )}

              <div className="relative">
                <button
                  onClick={() => setShowColumnVisibility(!showColumnVisibility)}
                  className={`p-2 rounded transition-colors ${isDarkMode
                    ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  title="Column Visibility"
                >
                  <Settings size={18} />
                </button>
                {showColumnVisibility && (
                  <div className={`absolute right-0 mt-2 w-80 rounded-lg shadow-lg border z-50 max-h-96 overflow-y-auto ${isDarkMode
                    ? 'bg-gray-800 border-gray-700'
                    : 'bg-white border-gray-200'
                    }`}>
                    <div className={`px-4 py-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                      }`}>
                      <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                        }`}>Column Visibility & Order</h3>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={selectAllColumns}
                          className="text-blue-600 hover:text-blue-700 text-xs"
                        >
                          Show All
                        </button>
                        <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                        <button
                          onClick={deselectAllColumns}
                          className="text-blue-600 hover:text-blue-700 text-xs"
                        >
                          Hide All
                        </button>
                        <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                        <button
                          onClick={resetFieldOrder}
                          className="text-blue-600 hover:text-blue-700 text-xs"
                        >
                          Reset Order
                        </button>
                      </div>
                    </div>
                    <div className="p-2">
                      {Object.entries({
                        customerDetails: 'Customer Details',
                        technicalDetails: 'Technical Details',
                        billingDetails: 'Billing Details'
                      }).map(([sectionKey, sectionLabel]) => (
                        <div key={sectionKey} className={`mb-2 border rounded ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                          }`}>
                          <div
                            className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'
                              }`}
                            onClick={() => toggleSectionExpansion(sectionKey)}
                          >
                            <div className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={columnVisibility[sectionKey]}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleColumnVisibility(sectionKey);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                                }`}>{sectionLabel}</span>
                            </div>
                            {expandedSection === sectionKey ? (
                              <ChevronDown size={16} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
                            ) : (
                              <ChevronRight size={16} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
                            )}
                          </div>
                          {expandedSection === sectionKey && (
                            <div className={`px-2 pb-2 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                              }`}>
                              <div className={`text-xs mt-2 mb-1 px-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                                }`}>
                                Drag to reorder fields
                              </div>
                              {fieldOrder[sectionKey].map((fieldKey: string, index: number) => (
                                <div
                                  key={fieldKey}
                                  draggable
                                  onDragStart={() => handleDragStart(sectionKey, index)}
                                  onDragOver={handleDragOver}
                                  onDrop={() => handleDrop(sectionKey, index)}
                                  onDragEnd={handleDragEnd}
                                  className={`flex items-center space-x-2 px-2 py-1.5 rounded cursor-move transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                                    } ${draggedItem?.section === sectionKey && draggedItem?.index === index
                                      ? isDarkMode ? 'bg-gray-600' : 'bg-gray-200'
                                      : ''
                                    }`}
                                >
                                  <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                                    }`}>☰</span>
                                  <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>
                                    {getFieldLabel(fieldKey)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={handleClose}
                className={`p-2 rounded transition-colors ${isDarkMode
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                  }`}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className={`flex-1 min-h-0 ${isMobile ? 'overflow-y-auto block' : 'flex flex-col overflow-hidden'}`}>
            <div className={`p-4 sm:p-6 space-y-4 sm:space-y-6 ${isMobile ? 'overflow-visible' : 'flex-1 overflow-y-auto'}`}>
              {columnVisibility.customerDetails && (
                <div className="space-y-4">
                  <h3 className={`font-semibold text-sm mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>Customer Details</h3>
                  {fieldOrder.customerDetails.map((fieldKey: string) => (
                    <React.Fragment key={fieldKey}>
                      {renderField(fieldKey, billingRecord)}
                    </React.Fragment>
                  ))}
                </div>
              )}

              {columnVisibility.technicalDetails && (
                <div className="space-y-4">
                  <h3 className={`font-semibold text-sm mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>Technical Details</h3>
                  {fieldOrder.technicalDetails.map((fieldKey: string) => (
                    <React.Fragment key={fieldKey}>
                      {renderField(fieldKey, billingRecord)}
                    </React.Fragment>
                  ))}
                </div>
              )}

              {columnVisibility.billingDetails && (
                <div className="space-y-4">
                  <h3 className={`font-semibold text-sm mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>Billing Details</h3>
                  {fieldOrder.billingDetails.map((fieldKey: string) => (
                    <React.Fragment key={fieldKey}>
                      {renderField(fieldKey, billingRecord)}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>

            <div className={`border-t flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
              }`}></div>

            <div className={`${isMobile ? 'overflow-visible pb-24' : 'flex-1 overflow-y-auto'}`}>
              {/* Related Invoices */}
              <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className={`w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between`}>
                  <div className="flex items-center space-x-2">
                    <span className={`font-medium text-sm sm:text-base ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>Related Invoices</span>
                    <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded ${isDarkMode
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-300 text-gray-900'
                      }`}>{relatedDataCounts.invoices}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExpandModalOpen('invoices');
                      }}
                      className="text-xs sm:text-sm transition-colors hover:underline"
                      style={{ color: colorPalette?.primary || '#7c3aed' }}
                    >
                      Expand
                    </button>
                  </div>
                </div>

                {relatedDataCounts.invoices > 0 && (
                  <div className="px-4 sm:px-6 pb-3 sm:pb-4 overflow-x-auto w-full">
                    <RelatedDataTable
                      data={relatedData.invoices}
                      columns={relatedDataColumns.invoices}
                      isDarkMode={isDarkMode}
                      onRowClick={handleInvoiceRowClick}
                    />
                  </div>
                )}
              </div>

              {/* Related Statement of Accounts */}
              <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className={`w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between`}>
                  <div className="flex items-center space-x-2">
                    <span className={`font-medium text-sm sm:text-base ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Related Statement of Accounts</span>
                    <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded ${isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'}`}>{relatedDataCounts.statementOfAccounts}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExpandModalOpen('statementOfAccounts');
                      }}
                      className="text-xs sm:text-sm transition-colors hover:underline"
                      style={{ color: colorPalette?.primary || '#7c3aed' }}
                    >
                      Expand
                    </button>
                  </div>
                </div>

                {relatedDataCounts.statementOfAccounts > 0 && (
                  <div className="px-4 sm:px-6 pb-3 sm:pb-4 overflow-x-auto w-full">
                    <RelatedDataTable
                      data={relatedData.statementOfAccounts}
                      columns={relatedDataColumns.statementOfAccounts}
                      isDarkMode={isDarkMode}
                      onRowClick={handleSOARowClick}
                    />
                  </div>
                )}
              </div>

              {/* Related Payment Portal Logs */}
              <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className={`w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between`}>
                  <div className="flex items-center space-x-2">
                    <span className={`font-medium text-sm sm:text-base ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>Related Payment Portal Logs</span>
                    <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded ${isDarkMode
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-300 text-gray-900'
                      }`}>{relatedDataCounts.paymentPortalLogs}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExpandModalOpen('paymentPortalLogs');
                      }}
                      className="text-xs sm:text-sm transition-colors hover:underline"
                      style={{ color: colorPalette?.primary || '#7c3aed' }}
                    >
                      Expand
                    </button>
                  </div>
                </div>

                {relatedDataCounts.paymentPortalLogs > 0 && (
                  <div className="px-4 sm:px-6 pb-3 sm:pb-4 overflow-x-auto w-full">
                    <RelatedDataTable
                      data={relatedData.paymentPortalLogs}
                      columns={relatedDataColumns.paymentPortalLogs}
                      isDarkMode={isDarkMode}
                      onRowClick={handlePaymentPortalRowClick}
                    />
                  </div>
                )}
              </div>

              {/* Related Transactions */}
              <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className={`w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between`}>
                  <div className="flex items-center space-x-2">
                    <span className={`font-medium text-sm sm:text-base ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>Related Transactions</span>
                    <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded ${isDarkMode
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-300 text-gray-900'
                      }`}>{relatedDataCounts.transactions}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExpandModalOpen('transactions');
                      }}
                      className="text-xs sm:text-sm transition-colors hover:underline"
                      style={{ color: colorPalette?.primary || '#7c3aed' }}
                    >
                      Expand
                    </button>
                  </div>
                </div>

                {relatedDataCounts.transactions > 0 && (
                  <div className="px-4 sm:px-6 pb-3 sm:pb-4 overflow-x-auto w-full">
                    <RelatedDataTable
                      data={relatedData.transactions}
                      columns={relatedDataColumns.transactions}
                      isDarkMode={isDarkMode}
                      onRowClick={handleTransactionRowClick}
                    />
                  </div>
                )}
              </div>

              {/* Related Staggered */}
              <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className={`w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between`}>
                  <div className="flex items-center space-x-2">
                    <span className={`font-medium text-sm sm:text-base ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>Related Staggered</span>
                    <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded ${isDarkMode
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-300 text-gray-900'
                      }`}>{relatedDataCounts.staggered}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExpandModalOpen('staggered');
                      }}
                      className="text-xs sm:text-sm transition-colors hover:underline"
                      style={{ color: colorPalette?.primary || '#7c3aed' }}
                    >
                      Expand
                    </button>
                  </div>
                </div>

                {relatedDataCounts.staggered > 0 && (
                  <div className="px-4 sm:px-6 pb-3 sm:pb-4 overflow-x-auto w-full">
                    <RelatedDataTable
                      data={relatedData.staggered}
                      columns={relatedDataColumns.staggered}
                      isDarkMode={isDarkMode}
                    />
                  </div>
                )}
              </div>

              {/* Related Discounts */}
              <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className={`w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between`}>
                  <div className="flex items-center space-x-2">
                    <span className={`font-medium text-sm sm:text-base ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>Related Discounts</span>
                    <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded ${isDarkMode
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-300 text-gray-900'
                      }`}>{relatedDataCounts.discounts}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExpandModalOpen('discounts');
                      }}
                      className="text-xs sm:text-sm transition-colors hover:underline"
                      style={{ color: colorPalette?.primary || '#7c3aed' }}
                    >
                      Expand
                    </button>
                  </div>
                </div>

                {relatedDataCounts.discounts > 0 && (
                  <div className="px-4 sm:px-6 pb-3 sm:pb-4 overflow-x-auto w-full">
                    <RelatedDataTable
                      data={relatedData.discounts}
                      columns={relatedDataColumns.discounts}
                      isDarkMode={isDarkMode}
                    />
                  </div>
                )}
              </div>

              {/* Other Sections */}
              {[{ key: 'serviceOrders', label: 'Related Service Orders', dataKey: 'serviceOrders' },
              { key: 'reconnectionLogs', label: 'Related Reconnection Logs', dataKey: 'reconnectionLogs' },
              { key: 'disconnectedLogs', label: 'Related Disconnected Logs', dataKey: 'disconnectedLogs' },
              { key: 'detailsUpdateLogs', label: 'Related Details Update Logs', dataKey: 'detailsUpdateLogs' },
              { key: 'planChangeLogs', label: 'Related Plan Change Logs', dataKey: 'planChangeLogs' },
              { key: 'serviceChargeLogs', label: 'Related Service Charge Logs', dataKey: 'serviceChargeLogs' },
              { key: 'changeDueLogs', label: 'Related Change Due Logs', dataKey: 'changeDueLogs' },
              { key: 'securityDeposits', label: 'Related Security Deposits', dataKey: 'securityDeposits' }
              ].map((section) => (
                <div key={section.key} className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                  }`}>
                  <div className={`w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between`}>
                    <div className="flex items-center space-x-2">
                      <span className={`font-medium text-sm sm:text-base ${isDarkMode ? 'text-white' : 'text-gray-900'
                        }`}>{section.label}</span>
                      <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded ${isDarkMode
                        ? 'bg-gray-600 text-white'
                        : 'bg-gray-300 text-gray-900'
                        }`}>{relatedDataCounts[section.key]}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExpandModalOpen(section.key);
                        }}
                        className="text-xs sm:text-sm transition-colors hover:underline"
                        style={{ color: colorPalette?.primary || '#7c3aed' }}
                      >
                        Expand
                      </button>
                    </div>
                  </div>

                  {relatedDataCounts[section.key] > 0 && (
                    <div className="px-4 sm:px-6 pb-3 sm:pb-4 overflow-x-auto w-full">
                      <RelatedDataTable
                        data={relatedData[section.key]}
                        columns={relatedDataColumns[section.dataKey as keyof typeof relatedDataColumns]}
                        isDarkMode={isDarkMode}
                        onRowClick={section.key === 'serviceOrders' ? handleServiceOrderRowClick : undefined}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <TransactConfirmationModal
            isOpen={showTransactModal}
            onConfirm={handleTransactConfirm}
            onCancel={handleTransactCancel}
            amount={`₱${billingRecord.accountBalance || '0.00'}`}
            description={`Transaction for ${billingRecord.customerName} - Account: ${billingRecord.applicationId}`}
            billingRecord={billingRecord}
          />

          <TransactionFormModal
            isOpen={showTransactionFormModal}
            onClose={handleTransactionFormClose}
            onSave={handleTransactionFormSave}
            billingRecord={billingRecord}
          />

          <StaggeredInstallationFormModal
            isOpen={showStaggeredInstallationModal}
            onClose={handleStaggeredInstallationFormClose}
            onSave={handleStaggeredInstallationFormSave}
            customerData={{
              accountNo: billingRecord.applicationId,
              fullName: billingRecord.customerName,
              contactNo: billingRecord.contactNumber,
              emailAddress: billingRecord.emailAddress || billingRecord.email || '',
              address: billingRecord.address?.split(',')[0] || '',
              plan: billingRecord.plan,
              barangay: billingRecord.barangay || '',
              city: billingRecord.city || ''
            }}
          />

          <DiscountFormModal
            isOpen={showDiscountModal}
            onClose={handleDiscountFormClose}
            onSave={handleDiscountFormSave}
            customerData={{
              accountNo: billingRecord.applicationId,
              fullName: billingRecord.customerName,
              address: billingRecord.address
            }}
          />

          {showSORequestConfirmModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className={`rounded-lg p-6 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-800' : 'bg-white'
                }`}>
                <h3 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>Create Service Order Request</h3>
                <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Do you want to create a service order request for account <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>{billingRecord.applicationId}</span>?
                </p>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={handleSORequestCancel}
                    className={`px-4 py-2 rounded transition-colors ${isDarkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-gray-300 hover:bg-gray-400 text-gray-900'
                      }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSORequestConfirm}
                    className="px-4 py-2 rounded transition-colors text-white"
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
                  >
                    Yes, Continue
                  </button>
                </div>
              </div>
            </div>
          )}

          <SORequestFormModal
            isOpen={showSORequestFormModal}
            onClose={handleSORequestFormClose}
            onSave={handleSORequestFormSave}
            customerData={{
              accountNo: billingRecord.applicationId,
              dateInstalled: billingRecord.dateInstalled || '',
              fullName: billingRecord.customerName,
              contactNumber: billingRecord.contactNumber || '',
              plan: billingRecord.plan || '',
              username: billingRecord.username || '',
              emailAddress: billingRecord.emailAddress || billingRecord.email || ''
            }}
          />





        </>
      )}

      {expandedModalSection && (
        <div className="absolute inset-0 flex flex-col" style={{ backgroundColor: isDarkMode ? '#111827' : '#ffffff', zIndex: 10000 }}>
          {/* Header */}
          <div className={`px-4 md:px-6 py-4 flex items-center justify-between border-b ${
            isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-center space-x-2 md:space-x-4">
              <div className="flex items-center space-x-2 md:space-x-3">
                <h2 className={`text-lg md:text-xl font-bold truncate max-w-[200px] md:max-w-none ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {expandedModalSection === 'invoices' && 'All Related Invoices'}
                  {expandedModalSection === 'statementOfAccounts' && 'All Related Statement of Accounts'}
                  {expandedModalSection === 'paymentPortalLogs' && 'All Related Payment Portal Logs'}
                  {expandedModalSection === 'transactions' && 'All Related Transactions'}
                  {expandedModalSection === 'staggered' && 'All Related Staggered'}
                  {expandedModalSection === 'discounts' && 'All Related Discounts'}
                  {expandedModalSection === 'serviceOrders' && 'All Related Service Orders'}
                  {expandedModalSection === 'reconnectionLogs' && 'All Related Reconnection Logs'}
                  {expandedModalSection === 'disconnectedLogs' && 'All Related Disconnected Logs'}
                  {expandedModalSection === 'detailsUpdateLogs' && 'All Related Details Update Logs'}
                  {expandedModalSection === 'planChangeLogs' && 'All Related Plan Change Logs'}
                  {expandedModalSection === 'serviceChargeLogs' && 'All Related Service Charge Logs'}
                  {expandedModalSection === 'changeDueLogs' && 'All Related Change Due Logs'}
                  {expandedModalSection === 'securityDeposits' && 'All Related Security Deposits'}
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
          <div className="flex-1 overflow-auto relative">
            <RelatedDataTable
              data={fullRelatedData[expandedModalSection] || []}
              columns={relatedDataColumns[expandedModalSection as keyof typeof relatedDataColumns]}
              isDarkMode={isDarkMode}
              fullContent={expandedModalSection === 'detailsUpdateLogs'}
              onRowClick={(row) => {
                if (expandedModalSection === 'invoices') {
                  setExpandedModalSection(null);
                  handleInvoiceRowClick(row);
                } else if (expandedModalSection === 'statementOfAccounts') {
                  setExpandedModalSection(null);
                  handleSOARowClick(row);
                } else if (expandedModalSection === 'paymentPortalLogs') {
                  setExpandedModalSection(null);
                  handlePaymentPortalRowClick(row);
                } else if (expandedModalSection === 'transactions') {
                  setExpandedModalSection(null);
                  handleTransactionRowClick(row);
                } else if (expandedModalSection === 'serviceOrders') {
                  setExpandedModalSection(null);
                  handleServiceOrderRowClick(row);
                }
              }}
            />
          </div>
        </div>
      )}

      <CustomerDetailsEditModal
        isOpen={showDetailsEditModal}
        onClose={handleDetailsEditClose}
        onSave={handleDetailsEditSave}
        recordData={billingRecord}
        editType={editType}
      />

      {showAttachmentModal && (
        <CustomerAttachmentModal
          isOpen={showAttachmentModal}
          onClose={() => setShowAttachmentModal(false)}
          onSave={(formData) => {
            if (onRefresh) onRefresh();
          }}
          customerData={{
            id: billingRecord.id || billingRecord.applicationId,
            first_name: billingRecord.firstName || billingRecord.customerName?.split(' ')[0],
            last_name: billingRecord.lastName || billingRecord.customerName?.split(' ').slice(1).join(' '),
            proof_of_billing_url: billingRecord.proofOfBillingUrl,
            government_valid_id_url: billingRecord.governmentValidIdUrl,
            second_government_valid_id_url: billingRecord.secondGovernmentValidIdUrl,
            house_front_picture_url: billingRecord.houseFrontPicture,
            document_attachment_url: billingRecord.documentAttachmentUrl,
            other_isp_bill_url: billingRecord.otherIspBillUrl
          }}
        />
      )}

      {/* ── IP scheme picker ──────────────────────────────────────────────────
          Portalled to <body> so the details sections' scrolling and the panel's
          overflow-hidden cannot clip it, and so it sits above the panel's own
          stacking context. Positioned in viewport coordinates from the arrow that
          opened it, which is why scroll/resize dismiss it. */}
      {ipSchemeMenu && createPortal(
        <div
          role="menu"
          aria-label="Open IP as URL"
          // Keep clicks inside from reaching the document-level dismiss handler.
          onMouseDown={(e) => e.stopPropagation()}
          className={`fixed z-[10070] w-52 rounded-lg border shadow-2xl overflow-hidden ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-200'
            }`}
          style={{ top: ipSchemeMenu.top, right: ipSchemeMenu.right }}
        >
          <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${isDarkMode
            ? 'bg-gray-900/50 text-gray-500'
            : 'bg-gray-50 text-gray-400'
            }`}>
            Open in new tab
          </div>

          {(['https', 'http'] as const).map(scheme => {
            const url = `${scheme}://${ipSchemeMenu.ip}`;

            return (
              // A real anchor rather than a button calling window.open: popup blockers leave
              // user-initiated anchors alone, and it keeps the browser's own affordances —
              // middle-click, ctrl/cmd-click, "Open in new window", copy link address — which a
              // click handler would swallow. rel guards the opener against the target page.
              <a
                key={scheme}
                role="menuitem"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIpSchemeMenu(null)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors border-t first:border-t-0 ${isDarkMode
                  ? 'border-gray-700 hover:bg-gray-700 text-gray-200'
                  : 'border-gray-100 hover:bg-gray-50 text-gray-700'
                  }`}
              >
                <span className="truncate font-mono text-xs" title={url}>{url}</span>
                <ExternalLink size={14} className="flex-shrink-0 opacity-50" />
              </a>
            );
          })}
        </div>,
        document.body
      )}

      {/* Prepaid Expiration Override request form. Portals itself to body, so it clears the
          overlay panel CustomerDetails is rendered inside. */}
      <PrepaidOverrideModal
        isOpen={showPrepaidOverrideModal}
        onClose={() => setShowPrepaidOverrideModal(false)}
        accountNo={billingRecord.applicationId}
        customerName={billingRecord.customerName}
        currentExpiration={billingRecord.prepaidExpiration}
      />
    </div>
  );
};

export default BillingDetails;
