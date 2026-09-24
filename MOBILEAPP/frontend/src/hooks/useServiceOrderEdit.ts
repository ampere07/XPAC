import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Alert, Keyboard, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoFileSystem from 'expo-file-system/legacy';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

import apiClient from '../config/api';
import { getAllInventoryItems, InventoryItem } from '../services/inventoryItemService';
import { createServiceOrderItems, ServiceOrderItem } from '../services/serviceOrderItemService';
import { formatToGMT8MySQL } from '../utils/dateUtils';
import { startTimeVisitTeam } from '../utils/visitTeam';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { concernService, Concern } from '../services/concernService';
import { getAllLCPNAPs, LCPNAP } from '../services/lcpnapService';
import { technicianService } from '../services/technicianService';


export interface UserData {
  email?: string;
  email_address?: string;
  role?: string | { role_name: string };
  role_id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface OrderItem {
  itemId: string;
  quantity: string;
}

export interface ServiceOrderEditFormData {
  accountNo: string;
  dateInstalled: string;
  fullName: string;
  contactNumber: string;
  emailAddress: string;
  plan: string;
  username: string;
  pppoePassword: string;
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
  fullAddress: string;
  proofImage: string;
  setupImage: string;
  routerReadingImage: string;
  boxReadingImage: string;
  portLabelImage: string;
}

export interface ImageFiles {
  timeInFile: ImagePicker.ImagePickerAsset | null;
  modemSetupFile: ImagePicker.ImagePickerAsset | null;
  timeOutFile: ImagePicker.ImagePickerAsset | null;
  clientSignatureFile: ImagePicker.ImagePickerAsset | null;
  proofImageFile: ImagePicker.ImagePickerAsset | null;
  setupImageFile: ImagePicker.ImagePickerAsset | null;
  routerReadingImageFile: ImagePicker.ImagePickerAsset | null;
  boxReadingImageFile: ImagePicker.ImagePickerAsset | null;
  portLabelImageFile: ImagePicker.ImagePickerAsset | null;
}

export const useServiceOrderEdit = (isOpen: boolean, serviceOrderData: any, onClose: () => void, onSave: (data: any) => void) => {
  const serviceOrderId = serviceOrderData?.id;
  const isMountedRef = useRef(true);
  const openCycleRef = useRef(0);
  const signatureRef = useRef<any>(null);
  const initialDataLoadedRef = useRef(false);

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [isContentReady, setIsContentReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [isDrawingSignature, setIsDrawingSignature] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [isSNValidated, setIsSNValidated] = useState(false);
  const [isValidatingSN, setIsValidatingSN] = useState(false);
  const [validateCooldown, setValidateCooldown] = useState(0);

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

  // Data Lists
  const [technicians, setTechnicians] = useState<Array<{ name: string; email: string }>>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [routerModels, setRouterModels] = useState<any[]>([]);
  const [lcpnaps, setLcpnaps] = useState<LCPNAP[]>([]);
  const [vlans, setVlans] = useState<string[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [usedPorts, setUsedPorts] = useState<string[]>([]);
  const [totalPorts, setTotalPorts] = useState<number>(32);

  const [orderItems, setOrderItems] = useState<OrderItem[]>([{ itemId: '', quantity: '' }]);
  const [formData, setFormData] = useState<ServiceOrderEditFormData>(initialFormState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /**
   * Bumped every time a save is rejected for missing fields.
   *
   * A counter rather than a boolean: two failed saves in a row must both scroll,
   * and a boolean that is already true produces no change for the view to react to.
   */
  const [validationFailedAt, setValidationFailedAt] = useState(0);
  const [imageFiles, setImageFiles] = useState<ImageFiles>({
    timeInFile: null,
    modemSetupFile: null,
    timeOutFile: null,
    clientSignatureFile: null,
    proofImageFile: null,
    setupImageFile: null,
    routerReadingImageFile: null,
    boxReadingImageFile: null,
    portLabelImageFile: null
  });

  // Active Picker State
  const [activePicker, setActivePicker] = useState<string | null>(null);
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);
  const [activeTechField, setActiveTechField] = useState<'visitBy' | 'visitWith' | 'visitWithOther' | null>(null);

  /**
   * Reset the technician search whenever a different picker takes over.
   *
   * Visit By / Visit With / Visit With (Other) all share the single `technician`
   * search key, and it was previously only cleared when the whole modal closed.
   * A query typed while choosing Visit By therefore carried over and kept
   * filtering the list when Visit With was opened next — so most technicians
   * simply were not there, which looked like the options being arbitrarily
   * limited. Every picker now opens showing the full list.
   */
  useEffect(() => {
    setSearchQueries(prev => (prev.technician ? { ...prev, technician: '' } : prev));
  }, [activeTechField]);

  const currentUserEmail = currentUser?.email_address || currentUser?.email || 'unknown@ampere.com';
  const isTechnician = useMemo(() => {
    if (!currentUser) return false;
    const role = typeof currentUser.role === 'string' ? currentUser.role : currentUser.role?.role_name || '';
    return currentUser.role_id === 2 || role.toLowerCase() === 'technician';
  }, [currentUser]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Initialization
  useEffect(() => {
    if (isOpen) {
      initialDataLoadedRef.current = false;
      const raf = requestAnimationFrame(() => {
        if (isMountedRef.current) setIsContentReady(true);
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setIsContentReady(false);
      initialDataLoadedRef.current = false;
      setActivePicker(null);
      setSearchQueries({});
      setValidateCooldown(0);
    }
  }, [isOpen]);

  // Load Settings
  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      const [authResult, paletteResult] = await Promise.allSettled([
        AsyncStorage.getItem('authData'),
        settingsColorPaletteService.getActive(),
      ]);
      if (cancelled) return;
      if (authResult.status === 'fulfilled' && authResult.value) {
        try { setCurrentUser(JSON.parse(authResult.value)); } catch (error) {}
      }
      if (paletteResult.status === 'fulfilled') setColorPalette(paletteResult.value);
    };
    loadSettings();

    const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      setColorPalette(newPalette);
    });

    return () => {
      cancelled = true;
      paletteSub.remove();
    };
  }, []);
  // Sync Form Data
  useEffect(() => {
    if (serviceOrderData && isOpen && !initialDataLoadedRef.current) {
      initialDataLoadedRef.current = true;
      const mappedData = mapApiToForm(serviceOrderData);
      setFormData(prev => ({
        ...prev,
        ...mappedData,
        modifiedBy: currentUserEmail
      }));
      
      // Initialize validation state if SN already exists
      if (mappedData.newRouterModemSN && mappedData.newRouterModemSN.trim() !== '') {
        setIsSNValidated(true);
      } else {
        setIsSNValidated(false);
      }
    }
  }, [serviceOrderData?.id, isOpen, currentUserEmail]);

  // Main Data Fetching
  useEffect(() => {
    if (!isOpen) return;
    openCycleRef.current += 1;
    const session = openCycleRef.current;
    const controller = new AbortController();

    const fetchAllData = async () => {
      const [invRes, techRes, detailsRes, concernRes] = await Promise.allSettled([
        getAllInventoryItems('', 1, 1000),
        technicianService.getAllTechnicians(),
        Promise.all([
          apiClient.get('/vlan', { signal: controller.signal }),
          getAllLCPNAPs('', 1, 1000),
          apiClient.get('/plans', { signal: controller.signal }),
        ]),
        concernService.getAllConcerns(),
      ]);

      if (!isMountedRef.current || openCycleRef.current !== session) return;

      if (invRes.status === 'fulfilled' && invRes.value.success) {
        setInventoryItems(invRes.value.data.filter((i: any) => String(i.category_id || i.Category_ID || i.categoryId || i.category) === '1'));
        setRouterModels(invRes.value.data
          .filter((i: any) => String(i.category_id || i.Category_ID || i.categoryId || i.category) === '11' && i.item_name)
          .map((i: any, idx: number) => ({ model: i.item_name, id: idx })));
      }

      if (techRes.status === 'fulfilled' && techRes.value.success && techRes.value.data) {
        setTechnicians((techRes.value.data as any[])
          .filter((u: any) => u.first_name || u.last_name)
          .map((u: any) => {
            const firstName = (u.first_name || '').trim();
            const middleInitial = u.middle_initial ? `${u.middle_initial.trim()}. ` : '';
            const lastName = (u.last_name || '').trim();
            const fullName = `${firstName} ${middleInitial}${lastName}`.trim();
            return {
              email: u.id.toString(), // Using id as the unique identifier
              name: fullName || 'Unknown Technician'
            };
          }));
      }

      if (detailsRes.status === 'fulfilled') {
        const [vRes, lRes, pRes] = detailsRes.value;
        if (vRes.data?.success) setVlans(vRes.data.data.map((i: any) => i.value).filter(Boolean));
        if (lRes.success) setLcpnaps(lRes.data);
        if (pRes.data?.success) setPlans(pRes.data.data.map((p: any) => ({ name: p.plan_name || p.name || '', price: p.price || 0 })));
      }

      if (concernRes.status === 'fulfilled') setConcerns(concernRes.value);
    };

    fetchAllData();
    return () => controller.abort();
  }, [isOpen]);

  // Fetch Order Items
  useEffect(() => {
    if (!isOpen || !serviceOrderId) return;
    const session = openCycleRef.current;
    
    const fetchItems = async () => {
      try {
        const res = await apiClient.get(`/service-order-items?service_order_id=${serviceOrderId}`);
        if (!isMountedRef.current || openCycleRef.current !== session) return;
        if (res.data?.success && Array.isArray(res.data.data)) {
          const unique = new Map();
          res.data.data.forEach((i: any) => {
            const key = i.item_name;
            const existing = unique.get(key) || { itemId: key, quantity: 0 };
            unique.set(key, { itemId: key, quantity: (parseInt(existing.quantity) + parseInt(i.quantity || 0)).toString() });
          });
          const formatted = Array.from(unique.values());
          formatted.push({ itemId: '', quantity: '' });
          setOrderItems(formatted);
        }
      } catch (e) {}
    };
    fetchItems();
  }, [isOpen, serviceOrderId]);

  // Used Ports
  useEffect(() => {
    if (!isOpen || !formData.newLcpnap) {
      setUsedPorts([]);
      return;
    }
    const session = openCycleRef.current;
    
    const fetchPorts = async () => {
      try {
        const used = new Set<string>();
        
        // 1. Determine total ports
        const selectedLcpnapObj = lcpnaps.find(ln => ln.lcpnap_name === formData.newLcpnap);
        if (selectedLcpnapObj) {
          setTotalPorts(selectedLcpnapObj.port_total || 32);
        } else {
          const lRes = await getAllLCPNAPs(formData.newLcpnap, 1, 1);
          if (isMountedRef.current && lRes.success && lRes.data?.[0]) {
            setTotalPorts(lRes.data[0].port_total || 32);
          }
        }
        
        if (!isMountedRef.current || openCycleRef.current !== session) return;

        // Fetch used ports ONLY from technical_details (already installed customers)
        const lcpnapId = selectedLcpnapObj?.id;
        if (lcpnapId) {
          try {
            const rcRes = await apiClient.get(`/lcpnap/${lcpnapId}/related-customers`);
            if (isMountedRef.current && openCycleRef.current === session && rcRes.data?.success && Array.isArray(rcRes.data.data)) {
              rcRes.data.data.forEach((rc: any) => {
                // Skip the current account itself
                const rcAccountNo = rc.account_no;
                if (rcAccountNo !== formData.accountNo && rc.port) {
                   let norm = rc.port.toString().replace(/\s+/g, '').toUpperCase();
                   if (/^\d+$/.test(norm)) {
                     norm = `P${norm.padStart(2, '0')}`;
                   } else if (/^P\d+$/.test(norm)) {
                     const numStr = norm.substring(1);
                     norm = `P${numStr.padStart(2, '0')}`;
                   }
                   used.add(norm);
                }
              });
            }
          } catch (e) {
            console.error('Failed to fetch related customers in service order edit:', e);
          }
        }

        if (isMountedRef.current && openCycleRef.current === session) {
          setUsedPorts(Array.from(used));
        }
      } catch (e) {
        console.error('Error in fetchPorts:', e);
      }
    };
    
    fetchPorts();
  }, [isOpen, formData.newLcpnap, formData.accountNo, lcpnaps]);

  // Drafts
  useEffect(() => {
    if (!isOpen || !serviceOrderId || !initialDataLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(`serviceOrderDraft_${serviceOrderId}`, JSON.stringify(formData));
        await AsyncStorage.setItem(`serviceOrderItemsDraft_${serviceOrderId}`, JSON.stringify(orderItems));
      } catch (e) {}
    }, 1500);
    return () => clearTimeout(t);
  }, [formData, orderItems, isOpen, serviceOrderId]);

  useEffect(() => {
    if (!isOpen || !serviceOrderId) return;
    const session = openCycleRef.current;
    const t = setTimeout(async () => {
      try {
        const d = await AsyncStorage.getItem(`serviceOrderDraft_${serviceOrderId}`);
        const i = await AsyncStorage.getItem(`serviceOrderItemsDraft_${serviceOrderId}`);
        if (!isMountedRef.current || openCycleRef.current !== session) return;
        if (d) {
          const draftData = JSON.parse(d);
          const freshData = mapApiToForm(serviceOrderData);
          setFormData(prev => ({ 
            ...prev, 
            ...draftData,
            // Restore read-only fields from fresh API data to avoid stale draft values
            accountNo: freshData.accountNo,
            connectionType: freshData.connectionType,
            routerModemSN: freshData.routerModemSN,
            lcp: freshData.lcp,
            nap: freshData.nap,
            port: freshData.port,
            vlan: freshData.vlan,
            username: freshData.username,
            fullName: freshData.fullName,
            plan: freshData.plan,
            emailAddress: freshData.emailAddress,
            contactNumber: freshData.contactNumber,
            dateInstalled: freshData.dateInstalled,
            fullAddress: freshData.fullAddress
          }));
        }
        if (i) setOrderItems(JSON.parse(i));
      } finally {
        if (isMountedRef.current && openCycleRef.current === session) initialDataLoadedRef.current = true;
      }
    }, 800);
    return () => clearTimeout(t);
  }, [isOpen, serviceOrderId, serviceOrderData]);

  // Handlers
  const handleInputChange = useCallback((field: keyof ServiceOrderEditFormData, value: string) => {
    let finalValue = value;
    if (field === 'routerModemSN' || field === 'newRouterModemSN') {
      finalValue = value.toUpperCase();
    }
    
    // Reset validation if SN or Connection Type changes
    if (field === 'newRouterModemSN' || field === 'connectionType') {
      setIsSNValidated(false);
    }

    setFormData((prev: ServiceOrderEditFormData) => ({ 
      ...prev, 
      [field]: finalValue,
      ...( (field === 'newLcp' || field === 'newNap' || field === 'newLcpnap') ? { newPort: '' } : {} )
    }));
    setErrors(prev => (prev[field] ? { ...prev, [field]: '' } : prev));
  }, []);

  const handleImageUpload = (field: keyof ImageFiles, file: any) => {
    setImageFiles(prev => ({ ...prev, [field]: file }));
    setErrors(prev => (prev[field] ? { ...prev, [field]: '' } : prev));
  };

  const handleSignatureOK = async (signature: string) => {
    setIsDrawingSignature(false);
    setScrollEnabled(true);
    try {
      const path = `${(ExpoFileSystem as any).cacheDirectory}signature_${Date.now()}.png`;
      const base64Code = signature.replace('data:image/png;base64,', '');
      await (ExpoFileSystem as any).writeAsStringAsync(path, base64Code, { encoding: 'base64' });
      
      const file = {
        uri: path,
        name: `signature_${Date.now()}.png`,
        type: 'image/png',
        size: base64Code.length * 0.75 // Approximate size
      };

      setImageFiles(prev => ({ ...prev, clientSignatureFile: file as any }));
    } catch (e) {
      console.error('Error handling signature:', e);
      Alert.alert('Error', 'Failed to save signature');
    }
  };

  const handleValidateSN = async () => {
    const modemSN = formData.newRouterModemSN?.trim();
    if (!modemSN) {
      Alert.alert('Validation Error', 'Please enter a New Router Serial Number first.');
      return;
    }

    if (isValidatingSN || validateCooldown > 0) return;

    if (formData.connectionType !== 'Fiber') {
      Alert.alert('Validation Info', 'SN validation is only available for Fiber connections.');
      return;
    }

    setIsValidatingSN(true);
    setValidateCooldown(30);
    try {
      // 1. SmartOLT Validation
      const response = await apiClient.get('/smart-olt/validate-sn', {
        params: { 
          sn: modemSN,
          so_id: serviceOrderId,
          user_email: currentUserEmail
        },
        timeout: 15000
      });
      
      const result = response?.data;
      
      if (!result || !result.success) {
        const msg = result?.message || 'Serial Number not found in SmartOLT system.';
        Alert.alert('Validation Error', msg);
        setErrors(prev => ({ ...prev, newRouterModemSN: msg }));
        setIsSNValidated(false);
        return;
      }

      // Auto-fill router model if available
      const onuType = result.data?.onu_type_name || result.onus?.[0]?.onu_type_name;
      if (onuType) {
        setFormData(prev => ({ ...prev, routerModel: onuType }));
      }

      // Success
      Alert.alert('Success', 'Modem Serial Number is valid and verified in SmartOLT.');
      setIsSNValidated(true);
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.newRouterModemSN;
        return newErrors;
      });
    } catch (error: any) {
      console.error('[SO Edit Validation Error]', error);
      const errorMsg = error.response?.data?.message || error.message || 'Error communicating with validation system';
      Alert.alert('Validation Error', errorMsg);
      setErrors(prev => ({ ...prev, newRouterModemSN: errorMsg }));
      setIsSNValidated(false);
    } finally {
      setIsValidatingSN(false);
    }
  };

  const handleItemChange = useCallback((index: number, field: keyof OrderItem, value: string) => {
    setOrderItems(prev => {
      const next = prev.map((item, i) => {
        if (i === index) {
          const updatedItem = { ...item, [field]: value };
          if (field === 'itemId' && value === 'None') {
            updatedItem.quantity = '';
          }
          return updatedItem;
        }
        return item;
      });
      if (field === 'itemId' && value && index === prev.length - 1) next.push({ itemId: '', quantity: '' });
      return next;
    });
  }, []);

  const handleSaveInternal = async () => {
    if (isDrawingSignature) { Alert.alert('Wait', 'Save signature pad first.'); return; }
    
    const finalData = { ...formData, modifiedBy: currentUserEmail, modifiedDate: formatToGMT8MySQL() };
    setFormData(finalData);

    if (!validateForm(finalData, orderItems, imageFiles, usedPorts, setErrors)) {
      // Tells the modal to scroll to the first offending field, so the technician
      // is not left scrolling a long form to find what the alert is about.
      setValidationFailedAt(n => n + 1);
      Alert.alert('Error', 'Check required fields.');
      return;
    }

    setLoading(true);
    setShowLoadingModal(true);
    setLoadingPercentage(0);
    setCurrentStep(0);
    setLoadingMessage('Initializing save process...');

    let progressInterval: NodeJS.Timeout | null = null;

    try {
      // Proceed to Saving
      setCurrentStep(0);
      setLoadingPercentage(45);
      setLoadingMessage('Finalizing and saving changes...');
      
      progressInterval = setInterval(() => {
        setLoadingPercentage(prev => {
          if (prev >= 98) return 98;
          return prev + 1;
        });
      }, 500);

      // Cleanup drafts
      await AsyncStorage.removeItem(`serviceOrderDraft_${serviceOrderId}`);
      await AsyncStorage.removeItem(`serviceOrderItemsDraft_${serviceOrderId}`);



      // Upload Images
      const uploaded: any = {};
      const fileKeyMap = { 
        timeInFile: 'image1_url', 
        modemSetupFile: 'image2_url', 
        timeOutFile: 'image3_url', 
        clientSignatureFile: 'client_signature_url', 
        proofImageFile: 'proof_image_url',
        setupImageFile: 'setup_image_url',
        routerReadingImageFile: 'router_reading_image_url',
        boxReadingImageFile: 'box_reading_image_url',
        portLabelImageFile: 'speedtest_image_url'
      };
      for (const [fKey, aKey] of Object.entries(fileKeyMap)) {
        const asset = (imageFiles as any)[fKey];
        if (asset) {
          const fd = new FormData();
          fd.append('file', { uri: asset.uri, name: asset.uri.split('/').pop(), type: (asset as any).mimeType || 'image/png' } as any);
          const uRes = await apiClient.post('/google-drive/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
          if (uRes.data?.success) uploaded[aKey] = uRes.data.data.url;
        }
      }

      // Update SO
      const updatePayload = mapFormToApi(finalData, uploaded, currentUserEmail, serviceOrderData);
      const res = await apiClient.put(`/service-orders/${serviceOrderId}`, updatePayload);
      if (!res.data?.success) throw new Error(res.data?.message || 'Update failed');

      // Update Items
      const validItems = orderItems.filter(i => i.itemId && i.itemId.trim() !== '' && i.itemId !== 'None');
      if (validItems.length > 0) {
        try {
          const existing = await apiClient.get(`/service-order-items?service_order_id=${serviceOrderId}`);
          if (existing.data?.success) {
            for (const item of existing.data.data) await apiClient.delete(`/service-order-items/${item.id}`);
          }
        } catch(e){}
        await createServiceOrderItems(validItems.map(i => ({ service_order_id: parseInt(String(serviceOrderId)), item_name: i.itemId, quantity: parseInt(i.quantity) || 1 })));
      }

      if (progressInterval) clearInterval(progressInterval);
      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      setLoading(false);
      setShowLoadingModal(false);
      onSave(finalData);
      
      const isQueued = res.data?.reconnect_status === 'queued' || 
                       res.data?.restricted_status === 'queued' || 
                       res.data?.pullout_status === 'queued' || 
                       res.data?.migration_status === 'queued';
      
      Alert.alert('Success', isQueued ? 'success saving radius function in queue' : 'Updated!');
      onClose();
    } catch (e: any) {
      if (progressInterval) clearInterval(progressInterval);
      setLoading(false);
      setShowLoadingModal(false);

      // Detect SN-related validation errors and highlight the newRouterModemSN field
      const errorMessage = e.response?.data?.message || e.message || 'Unknown error';
      const lowerError = errorMessage.toLowerCase();

      if (
        lowerError.includes('smart olt') ||
        lowerError.includes('sn duplicate') ||
        lowerError.includes('sn not existing') ||
        lowerError.includes('duplicate detected')
      ) {
        setErrors(prev => ({ ...prev, newRouterModemSN: errorMessage }));
      }

      // Precise mapping for RADIUS/Duplicate errors to avoid "Failed to update" prefix
      if (
        lowerError.includes('radius offline') || 
        lowerError.includes('radius duplicate') || 
        lowerError.includes('it has a duplicate on onboarded customer')
      ) {
        Alert.alert('Error', errorMessage);
      } else {
        // Use the generic prefix for other errors
        Alert.alert('Error', `Failed to update records: ${errorMessage}`);
      }
    }
  };

  // Filtered Lists for Pickers
  const filtered = useMemo(() => ({
    inventory: [
      { id: 'none', item_name: 'None' } as any,
      ...inventoryItems.filter(i => i.item_name.toLowerCase().includes((searchQueries.inventory || '').toLowerCase()))
    ],
    lcpnaps: lcpnaps.filter(l => l.lcpnap_name.toLowerCase().includes((searchQueries.lcpnaps || '').toLowerCase())).slice(0, 50),
    routerModels: routerModels.filter(r => r.model.toLowerCase().includes((searchQueries.routerModels || '').toLowerCase())).slice(0, 50),
    technicians: (() => {
      const query = (searchQueries.technician || '').toLowerCase();
      let list = technicians;
      if (activeTechField === 'visitBy') list = technicians.filter(t => t.name !== formData.visitWith && t.name !== formData.visitWithOther);
      else if (activeTechField === 'visitWith') list = technicians.filter(t => t.name !== formData.visitBy && t.name !== formData.visitWithOther);
      else if (activeTechField === 'visitWithOther') list = technicians.filter(t => t.name !== formData.visitBy && t.name !== formData.visitWith);
      
      const finalList = (activeTechField === 'visitWith' || activeTechField === 'visitWithOther') ? [{ name: 'None', email: '' }, ...list] : list;
      return finalList.filter(t => t.name.toLowerCase().includes(query));
    })(),
    supportStatuses: ['Resolved', 'Failed', 'In Progress', 'For Visit'].filter(s => s.toLowerCase().includes((searchQueries.supportStatus || '').toLowerCase())),
    visitStatuses: ['Done', 'In Progress', 'Failed', 'Reschedule'].filter(s => s.toLowerCase().includes((searchQueries.visitStatus || '').toLowerCase())),
    assignedEmails: technicians.filter(t => t.name.toLowerCase().includes((searchQueries.assignedEmail || '').toLowerCase()) || t.email.toLowerCase().includes((searchQueries.assignedEmail || '').toLowerCase())),
    repairCategories: ['Fiber Relaying', 'Migrate', 'Reactivation', 'others', 'Pullout', 'Reboot/Reconfig Router', 'Relocate Router', 'Relocate', 'Replace Patch Cord', 'Replace Router', 'Resplice', 'Transfer LCP/NAP/PORT', 'Update Vlan'].filter(s => s.toLowerCase().includes((searchQueries.repairCategory || '').toLowerCase())),
    ports: (() => {
      const ports = Array.from({ length: totalPorts }, (_, i) => `P${(i + 1).toString().padStart(2, '0')}`);
      const available = ports.filter(p => !usedPorts.some(up => up.toUpperCase() === p.toUpperCase()));
      return available.filter(p => p.toLowerCase().includes((searchQueries.port || '').toLowerCase()));
    })(),
    vlans: vlans.filter(v => v.toLowerCase().includes((searchQueries.vlan || '').toLowerCase())),
    concerns: concerns.filter(c => c.concern_name.toLowerCase().includes((searchQueries.concern || '').toLowerCase())),
    plans: plans.map(p => `${p.name} - ${parseFloat(p.price.toString())}`).filter(p => p.toLowerCase().includes((searchQueries.plan || '').toLowerCase())),
  }), [
    inventoryItems, searchQueries.inventory, lcpnaps, searchQueries.lcpnaps, 
    routerModels, searchQueries.routerModels, technicians, searchQueries.technician, 
    activeTechField, formData.visitBy, formData.visitWith, formData.visitWithOther,
    searchQueries.supportStatus, searchQueries.visitStatus, searchQueries.assignedEmail,
    searchQueries.repairCategory, totalPorts, usedPorts, searchQueries.port,
    vlans, searchQueries.vlan, concerns, searchQueries.concern, plans, searchQueries.plan
  ]);

  return {
    formData, setFormData, errors, setErrors, validationFailedAt, loading, isContentReady, colorPalette, isTechnician, currentUserEmail,
    handleInputChange, handleImageUpload, handleSave: handleSaveInternal,
    activePicker, setActivePicker, searchQueries, setSearchQueries, filtered,
    orderItems, setOrderItems, activeItemIndex, setActiveItemIndex, handleItemChange,
    imageFiles, isDrawingSignature, setIsDrawingSignature, signatureRef, handleSignatureOK, scrollEnabled, setScrollEnabled,
    activeTechField, setActiveTechField,
    loadingPercentage, loadingMessage, currentStep, showLoadingModal,
    isSNValidated, isValidatingSN, handleValidateSN, validateCooldown
  };
};

