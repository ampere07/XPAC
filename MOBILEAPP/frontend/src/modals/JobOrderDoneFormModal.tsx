import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, ActivityIndicator, Image } from 'react-native';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);
import { Picker } from '@react-native-picker/picker';
import { X, Calendar, ChevronDown, Minus, Plus, Camera, MapPin, CheckCircle, AlertCircle, XCircle, Loader2 } from 'lucide-react-native';
import { UserData } from '../types/api';
import { updateJobOrder } from '../services/jobOrderService';
import { updateApplication } from '../services/applicationService';
import { userService } from '../services/userService';
import { referredByEcho } from '../utils/referredByField';
import { planService, Plan } from '../services/planService';
import { routerModelService, RouterModel } from '../services/routerModelService';
import { getAllPorts, Port } from '../services/portService';
import { getAllLCPNAPs, LCPNAP } from '../services/lcpnapService';
import { getAllVLANs, VLAN } from '../services/vlanService';
import { getAllUsageTypes, UsageType } from '../services/usageTypeService';

import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import { locationDetailService, LocationDetail } from '../services/locationDetailService';
import apiClient from '../config/api';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Region {
  id: number;
  name: string;
}

interface JobOrderDoneFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: any) => void;
  jobOrderData?: any;
}

interface JobOrderDoneFormData {
  referredBy: string;
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
  location: string;
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
  speedTestImage: File | null;
  modifiedBy: string;
  modifiedDate: string;
  contractLink: string;
  contractTemplate: string;
  assignedEmail: string;

  visit_by: string;
  visit_with: string;
  visit_with_other: string;
  statusRemarks: string;
  ip: string;
}



