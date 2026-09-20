import React, { useState, useEffect } from 'react';
import { X, Calendar, ChevronDown, Minus, Plus, Camera, MapPin, Loader2, Search } from 'lucide-react';
import { UserData } from '../types/api';
import { updateJobOrder } from '../services/jobOrderService';
import { updateApplication } from '../services/applicationService';
import { userService } from '../services/userService';
import { planService, Plan } from '../services/planService';
import { routerModelService, RouterModel } from '../services/routerModelService';
import { statusRemarksService, StatusRemark } from '../services/statusRemarksService';
import { getAllLCPNAPs, LCPNAP } from '../services/lcpnapService';
import { getUsedPorts } from '../services/portService';
import { getAllVLANs, VLAN } from '../services/vlanService';
import { getAllUsageTypes, UsageType } from '../services/usageTypeService';
import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import { getAllInventoryItems, InventoryItem } from '../services/inventoryItemService';
import { createJobOrderItems, JobOrderItem } from '../services/jobOrderItemService';
import apiClient from '../config/api';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import {
  referredByFields,
  referredByForSave,
} from '../utils/referredByField';

interface Region {
  id: number;
  name: string;
}

interface JobOrderEditFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: any) => void;
  jobOrderData?: any;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface JobOrderEditFormData {
  // The agent's NAME, which is what the field shows. What gets stored is the
  // id in referredById — see utils/referredByField.ts.
  referredBy: string;
  referredById: number | null;
  dateInstalled: string;
  usageType: string;
  firstName: string;
  middleInitial: string;
  lastName: string;
  contactNumber: string;
  secondContactNumber: string;
  email: string;
  address: string;
  barangay: string;
  city: string;
  region: string;
  addressCoordinates: string;
  choosePlan: string;
  status: string;
  connectionType: string;
  routerModel: string;
  modemSN: string;
  groupName: string;
  lcpnap: string;
  port: string;
  vlan: string;
  username: string;
  onsiteStatus: string;
  onsiteRemarks: string;
  signedContractImage: File | null;
  setupImage: File | null;
  boxReadingImage: File | null;
  routerReadingImage: File | null;
  portLabelImage: File | null;
  clientSignatureImage: File | null;
  modifiedBy: string;
  modifiedDate: string;
  contractLink: string;
  contractTemplate: string;
  assignedEmail: string;
  itemName1: string;
  visit_by: string;
  visit_with: string;
  visit_with_other: string;
  statusRemarks: string;
  ip: string;
  installationFee: number | string;
}

interface OrderItem {
  itemId: string;
  quantity: string;
}

const convertGoogleDriveUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;

  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch && fileIdMatch[1]) {
    return `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
  }

  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch && idMatch[1]) {
    return `https://drive.google.com/uc?export=view&id=${idMatch[1]}`;
  }

  return url;
};

const isGoogleDriveUrl = (url: string | null): boolean => {
  return url ? url.includes('drive.google.com') : false;
};