const initialFormState: ServiceOrderEditFormData = {
  accountNo: '', dateInstalled: '', fullName: '', contactNumber: '', emailAddress: '', plan: '', username: '', connectionType: 'Fiber',
  routerModemSN: '', lcp: '', nap: '', port: '', vlan: '', supportStatus: 'In Progress', visitStatus: 'In Progress',
  repairCategory: '', visitBy: '', visitWith: '', visitWithOther: '', visitRemarks: '', clientSignature: '',
  itemName1: '', timeIn: '', modemSetupImage: '', timeOut: '', assignedEmail: '', concern: '', concernRemarks: '',
  modifiedBy: '', modifiedDate: '', serviceCharge: '0.00', status: 'unused',
  newRouterModemSN: '', newLcp: '', newNap: '', newPort: '', newVlan: '', routerModel: '', newPlan: '', newLcpnap: '', fullAddress: '', proofImage: '',
  setupImage: '', routerReadingImage: '', boxReadingImage: '', portLabelImage: ''
};

const mapApiToForm = (d: any): Partial<ServiceOrderEditFormData> => {
  const normPort = (p: any) => { if (!p) return ''; const n = String(p).replace(/[^\d]/g, ''); return n ? `P${n.padStart(2, '0')}` : ''; };
  // Pre-fill the visit team from the Start Timer selection. All three are required
  // to save, so without this a technician who already named the team when starting
  // has to name it again here. What the order already records always wins —
  // re-opening a completed order must never rewrite what was actually submitted.
  const visitTeam = startTimeVisitTeam(d.technicians);
  const formatDate = (s: string) => { if (!s) return ''; try { const d = new Date(s); return d.toISOString().split('T')[0]; } catch(e) { return s.split(' ')[0]; } };
  
  const repairCatList = ['Fiber Relaying', 'Migrate', 'Reactivation', 'others', 'Pullout', 'Reboot/Reconfig Router', 'Relocate Router', 'Relocate', 'Replace Patch Cord', 'Replace Router', 'Resplice', 'Transfer LCP/NAP/PORT', 'Update Vlan'];
  const supportStatusList = ['Resolved', 'Failed', 'In Progress', 'For Visit'];
  const visitStatusList = ['Done', 'In Progress', 'Failed', 'Reschedule'];

  const rawRepairCat = (d.repairCategory || d.repair_category || '').toLowerCase();
  const repairCategory = repairCatList.find(c => c.toLowerCase() === rawRepairCat) || d.repairCategory || d.repair_category || '';

  const rawSupportStatus = (d.supportStatus || d.support_status || '').toLowerCase();
  let supportStatus = supportStatusList.find(s => s.toLowerCase() === rawSupportStatus) || d.supportStatus || d.support_status || 'In Progress';
  if (supportStatus === 'Pending') supportStatus = 'In Progress';

  const rawVisitStatus = (d.visitStatus || d.visit_status || '').toLowerCase();
  let visitStatus = visitStatusList.find(v => v.toLowerCase() === rawVisitStatus) || d.visitStatus || d.visit_status || 'In Progress';
  if (visitStatus === 'Pending') visitStatus = 'In Progress';

  return {
    accountNo: d.accountNumber || d.account_no || '',
    dateInstalled: formatDate(d.dateInstalled || d.date_installed),
    fullName: d.fullName || d.full_name || '',
    contactNumber: d.contactNumber || d.contact_number || '',
    emailAddress: d.emailAddress || d.email_address || '',
    plan: d.plan || '',
    username: d.username || '',
    pppoePassword: d.pppoePassword || d.pppoe_password || '',
    connectionType: (() => {
      const t = (d.connectionType || d.connection_type || 'Fiber').toLowerCase();
      if (t === 'antenna') return 'Antenna';
      if (t === 'fiber') return 'Fiber';
      if (t === 'local') return 'Local';
      return 'Fiber';
    })(),
    routerModemSN: d.routerModemSN || d.router_modem_sn || '',
    lcp: d.lcp || '', nap: d.nap || '', port: normPort(d.port || d.PORT), vlan: d.vlan || '',
    supportStatus,
    visitStatus,
    repairCategory,
    // visit_by_user is the actual column; the camelCase and visit_by spellings are
    // kept for payloads that have already been through the context mapper.
    visitBy: d.visitBy || d.visit_by_user || d.visit_by || visitTeam[0] || '',
    visitWith: d.visitWith || d.visit_with || visitTeam[1] || '',
    visitWithOther: d.visitWithOther || d.visit_with_other || visitTeam[2] || '',
    visitRemarks: d.visitRemarks || d.visit_remarks || '', clientSignature: d.clientSignature || d.client_signature_url || d.client_signature || '',
    timeIn: d.timeIn || d.image1_url || d.time_in || '', modemSetupImage: d.modemSetupImage || d.image2_url || d.modem_setup_image || '',
    timeOut: d.timeOut || d.image3_url || d.time_out || '', assignedEmail: d.assignedEmail || d.assigned_email || '', concern: d.concern || '',
    concernRemarks: d.concernRemarks || d.concern_remarks || '',
    newPlan: d.new_plan || '', serviceCharge: (d.serviceCharge || d.service_charge || '0.00').toString().replace('₱', '').trim(),
    status: d.status || 'unused', newRouterModemSN: d.newRouterModemSN || d.new_router_modem_sn || '',
    newLcp: d.newLcp || d.new_lcp || '', newNap: d.newNap || d.new_nap || '', newPort: normPort(d.newPort || d.new_port),
    newVlan: d.newVlan || d.new_vlan || '', routerModel: d.routerModel || d.router_model || '',
    newLcpnap: d.newLcpnap || d.new_lcpnap || '', fullAddress: d.fullAddress || d.full_address || '', proofImage: d.proofImage || d.proof_image_url || d.proof_image || '',
    setupImage: d.setupImage || d.setup_image_url || '', routerReadingImage: d.routerReadingImage || d.router_reading_image_url || '',
    boxReadingImage: d.boxReadingImage || d.box_reading_image_url || '', portLabelImage: d.portLabelImage || d.speedtest_image_url || ''
  };
};

