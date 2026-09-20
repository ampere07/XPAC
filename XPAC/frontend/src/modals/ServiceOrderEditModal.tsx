import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar, ChevronDown, Minus, Plus, Eraser, CheckCircle } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { UserData } from '../types/api';
import apiClient from '../config/api';
import { getAllInventoryItems, InventoryItem } from '../services/inventoryItemService';
import { createServiceOrderItems, ServiceOrderItem, deleteServiceOrderItems } from '../services/serviceOrderItemService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import { concernService, Concern } from '../services/concernService';
import { getUsedPorts } from '../services/portService';
import { getAllLCPNAPs, LCPNAP } from '../services/lcpnapService';
import { routerModelService, RouterModel } from '../services/routerModelService';
import { getBillingRecordDetails } from '../services/billingService';
import { technicianService } from '../services/technicianService';
import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import SearchableField from '../components/common/SearchableField';




interface ServiceOrderEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: any) => void;
  serviceOrderData?: any;
  isTech?: boolean;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface OrderItem {
  itemId: string;
  quantity: string;
}

interface ServiceOrderEditFormData {
  accountNo: string;
  dateInstalled: string;
  fullName: string;
  contactNumber: string;
  emailAddress: string;
  plan: string;

  username: string;
  connectionType: string;
  routerModemSN: string;
  lcp: string;
  nap: string;
  port: string;
  vlan: string;
  supportStatus: string;
  visitStatus: string;
  repairCategory: string;
  visitBy: string;
  visitWith: string;
  visitWithOther: string;
  visitRemarks: string;
  clientSignature: string;
  itemName1: string;
  timeIn: string;
  modemSetupImage: string;
  timeOut: string;
  assignedEmail: string;
  concern: string;
  concernRemarks: string;
  modifiedBy: string;
  modifiedDate: string;
  userEmail: string;
  supportRemarks: string;
  serviceCharge: string;
  status: string;
  newRouterModemSN: string;
  newLcp: string;
  newNap: string;
  newPort: string;
  newVlan: string;
  routerModel: string;
  newPlan: string;
  newLcpnap: string;
  // Customer address fields, editable only under the Relocation concern
  address: string;
  barangay: string;
  city: string;
  region: string;
}

interface ImageFiles {
  timeInFile: File | null;
  modemSetupFile: File | null;
  timeOutFile: File | null;
  clientSignatureFile: File | null;
}

/**
 * Support statuses that close the visit, and the visit status each one implies.
 *
 * The Visit Status field is only shown under "For Visit", so on these two there
 * is no field for the user to set it in — that is what left resolved and failed
 * tickets carrying no visit status at all. Any support status not listed here
 * leaves the visit status exactly as the user left it.
 *
 * Kept in one place because the rule is applied three times — on change, again
 * on save, and once more to decide whether the payload carries visit_status —
 * and the three drifting apart is what would put a value on screen that never
 * reaches the row.
 */
const CLOSING_VISIT_STATUS: Record<string, string> = {
  Resolved: 'Done',
  Failed: 'Failed'
};

/**
 * The repair categories that put the new LCP/NAP/Port fields on screen and send
 * them, because the work moves the customer to a different line.
 *
 * All four required the full set — router serial, LCP-NAP, port, VLAN, router
 * model — because a migration or a transfer always replaces the whole
 * installation. A reactivation does not, so it is not listed here; see
 * REACTIVATE_CATEGORIES.
 */
const RELOCATION_CATEGORIES = ['Migrate', 'Relocate', 'Relocate Router', 'Transfer LCP/NAP/PORT'];

/**
 * How a reactivation is spelled, lowercased.
 *
 * "Reactivate" is what the picker offers. "Reactivation" is what older rows and
 * the server's migration branch say, and a ticket saved under it has to keep
 * behaving like one when it is reopened, so both are read. Mirrors
 * ServiceOrderApiController::REACTIVATE_CATEGORIES.
 */
const REACTIVATE_CATEGORIES = ['reactivate', 'reactivation'];

/** Is this repair category a reactivation, whichever way it is spelled? */
const isReactivateCategory = (repairCategory?: string | null): boolean =>
  REACTIVATE_CATEGORIES.includes(String(repairCategory ?? '').toLowerCase().trim());

/**
 * billing_status.id 5 is Pullout — the account has been physically pulled out
 * and its portal login disabled (see App\Support\PulloutCategory, which is what
 * disables it).
 *
 * The only ticket worth raising against an account in that state is the one
 * that brings it back, so both pickers collapse to the reactivation option.
 * Offering "Relocate" or "Replace Router" on a pulled-out account invites a
 * visit for a service that is not connected.
 */
const PULLOUT_BILLING_STATUS_ID = 5;

/**
 * The repair categories, lifted out of the JSX so the pulled-out case can
 * narrow the list rather than duplicate it.
 */
const REPAIR_CATEGORY_OPTIONS = [
  { name: 'None' },
  { name: 'Fiber Relaying' },
  { name: 'Migrate' },
  { name: 'others' },
  { name: 'Pullout' },
  { name: 'Reactivate' },
  { name: 'Reboot/Reconfig Router' },
  { name: 'Relocate Router' },
  { name: 'Relocate' },
  { name: 'Replace Patch Cord' },
  { name: 'Replace Router' },
  { name: 'Resplice' },
  { name: 'Transfer LCP/NAP/PORT' },
  { name: 'Update Vlan' },
];

/** The single category a pulled-out account may be given. */
const REACTIVATE_REPAIR_CATEGORY = REPAIR_CATEGORY_OPTIONS.find(
  (option) => isReactivateCategory(option.name)
)!;

/** The concern to fall back on when the catalog has no reactivation entry. */
const REACTIVATE_CONCERN_FALLBACK = 'Reactivate';

/**
 * What the LCP-NAP and Port fields mean under this repair category.
 *
 * Three answers, not two: a relocation requires them as the new installation, a
 * reactivation offers them as an optional correction, and everything else does
 * not show them at all. Switching between the three is what has to clear them —
 * see handleInputChange.
 */
const lineFieldGroup = (repairCategory?: string | null): 'relocation' | 'reactivate' | 'none' => {
  if (RELOCATION_CATEGORIES.includes(String(repairCategory ?? ''))) return 'relocation';
  if (isReactivateCategory(repairCategory)) return 'reactivate';
  return 'none';
};

/**
 * Has the technician put the account on a different LCP, NAP or port?
 *
 * Compared the way the server compares them — trimmed and case-folded — so the
 * form and the API agree about what counts as a move, and a paste that differs
 * only in case does not read as one. A blank "new" value means the field was
 * left alone, not that the line was cleared, so it never counts as a change.
 *
 * The LCP and NAP come out of the single LCP-NAP picker, which is why they are
 * parsed here rather than read from two fields.
 */
const lineIdentityChanged = (current: { lcp: string; nap: string; port: string },
                             next: { lcp: string; nap: string; port: string }): string[] => {
  const normalize = (value?: string | null) => String(value ?? '').toLowerCase().trim();

  return (['lcp', 'nap', 'port'] as const).filter(field => {
    const proposed = normalize(next[field]);
    return proposed !== '' && proposed !== normalize(current[field]);
  });
};

/** Pull "LCP-008" and "NAP-02" out of the combined LCP-NAP picker value. */
const parseLcpNap = (lcpnap?: string | null): { lcp: string; nap: string } => {
  const value = String(lcpnap ?? '');
  const lcpMatch = value.match(/LCP-\d+/i);
  const napMatch = value.match(/NAP-\d+/i);

  return {
    lcp: lcpMatch ? lcpMatch[0].toUpperCase() : '',
    nap: napMatch ? napMatch[0].toUpperCase() : '',
  };
};

