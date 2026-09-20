import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar, ChevronLeft, Minus, Plus } from 'lucide-react-native';
import { createJobOrder, JobOrderData } from '../services/jobOrderService';
import { updateApplication } from '../services/applicationService';

import apiClient from '../config/api';
import { UserData } from '../types/api';
import { userService } from '../services/userService';
import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import SearchableField, { GroupedOption } from '../components/common/SearchableField';
import { agentService } from '../services/agentService';
import {
  buildAgentGroups,
  referredByFields,
  referredByForSave,
  selectionFromOption,
} from '../utils/referredByField';

interface JOAssignFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: JobOrderData) => void;
  onRefresh?: () => void;
  applicationData?: any;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface JOFormData {
  timestamp: string;

  status: string;
  // The agent's NAME, which is what the field shows. What gets stored is the id
  // in referredById — see utils/referredByField.ts.
  referredBy: string;
  referredById: number | null;
  firstName: string;
  middleInitial: string;
  lastName: string;
  contactNumber: string;
  email: string;
  address: string;
  barangay: string;
  city: string;
  region: string;
  choosePlan: string;
  promo: string;
  remarks: string;
  installationFee: number | string;
  billingDay: string;

  onsiteStatus: string;
  assignedEmail: string;
  modifiedBy: string;
  modifiedDate: string;
  installationLandmark: string;
}