const mapFormToApi = (f: ServiceOrderEditFormData, uploads: any, user: string, original: any) => {
  const isReschedule = f.visitStatus === 'Reschedule';

  const manilaNow = dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss');
  const existingEndTime = original?.end_time || original?.End_Time;

  let payload: any = {
    account_no: f.accountNo,
    support_status: f.supportStatus,
    updated_by_user: user,
    concern: f.concern,
    concern_remarks: f.concernRemarks,
    service_charge: parseFloat(f.serviceCharge),
    status: f.status,
    new_plan: f.concern === 'Upgrade/Downgrade Plan' ? f.newPlan : '',
    // Base technical info (old/current values)
    old_lcp: f.lcp,
    old_nap: f.nap,
    old_port: f.port,
    old_vlan: f.vlan,
    old_lcpnap: original?.old_lcpnap || original?.lcpnap || '',
    old_router_modem_sn: f.routerModemSN,
  };

  if (f.supportStatus === 'For Visit') {
    payload.visit_status = f.visitStatus;
    payload.assigned_email = f.assignedEmail;
    payload.repair_category = f.repairCategory;

    if (f.visitStatus === 'Done') {
      payload = {
        ...payload,
        visit_by_user: f.visitBy,
        visit_with: f.visitWith,
        visit_with_other: f.visitWithOther,
        visit_remarks: f.visitRemarks,
        client_signature_url: uploads.client_signature_url || f.clientSignature || '',
        image1_url: uploads.image1_url || f.timeIn,
        image2_url: uploads.image2_url || f.modemSetupImage,
        image3_url: uploads.image3_url || f.timeOut,
        new_router_modem_sn: f.newRouterModemSN,
        new_lcp: f.newLcp,
        new_nap: f.newNap,
        new_lcpnap: f.newLcpnap,
        new_port: f.newPort,
        new_vlan: f.newVlan,
        router_model: f.routerModel,
        setup_image_url: uploads.setup_image_url || f.setupImage || '',
        router_reading_image_url: uploads.router_reading_image_url || f.routerReadingImage || '',
        box_reading_image_url: uploads.box_reading_image_url || f.boxReadingImage || '',
        speedtest_image_url: uploads.speedtest_image_url || f.portLabelImage || ''
      };

      if (!existingEndTime) {
        payload.end_time = manilaNow;
      }
    } else if (f.visitStatus === 'Reschedule' || f.visitStatus === 'Failed') {
      payload = {
        ...payload,
        visit_by_user: f.visitBy,
        visit_with: f.visitWith,
        visit_with_other: f.visitWithOther,
        visit_remarks: f.visitRemarks,
        proof_image_url: uploads.proof_image_url || f.proofImage || '',
      };

      if (!existingEndTime) {
        payload.end_time = manilaNow;
      }
    }
  } else if (f.supportStatus === 'Failed') {
    payload.proof_image_url = uploads.proof_image_url || f.proofImage || '';
    if (!existingEndTime) {
      payload.end_time = manilaNow;
    }
  } else if (f.supportStatus === 'Resolved') {
    if (!existingEndTime) {
      payload.end_time = manilaNow;
    }
  }

  return payload;
};

