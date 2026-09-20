import React, { useState, useEffect } from 'react';
import { Calendar, ChevronDown, Minus, Plus, Loader2 } from 'lucide-react';
import { UserData } from '../types/api';
import { updateJobOrder } from '../services/jobOrderService';
import { updateApplication } from '../services/applicationService';
import { userService } from '../services/userService';

import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import SearchableField, { GroupedOption } from '../components/common/SearchableField';
import { agentService } from '../services/agentService';
import {
  buildAgentGroups,
  referredByFields,
  referredByForSave,
  selectionFromOption,
} from '../utils/referredByField';


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

interface JobOrderDoneFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: any) => void;
  jobOrderData?: any;
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
  isLastDayOfMonth: boolean;
  onsiteStatus: string;
  assignedEmail: string;
  modifiedBy: string;
  modifiedDate: string;
  installationLandmark: string;
  modemSN: string;
  routerModel: string;
}

const JobOrderDoneFormModal: React.FC<JobOrderDoneFormModalProps> = ({
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
      if (authData) return JSON.parse(authData);
    } catch (error) {
      console.error('Error getting current user:', error);
    }
    return null;
  };

  const currentUser = getCurrentUser();
  const currentUserEmail = currentUser?.email || 'unknown@email.com';

  const [formData, setFormData] = useState<JOFormData>({
    timestamp: new Date().toLocaleString('sv-SE').replace(' ', ' '),
    status: '',
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
    isLastDayOfMonth: false,
    onsiteStatus: 'In Progress',
    assignedEmail: '',
    modifiedBy: currentUserEmail,
    modifiedDate: new Date().toLocaleString('sv-SE').replace(' ', ' '),
    installationLandmark: '',
    modemSN: '',
    routerModel: ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isValidatingSN, setIsValidatingSN] = useState(false);
  const [isSNValidated, setIsSNValidated] = useState(false);
  const [validateCooldown, setValidateCooldown] = useState(0);

  // Cooldown timer for the SN validate button
  useEffect(() => {
    let timer: any;
    if (validateCooldown > 0) {
      timer = setInterval(() => {
        setValidateCooldown(prev => prev - 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [validateCooldown]);
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  // Original assigned technician captured when the modal loads, used to detect reassignment
  const [originalAssignedEmail, setOriginalAssignedEmail] = useState<string>('');

  interface ModalConfig {
    isOpen: boolean;
    type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
    title: string;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  const [technicians, setTechnicians] = useState<Array<{ email: string; name: string }>>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);


  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
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
    const fetchTechnicians = async () => {
      if (!isOpen) return;
      try {
        const response = await userService.getUsersByRole('technician');
        if (response.success && response.data) {
          const list = response.data
            .filter((u: any) => u.first_name || u.last_name)
            .map((u: any) => {
              const name = `${(u.first_name || '').trim()} ${(u.last_name || '').trim()}`.trim();
              return { email: u.email_address || u.email || '', name: name || u.username || u.email_address || '' };
            })
            .filter((t: any) => t.name && t.email);
          setTechnicians(list);
        }
      } catch { setTechnicians([]); }
    };
    fetchTechnicians();
  }, [isOpen]);

  useEffect(() => {
    const fetchAgents = async () => {
      if (!isOpen) return;
      try {
        const response = await userService.getUsersByRole('agent');
        if (response.success && response.data) {
          setAgents(response.data);
        } else {
          const responseById = await userService.getUsersByRoleId(4);
          if (responseById.success && responseById.data) setAgents(responseById.data);
        }
      } catch { setAgents([]); }
    };
    fetchAgents();
  }, [isOpen]);

  useEffect(() => {
    const fetchTeams = async () => {
      if (!isOpen) return;
      try {
        const response = await agentService.getAllAgents();
        if (response.success && response.data) {
          setTeams(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch teams:', error);
        setTeams([]);
      }
    };
    fetchTeams();
  }, [isOpen]);



  useEffect(() => {
    const loadPlans = async () => {
      if (!isOpen) return;
      try {
        const response = await apiClient.get<ApiResponse<Plan[]> | Plan[]>('/plans');
        const data = response.data;
        if (data && typeof data === 'object' && 'success' in data && data.success && Array.isArray(data.data)) {
          setPlans(data.data);
        } else if (Array.isArray(data)) {
          setPlans(data);
        } else { setPlans([]); }
      } catch { setPlans([]); }
    };
    loadPlans();
  }, [isOpen]);

  useEffect(() => {
    const loadPromos = async () => {
      if (!isOpen) return;
      try {
        const response = await apiClient.get<ApiResponse<Promo[]> | Promo[]>('/promos');
        const data = response.data;
        if (data && typeof data === 'object' && 'success' in data && data.success && Array.isArray(data.data)) {
          setPromos(data.data);
        } else if (Array.isArray(data)) {
          setPromos(data);
        } else { setPromos([]); }
      } catch { setPromos([]); }
    };
    loadPromos();
  }, [isOpen]);

  useEffect(() => {
    const fetchRegions = async () => {
      if (!isOpen) return;
      try {
        const fetchedRegions = await getRegions();
        setRegions(Array.isArray(fetchedRegions) ? fetchedRegions : []);
      } catch { setRegions([]); }
    };
    fetchRegions();
  }, [isOpen]);

  useEffect(() => {
    const fetchAllCities = async () => {
      if (!isOpen) return;
      try {
        const fetchedCities = await getCities();
        setAllCities(Array.isArray(fetchedCities) ? fetchedCities : []);
      } catch { setAllCities([]); }
    };
    fetchAllCities();
  }, [isOpen]);

  useEffect(() => {
    const fetchAllBarangays = async () => {
      if (!isOpen) return;
      try {
        const response = await barangayService.getAll();
        setAllBarangays(response.success && Array.isArray(response.data) ? response.data : []);
      } catch { setAllBarangays([]); }
    };
    fetchAllBarangays();
  }, [isOpen]);

  useEffect(() => {
    if (jobOrderData && isOpen) {
      setOriginalAssignedEmail(jobOrderData.Assigned_Email || jobOrderData.assigned_email || '');
      setFormData(prev => ({
        ...prev,
        timestamp: jobOrderData.timestamp || jobOrderData.Timestamp || new Date().toLocaleString('sv-SE').replace(' ', ' '),
        status: jobOrderData.Status || jobOrderData.status || 'Confirmed',
        // Only the stored value and the id inside it. The name is filled in by
        // the effect below once the agent list has loaded — reading `agents`
        // here would make it a dependency of this whole prefill, and a late
        // agent list would then reset every field the user had already typed.
        ...referredByFields(jobOrderData, []),
        firstName: jobOrderData.First_Name || jobOrderData.first_name || '',
        middleInitial: jobOrderData.Middle_Initial || jobOrderData.middle_initial || '',
        lastName: jobOrderData.Last_Name || jobOrderData.last_name || '',
        contactNumber: jobOrderData.Mobile_Number || jobOrderData.Contact_Number || jobOrderData.mobile_number || '',
        email: jobOrderData.Email_Address || jobOrderData.email_address || jobOrderData.email || '',
        address: jobOrderData.Address || jobOrderData.Installation_Address || jobOrderData.address || '',
        barangay: jobOrderData.Barangay || jobOrderData.barangay || '',
        city: jobOrderData.City || jobOrderData.city || '',
        region: jobOrderData.Region || jobOrderData.region || '',
        choosePlan: jobOrderData.Desired_Plan || jobOrderData.desired_plan || jobOrderData.Choose_Plan || jobOrderData.choose_plan || '',
        promo: jobOrderData.promo || jobOrderData.Promo || '',
        remarks: jobOrderData.Onsite_Remarks || jobOrderData.onsite_remarks || jobOrderData.remarks || '',
        installationFee: jobOrderData.installation_fee || jobOrderData.Installation_Fee || 0,
        billingDay: (jobOrderData.billing_day !== undefined && jobOrderData.billing_day !== null) ? String(jobOrderData.billing_day) : (jobOrderData.Billing_Day !== undefined && jobOrderData.Billing_Day !== null) ? String(jobOrderData.Billing_Day) : '',
        isLastDayOfMonth: jobOrderData.billing_day === 0 || jobOrderData.Billing_Day === 0,
        onsiteStatus: jobOrderData.Onsite_Status || jobOrderData.onsite_status || 'In Progress',
        assignedEmail: jobOrderData.Assigned_Email || jobOrderData.assigned_email || '',
        installationLandmark: jobOrderData.installation_landmark || jobOrderData.Installation_Landmark || '',
        modemSN: jobOrderData.Modem_Router_SN || jobOrderData.modem_router_sn || jobOrderData.Modem_SN || jobOrderData.modem_sn || '',
        routerModel: jobOrderData.Router_Model || jobOrderData.router_model || ''
      }));
      // Existing saved SN is treated as already validated so edits don't force re-validation
      setIsSNValidated(!!(jobOrderData.Modem_Router_SN || jobOrderData.modem_router_sn || jobOrderData.Modem_SN || jobOrderData.modem_sn));
    }
  }, [jobOrderData, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setFormData({
        timestamp: new Date().toLocaleString('sv-SE').replace(' ', ' '),
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
        isLastDayOfMonth: false,
        onsiteStatus: 'In Progress',
        assignedEmail: '',
        modifiedBy: currentUserEmail,
        modifiedDate: new Date().toLocaleString('sv-SE').replace(' ', ' '),
        installationLandmark: '',
        modemSN: '',
        routerModel: ''
      });
      setErrors({});
      setOriginalAssignedEmail('');
      setIsSNValidated(false);
      setIsValidatingSN(false);
      setValidateCooldown(0);
    }
  }, [isOpen, currentUserEmail]);

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
  const referredByRaw = jobOrderData?.Referred_By ?? jobOrderData?.referred_by ?? '';
  const referredByAgentIdProp =
    jobOrderData?.Referred_By_Agent_ID ?? jobOrderData?.referred_by_agent_id ?? null;

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
      if (!isNaN(numValue) && numValue > 30) return;
    }

    if (field === 'onsiteStatus' && value === 'In Progress') {
      const originalStatus = (jobOrderData?.Onsite_Status || jobOrderData?.onsite_status || '').trim().toLowerCase();
      const eligibleOriginals = ['done', 'failed', 'reschedule'];
      if (eligibleOriginals.includes(originalStatus)) {
        setModal({
          isOpen: true,
          type: 'confirm',
          title: 'Confirm Status Change',
          message: 'Changing Onsite Status back to "In Progress" will delete all saved technical details, installation data, and PPPOE credentials. Are you sure you want to proceed?',
          onConfirm: () => {
            setFormData(prev => ({ ...prev, onsiteStatus: 'In Progress' }));
            setModal(prev => ({ ...prev, isOpen: false }));
          },
          onCancel: () => {
            setModal(prev => ({ ...prev, isOpen: false }));
          }
        });
        return;
      }
    }

    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      if (field === 'isLastDayOfMonth' && value === true) newData.billingDay = '0';
      if (field === 'region') { newData.city = ''; newData.barangay = ''; }
      else if (field === 'city') { newData.barangay = ''; }
      return newData;
    });

    // Any change to the Modem SN invalidates a prior validation
    if (field === 'modemSN') {
      setIsSNValidated(false);
    }

    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleInstallationFeeChange = (value: string) => {
    if (value === '' || value === '-') {
      setFormData(prev => ({ ...prev, installationFee: value }));
    } else {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) setFormData(prev => ({ ...prev, installationFee: value }));
    }
    if (errors.installationFee) setErrors(prev => ({ ...prev, installationFee: '' }));
  };

  const handleNumberChange = (field: 'installationFee' | 'billingDay', increment: boolean) => {
    setFormData(prev => {
      if (field === 'installationFee') {
        const currentVal = Number(prev[field]) || 0;
        return { ...prev, [field]: increment ? currentVal + 0.01 : Math.max(0, currentVal - 0.01) };
      } else {
        const currentValue = parseInt(prev[field]) || 1;
        const newValue = increment ? Math.min(30, currentValue + 1) : Math.max(1, currentValue - 1);
        return { ...prev, [field]: newValue.toString() };
      }
    });
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.timestamp.trim()) newErrors.timestamp = 'Timestamp is required';
    if (!formData.status.trim()) newErrors.status = 'Status is required';
    if (!formData.firstName.trim()) newErrors.firstName = 'First Name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last Name is required';

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

    if (!formData.address.trim()) newErrors.address = 'Address is required';
    if (!formData.region.trim()) newErrors.region = 'Region is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.barangay.trim()) newErrors.barangay = 'Barangay is required';
    if (!formData.choosePlan.trim()) newErrors.choosePlan = 'Choose Plan is required';
    if (Number(formData.installationFee) < 0) newErrors.installationFee = 'Installation fee cannot be negative';

    const billingDayNum = parseInt(formData.billingDay);
    if (!formData.isLastDayOfMonth) {
      if (isNaN(billingDayNum) || billingDayNum < 1) {
        newErrors.billingDay = 'Billing Day must be at least 1';
      } else if (billingDayNum > 30) {
        newErrors.billingDay = 'Billing Day cannot exceed 30';
      }
    }

    if (formData.status === 'Confirmed') {
      if (!formData.onsiteStatus.trim()) newErrors.onsiteStatus = 'Onsite Status is required';
      if (formData.onsiteStatus !== 'Failed' && !formData.assignedEmail.trim()) {
        newErrors.assignedEmail = 'Assigned Email is required';
      }
      
      if (['Reschedule', 'Failed'].includes(formData.onsiteStatus)) {
        if (!formData.remarks.trim()) {
          newErrors.remarks = 'Remarks is required when onsite status is Failed or Reschedule';
        }
      }

      if (formData.onsiteStatus === 'Done') {
        if (!formData.modemSN.trim()) {
          newErrors.modemSN = 'Modem SN is required';
        } else if (!isSNValidated && !formData.routerModel.trim()) {
          // Only force validation for a brand-new SN. If a Router Model is already
          // present (existing saved data or a prior validation), no need to re-validate.
          newErrors.modemSN = 'Please validate the Modem SN first';
        }
        if (!formData.routerModel.trim()) {
          newErrors.routerModel = 'Router Model is required';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleValidateSN = async () => {
    const sn = formData.modemSN?.trim();
    if (!sn) {
      setModal({ isOpen: true, type: 'warning', title: 'Validation Error', message: 'Please enter a Modem Serial Number first.' });
      return;
    }

    if (isValidatingSN || validateCooldown > 0) return;

    setIsValidatingSN(true);
    setValidateCooldown(30);
    try {
      const response = await apiClient.get('/smart-olt/validate-sn', {
        params: {
          sn,
          jo_id: jobOrderData?.id || jobOrderData?.JobOrder_ID,
          user_email: currentUserEmail
        },
        timeout: 15000
      });

      const result: any = response?.data;

      if (!result || !result.success) {
        const msg = result?.message || 'Serial Number not found in SmartOLT system.';
        setModal({ isOpen: true, type: 'error', title: 'Validation Error', message: msg });
        setErrors(prev => ({ ...prev, modemSN: msg }));
        setIsSNValidated(false);
        return;
      }

      // Success — mark validated and auto-populate the Router Model
      setIsSNValidated(true);
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.modemSN;
        return newErrors;
      });

      const onuType = result.data?.onu_type_name || result.onus?.[0]?.onu_type_name;
      if (onuType) {
        setFormData(prev => ({ ...prev, routerModel: onuType }));
      }

      setModal({ isOpen: true, type: 'success', title: 'Success', message: 'Modem Serial Number is valid and verified in SmartOLT.' });
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || 'System communication error. Please check your internet.';
      setModal({ isOpen: true, type: 'error', title: 'Validation Error', message: errorMsg });
      setErrors(prev => ({ ...prev, modemSN: errorMsg }));
      setIsSNValidated(false);
    } finally {
      setIsValidatingSN(false);
    }
  };

  const handleSave = async () => {
    // ── Technician reassignment: allowed at any time. When the assigned tech
    //    changes, the on-site visit is reset so the new technician starts fresh
    //    (start_time / end_time are cleared below in the job order update). ──
    const currentAssigned = (formData.assignedEmail || '').trim();
    const originalAssigned = (originalAssignedEmail || '').trim();
    const technicianChanged = !!originalAssigned && currentAssigned !== originalAssigned;

    const updatedFormData = {
      ...formData,
      modifiedBy: currentUserEmail,
      updated_by: currentUserEmail,
      modifiedDate: new Date().toLocaleString('sv-SE').replace(' ', ' ')
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

      const jobOrderUpdateData: any = {
        timestamp: updatedFormData.timestamp,
        status: updatedFormData.status,
        onsite_status: updatedFormData.onsiteStatus,
        assigned_email: updatedFormData.assignedEmail,
        onsite_remarks: updatedFormData.remarks,
        installation_fee: Number(updatedFormData.installationFee) || 0,
        billing_day: updatedFormData.isLastDayOfMonth ? 0 : (parseInt(updatedFormData.billingDay) || 30),
        installation_landmark: updatedFormData.installationLandmark || null,
        referred_by: referredByForSave(
          { label: updatedFormData.referredBy, agentId: updatedFormData.referredById },
          agents
        ),
        modem_router_sn: updatedFormData.modemSN || null,
        router_model: updatedFormData.routerModel || null,
        updated_by_user_email: currentUserEmail
      };

      // Handle re-edit: If status changed from Done back to In Progress
      const oldOnsiteStatus = String(jobOrderData.onsite_status || jobOrderData.Onsite_Status || '').trim().toLowerCase();
      if (oldOnsiteStatus === 'done' && updatedFormData.onsiteStatus === 'In Progress') {
        try {
          const usernameToDelete = jobOrderData.username || jobOrderData.Username || jobOrderData.pppoe_username;
          if (usernameToDelete) {
            await apiClient.post('/radius/operation', {
              action: 'deleteAccount',
              username: usernameToDelete
            });
            console.log('Re-edit: RADIUS account deleted');
          }
        } catch (radiusErr) {
          console.error('Re-edit: Failed to delete RADIUS account:', radiusErr);
        }

        // Clear all technical and installation data in the database
        jobOrderUpdateData.date_installed = null;
        jobOrderUpdateData.modem_router_sn = null;
        jobOrderUpdateData.router_model = null;
        jobOrderUpdateData.lcpnap = null;
        jobOrderUpdateData.port = null;
        jobOrderUpdateData.vlan = null;
        jobOrderUpdateData.username = null;
        jobOrderUpdateData.ip_address = null;
        jobOrderUpdateData.connection_type = null;
        jobOrderUpdateData.usage_type = null;
        jobOrderUpdateData.visit_by = null;
        jobOrderUpdateData.visit_with = null;
        jobOrderUpdateData.visit_with_other = null;
        // The remarks deliberately survive. Setting a job order back to In
        // Progress clears the technical and installation data because the
        // install is being redone — but onsite_remarks and status_remarks are
        // the written record of what happened last time, and that is exactly
        // what whoever picks the job up next needs to read.
        // status_remarks is simply left out of the payload, so the value
        // already on the row stays untouched; onsite_remarks is sent from the
        // form, which loaded it from the record.
        jobOrderUpdateData.setup_image_url = null;
        jobOrderUpdateData.speedtest_image_url = null;
        jobOrderUpdateData.box_reading_image_url = null;
        jobOrderUpdateData.router_reading_image_url = null;
        jobOrderUpdateData.port_label_image_url = null;
        jobOrderUpdateData.pppoe_username = null;
        jobOrderUpdateData.pppoe_password = null;
        jobOrderUpdateData.start_time = null;
        jobOrderUpdateData.end_time = null;
      }

      // Clear visit data when rescheduling so it can be reassigned fresh
      if (updatedFormData.onsiteStatus === 'Reschedule') {
        jobOrderUpdateData.visit_by = null;
        jobOrderUpdateData.visit_with = null;
        jobOrderUpdateData.visit_with_other = null;
      }

      // Reset the on-site timers when the technician is reassigned so the new
      // technician starts a fresh visit (no inherited start/end time).
      if (technicianChanged) {
        jobOrderUpdateData.start_time = null;
        jobOrderUpdateData.end_time = null;
      }
      const jobOrderResponse = await updateJobOrder(jobOrderId, jobOrderUpdateData);
      if (!jobOrderResponse.success) throw new Error(jobOrderResponse.message || 'Job order update failed');
      saveMessages.push({ type: 'success', text: 'Job order updated successfully' });

      if (applicationId) {
        const applicationUpdateData: any = {
          first_name: updatedFormData.firstName || null,
          middle_initial: updatedFormData.middleInitial || null,
          last_name: updatedFormData.lastName || null,
          mobile_number: updatedFormData.contactNumber || null,
          email_address: updatedFormData.email || null,
          installation_address: updatedFormData.address || null,
          barangay: updatedFormData.barangay || null,
          city: updatedFormData.city || null,
          region: updatedFormData.region || null,
          desired_plan: updatedFormData.choosePlan || null,
          promo: updatedFormData.promo || null,
          landmark: updatedFormData.installationLandmark || null,
          referred_by: referredByForSave(
            { label: updatedFormData.referredBy, agentId: updatedFormData.referredById },
            agents
          ),
          updated_by: currentUserEmail
        };
        await updateApplication(applicationId, applicationUpdateData);
        saveMessages.push({ type: 'success', text: 'Application details updated' });
      }

      // ── RADIUS group update when plan changes ──────────────────────────
      const originalPlan = jobOrderData?.Desired_Plan || jobOrderData?.desired_plan || jobOrderData?.Choose_Plan || jobOrderData?.choose_plan || '';
      const planChanged = updatedFormData.choosePlan && updatedFormData.choosePlan !== originalPlan;
      const pppoeUsername = jobOrderData?.pppoe_username || jobOrderData?.username || jobOrderData?.Username || '';

      let radiusUpdateMessage = '';

      if (planChanged && pppoeUsername) {
        try {
          const radiusResponse = await apiClient.post<{ status: string; message?: string }>('/radius/operation', {
            action: 'updateGroup',
            username: pppoeUsername,
            plan: updatedFormData.choosePlan,
            updatedBy: currentUserEmail
          });

          if ((radiusResponse.data as any).status === 'success') {
            radiusUpdateMessage = `\n\nRADIUS group updated to "${updatedFormData.choosePlan}" successfully.`;
          } else {
            // Check if user simply doesn't exist in radius yet
            const msg = (radiusResponse.data as any).message || '';
            if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no data')) {
              radiusUpdateMessage = `\n\nNo RADIUS data found for "${pppoeUsername}". Please verify the user has an active onsite installation or has existing RADIUS credentials before updating the plan in RADIUS.`;
            } else {
              radiusUpdateMessage = `\n\nRADIUS group update failed: ${msg}`;
            }
          }
        } catch (radiusErr: any) {
          const errMsg = radiusErr.response?.data?.message || radiusErr.message || '';
          if (errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('no data')) {
            radiusUpdateMessage = `\n\nNo RADIUS data found for "${pppoeUsername}". Please verify the user has an active onsite installation or has existing RADIUS credentials before updating the plan in RADIUS.`;
          } else {
            radiusUpdateMessage = `\n\nRADIUS group update failed: ${errMsg || 'Unknown error'}`;
          }
        }
      } else if (planChanged && !pppoeUsername) {
        radiusUpdateMessage = `\n\nPlan changed but no PPPoE username found on this job order. RADIUS group was NOT updated.`;
      }
      // ── End RADIUS update ──────────────────────────────────────────────

      clearInterval(progressInterval);
      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      setErrors({});
      setLoading(false);
      setLoadingPercentage(0);
      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: `Records updated successfully!${radiusUpdateMessage}`,
        onConfirm: () => {
          onSave(updatedFormData);
          onClose();
          setModal({ ...modal, isOpen: false });
        }
      });
    } catch (error: any) {
      clearInterval(progressInterval);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error occurred';
      setLoading(false);
      setLoadingPercentage(0);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Update Failed',
        message: `Failed to update records: ${errorMessage}`
      });
    }
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

      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'} shadow-2xl overflow-hidden flex flex-col`}>
          <div className={`${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'} px-6 py-4 flex items-center justify-between border-b`}>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              {`${formData.firstName} ${formData.middleInitial} ${formData.lastName}`.trim() || 'Job Order Done Form'}
            </h2>
            <div className="flex items-center space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 border rounded text-sm"
                style={{ borderColor: colorPalette?.primary || '#7c3aed', color: colorPalette?.primary || '#7c3aed' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-4 py-2 disabled:opacity-50 text-white rounded text-sm"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                onMouseEnter={(e) => { if (colorPalette?.accent) e.currentTarget.style.backgroundColor = colorPalette.accent; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed'; }}
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Timestamp<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={formData.timestamp}
                    onChange={(e) => handleInputChange('timestamp', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.timestamp ? 'border-red-500' : ''}`}
                  />
                  <Calendar className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} size={20} />
                </div>
                {errors.timestamp && <p className="text-red-500 text-xs mt-1">{errors.timestamp}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Status<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.status ? 'border-red-500' : ''}`}
                  >
                    <option value="" disabled>Select Status</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="For Confirmation">For Confirmation</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} size={20} />
                </div>
                {errors.status && <p className="text-red-500 text-xs mt-1">{errors.status}</p>}
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

            </div>

            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  First Name<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.firstName ? 'border-red-500' : ''}`}
                />
                {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Middle Initial</label>
                <input
                  type="text"
                  value={formData.middleInitial}
                  onChange={(e) => handleInputChange('middleInitial', e.target.value)}
                  onKeyDown={(e) => { if (/[0-9]/.test(e.key)) e.preventDefault(); }}
                  maxLength={1}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'}`}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Last Name<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.lastName ? 'border-red-500' : ''}`}
                />
                {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Contact Number<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.contactNumber}
                  onChange={(e) => handleInputChange('contactNumber', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.contactNumber ? 'border-red-500' : ''}`}
                />
                {errors.contactNumber && <p className="text-red-500 text-xs mt-1">{errors.contactNumber}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Applicant Email Address<span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.email ? 'border-red-500' : ''}`}
                />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Address<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => handleInputChange('address', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.address ? 'border-red-500' : ''}`}
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
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Choose Plan<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.choosePlan}
                    onChange={(e) => handleInputChange('choosePlan', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.choosePlan ? 'border-red-500' : ''}`}
                  >
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
                        <option key={plan.id} value={planWithPrice}>{planWithPrice}</option>
                      );
                    })}
                  </select>
                  <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} size={20} />
                </div>
                {errors.choosePlan && <p className="text-red-500 text-xs mt-1">{errors.choosePlan}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Promo</label>
                <div className="relative">
                  <select
                    value={formData.promo}
                    onChange={(e) => handleInputChange('promo', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'}`}
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
                  <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} size={20} />
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Remarks{formData.status === 'Confirmed' && ['Reschedule', 'Failed'].includes(formData.onsiteStatus) && <span className="text-red-500">*</span>}
                </label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) => handleInputChange('remarks', e.target.value)}
                  rows={3}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.remarks ? 'border-red-500' : ''}`}
                />
                {errors.remarks && <p className="text-red-500 text-xs mt-1">{errors.remarks}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Installation Fee<span className="text-red-500">*</span>
                </label>
                <div className={`flex items-center border rounded ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                  <span className={`px-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>₱</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.installationFee}
                    onChange={(e) => handleInstallationFeeChange(e.target.value)}
                    className={`flex-1 px-3 py-2 bg-transparent focus:outline-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${isDarkMode ? 'text-white' : 'text-gray-900'} ${errors.installationFee ? 'border-red-500' : ''}`}
                    placeholder="0.00"
                  />
                </div>
                {errors.installationFee && <p className="text-red-500 text-xs mt-1">{errors.installationFee}</p>}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Billing Day<span className="text-red-500">*</span>
                </label>
                <div className={`flex items-center border rounded ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={formData.billingDay}
                    onChange={(e) => handleInputChange('billingDay', e.target.value)}
                    disabled={formData.isLastDayOfMonth}
                    className={`flex-1 px-3 py-2 bg-transparent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'text-white' : 'text-gray-900'} ${errors.billingDay ? 'border-red-500' : ''}`}
                  />
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => handleNumberChange('billingDay', false)}
                      disabled={formData.isLastDayOfMonth}
                      className={`px-3 py-2 border-l transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'}`}
                    >
                      <Minus size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNumberChange('billingDay', true)}
                      disabled={formData.isLastDayOfMonth}
                      className={`px-3 py-2 border-l transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'}`}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex items-center">
                  <input
                    type="checkbox"
                    id="isLastDayOfMonth"
                    checked={formData.isLastDayOfMonth}
                    onChange={(e) => handleInputChange('isLastDayOfMonth', e.target.checked)}
                    className={`w-4 h-4 rounded text-orange-600 focus:ring-orange-500 focus:ring-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}
                  />
                  <label htmlFor="isLastDayOfMonth" className={`ml-2 text-sm cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Always use last day of the month
                  </label>
                </div>

                {parseInt(formData.billingDay) > 30 && !formData.isLastDayOfMonth && (
                  <p className="text-orange-500 text-xs mt-1 flex items-center">
                    <span className="mr-1">⚠</span>Billing Day must be between 1 and 30
                  </p>
                )}
                {errors.billingDay && <p className="text-red-500 text-xs mt-1">{errors.billingDay}</p>}
              </div>
            </div>

            <div className="space-y-4">
              {formData.status === 'Confirmed' && (
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Onsite Status<span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={formData.onsiteStatus}
                      onChange={(e) => handleInputChange('onsiteStatus', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} ${errors.onsiteStatus ? 'border-red-500' : ''}`}
                    >
                      <option value="In Progress">In Progress</option>
                      <option value="Done">Done</option>
                      <option value="Failed">Failed</option>
                      <option value="Reschedule">Reschedule</option>
                    </select>
                    <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} size={20} />
                  </div>
                  {errors.onsiteStatus && <p className="text-red-500 text-xs mt-1">{errors.onsiteStatus}</p>}
                </div>
              )}

              {formData.status === 'Confirmed' && formData.onsiteStatus !== 'Failed' && (
                <SearchableField
                  label="Assigned Email"
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

              {formData.status === 'Confirmed' && formData.onsiteStatus === 'Done' && (
                <>
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Modem SN<span className="text-red-500">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleValidateSN}
                        disabled={isValidatingSN || validateCooldown > 0}
                        className={`px-4 py-2 rounded text-white text-sm font-bold whitespace-nowrap flex items-center justify-center min-w-[90px] ${(isValidatingSN || validateCooldown > 0) ? 'bg-gray-400 cursor-not-allowed' : 'bg-orange-500 hover:bg-orange-600'}`}
                      >
                        {isValidatingSN ? (
                          <Loader2 className="animate-spin" size={16} />
                        ) : validateCooldown > 0 ? (
                          `${validateCooldown}s`
                        ) : (
                          'VALIDATE'
                        )}
                      </button>
                      <input
                        type="text"
                        value={formData.modemSN}
                        onChange={(e) => handleInputChange('modemSN', e.target.value)}
                        placeholder="Enter Modem Serial Number"
                        className={`flex-1 px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} ${errors.modemSN ? 'border-red-500' : (isDarkMode ? 'border-gray-700' : 'border-gray-300')}`}
                      />
                    </div>
                    {errors.modemSN && <p className="text-red-500 text-xs mt-1">{errors.modemSN}</p>}
                  </div>

                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Router Model<span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.routerModel}
                      readOnly
                      placeholder="Validate Modem SN to get Router Model..."
                      className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-700 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-600'} ${errors.routerModel ? 'border-red-500' : ''}`}
                    />
                    {errors.routerModel && <p className="text-red-500 text-xs mt-1">{errors.routerModel}</p>}
                  </div>
                </>
              )}

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Modified By<span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={formData.modifiedBy}
                  readOnly
                  className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-700 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-600'}`}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Modified Date<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={formData.modifiedDate}
                    readOnly
                    className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-700 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-600'}`}
                  />
                  <Calendar className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} size={20} />
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Installation Landmark</label>
                <input
                  type="text"
                  value={formData.installationLandmark}
                  onChange={(e) => handleInputChange('installationLandmark', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'}`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default JobOrderDoneFormModal;