const JOAssignFormModal: React.FC<JOAssignFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onRefresh,
  applicationData
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  // Which half of the timestamp is currently being picked.
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time' | null>(null);

  // Auth lives in AsyncStorage on RN, so the user is loaded after mount rather than
  // read synchronously during render the way the web build did.
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const currentUserEmail = currentUser?.email || '';

  useEffect(() => {
    AsyncStorage.getItem('authData')
      .then((authData) => {
        if (authData) setCurrentUser(JSON.parse(authData));
      })
      .catch((error) => console.error('Error getting current user:', error));
  }, []);

  const [formData, setFormData] = useState<JOFormData>({
    timestamp: (() => {
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const gmt8 = new Date(utc + (8 * 60 * 60 * 1000));
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${gmt8.getFullYear()}-${pad(gmt8.getMonth() + 1)}-${pad(gmt8.getDate())} ${pad(gmt8.getHours())}:${pad(gmt8.getMinutes())}:${pad(gmt8.getSeconds())}`;
    })(),

    status: 'Confirmed',
    referredBy: '',
    referredById: null,
    firstName: '',
    middleInitial: '',
    lastName: '',
    contactNumber: '',
    email: '',
    address: '',
    barangay: '',
    city: '',
    region: '',
    choosePlan: '',
    promo: '',
    remarks: '',
    installationFee: 0,
    billingDay: '',

    onsiteStatus: 'In Progress',
    assignedEmail: '',
    modifiedBy: currentUserEmail,
    modifiedDate: (() => {
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const gmt8 = new Date(utc + (8 * 60 * 60 * 1000));
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${gmt8.getFullYear()}-${pad(gmt8.getMonth() + 1)}-${pad(gmt8.getDate())} ${pad(gmt8.getHours())}:${pad(gmt8.getMinutes())}:${pad(gmt8.getSeconds())}`;
    })(),
    installationLandmark: ''
  });

  interface Region {
    id: number;
    name: string;
  }

  interface Plan {
    id: number;
    name: string;
    description?: string;
    price?: number;
  }

  interface Promo {
    id: number;
    promo_name: string;
    description?: string;
  }

  interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
  }

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [pendingJobOrder, setPendingJobOrder] = useState<any>(null);
  const hasInitializedRef = useRef(false);

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });


  const [regions, setRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [technicians, setTechnicians] = useState<Array<{ email: string; name: string }>>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);


  // RN has no document/MutationObserver — read the stored theme once on mount.
  useEffect(() => {
    AsyncStorage.getItem('theme')
      .then((theme) => setIsDarkMode(theme === 'dark' || theme === null))
      .catch(() => { });
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
              .filter((tech: any) => tech.name && tech.email);
            setTechnicians(technicianList);
          }
        } catch (error) {
          setTechnicians([]);
        }
      }
    };

    fetchTechnicians();
  }, [isOpen]);

  useEffect(() => {
    const fetchAgents = async () => {
      if (isOpen) {
        try {
          // Use role_id 4 or name 'agent' as requested
          const response = await userService.getUsersByRole('agent');
          if (response.success && response.data) {
            setAgents(response.data);
          } else {
            // Fallback to role ID 4 if 'agent' name doesn't return anything
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
    const fetchTeams = async () => {
      if (isOpen) {
        try {
          const response = await agentService.getAllAgents();
          if (response.success && response.data) {
            setTeams(response.data);
          }
        } catch (error) {
          console.error('Failed to fetch teams:', error);
          setTeams([]);
        }
      }
    };

    fetchTeams();
  }, [isOpen]);





  useEffect(() => {
    const loadPlans = async () => {
      if (isOpen) {
        try {
          const response = await apiClient.get<ApiResponse<Plan[]> | Plan[]>('/plans');
          const data = response.data;

          if (data && typeof data === 'object' && 'success' in data && data.success && Array.isArray(data.data)) {
            setPlans(data.data);
          } else if (Array.isArray(data)) {
            setPlans(data);
          } else {
            setPlans([]);
          }
        } catch (error) {
          setPlans([]);
        }
      }
    };

    loadPlans();
  }, [isOpen]);

  useEffect(() => {
    const loadPromos = async () => {
      if (isOpen) {
        try {
          const response = await apiClient.get<ApiResponse<Promo[]> | Promo[]>('/promos');
          const data = response.data;

          if (data && typeof data === 'object' && 'success' in data && data.success && Array.isArray(data.data)) {
            setPromos(data.data);
          } else if (Array.isArray(data)) {
            setPromos(data);
          } else {
            setPromos([]);
          }
        } catch (error) {
          setPromos([]);
        }
      }
    };

    loadPromos();
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
          setAllBarangays([]);
        }
      }
    };

    fetchAllBarangays();
  }, [isOpen]);



  // Reset initialization flag when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasInitializedRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (applicationData && isOpen && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      setFormData(prev => ({
        ...prev,
        // Only the stored value and the id inside it. The name is filled in by
        // the effect below once the agent list has loaded — reading `agents`
        // here would make it a dependency of this whole prefill, and a late
        // agent list would then reset every field the user had already typed.
        ...referredByFields(applicationData, []),
        firstName: applicationData.first_name || '',
        middleInitial: applicationData.middle_initial || '',
        lastName: applicationData.last_name || '',
        contactNumber: applicationData.mobile_number || '',
        email: applicationData.email_address || '',
        address: applicationData.installation_address || '',
        barangay: applicationData.barangay || '',
        city: applicationData.city || '',
        region: applicationData.region || '',
        choosePlan: applicationData.desired_plan || '',
        promo: applicationData.promo || '',
        installationLandmark: applicationData.landmark || ''
      }));
    }
  }, [isOpen, applicationData]);

  const hasPlanNormalizedRef = useRef(false);

  // Reset plan normalization flag when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasPlanNormalizedRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (applicationData && isOpen && plans.length > 0 && !hasPlanNormalizedRef.current) {
      hasPlanNormalizedRef.current = true;
      const initialPlan = applicationData.desired_plan;
      if (initialPlan) {
        const normalize = (s: string) => s.replace(/\.00/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().replace(/p(\d+)/g, '$1');
        const initialNormalized = normalize(initialPlan);

        const matchedPlan = plans.find(plan => {
          const planWithPrice = plan.price ? `${plan.name} - P${plan.price}` : plan.name;
          return normalize(planWithPrice) === initialNormalized || normalize(plan.name) === initialNormalized;
        });

        if (matchedPlan) {
          const correctPlanStr = matchedPlan.price ? `${matchedPlan.name} - P${matchedPlan.price}` : matchedPlan.name;
          setFormData(prev => {
            if (prev.choosePlan === initialPlan && prev.choosePlan !== correctPlanStr) {
              return { ...prev, choosePlan: correctPlanStr };
            }
            return prev;
          });
        }
      }
    }
  }, [plans, applicationData, isOpen]);

  /**
   * Keep the agent's name on screen and their id in the form.
   *
   * SearchableField hands over the option it rendered, so the id comes from the
   * row that was clicked rather than being looked back up by name — which is
   * what keeps two agents sharing a name distinct.
   */
  const handleReferredBySelect = (label: string, option?: any) => {
    const selection = selectionFromOption(label, option);
    setFormData(prev => ({
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
  const referredByRaw = applicationData?.referred_by ?? '';
  const referredByAgentIdProp = applicationData?.referred_by_agent_id ?? null;

  useEffect(() => {
    if (!isOpen || !agents.length) return;

    setFormData(prev => {
      if (prev.referredBy !== String(referredByRaw ?? '')) return prev;

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
  }, [isOpen, agents, referredByRaw, referredByAgentIdProp]);

  const handleInputChange = (field: keyof JOFormData, value: string | number | boolean) => {
    if (field === 'middleInitial' && typeof value === 'string') {
      value = value.replace(/[0-9]/g, '');
    }

    if (field === 'billingDay') {
      const numValue = parseInt(value as string);
      if (!isNaN(numValue) && numValue > 30) {
        // If user tries to type > 30, keep the previous value or do nothing if this is direct input
        // However, since we are in the handler, preventing the update is sufficient
        return;
      }
    }

    setFormData(prev => {
      const newData = { ...prev, [field]: value };



      if (field === 'region') {
        newData.city = '';
        newData.barangay = '';
      } else if (field === 'city') {
        newData.barangay = '';
      }

      return newData;
    });
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
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

  const handleNumberChange = (field: 'installationFee' | 'billingDay', increment: boolean) => {
    setFormData(prev => {
      if (field === 'installationFee') {
        const currentVal = Number(prev[field]) || 0;
        return {
          ...prev,
          [field]: increment ? currentVal + 0.01 : Math.max(0, currentVal - 0.01)
        };
      } else {
        const currentValue = parseInt(prev[field]) || 1;
        const newValue = increment ? Math.min(30, currentValue + 1) : Math.max(1, currentValue - 1);
        return {
          ...prev,
          [field]: newValue.toString()
        };
      }
    });
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.timestamp.trim()) {
      newErrors.timestamp = 'Timestamp is required';
    }



    if (!formData.status.trim()) {
      newErrors.status = 'Status is required';
    }

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First Name is required';
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last Name is required';
    }

    if (!formData.contactNumber.trim()) {
      newErrors.contactNumber = 'Contact Number is required';
    } else if (!/^[0-9+\-\s()]+$/.test(formData.contactNumber.trim())) {
      newErrors.contactNumber = 'Please enter a valid contact number';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.address.trim()) {
      newErrors.address = 'Address is required';
    }

    if (!formData.region.trim()) {
      newErrors.region = 'Region is required';
    }

    if (!formData.city.trim()) {
      newErrors.city = 'City is required';
    }

    if (!formData.barangay.trim()) {
      newErrors.barangay = 'Barangay is required';
    }

    if (!formData.choosePlan.trim()) {
      newErrors.choosePlan = 'Choose Plan is required';
    }

    if (Number(formData.installationFee) < 0) {
      newErrors.installationFee = 'Installation fee cannot be negative';
    }



    const billingDayNum = parseInt(formData.billingDay);
    if (isNaN(billingDayNum) || billingDayNum < 1) {
      newErrors.billingDay = 'Billing Day must be at least 1';
    } else if (billingDayNum > 30) {
      newErrors.billingDay = 'Billing Day cannot exceed 30';
    }

    if (formData.status === 'Confirmed') {
      if (!formData.onsiteStatus.trim()) {
        newErrors.onsiteStatus = 'Onsite Status is required when status is Confirmed';
      }

      if (formData.onsiteStatus !== 'Failed' && !formData.assignedEmail.trim()) {
        newErrors.assignedEmail = 'Assigned To is required when onsite status is not Failed';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const mapFormDataToJobOrder = (applicationId: string, data: JOFormData = formData): any => {
    const toNullIfEmpty = (value: string | number | undefined): string | null => {
      if (value === undefined || value === null || value === '' || value === 'None' || value === 'All') {
        return null;
      }
      return String(value);
    };

    const getGmt8Timestamp = (date: Date) => {
      const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
      const gmt8 = new Date(utc + (8 * 60 * 60 * 1000));
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${gmt8.getFullYear()}-${pad(gmt8.getMonth() + 1)}-${pad(gmt8.getDate())} ${pad(gmt8.getHours())}:${pad(gmt8.getMinutes())}:${pad(gmt8.getSeconds())}`;
    };

    const currentTimestamp = getGmt8Timestamp(new Date());
    const formattedTimestamp = data.timestamp ?
      getGmt8Timestamp(new Date(data.timestamp)) :
      currentTimestamp;

    return {
      application_id: applicationId,
      timestamp: formattedTimestamp,
      installation_fee: Number(data.installationFee) || 0,
      billing_day: parseInt(data.billingDay) || 30,
      billing_status: 'In Progress',
      modem_router_sn: null,
      onsite_status: data.onsiteStatus || 'In Progress',
      assigned_email: toNullIfEmpty(data.assignedEmail),
      onsite_remarks: toNullIfEmpty(data.remarks),
      contract_link: null,
      username: null,
      group_name: null,
      house_front_picture_url: applicationData?.house_front_picture_url || null,
      installation_landmark: toNullIfEmpty(data.installationLandmark),
      referred_by: referredByForSave(
        { label: data.referredBy, agentId: data.referredById },
        agents
      ),
      organization_id: (currentUser as any)?.organization_id ?? null,
      created_by_user_email: data.modifiedBy || currentUserEmail,
      updated_by_user_email: data.modifiedBy || currentUserEmail,
    };
  };

  const handleSave = async () => {
    const updatedFormData = {
      ...formData,
      modifiedBy: currentUserEmail,
      updated_by: currentUserEmail,
      modifiedDate: (() => {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const gmt8 = new Date(utc + (8 * 60 * 60 * 1000));
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${gmt8.getFullYear()}-${pad(gmt8.getMonth() + 1)}-${pad(gmt8.getDate())} ${pad(gmt8.getHours())}:${pad(gmt8.getMinutes())}:${pad(gmt8.getSeconds())}`;
      })()
    };

    setFormData(updatedFormData);

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

    if (!applicationData?.id && !applicationData?.application_id) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: 'Missing application ID. Cannot create job order.'
      });
      return;
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
      const appId = applicationData?.id || applicationData?.application_id;
      const jobOrderData = mapFormDataToJobOrder(appId, updatedFormData);
      const result = await createJobOrder(jobOrderData);

      if (!result.success) {
        throw new Error(result.message || 'Failed to create job order');
      }

      try {
        const applicationUpdateData: any = {
          referred_by: referredByForSave(
            { label: updatedFormData.referredBy, agentId: updatedFormData.referredById },
            agents
          ),
          first_name: updatedFormData.firstName || null,
          middle_initial: updatedFormData.middleInitial || null,
          last_name: updatedFormData.lastName || null,
          mobile_number: updatedFormData.contactNumber || null,
          email_address: updatedFormData.email || null,
          installation_address: updatedFormData.address || null,
          landmark: updatedFormData.installationLandmark || null,
          region: updatedFormData.region || null,
          city: updatedFormData.city || null,
          barangay: updatedFormData.barangay || null,
          desired_plan: updatedFormData.choosePlan || null,
          promo: updatedFormData.promo || null,
          status: 'Scheduled',
          updated_by: currentUserEmail
        };

        await updateApplication(appId.toString(), applicationUpdateData);
      } catch (appError: any) {
        // Silently log promo update failures to avoid blocking the user
        // with the "Partial Success" modal, as the Job Order itself was created.
        console.error('Application promo update failed:', appError);
      }

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      if (onRefresh) {
        onRefresh();
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      setPendingJobOrder(result.data);
      setErrors({});
      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'Job Order created successfully!',
        onConfirm: () => {
          onSave(pendingJobOrder!);
          setPendingJobOrder(null);
          onClose();
          setModal({ ...modal, isOpen: false });
        }
      });
    } catch (error: any) {
      let errorMessage = 'Unknown error occurred';

      if (error.response?.data?.errors) {
        const validationErrors = error.response.data.errors;
        const errorDetails = Object.entries(validationErrors)
          .map(([field, messages]: [string, any]) => {
            const messageArray = Array.isArray(messages) ? messages : [messages];
            return `${field}: ${messageArray.join(', ')}`;
          })
          .join('\n');
        errorMessage = `Validation failed:\n${errorDetails}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      clearInterval(progressInterval);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Failed to Create Job Order',
        message: `Failed to create job order: ${errorMessage}`
      });
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const handleCancel = () => {
    onClose();
  };

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
    return allBarangays.filter(brgy => brgy.city_id !== undefined && brgy.city_id === selectedCity.id);
  };

  const getGroupedAgents = (): GroupedOption[] => buildAgentGroups(agents, teams);

  const filteredCities = getFilteredCities();
  const filteredBarangays = getFilteredBarangays();
  const groupedAgents = getGroupedAgents();

  if (!isOpen) return null;

  const activeColor = colorPalette?.primary || '#7c3aed';
  const inputBg = isDarkMode ? '#1f2937' : '#ffffff';
  const inputText = isDarkMode ? '#ffffff' : '#111827';
  const borderFor = (field: string) => (errors[field] ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'));

  /** `YYYY-MM-DDTHH:mm` — the datetime-local shape the payload and API expect. */
  const formatLocalDateTime = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const parseLocalDateTime = (value: string) => {
    const parsed = value ? new Date(value) : new Date();
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  };

  const onTimestampPicked = (event: any, picked?: Date) => {
    if (event?.type !== 'set' || !picked) {
      setDatePickerMode(null);
      return;
    }
    const current = parseLocalDateTime(formData.timestamp);
    if (datePickerMode === 'date') {
      current.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      handleInputChange('timestamp', formatLocalDateTime(current));
      // Chain straight into the time step so one tap sets the whole timestamp.
      setDatePickerMode('time');
      return;
    }
    current.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    handleInputChange('timestamp', formatLocalDateTime(current));
    setDatePickerMode(null);
  };

  const renderInput = (
    field: string,
    label: string,
    required: boolean = false,
    options: { multiline?: boolean; maxLength?: number; keyboardType?: any; readOnly?: boolean; placeholder?: string; onChange?: (t: string) => void } = {}
  ) => (
    <View style={jf.fieldGroup} key={field}>
      <Text style={[jf.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
        {label}{required && <Text style={jf.required}>*</Text>}
      </Text>
      <TextInput
        value={String((formData as any)[field] ?? '')}
        onChangeText={options.onChange || ((text) => handleInputChange(field as any, text))}
        editable={!options.readOnly}
        multiline={options.multiline}
        maxLength={options.maxLength}
        keyboardType={options.keyboardType}
        placeholder={options.placeholder}
        placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
        textAlignVertical={options.multiline ? 'top' : 'center'}
        style={[jf.input, {
          backgroundColor: options.readOnly ? (isDarkMode ? '#374151' : '#f3f4f6') : inputBg,
          borderColor: borderFor(field),
          color: options.readOnly ? (isDarkMode ? '#9ca3af' : '#6b7280') : inputText,
          minHeight: options.multiline ? 84 : 44,
        }]}
      />
      {errors[field] ? <Text style={jf.errorText}>{errors[field]}</Text> : null}
    </View>
  );

  // Option lists for the SearchableField dropdowns. `name` is what the list shows;
  // where the stored value differs from the label (promos carry a description) the
  // option also carries `value`, which the onSelect handler prefers.
  const statusOptions = [
    { name: 'Confirmed' },
    { name: 'For Confirmation' },
    { name: 'Cancelled' },
  ];

  const onsiteStatusOptions = [
    { name: 'In Progress' },
    { name: 'Done' },
    { name: 'Failed' },
    { name: 'Reschedule' },
  ];

  const planOptions = (() => {
    const normalize = (s: string) => s.replace(/\.00/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().replace(/p(\d+)/g, '$1');
    const list = plans.map((plan) => {
      const planWithPrice = plan.price ? `${plan.name} - P${plan.price}` : plan.name;
      return { name: planWithPrice };
    });
    const current = formData.choosePlan;
    const alreadyListed = plans.some((plan) => {
      const planWithPrice = plan.price ? `${plan.name} - P${plan.price}` : plan.name;
      return normalize(planWithPrice) === normalize(current || '') || normalize(plan.name) === normalize(current || '');
    });
    return current && !alreadyListed ? [{ name: current }, ...list] : list;
  })();

  const promoOptions = (() => {
    const list: { name: string; value: string }[] = [{ name: 'None', value: 'None' }].concat(
      promos.map((p) => ({
        name: p.description ? `${p.promo_name} - ${p.description}` : p.promo_name,
        value: p.promo_name,
      }))
    );
    const current = formData.promo;
    return current && current !== 'None' && !promos.some((p) => p.promo_name === current)
      ? [{ name: current, value: current }, ...list]
      : list;
  })();

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={handleCancel}>
      <View style={[jf.container, { backgroundColor: isDarkMode ? '#111827' : '#f9fafb' }]}>
        <View style={[jf.header, {
          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
          borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb'
        }]}>
          <Pressable onPress={handleCancel} disabled={loading} style={jf.headerBack}>
            <ChevronLeft size={26} color={activeColor} />
          </Pressable>
          <Text style={[jf.headerTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]} numberOfLines={1}>
            JO Assign Form
          </Text>
          <Pressable
            onPress={handleSave}
            disabled={loading}
            style={[jf.saveBtn, { backgroundColor: loading ? '#9ca3af' : activeColor }]}
          >
            {loading
              ? <ActivityIndicator size="small" color="#ffffff" />
              : <Text style={jf.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={jf.body} keyboardShouldPersistTaps="handled">
            {/* Timestamp */}
            <View style={jf.fieldGroup}>
              <Text style={[jf.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                Timestamp<Text style={jf.required}>*</Text>
              </Text>
              <Pressable
                onPress={() => setDatePickerMode('date')}
                style={[jf.input, jf.selectTrigger, { backgroundColor: inputBg, borderColor: borderFor('timestamp') }]}
              >
                <Text style={{ flex: 1, fontSize: 14, color: formData.timestamp ? inputText : (isDarkMode ? '#6b7280' : '#9ca3af') }}>
                  {formData.timestamp ? formData.timestamp.replace('T', ' ') : 'Select date and time'}
                </Text>
                <Calendar size={18} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
              </Pressable>
              {errors.timestamp ? <Text style={jf.errorText}>{errors.timestamp}</Text> : null}
            </View>

            <SearchableField
              label="Status"
              value={formData.status}
              onSelect={(val) => handleInputChange('status', val)}
              options={statusOptions}
              optionLabelKey="name"
              isDarkMode={isDarkMode}
              error={errors.status}
              required
              placeholder="Select Status"
            />

            {/*
              Team names are group headings here, not choices. A referral has to
              name one agent: referred_by is what the commission is settled
              against when the job order is approved, and a team name matches no
              agent, so it would silently leave the referral unpaid. Teams stay
              searchable — typing one still lists its members to pick from.
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
              emptyMessage="No data of agents available"
            />

            {renderInput('firstName', 'First Name', true)}
            {renderInput('middleInitial', 'Middle Initial', false, {
              maxLength: 1,
              onChange: (text) => handleInputChange('middleInitial', text.replace(/[0-9]/g, '')),
            })}
            {renderInput('lastName', 'Last Name', true)}
            {renderInput('contactNumber', 'Contact Number', true, { keyboardType: 'phone-pad' })}
            {renderInput('email', 'Applicant Email Address', true, { keyboardType: 'email-address' })}
            {renderInput('address', 'Address', true)}

            <SearchableField
              label="Region"
              value={formData.region}
              onSelect={(val) => handleInputChange('region', val)}
              options={regions}
              optionLabelKey="name"
              isDarkMode={isDarkMode}
              error={errors.region}
              required
              placeholder="Select Region"
            />

            <SearchableField
              label="City"
              value={formData.city}
              onSelect={(val) => handleInputChange('city', val)}
              options={filteredCities}
              optionLabelKey="name"
              isDarkMode={isDarkMode}
              error={errors.city}
              required
              placeholder={formData.region ? 'Select City' : 'Select Region First'}
            />

            <SearchableField
              label="Barangay"
              value={formData.barangay}
              onSelect={(val) => handleInputChange('barangay', val)}
              options={filteredBarangays}
              optionLabelKey="barangay"
              isDarkMode={isDarkMode}
              error={errors.barangay}
              required
              placeholder={formData.city ? 'Select Barangay' : 'Select City First'}
            />

            <SearchableField
              label="Choose Plan"
              value={formData.choosePlan}
              onSelect={(val) => handleInputChange('choosePlan', val)}
              options={planOptions}
              optionLabelKey="name"
              isDarkMode={isDarkMode}
              error={errors.choosePlan}
              required
              placeholder="Select Plan"
            />

            <SearchableField
              label="Promo"
              value={formData.promo}
              onSelect={(val, option) => handleInputChange('promo', option?.value || val)}
              options={promoOptions}
              optionLabelKey="name"
              isDarkMode={isDarkMode}
              placeholder="Select Promo"
            />

            {renderInput('remarks', 'Remarks', false, { multiline: true })}

            {/* Installation Fee */}
            <View style={jf.fieldGroup}>
              <Text style={[jf.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                Installation Fee<Text style={jf.required}>*</Text>
              </Text>
              <View style={[jf.input, jf.rowInput, { backgroundColor: inputBg, borderColor: borderFor('installationFee') }]}>
                <Text style={{ color: isDarkMode ? '#9ca3af' : '#4b5563', marginRight: 8 }}>₱</Text>
                <TextInput
                  value={String(formData.installationFee ?? '')}
                  onChangeText={handleInstallationFeeChange}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
                  style={{ flex: 1, fontSize: 14, color: inputText, padding: 0 }}
                />
              </View>
              {errors.installationFee ? <Text style={jf.errorText}>{errors.installationFee}</Text> : null}
            </View>

            {/* Billing Day */}
            <View style={jf.fieldGroup}>
              <Text style={[jf.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
                Billing Day<Text style={jf.required}>*</Text>
              </Text>
              <View style={[jf.input, jf.rowInput, { backgroundColor: inputBg, borderColor: borderFor('billingDay'), paddingRight: 0 }]}>
                <TextInput
                  value={String(formData.billingDay ?? '')}
                  onChangeText={(text) => handleInputChange('billingDay', text.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  style={{ flex: 1, fontSize: 14, color: inputText, padding: 0 }}
                />
                <Pressable
                  onPress={() => handleNumberChange('billingDay', false)}
                  style={[jf.stepperBtn, { borderLeftColor: isDarkMode ? '#374151' : '#d1d5db' }]}
                >
                  <Minus size={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
                <Pressable
                  onPress={() => handleNumberChange('billingDay', true)}
                  style={[jf.stepperBtn, { borderLeftColor: isDarkMode ? '#374151' : '#d1d5db' }]}
                >
                  <Plus size={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                </Pressable>
              </View>
              {errors.billingDay ? <Text style={jf.errorText}>{errors.billingDay}</Text> : null}
            </View>

            {formData.status === 'Confirmed' && (
              <SearchableField
                label="Onsite Status"
                value={formData.onsiteStatus}
                onSelect={(val) => handleInputChange('onsiteStatus', val)}
                options={onsiteStatusOptions}
                optionLabelKey="name"
                isDarkMode={isDarkMode}
                error={errors.onsiteStatus}
                required
                placeholder="Select Onsite Status"
              />
            )}

            {formData.status === 'Confirmed' && formData.onsiteStatus !== 'Failed' && (
              <SearchableField
                label="Assigned To"
                value={technicians.find(t => t.email === formData.assignedEmail)?.name || formData.assignedEmail}
                onSelect={(val, option) => handleInputChange('assignedEmail', option?.email || val)}
                options={technicians}
                optionLabelKey="name"
                isDarkMode={isDarkMode}
                error={errors.assignedEmail}
                required
                placeholder="Select Technician"
              />
            )}

            {renderInput('modifiedBy', 'Modified By', true, { readOnly: true })}
            {renderInput('modifiedDate', 'Modified Date', true, { readOnly: true })}
            {renderInput('installationLandmark', 'Installation Landmark')}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {datePickerMode && (
        <DateTimePicker
          value={parseLocalDateTime(formData.timestamp)}
          mode={datePickerMode}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onTimestampPicked}
        />
      )}

      {/* Status / progress dialog */}
      <Modal visible={modal.isOpen || loading} transparent animationType="fade" statusBarTranslucent>
        <View style={jf.statusOverlay}>
          <View style={[jf.statusCard, {
            backgroundColor: isDarkMode ? '#111827' : '#ffffff',
            borderColor: isDarkMode ? '#374151' : '#e5e7eb'
          }]}>
            {loading || modal.type === 'loading' ? (
              <View style={{ alignItems: 'center', gap: 16 }}>
                <ActivityIndicator size="large" color={activeColor} />
                <Text style={[jf.statusPercent, { color: isDarkMode ? '#ffffff' : '#111827' }]}>
                  {Math.round(loadingPercentage)}%
                </Text>
                {!!modal.message && (
                  <Text style={[jf.statusMessage, { color: isDarkMode ? '#9ca3af' : '#4b5563', textAlign: 'center' }]}>
                    {modal.message}
                  </Text>
                )}
              </View>
            ) : (
              <>
                <Text style={[jf.statusTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>{modal.title}</Text>
                <Text style={[jf.statusMessage, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>{modal.message}</Text>
                <View style={jf.statusActions}>
                  {modal.type === 'confirm' ? (
                    <>
                      <Pressable
                        onPress={modal.onCancel}
                        style={[jf.statusCancelBtn, { borderColor: isDarkMode ? '#4b5563' : '#d1d5db' }]}
                      >
                        <Text style={{ color: isDarkMode ? '#d1d5db' : '#374151', fontWeight: '500' }}>Cancel</Text>
                      </Pressable>
                      <Pressable onPress={modal.onConfirm} style={[jf.statusOkBtn, { backgroundColor: activeColor }]}>
                        <Text style={jf.statusOkText}>Confirm</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => {
                        if (modal.onConfirm) {
                          modal.onConfirm();
                        } else {
                          setModal({ ...modal, isOpen: false });
                        }
                      }}
                      style={[jf.statusOkBtn, { backgroundColor: activeColor }]}
                    >
                      <Text style={jf.statusOkText}>OK</Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

const jf = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerBack: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600' },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, minWidth: 72, alignItems: 'center' },
  saveBtnText: { color: '#ffffff', fontWeight: '600' },
  body: { padding: 16, paddingBottom: 80 },
  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  required: { color: '#ef4444' },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  selectTrigger: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  rowInput: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: 0 },
  stepperBtn: { paddingHorizontal: 14, paddingVertical: 12, borderLeftWidth: 1 },
  errorText: { color: '#ef4444', fontSize: 11, marginTop: 4 },
  statusOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  statusCard: { width: '100%', maxWidth: 420, borderRadius: 10, borderWidth: 1, padding: 24, gap: 12 },
  statusTitle: { fontSize: 17, fontWeight: '600' },
  statusMessage: { fontSize: 14, lineHeight: 20 },
  statusPercent: { fontSize: 34, fontWeight: '700' },
  statusActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  statusCancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, borderWidth: 1 },
  statusOkBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6 },
  statusOkText: { color: '#ffffff', fontWeight: '600' },
});

export default JOAssignFormModal;