const validateForm = (f: ServiceOrderEditFormData, items: OrderItem[], images: ImageFiles, usedPorts: string[], setErrors: any) => {
  const e: Record<string, string> = {};
  if (!f.supportStatus) e.supportStatus = 'Required';
  if (!f.concern) e.concern = 'Required';
  if (f.concern === 'Upgrade/Downgrade Plan' && !f.newPlan) e.newPlan = 'Required';
  if (f.supportStatus === 'For Visit') {
    if (!f.assignedEmail) e.assignedEmail = 'Required';
    if (f.visitStatus === 'Done') {
      if (!items.some(i => i.itemId && i.quantity && i.itemId !== 'None') && !items.some(i => i.itemId === 'None')) e.items = 'Required item or "None"';
      if (!f.visitBy) e.visitBy = 'Required';
      // Enforced in both visit branches below, because renderInput marks Visit Remarks with an
      // asterisk in both — until now the asterisk was the only thing stopping a blank submit,
      // which is to say nothing was. Trimmed, so a field of spaces is not a record of the visit.
      if (!f.visitRemarks?.trim()) e.visitRemarks = 'Required';
      const reloc = ['Migrate', 'Relocate', 'Transfer LCP/NAP/PORT', 'Reactivation'];
      if (reloc.includes(f.repairCategory)) {
        if ((f.repairCategory === 'Migrate' || f.repairCategory === 'Reactivation') && !f.newRouterModemSN) e.newRouterModemSN = 'Required';
        if (!f.newLcpnap) e.newLcpnap = 'Required';
        if (!f.newPort) e.newPort = 'Required';
        else if (usedPorts.some(p => p.toUpperCase() === f.newPort.toUpperCase())) e.newPort = 'Port taken';
        if (!['Relocate', 'Transfer LCP/NAP/PORT'].includes(f.repairCategory) && !f.routerModel) e.routerModel = 'Required';
      }
      if (f.repairCategory === 'Replace Router' && !f.newRouterModemSN) e.newRouterModemSN = 'Required';
      if (!f.timeIn && !images.timeInFile) e.timeInFile = 'Required';
      if (f.repairCategory !== 'Reactivation' && !f.modemSetupImage && !images.modemSetupFile) e.modemSetupFile = 'Required';
      if (!f.clientSignature && !images.clientSignatureFile) e.clientSignatureFile = 'Required';
      if (!f.timeOut && !images.timeOutFile) e.timeOutFile = 'Required';
      
      if (f.repairCategory === 'Reactivation') {
        if (!f.setupImage && !images.setupImageFile) e.setupImageFile = 'Required';
        if (!f.routerReadingImage && !images.routerReadingImageFile) e.routerReadingImageFile = 'Required';
        if (!f.boxReadingImage && !images.boxReadingImageFile) e.boxReadingImageFile = 'Required';
        if (!f.portLabelImage && !images.portLabelImageFile) e.portLabelImageFile = 'Required';
      }
    } else if (['Reschedule', 'Failed'].includes(f.visitStatus)) {
      if (!f.visitBy) e.visitBy = 'Required';
      if (!f.visitWith) e.visitWith = 'Required';
      if (!f.visitWithOther) e.visitWithOther = 'Required';
      // A rescheduled or failed visit is exactly the case where the reason matters most.
      if (!f.visitRemarks?.trim()) e.visitRemarks = 'Required';
    }
  }
  if (f.supportStatus === 'Failed' || (f.supportStatus === 'For Visit' && f.visitStatus === 'Failed')) {
    if (!f.proofImage && !images.proofImageFile) e.proofImageFile = 'Required';
  }
  setErrors(e);
  return Object.keys(e).length === 0;
};
