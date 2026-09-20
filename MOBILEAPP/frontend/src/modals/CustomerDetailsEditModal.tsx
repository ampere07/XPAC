import React, { useState, useEffect } from 'react';
import { X, ChevronDown, Calendar, Camera, Search } from 'lucide-react';
import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import { locationDetailService, LocationDetail } from '../services/locationDetailService';
import { planService, Plan } from '../services/planService';
import { routerModelService, RouterModel } from '../services/routerModelService';

import { getAllLCPNAPs, LCPNAP } from '../services/lcpnapService';
import { getAllVLANs, VLAN } from '../services/vlanService';
import { getAllUsageTypes, UsageType } from '../services/usageTypeService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import { billingStatusService, BillingStatus } from '../services/billingStatusService';
import { getUsedPorts } from '../services/portService';
import { getAllInventoryItems, InventoryItem } from '../services/inventoryItemService';
import apiClient from '../config/api';
import SearchableField, { GroupedOption } from '../components/common/SearchableField';
import { agentService } from '../services/agentService';
import {
  buildAgentGroups,
  referredByFields,
  referredByForSave,
  selectionFromOption,
} from '../utils/referredByField';
import { userService } from '../services/userService';

interface CustomerDetailsEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: any, type: 'customer_details' | 'billing_details' | 'technical_details') => void;
  recordData?: any;
  editType: 'customer_details' | 'billing_details' | 'technical_details';
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const CustomerDetailsEditModal: React.FC<CustomerDetailsEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  recordData,
  editType: initialEditType
}) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editType, setEditType] = useState<'customer_details' | 'billing_details' | 'technical_details'>(initialEditType);


  const [formData, setFormData] = useState<any>({});

  const [regions, setRegions] = useState<any[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [routerModels, setRouterModels] = useState<RouterModel[]>([]);
  const [lcpnaps, setLcpnaps] = useState<LCPNAP[]>([]);

  const [vlans, setVlans] = useState<VLAN[]>([]);
  const [usageTypes, setUsageTypes] = useState<UsageType[]>([]);
  const [usedPorts, setUsedPorts] = useState<Set<string>>(new Set());
  const [portAccounts, setPortAccounts] = useState<Record<string, string>>({});
  const [totalPorts, setTotalPorts] = useState<number>(32);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);
  const [billingStatuses, setBillingStatuses] = useState<BillingStatus[]>([]);
  const [inventoryRouterModels, setInventoryRouterModels] = useState<InventoryItem[]>([]);
  const [originalRouterModemSn, setOriginalRouterModemSn] = useState('');
  const [agents, setAgents] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

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
    setEditType(initialEditType);
  }, [initialEditType]);

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

  useEffect(() => {
    if (!isOpen) {
      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }
      setImagePreview(null);
    }
  }, [isOpen, imagePreview]);

  useEffect(() => {
    if (isOpen && recordData) {

      if (editType === 'customer_details') {
        // Split customerName into parts if firstName is not available
        let firstName = recordData.firstName || recordData.first_name || '';
        let middleInitial = recordData.middleInitial || recordData.middle_initial || '';
        let lastName = recordData.lastName || recordData.last_name || '';

        // If we don't have firstName but have customerName, try to split it
        if (!firstName && recordData.customerName) {
          const nameParts = recordData.customerName.split(' ');
          if (nameParts.length >= 2) {
            firstName = nameParts[0];
            lastName = nameParts[nameParts.length - 1];
            if (nameParts.length > 2) {
              middleInitial = nameParts[1].charAt(0);
            }
          } else if (nameParts.length === 1) {
            firstName = nameParts[0];
          }
        }

        let houseFrontPictureUrl = recordData.houseFrontPicture || recordData.house_front_picture_url || recordData.house_front_picture || '';
        
        // Handle legacy Access/PowerApps JSON image format
        if (typeof houseFrontPictureUrl === 'string' && houseFrontPictureUrl.includes('{"Url":')) {
          try {
            const parsed = JSON.parse(houseFrontPictureUrl);
            houseFrontPictureUrl = parsed.Url || '';
          } catch (e) {
            houseFrontPictureUrl = '';
          }
        }

        const newFormData = {
          firstName,
          middleInitial,
          lastName,
          emailAddress: recordData.emailAddress || recordData.email_address || recordData.email || '',
          contactNumberPrimary: recordData.contactNumberPrimary || recordData.contact_number_primary || recordData.contactNumber || '',
          contactNumberSecondary: recordData.contactNumberSecondary || recordData.contact_number_secondary || recordData.secondContactNumber || '',
          address: recordData.address || '',
          region: recordData.region || '',
          city: recordData.city || '',
          barangay: recordData.barangay || '',
          addressCoordinates: recordData.addressCoordinates || recordData.address_coordinates || '',
          housingStatus: recordData.housingStatus || recordData.housing_status || '',
          // Only the stored value and the id inside it. The name is filled in by
          // the effect below once the agent list has loaded — reading `agents`
          // here would make it a dependency of this whole prefill, and a late
          // agent list would then reset every field the user had already typed.
          ...referredByFields(recordData, []),
          groupName: recordData.groupName || recordData.group_name || recordData.group || '',
          houseFrontPicture: houseFrontPictureUrl
        };

        setFormData(newFormData);

        const convertedUrl = convertGoogleDriveUrl(houseFrontPictureUrl);
        if (convertedUrl) {
          setImagePreview(convertedUrl);
        } else {
          setImagePreview(null);
        }
      } else if (editType === 'billing_details') {
        const formatDateForInput = (dateValue: any): string => {
          if (!dateValue) return '';
          try {
            const date = new Date(dateValue);
            if (isNaN(date.getTime())) return '';
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          } catch (error) {
            return '';
          }
        };

        setFormData({
          billing_status_id: recordData.billing_status_id || recordData.billingStatus || recordData.billingAccount?.billingStatusName || recordData.status || recordData.billing_status || recordData.billingAccount?.billing_status || '',
          billing_day: recordData.billing_day || recordData.billingDay || recordData.Billing_Day || recordData.billingAccount?.billing_day || '',
          vip_expiration: formatDateForInput(recordData.vip_expiration || recordData.vipExpiration || ''),
          vip_remarks: recordData.vip_remarks || recordData.vipRemarks || recordData.billingAccount?.vip_remarks || ''
        });
      } else if (editType === 'technical_details') {
        let lcpnapValue = recordData.lcpnap || recordData.LCPNAP || '';

        // If lcpnap is empty but we have lcp and nap, construct it
        if (!lcpnapValue && (recordData.lcp || recordData.LCP) && (recordData.nap || recordData.NAP)) {
          lcpnapValue = `${recordData.lcp || recordData.LCP}-${recordData.nap || recordData.NAP}`;
        }

        const parts = lcpnapValue.split(/-|\s/); // Split by hyphen or space

        const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';

        setFormData({
          username: recordData.pppoe_username || recordData.username || recordData.PPPOE_USERNAME || '',
          connection_type: recordData.connectionType ? capitalize(recordData.connectionType) : (recordData.connection_type ? capitalize(recordData.connection_type) : ''),
          router_model: recordData.routerModel || recordData.router_model || '',
          router_modem_sn: recordData.routerModemSn || recordData.router_modem_sn || recordData.routerModemSN || '',
          ip_address: recordData.ipAddress || recordData.ip_address || recordData.sessionIp || recordData.sessionIP || '',
          lcp: recordData.lcp || (parts.length >= 1 ? parts[0] : ''),
          nap: recordData.nap || (parts.length >= 2 ? parts[1] : ''),
          port: (() => {
            const rawPort = recordData.port || recordData.PORT || (parts.length >= 3 ? parts[2] : '');
            if (!rawPort) return '';
            const portNum = String(rawPort).replace(/[^\d]/g, '');
            return portNum ? `P${portNum.padStart(2, '0')}` : '';
          })(),
          vlan: recordData.vlan || recordData.VLAN || '',
          lcpnap: lcpnapValue,
          usage_type: recordData.usageType || recordData.usage_type || recordData.Usage_Type || recordData.UsageType || '',
          session_group: recordData.sessionGroup || recordData.session_group || ''
        });

        const initialSn = recordData.router_modem_sn || recordData.routerModemSn || recordData.routerModemSN || '';
        setOriginalRouterModemSn(initialSn);
      }
    }
    // Using granular IDs instead of the whole recordData object prevents 
    // the form from resetting when background polling updates the record data object reference
  }, [isOpen, editType, recordData?.id, recordData?.job_order_id, recordData?.JobOrder_ID]);

  useEffect(() => {
    const fetchData = async () => {
      if (!isOpen) return;

      try {
        if (editType === 'customer_details') {
          const [fetchedRegions, fetchedCities, barangaysRes] = await Promise.all([
            getRegions(),
            getCities(),
            barangayService.getAll()
          ]);

          setRegions(Array.isArray(fetchedRegions) ? fetchedRegions : []);
          setAllCities(Array.isArray(fetchedCities) ? fetchedCities : []);
          setAllBarangays(barangaysRes.success && Array.isArray(barangaysRes.data) ? barangaysRes.data : []);
        } else if (editType === 'billing_details') {
          const [fetchedPlans, fetchedBillingStatuses] = await Promise.all([
            planService.getAllPlans(),
            billingStatusService.getAll()
          ]);
          setPlans(Array.isArray(fetchedPlans) ? fetchedPlans : []);
          const statuses = Array.isArray(fetchedBillingStatuses) ? fetchedBillingStatuses : [];
          const forbiddenStatuses = ['service account', 'freeze', 'inactive', 'pullout'];
          const filteredStatuses = statuses.filter(s => 
            !forbiddenStatuses.includes(s.status_name.toLowerCase().trim())
          );
          setBillingStatuses(filteredStatuses);

          // If current billing_status_id is a string name, try to map it to an ID now that we have statuses
          setFormData((prev: any) => {
            const currentStatus = prev.billing_status_id;
            if (typeof currentStatus === 'string' && currentStatus && isNaN(Number(currentStatus))) {
              const matchedStatus = statuses.find(s =>
                s.status_name.toLowerCase() === currentStatus.toLowerCase()
              );
              if (matchedStatus) {
                return { ...prev, billing_status_id: matchedStatus.id };
              }
            }
            return prev;
          });

          // Fix plan field if it matches by name but needs price suffix
          if (formData.plan) {
            const matchedPlan = fetchedPlans.find(p => p.name === formData.plan || `${p.name} - P${p.price}` === formData.plan);
            if (matchedPlan) {
              const fullPlanName = matchedPlan.price ? `${matchedPlan.name} - P${matchedPlan.price}` : matchedPlan.name;
              if (fullPlanName !== formData.plan) {
                setFormData((prev: any) => ({ ...prev, plan: fullPlanName }));
              }
            }
          }
        } else if (editType === 'technical_details') {
          const [fetchedRouterModels, lcpnapsRes, vlansRes, usageTypesRes, inventoryRes] = await Promise.all([
            routerModelService.getAllRouterModels(),
            getAllLCPNAPs('', 1, 1000),
            getAllVLANs(),
            getAllUsageTypes(),
            getAllInventoryItems('', 1, 500)
          ]);

          setRouterModels(fetchedRouterModels);

          if (inventoryRes.success && Array.isArray(inventoryRes.data)) {
            setInventoryRouterModels(inventoryRes.data.filter((item: InventoryItem) => item.category_id === 11));
          }

          if (lcpnapsRes.success && Array.isArray(lcpnapsRes.data)) {
            setLcpnaps(lcpnapsRes.data);
          }

          setVlans(vlansRes.success && Array.isArray(vlansRes.data) ? vlansRes.data : []);
          const fetchedUsageTypes = usageTypesRes.success && Array.isArray(usageTypesRes.data) ? [...usageTypesRes.data] : [];
          
          let currentUsage = recordData?.usageType || recordData?.usage_type || recordData?.Usage_Type || recordData?.UsageType;
          
          if (currentUsage) {
            const matchedUsage = fetchedUsageTypes.find((u: any) => 
              String(u.usage_name).toLowerCase() === String(currentUsage).trim().toLowerCase() || 
              String(u.id) === String(currentUsage).trim()
            );

            if (!matchedUsage) {
              fetchedUsageTypes.push({ id: -1, usage_name: currentUsage });
            } else {
              currentUsage = matchedUsage.usage_name;
            }
          }

          setUsageTypes(fetchedUsageTypes);

          setFormData((prev: any) => {
            const existingUsage = prev.usage_type;
            if (existingUsage !== currentUsage) {
              return { ...prev, usage_type: currentUsage || '' };
            }
            return prev;
          });
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchData();
  }, [isOpen, editType]);

  useEffect(() => {
    const fetchAgents = async () => {
      if (!isOpen || editType !== 'customer_details') return;
      try {
        const response = await userService.getUsersByRole('agent');
        if (response.success && response.data) {
          setAgents(response.data);
        } else {
          const responseById = await userService.getUsersByRoleId(4);
          if (responseById.success && responseById.data) setAgents(responseById.data);
        }
      } catch (error) {
        setAgents([]);
      }
    };
    fetchAgents();
  }, [isOpen, editType]);

  useEffect(() => {
    const fetchTeams = async () => {
      if (!isOpen || editType !== 'customer_details') return;
      try {
        const response = await agentService.getAllAgents();
        if (response.success && response.data) {
          setTeams(response.data);
        }
      } catch (error) {
        setTeams([]);
      }
    };
    fetchTeams();
  }, [isOpen, editType]);

  useEffect(() => {
    const fetchPorts = async () => {
      if (isOpen && editType === 'technical_details' && formData.lcpnap) {
        try {
          // Use any available ID variation
          const id = recordData?.id || recordData?.job_order_id || recordData?.JobOrder_ID;
          const accountNo = recordData?.accountNo || recordData?.account_no || recordData?.AccountNo || '';
          const usedRes = await getUsedPorts(formData.lcpnap, id, accountNo);

          if (usedRes.success && usedRes.data) {
            setUsedPorts(new Set(usedRes.data.used));
            setPortAccounts((usedRes.data as any).port_accounts || {});
            setTotalPorts(usedRes.data.total);
          } else {
            setUsedPorts(new Set());
            setPortAccounts({});
            setTotalPorts(32);
          }
        } catch (error) {
          console.error('Error fetching used ports:', error);
          setUsedPorts(new Set());
          setPortAccounts({});
          setTotalPorts(32);
        }
      } else {
        setUsedPorts(new Set());
        setPortAccounts({});
        setTotalPorts(32);
      }
    };

    fetchPorts();
  }, [isOpen, editType, formData.lcpnap, recordData?.id, recordData?.job_order_id, recordData?.JobOrder_ID]);



  /**
   * Keep the agent's name on screen and their id in the form.
   *
   * SearchableField hands over the option it rendered, so the id comes from the
   * row that was clicked rather than being looked back up by name — which is
   * what keeps two agents sharing a name distinct.
   */
  const handleReferredBySelect = (label: string, option?: any) => {
    const selection = selectionFromOption(label, option);
    setFormData((prev: any) => ({
      ...prev,
      referredBy: selection.label,
      referredById: selection.agentId,
    }));
  };

  // The agent list is fetched while the modal is opening, so a record prefilled
  // before it arrives has no name to show for an id-form referral and holds the
  // stored value instead. Resolving again once the list lands fills the name in.
  //
  // The guard is on the LABEL, not the id: prefill already reads the id out of
  // the stored value, so a guard on the id would never let this run. A label
  // that still equals what was stored is one nobody has picked over.
  const referredByRaw = recordData?.referredBy ?? recordData?.referred_by ?? '';
  const referredByAgentIdProp =
    recordData?.referredByAgentId ?? recordData?.referred_by_agent_id ?? null;

  useEffect(() => {
    if (!isOpen || !agents.length || editType !== 'customer_details') return;

    setFormData((prev: any) => {
      if ((prev.referredBy ?? '') !== String(referredByRaw ?? '')) return prev;

      const resolved = referredByFields(
        { referred_by: referredByRaw, referred_by_agent_id: referredByAgentIdProp },
        agents
      );

      // Returning prev unchanged is what stops this looping: the parent rebuilds
      // its props on every render, and React bails out of a set that produces
      // the identical state.
      if (resolved.referredBy === prev.referredBy && resolved.referredById === prev.referredById) {
        return prev;
      }
      return { ...prev, ...resolved };
    });
  }, [isOpen, agents, editType, referredByRaw, referredByAgentIdProp]);

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev: any) => {
      const newData = { ...prev, [field]: value };

      if (editType === 'customer_details') {
        if (field === 'region') {
          newData.city = '';
          newData.barangay = '';
        } else if (field === 'city') {
          newData.barangay = '';
        }
      } else if (editType === 'technical_details') {
        if (field === 'lcpnap') {
          newData.port = '';
          const selected = lcpnaps.find(l => l.lcpnap_name === value);
          if (selected) {
            newData.lcp = selected.lcp;
            newData.nap = selected.nap;
          } else {
            const parts = value.split('-');
            newData.lcp = parts[0] || '';
            newData.nap = parts[1] || '';
          }
        }
        if (field === 'connection_type') {
          if (value === 'Fiber') {
            newData.ip_address = '';
          } else if (value === 'Antenna' || value === 'Local') {
            newData.lcp = '';
            newData.nap = '';
            newData.lcpnap = '';
            newData.port = '';
            newData.vlan = '';
          }
        }
      }

      return newData;
    });

    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const getFilteredCities = () => {
    if (!formData.region) return [];
    const selectedRegion = regions.find((reg: any) => reg.name === formData.region);
    if (!selectedRegion) return [];
    return allCities.filter(city => city.region_id === selectedRegion.id);
  };

  const getFilteredBarangays = () => {
    if (!formData.city) return [];
    const selectedCity = allCities.find(city => city.name === formData.city);
    if (!selectedCity) return [];
    return allBarangays.filter(brgy => brgy.city_id === selectedCity.id);
  };

  const getGroupedAgents = (): GroupedOption[] => buildAgentGroups(agents, teams);

  const filteredCities = getFilteredCities();
  const filteredBarangays = getFilteredBarangays();
  const groupedAgents = getGroupedAgents();

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
                <div className={`w-full h-full flex flex-col items-center justify-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
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
            <div className={`w-full h-full flex flex-col items-center justify-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
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

  const handleImageUpload = async (file: File) => {
    try {
      let processedFile = file;
      const originalSize = (file.size / 1024 / 1024).toFixed(2);

      if (activeImageSize && activeImageSize.image_size_value < 100) {
        try {
          const resizedFile = await resizeImage(file, activeImageSize.image_size_value);
          const resizedSize = (resizedFile.size / 1024 / 1024).toFixed(2);

          if (resizedFile.size < file.size) {
            processedFile = resizedFile;
          } else {
            processedFile = file;
          }
        } catch (resizeError) {
          console.error('[RESIZE FAILED] House Front Picture:', resizeError);
          processedFile = file;
        }
      }

      handleInputChange('houseFrontPicture', processedFile);

      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }

      const previewUrl = URL.createObjectURL(processedFile);
      setImagePreview(previewUrl);

      if (errors.houseFrontPicture) {
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors.houseFrontPicture;
          return newErrors;
        });
      }


    } catch (error) {
      console.error('[UPLOAD ERROR] House Front Picture:', error);

      handleInputChange('houseFrontPicture', file);

      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }

      const previewUrl = URL.createObjectURL(file);
      setImagePreview(previewUrl);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (editType === 'customer_details') {
      if (!formData.firstName?.trim()) newErrors.firstName = 'First Name is required';
      if (!formData.lastName?.trim()) newErrors.lastName = 'Last Name is required';
      if (!formData.emailAddress?.trim()) newErrors.emailAddress = 'Email is required';
      if (!formData.contactNumberPrimary?.trim()) newErrors.contactNumberPrimary = 'Contact Number is required';
      if (!formData.address?.trim()) newErrors.address = 'Address is required';
      if (!formData.region?.trim()) newErrors.region = 'Region is required';
      if (!formData.city?.trim()) newErrors.city = 'City is required';
      if (!formData.barangay?.trim()) newErrors.barangay = 'Barangay is required';
    } else if (editType === 'billing_details') {
      if (!formData.billing_status_id?.toString().trim()) newErrors.billing_status_id = 'Billing Status is required';
      if (!formData.billing_day) newErrors.billing_day = 'Billing Day is required';

      const isVipStatus = billingStatuses.find(s => s.id.toString() === formData.billing_status_id?.toString())?.status_name.toUpperCase() === 'VIP' || formData.billing_status_id?.toString() === '7';
      if (isVipStatus) {
        if (!formData.vip_expiration) {
          newErrors.vip_expiration = 'VIP Expiration Date is required';
        }
        if (!formData.vip_remarks?.trim()) {
          newErrors.vip_remarks = 'VIP Remarks is required';
        }
      }
    } else if (editType === 'technical_details') {
      if (!formData.username?.trim()) newErrors.username = 'Username is required';
      if (!formData.connection_type?.trim()) newErrors.connection_type = 'Connection Type is required';
      if (!formData.router_model?.trim()) newErrors.router_model = 'Router Model is required';

      if (formData.connection_type === 'Fiber') {
        if (!formData.lcpnap?.trim()) newErrors.lcpnap = 'LCPNAP is required';
        if (!formData.port?.trim()) newErrors.port = 'Port is required';
        if (!formData.vlan?.toString().trim()) newErrors.vlan = 'VLAN is required';
      }

      if (formData.connection_type === 'Antenna' || formData.connection_type === 'Local') {
        if (!formData.ip_address?.trim()) newErrors.ip_address = 'IP Address is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    const isValid = validateForm();

    if (!isValid) {
      setModal({
        isOpen: true,
        type: 'warning',
        title: 'Validation Error',
        message: 'Please fill in all required fields before saving.'
      });
      return;
    }

    // SmartOLT Validation Logic for Technical Details (skip if SN hasn't changed)
    const snChanged = formData.router_modem_sn?.trim() !== originalRouterModemSn?.trim();
    if (editType === 'technical_details' && formData.connection_type === 'Fiber' && formData.router_modem_sn?.trim() && snChanged) {
      try {
        setLoading(true);

        const smartOltResponse = await apiClient.get('/smart-olt/validate-sn', {
          params: { sn: formData.router_modem_sn }
        });

        if (!(smartOltResponse.data as any).success) {
          setLoading(false);

          const errorMessage = (smartOltResponse.data as any).message || 'Invalid Modem SN';
          setErrors(prev => ({
            ...prev,
            router_modem_sn: errorMessage
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


        setLoading(false);
      } catch (error: any) {
        console.error('[SMARTOLT VALIDATION] API Error:', error);
        setLoading(false);
        const errorMessage = error.response?.data?.message || 'Failed to validate Modem SN with SmartOLT system.';

        setErrors(prev => ({
          ...prev,
          router_modem_sn: errorMessage
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

    setLoading(true);
    setLoadingPercentage(0);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 99) return 99;
        if (prev >= 90) return prev + 1;
        if (prev >= 70) return prev + 2;
        return prev + 5;
      });
    }, 300);

    try {
      const oldUsername = recordData?.username || recordData?.Username || recordData?.pppoe_username;
      const isUpdatingRadius = editType === 'technical_details' && 
                               oldUsername && 
                               formData.username && 
                               oldUsername !== formData.username;

      setModal({
        isOpen: true,
        type: 'loading',
        title: isUpdatingRadius ? 'Saving & Updating RADIUS...' : 'Saving...',
        message: isUpdatingRadius 
          ? 'Saving to database and pushing new PPPoE credentials to RADIUS. Please wait...' 
          : 'Please wait while we update the details.'
      });

      // Inject logged-in user's ID as updatedBy (backend expects an unsignedBigInteger for the users table foreign key)
      const authData = localStorage.getItem('authData');
      const parsedUser = authData ? JSON.parse(authData) : null;
      let loggedInUserId = '';

      if (parsedUser) {
        // Use user ID so the backend stores the correct foreign key (e.g., 7 instead of truncating an email string to 1 or 0)
        loggedInUserId = parsedUser.id || parsedUser.user?.id || '';
      }

      const dataWithUpdatedBy: any = { ...formData, updatedBy: loggedInUserId };

      // referredBy is the name the field showed; the column takes the agent's
      // id. Only touched when this form carries the field at all — the billing
      // and technical tabs share this handler and have no referral on them.
      if ('referredBy' in formData) {
        dataWithUpdatedBy.referredBy = referredByForSave(
          { label: formData.referredBy, agentId: formData.referredById ?? null },
          agents
        );
        delete dataWithUpdatedBy.referredById;
      }

      await onSave(dataWithUpdatedBy, editType);

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      // Brief delay to show 100%
      await new Promise(resolve => setTimeout(resolve, 500));

      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'Details updated successfully.',
        onConfirm: () => {
          setModal(prev => ({ ...prev, isOpen: false }));
          onClose();
        }
      });
    } catch (error: any) {
      console.error('Save failed:', error);
      clearInterval(progressInterval);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Save Failed',
        message: error.message || 'Failed to save changes. Please try again.',
        onConfirm: () => setModal(prev => ({ ...prev, isOpen: false }))
      });
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  const getModalTitle = () => {
    if (editType === 'customer_details') return 'Edit Customer Details';
    if (editType === 'billing_details') return 'Edit Billing Details';
    if (editType === 'technical_details') return 'Edit Technical Details';
    return 'Edit Details';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
      <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
        }`}>
        <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-gray-100 border-gray-300'
          }`}>
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{getModalTitle()}</h2>
          <div className="flex items-center space-x-3">
            <button
              onClick={handleCancel}
              className={`px-4 py-2 rounded text-sm ${isDarkMode
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                }`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center"
              style={{
                backgroundColor: colorPalette?.primary || '#7c3aed'
              }}
              onMouseEnter={(e) => {
                if (colorPalette?.accent && !loading) {
                  e.currentTarget.style.backgroundColor = colorPalette.accent;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
              }}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
            <button
              onClick={onClose}
              className={isDarkMode ? 'text-gray-400 hover:text-white transition-colors' : 'text-gray-600 hover:text-gray-900 transition-colors'}
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Edit Type</label>
              <div className="relative">
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as 'customer_details' | 'billing_details' | 'technical_details')}
                  className={`w-full px-3 py-2 rounded border appearance-none ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    } focus:outline-none`}
                >
                  <option value="customer_details">Customer Details</option>
                  <option value="billing_details">Billing Details</option>
                  <option value="technical_details">Technical Details</option>
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
            </div>

            {editType === 'customer_details' && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    First Name<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.firstName || ''}
                    onChange={(e) => handleInputChange('firstName', e.target.value)}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = errors.firstName ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.firstName ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                  />
                  {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Middle Initial
                  </label>
                  <input
                    type="text"
                    value={formData.middleInitial || ''}
                    onChange={(e) => handleInputChange('middleInitial', e.target.value)}
                    maxLength={10}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Last Name<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.lastName || ''}
                    onChange={(e) => handleInputChange('lastName', e.target.value)}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = errors.lastName ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.lastName ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                  />
                  {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Email Address<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={formData.emailAddress || ''}
                    onChange={(e) => handleInputChange('emailAddress', e.target.value)}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = errors.emailAddress ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.emailAddress ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                  />
                  {errors.emailAddress && <p className="text-red-500 text-xs mt-1">{errors.emailAddress}</p>}
                  <p className={`text-[10px] mt-1 italic ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    * Updating this will also update the user's login email and password.
                  </p>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Contact Number<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.contactNumberPrimary || ''}
                    onChange={(e) => handleInputChange('contactNumberPrimary', e.target.value)}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = errors.contactNumberPrimary ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.contactNumberPrimary ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                  />
                  {errors.contactNumberPrimary && <p className="text-red-500 text-xs mt-1">{errors.contactNumberPrimary}</p>}
                  <p className={`text-[10px] mt-1 italic ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    * Updating this will also update the user's login contact number and password.
                  </p>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Second Contact Number
                  </label>
                  <input
                    type="text"
                    value={formData.contactNumberSecondary || ''}
                    onChange={(e) => handleInputChange('contactNumberSecondary', e.target.value)}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Address<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.address || ''}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = errors.address ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.address ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                  />
                  {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Region<span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={formData.region || ''}
                      onChange={(e) => handleInputChange('region', e.target.value)}
                      onFocus={(e) => {
                        if (colorPalette?.primary) {
                          e.currentTarget.style.borderColor = colorPalette.primary;
                          e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                        }
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = errors.region ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none ${errors.region ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                        } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                    >
                      <option value="">Select Region</option>
                      {formData.region && !regions.some((reg: any) => reg.name === formData.region) && (
                        <option value={formData.region}>{formData.region}</option>
                      )}
                      {regions.map((region: any) => (
                        <option key={region.id} value={region.name}>
                          {region.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} size={20} />
                  </div>
                  {errors.region && <p className="text-red-500 text-xs mt-1">{errors.region}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    City<span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={formData.city || ''}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                      disabled={!formData.region}
                      onFocus={(e) => {
                        if (colorPalette?.primary && !e.currentTarget.disabled) {
                          e.currentTarget.style.borderColor = colorPalette.primary;
                          e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                        }
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = errors.city ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${errors.city ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                        } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
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
                    <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
                  </div>
                  {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Barangay<span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={formData.barangay || ''}
                      onChange={(e) => handleInputChange('barangay', e.target.value)}
                      disabled={!formData.city}
                      onFocus={(e) => {
                        if (colorPalette?.primary && !e.currentTarget.disabled) {
                          e.currentTarget.style.borderColor = colorPalette.primary;
                          e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                        }
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = errors.barangay ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${errors.barangay ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                        } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
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
                    <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
                  </div>
                  {errors.barangay && <p className="text-red-500 text-xs mt-1">{errors.barangay}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Housing Status
                  </label>
                  <div className="relative">
                    <select
                      value={formData.housingStatus || ''}
                      onChange={(e) => handleInputChange('housingStatus', e.target.value)}
                      onFocus={(e) => {
                        if (colorPalette?.primary) {
                          e.currentTarget.style.borderColor = colorPalette.primary;
                          e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                        }
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                    >
                      <option value="">Select Housing Status</option>
                      <option value="Owner">Owner</option>
                      <option value="Renter">Renter</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
                  </div>
                </div>

                {/*
                  Team names are group headings here, not choices. A referral has
                  to name one agent: referred_by is what the commission is settled
                  against when the job order is approved, and a team name matches
                  no agent, so it would silently leave the referral unpaid. Teams
                  stay searchable — typing one still lists its members to pick from.
                */}
                <SearchableField
                  label="Referred By"
                  value={formData.referredBy}
                  onSelect={(val, option) => handleReferredBySelect(val, option)}
                  groupedOptions={groupedAgents}
                  optionLabelKey="name"
                  isDarkMode={isDarkMode}
                  placeholder="Search Agent..."
                  isHeaderSelectable={false}
                />

                <ImagePreview
                  imageUrl={imagePreview || (typeof formData.houseFrontPicture === 'string' ? formData.houseFrontPicture : null)}
                  label="House Front Picture"
                  onUpload={handleImageUpload}
                  error={errors.houseFrontPicture}
                />
              </>
            )}

            {editType === 'billing_details' && (
              <>



                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Billing Status<span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={formData.billing_status_id || ''}
                      onChange={(e) => handleInputChange('billing_status_id', e.target.value)}
                      onFocus={(e) => {
                        if (colorPalette?.primary) {
                          e.currentTarget.style.borderColor = colorPalette.primary;
                          e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                        }
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = errors.billing_status_id ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none ${errors.billing_status_id ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                        } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                    >
                      <option value="">Select Billing Status</option>
                      {billingStatuses.map((status) => (
                        <option key={status.id} value={status.id}>
                          {status.status_name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
                  </div>
                  {errors.billing_status_id && <p className="text-red-500 text-xs mt-1">{errors.billing_status_id}</p>}
                </div>

                {(billingStatuses.find(s => s.id.toString() === formData.billing_status_id?.toString())?.status_name.toUpperCase() === 'VIP' || 
                  formData.billing_status_id?.toString() === '7') && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        VIP Expiration Date<span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={formData.vip_expiration || ''}
                        onChange={(e) => handleInputChange('vip_expiration', e.target.value)}
                        onFocus={(e) => {
                          if (colorPalette?.primary) {
                            e.currentTarget.style.borderColor = colorPalette.primary;
                            e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                          }
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = errors.vip_expiration ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.vip_expiration ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                          } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                      />
                      {errors.vip_expiration && <p className="text-red-500 text-xs mt-1">{errors.vip_expiration}</p>}
                    </div>

                     <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        VIP Remarks<span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={formData.vip_remarks || ''}
                        onChange={(e) => handleInputChange('vip_remarks', e.target.value)}
                        onFocus={(e) => {
                          if (colorPalette?.primary) {
                            e.currentTarget.style.borderColor = colorPalette.primary;
                            e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                          }
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = errors.vip_remarks ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.vip_remarks ? 'border-red-500' : isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                          }`}
                        rows={3}
                        placeholder="Enter VIP remarks..."
                      />
                      {errors.vip_remarks && <p className="text-red-500 text-xs mt-1">{errors.vip_remarks}</p>}
                    </div>
                  </div>
                )}

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Billing Day (1-30)<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter day (1-30)"
                    value={formData.billing_day || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, ''); // Remove letters
                      if (val === '') {
                        handleInputChange('billing_day', '');
                      } else {
                        const num = parseInt(val);
                        if (num >= 1 && num <= 30) {
                          handleInputChange('billing_day', num.toString());
                        } else if (num > 30) {
                          handleInputChange('billing_day', '30'); // Cap at 30
                        }
                      }
                    }}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = errors.billing_day ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.billing_day ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                  />
                  {errors.billing_day && <p className="text-red-500 text-xs mt-1">{errors.billing_day}</p>}
                </div>
              </>
            )}

            {editType === 'technical_details' && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    PPPOE Username<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.username || ''}
                    onChange={(e) => handleInputChange('username', e.target.value)}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = errors.username ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.username ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                  />
                  {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Connection Type<span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleInputChange('connection_type', 'Antenna')}
                      className={`py-2 px-4 rounded border transition-colors duration-200 ${formData.connection_type === 'Antenna'
                        ? 'text-white border-transparent'
                        : (isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-700')
                        }`}
                      style={{
                        backgroundColor: formData.connection_type === 'Antenna' ? (colorPalette?.primary || '#7c3aed') : undefined,
                        borderColor: formData.connection_type === 'Antenna' ? (colorPalette?.primary || '#7c3aed') : undefined
                      }}
                    >
                      Antenna
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInputChange('connection_type', 'Fiber')}
                      className={`py-2 px-4 rounded border transition-colors duration-200 ${formData.connection_type === 'Fiber'
                        ? 'text-white border-transparent'
                        : (isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-700')
                        }`}
                      style={{
                        backgroundColor: formData.connection_type === 'Fiber' ? (colorPalette?.primary || '#7c3aed') : undefined,
                        borderColor: formData.connection_type === 'Fiber' ? (colorPalette?.primary || '#7c3aed') : undefined
                      }}
                    >
                      Fiber
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInputChange('connection_type', 'Local')}
                      className={`py-2 px-4 rounded border transition-colors duration-200 ${formData.connection_type === 'Local'
                        ? 'text-white border-transparent'
                        : (isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-700')
                        }`}
                      style={{
                        backgroundColor: formData.connection_type === 'Local' ? (colorPalette?.primary || '#7c3aed') : undefined,
                        borderColor: formData.connection_type === 'Local' ? (colorPalette?.primary || '#7c3aed') : undefined
                      }}
                    >
                      Local
                    </button>
                  </div>
                  {errors.connection_type && <p className="text-red-500 text-xs mt-1">{errors.connection_type}</p>}
                </div>

                <SearchableField
                  label="Router Model"
                  placeholder="Search Router Model..."
                  value={formData.router_model}
                  onSelect={(value) => handleInputChange('router_model', value)}
                  options={inventoryRouterModels}
                  optionLabelKey="item_name"
                  isDarkMode={isDarkMode}
                  error={errors.router_model}
                  required
                />

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Router Modem SN
                  </label>
                  <input
                    type="text"
                    value={formData.router_modem_sn || ''}
                    onChange={(e) => handleInputChange('router_modem_sn', e.target.value)}
                    onFocus={(e) => {
                      if (colorPalette?.primary) {
                        e.currentTarget.style.borderColor = colorPalette.primary;
                        e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                      }
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                      }`}
                  />
                </div>

                {(formData.connection_type === 'Antenna' || formData.connection_type === 'Local') && (
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      IP Address<span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.ip_address || ''}
                      onChange={(e) => handleInputChange('ip_address', e.target.value)}
                      onFocus={(e) => {
                        if (colorPalette?.primary) {
                          e.currentTarget.style.borderColor = colorPalette.primary;
                          e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                        }
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = errors.ip_address ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.ip_address ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                        } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                    />
                    {errors.ip_address && <p className="text-red-500 text-xs mt-1">{errors.ip_address}</p>}
                  </div>
                )}

                {formData.connection_type === 'Fiber' && (
                  <>
                    <SearchableField
                      label="LCP-NAP"
                      placeholder="Search LCP-NAP..."
                      value={formData.lcpnap}
                      onSelect={(value) => handleInputChange('lcpnap', value)}
                      options={lcpnaps}
                      optionLabelKey="lcpnap_name"
                      isDarkMode={isDarkMode}
                      error={errors.lcpnap}
                      required
                    />

                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Port<span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <select
                          value={formData.port || ''}
                          onChange={(e) => handleInputChange('port', e.target.value)}
                          disabled={!formData.lcpnap}
                          onFocus={(e) => {
                            if (colorPalette?.primary && !e.currentTarget.disabled) {
                              e.currentTarget.style.borderColor = colorPalette.primary;
                              e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                            }
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = errors.port ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                          className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${errors.port ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                            } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                        >
                          <option value="">{formData.lcpnap ? 'Select Port' : 'Select LCP-NAP first'}</option>
                          {(() => {
                            // Support existing non-standard port names if they're not in the generated list
                            if (!formData.port) return null;
                            const currentPort = String(formData.port);
                            const isGenerated = Array.from({ length: totalPorts }).some((_, i) => `P${(i + 1).toString().padStart(2, '0')}` === currentPort);
                            if (isGenerated) return null;
                            return <option value={currentPort}>{currentPort}</option>;
                          })()}
                          {Array.from({ length: totalPorts }, (_, i) => {
                            const portVal = `P${(i + 1).toString().padStart(2, '0')}`;
                            const isUsed = usedPorts.has(portVal) && formData.port !== portVal;
                            const accountNo = portAccounts[portVal] || '';

                            return (
                              <option 
                                key={portVal} 
                                value={portVal} 
                                disabled={isUsed}
                                style={{ color: isUsed ? (isDarkMode ? '#9ca3af' : '#6b7280') : 'inherit' }}
                              >
                                {portVal}{isUsed && accountNo ? ` — ${accountNo}` : ''}
                              </option>
                            );
                          })}
                        </select>
                        <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
                      </div>
                      {errors.port && <p className="text-red-500 text-xs mt-1">{errors.port}</p>}
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        VLAN<span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <select
                          value={formData.vlan || ''}
                          onChange={(e) => handleInputChange('vlan', e.target.value)}
                          onFocus={(e) => {
                            if (colorPalette?.primary) {
                              e.currentTarget.style.borderColor = colorPalette.primary;
                              e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                            }
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = errors.vlan ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                          className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none ${errors.vlan ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                            } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                        >
                          <option value="">Select VLAN</option>
                          {vlans.map((vlan) => (
                            <option key={vlan.vlan_id} value={vlan.value}>
                              {vlan.value}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
                      </div>
                      {errors.vlan && <p className="text-red-500 text-xs mt-1">{errors.vlan}</p>}
                    </div>
                  </>
                )}

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Usage Type
                  </label>
                  <div className="relative">
                    <select
                      value={formData.usage_type || ''}
                      onChange={(e) => handleInputChange('usage_type', e.target.value)}
                      onFocus={(e) => {
                        if (colorPalette?.primary) {
                          e.currentTarget.style.borderColor = colorPalette.primary;
                          e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                        }
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                        }`}
                    >
                      <option value="">Select Usage Type</option>
                      {usageTypes.map((usageType) => (
                        <option key={usageType.id} value={usageType.usage_name}>
                          {usageType.usage_name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
                  </div>
                </div>
                
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Group (Session Group)
                  </label>
                  <input
                    type="text"
                    value={formData.session_group || ''}
                    readOnly
                    className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors opacity-70 cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                      }`}
                  />
                  <p className={`text-[10px] mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>* This value is sourced from current online status and is read-only.</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {
        modal.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
            <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode
              ? 'bg-gray-900 border-gray-700'
              : 'bg-white border-gray-300'
              }`}>
              {modal.type === 'loading' ? (
                <div className="text-center">
                  <div className="flex justify-center mb-6">
                    <div className="animate-spin rounded-full h-20 w-20 border-b-4" style={{ borderColor: colorPalette?.primary || '#f97316' }}></div>
                  </div>
                  <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{loadingPercentage}%</p>
                  <h3 className={`text-xl font-semibold mt-4 mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{modal.title}</h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{modal.message}</p>
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
          </div>
        )
      }
    </div >
  );
};

export default CustomerDetailsEditModal;
