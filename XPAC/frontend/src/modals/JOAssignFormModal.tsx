import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar, ChevronDown, Minus, Plus, Loader2 } from 'lucide-react';
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

  const getCurrentUser = (): UserData | null => {
    try {
      const authData = localStorage.getItem('authData');
      if (authData) {
        return JSON.parse(authData);
      }
    } catch (error) {
      return null;
    }
    return null;
  };

  const currentUser = getCurrentUser();
  const currentUserEmail = currentUser?.email || '';

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

      // Returning prev unchanged is what stops this looping: applicationData is
      // rebuilt by the parent on every render, and React bails out of a set that
      // produces the identical state.
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
      organization_id: currentUser?.organization_id ?? null,
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

  return (
    <>
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
          <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}>
            <Loader2
              className="w-20 h-20 animate-spin"
              style={{ color: colorPalette?.primary || '#7c3aed' }}
            />
            <div className="text-center">
              <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>{loadingPercentage}%</p>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
            }`}>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>JO Assign Form</h2>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleCancel}
                className={`px-4 py-2 rounded text-sm transition-colors ${isDarkMode
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
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={onClose}
                className={`transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                <X size={24} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Timestamp<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={formData.timestamp}
                    onChange={(e) => handleInputChange('timestamp', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                      ? 'bg-gray-800 text-white border-gray-700'
                      : 'bg-white text-gray-900 border-gray-300'
                      } ${errors.timestamp ? 'border-red-500' : ''}`}
                  />
                  <Calendar className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`} size={20} />
                </div>
                {errors.timestamp && <p className="text-red-500 text-xs mt-1">{errors.timestamp}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Status<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode
                      ? 'bg-gray-800 text-white border-gray-700'
                      : 'bg-white text-gray-900 border-gray-300'
                      } ${errors.status ? 'border-red-500' : ''}`}
                  >
                    <option value="" disabled>Select Status</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="For Confirmation">For Confirmation</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`} size={20} />
                </div>
                {errors.status && <p className="text-red-500 text-xs mt-1">{errors.status}</p>}
              </div>

              {/*
                Team names are group headings here, not choices. A referral has to
                name one agent: referred_by is what the commission is settled
                against when the job order is approved, and a team name matches no
                agent, so it would silently leave the referral unpaid. Teams stay
                searchable — typing one still lists its members to pick from.

                The name is what shows; the agent's id is what is stored, taken
                from the option that was clicked rather than looked back up by
                name — so two agents sharing a name stay distinct.
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

            </div>

            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  First Name<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    } ${errors.firstName ? 'border-red-500' : ''}`}
                />
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
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    }`}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Last Name<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    } ${errors.lastName ? 'border-red-500' : ''}`}
                />
                {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Contact Number<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.contactNumber}
                  onChange={(e) => handleInputChange('contactNumber', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    } ${errors.contactNumber ? 'border-red-500' : ''}`}
                />
                {errors.contactNumber && <p className="text-red-500 text-xs mt-1">{errors.contactNumber}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Applicant Email Address<span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    } ${errors.email ? 'border-red-500' : ''}`}
                />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Address<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => handleInputChange('address', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    } ${errors.address ? 'border-red-500' : ''}`}
                />
                {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
              </div>

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
                placeholder={formData.region ? "Select City" : "Select Region First"}
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
                placeholder={formData.city ? "Select Barangay" : "Select City First"}
              />


            </div>

            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Choose Plan<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.choosePlan}
                    onChange={(e) => handleInputChange('choosePlan', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode
                      ? 'bg-gray-800 text-white border-gray-700'
                      : 'bg-white text-gray-900 border-gray-300'
                      } ${errors.choosePlan ? 'border-red-500' : ''}`}
                  >
                    <option value="">Select Plan</option>
                    {formData.choosePlan && !plans.some(plan => {
                      const normalize = (s: string) => s.replace(/\.00/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().replace(/p(\d+)/g, '$1');
                      const planWithPrice = plan.price ? `${plan.name} - P${plan.price}` : plan.name;
                      return normalize(planWithPrice) === normalize(formData.choosePlan) || normalize(plan.name) === normalize(formData.choosePlan);
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
                  <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`} size={20} />
                </div>
                {errors.choosePlan && <p className="text-red-500 text-xs mt-1">{errors.choosePlan}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Promo
                </label>
                <div className="relative">
                  <select
                    value={formData.promo}
                    onChange={(e) => handleInputChange('promo', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode
                      ? 'bg-gray-800 text-white border-gray-700'
                      : 'bg-white text-gray-900 border-gray-300'
                      }`}
                  >
                    <option value="">Select Promo</option>
                    <option value="None">None</option>
                    {formData.promo && formData.promo !== 'None' && !promos.some(p => p.promo_name === formData.promo) && (
                      <option value={formData.promo}>{formData.promo}</option>
                    )}
                    {promos.map((promo) => (
                      <option key={promo.id} value={promo.promo_name}>
                        {promo.promo_name}{promo.description ? ` - ${promo.description}` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`} size={20} />
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>Remarks</label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) => handleInputChange('remarks', e.target.value)}
                  rows={3}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    }`}
                />
              </div>

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



              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Billing Day<span className="text-red-500">*</span>
                </label>
                <div className={`flex items-center border rounded ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                  }`}>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={formData.billingDay}
                    onChange={(e) => handleInputChange('billingDay', e.target.value)}
                    disabled={false}
                    className={`flex-1 px-3 py-2 bg-transparent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'text-white' : 'text-gray-900'
                      } ${errors.billingDay ? 'border-red-500' : ''}`}
                  />
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => handleNumberChange('billingDay', false)}
                      disabled={false}
                      className={`px-3 py-2 border-l transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                        ? 'text-gray-400 hover:text-white border-gray-700'
                        : 'text-gray-600 hover:text-gray-900 border-gray-300'
                        }`}
                    >
                      <Minus size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNumberChange('billingDay', true)}
                      disabled={false}
                      className={`px-3 py-2 border-l transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                        ? 'text-gray-400 hover:text-white border-gray-700'
                        : 'text-gray-600 hover:text-gray-900 border-gray-300'
                        }`}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>


                {errors.billingDay && <p className="text-red-500 text-xs mt-1">{errors.billingDay}</p>}
              </div>
            </div>

            <div className="space-y-4">
              {formData.status === 'Confirmed' && (
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Onsite Status<span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={formData.onsiteStatus}
                      onChange={(e) => handleInputChange('onsiteStatus', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode
                        ? 'bg-gray-800 text-white border-gray-700'
                        : 'bg-white text-gray-900 border-gray-300'
                        } ${errors.onsiteStatus ? 'border-red-500' : ''}`}
                    >
                      <option value="In Progress">In Progress</option>
                      <option value="Done">Done</option>
                      <option value="Failed">Failed</option>
                      <option value="Reschedule">Reschedule</option>
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                      }`} size={20} />
                  </div>
                  {errors.onsiteStatus && <p className="text-red-500 text-xs mt-1">{errors.onsiteStatus}</p>}
                </div>
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

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Modified By<span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={formData.modifiedBy}
                  readOnly
                  className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                    ? 'bg-gray-700 border-gray-700 text-gray-400'
                    : 'bg-gray-100 border-gray-300 text-gray-600'
                    }`}
                  title="Auto-populated with logged-in user"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Modified Date<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={formData.modifiedDate}
                    readOnly
                    className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                      ? 'bg-gray-700 border-gray-700 text-gray-400'
                      : 'bg-gray-100 border-gray-300 text-gray-600'
                      }`}
                    title="Auto-populated with current timestamp"
                  />
                  <Calendar className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`} size={20} />
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>Installation Landmark</label>
                <input
                  type="text"
                  value={formData.installationLandmark}
                  onChange={(e) => handleInputChange('installationLandmark', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    }`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
          <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            {modal.type === 'loading' ? (
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-4" style={{ borderColor: colorPalette?.primary || '#7c3aed' }}></div>
                </div>
                <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{modal.title}</h3>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>{modal.message}</p>
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
      )}
    </>
  );
};

export default JOAssignFormModal;