const ServiceOrderEditModal: React.FC<ServiceOrderEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  serviceOrderData,
  isTech
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);
  const sigCanvas = useRef<SignatureCanvas>(null);

  // The day a technician last moved this ticket's Visit Status, as the API
  // stored it. A DATE column, but MySQL drivers and JSON casting between them
  // can hand it back as "2026-09-05", "2026-09-05 00:00:00" or an ISO string,
  // so keep the leading date and drop whatever follows.
  const visitStatusDate = (() => {
    const raw = serviceOrderData?.visit_status_date ?? serviceOrderData?.visitStatusDate;
    const match = String(raw ?? '').match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
  })();

  const getCurrentUser = (): UserData | null => {
    try {
      const authData = localStorage.getItem('authData');
      if (authData) {
        return JSON.parse(authData);
      }
    } catch (error) {
      console.error('Error getting current user:', error);
    }
    return null;
  };

  const currentUser = getCurrentUser();
  const currentUserEmail = currentUser?.email || 'unknown@email.com';
  const isTechnician = typeof isTech !== 'undefined'
    ? isTech
    : (currentUser?.role_id === 2 || (typeof currentUser?.role === 'string' && currentUser.role.toLowerCase() === 'technician'));
  const isAdministratorOrSuperadmin = typeof isTech !== 'undefined'
    ? !isTech
    : (currentUser?.role_id === 1 || currentUser?.role_id === 8 || (typeof currentUser?.role === 'string' && ['administrator', 'superadmin', 'super admin', 'headtech'].includes(currentUser.role.toLowerCase())));

  // Relocation address fields are limited to Administrator (role 1) and SuperAdmin (role 7).
  // isAdministratorOrSuperadmin is deliberately not reused here: it also passes HeadTech (8),
  // misses SuperAdmin (7), and treats any non-technician as an admin when isTech is provided.
  const canEditRelocationAddress = !isTechnician && (
    currentUser?.role_id === 1 ||
    currentUser?.role_id === 7 ||
    (typeof currentUser?.role === 'string' && ['administrator', 'superadmin', 'super admin'].includes(currentUser.role.toLowerCase()))
  );

  const [technicians, setTechnicians] = useState<Array<{ name: string; id?: number }>>([]);
  const [technicianUsers, setTechnicianUsers] = useState<Array<{ name: string; email: string }>>([]);

  const [lcps, setLcps] = useState<string[]>([]);
  const [naps, setNaps] = useState<string[]>([]);
  const [usedPorts, setUsedPorts] = useState<string[]>([]);
  const [totalPorts, setTotalPorts] = useState<number>(32);
  const [lcpnaps, setLcpnaps] = useState<LCPNAP[]>([]);
  const [vlans, setVlans] = useState<string[]>([]);
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [plans, setPlans] = useState<string[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [routerModels, setRouterModels] = useState<RouterModel[]>([]);
  const [billingStatusId, setBillingStatusId] = useState<number | null>(null);

  // Location lookups for the Relocation address fields
  const [regions, setRegions] = useState<Array<{ id: number; name: string }>>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);
  // Snapshot of the customer's address when the modal opened, so only actual edits are sent
  const [originalAddress, setOriginalAddress] = useState({ address: '', barangay: '', city: '', region: '' });

  const [orderItems, setOrderItems] = useState<OrderItem[]>([{ itemId: '', quantity: '' }]);

  const [formData, setFormData] = useState<ServiceOrderEditFormData>({
    accountNo: '',
    dateInstalled: '',
    fullName: '',
    contactNumber: '',
    emailAddress: '',
    plan: '',

    username: '',
    connectionType: '',
    routerModemSN: '',
    lcp: '',
    nap: '',
    port: '',
    vlan: '',
    supportStatus: 'In Progress',
    visitStatus: 'In Progress',
    repairCategory: '',
    visitBy: '',
    visitWith: '',
    visitWithOther: '',
    visitRemarks: '',
    clientSignature: '',
    itemName1: '',
    timeIn: '',
    modemSetupImage: '',
    timeOut: '',
    assignedEmail: '',
    concern: '',
    concernRemarks: '',
    modifiedBy: currentUserEmail,
    modifiedDate: new Date().toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }),
    userEmail: currentUserEmail,
    supportRemarks: '',
    serviceCharge: '0.00',
    status: 'unused',
    newRouterModemSN: '',
    newLcp: '',
    newNap: '',
    newPort: '',
    newVlan: '',
    routerModel: '',
    newPlan: '',
    newLcpnap: '',
    address: '',
    barangay: '',
    city: '',
    region: ''
  });



  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  // Original assigned technician captured when the modal loads, used to detect reassignment
  const [originalAssignedEmail, setOriginalAssignedEmail] = useState<string>('');
  const [imageFiles, setImageFiles] = useState<ImageFiles>({
    timeInFile: null,
    modemSetupFile: null,
    timeOutFile: null,
    clientSignatureFile: null
  });
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [imagePreviews, setImagePreviews] = useState<{
    timeInFile: string | null;
    modemSetupFile: string | null;
    timeOutFile: string | null;
    clientSignatureFile: string | null;
  }>({
    timeInFile: null,
    modemSetupFile: null,
    timeOutFile: null,
    clientSignatureFile: null
  });

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  const formatDateForInput = (dateStr?: string): string => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '';
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return '';
    }
  };

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    checkDarkMode();

    const observer = new MutationObserver(() => {
      checkDarkMode();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchColorPalette = async () => {
      const palette = await settingsColorPaletteService.getActive();
      setColorPalette(palette);
    };
    fetchColorPalette();
  }, []);

  useEffect(() => {
    const fetchActiveImageSize = async () => {
      if (isOpen) {
        try {
          const imageSizeSettings = await getActiveImageSize();
          setActiveImageSize(imageSizeSettings);
          console.log('Active image size settings:', imageSizeSettings);
        } catch (error) {
          console.error('Error fetching active image size:', error);
        }
      }
    };
    fetchActiveImageSize();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      Object.values(imagePreviews).forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
      setImagePreviews({
        timeInFile: null,
        modemSetupFile: null,
        timeOutFile: null,
        clientSignatureFile: null
      });
      setOrderItems([{ itemId: '', quantity: '' }]);
      setOriginalAssignedEmail('');
    }
  }, [isOpen, imagePreviews]);

  useEffect(() => {
    const fetchRouterModels = async () => {
      if (isOpen) {
        try {
          const fetchedRouterModels = await routerModelService.getAllRouterModels();
          setRouterModels(fetchedRouterModels);
        } catch (error) {
          console.error('Failed to fetch router models:', error);
        }
      }
    };
    fetchRouterModels();
  }, [isOpen]);

  useEffect(() => {
    const fetchServiceOrderItems = async () => {
      if (isOpen && serviceOrderData) {
        const serviceOrderId = serviceOrderData.id;
        if (serviceOrderId) {
          try {
            const response = await apiClient.get(`/service-order-items?service_order_id=${serviceOrderId}`);
            const data = response.data as { success: boolean; data: any[] };

            if (data.success && Array.isArray(data.data)) {
              const items = data.data;

              if (items.length > 0) {
                const uniqueItems = new Map();

                items.forEach((item: any) => {
                  const key = item.item_name;
                  if (uniqueItems.has(key)) {
                    const existing = uniqueItems.get(key);
                    uniqueItems.set(key, {
                      itemId: item.item_name || '',
                      quantity: (parseInt(existing.quantity) + parseInt(item.quantity || 0)).toString()
                    });
                  } else {
                    uniqueItems.set(key, {
                      itemId: item.item_name || '',
                      quantity: item.quantity ? item.quantity.toString() : ''
                    });
                  }
                });

                const formattedItems = Array.from(uniqueItems.values());
                formattedItems.push({ itemId: '', quantity: '' });

                setOrderItems(formattedItems);
              } else {
                setOrderItems([{ itemId: '', quantity: '' }]);
              }
            }
          } catch (error) {
            setOrderItems([{ itemId: '', quantity: '' }]);
          }
        }
      }
    };

    fetchServiceOrderItems();
  }, [isOpen, serviceOrderData]);

  useEffect(() => {
    const fetchInventoryItems = async () => {
      if (isOpen) {
        try {
          const response = await getAllInventoryItems();

          if (response.success && Array.isArray(response.data)) {
            setInventoryItems(response.data);
          } else {
            setInventoryItems([]);
          }
        } catch (error) {
          setInventoryItems([]);
        }
      }
    };

    fetchInventoryItems();
  }, [isOpen]);

  useEffect(() => {
    const fetchTechnicians = async () => {
      try {
        const response = await technicianService.getAllTechnicians();
        if (response.success && Array.isArray(response.data)) {
          const techs = response.data.map(tech => {
            const firstName = (tech.first_name || '').trim();
            const mi = tech.middle_initial ? `${tech.middle_initial}. ` : '';
            const lastName = (tech.last_name || '').trim();
            return {
              id: tech.id,
              name: `${firstName} ${mi}${lastName}`.trim()
            };
          });
          setTechnicians(techs);
        }
      } catch (error) {
        console.error('Error fetching technicians:', error);
      }
    };

    const fetchTechnicianUsers = async () => {
      try {
        const response = await apiClient.get<{ success: boolean; data: any[] }>('/users');
        if (response.data.success && Array.isArray(response.data.data)) {
          const users = response.data.data
            .filter(user => {
              const role = typeof user.role === 'string' ? user.role : (user.role as any)?.role_name || '';
              return role.toLowerCase() === 'technician';
            })
            .map(user => {
              const firstName = (user.first_name || '').trim();
              const lastName = (user.last_name || '').trim();
              const fullName = `${firstName} ${lastName}`.trim();
              return {
                email: user.email_address || user.email || '',
                name: fullName || user.username || user.email_address || user.email || ''
              };
            })
            .filter(tech => tech.name);
          setTechnicianUsers(users);
        }
      } catch (error) {
        console.error('Error fetching technician users:', error);
      }
    };


    const fetchTechnicalDetails = async () => {
      try {
        const [lcpResponse, napResponse, vlanResponse, lcpnapsRes] = await Promise.all([
          apiClient.get<{ success: boolean; data: any[] }>('/lcp'),
          apiClient.get<{ success: boolean; data: any[] }>('/nap'),
          apiClient.get<{ success: boolean; data: any[] }>('/vlan'),
          getAllLCPNAPs('', 1, 1000)
        ]);

        if (lcpResponse.data.success && Array.isArray(lcpResponse.data.data)) {
          const lcpOptions = lcpResponse.data.data.map(item => item.lcp_name || item.lcp || item.name).filter(Boolean);
          setLcps(lcpOptions as string[]);
        }

        if (napResponse.data.success && Array.isArray(napResponse.data.data)) {
          const napOptions = napResponse.data.data.map(item => item.nap_name || item.nap || item.name).filter(Boolean);
          setNaps(napOptions as string[]);
        }

        if (vlanResponse.data.success && Array.isArray(vlanResponse.data.data)) {
          const vlanOptions = vlanResponse.data.data.map(item => item.value).filter(Boolean);
          setVlans(vlanOptions as string[]);
        }

        const planResponse = await apiClient.get<{ success: boolean; data: any[] }>('/plans');
        if (planResponse.data.success && Array.isArray(planResponse.data.data)) {
          setPlans(planResponse.data.data.map(p => {
            const name = p.plan_name || p.name;
            const price = p.price ? Math.floor(p.price) : '';
            return price ? `${name} - ${price}` : name;
          }).filter(Boolean));
        }

        if (lcpnapsRes.success && Array.isArray(lcpnapsRes.data)) {
          setLcpnaps(lcpnapsRes.data);
        }
      } catch (error) {
        console.error('Error fetching technical details:', error);
      }
    };

    const fetchConcerns = async () => {
      try {
        const data = await concernService.getAllConcerns();
        setConcerns(data);
      } catch (error) {
        console.error('Error fetching concerns:', error);
      }
    };

    const fetchLocations = async () => {
      try {
        const [fetchedRegions, fetchedCities, barangaysRes] = await Promise.all([
          getRegions(),
          getCities(),
          barangayService.getAll()
        ]);

        setRegions(Array.isArray(fetchedRegions) ? fetchedRegions : []);
        setAllCities(Array.isArray(fetchedCities) ? fetchedCities : []);
        setAllBarangays(barangaysRes.success && Array.isArray(barangaysRes.data) ? barangaysRes.data : []);
      } catch (error) {
        console.error('Error fetching locations:', error);
      }
    };

    if (isOpen) {
      fetchTechnicians();
      fetchTechnicianUsers();
      fetchTechnicalDetails();
      fetchConcerns();
      fetchLocations();
    }


  }, [isOpen]);

  useEffect(() => {
    const fetchUsedPorts = async () => {
      if (isOpen && formData.newLcpnap) {
        try {
          const serviceOrderId = serviceOrderData?.id;

          // Also fetch total ports for this LCP-NAP
          const lcpnapsRes = await getAllLCPNAPs(formData.newLcpnap, 1, 1);
          if (lcpnapsRes.success && Array.isArray(lcpnapsRes.data) && lcpnapsRes.data.length > 0) {
            const match = lcpnapsRes.data.find(item => item.lcpnap_name === formData.newLcpnap);
            if (match) {
              setTotalPorts(match.port_total || 32);
            }
          }

          const usedRes = await getUsedPorts(formData.newLcpnap, serviceOrderId);

          if (usedRes.success && usedRes.data) {
            setUsedPorts(usedRes.data.used);
            // Only update totalPorts if not already set by location fetch
            if (!totalPorts) setTotalPorts(usedRes.data.total);
          } else {
            setUsedPorts([]);
            if (!totalPorts) setTotalPorts(32);
          }
        } catch (error) {
          console.error('Error fetching used ports/location:', error);
          setUsedPorts([]);
          setTotalPorts(32);
        }
      } else {
        setUsedPorts([]);
        setTotalPorts(32);
      }
    };

    fetchUsedPorts();
  }, [isOpen, formData.newLcpnap, serviceOrderData?.id]);

  useEffect(() => {
    if (serviceOrderData && isOpen) {
      console.log('ServiceOrderEditModal - Received data:', serviceOrderData);

      const normalizePort = (rawPort: any) => {
        if (!rawPort) return '';
        const portNum = String(rawPort).toUpperCase().replace(/[^\d]/g, '');
        return portNum ? `p${portNum.padStart(2, '0')}` : '';
      };

      setOriginalAssignedEmail(serviceOrderData.assignedEmail || serviceOrderData.assigned_email || '');

      setFormData(prev => ({
        ...prev,
        accountNo: serviceOrderData.accountNumber || serviceOrderData.account_no || '',
        dateInstalled: formatDateForInput(serviceOrderData.dateInstalled || serviceOrderData.date_installed),
        fullName: serviceOrderData.fullName || serviceOrderData.full_name || '',
        contactNumber: serviceOrderData.contactNumber || serviceOrderData.contact_number || '',
        emailAddress: serviceOrderData.emailAddress || serviceOrderData.email_address || '',
        plan: serviceOrderData.plan || '',

        username: serviceOrderData.username || '',
        connectionType: serviceOrderData.connectionType || serviceOrderData.connection_type || '',
        routerModemSN: serviceOrderData.routerModemSN || serviceOrderData.router_modem_sn || '',
        lcp: serviceOrderData.lcp || '',
        nap: serviceOrderData.nap || '',
        port: normalizePort(serviceOrderData.port || serviceOrderData.PORT),
        vlan: serviceOrderData.vlan || '',
        supportStatus: (() => {
          const raw = serviceOrderData.supportStatus || serviceOrderData.support_status || 'In Progress';
          const lower = String(raw).toLowerCase().trim();
          if (lower === 'resolved') return 'Resolved';
          if (lower === 'failed') return 'Failed';
          if (lower === 'in-progress' || lower === 'in progress') return 'In Progress';
          if (lower === 'for visit' || lower === 'for-visit') return 'For Visit';
          if (lower === 'open') return 'Open';
          return raw;
        })(),
        visitStatus: (() => {
          const raw = serviceOrderData.visitStatus || serviceOrderData.visit_status || 'In Progress';
          const lower = String(raw).toLowerCase().trim();
          if (lower === 'done' || lower === 'completed') return 'Done';
          if (lower === 'in progress' || lower === 'in-progress') return 'In Progress';
          if (lower === 'failed') return 'Failed';
          if (lower === 'reschedule') return 'Reschedule';
          if (lower === 'open') return 'Open';
          return raw;
        })(),
        repairCategory: serviceOrderData.repairCategory || serviceOrderData.repair_category || '',
        visitBy: serviceOrderData.visitBy || serviceOrderData.visit_by || '',
        visitWith: serviceOrderData.visitWith || serviceOrderData.visit_with || '',
        visitWithOther: serviceOrderData.visitWithOther || serviceOrderData.visit_with_other || '',
        visitRemarks: serviceOrderData.visitRemarks || serviceOrderData.visit_remarks || '',
        clientSignature: serviceOrderData.clientSignature || serviceOrderData.client_signature || '',
        itemName1: serviceOrderData.itemName1 || serviceOrderData.item_name_1 || '',
        timeIn: serviceOrderData.timeIn || serviceOrderData.time_in || '',
        modemSetupImage: serviceOrderData.modemSetupImage || serviceOrderData.modem_setup_image || '',
        timeOut: serviceOrderData.timeOut || serviceOrderData.time_out || '',
        assignedEmail: serviceOrderData.assignedEmail || serviceOrderData.assigned_email || '',
        concern: serviceOrderData.concern || '',
        concernRemarks: serviceOrderData.concernRemarks || serviceOrderData.concern_remarks || '',
        userEmail: serviceOrderData.userEmail || serviceOrderData.assignedEmail || serviceOrderData.assigned_email || currentUserEmail,
        supportRemarks: serviceOrderData.supportRemarks || serviceOrderData.support_remarks || '',
        newPlan: serviceOrderData.new_plan || '',
        serviceCharge: serviceOrderData.serviceCharge ? serviceOrderData.serviceCharge.toString().replace('₱', '').trim() : (serviceOrderData.service_charge ? serviceOrderData.service_charge.toString().replace('₱', '').trim() : '0.00'),
        status: serviceOrderData.status || 'unused',
        newRouterModemSN: '',
        newLcp: '',
        newNap: '',
        newPort: '',
        newVlan: '',
        // Reset with the rest of the "new" fields rather than left behind. It was
        // the only one of the group not cleared here, which was harmless while
        // the field belonged to Migrate alone — the category had to be chosen
        // again anyway. Reactivate now reads it too, and a value left over from
        // the previous ticket in this session would read as "the line moved" and
        // rename a PPPoE account that nobody touched.
        newLcpnap: '',
        routerModel: '',
        address: serviceOrderData.contactAddress || serviceOrderData.contact_address || serviceOrderData.address || '',
        barangay: serviceOrderData.barangay || '',
        city: serviceOrderData.city || '',
        region: serviceOrderData.region || ''
      }));

      // Remember what the customer address looked like on open so the save only
      // sends the address fields that the user actually changed.
      setOriginalAddress({
        address: serviceOrderData.contactAddress || serviceOrderData.contact_address || serviceOrderData.address || '',
        barangay: serviceOrderData.barangay || '',
        city: serviceOrderData.city || '',
        region: serviceOrderData.region || ''
      });
    }
  }, [serviceOrderData, isOpen, currentUserEmail]);

  useEffect(() => {
    const fetchBillingStatus = async () => {
      const accountNo = serviceOrderData?.accountNumber || serviceOrderData?.account_no;
      if (isOpen && accountNo) {
        try {
          const details = await getBillingRecordDetails(accountNo);
          if (details) {
            setBillingStatusId(details.billing_status_id || null);
          }
        } catch (error) {
          console.error('Error fetching billing status:', error);
        }
      } else if (!isOpen) {
        setBillingStatusId(null);
      }
    };
    fetchBillingStatus();
  }, [isOpen, serviceOrderData]);

  // A pulled-out account: both pickers collapse to reactivation.
  const isPulledOut = billingStatusId === PULLOUT_BILLING_STATUS_ID;

  // `concern` is a free string on service_orders and the update path never maps
  // it back to support_concern.id, so a reactivation entry the catalog happens
  // not to carry can still be offered and saved.
  const reactivateConcerns = concerns.filter((c) => isReactivateCategory(c.concern_name));
  const concernOptions = isPulledOut
    ? (reactivateConcerns.length > 0
        ? reactivateConcerns
        : [{ concern_name: REACTIVATE_CONCERN_FALLBACK } as Concern])
    : [{ concern_name: 'None' } as Concern, ...concerns];

  const repairCategoryOptions = isPulledOut
    ? [REACTIVATE_REPAIR_CATEGORY]
    : REPAIR_CATEGORY_OPTIONS;

  const handleInputChange = (field: keyof ServiceOrderEditFormData, value: string) => {
    setFormData(prev => {
      const newState = { ...prev, [field]: value };
      if (field === 'newLcp' || field === 'newNap' || field === 'newLcpnap') {
        newState.newPort = '';
      }
      // Moving to a repair category that means something different by the LCP-NAP
      // and Port fields starts them empty.
      //
      // The two groups read the same fields for different purposes: under a
      // relocation they are the new installation and are required, under a
      // reactivation they are the optional "came back on a different line" and
      // are what triggers the RADIUS rename. Carrying a half-filled relocation
      // into a reactivation would silently rename a working PPPoE account.
      // Re-picking the same category is not a change and clears nothing.
      if (field === 'repairCategory' && lineFieldGroup(value) !== lineFieldGroup(prev.repairCategory)) {
        newState.newLcpnap = '';
        newState.newPort = '';
        newState.newLcp = '';
        newState.newNap = '';
      }
      // Closing the ticket closes its visit with it — see CLOSING_VISIT_STATUS.
      if (field === 'supportStatus' && CLOSING_VISIT_STATUS[value]) {
        newState.visitStatus = CLOSING_VISIT_STATUS[value];
      }
      // Region -> City -> Barangay cascade: clear the dependent levels when a parent changes
      if (field === 'region') {
        newState.city = '';
        newState.barangay = '';
      } else if (field === 'city') {
        newState.barangay = '';
      }
      return newState;
    });
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const getFilteredCities = (): City[] => {
    if (!formData.region) return [];
    const selectedRegion = regions.find(reg => reg.name === formData.region);
    if (!selectedRegion) return [];
    return allCities.filter(city => city.region_id === selectedRegion.id);
  };

  const getFilteredBarangays = (): Barangay[] => {
    if (!formData.city) return [];
    const selectedCity = allCities.find(city => city.name === formData.city);
    if (!selectedCity) return [];
    return allBarangays.filter(brgy => brgy.city_id === selectedCity.id);
  };

  // The relocation address is only written to the customer record on a Resolved save, so the
  // form has to say when edits are still pending rather than dropping them silently.
  const isSupportStatusResolved = String(formData.supportStatus).toLowerCase().trim() === 'resolved';
  const hasPendingAddressEdits = (['address', 'barangay', 'city', 'region'] as const)
    .some(field => (formData[field] || '') !== (originalAddress[field] || ''));

  const handleImageChange = async (field: keyof ImageFiles, file: File | null) => {
    if (file && activeImageSize && activeImageSize.image_size_value < 100) {
      try {
        console.log(`Resizing ${field} image...`);
        console.log('Original file size:', (file.size / 1024 / 1024).toFixed(2), 'MB');

        const resizedFile = await resizeImage(file, activeImageSize.image_size_value);

        console.log('Resized file size:', (resizedFile.size / 1024 / 1024).toFixed(2), 'MB');
        console.log('Size reduction:', ((1 - resizedFile.size / file.size) * 100).toFixed(2), '%');

        const fileToUse = resizedFile.size < file.size ? resizedFile : file;
        setImageFiles(prev => ({ ...prev, [field]: fileToUse }));

        if (imagePreviews[field] && imagePreviews[field]?.startsWith('blob:')) {
          URL.revokeObjectURL(imagePreviews[field]!);
        }

        const previewUrl = URL.createObjectURL(fileToUse);
        setImagePreviews(prev => ({ ...prev, [field]: previewUrl }));

        if (errors[field]) {
          setErrors(prev => ({ ...prev, [field]: '' }));
        }
      } catch (error) {
        console.error('Error resizing image:', error);
        setImageFiles(prev => ({ ...prev, [field]: file }));

        if (imagePreviews[field] && imagePreviews[field]?.startsWith('blob:')) {
          URL.revokeObjectURL(imagePreviews[field]!);
        }

        const previewUrl = URL.createObjectURL(file);
        setImagePreviews(prev => ({ ...prev, [field]: previewUrl }));

        if (errors[field]) {
          setErrors(prev => ({ ...prev, [field]: '' }));
        }
      }
    } else {
      setImageFiles(prev => ({ ...prev, [field]: file }));

      if (file) {
        if (imagePreviews[field] && imagePreviews[field]?.startsWith('blob:')) {
          URL.revokeObjectURL(imagePreviews[field]!);
        }

        const previewUrl = URL.createObjectURL(file);
        setImagePreviews(prev => ({ ...prev, [field]: previewUrl }));

        if (errors[field]) {
          setErrors(prev => ({ ...prev, [field]: '' }));
        }
      }
    }
  };

  const uploadImageToGoogleDrive = async (file: File): Promise<string> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await apiClient.post<{ success: boolean; data: { url: string }; message?: string }>(
        '/google-drive/upload',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }
      );

      if (!response.data.success || !response.data.data?.url) {
        throw new Error(response.data.message || 'Upload failed');
      }

      return response.data.data.url;
    } catch (error: any) {
      console.error('Error uploading to Google Drive:', error);
      throw new Error(error.response?.data?.message || error.message || 'Failed to upload image');
    }
  };

  const uploadAllImages = async (tempSignatureFile?: File | null): Promise<{ image1_url: string; image2_url: string; image3_url: string; client_signature_url: string }> => {
    const urls = { image1_url: '', image2_url: '', image3_url: '', client_signature_url: '' };
    const filesToUpload = [
      { file: tempSignatureFile || imageFiles.clientSignatureFile, key: 'client_signature_url' },
      { file: imageFiles.timeInFile, key: 'image1_url' },
      { file: imageFiles.modemSetupFile, key: 'image2_url' },
      { file: imageFiles.timeOutFile, key: 'image3_url' }
    ].filter(item => item.file !== null);

    const totalFiles = filesToUpload.length;
    if (totalFiles === 0) {
      return urls;
    }

    for (let i = 0; i < filesToUpload.length; i++) {
      const { file, key } = filesToUpload[i];
      if (file) {
        const url = await uploadImageToGoogleDrive(file);
        urls[key as keyof typeof urls] = url;
        // Map 10% to 75% for image uploads phase
        setUploadProgress(10 + Math.round(((i + 1) / totalFiles) * 65));
      }
    }

    return urls;
  };

  const handleNumberChange = (field: 'serviceCharge', increment: boolean) => {
    setFormData(prev => {
      const currentValue = parseFloat(prev[field]) || 0;
      const newValue = increment ? currentValue + 1 : Math.max(0, currentValue - 1);
      return {
        ...prev,
        [field]: newValue.toFixed(2)
      };
    });
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    const isForVisit = formData.supportStatus === 'For Visit';
    const isVisitDone = isForVisit && formData.visitStatus === 'Done';
    const isVisitRescheduledOrFailed = isForVisit && (formData.visitStatus === 'Reschedule' || formData.visitStatus === 'Failed');
    const isMigrateGroup = isVisitDone && RELOCATION_CATEGORIES.includes(formData.repairCategory);
    const isReplaceRouter = isVisitDone && formData.repairCategory === 'Replace Router';
    const isReactivate = isVisitDone && isReactivateCategory(formData.repairCategory);

    if (!formData.supportStatus.trim()) newErrors.supportStatus = 'Support Status is required';

    // Concern only required for non-technicians
    if (!formData.concern.trim() && !isTechnician) newErrors.concern = 'Concern is required';

    // New Plan only required when the field is visible (Upgrade/Downgrade Plan concern)
    if (formData.concern === 'Upgrade/Downgrade Plan' && !formData.newPlan.trim()) {
      newErrors.newPlan = 'New Plan is required';
    }

    // Fields only visible when For Visit
    if (isForVisit) {
      if (!formData.visitStatus.trim()) newErrors.visitStatus = 'Visit Status is required';
      if (!formData.assignedEmail.trim() || formData.assignedEmail === 'None') {
        newErrors.assignedEmail = 'Assigned Email is required';
      }
    }

    // Fields only visible when For Visit + Done
    if (isVisitDone) {
      // Validate partially-filled items
      for (let i = 0; i < orderItems.length; i++) {
        const item = orderItems[i];
        const effectiveItemId = (item.itemId === 'None' || !item.itemId) ? '' : item.itemId;
        if (effectiveItemId || item.quantity) {
          if (!effectiveItemId) newErrors[`item_${i}`] = 'Item is required';
          if (!item.quantity || parseInt(item.quantity) <= 0) newErrors[`quantity_${i}`] = 'Valid quantity is required';
        }
      }

      // visitRemarks only required when Done
      if (!formData.visitRemarks.trim()) newErrors.visitRemarks = 'Visit Remarks is required';
    }

    // Fields only visible when For Visit + Reschedule or Failed
    if (isVisitRescheduledOrFailed) {
      if (!formData.visitRemarks.trim()) newErrors.visitRemarks = 'Visit Remarks is required';
    }

    // Migrate/Relocate/Transfer group fields — only visible when repairCategory matches and visit is Done
    if (isMigrateGroup) {
      if (!formData.newRouterModemSN.trim()) newErrors.newRouterModemSN = 'New Router Modem SN is required';
      if (!formData.newLcpnap.trim()) newErrors.newLcpnap = 'New LCP-NAP is required';
      if (!formData.newPort.trim()) newErrors.newPort = 'New Port is required';
      if (!formData.routerModel.trim()) newErrors.routerModel = 'Router Model is required';
    }

    // Replace Router fields — only visible when repairCategory is Replace Router and visit is Done
    if (isReplaceRouter) {
      if (!formData.newRouterModemSN.trim()) newErrors.newRouterModemSN = 'New Router Modem SN is required';
    }

    // Reactivation: both fields are optional, because most reactivations put the
    // customer back on the line they left on and there is nothing to record. A
    // port on its own is the one combination that cannot be saved — the port
    // number only means anything against an LCP-NAP, and sending one without the
    // other would move the account to a port on whichever LCP-NAP it is already
    // on, which is not what picking a port was meant to say.
    if (isReactivate && formData.newPort.trim() && !formData.newLcpnap.trim()) {
      newErrors.newLcpnap = 'Select the LCP-NAP this port belongs to';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const checkReconnectionTrigger = () => {
    const status = formData.supportStatus.toLowerCase();
    const concern = formData.concern.toLowerCase();
    return status === 'resolved' && (concern === 'reconnect' || concern === 'upgrade/downgrade plan');
  };

  const checkMigrationTrigger = () => {
    const visitStatus = formData.visitStatus.toLowerCase();
    const repairCategory = formData.repairCategory.toLowerCase();
    return visitStatus === 'done' && repairCategory === 'migrate';
  };

  const checkRestrictionTrigger = () => {
    const status = formData.supportStatus.toLowerCase();
    const concern = formData.concern.toLowerCase();
    return status === 'resolved' && (concern === 'restrict' || concern === 'disconnect');
  };

  /**
   * The LCP/NAP/Port fields a reactivation is about to move, if any.
   *
   * Drives the warning below, and reads the form exactly as the save does, so
   * what the banner promises is what gets sent. Empty means this save renames
   * nothing in RADIUS.
   */
  const reactivateLineMove = (): string[] => {
    if (formData.visitStatus.toLowerCase() !== 'done' || !isReactivateCategory(formData.repairCategory)) {
      return [];
    }

    const { lcp, nap } = parseLcpNap(formData.newLcpnap);

    return lineIdentityChanged(
      { lcp: formData.lcp, nap: formData.nap, port: formData.port },
      { lcp, nap, port: formData.newPort }
    );
  };

  const handleItemChange = (index: number, field: 'itemId' | 'quantity', value: string) => {
    const newOrderItems = [...orderItems];
    newOrderItems[index][field] = value;
    setOrderItems(newOrderItems);

    if (field === 'itemId' && value && value !== 'None' && index === orderItems.length - 1) {
      setOrderItems([...newOrderItems, { itemId: '', quantity: '' }]);
    }
  };

  const handleRemoveItem = (index: number) => {
    if (orderItems.length > 1) {
      const newOrderItems = orderItems.filter((_, i) => i !== index);
      setOrderItems(newOrderItems);
    }
  };

  const handleSave = async () => {
    // ── Technician reassignment: allowed at any time. When the assigned tech
    //    changes, the on-site visit is reset so the new technician starts fresh
    //    (start_time / end_time are cleared below in the service order update). ──
    const currentAssigned = (formData.assignedEmail || '').trim();
    const originalAssigned = (originalAssignedEmail || '').trim();
    const technicianChanged = !!originalAssigned && currentAssigned !== originalAssigned;

    const updatedFormData = {
      ...formData,
      modifiedBy: currentUserEmail,
      modifiedDate: new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      })
    };

    // A closed ticket always saves as a closed visit. handleInputChange already set
    // this when the user picked the status; repeating it here is what guarantees it
    // reaches the payload — the status can also arrive from a ticket that opened
    // Resolved or Failed, carrying a visit status the form never showed.
    const closingVisitStatus = CLOSING_VISIT_STATUS[updatedFormData.supportStatus];
    if (closingVisitStatus) {
      updatedFormData.visitStatus = closingVisitStatus;
    }

    /**
     * Is the record ALREADY carrying the visit status this save would force?
     *
     * If it is, the save must not send visit_status at all. The API keys several
     * one-shot actions off the column *changing* — the service charge posted when
     * it becomes Done, and the auto-migration and auto-pullout read back from the
     * row — so re-sending a value the row already holds is what risks running them
     * a second time. Omitting the key leaves the column untouched and those
     * triggers unreached.
     *
     * Read from serviceOrderData, not from formData: the form loader turns a blank
     * stored value into "In Progress", so the form cannot tell an empty column from
     * a genuine in-progress visit. Only the raw record can.
     *
     * "completed" counts as Done, the same equivalence the loader applies, so a
     * ticket stored under that older spelling is not rewritten just to restyle it.
     */
    const normalizeVisitStatus = (value: unknown) => {
      const lower = String(value ?? '').toLowerCase().trim();
      return lower === 'completed' ? 'done' : lower;
    };
    const visitStatusAlreadyClosed = !!closingVisitStatus
      && normalizeVisitStatus(serviceOrderData.visitStatus ?? serviceOrderData.visit_status)
        === normalizeVisitStatus(closingVisitStatus);

    if (updatedFormData.visitStatus === 'Reschedule') {
      updatedFormData.visitBy = '';
      updatedFormData.visitWith = '';
      updatedFormData.visitWithOther = '';
    }

    setFormData(updatedFormData);

    if (!validateForm()) {
      setModal({
        isOpen: true,
        type: 'warning',
        title: 'Validation Error',
        message: 'Please fill in all required fields before saving.'
      });
      return;
    }

    // SmartOLT Validation Logic
    if (formData.connectionType === 'Fiber') {
      // Check if New Router Modem SN field is visible
      // The categories that draw the serial field: the relocation group, which
      // replaces the whole installation, plus Replace Router, which replaces only
      // the hardware. Reactivate is deliberately not among them — it restores an
      // account onto a line, and the router it comes back on is the one it left
      // with.
      const isNewRouterModemSNVisible = updatedFormData.visitStatus === 'Done' &&
        [...RELOCATION_CATEGORIES, 'Replace Router'].includes(updatedFormData.repairCategory);

      // Validate New Router Modem SN if provided and visible
      if (isNewRouterModemSNVisible && formData.newRouterModemSN?.trim()) {
        try {
          console.log('[SMARTOLT VALIDATION] Validating New Modem SN:', formData.newRouterModemSN);

          setModal({
            isOpen: true,
            type: 'loading',
            title: '',
            message: ''
          });

          const smartOltResponse = await apiClient.get('/smart-olt/validate-sn', {
            params: { sn: formData.newRouterModemSN }
          });

          if (!(smartOltResponse.data as any).success) {
            console.log('[SMARTOLT VALIDATION] Failed:', smartOltResponse.data);

            const errorMessage = (smartOltResponse.data as any).message || 'Invalid New Modem SN';
            setErrors(prev => ({
              ...prev,
              newRouterModemSN: errorMessage
            }));

            setModal({
              isOpen: true,
              type: 'error',
              title: 'SmartOLT Verification Failed',
              message: errorMessage,
              onConfirm: () => setModal(prev => ({ ...prev, isOpen: false }))
            });
            return;
          }
          console.log('[SMARTOLT VALIDATION] New Router Modem SN Success');
          setModal(prev => ({ ...prev, isOpen: false }));
        } catch (error: any) {
          console.error('[SMARTOLT VALIDATION] API Error:', error);
          const errorMessage = error.response?.data?.message || 'Failed to validate New Modem SN with SmartOLT system.';

          setErrors(prev => ({
            ...prev,
            newRouterModemSN: errorMessage
          }));

          setModal({
            isOpen: true,
            type: 'error',
            title: 'Validation Error',
            message: errorMessage,
            onConfirm: () => setModal(prev => ({ ...prev, isOpen: false }))
          });
          return;
        }
      }
    }



    if (!serviceOrderData?.id) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: 'Cannot update service order: Missing ID'
      });
      return;
    }

    setModal({
      isOpen: true,
      type: 'loading',
      title: '',
      message: ''
    });

    setLoading(true);
    setUploadProgress(0);

    try {
      const serviceOrderId = serviceOrderData.id;

      setModal({
        isOpen: true,
        type: 'loading',
        title: '',
        message: ''
      });

      let tempSigFile: File | null = null;
      if (sigCanvas.current && !sigCanvas.current.isEmpty()) {
        try {
          // Use a safer way to get the signature blob
          const canvas = sigCanvas.current.getCanvas();
          if (canvas) {
            try {
              // Try trimming first
              const trimmedCanvas = sigCanvas.current.getTrimmedCanvas();
              const blob = await new Promise<Blob | null>(resolve => trimmedCanvas.toBlob(resolve, 'image/png'));
              if (blob) {
                tempSigFile = new File([blob], 'signature.png', { type: 'image/png' });
              }
            } catch (trimErr) {
              console.warn('getTrimmedCanvas failed, falling back to full canvas:', trimErr);
              // Fallback to full canvas if trimming fails
              const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
              if (blob) {
                tempSigFile = new File([blob], 'signature.png', { type: 'image/png' });
              }
            }
          }
        } catch (err) {
          console.error('Error processing signature:', err);
        }
      }

      setUploadProgress(10);
      const imageUrls = await uploadAllImages(tempSigFile);
      setUploadProgress(78);

      setModal({
        isOpen: true,
        type: 'loading',
        title: '',
        message: ''
      });

      // Parse New LCPNAP
      const { lcp: newLcp, nap: newNap } = parseLcpNap(updatedFormData.newLcpnap);

      const isForVisit = updatedFormData.supportStatus === 'For Visit';
      const isVisitDone = isForVisit && updatedFormData.visitStatus === 'Done';
      const isVisitRescheduledOrFailed = isForVisit && (updatedFormData.visitStatus === 'Reschedule' || updatedFormData.visitStatus === 'Failed');

      /**
       * A remark is never blanked by a save.
       *
       * Support Remarks and Visit Remarks are only editable in some support and
       * visit states, so a save made in another state — taking the ticket back to
       * In Progress, for instance — must leave them exactly as they are. Sending
       * an empty value would overwrite what is stored; omitting the key entirely
       * leaves the column untouched, because the server only writes the fields a
       * request actually carries.
       *
       * The trade is deliberate: a remark cannot be emptied from this form once
       * written. Clearing one by accident loses the record of what happened,
       * which is worse than having to correct the text instead.
       */
      const remarkIfPresent = (key: string, value: string | null | undefined) =>
        String(value ?? '').trim() === '' ? {} : { [key]: value };
      const isMigrateGroup = isVisitDone && RELOCATION_CATEGORIES.includes(updatedFormData.repairCategory);
      const isReplaceRouter = isVisitDone && updatedFormData.repairCategory === 'Replace Router';
      const isUpdateVlan = isVisitDone && updatedFormData.repairCategory === 'Update Vlan';
      const isReactivate = isVisitDone && isReactivateCategory(updatedFormData.repairCategory);

      const showNewRouterSN = isVisitDone && (isMigrateGroup || isReplaceRouter);
      const showNewTechDetails = isVisitDone && isMigrateGroup;
      const showNewVlan = isVisitDone && (isMigrateGroup || isUpdateVlan);

      /**
       * A reactivation that brings the customer back on a different line.
       *
       * Only the three fields the PPPoE username is built from are considered —
       * LCP, NAP and port — because those are what make the stored credential
       * describe the wrong line. Sending them is what tells the server to rename
       * the RADIUS account; sending them when nothing moved would rename a
       * working credential and drop the customer's session for no reason, so the
       * keys are omitted entirely rather than sent unchanged.
       *
       * The same comparison runs server side against the row, which is the one
       * that decides. This copy exists so the form can say what is about to
       * happen before the save, not to be trusted in place of it.
       */
      const reactivateMovedFields = isReactivate
        ? lineIdentityChanged(
            { lcp: updatedFormData.lcp, nap: updatedFormData.nap, port: updatedFormData.port },
            { lcp: newLcp, nap: newNap, port: updatedFormData.newPort }
          )
        : [];

      const sendReactivateLineMove = reactivateMovedFields.length > 0;

      // Relocation address changes (customers table). All four fields are optional, so
      // only the ones that differ from the values loaded on open are sent.
      //
      // The write is held back until the ticket is Resolved: while the relocation is still
      // in progress the customer has not moved yet, so their record must keep the old
      // address. Only on the save that carries Resolved do the new values get committed.
      const isRelocationResolved = updatedFormData.concern === 'Relocation'
        && String(updatedFormData.supportStatus).toLowerCase().trim() === 'resolved';

      const changedAddressFields: Record<string, string> = {};
      (['address', 'barangay', 'city', 'region'] as const).forEach(field => {
        if ((updatedFormData[field] || '') !== (originalAddress[field] || '')) {
          changedAddressFields[field] = updatedFormData[field] || '';
        }
      });

      const serviceOrderUpdateData: any = {
        account_no: updatedFormData.accountNo,
        date_installed: updatedFormData.dateInstalled,
        full_name: updatedFormData.fullName,
        contact_number: updatedFormData.contactNumber,
        email_address: updatedFormData.emailAddress,
        plan: updatedFormData.plan,

        username: updatedFormData.username,
        connection_type: updatedFormData.connectionType,
        router_modem_sn: updatedFormData.routerModemSN,
        lcp: updatedFormData.lcp,
        nap: updatedFormData.nap,
        port: updatedFormData.port,
        vlan: updatedFormData.vlan,
        support_status: updatedFormData.supportStatus,

        // Include visit_status when the field is visible (For Visit), or when a closing
        // support status forced it above AND the row is not already holding that value
        // — see visitStatusAlreadyClosed: re-sending it is what could run the API's
        // one-shot triggers twice.
        ...((isForVisit || (closingVisitStatus && !visitStatusAlreadyClosed)) ? {
          visit_status: updatedFormData.visitStatus,
        } : {}),
        ...(isForVisit ? {
          assigned_email: updatedFormData.assignedEmail,
        } : {}),

        // Fields visible during visit (Done, Reschedule, or Failed)
        ...((isVisitDone || isVisitRescheduledOrFailed) ? {
          visit_by_user: updatedFormData.visitBy,
          visit_with: updatedFormData.visitWith,
          visit_with_other: updatedFormData.visitWithOther,
          ...remarkIfPresent('visit_remarks', updatedFormData.visitRemarks),
        } : {}),

        // Fields visible only when visit is Done
        ...(isVisitDone ? {
          repair_category: updatedFormData.repairCategory,
          client_signature: updatedFormData.clientSignature,
          item_name_1: updatedFormData.itemName1,
          image1_url: imageUrls.image1_url || formData.timeIn,
          image2_url: imageUrls.image2_url || formData.modemSetupImage,
          image3_url: imageUrls.image3_url || formData.timeOut,
          client_signature_url: imageUrls.client_signature_url || formData.clientSignature,

          ...(showNewRouterSN ? { new_router_modem_sn: updatedFormData.newRouterModemSN } : {}),
          ...(showNewTechDetails ? {
            new_lcpnap: updatedFormData.newLcpnap,
            new_lcp: newLcp,
            new_nap: newNap,
            new_port: updatedFormData.newPort,
            router_model: updatedFormData.routerModel,
          } : {}),
          ...(showNewVlan ? { new_vlan: updatedFormData.newVlan } : {}),

          // Reactivation onto a different line. Deliberately the LCP/NAP/port
          // three and nothing else: the router serial, VLAN and model belong to
          // a relocation, and a reactivation that also replaced the hardware is
          // a different repair category. Sent only when one of the three moved,
          // so an ordinary reactivation posts no new_* keys at all and the
          // server's own comparison finds nothing to re-sync.
          ...(sendReactivateLineMove ? {
            new_lcpnap: updatedFormData.newLcpnap,
            new_lcp: newLcp,
            new_nap: newNap,
            new_port: updatedFormData.newPort,
          } : {}),
        } : {}),

        concern: updatedFormData.concern,
        concern_remarks: updatedFormData.concernRemarks,
        updated_by: updatedFormData.modifiedBy,
        updated_by_user: updatedFormData.modifiedBy,
        ...remarkIfPresent('support_remarks', updatedFormData.supportRemarks),
        // An empty field parses to NaN, which serialises as JSON null and the
        // API reads as a ₱0 charge — backing out anything already posted.
        service_charge: Number.isFinite(parseFloat(updatedFormData.serviceCharge))
          ? parseFloat(updatedFormData.serviceCharge)
          : 0,
        status: updatedFormData.status,
        ...(updatedFormData.concern === 'Upgrade/Downgrade Plan' ? { new_plan: updatedFormData.newPlan } : {}),

        // Relocation: send only the address fields the user actually changed, and only once
        // the ticket is Resolved, so an untouched or still-pending field is never written
        // over. The backend logs the old/new values.
        ...(isRelocationResolved && canEditRelocationAddress ? changedAddressFields : {}),

        // Reset the on-site timers when the technician is reassigned so the new
        // technician starts a fresh visit (no inherited start/end time).
        ...(technicianChanged ? { start_time: null, end_time: null } : {})
      };

      /**
       * A Resolved or Failed save closes the ticket — it does not rewrite the record.
       *
       * The payload above carries the whole form, and the API writes every key it
       * receives. The form loads a blank for anything the record left empty, and for
       * anything the current support status never put on screen, so sending those
       * blanks back would null columns the user never touched. Dropping them leaves
       * the save carrying the forced visit_status plus the fields that actually hold
       * a value — an unchanged field re-sends what is already stored, which writes
       * nothing.
       *
       * Only the closing statuses are pruned. A For Visit save still sends its blanks,
       * because there the empty field was on screen and clearing it is a real edit.
       *
       * The exempt keys are the ones whose blank IS the intended write:
       *   • start_time / end_time — deliberately nulled when the technician changes;
       *   • service_charge — the API only posts the charge on a request that carries
       *     it, so dropping a 0 would silently skip the billing on resolve.
       *
       * The trade matches remarkIfPresent above: a field cannot be emptied from this
       * form on a closing save. Set it before resolving, or reopen the ticket.
       */
      if (closingVisitStatus) {
        const keepWhenBlank = new Set(['start_time', 'end_time', 'service_charge']);
        Object.keys(serviceOrderUpdateData).forEach(key => {
          if (keepWhenBlank.has(key)) return;
          const value = serviceOrderUpdateData[key];
          if (value === null || value === undefined || String(value).trim() === '') {
            delete serviceOrderUpdateData[key];
          }
        });
      }

      setUploadProgress(85);

      setUploadProgress(85);

      // Increment steadily 85 -> 98 while waiting for API
      const progressTicker = setInterval(() => {
        setUploadProgress(prev => {
          const next = Math.floor(prev) + 1;
          return next >= 98 ? 98 : next;
        });
      }, 300);

      let response: any;
      try {
        response = await apiClient.put<{
          success: boolean;
          message?: string;
          data?: any;
          reconnect_status?: string | null;
          migration_status?: string | null;
          pullout_status?: string | null;
          restricted_status?: string | null;
          disconnect_status?: string | null;
          // The reconnection half of a Reactivate ticket: billing back to Active
          // and the plan re-applied in RADIUS. 'already_online' / 'already_active'
          // mean the line was up and nothing was touched.
          reactivate_status?: string | null;
          // The RADIUS rename triggered when a reactivation moved the line.
          // 'no_change' and null both mean nothing needed renaming.
          reactivate_radius_status?: string | null;
          radius_queued?: boolean;
          radius_queue_failed?: boolean;
          radius_steps?: Array<{ step: string; operation: string; status: string }>;
        }>(

          `/service-orders/${serviceOrderId}`,
          serviceOrderUpdateData
        );
      } finally {
        clearInterval(progressTicker);
      }

      setUploadProgress(96);

      if (!response.data.success) {
        throw new Error(response.data.message || 'Service order update failed');
      }

      // Save service order items only if visible (For Visit status and Done visit status)
      const validItems = orderItems.filter(item => {
        const quantity = parseInt(item.quantity);
        const isValid = item.itemId && item.itemId.trim() !== '' && item.itemId !== 'None' && !isNaN(quantity) && quantity > 0;
        return isValid;
      });

      if (isVisitDone && validItems.length > 0) {
        try {
          const existingItemsResponse = await apiClient.get<{ success: boolean; data: any[] }>(`/service-order-items?service_order_id=${serviceOrderId}`);

          if (existingItemsResponse.data.success && existingItemsResponse.data.data.length > 0) {
            const existingItems = existingItemsResponse.data.data;
            // Delete all existing items in parallel for speed
            await Promise.all(
              existingItems.map(item =>
                apiClient.delete(`/service-order-items/${item.id}`).catch(err => {
                  console.error('Error deleting existing item:', err);
                })
              )
            );
          }
        } catch (deleteError: any) {
          console.error('Error fetching/deleting existing items:', deleteError);
        }

        const serviceOrderItems: ServiceOrderItem[] = validItems.map(item => {
          return {
            service_order_id: parseInt(serviceOrderId.toString()),
            item_name: item.itemId,
            quantity: parseInt(item.quantity)
          };
        });

        try {
          const itemsResponse = await createServiceOrderItems(serviceOrderItems);

          if (!itemsResponse.success) {
            throw new Error(itemsResponse.message || 'Failed to create service order items');
          }
        } catch (itemsError: any) {
          console.error('Error saving items:', itemsError);
          const errorMsg = itemsError.response?.data?.message || itemsError.message || 'Unknown error';
          setLoading(false);
          setModal({
            isOpen: true,
            type: 'error',
            title: 'Failed to Save Items',
            message: `Service order updated but failed to save items: ${errorMsg}`,
            onConfirm: () => {
              setModal({ ...modal, isOpen: false });
            }
          });
          return;
        }
      }

      // Animate RADIUS step feedback in loading modal
      const radiusSteps = response.data.radius_steps;
      if (radiusSteps && radiusSteps.length > 0) {
        for (const step of radiusSteps) {
          let stepMessage = '';
          const opLabel = step.operation === 'reconnect' ? 'Reconnection'
            : step.operation === 'restrict' ? 'Restriction'
              : step.operation === 'disconnect' ? 'Disconnection'
                : step.operation === 'pullout' ? 'Pullout'
                  : step.operation === 'migration' ? 'Migration'
                    : step.operation === 'reactivate' ? 'Reactivation PPPoE rename'
                      : 'RADIUS';

          if (step.step === 'attempt_1') {
            stepMessage = `Attempting ${opLabel} via RADIUS...`;
          } else if (step.step === 'attempt_2') {
            stepMessage = `1st attempt failed. Trying 2nd RADIUS config...`;
          } else if (step.step === 'attempt_3') {
            stepMessage = `2nd attempt failed. Trying 3rd RADIUS config...`;
          } else if (step.step === 'queued') {
            stepMessage = `RADIUS failed. Adding to RADIUS queue for automatic retry...`;
          }

          if (stepMessage) {
            setModal(prev => ({ ...prev, message: stepMessage }));
            await new Promise(resolve => setTimeout(resolve, 1200));
          }

          // Show result of queue step
          if (step.step === 'queued' && step.status === 'success') {
            setModal(prev => ({ ...prev, message: 'Successfully added to RADIUS queue.' }));
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        }
      }

      // Animate to 100% then show success
      setUploadProgress(100);
      await new Promise(resolve => setTimeout(resolve, 400));

      let successMessage = 'Service Order updated successfully!';

      // Reconnection Messages
      if (response.data.reconnect_status === 'success') {
        if (updatedFormData.concern === 'Upgrade/Downgrade Plan') {
          successMessage = 'Plan upgraded and User reconnected successfully!';
        } else {
          successMessage = 'Service Order updated and User reconnected successfully!';
        }
      } else if (response.data.reconnect_status === 'balance_positive') {
        successMessage = 'Service Order updated. Reconnection skipped: Account has a remaining balance.';
      } else if (response.data.reconnect_status === 'failed') {
        successMessage = 'Service Order updated, but reconnection failed. Please check technical details.';
      }

      // Migration / Relocation Messages
      if (response.data.migration_status === 'success') {
        successMessage += '\n\nRADIUS account updated/relocated successfully!';
      } else if (response.data.migration_status === 'failed') {
        successMessage += '\n\nWarning: Failed to update RADIUS account for relocation.';
      }

      // Pullout Messages
      if (response.data.pullout_status === 'success') {
        successMessage += '\n\nRADIUS account disabled for pullout.';
      }

      // Reactivation: the reconnection itself.
      //
      // Reported whatever the outcome, including the two "nothing to do"
      // answers. A technician who files a reactivation and is told only
      // "updated successfully" has no way to tell a line that came back up from
      // one that was never touched, and those need different next steps.
      switch (response.data.reactivate_status) {
        case 'success':
          successMessage += '\n\nAccount reactivated: billing set to Active and the plan re-applied in RADIUS.';
          break;
        case 'already_online':
          successMessage += '\n\nAccount reactivated. RADIUS already had this account connected, so it was left alone.';
          break;
        case 'already_active':
          successMessage += '\n\nAccount reactivated. Billing was already Active, so the RADIUS step was skipped.';
          break;
        case 'no_username':
          successMessage += '\n\nWarning: no PPPoE username is recorded for this account, so it could not be reconnected in RADIUS.';
          break;
        case 'no_plan':
          successMessage += '\n\nWarning: no plan is recorded for this account, so it could not be reconnected in RADIUS.';
          break;
        case 'no_account':
          successMessage += '\n\nWarning: no billing account matches this service order, so it could not be reconnected.';
          break;
        case 'exception':
          successMessage += '\n\nWarning: the reconnection could not be completed. Please check the technical details.';
          break;
        default:
          // null: not a reactivation, or one whose ticket was already Resolved
          // under this concern, so the reconnection had already run.
          break;
      }

      // Reactivation onto a different LCP/NAP/Port.
      //
      // Every outcome is reported, not just the failures. The PPPoE username
      // encodes the line, so a rename changes what the customer's router has to
      // authenticate with — the technician standing at the ONU is the one person
      // who can act on that, and they only find out here.
      switch (response.data.reactivate_radius_status) {
        case 'success':
          successMessage += '\n\nPPPoE username updated in RADIUS for the new LCP/NAP/Port.';
          break;
        case 'radius_failed':
          successMessage += '\n\nWarning: the PPPoE username was updated in the database but RADIUS could not be reached. The rename has been queued and will be retried automatically — the customer may not reconnect until it lands.';
          break;
        case 'no_username':
          successMessage += '\n\nNote: no PPPoE username is recorded for this account, so there was nothing to rename in RADIUS.';
          break;
        case 'no_account':
          successMessage += '\n\nNote: no billing account matches this service order, so the RADIUS rename was skipped.';
          break;
        case 'exception':
          successMessage += '\n\nWarning: the RADIUS rename could not be attempted. Please check the technical details.';
          break;
        default:
          // 'no_change' and null: the line did not move, or the generated name
          // was the one already in use. Nothing happened and nothing to say.
          break;
      }

      // Restriction / Disconnection Messages (Joined logic)
      if (response.data.restricted_status === 'success') {
        if (updatedFormData.concern === 'Disconnect') {
          successMessage += '\n\nUser disconnected (restricted) successfully!';
        } else {
          successMessage += '\n\nUser restricted successfully!';
        }
      }

      // Explicit Disconnect Messages (if still used elsewhere)
      if (response.data.disconnect_status === 'success') {
        successMessage += '\n\nUser disconnected successfully!';
      }

      // RADIUS Queue Messages — the Service Order saved successfully, but the live
      // RADIUS operation could not be completed (server offline/timeout/etc.) and has
      // been queued for automatic retry. This is NOT an error; the data is saved.
      if (response.data.radius_queued) {
        successMessage += '\n\nRADIUS operation has been queued and will be processed automatically.';
      }
      // Only surface a warning if the fallback queue insert ALSO failed.
      if (response.data.radius_queue_failed) {
        successMessage += '\n\nWarning: The RADIUS operation could not be queued. Please notify an administrator to retry it manually.';
      }

      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: successMessage,
        onConfirm: () => {
          setErrors({});
          setUploadProgress(0);
          onSave(updatedFormData);
          onClose();
          setModal({ ...modal, isOpen: false });
        }
      });
    } catch (error: any) {
      console.error('Error updating service order:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error occurred';
      setUploadProgress(0);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Failed to Update',
        message: `Failed to update service order: ${errorMessage}`,
        onConfirm: () => {
          setModal({ ...modal, isOpen: false });
        }
      });
    } finally {
      setLoading(false);
    }
  };

  const isPulloutByAdmin = isAdministratorOrSuperadmin && formData.concern?.toLowerCase() === 'pullout';

  if (!isOpen) return null;

  return (
    <>
      <style>{`
        .focus-primary:focus {
          border-color: ${colorPalette?.primary || '#7c3aed'} !important;
        }
      `}</style>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
            }`}>
            <div className="flex items-center space-x-3">

              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                {serviceOrderData?.ticket_id || serviceOrderData?.id} | {formData.fullName}
              </h2>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={onClose}
                className={`px-4 py-2 rounded text-sm transition-colors ${isDarkMode
                  ? 'border border-gray-600 text-gray-400 hover:text-white'
                  : 'bg-gray-400 hover:bg-gray-500 text-white'
                  }`}
                style={isDarkMode ? {
                  borderColor: colorPalette?.primary || '#7c3aed',
                  color: colorPalette?.primary || '#7c3aed'
                } : {}}
                onMouseEnter={(e) => {
                  if (isDarkMode && colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = colorPalette.primary;
                    e.currentTarget.style.color = 'white';
                  }
                }}
                onMouseLeave={(e) => {
                  if (isDarkMode && colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = colorPalette.primary;
                  }
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-4 py-2 disabled:opacity-50 text-white rounded text-sm"
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
                Save
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Account No</label>
              <input
                type="text"
                value={formData.accountNo}
                readOnly
                className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.accountNo ? 'border-red-500' : ''}`}
                placeholder="Account No"
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Date Installed</label>
              <div className="relative">
                <input
                  type="date"
                  value={formData.dateInstalled}
                  readOnly
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                    } ${errors.dateInstalled ? 'border-red-500' : ''}`}
                />
                <Calendar className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Full Name</label>
              <input
                type="text"
                value={formData.fullName}
                readOnly
                className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.fullName ? 'border-red-500' : ''}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Contact Number</label>
              <input
                type="text"
                value={formData.contactNumber}
                readOnly
                className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.contactNumber ? 'border-red-500' : ''}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Email Address</label>
              <input
                type="text"
                value={formData.emailAddress}
                readOnly
                className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.emailAddress ? 'border-red-500' : ''}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Plan</label>
              <input
                type="text"
                value={formData.plan}
                readOnly
                className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.plan ? 'border-red-500' : ''}`}
              />
            </div>



            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Username</label>
              <input
                type="text"
                value={formData.username}
                readOnly
                className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.username ? 'border-red-500' : ''}`}
              />
            </div>

            {!isPulloutByAdmin && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Connection Type</label>
                  <input
                    type="text"
                    value={formData.connectionType}
                    readOnly
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                      }`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Router/Modem SN</label>
                  <input
                    type="text"
                    value={formData.routerModemSN}
                    readOnly
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                      } ${errors.routerModemSN ? 'border-red-500' : ''}`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>LCP</label>
                  <input
                    type="text"
                    value={formData.lcp}
                    onChange={(e) => handleInputChange('lcp', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                      }`}
                    readOnly
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>NAP</label>
                  <input
                    type="text"
                    value={formData.nap}
                    onChange={(e) => handleInputChange('nap', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                      }`}
                    readOnly
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>PORT</label>
                  <input
                    type="text"
                    value={formData.port}
                    onChange={(e) => handleInputChange('port', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                      } ${errors.port ? 'border-red-500' : ''}`}
                    readOnly
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>VLAN</label>
                  <input
                    type="text"
                    value={formData.vlan}
                    onChange={(e) => handleInputChange('vlan', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                      } ${errors.vlan ? 'border-red-500' : ''}`}
                    readOnly
                  />
                </div>
              </>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Support Status</label>
              <div className="relative">
                <select
                  value={formData.supportStatus}
                  onChange={(e) => handleInputChange('supportStatus', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary appearance-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                    }`}
                >
                  <option value="Resolved">Resolved</option>
                  <option value="Failed">Failed</option>
                  <option value="In Progress">In Progress</option>
                  <option value="For Visit">For Visit</option>
                  <option value="Open">Open</option>
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
            </div>

            {formData.supportStatus === 'For Visit' && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Visit Status<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select
                      value={formData.visitStatus}
                      onChange={(e) => handleInputChange('visitStatus', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary appearance-none ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                        } ${errors.visitStatus ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                    >
                      <option value="">Select Visit Status</option>
                      <option value="Done">Done</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Failed">Failed</option>
                      <option value="Reschedule">Reschedule</option>
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.visitStatus && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                      <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                    </div>
                  )}
                  {/* Stamped by the API the day a technician moves the Visit
                      Status, and only then. Read-only here: the column is
                      derived server-side, so it is never sent back up. */}
                  {visitStatusDate && (
                    <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Visit Status Date: {visitStatusDate}
                    </p>
                  )}
                </div>

                <SearchableField
                  label="Assigned Email"
                  value={[{ name: 'None', email: 'None' }, ...technicianUsers].find(t => t.email === formData.assignedEmail)?.name || formData.assignedEmail}
                  onSelect={(val, option) => handleInputChange('assignedEmail', option?.email || val)}
                  options={[{ name: 'None', email: 'None' }, ...technicianUsers]}
                  optionLabelKey="name"
                  isDarkMode={isDarkMode}
                  error={errors.assignedEmail}
                  required
                  placeholder="Select Technician"
                />

                {formData.visitStatus === 'Done' && (
                  <>
                    <SearchableField
                      label="Repair Category"
                      value={formData.repairCategory}
                      onSelect={(val) => handleInputChange('repairCategory', val)}
                      options={repairCategoryOptions}
                      optionLabelKey="name"
                      isDarkMode={isDarkMode}
                      error={errors.repairCategory}
                      required
                      placeholder="Select Repair Category"
                    />


                    {/* Reactivation: the line the account is coming back on.
                        Both optional — most reactivations restore the customer to
                        the port they left on, and leaving these blank says exactly
                        that. Filling either one is what renames the PPPoE account
                        in RADIUS, because the username is built from LCP, NAP and
                        port. The router serial, VLAN and model are not offered:
                        replacing hardware is a different repair category. */}
                    {isReactivateCategory(formData.repairCategory) && (
                      <>
                        <div className={`px-3 py-2 rounded text-xs ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
                          Leave both blank if the account is coming back on the same line.
                          Setting either one renames the customer's PPPoE username in RADIUS
                          to match the new LCP / NAP / Port.
                        </div>

                        <SearchableField
                          label="New LCP-NAP"
                          value={formData.newLcpnap}
                          onSelect={(val) => handleInputChange('newLcpnap', val)}
                          options={lcpnaps}
                          optionLabelKey="lcpnap_name"
                          isDarkMode={isDarkMode}
                          error={errors.newLcpnap}
                          placeholder="Search LCP-NAP..."
                        />

                        <div>
                          <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>New Port</label>
                          <div className="relative">
                            <select
                              value={formData.newPort}
                              onChange={(e) => handleInputChange('newPort', e.target.value)}
                              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                                } ${errors.newPort ? 'border-red-500' : ''}`}
                            >
                              <option value="">{formData.newLcpnap ? 'Select Port' : 'Select LCP-NAP first'}</option>
                              {Array.from({ length: totalPorts }, (_, i) => {
                                const portVal = `P${(i + 1).toString().padStart(2, '0')}`;
                                const isUsed = usedPorts.includes(portVal);
                                const isSelected = formData.newPort === portVal;

                                if (isUsed && !isSelected) return null;

                                return (
                                  <option key={portVal} value={portVal}>
                                    {portVal}
                                  </option>
                                );
                              })}
                            </select>
                            <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                              }`} size={20} />
                          </div>
                        </div>
                      </>
                    )}

                    {RELOCATION_CATEGORIES.includes(formData.repairCategory) && (
                      <>
                        <div>
                          <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>New Router Modem SN<span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={formData.newRouterModemSN}
                            onChange={(e) => handleInputChange('newRouterModemSN', e.target.value)}
                            placeholder="Enter Router Modem SN"
                            className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                              } ${errors.newRouterModemSN ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                          />
                          {errors.newRouterModemSN && (
                            <div className="flex items-center mt-1">
                              <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                              <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                            </div>
                          )}
                        </div>

                        <SearchableField
                          label="New LCP-NAP"
                          value={formData.newLcpnap}
                          onSelect={(val) => handleInputChange('newLcpnap', val)}
                          options={lcpnaps}
                          optionLabelKey="lcpnap_name"
                          isDarkMode={isDarkMode}
                          error={errors.newLcpnap}
                          required
                          placeholder="Search LCP-NAP..."
                        />


                        <div>
                          <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>New Port<span className="text-red-500">*</span></label>
                          <div className="relative">
                            <select
                              value={formData.newPort}
                              onChange={(e) => handleInputChange('newPort', e.target.value)}
                              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                                } ${errors.newPort ? 'border-red-500' : ''}`}
                            >
                              <option value="">{formData.newLcpnap ? 'Select Port' : 'Select LCP-NAP first'}</option>
                              {Array.from({ length: totalPorts }, (_, i) => {
                                const portVal = `P${(i + 1).toString().padStart(2, '0')}`;
                                const isUsed = usedPorts.includes(portVal);
                                const isSelected = formData.newPort === portVal;

                                if (isUsed && !isSelected) return null;

                                return (
                                  <option key={portVal} value={portVal}>
                                    {portVal}
                                  </option>
                                );
                              })}
                            </select>
                            <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                              }`} size={20} />
                          </div>
                          {errors.newPort && (
                            <div className="flex items-center mt-1">
                              <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                              <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                            </div>
                          )}
                        </div>

                        <SearchableField
                          label="New VLAN"
                          value={formData.newVlan}
                          onSelect={(val) => handleInputChange('newVlan', val)}
                          options={[{ name: 'None' }, ...vlans.map(v => ({ name: v }))]}
                          optionLabelKey="name"
                          isDarkMode={isDarkMode}
                          error={errors.newVlan}
                          required
                          placeholder="Select VLAN"
                        />


                        <SearchableField
                          label="Router Model"
                          value={formData.routerModel}
                          onSelect={(val) => handleInputChange('routerModel', val)}
                          options={[{ model: 'None' }, ...routerModels]}
                          optionLabelKey="model"
                          isDarkMode={isDarkMode}
                          error={errors.routerModel}
                          required
                          placeholder="Select Router Model"
                        />

                      </>
                    )}

                    {formData.repairCategory === 'Replace Router' && (
                      <div>
                        <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}>New Router Modem SN<span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={formData.newRouterModemSN}
                          onChange={(e) => handleInputChange('newRouterModemSN', e.target.value)}
                          placeholder="Enter Router Modem SN"
                          className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                            } ${errors.newRouterModemSN ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                        />
                        {errors.newRouterModemSN && (
                          <div className="flex items-center mt-1">
                            <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                            <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                          </div>
                        )}
                      </div>
                    )}


                    {formData.repairCategory === 'Update Vlan' && (
                      <SearchableField
                        label="New VLAN"
                        value={formData.newVlan}
                        onSelect={(val) => handleInputChange('newVlan', val)}
                        options={[{ name: 'None' }, ...vlans.map(v => ({ name: v }))]}
                        optionLabelKey="name"
                        isDarkMode={isDarkMode}
                        error={errors.newVlan}
                        required
                        placeholder="Select VLAN"
                      />

                    )}

                    <SearchableField
                      label="Visit By"
                      value={formData.visitBy}
                      onSelect={(val) => handleInputChange('visitBy', val)}
                      options={[{ name: 'None' }, ...technicians.filter(t => t.name !== formData.visitWith && t.name !== formData.visitWithOther)]}
                      optionLabelKey="name"
                      isDarkMode={isDarkMode}
                      error={errors.visitBy}
                      required
                      placeholder="Select Visit By"
                    />

                    <SearchableField
                      label="Visit With"
                      value={formData.visitWith || ''}
                      onSelect={(val) => handleInputChange('visitWith', val)}
                      options={[{ name: 'None' }, ...technicians.filter((tech) => tech.name !== formData.visitBy && tech.name !== formData.visitWithOther)]}
                      optionLabelKey="name"
                      isDarkMode={isDarkMode}
                      placeholder="Select Visit With"
                    />

                    <SearchableField
                      label="Visit With Other"
                      value={formData.visitWithOther || ''}
                      onSelect={(val) => handleInputChange('visitWithOther', val)}
                      options={[{ name: 'None' }, ...technicians.filter((tech) => tech.name !== formData.visitBy && tech.name !== formData.visitWith)]}
                      optionLabelKey="name"
                      isDarkMode={isDarkMode}
                      placeholder="Select Visit With Other"
                    />


                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>Visit Remarks<span className="text-red-500">*</span></label>
                      <textarea
                        value={formData.visitRemarks}
                        onChange={(e) => handleInputChange('visitRemarks', e.target.value)}
                        rows={3}
                        className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary resize-none ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                          } ${errors.visitRemarks ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                      />
                      {errors.visitRemarks && (
                        <div className="flex items-center mt-1">
                          <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                          <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>Client Signature</label>

                      <div className={`border rounded overflow-hidden ${isDarkMode ? 'bg-white border-gray-700' : 'bg-white border-gray-300'}`}>
                        {(imagePreviews.clientSignatureFile || formData.clientSignature) ? (
                          <div className="relative w-full h-48 bg-white flex items-center justify-center">
                            <img
                              src={imagePreviews.clientSignatureFile || formData.clientSignature}
                              alt="Client Signature"
                              className="max-w-full max-h-full object-contain"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setImagePreviews(prev => ({ ...prev, clientSignatureFile: null }));
                                setImageFiles(prev => ({ ...prev, clientSignatureFile: null }));
                                setFormData(prev => ({ ...prev, clientSignature: '' }));
                              }}
                              className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white p-2 rounded-full shadow-lg transition-colors"
                              title="Clear Signature"
                            >
                              <Eraser size={16} />
                            </button>
                            {imagePreviews.clientSignatureFile && (
                              <div className="absolute bottom-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs flex items-center pointer-events-none">
                                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                New
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="relative w-full h-48 bg-white">
                            <SignatureCanvas
                              ref={sigCanvas}
                              penColor="black"
                              canvasProps={{
                                className: 'w-full h-full cursor-crosshair'
                              }}
                              backgroundColor="white"
                            />
                            <div className="absolute top-2 right-2">
                              <button
                                type="button"
                                onClick={() => sigCanvas.current?.clear()}
                                className="bg-gray-200 hover:bg-gray-300 text-gray-700 p-2 rounded-full shadow transition-colors"
                                title="Clear Canvas"
                              >
                                <Eraser size={16} />
                              </button>
                            </div>
                            <div className="absolute bottom-2 left-2 pointer-events-none opacity-50 text-xs text-gray-500">
                              Sign above
                            </div>
                          </div>
                        )}
                      </div>

                      {errors.clientSignature && (
                        <div className="flex items-center mt-1">
                          <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                          <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>Items</label>
                      {orderItems.map((item, index) => (
                        <div key={index} className="mb-3">
                          <div className="flex items-start gap-2">
                            <div className="flex-1">
                              <SearchableField
                                label={`Item ${index + 1}`}
                                value={item.itemId}
                                onSelect={(val) => handleItemChange(index, 'itemId', val)}
                                options={[{ item_name: 'None' }, ...inventoryItems]}
                                optionLabelKey="item_name"
                                isDarkMode={isDarkMode}
                                error={errors[`item_${index}`]}
                                placeholder={`Search Item ${index + 1}...`}
                              />
                            </div>


                            {item.itemId && (
                              <div className="w-32">
                                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Qty</label>
                                <input
                                  type="number"
                                  value={item.quantity}
                                  onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                                  placeholder="Qty"
                                  min="1"
                                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                                    }`}
                                />
                                {errors[`quantity_${index}`] && (
                                  <p className="text-xs mt-1" style={{ color: colorPalette?.primary || '#7c3aed' }}>{errors[`quantity_${index}`]}</p>
                                )}
                              </div>
                            )}

                            {orderItems.length > 1 && item.itemId && (
                              <div className="flex flex-col">
                                <div className="h-7 mb-2"></div> {/* Spacer to align with labels */}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(index)}
                                  className="p-2 text-red-500 hover:text-red-400"
                                >
                                  <X size={20} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {errors.items && (
                        <div className="flex items-center mt-1">
                          <div
                            className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2"
                            style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                          >!</div>
                          <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>{errors.items}</p>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>Time In</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageChange('timeInFile', e.target.files?.[0] || null)}
                        className="hidden"
                        id="timeInInput"
                      />
                      <label
                        htmlFor="timeInInput"
                        className={`relative w-full h-48 border rounded overflow-hidden cursor-pointer flex flex-col items-center justify-center ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                          }`}
                      >
                        {imagePreviews.timeInFile ? (
                          <div className="relative w-full h-full">
                            <img
                              src={imagePreviews.timeInFile}
                              alt="Time In"
                              className="w-full h-full object-contain"
                            />
                            <div className="absolute bottom-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs flex items-center pointer-events-none">
                              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              Uploaded
                            </div>
                          </div>
                        ) : (
                          <>
                            <svg className="w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <p className="text-gray-400 text-sm">Click to upload</p>
                          </>
                        )}
                      </label>
                      {errors.timeIn && (
                        <div className="flex items-center mt-1">
                          <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                          <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>Modem Setup Image</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageChange('modemSetupFile', e.target.files?.[0] || null)}
                        className="hidden"
                        id="modemSetupInput"
                      />
                      <label
                        htmlFor="modemSetupInput"
                        className={`relative w-full h-48 border rounded overflow-hidden cursor-pointer flex flex-col items-center justify-center ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                          }`}
                      >
                        {imagePreviews.modemSetupFile ? (
                          <div className="relative w-full h-full">
                            <img
                              src={imagePreviews.modemSetupFile}
                              alt="Modem Setup"
                              className="w-full h-full object-contain"
                            />
                            <div className="absolute bottom-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs flex items-center pointer-events-none">
                              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              Uploaded
                            </div>
                          </div>
                        ) : (
                          <>
                            <svg className="w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <p className="text-gray-400 text-sm">Click to upload</p>
                          </>
                        )}
                      </label>
                      {errors.modemSetupImage && (
                        <div className="flex items-center mt-1">
                          <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                          <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>Time Out</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageChange('timeOutFile', e.target.files?.[0] || null)}
                        className="hidden"
                        id="timeOutInput"
                      />
                      <label
                        htmlFor="timeOutInput"
                        className={`relative w-full h-48 border rounded overflow-hidden cursor-pointer flex flex-col items-center justify-center ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                          }`}
                      >
                        {imagePreviews.timeOutFile ? (
                          <div className="relative w-full h-full">
                            <img
                              src={imagePreviews.timeOutFile}
                              alt="Time Out"
                              className="w-full h-full object-contain"
                            />
                            <div className="absolute bottom-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs flex items-center pointer-events-none">
                              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              Uploaded
                            </div>
                          </div>
                        ) : (
                          <>
                            <svg className="w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <p className="text-gray-400 text-sm">Click to upload</p>
                          </>
                        )}
                      </label>
                      {errors.timeOut && (
                        <div className="flex items-center mt-1">
                          <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                          <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {(formData.visitStatus === 'Reschedule' || formData.visitStatus === 'Failed') && (
                  <>
                    <SearchableField
                      label="Visit By"
                      value={formData.visitBy}
                      onSelect={(val) => handleInputChange('visitBy', val)}
                      options={[{ name: 'None' }, ...technicians]}
                      optionLabelKey="name"
                      isDarkMode={isDarkMode}
                      error={errors.visitBy}
                      required
                      placeholder="Select Visit By"
                    />

                    <SearchableField
                      label="Visit With"
                      value={formData.visitWith || ''}
                      onSelect={(val) => handleInputChange('visitWith', val)}
                      options={[{ name: 'None' }, ...technicians.filter(tech => tech.name !== formData.visitBy && tech.name !== formData.visitWithOther)]}
                      optionLabelKey="name"
                      isDarkMode={isDarkMode}
                      required
                      error={errors.visitWith}
                      placeholder="Select Visit With"
                    />

                    <SearchableField
                      label="Visit With Other"
                      value={formData.visitWithOther || ''}
                      onSelect={(val) => handleInputChange('visitWithOther', val)}
                      options={[{ name: 'None' }, ...technicians.filter(tech => tech.name !== formData.visitBy && tech.name !== formData.visitWith)]}
                      optionLabelKey="name"
                      isDarkMode={isDarkMode}
                      required
                      error={errors.visitWithOther}
                      placeholder="Select Visit With Other"
                    />


                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Visit Remarks<span className="text-red-500">*</span></label>
                      <textarea
                        value={formData.visitRemarks}
                        onChange={(e) => handleInputChange('visitRemarks', e.target.value)}
                        rows={3}
                        className={`w-full px-3 py-2 bg-gray-800 border ${errors.visitRemarks ? 'border-red-500' : 'border-gray-700'} rounded text-white focus:outline-none focus-primary resize-none`}
                      />
                      {errors.visitRemarks && (
                        <div className="flex items-center mt-1">
                          <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                          <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}



            {isTechnician ? (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>Concern<span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.concern}
                  readOnly
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                    } ${errors.concern ? 'border-red-500' : ''}`}
                />
              </div>
            ) : (
              <SearchableField
                label="Concern"
                value={formData.concern}
                onSelect={(val) => handleInputChange('concern', val)}
                options={concernOptions}
                optionLabelKey="concern_name"
                isDarkMode={isDarkMode}
                error={errors.concern}
                required
                placeholder="Select Concern"
              />
            )}


            {formData.concern === 'Upgrade/Downgrade Plan' && (
              <div className="mt-4">
                <SearchableField
                  label="New Plan"
                  value={formData.newPlan}
                  onSelect={(val) => handleInputChange('newPlan', val)}
                  options={plans.map(p => ({ name: p }))}
                  optionLabelKey="name"
                  isDarkMode={isDarkMode}
                  error={errors.newPlan}
                  required
                  placeholder="Select New Plan"
                />
              </div>
            )}


            {formData.concern === 'Relocation' && canEditRelocationAddress && (
              <div className="mt-4 space-y-4">
                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  New customer address. Optional &mdash; leave unchanged if the address is the same.
                  Saved to the customer record only when Support Status is <strong>Resolved</strong>.
                </p>

                {hasPendingAddressEdits && !isSupportStatusResolved && (
                  <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>
                    Support Status is &ldquo;{formData.supportStatus || 'not set'}&rdquo;, so these
                    address changes will not be saved yet. Set Support Status to Resolved to apply them.
                  </p>
                )}

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Region</label>
                  <div className="relative">
                    <select
                      value={formData.region}
                      onChange={(e) => handleInputChange('region', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary appearance-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                        }`}
                    >
                      <option value="">Select Region</option>
                      {formData.region && !regions.some(reg => reg.name === formData.region) && (
                        <option value={formData.region}>{formData.region}</option>
                      )}
                      {regions.map(region => (
                        <option key={region.id} value={region.name}>{region.name}</option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>City</label>
                  <div className="relative">
                    <select
                      value={formData.city}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                      disabled={!formData.region}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                        }`}
                    >
                      <option value="">{formData.region ? 'Select City' : 'Select Region First'}</option>
                      {formData.city && !getFilteredCities().some(city => city.name === formData.city) && (
                        <option value={formData.city}>{formData.city}</option>
                      )}
                      {getFilteredCities().map(city => (
                        <option key={city.id} value={city.name}>{city.name}</option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Barangay</label>
                  <div className="relative">
                    <select
                      value={formData.barangay}
                      onChange={(e) => handleInputChange('barangay', e.target.value)}
                      disabled={!formData.city}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                        }`}
                    >
                      <option value="">{formData.city ? 'Select Barangay' : 'Select City First'}</option>
                      {formData.barangay && !getFilteredBarangays().some(brgy => brgy.barangay === formData.barangay) && (
                        <option value={formData.barangay}>{formData.barangay}</option>
                      )}
                      {getFilteredBarangays().map(brgy => (
                        <option key={brgy.id} value={brgy.barangay}>{brgy.barangay}</option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    placeholder="House no., street, subdivision"
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                      }`}
                  />
                </div>
              </div>
            )}


            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Concern Remarks{!isTechnician && <span className="text-red-500">*</span>}</label>
              <textarea
                value={formData.concernRemarks}
                onChange={(e) => handleInputChange('concernRemarks', e.target.value)}
                readOnly={isTechnician}
                rows={3}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary resize-none ${isTechnician
                  ? isDarkMode
                    ? 'bg-gray-800 text-gray-400 border-gray-700 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-500 border-gray-300 cursor-not-allowed'
                  : isDarkMode
                    ? 'bg-gray-800 text-white'
                    : 'bg-white text-gray-900'
                  } ${errors.concernRemarks ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
              />
              {errors.concernRemarks && (
                <div className="flex items-center mt-1">
                  <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2"
                    style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                  <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                </div>
              )}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Modified By</label>
              <input
                type="email"
                value={formData.modifiedBy}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-700 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-500'
                  }`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Modified Date</label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.modifiedDate}
                  readOnly
                  className={`w-full px-3 py-2 border rounded cursor-not-allowed pr-10 ${isDarkMode ? 'bg-gray-700 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-500'
                    }`}
                />
                <Calendar className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                  }`} size={20} />
              </div>
            </div>


            {checkReconnectionTrigger() && (
              <div className={`p-3 rounded-lg flex items-start space-x-3 mb-4 ${isDarkMode ? 'bg-blue-900/30 border border-blue-800' : 'bg-blue-50 border border-blue-200'
                }`}>
                <div className={`mt-0.5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                  <CheckCircle size={18} />
                </div>
                <div>
                  <p className={`text-sm font-medium ${isDarkMode ? 'text-blue-300' : 'text-blue-800'}`}>
                    Reconnection Trigger Detected
                  </p>
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-blue-400/80' : 'text-blue-700/80'}`}>
                    Saving this service order with "Resolved" status will automatically trigger a technical reconnection and set the billing status to "Active".
                  </p>
                </div>
              </div>
            )}

            {checkMigrationTrigger() && (
              <div className={`p-3 rounded-lg flex items-start space-x-3 mb-4 ${isDarkMode ? 'bg-amber-900/30 border border-amber-800' : 'bg-amber-50 border border-amber-200'
                }`}>
                <div className={`mt-0.5 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                  <CheckCircle size={18} />
                </div>
                <div>
                  <p className={`text-sm font-medium ${isDarkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                    Migration Trigger Detected
                  </p>
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-amber-400/80' : 'text-amber-700/80'}`}>
                    Saving this service order with "Done" visit status and "Migrate" repair category will automatically regenerate the RADIUS username based on the technical details pattern (same as Job Order). The password will remain unchanged.
                  </p>
                </div>
              </div>
            )}

            {reactivateLineMove().length > 0 && (
              <div className={`p-3 rounded-lg flex items-start space-x-3 mb-4 ${isDarkMode ? 'bg-amber-900/30 border border-amber-800' : 'bg-amber-50 border border-amber-200'
                }`}>
                <div className={`mt-0.5 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                  <CheckCircle size={18} />
                </div>
                <div>
                  <p className={`text-sm font-medium ${isDarkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                    Reactivation Moves the Line ({reactivateLineMove().map(f => f.toUpperCase()).join(', ')})
                  </p>
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-amber-400/80' : 'text-amber-700/80'}`}>
                    This reactivation puts the account on a different LCP / NAP / Port, so saving it will regenerate the customer's PPPoE username and rename the account in RADIUS. The password stays the same. The customer's router must be reconfigured with the new username before it can reconnect.
                  </p>
                </div>
              </div>
            )}

            {checkRestrictionTrigger() && (
              <div className={`p-3 rounded-lg flex items-start space-x-3 mb-4 ${isDarkMode ? 'bg-red-900/30 border border-red-800' : 'bg-red-50 border border-red-200'
                }`}>
                <div className={`mt-0.5 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                  <CheckCircle size={18} />
                </div>
                <div>
                  <p className={`text-sm font-medium ${isDarkMode ? 'text-red-300' : 'text-red-800'}`}>
                    Restriction Trigger Detected
                  </p>
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-red-400/80' : 'text-red-700/80'}`}>
                    Saving this service order with "Resolved" status and "{formData.concern}" concern will automatically trigger a technical restriction in RADIUS and set the billing status to "Inactive".
                  </p>
                </div>
              </div>
            )}

            {!isPulloutByAdmin && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>Support Remarks{!isTechnician && <span className="text-red-500">*</span>}</label>
                <textarea
                  value={formData.supportRemarks}
                  onChange={(e) => handleInputChange('supportRemarks', e.target.value)}
                  readOnly={isTechnician}
                  rows={3}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus-primary resize-none ${isTechnician
                    ? isDarkMode
                      ? 'bg-gray-800 text-gray-400 border-gray-700 cursor-not-allowed'
                      : 'bg-gray-100 text-gray-500 border-gray-300 cursor-not-allowed'
                    : isDarkMode
                      ? 'bg-gray-800 text-white'
                      : 'bg-white text-gray-900'
                    } ${errors.supportRemarks ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                />
                {errors.supportRemarks && (
                  <div className="flex items-center mt-1">
                    <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2"
                      style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                    <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                  </div>
                )}
              </div>
            )}

            {!isPulloutByAdmin && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>Service Charge<span className="text-red-500">*</span></label>
                <div className={`flex items-center border rounded ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                  }`}>
                  <span className={`px-3 py-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>₱</span>
                  <input
                    type="number"
                    value={formData.serviceCharge}
                    onChange={(e) => handleInputChange('serviceCharge', e.target.value)}
                    step="0.01"
                    className={`flex-1 px-3 py-2 bg-transparent focus:outline-none ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}
                  />
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => handleNumberChange('serviceCharge', false)}
                      className={`px-3 py-2 border-l ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'
                        }`}
                      onMouseEnter={(e) => {
                        if (colorPalette?.primary) e.currentTarget.style.color = colorPalette.primary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '';
                      }}
                    >
                      <Minus size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNumberChange('serviceCharge', true)}
                      className={`px-3 py-2 border-l ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'
                        }`}
                      onMouseEnter={(e) => {
                        if (colorPalette?.primary) e.currentTarget.style.color = colorPalette.primary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '';
                      }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                {errors.serviceCharge && (
                  <div className="flex items-center mt-1">
                    <div className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs mr-2" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>!</div>
                    <p className="text-xs" style={{ color: colorPalette?.primary || '#7c3aed' }}>This entry is required</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {modal.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
            <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
              }`}>
              {modal.type === 'loading' ? (
                <div className="text-center">
                  <div className="flex justify-center mb-6">
                    <div className="relative">
                      <div className="animate-spin rounded-full h-20 w-20 border-b-4 border-t-4" style={{ borderColor: colorPalette?.primary || '#7c3aed', borderTopColor: 'transparent' }}></div>
                    </div>
                  </div>
                  <div className="mb-6">
                    <p className={`text-5xl font-extrabold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{Math.round(uploadProgress)}%</p>
                  </div>
                  <div className={`w-full h-3 bg-gray-200 rounded-full overflow-hidden mb-2 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                    <div
                      className="h-full transition-all duration-500 ease-out rounded-full"
                      style={{
                        width: `${uploadProgress}%`,
                        backgroundColor: colorPalette?.primary || '#7c3aed',
                        boxShadow: `0 0 15px ${colorPalette?.primary || '#7c3aed'}40`
                      }}
                    ></div>
                  </div>
                  {modal.message && (
                    <p className={`mt-4 text-sm text-center transition-opacity duration-300 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {modal.message}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>{modal.title}</h3>
                  <p className={`mb-6 whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>{modal.message}</p>
                  <div className="flex items-center justify-end gap-3">
                    {modal.type === 'confirm' ? (
                      <>
                        <button
                          onClick={modal.onCancel}
                          className={`px-4 py-2 rounded transition-colors ${isDarkMode
                            ? 'bg-gray-700 hover:bg-gray-600 text-white'
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                            }`}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={modal.onConfirm}
                          className="px-4 py-2 text-white rounded transition-colors"
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
                        >
                          Confirm
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          if (modal.onConfirm) {
                            modal.onConfirm();
                          } else {
                            setModal({ ...modal, isOpen: false });
                          }
                        }}
                        className="px-4 py-2 text-white rounded transition-colors"
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
                      >
                        OK
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div >
        )}
      </div >
    </>
  );
};

export default ServiceOrderEditModal;