const JobOrderEditFormModal: React.FC<JobOrderEditFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  jobOrderData
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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

  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [formData, setFormData] = useState<JobOrderEditFormData>({
    referredBy: '',
    referredById: null,
    dateInstalled: getTodayDate(),
    usageType: '',
    firstName: '',
    middleInitial: '',
    lastName: '',
    contactNumber: '',
    secondContactNumber: '',
    email: '',
    address: '',
    barangay: '',
    city: '',
    region: '',
    addressCoordinates: '',
    choosePlan: '',
    status: 'Confirmed',
    connectionType: '',
    routerModel: '',
    modemSN: '',
    groupName: '',
    lcpnap: '',
    port: '',
    vlan: '',
    username: '',
    onsiteStatus: 'In Progress',
    onsiteRemarks: '',
    signedContractImage: null,
    setupImage: null,
    boxReadingImage: null,
    routerReadingImage: null,
    portLabelImage: null,
    clientSignatureImage: null,
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
    contractLink: '',
    contractTemplate: '1',
    assignedEmail: 'Office',
    itemName1: '',
    visit_by: '',
    visit_with: '',
    visit_with_other: '',
    statusRemarks: '',
    ip: '',
    installationFee: 0
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [technicians, setTechnicians] = useState<Array<{ email: string; name: string }>>([]);
  const [lcpnaps, setLcpnaps] = useState<LCPNAP[]>([]);
  const [usedPorts, setUsedPorts] = useState<string[]>([]);
  const [totalPorts, setTotalPorts] = useState<number>(32);
  const [regions, setRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([{ itemId: '', quantity: '' }]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [routerModels, setRouterModels] = useState<RouterModel[]>([]);
  const [vlans, setVlans] = useState<VLAN[]>([]);
  const [usageTypes, setUsageTypes] = useState<UsageType[]>([]);
  const [statusRemarksList, setStatusRemarksList] = useState<StatusRemark[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [referredBySearch, setReferredBySearch] = useState('');
  const [isReferredByOpen, setIsReferredByOpen] = useState(false);

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [progressSteps, setProgressSteps] = useState<string[]>([]);
  const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);
  const [isLcpnapOpen, setIsLcpnapOpen] = useState(false);

  const [imagePreviews, setImagePreviews] = useState<{
    signedContractImage: string | null;
    setupImage: string | null;
    boxReadingImage: string | null;
    routerReadingImage: string | null;
    portLabelImage: string | null;
    clientSignatureImage: string | null;
    speedTestImage: string | null;
  }>({
    signedContractImage: null,
    setupImage: null,
    boxReadingImage: null,
    routerReadingImage: null,
    portLabelImage: null,
    clientSignatureImage: null,
    speedTestImage: null
  });

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
    const fetchImageSizeSettings = async () => {
      if (isOpen) {
        try {
          const settings = await getActiveImageSize();
          setActiveImageSize(settings);
        } catch (error) {
          setActiveImageSize(null);
        }
      }
    };

    fetchImageSizeSettings();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setOrderItems([{ itemId: '', quantity: '' }]);
      Object.values(imagePreviews).forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    }
  }, [isOpen, imagePreviews]);

  useEffect(() => {
    const fetchJobOrderItems = async () => {
      if (isOpen && jobOrderData) {
        const jobOrderId = jobOrderData.id || jobOrderData.JobOrder_ID;
        if (jobOrderId) {
          try {
            const response = await apiClient.get(`/job-order-items?job_order_id=${jobOrderId}`);
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
            console.error('Error fetching job order items:', error);
            setOrderItems([{ itemId: '', quantity: '' }]);
          }
        }
      }
    };

    fetchJobOrderItems();
  }, [isOpen, jobOrderData]);

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
          console.error('Error fetching Inventory Items:', error);
          setInventoryItems([]);
        }
      }
    };

    fetchInventoryItems();
  }, [isOpen]);

  useEffect(() => {
    const fetchPlans = async () => {
      if (isOpen) {
        try {
          const response = await planService.getAllPlans();

          if (Array.isArray(response)) {
            setPlans(response);
          } else {
            setPlans([]);
          }
        } catch (error) {
          console.error('Error fetching Plans:', error);
          setPlans([]);
        }
      }
    };

    fetchPlans();
  }, [isOpen]);



  useEffect(() => {
    const fetchRouterModels = async () => {
      if (isOpen) {
        try {
          const fetchedRouterModels = await routerModelService.getAllRouterModels();
          setRouterModels(fetchedRouterModels);
        } catch (error) {
          console.error('Error fetching Router Models:', error);
          setRouterModels([]);
        }
      }
    };

    fetchRouterModels();
  }, [isOpen]);

  useEffect(() => {
    const fetchVlans = async () => {
      if (isOpen) {
        try {
          const response = await getAllVLANs();

          if (response.success && Array.isArray(response.data)) {
            setVlans(response.data);
          } else {
            setVlans([]);
          }
        } catch (error) {
          console.error('Error fetching VLANs:', error);
          setVlans([]);
        }
      }
    };

    fetchVlans();
  }, [isOpen]);

  useEffect(() => {
    const fetchUsageTypes = async () => {
      if (isOpen) {
        try {
          const response = await getAllUsageTypes();

          if (response.success && Array.isArray(response.data)) {
            setUsageTypes(response.data);
          } else {
            setUsageTypes([]);
          }
        } catch (error) {
          console.error('Error fetching Usage Types:', error);
          setUsageTypes([]);
        }
      }
    };

    fetchUsageTypes();
  }, [isOpen]);

  useEffect(() => {
    const fetchStatusRemarks = async () => {
      if (isOpen) {
        try {
          const response = await statusRemarksService.getAllStatusRemarks();

          if (Array.isArray(response)) {
            setStatusRemarksList(response);
          } else {
            setStatusRemarksList([]);
          }
        } catch (error) {
          console.error('Error fetching Status Remarks:', error);
          setStatusRemarksList([]);
        }
      }
    };

    fetchStatusRemarks();
  }, [isOpen]);

  useEffect(() => {
    const fetchTechnicians = async () => {
      if (isOpen) {
        try {
          const response = await userService.getUsersByRole('technician');
          if (response.success && response.data) {
            const technicianList = response.data
              .filter((user: any) => user.first_name || user.last_name)
              .map((user: any) => {
                const firstName = (user.first_name || '').trim();
                const lastName = (user.last_name || '').trim();
                const fullName = `${firstName} ${lastName}`.trim();
                return {
                  email: user.email_address || user.email || '',
                  name: fullName || user.username || user.email_address || user.email || ''
                };
              })
              .filter((tech: any) => tech.name);
            setTechnicians(technicianList);
          }
        } catch (error) {
          console.error('Error fetching technicians:', error);
        }
      }
    };

    fetchTechnicians();
  }, [isOpen]);

  useEffect(() => {
    const fetchAgents = async () => {
      if (isOpen) {
        try {
          const response = await userService.getUsersByRole('agent');
          if (response.success && response.data) {
            setAgents(response.data);
          } else {
            const responseById = await userService.getUsersByRoleId(4);
            if (responseById.success && responseById.data) {
              setAgents(responseById.data);
            }
          }
        } catch (error) {
          console.error('Failed to fetch agents:', error);
          setAgents([]);
        }
      }
    };

    fetchAgents();
  }, [isOpen]);

  useEffect(() => {
    const fetchRegions = async () => {
      if (isOpen) {
        try {
          const fetchedRegions = await getRegions();
          if (Array.isArray(fetchedRegions)) {
            setRegions(fetchedRegions);
          } else {
            setRegions([]);
          }
        } catch (error) {
          console.error('Error fetching Regions:', error);
          setRegions([]);
        }
      }
    };

    fetchRegions();
  }, [isOpen]);

  useEffect(() => {
    const fetchAllCities = async () => {
      if (isOpen) {
        try {
          const fetchedCities = await getCities();
          if (Array.isArray(fetchedCities)) {
            setAllCities(fetchedCities);
          } else {
            setAllCities([]);
          }
        } catch (error) {
          console.error('Error fetching Cities:', error);
          setAllCities([]);
        }
      }
    };

    fetchAllCities();
  }, [isOpen]);

  useEffect(() => {
    const fetchAllBarangays = async () => {
      if (isOpen) {
        try {
          const response = await barangayService.getAll();
          if (response.success && Array.isArray(response.data)) {
            setAllBarangays(response.data);
          } else {
            setAllBarangays([]);
          }
        } catch (error) {
          console.error('Error fetching Barangays:', error);
          setAllBarangays([]);
        }
      }
    };

    fetchAllBarangays();
  }, [isOpen]);


  useEffect(() => {
    const fetchLcpnaps = async () => {
      if (isOpen) {
        try {
          const response = await getAllLCPNAPs();

          if (response.success && Array.isArray(response.data)) {
            setLcpnaps(response.data);
          } else {
            setLcpnaps([]);
          }
        } catch (error) {
          console.error('Error fetching LCPNAP records:', error);
          setLcpnaps([]);
        }
      }
    };

    fetchLcpnaps();
  }, [isOpen]);

  useEffect(() => {
    const fetchUsedPorts = async () => {
      if (isOpen && formData.lcpnap) {
        try {
          const jobOrderId = jobOrderData?.id || jobOrderData?.JobOrder_ID;
          const response = await getUsedPorts(formData.lcpnap, jobOrderId);

          if (response.success && response.data) {
            setUsedPorts(response.data.used);
            setTotalPorts(response.data.total);
          } else {
            console.warn('Unexpected Port response structure:', response);
            setUsedPorts([]);
            setTotalPorts(32);
          }
        } catch (error) {
          console.error('Error fetching Used Ports:', error);
          setUsedPorts([]);
          setTotalPorts(32);
        }
      } else if (isOpen && !formData.lcpnap) {
        setUsedPorts([]);
        setTotalPorts(32);
      }
    };
    fetchUsedPorts();
  }, [isOpen, jobOrderData, formData.lcpnap]);

  useEffect(() => {
    if (!isOpen) return;

    if (jobOrderData) {
      const isValidImageUrl = (url: any): boolean => {
        if (!url) return false;
        if (typeof url !== 'string') return false;
        const trimmed = url.trim().toLowerCase();
        return trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined';
      };

      const getImageUrl = (fieldVariations: string[]): string | null => {
        for (const field of fieldVariations) {
          const value = jobOrderData?.[field];
          if (isValidImageUrl(value)) {
            return value;
          }
        }
        return null;
      };

      const clientSignatureVariations = [
        'client_signature_image_url',
        'Client_Signature_Image_URL',
        'client_sig_image_url',
        'signature_image_url',
        'clientSignatureImageUrl',
        'ClientSignatureImageURL',
        'client_signature_url',
        'clientSignatureUrl'
      ];

      const newImagePreviews = {
        signedContractImage: convertGoogleDriveUrl(jobOrderData?.signed_contract_image_url || jobOrderData?.Signed_Contract_Image_URL),
        setupImage: convertGoogleDriveUrl(jobOrderData?.setup_image_url || jobOrderData?.Setup_Image_URL),
        boxReadingImage: convertGoogleDriveUrl(jobOrderData?.box_reading_image_url || jobOrderData?.Box_Reading_Image_URL),
        routerReadingImage: convertGoogleDriveUrl(jobOrderData?.router_reading_image_url || jobOrderData?.Router_Reading_Image_URL),
        portLabelImage: convertGoogleDriveUrl(jobOrderData?.port_label_image_url || jobOrderData?.Port_Label_Image_URL),
        clientSignatureImage: convertGoogleDriveUrl(getImageUrl(clientSignatureVariations)),
        speedTestImage: convertGoogleDriveUrl(jobOrderData?.speedtest_image_url || jobOrderData?.Speedtest_Image_URL)
      };

      setImagePreviews(newImagePreviews);

      const errorsToClear: string[] = [];
      if (newImagePreviews.signedContractImage) errorsToClear.push('signedContractImage');
      if (newImagePreviews.setupImage) errorsToClear.push('setupImage');
      if (newImagePreviews.boxReadingImage) errorsToClear.push('boxReadingImage');
      if (newImagePreviews.routerReadingImage) errorsToClear.push('routerReadingImage');
      if (newImagePreviews.portLabelImage) errorsToClear.push('portLabelImage');
      if (newImagePreviews.clientSignatureImage) errorsToClear.push('clientSignatureImage');
      if (newImagePreviews.speedTestImage) errorsToClear.push('speedTestImage');

      if (errorsToClear.length > 0) {
        setErrors(prev => {
          const newErrors = { ...prev };
          errorsToClear.forEach(key => delete newErrors[key]);
          return newErrors;
        });
      }
    } else {
      setImagePreviews({
        signedContractImage: null,
        setupImage: null,
        boxReadingImage: null,
        routerReadingImage: null,
        portLabelImage: null,
        clientSignatureImage: null,
        speedTestImage: null
      });
    }
  }, [jobOrderData, isOpen]);

  useEffect(() => {
    if (jobOrderData && isOpen) {
      const loadedStatus = jobOrderData.Status || jobOrderData.status || 'Confirmed';
      const loadedOnsiteStatus = jobOrderData.Onsite_Status || jobOrderData.onsite_status || 'In Progress';

      const fetchApplicationData = async () => {
        try {
          const applicationId = jobOrderData.application_id || jobOrderData.Application_ID;
          if (applicationId) {
            const appResponse = await apiClient.get<{ success: boolean; application: any }>(`/applications/${applicationId}`);
            if (appResponse.data.success && appResponse.data.application) {
              const appData = appResponse.data.application;

              setFormData(prev => ({
                ...prev,
                // Only the stored value and the id beside it; the name is
                // filled in by the effect that runs once agents have loaded.
                ...referredByFields(jobOrderData, []),
                dateInstalled: jobOrderData.Date_Installed || jobOrderData.date_installed || getTodayDate(),
                usageType: jobOrderData.Usage_Type || jobOrderData.usage_type || '',
                firstName: jobOrderData.First_Name || jobOrderData.first_name || '',
                middleInitial: jobOrderData.Middle_Initial || jobOrderData.middle_initial || '',
                lastName: jobOrderData.Last_Name || jobOrderData.last_name || '',
                contactNumber: jobOrderData.Mobile_Number || jobOrderData.Contact_Number || jobOrderData.mobile_number || jobOrderData.contact_number || '',
                secondContactNumber: jobOrderData.Secondary_Mobile_Number || jobOrderData.second_contact_number || '',
                email: jobOrderData.Email_Address || jobOrderData.Applicant_Email_Address || jobOrderData.email_address || jobOrderData.email || '',
                address: jobOrderData.Address || jobOrderData.Installation_Address || jobOrderData.address || jobOrderData.installation_address || '',
                barangay: appData.barangay || jobOrderData.Barangay || jobOrderData.barangay || '',
                city: appData.city || jobOrderData.City || jobOrderData.city || '',
                region: appData.region || jobOrderData.Region || jobOrderData.region || '',
                addressCoordinates: jobOrderData.Address_Coordinates || jobOrderData.address_coordinates || '',
                choosePlan: jobOrderData.Desired_Plan || jobOrderData.desired_plan || jobOrderData.Choose_Plan || jobOrderData.choose_plan || jobOrderData.plan || '',
                status: loadedStatus,
                connectionType: jobOrderData.Connection_Type || jobOrderData.connection_type || '',
                routerModel: jobOrderData.Router_Model || jobOrderData.router_model || '',
                modemSN: jobOrderData.Modem_SN || jobOrderData.modem_sn || '',

                lcpnap: jobOrderData.LCPNAP || jobOrderData.lcpnap || '',
                port: jobOrderData.PORT || jobOrderData.port || '',
                vlan: jobOrderData.VLAN || jobOrderData.vlan || '',
                username: jobOrderData.Username || jobOrderData.username || '',
                onsiteStatus: loadedOnsiteStatus,
                onsiteRemarks: jobOrderData.Onsite_Remarks || jobOrderData.onsite_remarks || '',
                contractLink: jobOrderData.Contract_Link || jobOrderData.contract_link || '',
                contractTemplate: (jobOrderData.Contract_Template || jobOrderData.contract_template || '1').toString(),
                assignedEmail: jobOrderData.Assigned_Email || jobOrderData.assigned_email || 'Office',
                itemName1: jobOrderData.Item_Name_1 || jobOrderData.item_name_1 || '',
                visit_by: jobOrderData.Visit_By || jobOrderData.visit_by || '',
                visit_with: jobOrderData.Visit_With || jobOrderData.visit_with || '',
                visit_with_other: jobOrderData.Visit_With_Other || jobOrderData.visit_with_other || '',
                statusRemarks: jobOrderData.Status_Remarks || jobOrderData.status_remarks || '',
                ip: jobOrderData.IP || jobOrderData.ip || '',
                installationFee: jobOrderData.Installation_Fee || jobOrderData.installation_fee || 0
              }));
            }
          } else {
            loadDefaultFormData();
          }
        } catch (error) {
          console.error('Error fetching application data:', error);
          loadDefaultFormData();
        }
      };

      const loadDefaultFormData = () => {
        setFormData(prev => ({
          ...prev,
          // Only the stored value and the id beside it; the name is filled
          // in by the effect that runs once agents have loaded.
          ...referredByFields(jobOrderData, []),
          dateInstalled: jobOrderData.Date_Installed || jobOrderData.date_installed || getTodayDate(),
          usageType: jobOrderData.Usage_Type || jobOrderData.usage_type || '',
          firstName: jobOrderData.First_Name || jobOrderData.first_name || '',
          middleInitial: jobOrderData.Middle_Initial || jobOrderData.middle_initial || '',
          lastName: jobOrderData.Last_Name || jobOrderData.last_name || '',
          contactNumber: jobOrderData.Mobile_Number || jobOrderData.Contact_Number || jobOrderData.mobile_number || jobOrderData.contact_number || '',
          secondContactNumber: jobOrderData.Secondary_Mobile_Number || jobOrderData.second_contact_number || '',
          email: jobOrderData.Email_Address || jobOrderData.Applicant_Email_Address || jobOrderData.email_address || jobOrderData.email || '',
          address: jobOrderData.Address || jobOrderData.Installation_Address || jobOrderData.address || jobOrderData.installation_address || '',
          barangay: jobOrderData.Barangay || jobOrderData.barangay || '',
          city: jobOrderData.City || jobOrderData.city || '',
          region: jobOrderData.Region || jobOrderData.region || '',
          addressCoordinates: jobOrderData.Address_Coordinates || jobOrderData.address_coordinates || '',
          choosePlan: jobOrderData.Desired_Plan || jobOrderData.desired_plan || jobOrderData.Choose_Plan || jobOrderData.choose_plan || jobOrderData.plan || '',
          status: loadedStatus,
          connectionType: jobOrderData.Connection_Type || jobOrderData.connection_type || '',
          routerModel: jobOrderData.Router_Model || jobOrderData.router_model || '',
          modemSN: jobOrderData.Modem_SN || jobOrderData.modem_sn || '',

          lcpnap: jobOrderData.LCPNAP || jobOrderData.lcpnap || '',
          port: jobOrderData.PORT || jobOrderData.port || '',
          vlan: jobOrderData.VLAN || jobOrderData.vlan || '',
          username: jobOrderData.Username || jobOrderData.username || '',
          onsiteStatus: loadedOnsiteStatus,
          onsiteRemarks: jobOrderData.Onsite_Remarks || jobOrderData.onsite_remarks || '',
          contractLink: jobOrderData.Contract_Link || jobOrderData.contract_link || '',
          contractTemplate: (jobOrderData.Contract_Template || jobOrderData.contract_template || '1').toString(),
          assignedEmail: jobOrderData.Assigned_Email || jobOrderData.assigned_email || 'Office',
          itemName1: jobOrderData.Item_Name_1 || jobOrderData.item_name_1 || '',
          visit_by: jobOrderData.Visit_By || jobOrderData.visit_by || '',
          visit_with: jobOrderData.Visit_With || jobOrderData.visit_with || '',
          visit_with_other: jobOrderData.Visit_With_Other || jobOrderData.visit_with_other || '',
          statusRemarks: jobOrderData.Status_Remarks || jobOrderData.status_remarks || '',
          ip: jobOrderData.IP || jobOrderData.ip || '',
          installationFee: jobOrderData.Installation_Fee || jobOrderData.installation_fee || 0
        }));
      };

      fetchApplicationData();
    }
  }, [jobOrderData, isOpen]);

  const handleInputChange = (field: keyof JobOrderEditFormData, value: string | File | null) => {
    if (field === 'middleInitial' && typeof value === 'string') {
      value = value.replace(/[0-9]/g, '');
    }

    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      if (field === 'lcpnap') {
        newData.port = '';
      }
      if (field === 'region') {
        newData.city = '';
        newData.barangay = '';
      }
      if (field === 'city') {
        newData.barangay = '';
      }
      if (field === 'barangay') {
      }
      return newData;
    });
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleImageUpload = async (field: 'signedContractImage' | 'setupImage' | 'boxReadingImage' | 'routerReadingImage' | 'portLabelImage' | 'clientSignatureImage' | 'speedTestImage', file: File) => {
    try {
      let processedFile = file;
      const originalSize = (file.size / 1024 / 1024).toFixed(2);

      if (activeImageSize && activeImageSize.image_size_value < 100) {
        try {
          console.log(`Resizing ${field} from ${originalSize}MB with ${activeImageSize.image_size_value}% scale...`);
          processedFile = await resizeImage(file, activeImageSize.image_size_value);
          const resizedSize = (processedFile.size / 1024 / 1024).toFixed(2);
          console.log(`Resized ${field}: ${originalSize}MB → ${resizedSize}MB (${activeImageSize.image_size_value}%)`);
        } catch (resizeError) {
          console.error(`Failed to resize ${field}:`, resizeError);
          processedFile = file;
        }
      } else {
        console.log(`Skipping resize for ${field}: no active size or size >= 100% (${activeImageSize?.image_size_value}%)`);
      }

      setFormData(prev => ({ ...prev, [field]: processedFile }));

      if (imagePreviews[field] && imagePreviews[field]?.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviews[field]!);
      }

      const previewUrl = URL.createObjectURL(processedFile);
      setImagePreviews(prev => ({ ...prev, [field]: previewUrl }));

      if (errors[field]) {
        setErrors(prev => ({ ...prev, [field]: '' }));
      }
    } catch (error) {
      console.error(`Error in handleImageUpload for ${field}:`, error);
      setFormData(prev => ({ ...prev, [field]: file }));

      if (imagePreviews[field] && imagePreviews[field]?.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviews[field]!);
      }

      const previewUrl = URL.createObjectURL(file);
      setImagePreviews(prev => ({ ...prev, [field]: previewUrl }));

      if (errors[field]) {
        setErrors(prev => ({ ...prev, [field]: '' }));
      }
    }
  };

  const ImagePreview: React.FC<{
    imageUrl: string | null;
    label: string;
    onUpload: (file: File) => void;
    error?: string;
  }> = ({ imageUrl, label, onUpload, error }) => {
    const [imageLoadError, setImageLoadError] = useState(false);
    const isGDrive = isGoogleDriveUrl(imageUrl);
    const isBlobUrl = imageUrl?.startsWith('blob:');

    return (
      <div>
        <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
          }`}>{label}</label>
        <div className={`relative w-full h-48 border rounded overflow-hidden cursor-pointer ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
          }`}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onUpload(e.target.files[0]);
                setImageLoadError(false);
              }
            }}
            className="absolute inset-0 opacity-0 cursor-pointer z-10"
          />
          {imageUrl ? (
            <div className="relative w-full h-full">
              {isBlobUrl || (!isGDrive && !imageLoadError) ? (
                <img
                  src={imageUrl}
                  alt={label}
                  className="w-full h-full object-contain"
                  onError={() => setImageLoadError(true)}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                  <Camera size={32} />
                  <span className="text-sm mt-2 text-center px-4">Image stored in Google Drive</span>
                  {imageUrl && (
                    <a
                      href={imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-500 text-xs mt-2 hover:underline z-20"
                      onClick={(e) => e.stopPropagation()}
                    >
                      View in Drive
                    </a>
                  )}
                </div>
              )}
              <div className="absolute bottom-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs flex items-center pointer-events-none">
                <Camera className="mr-1" size={14} />Uploaded
              </div>
            </div>
          ) : (
            <div className={`w-full h-full flex flex-col items-center justify-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
              <Camera size={32} />
              <span className="text-sm mt-2">Click to upload</span>
            </div>
          )}
        </div>
        {error && (
          <div className="flex items-center mt-1">
            <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
            <p className="text-orange-500 text-xs">This entry is required</p>
          </div>
        )}
      </div>
    );
  };

  const handleNumberChange = (field: 'installationFee' | 'contractTemplate', increment: boolean) => {
    setFormData(prev => {
      if (field === 'installationFee') {
        const currentVal = Number(prev[field]) || 0;
        return {
          ...prev,
          [field]: increment ? currentVal + 0.01 : Math.max(0, currentVal - 0.01)
        };
      } else {
        const currentValue = parseInt(prev[field]) || 1;
        const newValue = increment ? currentValue + 1 : Math.max(1, currentValue - 1);
        return {
          ...prev,
          [field]: newValue.toString()
        };
      }
    });
  };

  const handleInstallationFeeChange = (value: string) => {
    if (value === '' || value === '-') {
      setFormData(prev => ({ ...prev, installationFee: value }));
    } else {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        setFormData(prev => ({ ...prev, installationFee: value }));
      }
    }
    if (errors.installationFee) {
      setErrors(prev => ({ ...prev, installationFee: '' }));
    }
  };

  const handleItemChange = (index: number, field: 'itemId' | 'quantity', value: string) => {
    const newOrderItems = [...orderItems];
    newOrderItems[index][field] = value;
    setOrderItems(newOrderItems);

    if (field === 'itemId' && value && index === orderItems.length - 1) {
      setOrderItems([...newOrderItems, { itemId: '', quantity: '' }]);
    }
  };

  const handleRemoveItem = (index: number) => {
    if (orderItems.length > 1) {
      const newOrderItems = orderItems.filter((_, i) => i !== index);
      setOrderItems(newOrderItems);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName.trim()) newErrors.firstName = 'First Name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last Name is required';
    if (!formData.contactNumber.trim()) newErrors.contactNumber = 'Contact Number is required';

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.address.trim()) newErrors.address = 'Address is required';
    if (!formData.barangay.trim()) newErrors.barangay = 'Barangay is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.region.trim()) newErrors.region = 'Region is required';
    if (!formData.choosePlan.trim()) newErrors.choosePlan = 'Choose Plan is required';
    if (!formData.status.trim()) newErrors.status = 'Status is required';

    if (!formData.username.trim()) newErrors.username = 'Username is required';

    if (formData.status === 'Confirmed') {
      if (!formData.onsiteStatus.trim()) newErrors.onsiteStatus = 'Onsite Status is required';

      if (formData.onsiteStatus === 'Done') {
        if (!formData.dateInstalled.trim()) newErrors.dateInstalled = 'Date Installed is required';
        if (!formData.usageType.trim()) newErrors.usageType = 'Usage Type is required';
        if (!formData.addressCoordinates.trim()) newErrors.addressCoordinates = 'Address Coordinates is required';
        if (!formData.connectionType.trim()) newErrors.connectionType = 'Connection Type is required';
        if (!formData.routerModel.trim()) newErrors.routerModel = 'Router Model is required';
        if (!formData.modemSN.trim()) newErrors.modemSN = 'Modem SN is required';

        if (formData.connectionType === 'Antenna') {
          if (!formData.ip.trim()) newErrors.ip = 'IP is required';
        } else if (formData.connectionType === 'Fiber') {
          if (!formData.lcpnap.trim()) newErrors.lcpnap = 'LCP-NAP is required';
          if (!formData.port.trim()) newErrors.port = 'PORT is required';
          if (!formData.vlan.trim()) newErrors.vlan = 'VLAN is required';
        } else if (formData.connectionType === 'Local') {
          // Local specific validations if any
        }
        if (!formData.onsiteRemarks.trim()) newErrors.onsiteRemarks = 'Onsite Remarks is required';

        const validItems = orderItems.filter(item => item.itemId && item.quantity);
        if (validItems.length === 0) {
          newErrors.items = 'At least one item with quantity is required';
        } else {
          for (let i = 0; i < validItems.length; i++) {
            if (!validItems[i].itemId) {
              newErrors[`item_${i}`] = 'Item is required';
            }
            if (!validItems[i].quantity || parseInt(validItems[i].quantity) <= 0) {
              newErrors[`quantity_${i}`] = 'Valid quantity is required';
            }
          }
        }


        if (!formData.visit_by.trim()) newErrors.visit_by = 'Visit By is required';
        if (!formData.visit_with.trim()) newErrors.visit_with = 'Visit With is required';
        if (!formData.visit_with_other.trim()) newErrors.visit_with_other = 'Visit With(Other) is required';
      }

      if (formData.onsiteStatus === 'Reschedule') {
        if (!formData.visit_by.trim()) newErrors.visit_by = 'Visit By is required';
        if (!formData.visit_with.trim()) newErrors.visit_with = 'Visit With is required';
        if (!formData.visit_with_other.trim()) newErrors.visit_with_other = 'Visit With(Other) is required';
        if (!formData.onsiteRemarks.trim()) newErrors.onsiteRemarks = 'Onsite Remarks is required';
        if (!formData.statusRemarks.trim()) newErrors.statusRemarks = 'Status Remarks is required';
      }
    }

    if (!formData.contractTemplate.trim()) newErrors.contractTemplate = 'Contract Template is required';
    if (!formData.assignedEmail.trim()) newErrors.assignedEmail = 'Assigned Email is required';

    if (formData.installationFee === '' || formData.installationFee === '-') {
      newErrors.installationFee = 'Installation Fee is required';
    } else if (Number(formData.installationFee) < 0) {
      newErrors.installationFee = 'Installation Fee cannot be negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
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

    if (!jobOrderData?.id && !jobOrderData?.JobOrder_ID) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: 'Cannot update job order: Missing ID'
      });
      return;
    }

    setLoading(true);
    setShowLoadingModal(true);
    setUploadProgress(0);
    setProgressSteps([]);

    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 99) return 99;
        if (prev >= 90) return prev + 1;
        if (prev >= 70) return prev + 2;
        return prev + 5;
      });
    }, 300);

    try {
      setProgressSteps(['Preparing data...']);

      const jobOrderId = jobOrderData.id || jobOrderData.JobOrder_ID;
      const applicationId = jobOrderData.Application_ID || jobOrderData.application_id;

      const jobOrderUpdateData: any = {
        Referred_By: referredByForSave(
          { label: updatedFormData.referredBy, agentId: updatedFormData.referredById },
          agents
        ),
        First_Name: updatedFormData.firstName,
        Middle_Initial: updatedFormData.middleInitial,
        Last_Name: updatedFormData.lastName,
        Contact_Number: updatedFormData.contactNumber,
        Secondary_Mobile_Number: updatedFormData.secondContactNumber,
        Email_Address: updatedFormData.email,
        Address: updatedFormData.address,
        Barangay: updatedFormData.barangay,
        City: updatedFormData.city,
        Region: updatedFormData.region,
        Choose_Plan: updatedFormData.choosePlan,
        Status: updatedFormData.status,
        Group: updatedFormData.groupName,
        Username: updatedFormData.username,
        Onsite_Status: updatedFormData.onsiteStatus,
        Modified_By: updatedFormData.modifiedBy,
        Modified_Date: updatedFormData.modifiedDate,
        Contract_Link: updatedFormData.contractLink,
        Contract_Template: updatedFormData.contractTemplate,
        Assigned_Email: updatedFormData.assignedEmail,
        Installation_Fee: Number(updatedFormData.installationFee) || 0
      };

      if (updatedFormData.status === 'Confirmed') {
        if (updatedFormData.onsiteStatus === 'Done') {
          jobOrderUpdateData.Date_Installed = updatedFormData.dateInstalled;
          jobOrderUpdateData.Usage_Type = updatedFormData.usageType;
          jobOrderUpdateData.Address_Coordinates = updatedFormData.addressCoordinates;
          jobOrderUpdateData.Connection_Type = updatedFormData.connectionType;
          jobOrderUpdateData.Router_Model = updatedFormData.routerModel;
          jobOrderUpdateData.Modem_SN = updatedFormData.modemSN;
          jobOrderUpdateData.IP = updatedFormData.ip;
          jobOrderUpdateData.LCPNAP = updatedFormData.lcpnap;
          jobOrderUpdateData.PORT = updatedFormData.port;
          jobOrderUpdateData.VLAN = updatedFormData.vlan;
          jobOrderUpdateData.Onsite_Remarks = updatedFormData.onsiteRemarks;
          jobOrderUpdateData.Item_Name_1 = updatedFormData.itemName1;
          jobOrderUpdateData.Visit_By = updatedFormData.visit_by;
          jobOrderUpdateData.Visit_With = updatedFormData.visit_with;
          jobOrderUpdateData.Visit_With_Other = updatedFormData.visit_with_other;
        }

        if (updatedFormData.onsiteStatus === 'Reschedule') {
          jobOrderUpdateData.Visit_By = updatedFormData.visit_by;
          jobOrderUpdateData.Visit_With = updatedFormData.visit_with;
          jobOrderUpdateData.Visit_With_Other = updatedFormData.visit_with_other;
          jobOrderUpdateData.Onsite_Remarks = updatedFormData.onsiteRemarks;
          jobOrderUpdateData.Status_Remarks = updatedFormData.statusRemarks;
        }
      }

      setProgressSteps(prev => [...prev, 'Updating job order...']);

      const jobOrderResponse = await updateJobOrder(jobOrderId, jobOrderUpdateData);

      if (!jobOrderResponse.success) {
        throw new Error(jobOrderResponse.message || 'Job order update failed');
      }

      if (updatedFormData.status === 'Confirmed' && updatedFormData.onsiteStatus === 'Done') {
        const validItems = orderItems.filter(item => {
          const quantity = parseInt(item.quantity);
          return item.itemId && item.itemId.trim() !== '' && !isNaN(quantity) && quantity > 0;
        });

        if (validItems.length > 0) {
          try {
            const existingItemsResponse = await apiClient.get<{ success: boolean; data: any[] }>(`/job-order-items?job_order_id=${jobOrderId}`);

            if (existingItemsResponse.data.success && existingItemsResponse.data.data.length > 0) {
              const existingItems = existingItemsResponse.data.data;

              for (const item of existingItems) {
                try {
                  await apiClient.delete(`/job-order-items/${item.id}`);
                } catch (deleteErr) {
                  console.warn('Failed to delete item ID:', item.id);
                }
              }
            }
          } catch (deleteError: any) {
            console.error('Error deleting existing items:', deleteError);
          }

          setProgressSteps(prev => [...prev, 'Saving items...']);

          const jobOrderItems: JobOrderItem[] = validItems.map(item => {
            return {
              job_order_id: parseInt(jobOrderId.toString()),
              item_name: item.itemId,
              quantity: parseInt(item.quantity)
            };
          });

          try {
            const itemsResponse = await createJobOrderItems(jobOrderItems);

            if (!itemsResponse.success) {
              throw new Error(itemsResponse.message || 'Failed to create job order items');
            }
          } catch (itemsError: any) {
            console.error('Error creating job order items:', itemsError);
            const errorMsg = itemsError.response?.data?.message || itemsError.message || 'Unknown error';
            setModal({
              isOpen: true,
              type: 'error',
              title: 'Error',
              message: `Job order saved but items were not saved: ${errorMsg}`
            });
            setLoading(false);
            setShowLoadingModal(false);
            return;
          }
        }
      }

      if (applicationId) {
        setProgressSteps(prev => [...prev, 'Updating application...']);

        const applicationUpdateData: any = {
          first_name: updatedFormData.firstName,
          middle_initial: updatedFormData.middleInitial,
          last_name: updatedFormData.lastName,
          mobile_number: updatedFormData.contactNumber,
          secondary_mobile_number: updatedFormData.secondContactNumber,
          email_address: updatedFormData.email,
          installation_address: updatedFormData.address,
          barangay: updatedFormData.barangay,
          city: updatedFormData.city,
          region: updatedFormData.region,
          desired_plan: updatedFormData.choosePlan,
          referred_by: referredByForSave(
            { label: updatedFormData.referredBy, agentId: updatedFormData.referredById },
            agents
          ),
          status: updatedFormData.status
        };

        await updateApplication(applicationId, applicationUpdateData);
      }

      clearInterval(progressInterval);
      setUploadProgress(100);
      setProgressSteps(prev => [...prev, 'Complete!']);
      await new Promise(resolve => setTimeout(resolve, 500));

      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'Job Order and Application updated successfully!',
        onConfirm: () => {
          setErrors({});
          onSave(updatedFormData);
          onClose();
          setModal({ ...modal, isOpen: false });
        }
      });
    } catch (error: any) {
      clearInterval(progressInterval);
      console.error('Error updating records:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error occurred';
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Failed to Update',
        message: `Failed to update records: ${errorMessage}`
      });
    } finally {
      setLoading(false);
      setShowLoadingModal(false);
    }
  };

  if (!isOpen) return null;

  const getFilteredCities = () => {
    if (!formData.region) return [];
    const selectedRegion = regions.find(reg => reg.name === formData.region);
    if (!selectedRegion) return [];
    return allCities.filter(city => city.region_id === selectedRegion.id);
  };

  const getFilteredBarangays = () => {
    if (!formData.city) return [];
    const selectedCity = allCities.find(city => city.name === formData.city);
    if (!selectedCity) return [];
    return allBarangays.filter(brgy => brgy.city_id === selectedCity.id);
  };

  const filteredCities = getFilteredCities();
  const filteredBarangays = getFilteredBarangays();

  return (
    <>
      {showLoadingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[70]">
          <div className="bg-gray-800 rounded-lg shadow-xl p-8 max-w-md w-full mx-4">
            <div className="flex flex-col items-center space-y-6">
              <div className="relative">
                <div className="animate-spin rounded-full h-24 w-24 border-t-4 border-b-4 border-orange-500"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold text-white">{uploadProgress}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
            }`}>
            <div className="flex items-center space-x-3">

              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                {formData.firstName} {formData.middleInitial} {formData.lastName}
              </h2>
            </div>
            <div className="flex items-center space-x-3">
              <button onClick={onClose} className={`px-4 py-2 border rounded text-sm transition-colors ${isDarkMode
                ? 'border-orange-600 text-orange-600 hover:bg-orange-600 hover:text-white'
                : 'border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white'
                }`}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={loading} className={`px-4 py-2 rounded text-sm transition-colors ${isDarkMode ? 'bg-orange-600 hover:bg-orange-700' : 'bg-orange-500 hover:bg-orange-600'
                } disabled:opacity-50 text-white`}>
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Referred By</label>
              <div className="relative">
                <div className={`flex items-center px-3 py-2 border rounded transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                  } ${isReferredByOpen ? 'border-orange-500' : ''}`}>
                  <Search size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                  <input
                    type="text"
                    placeholder="Search Agent..."
                    value={isReferredByOpen ? referredBySearch : (formData.referredBy || '')}
                    onChange={(e) => {
                      setReferredBySearch(e.target.value);
                      setIsReferredByOpen(true);
                      if (!isReferredByOpen) {
                        handleInputChange('referredBy', e.target.value);
                      }
                    }}
                    onFocus={() => {
                      setIsReferredByOpen(true);
                      setReferredBySearch(formData.referredBy || '');
                    }}
                    className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                  />
                  {(formData.referredBy || referredBySearch) && (
                    <button
                      type="button"
                      onClick={() => {
                        handleInputChange('referredBy', '');
                        setReferredBySearch('');
                        setIsReferredByOpen(false);
                      }}
                      className={`ml-2 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}
                    >
                      <X size={14} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsReferredByOpen(!isReferredByOpen)}
                    className={`ml-2 transition-transform duration-200 ${isReferredByOpen ? 'rotate-180' : ''}`}
                  >
                    <ChevronDown size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                  </button>
                </div>

                {isReferredByOpen && (
                  <div className={`absolute left-0 right-0 top-full mt-1 z-[100] rounded-md shadow-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                    }`}>
                    <div className="max-h-60 overflow-y-auto custom-scrollbar">
                      {agents
                        .filter(agent => {
                          const fullName = `${agent.first_name || ''} ${agent.middle_initial || ''} ${agent.last_name || ''}`.toLowerCase();
                          const searchLower = referredBySearch.toLowerCase();
                          return fullName.includes(searchLower) ||
                            (agent.username || '').toLowerCase().includes(searchLower) ||
                            (agent.email_address || '').toLowerCase().includes(searchLower);
                        })
                        .map((agent) => {
                          const fullName = `${agent.first_name || ''} ${agent.middle_initial || ''} ${agent.last_name || ''}`.replace(/\s+/g, ' ').trim();
                          return (
                            <div
                              key={agent.id}
                              className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'} ${formData.referredBy === fullName ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                              onClick={() => {
                                // The id comes off the row that was clicked, not
                                // from the name — two agents can share a name.
                                setFormData(prev => ({
                                  ...prev,
                                  referredBy: fullName,
                                  referredById: Number(agent.id) || null,
                                }));
                                setIsReferredByOpen(false);
                                setReferredBySearch('');
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                  <span className="font-medium">{fullName}</span>
                                  <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{agent.username} • {agent.email_address}</span>
                                </div>
                                {formData.referredBy === fullName && (
                                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      {agents.filter(agent => {
                        const fullName = `${agent.first_name || ''} ${agent.middle_initial || ''} ${agent.last_name || ''}`.toLowerCase();
                        const searchLower = referredBySearch.toLowerCase();
                        return fullName.includes(searchLower) ||
                          (agent.username || '').toLowerCase().includes(searchLower) ||
                          (agent.email_address || '').toLowerCase().includes(searchLower);
                      }).length === 0 && (
                          <div className={`px-4 py-8 text-center text-sm italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            No Agent found for "{referredBySearch}"
                          </div>
                        )}
                    </div>
                  </div>
                )}

                {isReferredByOpen && (
                  <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => {
                      setIsReferredByOpen(false);
                      setReferredBySearch('');
                    }}
                  />
                )}
              </div>
            </div>

            {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Date Installed<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <input type="date" value={formData.dateInstalled} onChange={(e) => handleInputChange('dateInstalled', e.target.value)} className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.dateInstalled ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`} />
                    <Calendar className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.dateInstalled && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Usage Type<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select value={formData.usageType} onChange={(e) => handleInputChange('usageType', e.target.value)} className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${errors.usageType ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}>
                      <option value=""></option>
                      {formData.usageType && !usageTypes.some(ut => ut.usage_name === formData.usageType) && (
                        <option value={formData.usageType}>{formData.usageType}</option>
                      )}
                      {usageTypes.map((usageType) => (
                        <option key={usageType.id} value={usageType.usage_name}>
                          {usageType.usage_name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.usageType && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>
              </>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>First Name<span className="text-red-500">*</span></label>
              <input type="text" value={formData.firstName} onChange={(e) => handleInputChange('firstName', e.target.value)} className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.firstName ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`} />
              {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Middle Initial</label>
              <input
                type="text"
                value={formData.middleInitial}
                onChange={(e) => handleInputChange('middleInitial', e.target.value)}
                onKeyDown={(e) => {
                  if (/[0-9]/.test(e.key)) {
                    e.preventDefault();
                  }
                }}
                maxLength={1}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                  }`} />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Last Name<span className="text-red-500">*</span></label>
              <input type="text" value={formData.lastName} onChange={(e) => handleInputChange('lastName', e.target.value)} className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.lastName ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`} />
              {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Contact Number<span className="text-red-500">*</span></label>
              <input type="text" value={formData.contactNumber} onChange={(e) => handleInputChange('contactNumber', e.target.value)} className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.contactNumber ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`} />
              {errors.contactNumber && <p className="text-red-500 text-xs mt-1">{errors.contactNumber}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Second Contact Number</label>
              <input type="text" value={formData.secondContactNumber} onChange={(e) => handleInputChange('secondContactNumber', e.target.value)} className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                }`} />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Applicant Email Address<span className="text-red-500">*</span></label>
              <input type="email" value={formData.email} onChange={(e) => handleInputChange('email', e.target.value)} className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.email ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`} />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Address<span className="text-red-500">*</span></label>
              <input type="text" value={formData.address} onChange={(e) => handleInputChange('address', e.target.value)} className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.address ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`} />
              {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Region<span className="text-red-500">*</span></label>
              <div className="relative">
                <select value={formData.region} onChange={(e) => handleInputChange('region', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none ${errors.region ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}>
                  <option value="">Select Region</option>
                  {formData.region && !regions.some(reg => reg.name === formData.region) && (
                    <option value={formData.region}>{formData.region}</option>
                  )}
                  {regions.map((region) => (
                    <option key={region.id} value={region.name}>
                      {region.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
              {errors.region && <p className="text-red-500 text-xs mt-1">{errors.region}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>City<span className="text-red-500">*</span></label>
              <div className="relative">
                <select
                  value={formData.city}
                  onChange={(e) => handleInputChange('city', e.target.value)}
                  disabled={!formData.region}
                  className={`w-full px-3 py-2 border rounded appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${errors.city ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}
                >
                  <option value="">{formData.region ? 'Select City' : 'Select Region First'}</option>
                  {formData.city && !filteredCities.some(city => city.name === formData.city) && (
                    <option value={formData.city}>{formData.city}</option>
                  )}
                  {filteredCities.map((city) => (
                    <option key={city.id} value={city.name}>
                      {city.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
              {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Barangay<span className="text-red-500">*</span></label>
              <div className="relative">
                <select
                  value={formData.barangay}
                  onChange={(e) => handleInputChange('barangay', e.target.value)}
                  disabled={!formData.city}
                  className={`w-full px-3 py-2 border rounded appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${errors.barangay ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}
                >
                  <option value="">{formData.city ? 'Select Barangay' : 'Select City First'}</option>
                  {formData.barangay && !filteredBarangays.some(brgy => brgy.barangay === formData.barangay) && (
                    <option value={formData.barangay}>{formData.barangay}</option>
                  )}
                  {filteredBarangays.map((barangay) => (
                    <option key={barangay.id} value={barangay.barangay}>
                      {barangay.barangay}
                    </option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
              {errors.barangay && <p className="text-red-500 text-xs mt-1">{errors.barangay}</p>}
            </div>


            {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>Address Coordinates<span className="text-red-500">*</span></label>
                <div className="relative">
                  <input type="text" value={formData.addressCoordinates} onChange={(e) => handleInputChange('addressCoordinates', e.target.value)} placeholder="14.466580, 121.201807" className={`w-full px-3 py-2 border rounded pr-10 ${errors.addressCoordinates ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`} />
                  <MapPin className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`} size={20} />
                </div>
                {errors.addressCoordinates && (
                  <div className="flex items-center mt-1">
                    <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                    <p className="text-orange-500 text-xs">This entry is required</p>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Choose Plan<span className="text-red-500">*</span></label>
              <div className="relative">
                <select value={formData.choosePlan} onChange={(e) => handleInputChange('choosePlan', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none ${errors.choosePlan ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}>
                  <option value="">Select Plan</option>
                  {formData.choosePlan && !plans.some(plan => {
                    const planWithPrice = plan.price ? `${plan.name} - P${plan.price}` : plan.name;
                    return planWithPrice === formData.choosePlan || plan.name === formData.choosePlan;
                  }) && (
                      <option value={formData.choosePlan}>{formData.choosePlan}</option>
                    )}
                  {plans.map((plan) => {
                    const planWithPrice = plan.price ? `${plan.name} - P${plan.price}` : plan.name;
                    return (
                      <option key={plan.id} value={planWithPrice}>
                        {planWithPrice}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
              {errors.choosePlan && <p className="text-red-500 text-xs mt-1">{errors.choosePlan}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Status<span className="text-red-500">*</span></label>
              <div className="relative">
                <select value={formData.status} onChange={(e) => handleInputChange('status', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none ${errors.status ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}>
                  <option value="Confirmed">Confirmed</option>
                  <option value="For Confirmation">For Confirmation</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
              {errors.status && <p className="text-red-500 text-xs mt-1">{errors.status}</p>}
            </div>

            {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Connection Type<span className="text-red-500">*</span></label>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => handleInputChange('connectionType', 'Antenna')} className={`py-2 px-4 rounded border transition-colors duration-200 ${formData.connectionType === 'Antenna'
                      ? 'bg-orange-600 border-orange-700 text-white'
                      : isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-200 border-gray-300 text-gray-900'
                      }`}>Antenna</button>
                    <button type="button" onClick={() => handleInputChange('connectionType', 'Fiber')} className={`py-2 px-4 rounded border transition-colors duration-200 ${formData.connectionType === 'Fiber'
                      ? 'bg-orange-600 border-orange-700 text-white'
                      : isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-200 border-gray-300 text-gray-900'
                      }`}>Fiber</button>
                    <button type="button" onClick={() => handleInputChange('connectionType', 'Local')} className={`py-2 px-4 rounded border transition-colors duration-200 ${formData.connectionType === 'Local'
                      ? 'bg-orange-600 border-orange-700 text-white'
                      : isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-200 border-gray-300 text-gray-900'
                      }`}>Local</button>
                  </div>
                  {errors.connectionType && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Router Model<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select value={formData.routerModel} onChange={(e) => handleInputChange('routerModel', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none ${errors.routerModel ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}>
                      <option value=""></option>
                      {formData.routerModel && !routerModels.some(rm => rm.model === formData.routerModel) && (
                        <option value={formData.routerModel}>{formData.routerModel}</option>
                      )}
                      {routerModels.map((routerModel, index) => (
                        <option key={index} value={routerModel.model}>{routerModel.model}</option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.routerModel && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Modem SN<span className="text-red-500">*</span></label>
                  <input type="text" value={formData.modemSN} onChange={(e) => handleInputChange('modemSN', e.target.value)} className={`w-full px-3 py-2 border rounded ${errors.modemSN ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`} />
                  {errors.modemSN && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>

                {formData.connectionType === 'Antenna' && (
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                      }`}>IP<span className="text-red-500">*</span></label>
                    <input type="text" value={formData.ip} onChange={(e) => handleInputChange('ip', e.target.value)} className={`w-full px-3 py-2 border rounded ${errors.ip ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`} />
                    {errors.ip && (
                      <div className="flex items-center mt-1">
                        <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                        <p className="text-orange-500 text-xs">This entry is required</p>
                      </div>
                    )}
                  </div>
                )}

                {(formData.connectionType === 'Antenna' || formData.connectionType === 'Local') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Port Label Image<span className="text-red-500">*</span></label>
                    <div className="relative w-full h-32 bg-gray-800 border border-gray-700 rounded flex items-center justify-center cursor-pointer hover:bg-gray-750">
                      <input type="file" accept="image/*" onChange={(e) => e.target.files && handleImageUpload('portLabelImage', e.target.files[0])} className="absolute inset-0 opacity-0 cursor-pointer" />
                      {formData.portLabelImage ? (
                        <div className="text-green-500 flex items-center"><Camera className="mr-2" size={20} />Image uploaded</div>
                      ) : (
                        <div className="text-gray-400 flex flex-col items-center"><Camera size={32} /><span className="text-sm mt-2">Click to upload</span></div>
                      )}
                    </div>
                    {errors.portLabelImage && (
                      <div className="flex items-center mt-1">
                        <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                        <p className="text-orange-500 text-xs">This entry is required</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}



            {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && formData.connectionType === 'Fiber' && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>LCP-NAP<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <div className={`flex items-center px-3 py-2 border rounded transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                      } ${errors.lcpnap ? 'border-red-500' : 'focus-within:border-orange-500'}`}>
                      <Search size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                      <input
                        type="text"
                        placeholder="Type to search LCP-NAP..."
                        value={formData.lcpnap}
                        onChange={(e) => {
                          handleInputChange('lcpnap', e.target.value);
                          setIsLcpnapOpen(true);
                        }}
                        onFocus={() => setIsLcpnapOpen(true)}
                        className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                      />
                      <button
                        type="button"
                        onClick={() => setIsLcpnapOpen(!isLcpnapOpen)}
                        className={`ml-2 transition-transform duration-200 ${isLcpnapOpen ? 'rotate-180' : ''}`}
                      >
                        <ChevronDown size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                      </button>
                    </div>

                    {/* Recommendation Dropdown */}
                    {isLcpnapOpen && (
                      <div
                        className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-md shadow-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                          }`}
                        style={{ minWidth: '100%' }}
                      >
                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                          {lcpnaps
                            .filter(ln => ln.lcpnap_name.toLowerCase().includes((formData.lcpnap || '').toLowerCase()))
                            .map((lcpnap) => (
                              <div
                                key={lcpnap.id}
                                className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${isDarkMode
                                  ? 'hover:bg-gray-700 text-gray-200'
                                  : 'hover:bg-gray-100 text-gray-700'
                                  } ${formData.lcpnap === lcpnap.lcpnap_name ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                                onClick={() => {
                                  handleInputChange('lcpnap', lcpnap.lcpnap_name);
                                  setIsLcpnapOpen(false);
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <span>{lcpnap.lcpnap_name}</span>
                                  {formData.lcpnap === lcpnap.lcpnap_name && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
                                  )}
                                </div>
                              </div>
                            ))}
                          {lcpnaps.filter(ln => ln.lcpnap_name.toLowerCase().includes((formData.lcpnap || '').toLowerCase())).length === 0 && (
                            <div className={`px-4 py-8 text-center text-sm italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                              No recommendations for "{formData.lcpnap}"
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Click outside to close */}
                    {isLcpnapOpen && (
                      <div
                        className="fixed inset-0 z-40 bg-transparent"
                        onClick={() => {
                          setIsLcpnapOpen(false);
                        }}
                      />
                    )}
                  </div>
                  {errors.lcpnap && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>PORT<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select value={formData.port} onChange={(e) => handleInputChange('port', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none ${errors.port ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}>
                      <option value="">Select PORT</option>
                      {Array.from({ length: totalPorts }, (_, i) => {
                        const portName = `PORT ${String(i + 1).padStart(3, '0')}`;
                        const isUsed = usedPorts.includes(portName);
                        const isSelected = formData.port === portName;

                        // Only show if not used, OR if it's the currently selected one (in case editing)
                        if (isUsed && !isSelected) return null;

                        return (
                          <option key={portName} value={portName}>
                            {portName}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.port && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>VLAN<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select value={formData.vlan} onChange={(e) => handleInputChange('vlan', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none ${errors.vlan ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}>
                      <option value="">Select VLAN</option>
                      {formData.vlan && !vlans.some(v => v.value.toString() === formData.vlan) && (
                        <option value={formData.vlan}>{formData.vlan}</option>
                      )}
                      {vlans.map((vlan) => (
                        <option key={vlan.id} value={vlan.value}>
                          {vlan.value}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.vlan && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>
              </>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Username<span className="text-red-500">*</span></label>
              <input type="text" value={formData.username} onChange={(e) => handleInputChange('username', e.target.value)} className={`w-full px-3 py-2 border rounded ${errors.username ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`} />
              {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
            </div>

            {formData.status === 'Confirmed' && (formData.onsiteStatus === 'Done' || formData.onsiteStatus === 'Reschedule') && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Visit By<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select value={formData.visit_by} onChange={(e) => handleInputChange('visit_by', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none focus:outline-none focus:border-orange-500 ${errors.visit_by ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}>
                      <option value="">Select Visit By</option>
                      {formData.visit_by && !technicians.some(t => t.name === formData.visit_by) && (
                        <option value={formData.visit_by}>{formData.visit_by}</option>
                      )}
                      {technicians.filter(t => t.name !== formData.visit_with && t.name !== formData.visit_with_other).map((technician, index) => (
                        <option key={index} value={technician.name}>{technician.name}</option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.visit_by && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Visit With<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select value={formData.visit_with} onChange={(e) => handleInputChange('visit_with', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none focus:outline-none focus:border-orange-500 ${errors.visit_with ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}>
                      <option value="">Select Visit With</option>
                      <option value="None">None</option>
                      {formData.visit_with && !technicians.some(t => t.name === formData.visit_with) && formData.visit_with !== 'None' && (
                        <option value={formData.visit_with}>{formData.visit_with}</option>
                      )}
                      {technicians.filter(t => t.name !== formData.visit_by && t.name !== formData.visit_with_other).map((technician, index) => (
                        <option key={index} value={technician.name}>{technician.name}</option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.visit_with && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Visit With(Other)<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select value={formData.visit_with_other} onChange={(e) => handleInputChange('visit_with_other', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none focus:outline-none focus:border-orange-500 ${errors.visit_with_other ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}>
                      <option value="">Select Visit With(Other)</option>
                      <option value="None">None</option>
                      {formData.visit_with_other && !technicians.some(t => t.name === formData.visit_with_other) && formData.visit_with_other !== 'None' && (
                        <option value={formData.visit_with_other}>{formData.visit_with_other}</option>
                      )}
                      {technicians.filter(t => t.name !== formData.visit_by && t.name !== formData.visit_with).map((technician, index) => (
                        <option key={index} value={technician.name}>{technician.name}</option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.visit_with_other && (
                    <div className="flex items-center mt-1">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                      <p className="text-orange-500 text-xs">This entry is required</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {formData.status === 'Confirmed' && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>Onsite Status<span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select value={formData.onsiteStatus} onChange={(e) => handleInputChange('onsiteStatus', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none focus:outline-none focus:border-orange-500 ${errors.onsiteStatus ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}>
                      <option value="In Progress">In Progress</option>
                      <option value="Done">Done</option>
                      <option value="Failed">Failed</option>
                      <option value="Reschedule">Reschedule</option>
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                  {errors.onsiteStatus && <p className="text-red-500 text-xs mt-1">{errors.onsiteStatus}</p>}
                </div>

                {(formData.onsiteStatus === 'Reschedule' || formData.onsiteStatus === 'Done') && (
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                      }`}>Onsite Remarks<span className="text-red-500">*</span></label>
                    <textarea value={formData.onsiteRemarks} onChange={(e) => handleInputChange('onsiteRemarks', e.target.value)} rows={3} className={`w-full px-3 py-2 border rounded resize-none focus:outline-none focus:border-orange-500 ${errors.onsiteRemarks ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`} />
                    {errors.onsiteRemarks && (
                      <div className="flex items-center mt-1">
                        <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                        <p className="text-orange-500 text-xs">This entry is required</p>
                      </div>
                    )}
                  </div>
                )}

                {formData.onsiteStatus === 'Done' && (
                  <>
                    <ImagePreview
                      imageUrl={imagePreviews.signedContractImage}
                      label="Signed Contract Image"
                      onUpload={(file) => handleImageUpload('signedContractImage', file)}
                      error={errors.signedContractImage}
                    />

                    <ImagePreview
                      imageUrl={imagePreviews.setupImage}
                      label="Setup Image"
                      onUpload={(file) => handleImageUpload('setupImage', file)}
                      error={errors.setupImage}
                    />

                    <ImagePreview
                      imageUrl={imagePreviews.boxReadingImage}
                      label="Box Reading Image"
                      onUpload={(file) => handleImageUpload('boxReadingImage', file)}
                      error={errors.boxReadingImage}
                    />

                    <ImagePreview
                      imageUrl={imagePreviews.routerReadingImage}
                      label="Router Reading Image"
                      onUpload={(file) => handleImageUpload('routerReadingImage', file)}
                      error={errors.routerReadingImage}
                    />

                    <ImagePreview
                      imageUrl={imagePreviews.clientSignatureImage}
                      label="Client Signature Image"
                      onUpload={(file) => handleImageUpload('clientSignatureImage', file)}
                      error={errors.clientSignatureImage}
                    />

                    <ImagePreview
                      imageUrl={imagePreviews.speedTestImage}
                      label="Speed Test Image"
                      onUpload={(file) => handleImageUpload('speedTestImage', file)}
                      error={errors.speedTestImage}
                    />
                  </>
                )}
              </>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Installation Fee<span className="text-red-500">*</span>
              </label>
              <div className={`flex items-center border rounded ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                }`}>
                <span className={`px-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>₱</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.installationFee}
                  onChange={(e) => handleInstallationFeeChange(e.target.value)}
                  className={`flex-1 px-3 py-2 bg-transparent focus:outline-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${isDarkMode ? 'text-white' : 'text-gray-900'
                    } ${errors.installationFee ? 'border-red-500' : ''}`}
                  placeholder="0.00"
                />
              </div>
              {errors.installationFee && <p className="text-red-500 text-xs mt-1">{errors.installationFee}</p>}
            </div>

            <div className="pt-4 border-t border-gray-700">
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Modified By<span className="text-red-500">*</span></label>
              <input type="email" value={formData.modifiedBy} readOnly className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-700 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-200 text-gray-500'
                }`} />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Modified Date<span className="text-red-500">*</span></label>
              <div className="relative">
                <input type="text" value={formData.modifiedDate} readOnly className={`w-full px-3 py-2 border rounded cursor-not-allowed pr-10 ${isDarkMode ? 'bg-gray-700 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-200 text-gray-500'
                  }`} />
                <Calendar className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Contract Link</label>
              <input type="text" value={formData.contractLink} onChange={(e) => handleInputChange('contractLink', e.target.value)} className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                }`} />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Contract Template<span className="text-red-500">*</span></label>
              <div className={`flex items-center border rounded ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                }`}>
                <input type="number" value={formData.contractTemplate} onChange={(e) => handleInputChange('contractTemplate', e.target.value)} className={`flex-1 px-3 py-2 bg-transparent focus:outline-none ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`} />
                <div className="flex">
                  <button type="button" onClick={() => handleNumberChange('contractTemplate', false)} className={`px-3 py-2 border-l transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'
                    }`}><Minus size={16} /></button>
                  <button type="button" onClick={() => handleNumberChange('contractTemplate', true)} className={`px-3 py-2 border-l transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'
                    }`}><Plus size={16} /></button>
                </div>
              </div>
              {errors.contractTemplate && <p className="text-red-500 text-xs mt-1">{errors.contractTemplate}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Assigned Email<span className="text-red-500">*</span></label>
              <div className="relative">
                <select value={formData.assignedEmail} onChange={(e) => handleInputChange('assignedEmail', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none focus:outline-none focus:border-orange-500 ${errors.assignedEmail ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}>
                  <option value="">Select Assigned Email</option>
                  {formData.assignedEmail && !technicians.some(t => t.email === formData.assignedEmail) && (
                    <option value={formData.assignedEmail}>{formData.assignedEmail}</option>
                  )}
                  {technicians.map((technician, index) => (
                    <option key={index} value={technician.email}>{technician.email}</option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
              {errors.assignedEmail && <p className="text-red-500 text-xs mt-1">{errors.assignedEmail}</p>}
            </div>

            {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>Items<span className="text-red-500">*</span></label>
                {orderItems.map((item, index) => (
                  <div key={index} className="mb-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <div className="relative">
                          <select
                            value={item.itemId}
                            onChange={(e) => handleItemChange(index, 'itemId', e.target.value)}
                            className={`w-full px-3 py-2 border rounded appearance-none focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                              }`}
                          >
                            <option value="">Select Item {index + 1}</option>
                            {inventoryItems.map((invItem) => (
                              <option key={invItem.id} value={invItem.item_name}>
                                {invItem.item_name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                            }`} size={20} />
                        </div>
                        {errors[`item_${index}`] && (
                          <p className="text-orange-500 text-xs mt-1">{errors[`item_${index}`]}</p>
                        )}
                      </div>

                      {item.itemId && (
                        <div className="w-32">
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                            placeholder="Qty"
                            min="1"
                            className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                              }`}
                          />
                          {errors[`quantity_${index}`] && (
                            <p className="text-orange-500 text-xs mt-1">{errors[`quantity_${index}`]}</p>
                          )}
                        </div>
                      )}

                      {orderItems.length > 1 && item.itemId && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(index)}
                          className="p-2 text-red-500 hover:text-red-400 transition-colors"
                        >
                          <X size={20} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {errors.items && (
                  <div className="flex items-center mt-1">
                    <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                    <p className="text-orange-500 text-xs">{errors.items}</p>
                  </div>
                )}
              </div>
            )}

            {formData.status === 'Confirmed' && formData.onsiteStatus === 'Reschedule' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>Status Remarks<span className="text-red-500">*</span></label>
                <div className="relative">
                  <select value={formData.statusRemarks} onChange={(e) => handleInputChange('statusRemarks', e.target.value)} className={`w-full px-3 py-2 border rounded appearance-none focus:outline-none focus:border-orange-500 ${errors.statusRemarks ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}>
                    <option value="">Select Status Remarks</option>
                    {formData.statusRemarks && !statusRemarksList.some(sr => sr.status_remarks === formData.statusRemarks) && (
                      <option value={formData.statusRemarks}>{formData.statusRemarks}</option>
                    )}
                    {statusRemarksList.map((statusRemark) => (
                      <option key={statusRemark.id} value={statusRemark.status_remarks}>
                        {statusRemark.status_remarks}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`} size={20} />
                </div>
                {errors.statusRemarks && (
                  <div className="flex items-center mt-1">
                    <div className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-xs mr-2">!</div>
                    <p className="text-orange-500 text-xs">This entry is required</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {modal.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
            <div className={`border rounded-lg p-6 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
              }`}>
              <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>{modal.title}</h3>
              <p className={`mb-6 whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>{modal.message}</p>
              <div className="flex items-center justify-end gap-3">
                {modal.type === 'confirm' ? (
                  <>
                    <button
                      onClick={modal.onCancel}
                      className={`px-4 py-2 rounded text-white transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                        }`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={modal.onConfirm}
                      className={`px-4 py-2 rounded text-white transition-colors ${isDarkMode ? 'bg-orange-600 hover:bg-orange-700' : 'bg-orange-500 hover:bg-orange-600'
                        }`}
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
                    className={`px-4 py-2 rounded text-white transition-colors ${isDarkMode ? 'bg-orange-600 hover:bg-orange-700' : 'bg-orange-500 hover:bg-orange-600'
                      }`}
                  >
                    OK
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default JobOrderEditFormModal;