const JobOrderDoneFormModal: React.FC<JobOrderDoneFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  jobOrderData
}) => {
  const isDarkMode = false;
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);



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

  const getCurrentUser = async (): Promise<UserData | null> => {
    try {
      const authData = await AsyncStorage.getItem('authData');
      if (authData) {
        return JSON.parse(authData);
      }
    } catch (error) {
      console.error('Error getting current user:', error);
    }
    return null;
  };

  const [currentUserEmail, setCurrentUserEmail] = useState<string>('unknown@ampere.com');

  useEffect(() => {
    const loadCurrentUser = async () => {
      const user = await getCurrentUser();
      setCurrentUserEmail(user?.email || 'unknown@ampere.com');
    };
    loadCurrentUser();
  }, []);

  const [formData, setFormData] = useState<JobOrderDoneFormData>({
    referredBy: '',
    dateInstalled: '',
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
    location: '',
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
    speedTestImage: null,
        modifiedBy: currentUserEmail,
    modifiedDate: dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    contractLink: '',
    contractTemplate: '1',
    assignedEmail: '',

    visit_by: '',
    visit_with: '',
    visit_with_other: '',
    statusRemarks: '',
    ip: ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [technicians, setTechnicians] = useState<Array<{ email: string; name: string }>>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [routerModels, setRouterModels] = useState<RouterModel[]>([]);
  const [lcpnaps, setLcpnaps] = useState<LCPNAP[]>([]);
  const [ports, setPorts] = useState<Port[]>([]);
  const [vlans, setVlans] = useState<VLAN[]>([]);

  const selectedLcpnap = lcpnaps.find(ln => ln.lcpnap_name === formData.lcpnap);
  const portTotal = selectedLcpnap ? Number(selectedLcpnap.port_total || 0) : 0;

  const [usageTypes, setUsageTypes] = useState<UsageType[]>([]);
  const [lcpnapSearch, setLcpnapSearch] = useState('');
  const [isLcpnapOpen, setIsLcpnapOpen] = useState(false);

  const [regions, setRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);
  const [allLocations, setAllLocations] = useState<LocationDetail[]>([]);

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

  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState<{
    title: string;
    messages: Array<{ type: 'success' | 'warning' | 'error'; text: string }>;
  }>({ title: '', messages: [] });
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);

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
      <View>
        <Text className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
          {label}
        </Text>
        <Pressable
          className={`relative w-full h-48 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'} border rounded overflow-hidden`}
          onPress={() => {
            // WEB-ONLY: File input removed for RN - needs react-native-image-picker
            console.log('Image upload pressed - implement with react-native-image-picker');
          }}
        >
          {imageUrl ? (
            <View className="relative w-full h-full">
              {isBlobUrl || (!isGDrive && !imageLoadError) ? (
                <Image
                  source={{ uri: imageUrl }}
                  className="w-full h-full"
                  resizeMode="contain"
                  onError={() => setImageLoadError(true)}
                />
              ) : (
                <View className={`w-full h-full flex flex-col items-center justify-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <Camera size={32} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                  <Text className={`text-sm mt-2 text-center px-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Image stored in Google Drive
                  </Text>
                  {imageUrl && (
                    <Text
                      className="text-orange-500 text-xs mt-2"
                      onPress={(e) => {
                        // WEB-ONLY: href replaced - implement Linking.openURL
                        console.log('Open link:', imageUrl);
                      }}
                    >
                      View in Drive
                    </Text>
                  )}
                </View>
              )}
              <View className="absolute bottom-2 right-2 bg-green-500 px-2 py-1 rounded flex-row items-center">
                <Camera color="white" size={14} />
                <Text className="text-white text-xs ml-1">Uploaded</Text>
              </View>
            </View>
          ) : (
            <View className={`w-full h-full flex flex-col items-center justify-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <Camera size={32} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
              <Text className={`text-sm mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Click to upload
              </Text>
            </View>
          )}
        </Pressable>
        {error && (
          <View className="flex flex-row items-center mt-1">
            <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
              <Text className="text-white text-xs">!</Text>
            </View>
            <Text className="text-orange-500 text-xs">This entry is required</Text>
          </View>
        )}
      </View>
    );
  };

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
    if (!isOpen) {
      Object.values(imagePreviews).forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    }
  }, [isOpen, imagePreviews]);



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
    const fetchAllLocations = async () => {
      if (isOpen) {
        try {
          const response = await locationDetailService.getAll();
          if (response.success && Array.isArray(response.data)) {
            setAllLocations(response.data);
          } else {
            setAllLocations([]);
          }
        } catch (error) {
          console.error('Error fetching Locations:', error);
          setAllLocations([]);
        }
      }
    };

    fetchAllLocations();
  }, [isOpen]);

  useEffect(() => {
    const fetchLcpnaps = async () => {
      if (isOpen) {
        try {
          const response = await getAllLCPNAPs('', 1, 1000);

          if (response.success && Array.isArray(response.data)) {
            setLcpnaps(response.data);
          } else {
            setLcpnaps([]);
          }
        } catch (error) {
          setLcpnaps([]);
        }
      }
    };

    fetchLcpnaps();
  }, [isOpen]);

  useEffect(() => {
    const fetchPorts = async () => {
      if (isOpen && formData.lcpnap) {
        try {
          console.log('Loading Ports from database for LCPNAP:', formData.lcpnap);
          const jobOrderId = jobOrderData?.id || jobOrderData?.JobOrder_ID;
          console.log('Fetching ports with params:', {
            lcpnap: formData.lcpnap,
            excludeUsed: true,
            currentJobOrderId: jobOrderId
          });
          const response = await getAllPorts(formData.lcpnap, 1, 100, true, jobOrderId);
          console.log('Port API Response:', response);

          if (response.success && Array.isArray(response.data)) {
            setPorts(response.data);
            console.log('Loaded Available Ports for', formData.lcpnap, ':', response.data.length);
            console.log('Port Labels:', response.data.map(p => p.Label));
          } else {
            console.warn('Unexpected Port response structure:', response);
            setPorts([]);
          }
        } catch (error) {
          console.error('Error fetching Ports:', error);
          setPorts([]);
        }
      } else if (isOpen && !formData.lcpnap) {
        setPorts([]);
      }
    };

    fetchPorts();
  }, [isOpen, jobOrderData, formData.lcpnap]);

  useEffect(() => {
    const fetchVlans = async () => {
      if (isOpen) {
        try {
          console.log('Loading VLANs from database...');
          const response = await getAllVLANs();
          console.log('VLAN API Response:', response);

          if (response.success && Array.isArray(response.data)) {
            setVlans(response.data);
            console.log('Loaded VLANs:', response.data.length);
          } else {
            console.warn('Unexpected VLAN response structure:', response);
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
          console.log('Loading usage types from database...');
          const response = await getAllUsageTypes();
          console.log('Usage Type API Response:', response);

          if (response.success && Array.isArray(response.data)) {
            const filtered = response.data.filter(ut =>
              ut.usage_name &&
              String(ut.usage_name).toLowerCase() !== 'undefined' &&
              String(ut.usage_name).toLowerCase() !== 'null'
            );
            setUsageTypes(filtered);
            console.log('Loaded Usage Types:', filtered.length);
          } else {
            console.warn('Unexpected Usage Type response structure:', response);
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
    const fetchPlans = async () => {
      if (isOpen) {
        try {
          const fetchedPlans = await planService.getAllPlans();
          setPlans(fetchedPlans);
        } catch (error) {
          console.error('Error fetching plans:', error);
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
          console.error('Error fetching router models:', error);
        }
      }
    };

    fetchRouterModels();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setFormData({
        referredBy: '',
        dateInstalled: '',
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
        location: '',
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
        speedTestImage: null,
        modifiedBy: currentUserEmail,
        modifiedDate: dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
        contractLink: '',
        contractTemplate: '1',
        assignedEmail: '',

        visit_by: '',
        visit_with: '',
        visit_with_other: '',
        statusRemarks: '',
        ip: ''
      });
      setErrors({});
    }
  }, [isOpen, currentUserEmail]);

  useEffect(() => {
    if (jobOrderData && isOpen) {
      console.log('JobOrderDoneFormModal - Received jobOrderData:', jobOrderData);

      const loadedStatus = jobOrderData.Status || jobOrderData.status || 'Confirmed';
      const loadedOnsiteStatus = jobOrderData.Onsite_Status || jobOrderData.onsite_status || 'In Progress';

      const fetchApplicationData = async () => {
        try {
          const applicationId = jobOrderData.application_id || jobOrderData.Application_ID;
          if (applicationId) {
            console.log('Fetching application data for ID:', applicationId);
            const appResponse = await apiClient.get<{ success: boolean; application: any }>(`/applications/${applicationId}`);
            if (appResponse.data.success && appResponse.data.application) {
              const appData = appResponse.data.application;
              console.log('Loaded application data:', appData);

              setFormData(prev => ({
                ...prev,
                referredBy: jobOrderData.Referred_By || jobOrderData.referred_by || '',
                dateInstalled: jobOrderData.Date_Installed || jobOrderData.date_installed || '',
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
                location: appData.location || jobOrderData.Location || jobOrderData.location || '',
                addressCoordinates: jobOrderData.Address_Coordinates || jobOrderData.address_coordinates || '',
                choosePlan: jobOrderData.Desired_Plan || jobOrderData.desired_plan || jobOrderData.Choose_Plan || jobOrderData.choose_plan || jobOrderData.plan || '',
                status: loadedStatus,
                connectionType: jobOrderData.Connection_Type || jobOrderData.connection_type || '',
                routerModel: jobOrderData.Router_Model || jobOrderData.router_model || '',
                modemSN: jobOrderData.Modem_SN || jobOrderData.modem_sn || '',
                groupName: jobOrderData.group_name || jobOrderData.Group_Name || '',
                lcpnap: jobOrderData.LCPNAP || jobOrderData.lcpnap || '',
                port: jobOrderData.PORT || jobOrderData.port || '',
                vlan: jobOrderData.VLAN || jobOrderData.vlan || '',
                username: jobOrderData.Username || jobOrderData.username || '',
                onsiteStatus: loadedOnsiteStatus,
                onsiteRemarks: jobOrderData.Onsite_Remarks || jobOrderData.onsite_remarks || '',
                contractLink: jobOrderData.Contract_Link || jobOrderData.contract_link || '',
                contractTemplate: (jobOrderData.Contract_Template || jobOrderData.contract_template || '1').toString(),
                assignedEmail: jobOrderData.Assigned_Email || jobOrderData.assigned_email || '',

                visit_by: jobOrderData.Visit_By || jobOrderData.visit_by || '',
                visit_with: jobOrderData.Visit_With || jobOrderData.visit_with || '',
                visit_with_other: jobOrderData.Visit_With_Other || jobOrderData.visit_with_other || '',
                statusRemarks: jobOrderData.Status_Remarks || jobOrderData.status_remarks || '',
                ip: jobOrderData.IP || jobOrderData.ip || ''
              }));
            }
          } else {
            console.warn('No application_id found, using jobOrderData for location');
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
          referredBy: jobOrderData.Referred_By || jobOrderData.referred_by || '',
          dateInstalled: jobOrderData.Date_Installed || jobOrderData.date_installed || '',
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
          location: jobOrderData.Location || jobOrderData.location || '',
          addressCoordinates: jobOrderData.Address_Coordinates || jobOrderData.address_coordinates || '',
          choosePlan: jobOrderData.Desired_Plan || jobOrderData.desired_plan || jobOrderData.Choose_Plan || jobOrderData.choose_plan || jobOrderData.plan || '',
          status: loadedStatus,
          connectionType: jobOrderData.Connection_Type || jobOrderData.connection_type || '',
          routerModel: jobOrderData.Router_Model || jobOrderData.router_model || '',
          modemSN: jobOrderData.Modem_SN || jobOrderData.modem_sn || '',
          groupName: jobOrderData.group_name || jobOrderData.Group_Name || '',
          lcpnap: jobOrderData.LCPNAP || jobOrderData.lcpnap || '',
          port: jobOrderData.PORT || jobOrderData.port || '',
          vlan: jobOrderData.VLAN || jobOrderData.vlan || '',
          username: jobOrderData.Username || jobOrderData.username || '',
          onsiteStatus: loadedOnsiteStatus,
          onsiteRemarks: jobOrderData.Onsite_Remarks || jobOrderData.onsite_remarks || '',
          contractLink: jobOrderData.Contract_Link || jobOrderData.contract_link || '',
          contractTemplate: (jobOrderData.Contract_Template || jobOrderData.contract_template || '1').toString(),
          assignedEmail: jobOrderData.Assigned_Email || jobOrderData.assigned_email || '',

          visit_by: jobOrderData.Visit_By || jobOrderData.visit_by || '',
          visit_with: jobOrderData.Visit_With || jobOrderData.visit_with || '',
          visit_with_other: jobOrderData.Visit_With_Other || jobOrderData.visit_with_other || '',
          statusRemarks: jobOrderData.Status_Remarks || jobOrderData.status_remarks || '',
          ip: jobOrderData.IP || jobOrderData.ip || ''
        }));
      };

      fetchApplicationData();
    }
  }, [jobOrderData, isOpen]);

  const handleInputChange = (field: keyof JobOrderDoneFormData, value: string | File | null) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      if (field === 'lcpnap') {
        newData.port = '';
      }
      if (field === 'region') {
        newData.city = '';
        newData.barangay = '';
        newData.location = '';
      }
      if (field === 'city') {
        newData.barangay = '';
        newData.location = '';
      }
      if (field === 'barangay') {
        newData.location = '';
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
          const resizedFile = await resizeImage(file, activeImageSize.image_size_value);
          const resizedSize = (resizedFile.size / 1024 / 1024).toFixed(2);

          if (resizedFile.size < file.size) {
            processedFile = resizedFile;
            console.log(`[RESIZE SUCCESS] ${field}: ${originalSize}MB → ${resizedSize}MB (${activeImageSize.image_size_value}%, saved ${((1 - resizedFile.size / file.size) * 100).toFixed(1)}%)`);
          } else {
            console.log(`[RESIZE SKIP] ${field}: Resized file (${resizedSize}MB) is not smaller than original (${originalSize}MB), using original`);
          }
        } catch (resizeError) {
          console.error(`[RESIZE FAILED] ${field}:`, resizeError);
          processedFile = file;
        }
      }

      setFormData(prev => {
        const updated = { ...prev, [field]: processedFile };
        console.log(`[STATE UPDATE] ${field} stored: ${(processedFile.size / 1024 / 1024).toFixed(2)}MB`);
        return updated;
      });

      if (imagePreviews[field] && imagePreviews[field]?.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviews[field]!);
      }

      const previewUrl = URL.createObjectURL(processedFile);
      setImagePreviews(prev => ({ ...prev, [field]: previewUrl }));

      if (errors[field]) {
        setErrors(prev => ({ ...prev, [field]: '' }));
      }
    } catch (error) {
      console.error(`[UPLOAD ERROR] ${field}:`, error);
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

  const handleNumberChange = (field: 'contractTemplate', increment: boolean) => {
    setFormData(prev => {
      const currentValue = parseInt(prev[field]) || 1;
      const newValue = increment ? currentValue + 1 : Math.max(1, currentValue - 1);
      return {
        ...prev,
        [field]: newValue.toString()
      };
    });
  };



  const showMessageModal = (title: string, messages: Array<{ type: 'success' | 'warning' | 'error'; text: string }>) => {
    setModalContent({ title, messages });
    setShowModal(true);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    const isValidImageUrl = (url: any): boolean => {
      if (!url) return false;
      if (typeof url !== 'string') return false;
      const trimmed = url.trim().toLowerCase();
      return trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined';
    };

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
    if (!formData.location.trim()) newErrors.location = 'Location is required';
    if (!formData.choosePlan.trim()) newErrors.choosePlan = 'Choose Plan is required';
    if (!formData.status.trim()) newErrors.status = 'Status is required';
    if (!formData.status.trim()) newErrors.status = 'Status is required';
    if (!formData.username.trim()) newErrors.username = 'Username is required';
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
          if (!formData.ip.trim()) newErrors.ip = 'IP is required';
        } else if (formData.connectionType === 'Fiber') {
          if (!formData.lcpnap.trim()) newErrors.lcpnap = 'LCP-NAP is required';
          if (!formData.port.trim()) newErrors.port = 'PORT is required';
          if (!formData.vlan.trim()) newErrors.vlan = 'VLAN is required';
        } else if (formData.connectionType === 'Local') {

        }



        if (!formData.onsiteRemarks.trim()) newErrors.onsiteRemarks = 'Onsite Remarks is required';


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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    const updatedFormData = {
      ...formData,
      modifiedBy: currentUserEmail,
      modifiedDate: dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss')
    };

    setFormData(updatedFormData);

    if (!validateForm()) {
      showMessageModal('Validation Error', [
        { type: 'error', text: 'Please fill in all required fields before saving.' }
      ]);
      return;
    }

    if (!jobOrderData?.id && !jobOrderData?.JobOrder_ID) {
      showMessageModal('Error', [
        { type: 'error', text: 'Cannot update job order: Missing ID' }
      ]);
      return;
    }

    setLoading(true);
    setShowLoadingModal(true);
    setLoadingPercentage(0);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 99) return 99;
        if (prev >= 90) return prev + 1;
        if (prev >= 70) return prev + 2;
        return prev + 5;
      });
    }, 300);

    const saveMessages: Array<{ type: 'success' | 'warning' | 'error'; text: string }> = [];

    try {
      const jobOrderId = jobOrderData.id || jobOrderData.JobOrder_ID;
      const applicationId = jobOrderData.Application_ID || jobOrderData.application_id;

      let radiusUsername = '';
      let radiusPassword = '';
      let imageUrls: any = {};

      if (updatedFormData.status === 'Confirmed' && updatedFormData.onsiteStatus === 'Done') {
        try {
          const jobOrderResponse = await apiClient.get<{ success: boolean; data: any }>(`/job-orders/${jobOrderId}`);

          if (jobOrderResponse.data.success && jobOrderResponse.data.data) {
            const existingUsername = jobOrderResponse.data.data.pppoe_username;
            const existingPassword = jobOrderResponse.data.data.pppoe_password;

            if (existingUsername && existingPassword) {
              radiusUsername = existingUsername;
              radiusPassword = existingPassword;

              saveMessages.push({
                type: 'warning',
                text: `PPPoE credentials already exist: Username: ${radiusUsername}, Password: ${radiusPassword}`
              });
            } else {
              const planNameForRadius = updatedFormData.choosePlan.includes(' - P')
                ? updatedFormData.choosePlan.split(' - P')[0].trim()
                : updatedFormData.choosePlan;

              try {
                const radiusResponse = await apiClient.post<{
                  success: boolean;
                  message: string;
                  data?: {
                    username: string;
                    password: string;
                    group: string;
                    credentials_exist?: boolean;
                    radius_response?: any;
                  };
                }>(`/job-orders/${jobOrderId}/create-radius-account`);

                if (radiusResponse.data.success && radiusResponse.data.data) {
                  const { username, password, credentials_exist } = radiusResponse.data.data;

                  if (credentials_exist) {
                    radiusUsername = username;
                    radiusPassword = password;

                    saveMessages.push({
                      type: 'warning',
                      text: `PPPoE credentials already exist: Username: ${username}, Password: ${password}, Plan: ${planNameForRadius}`
                    });
                  } else {
                    radiusUsername = username;
                    radiusPassword = password;

                    saveMessages.push({
                      type: 'success',
                      text: `RADIUS Account Created: Username: ${radiusUsername}, Password: ${radiusPassword}, Plan: ${planNameForRadius}`
                    });
                  }
                } else {
                  saveMessages.push({
                    type: 'error',
                    text: `RADIUS account creation failed: ${radiusResponse.data.message}`
                  });
                  setLoading(false);
                  setShowLoadingModal(false);
                  showMessageModal('Error', saveMessages);
                  return;
                }
              } catch (radiusError: any) {
                const errorMsg = radiusError.response?.data?.message || radiusError.message || 'Unknown error';
                saveMessages.push({
                  type: 'error',
                  text: `RADIUS account creation failed: ${errorMsg}`
                });
                setLoading(false);
                setShowLoadingModal(false);
                showMessageModal('Error', saveMessages);
                return;
              }
            }
          } else {
            saveMessages.push({
              type: 'error',
              text: 'Failed to retrieve job order data for RADIUS check'
            });
            setLoading(false);
            setShowLoadingModal(false);
            showMessageModal('Error', saveMessages);
            return;
          }
        } catch (fetchError: any) {
          const errorMsg = fetchError.response?.data?.message || fetchError.message || 'Unknown error';
          saveMessages.push({
            type: 'error',
            text: `Failed to check existing RADIUS credentials: ${errorMsg}`
          });
          setLoading(false);
          setShowLoadingModal(false);
          showMessageModal('Error', saveMessages);
          return;
        }

        const firstName = updatedFormData.firstName.trim();
        const middleInitial = updatedFormData.middleInitial.trim();
        const fullLastName = updatedFormData.lastName.trim();
        const folderName = `(joborder)${firstName} ${middleInitial} ${fullLastName}`.trim();

        const imageFormData = new FormData();
        imageFormData.append('folder_name', folderName);

        console.log('[UPLOAD START] Preparing images for upload...');
        console.log('[FORM DATA STATE]', {
          signedContract: formData.signedContractImage ? `${(formData.signedContractImage.size / 1024 / 1024).toFixed(2)}MB` : 'none',
          setup: formData.setupImage ? `${(formData.setupImage.size / 1024 / 1024).toFixed(2)}MB` : 'none',
          boxReading: formData.boxReadingImage ? `${(formData.boxReadingImage.size / 1024 / 1024).toFixed(2)}MB` : 'none',
          routerReading: formData.routerReadingImage ? `${(formData.routerReadingImage.size / 1024 / 1024).toFixed(2)}MB` : 'none',
          portLabel: formData.portLabelImage ? `${(formData.portLabelImage.size / 1024 / 1024).toFixed(2)}MB` : 'none',
          clientSignature: formData.clientSignatureImage ? `${(formData.clientSignatureImage.size / 1024 / 1024).toFixed(2)}MB` : 'none',
          speedTest: formData.speedTestImage ? `${(formData.speedTestImage.size / 1024 / 1024).toFixed(2)}MB` : 'none'
        });

        if (formData.signedContractImage) {
          console.log(`[APPEND] Signed Contract: ${(formData.signedContractImage.size / 1024 / 1024).toFixed(2)}MB`);
          imageFormData.append('signed_contract_image', formData.signedContractImage, formData.signedContractImage.name);
        }
        if (formData.setupImage) {
          console.log(`[APPEND] Setup: ${(formData.setupImage.size / 1024 / 1024).toFixed(2)}MB`);
          imageFormData.append('setup_image', formData.setupImage, formData.setupImage.name);
        }
        if (formData.boxReadingImage) {
          console.log(`[APPEND] Box Reading: ${(formData.boxReadingImage.size / 1024 / 1024).toFixed(2)}MB`);
          imageFormData.append('box_reading_image', formData.boxReadingImage, formData.boxReadingImage.name);
        }
        if (formData.routerReadingImage) {
          console.log(`[APPEND] Router Reading: ${(formData.routerReadingImage.size / 1024 / 1024).toFixed(2)}MB`);
          imageFormData.append('router_reading_image', formData.routerReadingImage, formData.routerReadingImage.name);
        }
        if (formData.portLabelImage) {
          console.log(`[APPEND] Port Label: ${(formData.portLabelImage.size / 1024 / 1024).toFixed(2)}MB`);
          imageFormData.append('port_label_image', formData.portLabelImage, formData.portLabelImage.name);
        }
        if (formData.clientSignatureImage) {
          console.log(`[APPEND] Client Signature: ${(formData.clientSignatureImage.size / 1024 / 1024).toFixed(2)}MB`);
          imageFormData.append('client_signature_image', formData.clientSignatureImage, formData.clientSignatureImage.name);
        }
        if (formData.speedTestImage) {
          console.log(`[APPEND] Speed Test: ${(formData.speedTestImage.size / 1024 / 1024).toFixed(2)}MB`);
          imageFormData.append('speed_test_image', formData.speedTestImage, formData.speedTestImage.name);
        }

        console.log('[UPLOAD] FormData prepared, sending to backend...');

        try {
          const uploadResponse = await apiClient.post<{
            success: boolean;
            message: string;
            data?: {
              signed_contract_image_url?: string;
              setup_image_url?: string;
              box_reading_image_url?: string;
              router_reading_image_url?: string;
              port_label_image_url?: string;
              client_signature_image_url?: string;
              speedtest_image_url?: string;
            };
            folder_id?: string;
          }>(`/job-orders/${jobOrderId}/upload-images`, imageFormData, {
            headers: {
              'Content-Type': 'multipart/form-data'
            }
          });

          if (uploadResponse.data.success && uploadResponse.data.data) {
            imageUrls = uploadResponse.data.data;
            saveMessages.push({
              type: 'success',
              text: 'Images uploaded to Google Drive successfully'
            });
          } else {
            saveMessages.push({
              type: 'error',
              text: `Failed to upload images: ${uploadResponse.data.message}`
            });
            setLoading(false);
            setShowLoadingModal(false);
            showMessageModal('Error', saveMessages);
            return;
          }
        } catch (uploadError: any) {
          const errorMsg = uploadError.response?.data?.message || uploadError.message || 'Unknown error';
          saveMessages.push({
            type: 'error',
            text: `Failed to upload images to Google Drive: ${errorMsg}`
          });
          setLoading(false);
          setShowLoadingModal(false);
          showMessageModal('Error', saveMessages);
          return;
        }
      }

      const jobOrderUpdateData: any = {
        // The box shows the resolved name; what goes back is the id the
        // record carried, unless somebody has typed over it.
        Referred_By: referredByEcho(jobOrderData, updatedFormData.referredBy),
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
        group_name: updatedFormData.groupName,
        Username: updatedFormData.username,
        Onsite_Status: updatedFormData.onsiteStatus,
        Modified_By: updatedFormData.modifiedBy,
        Modified_Date: updatedFormData.modifiedDate,
        Contract_Link: updatedFormData.contractLink,
        Contract_Template: updatedFormData.contractTemplate,
        Assigned_Email: updatedFormData.assignedEmail
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
          jobOrderUpdateData.Visit_By = updatedFormData.visit_by;
          jobOrderUpdateData.Visit_With = updatedFormData.visit_with;
          jobOrderUpdateData.Visit_With_Other = updatedFormData.visit_with_other;

          if (radiusUsername && radiusPassword) {
            jobOrderUpdateData.pppoe_username = radiusUsername;
            jobOrderUpdateData.pppoe_password = radiusPassword;
          }

          if (imageUrls.signed_contract_image_url) {
            jobOrderUpdateData.signed_contract_image_url = imageUrls.signed_contract_image_url;
          }
          if (imageUrls.setup_image_url) {
            jobOrderUpdateData.setup_image_url = imageUrls.setup_image_url;
          }
          if (imageUrls.box_reading_image_url) {
            jobOrderUpdateData.box_reading_image_url = imageUrls.box_reading_image_url;
          }
          if (imageUrls.router_reading_image_url) {
            jobOrderUpdateData.router_reading_image_url = imageUrls.router_reading_image_url;
          }
          if (imageUrls.port_label_image_url) {
            jobOrderUpdateData.port_label_image_url = imageUrls.port_label_image_url;
          }
          if (imageUrls.client_signature_image_url) {
            jobOrderUpdateData.client_signature_url = imageUrls.client_signature_image_url;
          }
          if (imageUrls.speedtest_image_url) {
            jobOrderUpdateData.speedtest_image_url = imageUrls.speedtest_image_url;
          }
        }

        if (updatedFormData.onsiteStatus === 'Reschedule') {
          jobOrderUpdateData.Visit_By = updatedFormData.visit_by;
          jobOrderUpdateData.Visit_With = updatedFormData.visit_with;
          jobOrderUpdateData.Visit_With_Other = updatedFormData.visit_with_other;
          jobOrderUpdateData.Onsite_Remarks = updatedFormData.onsiteRemarks;
          jobOrderUpdateData.Status_Remarks = updatedFormData.statusRemarks;
        }
      }

      const jobOrderResponse = await updateJobOrder(jobOrderId, jobOrderUpdateData);

      if (!jobOrderResponse.success) {
        throw new Error(jobOrderResponse.message || 'Job order update failed');
      }

      console.log('Job order updated successfully:', jobOrderResponse);
      saveMessages.push({
        type: 'success',
        text: 'Job order updated successfully'
      });



      if (applicationId) {
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
          location: updatedFormData.location,
          desired_plan: updatedFormData.choosePlan,
          referred_by: referredByEcho(jobOrderData, updatedFormData.referredBy),
          status: updatedFormData.status
        };

        console.log('Updating application with ID:', applicationId);
        console.log('Application update data:', applicationUpdateData);

        const applicationResponse = await updateApplication(applicationId, applicationUpdateData);
        console.log('Application updated successfully:', applicationResponse);
        saveMessages.push({
          type: 'success',
          text: `Application updated: Plan: ${updatedFormData.choosePlan}, Location: ${updatedFormData.region}, ${updatedFormData.city}, ${updatedFormData.barangay}, ${updatedFormData.location}`
        });
      } else {
        console.warn('No Application_ID found, skipping application table update');
        saveMessages.push({
          type: 'warning',
          text: 'Cannot update application - missing application ID'
        });
      }

      clearInterval(progressInterval);
      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      setErrors({});
      setLoading(false);
      setShowLoadingModal(false);
      setLoadingPercentage(0);
      showMessageModal('Success', saveMessages);
      onSave(updatedFormData);
      onClose();
    } catch (error: any) {
      console.error('Error updating records:', error);
      clearInterval(progressInterval);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error occurred';
      setLoading(false);
      setShowLoadingModal(false);
      setLoadingPercentage(0);
      showMessageModal('Error', [
        { type: 'error', text: `Failed to update records: ${errorMessage}` }
      ]);
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

  const getFilteredLocations = () => {
    if (!formData.barangay) return [];
    const selectedBarangay = allBarangays.find(brgy => brgy.barangay === formData.barangay);
    if (!selectedBarangay) return [];
    return allLocations.filter(loc => loc.barangay_id === selectedBarangay.id);
  };

  const filteredCities = getFilteredCities();
  const filteredBarangays = getFilteredBarangays();
  const filteredLocations = getFilteredLocations();

  return (
    <>
      <Modal visible={showLoadingModal} transparent animationType="fade">
        <View className="flex-1 bg-black/70 items-center justify-center">
          <View className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg p-8 flex flex-col items-center min-w-[320px]`}>
            <ActivityIndicator size="large" color="#F97316" />
            <View className="mt-6">
              <Text className={`${isDarkMode ? 'text-white' : 'text-gray-900'} text-4xl font-bold text-center`}>
                {loadingPercentage}%
              </Text>
            </View>
          </View>
        </View>
      </Modal>


      <Modal visible={showModal} transparent animationType="fade">
        <View className="flex-1 bg-black/75 items-center justify-center">
          <View className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col`}>
            <View className={`px-6 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} flex flex-row items-center justify-between`}>
              <Text className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {modalContent.title}
              </Text>
              <Pressable onPress={() => setShowModal(false)}>
                <X size={20} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
              </Pressable>
            </View>
            <ScrollView className="px-6 py-4">
              <View>
                {modalContent.messages.map((message, index) => (
                  <View
                    key={index}
                    className={`flex flex-row items-start p-3 rounded-lg mb-3 ${message.type === 'success'
                      ? isDarkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-100 border border-green-300'
                      : message.type === 'warning'
                        ? isDarkMode ? 'bg-yellow-900/30 border border-yellow-700' : 'bg-yellow-100 border border-yellow-300'
                        : isDarkMode ? 'bg-red-900/30 border border-red-700' : 'bg-red-100 border border-red-300'
                      }`}
                  >
                    {message.type === 'success' && <CheckCircle color="#10B981" size={20} />}
                    {message.type === 'warning' && <AlertCircle color="#F59E0B" size={20} />}
                    {message.type === 'error' && <XCircle color="#EF4444" size={20} />}
                    <Text
                      className={`text-sm flex-1 ml-3 ${message.type === 'success'
                        ? isDarkMode ? 'text-green-200' : 'text-green-800'
                        : message.type === 'warning'
                          ? isDarkMode ? 'text-yellow-200' : 'text-yellow-800'
                          : isDarkMode ? 'text-red-200' : 'text-red-800'
                        }`}
                    >
                      {message.text}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <View className={`px-6 py-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} flex flex-row justify-end`}>
              <Pressable className="px-4 py-2 bg-orange-600 rounded" onPress={() => setShowModal(false)}>
                <Text className="text-white">Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {isOpen && (
        <View className="absolute inset-0 bg-black/50 flex items-center justify-end">
          <View className={`h-full w-full max-w-2xl ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'} shadow-2xl overflow-hidden flex flex-col`}>
            <View className={`${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'} px-6 py-4 flex flex-row items-center justify-between border-b`}>
              <View className="flex flex-row items-center">
                <Text className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {`${formData.firstName} ${formData.middleInitial} ${formData.lastName}`}
                </Text>
              </View>
              <View className="flex flex-row items-center space-x-3">
                <Pressable onPress={onClose} className="px-4 py-2 border border-orange-600 rounded">
                  <Text className="text-orange-600 text-sm">Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSave} disabled={loading} className={`px-4 py-2 bg-orange-600 rounded ${loading ? 'opacity-50' : ''}`}>
                  <Text className="text-white text-sm">{loading ? 'Saving...' : 'Save'}</Text>
                </Pressable>
              </View>
            </View>

            <ScrollView className="flex-1 p-6">
              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Referred By
                </Text>
                <TextInput
                  value={formData.referredBy}
                  onChangeText={(text) => handleInputChange('referredBy', text)}
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'} border rounded`}
                />
              </View>


              {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && (
                <>
                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      Date Installed<Text className="text-red-500">*</Text>
                    </Text>
                    <View className="relative">
                      <TextInput
                        value={formData.dateInstalled}
                        onChangeText={(text) => handleInputChange('dateInstalled', text)}
                        placeholder="YYYY-MM-DD"
                        className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.dateInstalled ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                      />
                      <Calendar className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} size={20} />
                    </View>
                    {errors.dateInstalled && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      Usage Type<Text className="text-red-500">*</Text>
                    </Text>
                    <View className={`border ${errors.usageType ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                      <Picker
                        selectedValue={formData.usageType}
                        onValueChange={(value) => handleInputChange('usageType', value)}
                        style={{ color: isDarkMode ? '#fff' : '#000' }}
                      >
                        <Picker.Item label="Select Usage Type" value="" />
                        {formData.usageType &&
                          String(formData.usageType).toLowerCase() !== 'undefined' &&
                          String(formData.usageType).toLowerCase() !== 'null' &&
                          !usageTypes.some(ut => ut.usage_name === formData.usageType) && (
                            <Picker.Item key="custom" label={formData.usageType} value={formData.usageType} />
                          )}
                        {usageTypes
                          .filter(ut =>
                            ut.usage_name &&
                            String(ut.usage_name).toLowerCase() !== 'undefined' &&
                            String(ut.usage_name).toLowerCase() !== 'null'
                          )
                          .map((usageType) => (
                            <Picker.Item key={usageType.id} label={usageType.usage_name} value={usageType.usage_name} />
                          ))}
                      </Picker>
                    </View>
                    {errors.usageType && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>
                </>
              )}

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  First Name<Text className="text-red-500">*</Text>
                </Text>
                <TextInput
                  value={formData.firstName}
                  onChangeText={(text) => handleInputChange('firstName', text)}
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.firstName ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                />
                {errors.firstName && <Text className="text-red-500 text-xs mt-1">{errors.firstName}</Text>}
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Middle Initial
                </Text>
                <TextInput
                  value={formData.middleInitial}
                  onChangeText={(text) => handleInputChange('middleInitial', text)}
                  maxLength={1}
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'} border rounded`}
                />
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Last Name<Text className="text-red-500">*</Text>
                </Text>
                <TextInput
                  value={formData.lastName}
                  onChangeText={(text) => handleInputChange('lastName', text)}
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.lastName ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                />
                {errors.lastName && <Text className="text-red-500 text-xs mt-1">{errors.lastName}</Text>}
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Contact Number<Text className="text-red-500">*</Text>
                </Text>
                <TextInput
                  value={formData.contactNumber}
                  onChangeText={(text) => handleInputChange('contactNumber', text)}
                  keyboardType="phone-pad"
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.contactNumber ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                />
                {errors.contactNumber && <Text className="text-red-500 text-xs mt-1">{errors.contactNumber}</Text>}
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Second Contact Number
                </Text>
                <TextInput
                  value={formData.secondContactNumber}
                  onChangeText={(text) => handleInputChange('secondContactNumber', text)}
                  keyboardType="phone-pad"
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'} border rounded`}
                />
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Applicant Email Address<Text className="text-red-500">*</Text>
                </Text>
                <TextInput
                  value={formData.email}
                  onChangeText={(text) => handleInputChange('email', text)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.email ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                />
                {errors.email && <Text className="text-red-500 text-xs mt-1">{errors.email}</Text>}
              </View>


              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Address<Text className="text-red-500">*</Text>
                </Text>
                <TextInput
                  value={formData.address}
                  onChangeText={(text) => handleInputChange('address', text)}
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.address ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                />
                {errors.address && <Text className="text-red-500 text-xs mt-1">{errors.address}</Text>}
              </View>


              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Region<Text className="text-red-500">*</Text>
                </Text>
                <View className={`border ${errors.region ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                  <Picker
                    selectedValue={formData.region}
                    onValueChange={(value) => handleInputChange('region', value)}
                    style={{ color: isDarkMode ? '#fff' : '#000' }}
                  >
                    <Picker.Item label="Select Region" value="" />
                    {formData.region && !regions.some(reg => reg.name === formData.region) && (
                      <Picker.Item label={formData.region} value={formData.region} />
                    )}
                    {regions.map((region) => (
                      <Picker.Item key={region.id} label={region.name} value={region.name} />
                    ))}
                  </Picker>
                </View>
                {errors.region && <Text className="text-red-500 text-xs mt-1">{errors.region}</Text>}
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  City<Text className="text-red-500">*</Text>
                </Text>
                <View className={`border ${errors.city ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'} ${!formData.region ? 'opacity-50' : ''}`}>
                  <Picker
                    selectedValue={formData.city}
                    onValueChange={(value) => handleInputChange('city', value)}
                    enabled={!!formData.region}
                    style={{ color: isDarkMode ? '#fff' : '#000' }}
                  >
                    <Picker.Item label={formData.region ? 'Select City' : 'Select Region First'} value="" />
                    {formData.city && !filteredCities.some(city => city.name === formData.city) && (
                      <Picker.Item label={formData.city} value={formData.city} />
                    )}
                    {filteredCities.map((city) => (
                      <Picker.Item key={city.id} label={city.name} value={city.name} />
                    ))}
                  </Picker>
                </View>
                {errors.city && <Text className="text-red-500 text-xs mt-1">{errors.city}</Text>}
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Barangay<Text className="text-red-500">*</Text>
                </Text>
                <View className={`border ${errors.barangay ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'} ${!formData.city ? 'opacity-50' : ''}`}>
                  <Picker
                    selectedValue={formData.barangay}
                    onValueChange={(value) => handleInputChange('barangay', value)}
                    enabled={!!formData.city}
                    style={{ color: isDarkMode ? '#fff' : '#000' }}
                  >
                    <Picker.Item label={formData.city ? 'Select Barangay' : 'Select City First'} value="" />
                    {formData.barangay && !filteredBarangays.some(brgy => brgy.barangay === formData.barangay) && (
                      <Picker.Item label={formData.barangay} value={formData.barangay} />
                    )}
                    {filteredBarangays.map((barangay) => (
                      <Picker.Item key={barangay.id} label={barangay.barangay} value={barangay.barangay} />
                    ))}
                  </Picker>
                </View>
                {errors.barangay && <Text className="text-red-500 text-xs mt-1">{errors.barangay}</Text>}
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Location<Text className="text-red-500">*</Text>
                </Text>
                <View className={`border ${errors.location ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'} ${!formData.barangay ? 'opacity-50' : ''}`}>
                  <Picker
                    selectedValue={formData.location}
                    onValueChange={(value) => handleInputChange('location', value)}
                    enabled={!!formData.barangay}
                    style={{ color: isDarkMode ? '#fff' : '#000' }}
                  >
                    <Picker.Item label={formData.barangay ? 'Select Location' : 'Select Barangay First'} value="" />
                    {formData.location && !filteredLocations.some(loc => loc.location_name === formData.location) && (
                      <Picker.Item label={formData.location} value={formData.location} />
                    )}
                    {filteredLocations.map((location) => (
                      <Picker.Item key={location.id} label={location.location_name} value={location.location_name} />
                    ))}
                  </Picker>
                </View>
                {errors.location && <Text className="text-red-500 text-xs mt-1">{errors.location}</Text>}
              </View>

              {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && (
                <View className="mb-4">
                  <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                    Address Coordinates<Text className="text-red-500">*</Text>
                  </Text>
                  <View className="relative">
                    <TextInput
                      value={formData.addressCoordinates}
                      onChangeText={(text) => handleInputChange('addressCoordinates', text)}
                      placeholder="14.466580, 121.201807"
                      className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.addressCoordinates ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded pr-10`}
                    />
                    <MapPin className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} size={20} />
                  </View>
                  {errors.addressCoordinates && (
                    <View className="flex flex-row items-center mt-1">
                      <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                        <Text className="text-white text-xs">!</Text>
                      </View>
                      <Text className="text-orange-500 text-xs">This entry is required</Text>
                    </View>
                  )}
                </View>
              )}

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Choose Plan<Text className="text-red-500">*</Text>
                </Text>
                <View className={`border ${errors.choosePlan ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                  <Picker
                    selectedValue={formData.choosePlan}
                    onValueChange={(value) => handleInputChange('choosePlan', value)}
                    style={{ color: isDarkMode ? '#fff' : '#000' }}
                  >
                    <Picker.Item label="Select Plan" value="" />
                    {formData.choosePlan && !plans.some(plan => {
                      const planWithPrice = plan.price ? `${plan.name} - P${plan.price}` : plan.name;
                      return planWithPrice === formData.choosePlan || plan.name === formData.choosePlan;
                    }) && (
                        <Picker.Item label={formData.choosePlan} value={formData.choosePlan} />
                      )}
                    {plans.map((plan) => {
                      const planWithPrice = plan.price ? `${plan.name} - P${plan.price}` : plan.name;
                      return (
                        <Picker.Item key={plan.id} label={planWithPrice} value={planWithPrice} />
                      );
                    })}
                  </Picker>
                </View>
                {errors.choosePlan && <Text className="text-red-500 text-xs mt-1">{errors.choosePlan}</Text>}
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Status<Text className="text-red-500">*</Text>
                </Text>
                <View className={`border ${errors.status ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                  <Picker
                    selectedValue={formData.status}
                    onValueChange={(value) => handleInputChange('status', value)}
                    style={{ color: isDarkMode ? '#fff' : '#000' }}
                  >
                    <Picker.Item label="Confirmed" value="Confirmed" />
                    <Picker.Item label="For Confirmation" value="For Confirmation" />
                    <Picker.Item label="Cancelled" value="Cancelled" />
                  </Picker>
                </View>
                {errors.status && <Text className="text-red-500 text-xs mt-1">{errors.status}</Text>}
              </View>

              {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && (
                <>
                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      Connection Type<Text className="text-red-500">*</Text>
                    </Text>
                    <View className="flex flex-row gap-2">
                      <Pressable onPress={() => handleInputChange('connectionType', 'Antenna')} className={`flex-1 py-2 px-4 rounded border ${formData.connectionType === 'Antenna' ? 'bg-orange-600 border-orange-700' : isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                        <Text className={formData.connectionType === 'Antenna' ? 'text-white text-center' : isDarkMode ? 'text-white text-center' : 'text-gray-900 text-center'}>Antenna</Text>
                      </Pressable>
                      <Pressable onPress={() => handleInputChange('connectionType', 'Fiber')} className={`flex-1 py-2 px-4 rounded border ${formData.connectionType === 'Fiber' ? 'bg-orange-600 border-orange-700' : isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                        <Text className={formData.connectionType === 'Fiber' ? 'text-white text-center' : isDarkMode ? 'text-white text-center' : 'text-gray-900 text-center'}>Fiber</Text>
                      </Pressable>
                      <Pressable onPress={() => handleInputChange('connectionType', 'Local')} className={`flex-1 py-2 px-4 rounded border ${formData.connectionType === 'Local' ? 'bg-orange-600 border-orange-700' : isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                        <Text className={formData.connectionType === 'Local' ? 'text-white text-center' : isDarkMode ? 'text-white text-center' : 'text-gray-900 text-center'}>Local</Text>
                      </Pressable>
                    </View>
                    {errors.connectionType && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      Router Model<Text className="text-red-500">*</Text>
                    </Text>
                    <View className={`border ${errors.routerModel ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                      <Picker
                        selectedValue={formData.routerModel}
                        onValueChange={(value) => handleInputChange('routerModel', value)}
                        style={{ color: isDarkMode ? '#fff' : '#000' }}
                      >
                        <Picker.Item label="Select Router Model" value="" />
                        {formData.routerModel && !routerModels.some(rm => rm.model === formData.routerModel) && (
                          <Picker.Item label={formData.routerModel} value={formData.routerModel} />
                        )}
                        {routerModels.map((routerModel, index) => (
                          <Picker.Item key={index} label={routerModel.model} value={routerModel.model} />
                        ))}
                      </Picker>
                    </View>
                    {errors.routerModel && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      Modem SN<Text className="text-red-500">*</Text>
                    </Text>
                    <TextInput
                      value={formData.modemSN}
                      onChangeText={(text) => handleInputChange('modemSN', text)}
                      className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.modemSN ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                    />
                    {errors.modemSN && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>

                  {formData.connectionType === 'Antenna' && (
                    <View className="mb-4">
                      <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                        IP<Text className="text-red-500">*</Text>
                      </Text>
                      <TextInput
                        value={formData.ip}
                        onChangeText={(text) => handleInputChange('ip', text)}
                        className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.ip ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                      />
                      {errors.ip && (
                        <View className="flex flex-row items-center mt-1">
                          <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                            <Text className="text-white text-xs">!</Text>
                          </View>
                          <Text className="text-orange-500 text-xs">This entry is required</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {(formData.connectionType === 'Antenna' || formData.connectionType === 'Local') && (
                    <ImagePreview
                      imageUrl={imagePreviews.portLabelImage}
                      label="Port Label Image"
                      onUpload={(file) => handleImageUpload('portLabelImage', file)}
                      error={errors.portLabelImage}
                    />
                  )}
                </>
              )}



              {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && formData.connectionType === 'Fiber' && (
                <>
                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      LCP-NAP<Text className="text-red-500">*</Text>
                    </Text>
                    <View className={`border ${errors.lcpnap ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                      <Picker
                        selectedValue={formData.lcpnap}
                        onValueChange={(value) => handleInputChange('lcpnap', value)}
                        style={{ color: isDarkMode ? '#fff' : '#000' }}
                      >
                        <Picker.Item label="Select LCP-NAP" value="" />
                        {formData.lcpnap && !lcpnaps.some(ln => ln.lcpnap_name === formData.lcpnap) && (
                          <Picker.Item label={formData.lcpnap} value={formData.lcpnap} />
                        )}
                        {lcpnaps.map((lcpnap) => (
                          <Picker.Item key={lcpnap.id} label={lcpnap.lcpnap_name} value={lcpnap.lcpnap_name} />
                        ))}
                      </Picker>
                    </View>
                    {errors.lcpnap && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      PORT<Text className="text-red-500">*</Text>
                    </Text>
                    <View className={`border ${errors.port ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                      <Picker
                        selectedValue={formData.port}
                        onValueChange={(value) => handleInputChange('port', value)}
                        style={{ color: isDarkMode ? '#fff' : '#000' }}
                      >
                        <Picker.Item label="Select PORT" value="" />
                        {formData.port &&
                          formData.port.trim().toLowerCase() !== 'undefined' &&
                          formData.port.trim().toLowerCase() !== 'null' &&
                          !Array.from({ length: portTotal }).some((_, i) => `p${(i + 1).toString().padStart(2, '0')}` === formData.port) && (
                            <Picker.Item label={formData.port} value={formData.port} />
                          )}
                        {Array.from({ length: portTotal }, (_, i) => {
                          const portVal = `p${(i + 1).toString().padStart(2, '0')}`;
                          return (
                            <Picker.Item key={portVal} label={portVal} value={portVal} />
                          );
                        })}
                      </Picker>
                    </View>
                    {errors.port && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      VLAN<Text className="text-red-500">*</Text>
                    </Text>
                    <View className={`border ${errors.vlan ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                      <Picker
                        selectedValue={formData.vlan}
                        onValueChange={(value) => handleInputChange('vlan', value)}
                        style={{ color: isDarkMode ? '#fff' : '#000' }}
                      >
                        <Picker.Item label="Select VLAN" value="" />
                        {formData.vlan && !vlans.some(v => v.value.toString() === formData.vlan) && (
                          <Picker.Item label={formData.vlan} value={formData.vlan} />
                        )}
                        {vlans.map((vlan) => (
                          <Picker.Item key={vlan.vlan_id} label={vlan.value.toString()} value={vlan.value.toString()} />
                        ))}
                      </Picker>
                    </View>
                    {errors.vlan && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>
                </>
              )}

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Username<Text className="text-red-500">*</Text>
                </Text>
                <TextInput
                  value={formData.username}
                  onChangeText={(text) => handleInputChange('username', text)}
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.username ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                />
                {errors.username && <Text className="text-red-500 text-xs mt-1">{errors.username}</Text>}
              </View>

              {formData.status === 'Confirmed' && (formData.onsiteStatus === 'Done' || formData.onsiteStatus === 'Reschedule') && (
                <>
                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      Visit By<Text className="text-red-500">*</Text>
                    </Text>
                    <View className={`border ${errors.visit_by ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                      <Picker
                        selectedValue={formData.visit_by}
                        onValueChange={(value) => handleInputChange('visit_by', value)}
                        style={{ color: isDarkMode ? '#fff' : '#000' }}
                      >
                        <Picker.Item label="Select Visit By" value="" />
                        {formData.visit_by && !technicians.some(t => t.name === formData.visit_by) && (
                          <Picker.Item label={formData.visit_by} value={formData.visit_by} />
                        )}
                        {technicians.filter(t => t.name !== formData.visit_with && t.name !== formData.visit_with_other).map((technician, index) => (
                          <Picker.Item key={index} label={technician.name} value={technician.name} />
                        ))}
                      </Picker>
                    </View>
                    {errors.visit_by && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      Visit With<Text className="text-red-500">*</Text>
                    </Text>
                    <View className={`border ${errors.visit_with ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                      <Picker
                        selectedValue={formData.visit_with}
                        onValueChange={(value) => handleInputChange('visit_with', value)}
                        style={{ color: isDarkMode ? '#fff' : '#000' }}
                      >
                        <Picker.Item label="Select Visit With" value="" />
                        <Picker.Item label="None" value="None" />
                        {formData.visit_with && !technicians.some(t => t.name === formData.visit_with) && (
                          <Picker.Item label={formData.visit_with} value={formData.visit_with} />
                        )}
                        {technicians.filter(t => t.name !== formData.visit_by && t.name !== formData.visit_with_other).map((technician, index) => (
                          <Picker.Item key={index} label={technician.name} value={technician.name} />
                        ))}
                      </Picker>
                    </View>
                    {errors.visit_with && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      Visit With(Other)<Text className="text-red-500">*</Text>
                    </Text>
                    <View className={`border ${errors.visit_with_other ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                      <Picker
                        selectedValue={formData.visit_with_other}
                        onValueChange={(value) => handleInputChange('visit_with_other', value)}
                        style={{ color: isDarkMode ? '#fff' : '#000' }}
                      >
                        <Picker.Item label="Visit With(Other)" value="" />
                        <Picker.Item label="None" value="None" />
                        {formData.visit_with_other && !technicians.some(t => t.name === formData.visit_with_other) && (
                          <Picker.Item label={formData.visit_with_other} value={formData.visit_with_other} />
                        )}
                        {technicians.filter(t => t.name !== formData.visit_by && t.name !== formData.visit_with).map((technician, index) => (
                          <Picker.Item key={index} label={technician.name} value={technician.name} />
                        ))}
                      </Picker>
                    </View>
                    {errors.visit_with_other && (
                      <View className="flex flex-row items-center mt-1">
                        <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                          <Text className="text-white text-xs">!</Text>
                        </View>
                        <Text className="text-orange-500 text-xs">This entry is required</Text>
                      </View>
                    )}
                  </View>
                </>
              )}

              {formData.status === 'Confirmed' && (
                <>
                  <View className="mb-4">
                    <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                      Onsite Status<Text className="text-red-500">*</Text>
                    </Text>
                    <View className={`border ${errors.onsiteStatus ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                      <Picker
                        selectedValue={formData.onsiteStatus}
                        onValueChange={(value) => handleInputChange('onsiteStatus', value)}
                        style={{ color: isDarkMode ? '#fff' : '#000' }}
                      >
                        <Picker.Item label="In Progress" value="In Progress" />
                        <Picker.Item label="Done" value="Done" />
                        <Picker.Item label="Failed" value="Failed" />
                        <Picker.Item label="Reschedule" value="Reschedule" />
                      </Picker>
                    </View>
                    {errors.onsiteStatus && <Text className="text-red-500 text-xs mt-1">{errors.onsiteStatus}</Text>}
                  </View>

                  {(formData.onsiteStatus === 'Reschedule' || formData.onsiteStatus === 'Done') && (
                    <View className="mb-4">
                      <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                        Onsite Remarks<Text className="text-red-500">*</Text>
                      </Text>
                      <TextInput
                        value={formData.onsiteRemarks}
                        onChangeText={(text) => handleInputChange('onsiteRemarks', text)}
                        multiline
                        numberOfLines={3}
                        className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} border ${errors.onsiteRemarks ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded`}
                      />
                      {errors.onsiteRemarks && (
                        <View className="flex flex-row items-center mt-1">
                          <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                            <Text className="text-white text-xs">!</Text>
                          </View>
                          <Text className="text-orange-500 text-xs">This entry is required</Text>
                        </View>
                      )}
                    </View>
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

                  {formData.onsiteStatus === 'Reschedule' && (
                    <View className="mb-4">
                      <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                        Status Remarks<Text className="text-red-500">*</Text>
                      </Text>
                      <View className={`border ${errors.statusRemarks ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                        <Picker
                          selectedValue={formData.statusRemarks}
                          onValueChange={(value) => handleInputChange('statusRemarks', value)}
                          style={{ color: isDarkMode ? '#fff' : '#000' }}
                        >
                          <Picker.Item label="Select Status Remarks" value="" />
                          <Picker.Item label="Customer Request" value="Customer Request" />
                          <Picker.Item label="Bad Weather" value="Bad Weather" />
                          <Picker.Item label="Technician Unavailable" value="Technician Unavailable" />
                          <Picker.Item label="Equipment Issue" value="Equipment Issue" />
                        </Picker>
                      </View>
                      {errors.statusRemarks && (
                        <View className="flex flex-row items-center mt-1">
                          <View className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 mr-2">
                            <Text className="text-white text-xs">!</Text>
                          </View>
                          <Text className="text-orange-500 text-xs">This entry is required</Text>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Contract Template<Text className="text-red-500">*</Text>
                </Text>
                <View className="flex flex-row items-center space-x-2">
                  <Pressable onPress={() => handleNumberChange('contractTemplate', false)} className={`p-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'} border rounded`}>
                    <Minus size={16} color={isDarkMode ? 'white' : 'black'} />
                  </Pressable>
                  <TextInput
                    value={formData.contractTemplate}
                    editable={false}
                    className={`flex-1 px-3 py-2 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'} border rounded text-center`}
                  />
                  <Pressable onPress={() => handleNumberChange('contractTemplate', true)} className={`p-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'} border rounded`}>
                    <Plus size={16} color={isDarkMode ? 'white' : 'black'} />
                  </Pressable>
                </View>
                {errors.contractTemplate && <Text className="text-red-500 text-xs mt-1">{errors.contractTemplate}</Text>}
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Assigned Email<Text className="text-red-500">*</Text>
                </Text>
                <View className={`border ${errors.assignedEmail ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} rounded ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                  <Picker
                    selectedValue={formData.assignedEmail}
                    onValueChange={(value) => handleInputChange('assignedEmail', value)}
                    style={{ color: isDarkMode ? '#fff' : '#000' }}
                  >
                    <Picker.Item label="Select Assigned Email" value="" />
                    {formData.assignedEmail && !technicians.some(t => t.email === formData.assignedEmail) && (
                      <Picker.Item label={formData.assignedEmail} value={formData.assignedEmail} />
                    )}
                    {technicians.map((technician, index) => (
                      <Picker.Item key={index} label={technician.email} value={technician.email} />
                    ))}
                  </Picker>
                </View>
                {errors.assignedEmail && <Text className="text-red-500 text-xs mt-1">{errors.assignedEmail}</Text>}
              </View>

              <View className="mb-4">
                <Text className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>
                  Contract Link
                </Text>
                <TextInput
                  value={formData.contractLink}
                  onChangeText={(text) => handleInputChange('contractLink', text)}
                  className={`w-full px-3 py-2 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'} border rounded`}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      )}
    </>
  );
};

export default JobOrderDoneFormModal;
